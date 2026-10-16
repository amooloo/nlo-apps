/* Runs the alert script exactly as Dr. A copied it from the page (Inventory → Settings → Email alerts → Get the alert script)
   with the Apps Script stand-ins: setup(), then prints what happened as JSON.   node test/run_script.js <script.gs> <mailbox> */
const fs = require('fs');
const { load } = require('./gas_fakes');
const [file, box] = process.argv.slice(2);
const text = fs.readFileSync(file, 'utf8');
if (!/var CONFIG = \{.*?\};/.test(text)) { console.log(JSON.stringify({ error: 'no CONFIG in the script' })); process.exit(1); }
const sv = load(undefined, box || 'dr.test@example.com', { off: 0 }, text);
let result = '', error = '';
try { result = sv.run('setup()'); } catch (e) { error = e.message; }
console.log(JSON.stringify({ result, error, mail: sv.mail, triggers: sv.triggers, logs: sv.logs }));
