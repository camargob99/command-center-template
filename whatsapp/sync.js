// WhatsApp -> Command Center sync. Runs on your PC (start with whatsapp\start-whatsapp.bat).
// 1. Starts the WhatsApp bridge (whatsapp-bridge.exe, a read-only linked device; the first run shows a QR code).
// 2. Every 10 minutes, sends the cloud your group names, plus new messages from the groups you chose to watch.
//    Direct chats and unwatched groups never leave this PC. Nothing is ever sent on WhatsApp.
// 3. Once a minute, asks the cloud whether you pressed Refresh on the dashboard, and if so syncs right away.
// Normally it runs hidden (run-hidden.vbs, started at sign-in); only one copy runs at a time.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HERE = __dirname;
const STORE = path.join(HERE, 'store');
const STATE_FILE = path.join(HERE, 'sync-state.json');
const EVERY_MIN = 10;
const POLL_SEC = 60; // how often to check for a Refresh press
const LOCK_PORT = 8766; // held while running, so a second copy exits instead of fighting over the WhatsApp link
const BACKFILL_DAYS = 14; // when you start watching a group, send its last two weeks
const args = process.argv.slice(2);
const ONCE = args.includes('--once'), NO_BRIDGE = args.includes('--no-bridge') || ONCE;

const log = (...a) => console.log(`[sync ${new Date().toLocaleTimeString()}]`, ...a);

function syncUrl() {
  if (process.env.CC_WA_URL) return process.env.CC_WA_URL;
  const f = path.join(HERE, '..', 'cloud', 'your-links.txt');
  const m = fs.existsSync(f) && fs.readFileSync(f, 'utf8').match(/WhatsApp sync URL[^:]*:\s*(\S+)/);
  if (!m) { console.error('No WhatsApp sync URL yet. Run setup-cloud.bat once (it adds the URL to cloud\\your-links.txt), then start this again.'); process.exit(1); }
  return m[1];
}

function openDb(file) {
  const { DatabaseSync } = require('node:sqlite');
  let db;
  try { db = new DatabaseSync(file, { readOnly: true }); } catch { db = new DatabaseSync(file); }
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

// Times are stored like "2026-11-13 14:05:09.123-05:00" (or with " +0000 UTC" on some builds).
function toMs(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  let s = String(v).trim().replace(' ', 'T').replace(/\s*\+0000 UTC$/, 'Z').replace(/ ([+-]\d{4}) \w+$/, '$1');
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { lastRowid: null, watch: [] }; } }
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

// Contact names from the linked-device store, so messages say "Priya" instead of a phone number.
function contactNames() {
  const names = new Map();
  const f = path.join(STORE, 'whatsapp.db');
  if (!fs.existsSync(f)) return names;
  let db;
  try {
    db = openDb(f);
    for (const r of db.prepare('SELECT their_jid, full_name, first_name, push_name, business_name FROM whatsmeow_contacts').all()) {
      const n = r.full_name || r.push_name || r.first_name || r.business_name;
      if (n) names.set(String(r.their_jid).split('@')[0].split(':')[0], n);
    }
    try { for (const r of db.prepare('SELECT lid, pn FROM whatsmeow_lid_map').all()) { const n = names.get(String(r.pn).split('@')[0]); if (n) names.set(String(r.lid).split('@')[0], n); } } catch {}
  } catch (e) { log('Could not read contact names:', e.message); } finally { try { db && db.close(); } catch {} }
  return names;
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`cloud said ${r.status} ${j.error || ''}`);
  return j;
}

async function syncOnce(url) {
  const file = path.join(STORE, 'messages.db');
  if (!fs.existsSync(file)) { log('Waiting for WhatsApp to link (scan the QR code).'); return; }
  const state = loadState();
  const db = openDb(file);
  try {
    const groups = db.prepare("SELECT jid, name, last_message_time FROM chats WHERE jid LIKE '%@g.us'").all()
      .map((g) => ({ jid: g.jid, name: g.name || '', last: toMs(g.last_message_time) }));
    const maxRow = Number((db.prepare('SELECT MAX(rowid) AS m FROM messages').get() || {}).m || 0);
    // 1. Group names up, watch list down.
    const { watch } = await post(url, { groups, messages: [] });
    const was = new Set(state.watch || []);
    const fresh = watch.filter((j) => !was.has(j));
    // 2. Messages: new ones from watched groups, plus a backfill for groups you just started watching.
    const names = contactNames();
    const toMsg = (r) => {
      const who = r.is_from_me ? 'Me' : names.get(String(r.sender || '').split('@')[0].split(':')[0]) || r.sender || '';
      const body = r.content || (r.media_type ? `[${r.media_type}${r.filename ? `: ${r.filename}` : ''}]` : '');
      return { chat: r.chat_jid, id: r.id, sender: who, body, ts: toMs(r.timestamp) };
    };
    let rows = [];
    const lastRow = state.lastRowid == null ? maxRow : state.lastRowid; // first run: start from now
    if (watch.length) {
      const q = `SELECT rowid AS rid, id, chat_jid, sender, content, timestamp, is_from_me, media_type, filename FROM messages WHERE rowid > ? AND chat_jid IN (${watch.map(() => '?').join(',')}) ORDER BY rowid`;
      rows = db.prepare(q).all(lastRow, ...watch);
    }
    if (fresh.length) {
      const since = Date.now() - BACKFILL_DAYS * 864e5;
      const q = `SELECT rowid AS rid, id, chat_jid, sender, content, timestamp, is_from_me, media_type, filename FROM messages WHERE chat_jid IN (${fresh.map(() => '?').join(',')}) ORDER BY rowid`;
      rows.push(...db.prepare(q).all(...fresh).filter((r) => toMs(r.timestamp) >= since));
    }
    const msgs = rows.map(toMsg).filter((m) => m.body && m.ts);
    let stored = 0;
    for (let i = 0; i < msgs.length; i += 1000) stored += (await post(url, { groups: [], messages: msgs.slice(i, i + 1000) })).stored || 0;
    saveState({ lastRowid: maxRow, watch });
    log(`${groups.length} groups, ${watch.length} watched, sent ${stored} new message${stored === 1 ? '' : 's'}.`);
  } finally { db.close(); }
}

function startBridge() {
  const exe = path.join(HERE, process.platform === 'win32' ? 'whatsapp-bridge.exe' : 'whatsapp-bridge');
  if (!fs.existsSync(exe)) { console.error(`Missing ${exe}`); process.exit(1); }
  const env = { ...process.env, WEBHOOK_ENABLED: 'false', WHATSAPP_BRIDGE_PORT: process.env.WHATSAPP_BRIDGE_PORT || '8765', WHATSAPP_DEVICE_NAME: 'Command Center (read-only)', WHATSAPP_AUTO_DOWNLOAD_MEDIA: 'false' };
  const child = spawn(exe, [], { cwd: HERE, env, stdio: 'inherit' });
  child.on('exit', (code) => { log(`WhatsApp bridge stopped (code ${code}). Restarting in 30s.`); setTimeout(startBridge, 30000); });
  process.on('exit', () => { try { child.kill(); } catch {} });
}

// Only one copy at a time: holding a local port is the lock (it frees itself if this process dies).
function takeLock() {
  return new Promise((resolve) => {
    const srv = require('node:net').createServer();
    srv.once('error', () => resolve(false));
    srv.listen(LOCK_PORT, '127.0.0.1', () => resolve(true));
  });
}

async function main() {
  const url = syncUrl();
  if (ONCE) return syncOnce(url);
  if (!(await takeLock())) { log('WhatsApp sync is already running.'); process.exit(3); } // 3 tells run-hidden.vbs not to retry
  if (!NO_BRIDGE) startBridge();
  let busy = false, lastWant = 0;
  const tick = async (why) => {
    if (busy) return;
    busy = true;
    try { await syncOnce(url); if (why) log(why); } catch (e) { log('Sync failed, will retry:', e.message); } finally { busy = false; }
  };
  // Refresh: the cloud remembers when you last pressed it; sync if that's newer than what we've handled.
  const poll = async () => {
    try {
      const r = await fetch(url);
      const { want = 0 } = await r.json();
      if (!lastWant) { lastWant = want; return; } // first poll: just note where we are
      if (want > lastWant) { lastWant = want; await tick('Synced because Refresh was pressed.'); }
    } catch {}
  };
  setTimeout(() => tick(), 60 * 1000);
  setInterval(() => tick(), EVERY_MIN * 60 * 1000);
  poll(); setInterval(poll, POLL_SEC * 1000);
}

process.on('SIGINT', () => process.exit(0));
main().catch((e) => { console.error(e); process.exit(1); });
