// Talks to a running Command Center. If it isn't running, writes go to claude-inbox/ and run at the next start.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 4321);

function post(ops) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ ops });
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/ops', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 15000 }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; });
      res.on('end', () => { try { resolve(JSON.parse(s).results); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(body);
  });
}

const READS = new Set(['list', 'projects']);

// Read straight from the data file when the app is off.
function offlineRead(o) {
  const file = path.join(ROOT, 'data', 'tasks.json');
  if (!fs.existsSync(file)) return { ok: false, error: 'Command Center has no data yet. Run start.bat once.' };
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pname = (id) => (d.projects.find((p) => p.id === id) || { name: 'Inbox' }).name;
  if (o.op === 'projects') return { ok: true, projects: d.projects.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name, sections: p.sections.map((s) => s.name) })) };
  let ts = d.tasks.filter((t) => (o.done ? t.completedAt : !t.completedAt));
  if (o.project) ts = ts.filter((t) => pname(t.projectId).toLowerCase() === String(o.project).toLowerCase());
  if (o.match) ts = ts.filter((t) => t.content.toLowerCase().includes(String(o.match).toLowerCase()));
  const today = new Date().toLocaleDateString('en-CA');
  if (o.when === 'today') ts = ts.filter((t) => t.now || (t.due && t.due.date <= today));
  if (o.when === 'overdue') ts = ts.filter((t) => t.due && t.due.date < today);
  return { ok: true, offline: true, count: ts.length, tasks: ts.slice(0, o.limit || 200).map((t) => ({ id: t.id, content: t.content, project: pname(t.projectId), due: t.due, starred: Boolean(t.now), scheduled: t.event ? { start: t.event.start, end: t.event.end } : null })) };
}

async function run(ops) {
  try { return await post(ops); } catch (e) {
    if (!/ECONNREFUSED|ECONNRESET|timeout/.test(e.code || e.message)) throw e;
    const writes = ops.filter((o) => !READS.has(o.op));
    if (writes.length) {
      const dir = path.join(ROOT, 'claude-inbox'); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${Date.now()}-cli.json`), JSON.stringify(writes, null, 2));
    }
    return ops.map((o) => (READS.has(o.op) ? offlineRead(o) : { ok: true, queued: true, op: o.op, note: 'Command Center is not running; this runs the next time it starts.' }));
  }
}

module.exports = { run };
