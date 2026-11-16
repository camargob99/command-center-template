#!/usr/bin/env node
// Command Center from the command line. Examples:
//   node cc.js add "Look into WhatsApp MCP mon #Side Projects"
//   node cc.js list today            node cc.js list "Work"
//   node cc.js done "WhatsApp"       node cc.js delete <id>
//   node cc.js move "WhatsApp" fri   (new due date: YYYY-MM-DD or today/tomorrow/mon..sun)
//   node cc.js ops '[{"op":"update","match":"WhatsApp","duration":30}]'
const { run } = require('./lib/client');

const [cmd, ...rest] = process.argv.slice(2);
const arg = rest.join(' ').trim();
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function toDate(s) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(); const w = s.toLowerCase().slice(0, 3);
  if (w === 'tom') d.setDate(d.getDate() + 1);
  else if (DAYS.includes(w)) { do d.setDate(d.getDate() + 1); while (DAYS[d.getDay()] !== w); }
  else if (w !== 'tod') throw new Error(`Can't read date "${s}"`);
  return d.toLocaleDateString('en-CA');
}
const target = (s) => (/^[0-9a-f]{12}$/.test(s) ? { id: s } : { match: s });

(async () => {
  let ops;
  if (cmd === 'add') ops = [{ op: 'add', text: arg }];
  else if (cmd === 'list') ops = [arg === 'today' || arg === 'overdue' ? { op: 'list', when: arg } : arg ? { op: 'list', project: arg } : { op: 'list' }];
  else if (cmd === 'projects') ops = [{ op: 'projects' }];
  else if (cmd === 'done') ops = [{ op: 'complete', ...target(arg) }];
  else if (cmd === 'delete') ops = [{ op: 'delete', ...target(arg) }];
  else if (cmd === 'move') { const when = rest.pop(); ops = [{ op: 'update', ...target(rest.join(' ')), due: toDate(when) }]; }
  else if (cmd === 'ops') ops = JSON.parse(arg);
  else { console.log('Usage: node cc.js add|list|projects|done|delete|move|ops ...  (see the top of cc.js)'); process.exit(1); }
  const res = await run(Array.isArray(ops) ? ops : [ops]);
  console.log(JSON.stringify(res.length === 1 ? res[0] : res, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
