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
/* the case panel folds every section by default (3 Oct 2026); tests written against the open panel start with
   "Expand all" remembered, the way an office computer would after someone tapped it */
async function panelsOpen(ctx) { await ctx.addInitScript(() => { try { localStorage.setItem('nloCases.panelOpen', 'all'); } catch (e) { } }); }
/* New case is in steps now (Patient > Case > Lab Rx > Scan & dates > Instructions > Review — 6 Oct 2026). For tests written
   against the one-page form: before one touches a field of the form, its step is shown (wizGo — no checks: Create case checks
   every step anyway), and clicking Create case (#ncSave) goes Next through the steps first, stopping where a step says what's
   missing (the test then reads #ncErr, as before). The chart # is required now: a case entered without one gets the chart # of
   a case already in with that name, else one made from the name — so the same name is still the same patient. */
function stepsAsOnePage(p) {
  const formSel = sel => typeof sel === 'string' && sel !== '#ncSave';
  // (Playwright's own bits — :has-text(…), >> nth=… — taken off: the element's step is what matters)
  const base = sel => String(sel).split('>>')[0].replace(/:has-text\((?:"[^"]*"|'[^']*'|[^)]*)\)/g, '').replace(/:text\((?:"[^"]*"|'[^']*'|[^)]*)\)/g, '').trim();
  const show = sel => p.evaluate(sel => { try { if (!document.querySelector('.cf.wiz')) return; const el = document.querySelector(sel), root = el && el.closest('#modalWrap, #drawer'), sec = el && el.closest('.cf > [data-step]');
    if (root && root._wiz && sec && sec.classList.contains('wizOff')) wizGo(root, sec.dataset.step); } catch (e) { } }, base(sel)).catch(() => { });
  const orig = {};
  ['click', 'fill', 'check', 'uncheck', 'selectOption', 'type', 'press', 'isVisible', 'isChecked', 'isDisabled', 'isEnabled', 'focus', 'hover', 'dblclick', 'setInputFiles', 'textContent', 'innerText', 'getAttribute', 'waitForSelector'].forEach(m => {
    orig[m] = p[m].bind(p);
    p[m] = async (sel, ...rest) => {
      if (m === 'click' && sel === '#ncSave') return ncSave();
      if (formSel(sel) && !(m === 'waitForSelector' && rest[0] && /detached|hidden/.test(rest[0].state || ''))) await show(sel);
      // "More: what's being made…" opens by itself on the Review step: a test's tap to open it would close it again
      if (m === 'click' && typeof sel === 'string' && /details\.cfMore summary$/.test(sel) && await p.evaluate(s2 => { const d = document.querySelector(s2.replace(/ summary$/, '')); return !!(d && d.open && d.closest('.cf.wiz')); }, sel).catch(() => false)) return;
      return orig[m](sel, ...rest);
    };
  });
  async function ncSave() {
    if (!(await orig.isVisible('#ncForm'))) return orig.click('#ncSave');
    const chart = await p.evaluate(() => {
      const n = ((document.querySelector('#ncForm #cf-patient') || {}).value || '').trim(), c = document.querySelector('#ncForm #cf-chart');
      if (!n || !c || c.value.trim()) return '';
      const all = Array.from(S.cases.values()).concat(S.closed || [], S.hist || []), hit = all.find(x => x && x.chart && normName(x.patient) === normName(n));
      if (hit) return hit.chart; let h = 7; for (const ch of n.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 99991; return 'T-' + h;
    });
    if (chart) { await show('#ncForm #cf-chart'); await orig.fill('#ncForm #cf-chart', chart); }
    for (let i = 0; i < 9; i++) {
      if (await orig.isVisible('#ncSave')) break;
      await orig.click('#ncNext'); await p.waitForTimeout(50); // (a step that goes on clears an earlier message)
      if (((await orig.textContent('#ncErr').catch(() => '')) || '').trim()) return; // this step says what's missing
    }
    if (await orig.isVisible('#ncSave')) return orig.click('#ncSave');
  }
  return p;
}
module.exports = { routes, watch, panelsOpen, stepsAsOnePage };
