// WhatsApp event reminders (cloud only).
// The PC sync (whatsapp/sync.js) pushes group names, plus messages from the groups the owner chose to watch, to /wa/<WA_KEY>.
// Direct chats never leave the PC. Claude reads the messages with whatsapp_messages, saves the events it finds
// with save_whatsapp_events, and the dashboard shows them on the Today page.

import { matchEvents } from './wa-match.js';

const KEEP_DAYS = 30; // messages older than this are deleted
const DAY = 864e5;

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS wa_groups (jid TEXT PRIMARY KEY, name TEXT, watch INTEGER NOT NULL DEFAULT 0, last_at INTEGER)',
  // ts = when it was sent; added = when it reached the cloud (Claude's "since" cursor uses added, so late syncs aren't missed)
  'CREATE TABLE IF NOT EXISTS wa_msgs (chat TEXT NOT NULL, id TEXT NOT NULL, sender TEXT, body TEXT, ts INTEGER NOT NULL, added INTEGER NOT NULL, PRIMARY KEY (chat, id))',
  'CREATE INDEX IF NOT EXISTS wa_msgs_added ON wa_msgs (added)',
  "CREATE TABLE IF NOT EXISTS wa_events (id TEXT PRIMARY KEY, title TEXT NOT NULL, date TEXT, time TEXT, place TEXT, link TEXT, chat TEXT, note TEXT, status TEXT NOT NULL DEFAULT 'open', task_id TEXT, created INTEGER)",
  // messages in watched groups that need the owner: @mentions, questions put to him
  "CREATE TABLE IF NOT EXISTS wa_replies (id TEXT PRIMARY KEY, chat TEXT, sender TEXT, text TEXT, ts INTEGER, reason TEXT, status TEXT NOT NULL DEFAULT 'open', created INTEGER)",
];
// columns added after the first release (ALTER fails harmlessly once they exist)
const ADD_COLUMNS = ['ALTER TABLE wa_events ADD COLUMN quote TEXT', 'ALTER TABLE wa_events ADD COLUMN sender TEXT', 'ALTER TABLE wa_events ADD COLUMN deadline TEXT',
  // auto = found by the free keyword matcher; src_added = when its message reached the cloud (Claude's check replaces it)
  'ALTER TABLE wa_events ADD COLUMN auto INTEGER', 'ALTER TABLE wa_events ADD COLUMN src_added INTEGER'];
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  for (const a of ADD_COLUMNS) { try { await db.prepare(a).run(); } catch {} }
  schemaReady = true;
}

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // local (America/New_York via tzdate.js)
const localStamp = (ms) => { const d = new Date(ms); return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
const str = (v, max) => (v == null ? '' : String(v)).slice(0, max);

async function getVal(db, k) { const r = await db.prepare('SELECT v FROM doc WHERE k = ? AND part = 0').bind(k).first(); return r ? r.v : null; }
const setVal = (db, k, v) => db.prepare('INSERT OR REPLACE INTO doc (k, part, v) VALUES (?, 0, ?)').bind(k, String(v));

// ---------- PC sync endpoint ----------
// GET is the PC's once-a-minute poll: it answers with the time of the last Refresh press, so the PC syncs right away.
export async function syncEndpoint(req, env) {
  const db = env.DB;
  await ensureSchema(db);
  if (req.method === 'GET') return Response.json({ want: Number(await getVal(db, 'wa_want')) || 0 });
  if (req.method !== 'POST') return new Response('WhatsApp sync endpoint. The PC sync posts here.', { status: 405 });
  let body; try { body = await req.json(); } catch { return Response.json({ error: 'Bad JSON' }, { status: 400 }); }
  const groups = Array.isArray(body.groups) ? body.groups.slice(0, 2000) : [];
  const stmts = [];
  for (const g of groups) {
    if (!g || typeof g.jid !== 'string' || !g.jid.endsWith('@g.us')) continue;
    stmts.push(db.prepare('INSERT INTO wa_groups (jid, name, last_at) VALUES (?, ?, ?) ON CONFLICT(jid) DO UPDATE SET name = excluded.name, last_at = MAX(COALESCE(wa_groups.last_at, 0), excluded.last_at)')
      .bind(g.jid, str(g.name, 200) || null, Number(g.last) || null));
  }
  if (stmts.length) await db.batch(stmts);

  const { results } = await db.prepare('SELECT jid FROM wa_groups WHERE watch = 1').all();
  const watch = new Set(results.map((r) => r.jid));
  const cutoff = Date.now() - KEEP_DAYS * DAY;
  const msgs = (Array.isArray(body.messages) ? body.messages.slice(0, 5000) : [])
    .filter((m) => m && watch.has(m.chat) && m.id && Number(m.ts) > cutoff && m.body);
  const now = Date.now();
  const ins = msgs.map((m, i) => db.prepare('INSERT OR IGNORE INTO wa_msgs (chat, id, sender, body, ts, added) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(m.chat, str(m.id, 100), str(m.sender, 120), str(m.body, 4000), Number(m.ts), now + i)); // +i keeps the cursor unique within a batch
  ins.push(db.prepare('DELETE FROM wa_msgs WHERE ts < ?').bind(cutoff), setVal(db, 'wa_sync', Date.now()));
  for (let i = 0; i < ins.length; i += 200) await db.batch(ins.slice(i, i + 200));
  let found = 0;
  if (msgs.length) { try { found = await autoEvents(db, msgs.map((m, i) => ({ ...m, added: now + i }))); } catch {} }
  return Response.json({ ok: true, stored: msgs.length, found, watch: [...watch] });
}

// Free keyword matcher: save likely events from new messages, skipping any day that group already has an event for.
async function autoEvents(db, msgs) {
  const found = matchEvents(msgs);
  if (!found.length) return 0;
  const existing = (await db.prepare('SELECT lower(title) AS t, date, chat FROM wa_events').all()).results;
  const seen = new Set(existing.flatMap((e) => [`${e.t}|${e.date || ''}`, `${e.chat}|${e.date}`]));
  const stmts = [];
  for (const e of found) {
    const a = `${e.title.toLowerCase()}|${e.date}`, b = `${e.chat}|${e.date}`;
    if (seen.has(a) || seen.has(b)) continue;
    seen.add(a); seen.add(b);
    stmts.push(db.prepare('INSERT INTO wa_events (id, title, date, time, link, chat, quote, sender, deadline, created, auto, src_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)')
      .bind(newId(), str(e.title, 200), e.date, e.time, e.link ? str(e.link, 500) : null, e.chat, str(e.quote, 600), str(e.sender, 120) || null, e.deadline, Date.now(), e.srcAdded));
  }
  if (stmts.length) await db.batch(stmts);
  return stmts.length;
}

// ---------- dashboard API (signed in) ----------
// Open events from today through the next `days` days (undated ones too). Registered, added and dismissed ones drop off.
async function listEvents(db, { includePast = false, days = 14 } = {}) {
  const today = ymd(new Date());
  const last = ymd(new Date(Date.now() + days * DAY));
  const q = includePast
    ? "SELECT e.*, g.name AS group_name FROM wa_events e LEFT JOIN wa_groups g ON g.jid = e.chat WHERE e.status != 'dismissed' ORDER BY COALESCE(e.date, '9999'), COALESCE(e.time, '99')"
    : "SELECT e.*, g.name AS group_name FROM wa_events e LEFT JOIN wa_groups g ON g.jid = e.chat WHERE e.status = 'open' AND (e.date IS NULL OR (e.date >= ? AND e.date <= ?)) ORDER BY COALESCE(e.date, '9999'), COALESCE(e.time, '99')";
  const { results } = await (includePast ? db.prepare(q) : db.prepare(q).bind(today, last)).all();
  return results.map((e) => ({ id: e.id, title: e.title, date: e.date, time: e.time, place: e.place, link: e.link, group: e.group_name || null, note: e.note, quote: e.quote || null, sender: e.sender || null, deadline: e.deadline || null, status: e.status, taskId: e.task_id }));
}
// Open "waiting on you" items. One clears itself once the owner has written in that group after it.
async function listReplies(db) {
  await db.prepare("UPDATE wa_replies SET status = 'replied' WHERE status = 'open' AND EXISTS (SELECT 1 FROM wa_msgs m WHERE m.chat = wa_replies.chat AND m.sender = 'Me' AND m.ts > wa_replies.ts)").run();
  await db.prepare("DELETE FROM wa_replies WHERE ts < ?").bind(Date.now() - KEEP_DAYS * DAY).run();
  const { results } = await db.prepare("SELECT r.*, g.name AS group_name FROM wa_replies r LEFT JOIN wa_groups g ON g.jid = r.chat WHERE r.status = 'open' ORDER BY r.ts DESC LIMIT 20").all();
  return results.map((r) => ({ id: r.id, group: r.group_name || null, from: r.sender, text: r.text, at: r.ts, reason: r.reason }));
}
async function listGroups(db) {
  const { results } = await db.prepare('SELECT jid, name, watch, last_at FROM wa_groups ORDER BY watch DESC, COALESCE(last_at, 0) DESC').all();
  return results.map((g) => ({ jid: g.jid, name: g.name || g.jid, watch: !!g.watch, last: g.last_at }));
}

export async function api(req, env, url) {
  const db = env.DB;
  await ensureSchema(db);
  const p = url.pathname, m = req.method;
  if (m === 'GET' && p === '/api/whatsapp') {
    const [events, replies, groups, lastSync, checked] = await Promise.all([listEvents(db), listReplies(db), listGroups(db), getVal(db, 'wa_sync'), getVal(db, 'wa_checked')]);
    return { status: 200, body: { events, replies, groups, lastSync: lastSync ? Number(lastSync) : null, lastCheck: checked ? Number(checked) : null } };
  }
  // Refresh button: ask the PC to sync now (it polls once a minute). The page then watches lastSync.
  if (m === 'POST' && p === '/api/whatsapp/refresh') {
    const at = Date.now();
    await setVal(db, 'wa_want', at).run();
    return { status: 200, body: { ok: true, requested: at } };
  }
  const body = m === 'GET' ? {} : await req.json().catch(() => ({}));
  if (m === 'PATCH' && p === '/api/whatsapp/groups') {
    await db.prepare('UPDATE wa_groups SET watch = ? WHERE jid = ?').bind(body.watch ? 1 : 0, String(body.jid || '')).run();
    if (!body.watch) await db.prepare('DELETE FROM wa_msgs WHERE chat = ?').bind(String(body.jid || '')).run();
    return { status: 200, body: { ok: true } };
  }
  const em = p.match(/^\/api\/whatsapp\/events\/([0-9a-f]{12})$/);
  if (m === 'PATCH' && em) {
    const status = EVENT_STATUS.includes(body.status) ? body.status : 'open';
    await db.prepare('UPDATE wa_events SET status = ?, task_id = COALESCE(?, task_id) WHERE id = ?').bind(status, body.taskId || null, em[1]).run();
    return { status: 200, body: { ok: true } };
  }
  const rm = p.match(/^\/api\/whatsapp\/replies\/([0-9a-f]{12})$/);
  if (m === 'PATCH' && rm) {
    const status = ['open', 'replied', 'dismissed'].includes(body.status) ? body.status : 'open';
    await db.prepare('UPDATE wa_replies SET status = ? WHERE id = ?').bind(status, rm[1]).run();
    return { status: 200, body: { ok: true } };
  }
  return { status: 404, body: { error: 'Not found' } };
}

const EVENT_STATUS = ['open', 'registered', 'dismissed', 'added'];

// ---------- Claude's tools ----------
// Cheap pre-filter so Claude only reads messages that look like they mention an event.
const EVENTISH = /\b(mon|tue|wed|thu|fri|sat|sun)(day|s|\.)?\b|\b(today|tonight|tomorrow|tmrw|this week|next week|weekend)\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d|\b\d{1,2}[/.]\d{1,2}\b|\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\b\d{1,2}:\d{2}\b|rsvp|regist|sign[ -]?up|signup|event|invite|join us|tickets?\b|deadline|due\b|zoom|meet\.google|calendly|lu\.ma|partiful|eventbrite|venue|location|happy hour|dinner|lunch|breakfast|party|mixer|session|talk\b|panel|workshop|meeting|info ?session|trip|trek|game|reminder|don.t forget|starts? at|kick ?off/i;
// Messages that may need a reply from the owner: his name, an @mention (WhatsApp writes these as @<number>), or "you guys"-style asks.
const FOR_YOU = /\bOWNER_FIRST_NAME\b|@\d{6,}|can you\b|could you\b|are you\b.*\?/i;
// Short buy/sell/swap posts (train tickets, party tickets) are never events to save.
const NOISE = /^\W*(iso|selling|sell|looking for|giving away|anyone need|swap|trade|can swap|still selling)\b/i;

const EVENT_STATUS_LIST = ['open', 'registered', 'dismissed', 'added'];
export const WA_TOOLS = [
  { name: 'whatsapp_messages', description: "Read messages from the WhatsApp groups the owner watches (synced from his PC). Defaults to everything since the last save_whatsapp_events call, keeping only messages that look like they mention an event or may need a reply from the owner (flagged for_you). Use it to find event reminders, then call save_whatsapp_events.", inputSchema: { type: 'object', properties: { since: { type: 'string', description: 'ISO date-time; default: since the last check (or 3 days ago)' }, group: { type: 'string', description: 'Part of a group name' }, match: { type: 'string', description: 'Only messages containing this text' }, events_only: { type: 'boolean', description: 'Default true: only messages that look event-related. false returns everything.' }, limit: { type: 'number', description: 'Default 150, max 500' } } } },
  { name: 'save_whatsapp_events', description: 'Save events found in WhatsApp messages so they show on the Command Center Today page. Duplicates (same title and date) are skipped. Also records that messages up to checked_through have been reviewed, so the next whatsapp_messages call starts there. Call it with an empty list after a check that found nothing.', inputSchema: { type: 'object', properties: { events: { type: 'array', items: { type: 'object', properties: { title: { type: 'string', description: 'Short name, e.g. "WG27 Thanksgiving potluck"' }, date: { type: 'string', description: 'YYYY-MM-DD' }, time: { type: 'string', description: 'HH:MM 24h, local time' }, place: { type: 'string' }, link: { type: 'string', description: 'RSVP or event link' }, group: { type: 'string', description: 'Group name it came from' }, note: { type: 'string', description: 'One line: what to do (RSVP by, cost, bring...)' }, quote: { type: 'string', description: 'The key part of the original message, verbatim, up to ~300 characters' }, sender: { type: 'string', description: 'Who posted it' }, deadline: { type: 'string', description: 'Short sign-up deadline if any, e.g. "RSVP by tonight", "Sells out fast"' } }, required: ['title'] } }, replies: { type: 'array', description: 'Messages in watched groups that need a reply from the owner (he was @mentioned or asked something directly). Skip ones he already answered (a later message from "Me" in that group).', items: { type: 'object', properties: { group: { type: 'string' }, from: { type: 'string' }, text: { type: 'string', description: 'The message, verbatim, up to ~300 characters' }, at: { type: 'string', description: 'The "at" value from whatsapp_messages' }, reason: { type: 'string', enum: ['asked you', 'mentioned you'] } }, required: ['text'] } }, checked_through: { type: 'string', description: 'ISO date-time of the newest message reviewed (the "until" value from whatsapp_messages)' } }, required: ['events'] } },
  { name: 'list_whatsapp_events', description: 'List saved WhatsApp events (upcoming and open by default).', inputSchema: { type: 'object', properties: { include_past: { type: 'boolean', description: 'Also list past, added and undated ones' } } } },
  { name: 'update_whatsapp_event', description: 'Fix, dismiss or mark registered a saved WhatsApp event.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: EVENT_STATUS_LIST }, title: { type: 'string' }, date: { type: 'string' }, time: { type: 'string' }, place: { type: 'string' }, link: { type: 'string' }, note: { type: 'string' } }, required: ['id'] } },
  { name: 'whatsapp_groups', description: "List the owner's WhatsApp groups and which ones are watched. Pass watch or unwatch (group names or parts of names) to change that. Only watched groups' messages are synced.", inputSchema: { type: 'object', properties: { watch: { type: 'array', items: { type: 'string' } }, unwatch: { type: 'array', items: { type: 'string' } } } } },
];
export const WA_INSTRUCTIONS = ' WhatsApp: event reminders from the owner\'s watched WhatsApp groups. To check (once a day is enough), call whatsapp_messages (no arguments), then save_whatsapp_events with the events you found, any replies he owes (for_you messages that @mention him or ask him something directly, not ones he already answered), and its "until" value as checked_through. Empty lists are fine. Only save real upcoming events, not chatter. For each event include the registration or event-page link if the message has one, a short verbatim quote, the sender, and a deadline when there is one.';

const findGroup = (groups, name) => (name ? groups.find((x) => x.name.toLowerCase() === String(name).toLowerCase()) || groups.find((x) => x.name.toLowerCase().includes(String(name).toLowerCase())) : null);

export async function callTool(env, name, a = {}) {
  const db = env.DB;
  await ensureSchema(db);
  if (name === 'whatsapp_messages') {
    const checked = await getVal(db, 'wa_checked');
    const since = a.since ? Date.parse(a.since) : checked ? Number(checked) : Date.now() - 3 * DAY;
    if (!Number.isFinite(since)) throw new Error('since must be an ISO date-time');
    const limit = Math.min(Number(a.limit) || 150, 500);
    const { results } = await db.prepare('SELECT m.chat, m.sender, m.body, m.ts, m.added, g.name FROM wa_msgs m JOIN wa_groups g ON g.jid = m.chat WHERE g.watch = 1 AND m.added > ? ORDER BY m.added, m.ts LIMIT 5000').bind(since).all();
    const gq = (a.group || '').toLowerCase(), tq = (a.match || '').toLowerCase();
    let rows = results.filter((r) => (!gq || (r.name || '').toLowerCase().includes(gq)) && (!tq || r.body.toLowerCase().includes(tq)));
    const total = rows.length;
    if (a.events_only !== false) {
      rows = rows.filter((r) => r.sender === 'Me' || ((EVENTISH.test(r.body) || FOR_YOU.test(r.body)) && !(NOISE.test(r.body) && r.body.length < 200)));
      // The same announcement is often cross-posted to several groups: keep the first, list the others.
      const firstOf = new Map();
      rows = rows.filter((r) => {
        const k = r.body.replace(/\s+/g, ' ').trim().slice(0, 120).toLowerCase();
        if (k.length < 60) return true;
        const f = firstOf.get(k);
        if (f) { if (!f.also.includes(r.name)) f.also.push(r.name); return false; }
        r.also = []; firstOf.set(k, r); return true;
      });
    }
    let more = rows.length > limit;
    let cut = limit;
    // Never split messages that arrived in the same sync: the next call starts after "until".
    while (more && cut < rows.length && cut < 600 && rows[cut].added === rows[cut - 1].added) cut++;
    more = rows.length > cut;
    rows = rows.slice(0, cut);
    const until = more ? rows[rows.length - 1].added : (results.length ? results[results.length - 1].added : since);
    const lastSync = await getVal(db, 'wa_sync');
    return {
      since: new Date(since).toISOString(), until: new Date(until).toISOString(),
      today: ymd(new Date()), lastPcSync: lastSync ? localStamp(Number(lastSync)) : 'never',
      scanned: total, shown: rows.length, more,
      messages: rows.map((r) => ({ group: r.name, at: localStamp(r.ts), from: r.sender || '', text: r.body.length > 1200 ? `${r.body.slice(0, 1200)}…` : r.body, ...(r.also && r.also.length ? { also_in: r.also } : {}), ...(r.sender !== 'Me' && FOR_YOU.test(r.body) ? { for_you: true } : {}) })),
      ...(more ? { hint: 'More messages after "until": save what you found with checked_through = until, then call again.' } : {}),
    };
  }
  if (name === 'save_whatsapp_events') {
    const evs = Array.isArray(a.events) ? a.events : [];
    const groups = await listGroups(db);
    // open keyword-matcher cards don't block Claude's version; they are replaced below
    const existing = (await db.prepare("SELECT lower(title) AS t, date FROM wa_events WHERE NOT (auto = 1 AND status = 'open')").all()).results;
    const seen = new Set(existing.map((e) => `${e.t}|${e.date || ''}`));
    const saved = [], skipped = [];
    const stmts = [];
    for (const e of evs) {
      const title = str(e.title, 200).trim(); if (!title) continue;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') ? e.date : null;
      const time = /^\d{1,2}:\d{2}$/.test(e.time || '') ? e.time.padStart(5, '0') : null;
      const key = `${title.toLowerCase()}|${date || ''}`;
      if (seen.has(key)) { skipped.push(title); continue; }
      seen.add(key);
      const g = findGroup(groups, e.group);
      const id = newId();
      stmts.push(db.prepare('INSERT INTO wa_events (id, title, date, time, place, link, chat, note, quote, sender, deadline, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, title, date, time, str(e.place, 200) || null, (/^https?:\/\//i.test(e.link || '') ? str(e.link, 500) : null), g ? g.jid : null, str(e.note, 300) || null, str(e.quote, 600) || null, str(e.sender, 120) || null, str(e.deadline, 60) || null, Date.now()));
      if (date && g) stmts.unshift(db.prepare("DELETE FROM wa_events WHERE auto = 1 AND status = 'open' AND chat = ? AND date = ?").bind(g.jid, date));
      saved.push({ id, title, date, time });
    }
    const savedReplies = [];
    const prior = new Set((await db.prepare('SELECT chat, text FROM wa_replies').all()).results.map((r) => `${r.chat}|${r.text}`));
    for (const r of Array.isArray(a.replies) ? a.replies : []) {
      const text = str(r.text, 600).trim(); if (!text) continue;
      const g = findGroup(groups, r.group);
      if (prior.has(`${g ? g.jid : null}|${text}`)) continue;
      const ts = r.at ? Date.parse(String(r.at).replace(' ', 'T')) : Date.now();
      stmts.push(db.prepare('INSERT INTO wa_replies (id, chat, sender, text, ts, reason, created) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(newId(), g ? g.jid : null, str(r.from, 120) || null, text, Number.isFinite(ts) ? ts : Date.now(), r.reason === 'mentioned you' ? 'mentioned you' : 'asked you', Date.now()));
      savedReplies.push(text.slice(0, 60));
    }
    const through = a.checked_through ? Date.parse(a.checked_through) : Date.now();
    const thru = Number.isFinite(through) ? through : Date.now();
    // Claude has now read the messages behind the keyword matcher's open cards: its own list replaces them.
    stmts.unshift(db.prepare("DELETE FROM wa_events WHERE auto = 1 AND status = 'open' AND COALESCE(src_added, 0) <= ?").bind(thru));
    stmts.push(setVal(db, 'wa_checked', thru));
    await db.batch(stmts);
    return { ok: true, saved, skipped_duplicates: skipped, replies_saved: savedReplies.length };
  }
  if (name === 'list_whatsapp_events') return { events: await listEvents(db, { includePast: !!a.include_past, days: 60 }), waiting_on_you: await listReplies(db) };
  if (name === 'update_whatsapp_event') {
    const cur = await db.prepare('SELECT * FROM wa_events WHERE id = ?').bind(String(a.id || '')).first();
    if (!cur) return { ok: false, error: 'No event with that id' };
    const next = { ...cur };
    for (const k of ['title', 'date', 'time', 'place', 'link', 'note', 'quote', 'deadline', 'status']) if (a[k] !== undefined) next[k] = a[k] === '' ? null : String(a[k]);
    if (!EVENT_STATUS.includes(next.status)) next.status = 'open';
    if (next.link && !/^https?:\/\//i.test(next.link)) next.link = null;
    await db.prepare('UPDATE wa_events SET title = ?, date = ?, time = ?, place = ?, link = ?, note = ?, quote = ?, deadline = ?, status = ? WHERE id = ?')
      .bind(next.title || cur.title, next.date, next.time, next.place, next.link, next.note, next.quote || null, next.deadline || null, next.status, cur.id).run();
    return { ok: true };
  }
  if (name === 'whatsapp_groups') {
    let groups = await listGroups(db);
    const pick = (terms) => groups.filter((g) => (terms || []).some((t) => t && (g.jid === t || g.name.toLowerCase().includes(String(t).toLowerCase()))));
    const on = pick(a.watch), off = pick(a.unwatch);
    const stmts = [...on.map((g) => db.prepare('UPDATE wa_groups SET watch = 1 WHERE jid = ?').bind(g.jid)), ...off.map((g) => db.prepare('UPDATE wa_groups SET watch = 0 WHERE jid = ?').bind(g.jid)), ...off.map((g) => db.prepare('DELETE FROM wa_msgs WHERE chat = ?').bind(g.jid))];
    if (stmts.length) { await db.batch(stmts); groups = await listGroups(db); }
    const lastSync = await getVal(db, 'wa_sync');
    return { lastPcSync: lastSync ? localStamp(Number(lastSync)) : 'never', changed: { watched: on.map((g) => g.name), unwatched: off.map((g) => g.name) }, groups: groups.map((g) => ({ name: g.name, watch: g.watch })) };
  }
  throw new Error(`Unknown tool ${name}`);
}
