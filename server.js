// Command Center: local task + calendar dashboard. Run: node server.js  (or start.bat on Windows)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Store, COLORS } = require('./lib/store');
const { createCore } = require('./lib/core');
const { Google } = require('./lib/google');
const { DemoGoogle, seedTasks } = require('./lib/demo');
const { importTodoist } = require('./lib/importer');

const DEMO = process.argv.includes('--demo') || process.env.CC_DEMO === '1';
const ROOT = __dirname;
const DATA = process.env.CC_DATA || path.join(ROOT, DEMO ? 'demo-data' : 'data');
const PORT = Number(process.env.PORT || 4321);
const HOST = '127.0.0.1'; // only reachable from this PC

const config = fs.existsSync(path.join(ROOT, 'config.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')) : {};

if (DEMO && fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const store = new Store(path.join(DATA, 'tasks.json'));
const google = DEMO ? new DemoGoogle() : new Google({
  clientId: config.google && config.google.clientId,
  clientSecret: config.google && config.google.clientSecret,
  tokenFile: path.join(DATA, 'google-token.json'),
  redirectUri: `http://localhost:${PORT}/oauth/callback`,
});

if (DEMO && store.tasks.length === 0) seedTasks(store);
// First run: import the Todoist snapshot if one is waiting.
const importFile = path.join(ROOT, 'todoist-import.json');
if (!DEMO && !store.data.meta.importedFromTodoist && fs.existsSync(importFile)) {
  const n = importTodoist(store, JSON.parse(fs.readFileSync(importFile, 'utf8')));
  console.log(`Imported ${n.tasks} tasks and ${n.projects} projects from Todoist.`);
}

const core = createCore({ store, google, demo: DEMO });
const { runOps, recolorOldBlocks } = core;

const STATIC = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = ''; req.on('data', (c) => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  });
}

// Drop folder: any Claude with access to this folder can write a .json file of ops into claude-inbox/.
// It runs within a few seconds (or at the next start), then moves to claude-inbox/done/ with the results.
const DROP = process.env.CC_DROP || path.join(DEMO ? DATA : ROOT, 'claude-inbox');
let dropBusy = false;
async function scanDrop() {
  if (dropBusy) return; dropBusy = true;
  try {
    fs.mkdirSync(path.join(DROP, 'done'), { recursive: true });
    for (const f of fs.readdirSync(DROP).filter((x) => x.endsWith('.json')).sort()) {
      const src = path.join(DROP, f);
      let out;
      try {
        const raw = JSON.parse(fs.readFileSync(src, 'utf8').replace(/^﻿/, ''));
        const ops = Array.isArray(raw) ? raw : Array.isArray(raw.ops) ? raw.ops : [raw];
        out = { at: new Date().toISOString(), ops, results: await runOps(ops) };
      } catch (e) { out = { at: new Date().toISOString(), error: `Could not read ${f}: ${e.message}` }; }
      fs.writeFileSync(path.join(DROP, 'done', f), JSON.stringify(out, null, 2));
      fs.rmSync(src, { force: true });
      console.log(`claude-inbox: ran ${f}`);
    }
  } catch (e) { console.error('claude-inbox:', e.message); }
  dropBusy = false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) { const r = await core.api(req.method, url, req.method === 'GET' ? null : await readBody(req)); return send(res, r.status, r.body); }
    if (url.pathname === '/auth/google') {
      if (!google.configured) { res.writeHead(302, { location: '/?setup=google' }); return res.end(); }
      res.writeHead(302, { location: google.authUrl() }); return res.end();
    }
    if (url.pathname === '/oauth/callback') {
      const code = url.searchParams.get('code');
      if (code) await google.exchange(code);
      recolorOldBlocks().catch(() => {});
      res.writeHead(302, { location: '/' }); return res.end();
    }
    const file = path.join(ROOT, 'public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([/\\])+/, ''));
    if (!file.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': STATIC[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    send(res, e.code === 'NO_GOOGLE' ? 401 : 500, { error: e.message, code: e.code || null });
  }
});

server.listen(PORT, HOST, () => {
  recolorOldBlocks().catch(() => {});
  scanDrop(); setInterval(scanDrop, 3000);
  console.log(`\n  Command Center${DEMO ? ' (demo mode)' : ''} is running: http://localhost:${PORT}\n`);
});

module.exports = { COLORS };
