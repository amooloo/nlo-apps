/* Runs an alert script exactly as Dr. A copied it from the page (Time Clock → Alerts → Get the script) with the Apps Script
   stand-ins: setup(), then prints what happened as JSON. Its pushes go to NTFY (a local stand-in), never to ntfy.sh.
     node test/run_script.js <script.gs> <mailbox> [ntfyBase] */
const fs = require('fs');
const { load } = require('./gas_fakes');
const [file, box, ntfy] = process.argv.slice(2);
let text = fs.readFileSync(file, 'utf8');
const m = /var CONFIG = (\{.*?\});/.exec(text);
if (!m) { console.log(JSON.stringify({ error: 'no CONFIG in the script' })); process.exit(1); }
const cfg = JSON.parse(m[1]);
if (ntfy) cfg.ntfyBase = ntfy;
text = text.replace(m[0], 'var CONFIG = ' + JSON.stringify(cfg) + ';');
const sv = load(undefined, box || 'records@example.com', { off: 0 }, text);
let result = '', error = '';
try { result = sv.run('setup()'); } catch (e) { error = e.message; }
console.log(JSON.stringify({ cfg: { botEmail: cfg.botEmail, projectId: cfg.projectId }, result, error, mail: sv.mail, triggers: sv.triggers, logs: sv.logs }));
