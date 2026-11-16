// Command Center in the cloud (Cloudflare Workers + D1).
// Same app as the PC version: the dashboard (public/), the API (lib/core.js) and Claude's tools (lib/tools.js).
// Only the owner's Google account can sign in; Claude reaches it through the private connector URL /mcp/<MCP_KEY>.
import { installZonedDate } from './tzdate.js';
import { Store } from '../lib/store.js';
import { Google } from '../lib/google.js';
import { createCore } from '../lib/core.js';
import { TOOLS, INSTRUCTIONS } from '../lib/tools.js';
import * as wa from './whatsapp.js';

const SESSION_DAYS = 30;
let ready = false;

// ---------- D1: the task document and the Google token, each stored as one JSON value ----------
const CHUNK = 500000; // D1 values can be large, but keep rows modest
async function readDoc(db, k) {
  const { results } = await db.prepare('SELECT v FROM doc WHERE k = ? ORDER BY part').bind(k).all();
  return results.length ? JSON.parse(results.map((r) => r.v).join('')) : null;
}
function writeDoc(db, k, value) {
  const s = value == null ? '' : JSON.stringify(value);
  const stmts = [db.prepare('DELETE FROM doc WHERE k = ?').bind(k)];
  for (let i = 0, part = 0; i < s.length; i += CHUNK, part++) stmts.push(db.prepare('INSERT INTO doc (k, part, v) VALUES (?, ?, ?)').bind(k, part, s.slice(i, i + CHUNK)));
  return stmts;
}

async function open(env, origin) {
  const [data, token] = await Promise.all([readDoc(env.DB, 'tasks'), readDoc(env.DB, 'google')]);
  const dirty = { data: false, token: false };
  const store = new Store({ data, onSave: () => { dirty.data = true; } });
  const google = new Google({
    clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: `${origin}/oauth/callback`,
    token, onToken: () => { dirty.token = true; }, extraScopes: ['openid', 'email'],
  });
  const core = createCore({ store, google });
  const flush = async () => {
    const stmts = [];
    if (dirty.data) stmts.push(...writeDoc(env.DB, 'tasks', store.data), env.DB.prepare("INSERT OR REPLACE INTO doc (k, part, v) VALUES ('rev', 0, ?)").bind(String(store.data.meta.rev || 0)));
    if (dirty.token) stmts.push(...writeDoc(env.DB, 'google', google.token));
    if (stmts.length) await env.DB.batch(stmts);
    dirty.data = dirty.token = false;
  };
  if (!data) store.save(); // first run on an empty database
  return { store, google, core, flush, dirty };
}

// ---------- sign-in: a signed cookie, issued only after Google confirms it is ALLOWED_EMAIL ----------
const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sign(env, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
function cookies(req) {
  const out = {};
  for (const part of (req.headers.get('cookie') || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
  return out;
}
function safeEqual(a, b) { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }
async function signedIn(req, env) {
  const v = cookies(req).cc_session; if (!v) return false;
  const [exp, mac] = v.split('.');
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  return safeEqual(mac, await sign(env, `session:${exp}`));
}
const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const randomHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');

function json(status, body, headers = {}) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } }); }
function redirect(location, headers = {}) { return new Response(null, { status: 302, headers: { location, ...headers } }); }
function page(status, title, text) {
  return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px system-ui;max-width:420px;margin:15vh auto;padding:0 16px;color:#222"><h2 style="font-weight:600">${title}</h2><p>${text}</p></body>`, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

async function login(req, env, url) {
  const app = await open(env, url.origin);
  const state = randomHex(16);
  const to = app.google.authUrl({ prompt: app.google.connected && !url.searchParams.has('reconnect') ? 'select_account' : 'consent' }) + `&state=${state}&login_hint=${encodeURIComponent(env.ALLOWED_EMAIL || '')}`;
  return redirect(to, { 'set-cookie': cookie('cc_state', state, 600) });
}

async function callback(req, env, url) {
  const state = url.searchParams.get('state');
  if (!state || state !== cookies(req).cc_state) return page(400, 'Sign-in expired', '<a href="/auth/google">Try again</a>.');
  const code = url.searchParams.get('code');
  if (!code) return page(400, 'Sign-in cancelled', '<a href="/auth/google">Try again</a>.');
  const app = await open(env, url.origin);
  const before = app.google.token;
  const j = await app.google.exchange(code);
  let email = '', verified = false;
  try { const p = JSON.parse(atob(j.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); email = p.email || ''; verified = p.email_verified === true || p.email_verified === 'true'; } catch {}
  if (!verified || email.toLowerCase() !== String(env.ALLOWED_EMAIL || '').toLowerCase()) {
    app.google.token = before; app.dirty.token = false; // never keep a stranger's token
    return page(403, 'Not allowed', 'This Command Center belongs to someone else.');
  }
  await app.flush();
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const headers = new Headers({ location: '/' });
  headers.append('set-cookie', cookie('cc_session', `${exp}.${await sign(env, `session:${exp}`)}`, SESSION_DAYS * 86400));
  headers.append('set-cookie', cookie('cc_state', '', 0));
  return new Response(null, { status: 302, headers });
}

// ---------- Claude connector: MCP over HTTP (JSON responses, no streaming needed) ----------
async function mcp(req, env, url) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: 'POST, GET, OPTIONS' } });
  if (req.method !== 'POST') return new Response('Command Center connector is running. Claude talks to it with POST.', { status: 405, headers: { allow: 'POST' } });
  let msg; try { msg = await req.json(); } catch { return json(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  const one = async (m) => {
    if (m.id === undefined) return null; // notification
    const ok = (result) => ({ jsonrpc: '2.0', id: m.id, result });
    try {
      if (m.method === 'initialize') return ok({ protocolVersion: (m.params && m.params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'command-center', version: '2.3.0' }, instructions: INSTRUCTIONS + wa.WA_INSTRUCTIONS });
      if (m.method === 'ping') return ok({});
      if (m.method === 'tools/list') return ok({ tools: [...TOOLS.map(({ op, ...t }) => t), ...wa.WA_TOOLS] });
      if (m.method === 'tools/call') {
        if (wa.WA_TOOLS.some((t) => t.name === m.params.name)) {
          const r = await wa.callTool(env, m.params.name, m.params.arguments || {});
          return ok({ content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], isError: r.ok === false });
        }
        const tool = TOOLS.find((t) => t.name === m.params.name);
        if (!tool) throw new Error(`Unknown tool ${m.params.name}`);
        const app = await open(env, url.origin);
        const [r] = await app.core.runOps([{ op: tool.op, ...(m.params.arguments || {}), source: 'claude' }]);
        await app.flush();
        return ok({ content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], isError: r.ok === false });
      }
      return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `No method ${m.method}` } };
    } catch (e) { return { jsonrpc: '2.0', id: m.id, error: { code: -32000, message: e.message } }; }
  };
  if (Array.isArray(msg)) { const out = (await Promise.all(msg.map(one))).filter(Boolean); return out.length ? json(200, out) : new Response(null, { status: 202 }); }
  const out = await one(msg);
  return out ? json(200, out) : new Response(null, { status: 202 });
}

// ---------- router ----------
const PUBLIC_FILES = new Set(['/manifest.webmanifest', '/sw.js', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png']);
export default {
  async fetch(req, env) {
    if (!ready) { installZonedDate(env.TZ || 'America/New_York'); ready = true; }
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      // Connector clients probe these for OAuth; this server has none, so answer plainly instead of redirecting to Google.
      if (p.startsWith('/.well-known/')) return json(404, { error: 'Not found' });
      if (p.startsWith('/mcp/')) {
        if (!env.MCP_KEY || !safeEqual(p, `/mcp/${env.MCP_KEY}`)) return new Response('Not found', { status: 404 });
        return await mcp(req, env, url);
      }
      if (p.startsWith('/wa/')) { // WhatsApp sync from the owner's PC
        if (!env.WA_KEY || !safeEqual(p, `/wa/${env.WA_KEY}`)) return new Response('Not found', { status: 404 });
        return await wa.syncEndpoint(req, env);
      }
      if (p === '/auth/google' || p === '/login') return await login(req, env, url);
      if (p === '/oauth/callback') return await callback(req, env, url);
      if (p === '/logout') return redirect('/signed-out', { 'set-cookie': cookie('cc_session', '', 0) });
      if (p === '/signed-out') return page(200, 'Signed out', '<a href="/auth/google">Sign in again</a>.');

      // App-install files (manifest, icons, service worker) load without the sign-in cookie, so they must stay public.
      if (PUBLIC_FILES.has(p)) return env.ASSETS.fetch(req);

      if (!(await signedIn(req, env))) {
        if (p.startsWith('/api/')) return json(401, { error: 'Sign in', code: 'SIGN_IN' });
        return redirect('/auth/google');
      }

      if (p === '/api/rev') {
        const r = await env.DB.prepare("SELECT v FROM doc WHERE k = 'rev'").first();
        return json(200, { rev: Number(r ? r.v : 0) });
      }
      if (p === '/api/whatsapp' || p.startsWith('/api/whatsapp/')) { const r = await wa.api(req, env, url); return json(r.status, r.body); }
      if (p.startsWith('/api/')) {
        const app = await open(env, url.origin);
        let body = null;
        if (req.method !== 'GET' && req.method !== 'HEAD') { const t = await req.text(); body = t ? JSON.parse(t) : {}; }
        try {
          const r = await app.core.api(req.method, url, body);
          await app.flush();
          return json(r.status, r.body);
        } catch (e) {
          await app.flush(); // keep a cleared Google token, if that is what failed
          return json(e.code === 'NO_GOOGLE' ? 401 : 500, { error: e.message, code: e.code || null });
        }
      }
      return env.ASSETS.fetch(req);
    } catch (e) {
      return json(500, { error: e.message });
    }
  },
};
