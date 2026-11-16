// One-time cloud setup (safe to run again). Run from the command-center folder: setup-cloud.bat
// Logs in to Cloudflare, creates the database, copies your tasks up, stores the secrets and deploys.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const TOML = path.join(HERE, 'wrangler.toml');
const WR = 'wrangler@4';
const args = process.argv.slice(2);

const say = (s) => console.log(`\n== ${s}`);
const stop = (s) => { console.error(`\nStopped: ${s}`); process.exit(1); };
function wr(cmd, { capture = false, input } = {}) {
  const r = spawnSync(`npx --yes ${WR} ${cmd}`, { cwd: HERE, shell: true, encoding: 'utf8', input, stdio: capture || input ? ['pipe', 'pipe', 'inherit'] : 'inherit' });
  if (r.status !== 0 && !capture) stop(`wrangler ${cmd.split(' ')[0]} failed (see above).`);
  return r;
}

const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 12)) stop(`Node ${process.versions.node} is too old for Cloudflare's tool. Install the LTS version from https://nodejs.org, then run this again.`);

// 1. Cloudflare login
say('Cloudflare login');
const who = wr('whoami', { capture: true });
if (!/associated with the email|You are logged in/i.test(who.stdout || '')) {
  console.log('A browser window will open. Click Allow.');
  wr('login');
}

// 2. Database
say('Database');
let toml = fs.readFileSync(TOML, 'utf8');
const findDb = () => { const r = wr('d1 list --json', { capture: true }); try { return JSON.parse(r.stdout).find((d) => d.name === 'command-center'); } catch { return null; } };
let db = findDb();
const fresh = !db;
if (!db) { wr('d1 create command-center', { capture: true }); db = findDb(); }
if (!db) stop('Could not create the database.');
toml = toml.replace(/database_id = ".*"/, `database_id = "${db.uuid}"`);

let email = (toml.match(/ALLOWED_EMAIL = "(.*)"/) || [])[1];
if (!email) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  email = (await rl.question('Your Google email (the account with your calendar): ')).trim();
  rl.close();
  toml = toml.replace(/ALLOWED_EMAIL = ".*"/, `ALLOWED_EMAIL = "${email}"`);
}
fs.writeFileSync(TOML, toml);
wr('d1 execute command-center --remote --yes --file schema.sql');

// 3. Copy tasks up (first time only, or with --reimport)
const tasksFile = path.join(ROOT, 'data', 'tasks.json');
const has = wr(`d1 execute command-center --remote --json --command "SELECT COUNT(*) AS n FROM doc WHERE k = 'tasks'"`, { capture: true });
let n = 0; try { n = JSON.parse(has.stdout)[0].results[0].n; } catch {}
if ((n === 0 || args.includes('--reimport')) && fs.existsSync(tasksFile)) {
  say('Copying your tasks');
  const data = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
  const s = JSON.stringify(data);
  const q = (x) => `'${x.replace(/'/g, "''")}'`;
  const lines = ["DELETE FROM doc WHERE k IN ('tasks', 'rev');"];
  for (let i = 0, part = 0; i < s.length; i += 40000, part++) lines.push(`INSERT INTO doc (k, part, v) VALUES ('tasks', ${part}, ${q(s.slice(i, i + 40000))});`);
  lines.push(`INSERT INTO doc (k, part, v) VALUES ('rev', 0, '${(data.meta && data.meta.rev) || 0}');`);
  const tmp = path.join(HERE, '.import.sql');
  fs.writeFileSync(tmp, lines.join('\n'));
  wr('d1 execute command-center --remote --yes --file .import.sql');
  fs.rmSync(tmp);
  console.log(`Copied ${data.tasks.filter((t) => !t.completedAt).length} open tasks and ${data.projects.length} projects.`);
} else if (fresh) console.log('No local tasks found; starting empty.');
else console.log('Tasks are already in the cloud (run with --reimport to overwrite them with this PC\'s copy).');

// 4. Deploy, then secrets
say('Deploying');
wr('deploy');

say('Secrets');
const keep = path.join(HERE, '.secrets.json'); // reused on later runs so the connector URL and sign-in stay the same
const mine = fs.existsSync(keep) ? JSON.parse(fs.readFileSync(keep, 'utf8')) : { SESSION_SECRET: crypto.randomBytes(32).toString('hex'), MCP_KEY: crypto.randomBytes(24).toString('hex') };
if (!mine.WA_KEY) mine.WA_KEY = crypto.randomBytes(24).toString('hex'); // WhatsApp sync from this PC
fs.writeFileSync(keep, JSON.stringify(mine, null, 2));
const gfile = path.join(HERE, 'google-web-client.json');
if (!fs.existsSync(gfile)) stop('cloud\\google-web-client.json is missing (the Google OAuth Web client file).');
const g = JSON.parse(fs.readFileSync(gfile, 'utf8')).web;
const tmpS = path.join(HERE, '.secrets-upload.json');
fs.writeFileSync(tmpS, JSON.stringify({ ...mine, GOOGLE_CLIENT_ID: g.client_id, GOOGLE_CLIENT_SECRET: g.client_secret }));
try { wr('secret bulk .secrets-upload.json'); } finally { fs.rmSync(tmpS, { force: true }); }

// 5. Done
const sub = (toml.match(/^# subdomain: (\S+)/m) || [])[1] || '<your-subdomain>.workers.dev';
const base = `https://command-center.${sub}`;
const urlFile = path.join(HERE, 'your-links.txt');
fs.writeFileSync(urlFile, `Dashboard: ${base}\nClaude connector URL (keep private): ${base}/mcp/${mine.MCP_KEY}\nWhatsApp sync URL (keep private): ${base}/wa/${mine.WA_KEY}\n`);
say('Done');
console.log(fs.readFileSync(urlFile, 'utf8'));
console.log(`(Saved in ${urlFile})`);
