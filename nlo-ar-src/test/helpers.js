/* Shared by the browser tests: serve the Firebase SDK and fonts locally (no network), and collect page errors. */
const path = require('path');
const fs = require('fs');
/* the page checks the SDK files' integrity, so the tests serve Google's exact files (fetched once into test/vendor/) */
const SDK = path.join(__dirname, 'vendor', 'firebasejs-10.12.2');
function sdkFile(name) {
  const f = path.join(SDK, name);
  if (!fs.existsSync(f)) { fs.mkdirSync(SDK, { recursive: true }); require('child_process').execFileSync('curl', ['-sf', '-o', f, 'https://www.gstatic.com/firebasejs/10.12.2/' + name]); }
  return fs.readFileSync(f);
}
async function routes(ctx) {
  await ctx.route('https://www.gstatic.com/firebasejs/10.12.2/*', r => {
    const name = path.basename(new URL(r.request().url()).pathname);
    r.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: sdkFile(name) });
  });
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route('https://fonts.gstatic.com/**', r => r.fulfill({ status: 404, body: '' }));
  // AISA (the weekly brief): a made-up answer, and what was asked kept for the test to look at
  await ctx.route('https://aisa-worker.akhavan-ak.workers.dev/**', r => {
    const req = r.request(); if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
    let q = ''; try { q = JSON.parse(req.postData() || '{}').question || ''; } catch (e) { }
    (ctx.aisaAsked = ctx.aisaAsked || []).push(q);
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ answer: 'Past due is up a little this week.\n\n**Top 3 this week:**\n1. **Collections (§14):** send the letters due.\n2. Call the slowest carrier.\n3. Review the oldest credits.', sources: [] }) });
  });
}
function watch(page, errs, label) {
  page.on('pageerror', e => errs.push(label + ' pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(label + ' console: ' + m.text()); });
}
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
/* a made-up OrthoBanc "Failed Transaction Report" as Excel's tab-separated text, laid out like the real export (see
   make_ob_fixture.py): rows are { ref, acct, patient: 'Last, First', rp, amt, why, when: 'MM/DD/YYYY', how, bal } */
function obReportTSV(longDate, hold, other) {
  const lines = [], put = (cells) => { const a = []; Object.keys(cells).forEach(c => { a[c] = cells[c]; }); lines.push(Array.from(a, v => v == null ? '' : String(v)).join('\t')); };
  const blank = () => lines.push('');
  put({ 0: 'OrthoBanc' }); blank(); put({ 0: 'Failed Transaction Report' }); put({ 0: 'For Next Level Orthodontics ' }); blank(); put({ 0: longDate }); blank(); blank();
  const section = (title, rows) => {
    put({ 1: title }); blank(); put({ 1: 'The following patient(s)/responsible(s) have payment transactions that failed. (Made-up wording.)' }); blank(); blank();
    put({ 1: 'Status *', 5: 'OB Reference #', 11: 'Your Acct #', 14: 'Patient Name', 19: 'Responsible Name', 24: 'Amt/Balance' }); blank(); blank(); blank(); blank();
    rows.forEach(r => { put({ 1: 'FAIL', 5: r.ref, 10: r.acct, 14: r.patient, 19: r.rp, 23: r.amt.toFixed(2) }); blank(); put({ 2: 'Return Reason: ', 7: r.why, 17: r.when + ' ' + (r.how || 'Pmt'), 23: r.bal.toFixed(2) }); blank(); blank(); blank(); });
  };
  section('** Action On Your Part Is Needed **', hold); blank(); section('** No Action Required On Your Part **', other);
  return lines.join('\r\n');
}
/* a made-up Edge "Insurance Accounts Receivable Aging" as Excel's tab-separated text, laid out like the real export (see
   make_ins_fixture.py): groups are { line: the carrier line as Edge prints it ("Name   -   phone" or just the name),
   rows: [{ patient, acct, sts, rp ('INS: …'), home, due, b0, b30, b60, b90, days, bal, lastAmt, recv: 'M/D/YYYY' }] } */
function insAgingTSV(longDate, groups) {
  const lines = [], put = cells => { const a = []; Object.keys(cells).forEach(c => { a[c] = cells[c]; }); lines.push(Array.from(a, v => v == null ? '' : String(v)).join('\t')); };
  const m = v => (v < 0 ? '-' : '') + Math.abs(v).toFixed(2), tot = { n: 0, due: 0, b0: 0, b30: 0, b60: 0, b90: 0, bal: 0 };
  put({ 0: 'Insurance Accounts Receivable Aging', 13: '10/6/2026 9:12 AM' }); put({ 0: 'Insurance Accounts Receivable Aging' }); put({ 0: longDate + '  Office: All,  Doctor: All' });
  put({ 0: 'Exclude Zero Dollar Balances' }); put({ 0: 'Subgroup: None' }); lines.push(''); lines.push('');
  put({ 0: 'Patient', 1: 'ID', 3: 'Sts', 4: 'Responsible Party', 5: 'Home  Ph', 6: 'Amt Due', 7: '0-30', 8: '31-60', 9: '61-90', 10: '91+', 12: 'Days', 14: 'Balance', 16: 'Last Amt', 17: 'Recieved' });
  groups.forEach(g => {
    put({ 0: g.line });
    g.rows.forEach(r => {
      put({ 0: r.patient, 1: r.acct, 3: r.sts, 4: r.rp, 5: r.home || '', 6: m(r.due), 7: m(r.b0), 8: m(r.b30), 9: m(r.b60), 10: m(r.b90), 12: String(r.days == null ? 0 : r.days), 14: m(r.bal), 16: r.lastAmt == null ? '' : m(r.lastAmt), 17: r.recv || '' });
      tot.n++; ['due', 'b0', 'b30', 'b60', 'b90', 'bal'].forEach(k => { tot[k] += r[k]; });
    });
    put({ 0: '(' + g.rows.length + ' Patients)' });
  });
  put({ 0: '(' + tot.n + ' Total Patients)', 6: m(tot.due), 7: m(tot.b0), 8: m(tot.b30), 9: m(tot.b60), 10: m(tot.b90), 14: m(tot.bal) }); lines.push(''); put({ 0: 'Edge v8.0.22.1003' });
  return lines.join('\r\n');
}
/* a made-up Edge "Upcoming and Overdue Tasks" list as Excel's tab-separated text, laid out like the real export (see
   make_tasks_fixture.py): run: 'M/D/YYYY h:mm AM'; groups are { op: the operator, tasks: [{ title, due: 'M/D/YYYY', desc }] }
   (a description may run over several lines) */
function edgeTasksTSV(run, groups) {
  const lines = [], put = cells => { const a = []; Object.keys(cells).forEach(c => { a[c] = cells[c]; }); lines.push(Array.from(a, v => v == null ? '' : String(v)).join('\t')); };
  const q = s => (/[\t\n"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  put({ 0: 'Upcoming and Overdue Tasks', 9: run }); for (let i = 0; i < 5; i++) lines.push('');
  put({ 0: 'Operator' }); put({ 0: 'Task', 3: 'Due Date', 5: 'Category', 6: 'Creator', 7: 'Description' });
  groups.forEach(g => {
    put({ 0: g.op });
    g.tasks.forEach(t => put(Object.assign({ 0: q(t.title), 3: t.due + ' 8:00 AM', 6: g.op }, t.desc ? { 7: q(t.desc) } : {})));
  });
  lines.push(''); put({ 0: 'Edge v8.0.22.1003' });
  return lines.join('\r\n');
}
module.exports = { routes, watch, CHROME, obReportTSV, insAgingTSV, edgeTasksTSV };
