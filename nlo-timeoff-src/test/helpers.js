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
}
function watch(page, errs, label) {
  page.on('pageerror', e => errs.push(label + ' pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(label + ' console: ' + m.text()); });
}
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
module.exports = { routes, watch, CHROME };
