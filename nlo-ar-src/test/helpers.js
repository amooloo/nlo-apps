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
module.exports = { routes, watch, CHROME, obReportTSV };
