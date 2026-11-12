const path = require('path');
const fs = require('fs');
const SDK = path.join(__dirname, '..', 'node_modules', 'firebase10');
async function routes(ctx) {
  await ctx.route('https://www.gstatic.com/firebasejs/10.12.2/*', r => {
    const f = path.join(SDK, path.basename(new URL(r.request().url()).pathname));
    r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) });
  });
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route('https://fonts.gstatic.com/**', r => r.fulfill({ status: 404, body: '' }));
}
function watch(page, errs, label) {
  page.on('pageerror', e => errs.push(label + ' pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(label + ' console: ' + m.text()); });
}
module.exports = { routes, watch };
