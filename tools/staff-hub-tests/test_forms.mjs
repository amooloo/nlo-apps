// End-to-end checks of Staff Hub's staff forms (31 Oct 2026: the employer's forms filled out for someone on staff —
// write-ups, pay/status changes, leave and accommodation letters, the leaving paperwork, the new-hire additions) on the
// Firebase emulators — a made-up office, nothing live. Same setup as test_login.mjs (README.md); run after starting the
// emulators and serving the page:   NO_PROXY=localhost,127.0.0.1 node test_forms.mjs
import fs from 'node:fs';
import * as E from './seed.mjs';
const { chromium } = await import('playwright');

const BASE = process.env.SH_BASE || 'http://127.0.0.1:8765/';
const PAGE = BASE + 'nlo-staff-hub.html', OLD = BASE + 'nlo-staff-hub-old.html';
const SDK = process.env.FIREBASE_SDK_DIR || new URL('./node_modules/firebase/', import.meta.url).pathname;
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const fails = [];
function ok(cond, what) { if (cond) { pass++; console.log('  ok  ' + what); } else { fail++; fails.push(what); console.log('  FAIL ' + what); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const WIRE = `(() => {
  let fb;
  Object.defineProperty(window, 'firebase', { configurable: true, get() { return fb; }, set(v) {
    fb = v;
    if (v && v.initializeApp && !v.__emu) {
      const orig = v.initializeApp.bind(v);
      v.initializeApp = function (cfg, name) {
        const app = orig(cfg, name);
        try { app.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true }); } catch (e) { console.warn('emu auth', e); }
        if (cfg && cfg.databaseURL) { try { app.database().useEmulator('127.0.0.1', 9000); } catch (e) { console.warn('emu db', e); } }
        else { try { app.firestore().useEmulator('127.0.0.1', 8080); } catch (e) { console.warn('emu fs', e); } }
        return app;
      };
      v.__emu = true;
    }
  } });
})();`;
/* printing: the page's own print pipeline runs; window.print only records what would print */
const PRINT = `window.__prints = []; window.print = function () {
  const pa = document.getElementById('printArea');
  window.__prints.push({ html: pa ? pa.innerHTML : '', title: document.title });
  setTimeout(() => window.dispatchEvent(new Event('afterprint')), 0);
};`;
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const errors = [];
function watch(page, tag) {
  page.on('pageerror', e => { errors.push(tag + ': ' + String(e && e.stack || e)); console.log('  PAGEERROR', tag, String(e).slice(0, 300)); });
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::|Failed to load resource|ERR_BLOCKED|identitytoolkit|valid digest in the 'integrity'/.test(m.text())) { errors.push(tag + ': ' + m.text()); console.log('  console.error', tag, m.text().slice(0, 300)); } });
}
async function device(opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 }, acceptDownloads: true }, opts));
  await ctx.addInitScript(WIRE);
  await ctx.addInitScript(PRINT);
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost')) return route.continue();
    const m = /gstatic\.com\/firebasejs\/10\.12\.2\/(firebase-[a-z-]+\.js)/.exec(u);
    if (m) return route.fulfill({ path: SDK + m[1], contentType: 'text/javascript' });
    return route.abort();
  });
  const page = await ctx.newPage(); watch(page, 'page');
  return { ctx, page };
}
const isApp = () => typeof S !== 'undefined' && !!S && document.getElementById('app').style.display === 'flex';
async function outcome(p, ms = 45000) {
  await p.waitForFunction(() => (typeof S !== 'undefined' && !!S && document.getElementById('app').style.display === 'flex') ||
    (typeof NC !== 'undefined' && !NC.busy && !!document.querySelector('#authCard form') && !document.querySelector('#ncGo[disabled]')), null, { timeout: ms });
  return p.evaluate(() => (typeof S !== 'undefined' && !!S && document.getElementById('app').style.display === 'flex') ? 'app' : NC.mode);
}
async function signIn(p, user, pw) {
  await p.waitForSelector('#ncLoginForm', { timeout: 20000 });
  await p.fill('#ncUser', user); await p.fill('#ncPw', pw);
  await p.click('#ncGo');
  return outcome(p);
}
async function synced(p, ms = 25000) { try { await p.waitForFunction(() => typeof syncState !== 'undefined' && syncState === 'synced' && !fbWriteInFlight && !shDirty(), null, { timeout: ms }); return true; } catch { return false; } }
async function hubRecord(uid, pw) {
  const d = await E.fsGet('nlo-staff-hub', 'staffhub/' + uid);
  if (!d) return null;
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: Buffer.from(d.kdf.salt, 'base64'), iterations: d.kdf.iter || 600000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  let st = null;
  try { st = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(d.data.iv, 'base64') }, key, Buffer.from(d.data.ct, 'base64')))); } catch { }
  return { raw: d, st };
}
const toast = p => p.evaluate(() => document.getElementById('toasts').textContent);
async function waitToast(p, re, ms = 30000) { try { await p.waitForFunction(r => new RegExp(r).test(document.getElementById('toasts').textContent), re.source, { timeout: ms }); return true; } catch { return false; } }
const noScrollX = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const prints = p => p.evaluate(() => window.__prints.length);
async function printed(p, before, ms = 15000) {
  await p.waitForFunction(n => window.__prints.length > n, before, { timeout: ms });
  return p.evaluate(() => window.__prints[window.__prints.length - 1]);
}
const text = html => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const LEFT = /\{[a-z0-9_:=|-]+\}|\[\?|\[\[|(^|\s)\?[a-z]+(=\S+)?\s/i;   /* markup that should never reach paper */
async function prevText(p) { return p.evaluate(() => { const b = document.getElementById('efPrev'); return b ? b.innerText : ''; }); }
async function settle(p) { await sleep(450); }

fs.mkdirSync(new URL('./shots/', import.meta.url), { recursive: true });
process.chdir(new URL('./', import.meta.url).pathname);

// ---------- 0. the made-up office ----------
console.log('0. seeding');
await E.loadRules();
await E.seedOffice();
const HUB = { email: 'dr.forms@example.com', pw: 'Staff-Hub-Pass-1' };
const PW = E.PW;
let hubUid;
const dev = await device();
{
  const page = dev.page;
  await page.goto(OLD);
  await page.waitForSelector('#authToggle', { timeout: 20000 });
  await sleep(1500);
  await page.click('#authToggle');
  await page.waitForSelector('#authPw2', { timeout: 20000 });
  for (let i = 0; i < 3; i++) {
    await page.fill('#authEmail', HUB.email); await page.fill('#authPw', HUB.pw); await page.fill('#authPw2', HUB.pw); await page.check('#authAck');
    await sleep(300);
    if ((await page.inputValue('#authPw')) === HUB.pw && (await page.inputValue('#authPw2')) === HUB.pw) break;
  }
  await page.click('#authGo');
  await page.waitForFunction(isApp, null, { timeout: 90000 });
  hubUid = await page.evaluate(() => fbUser.uid);
  await page.evaluate(() => { importStaffList([{ name: 'Gwen Rodis', role: 'Orthodontic Assistant' }, { name: 'Sarah Betz', role: 'Office Coordinator' }, { name: 'Tess Abbott', role: 'Treatment Coordinator' }]); });
  ok(await synced(page), 'seed: Staff Hub data made by the page as it was (three staff)');
  await page.close();
}

// ---------- 1. sign in ----------
console.log('1. sign in');
let page = await dev.ctx.newPage(); watch(page, 'new');
await page.goto(PAGE);
ok(await signIn(page, E.OWNER.email, PW) === 'link', 'NLO Cases sign-in asks once for Staff Hub’s own password');
await page.fill('#ncHubEmail', HUB.email); await page.fill('#ncHubPw', HUB.pw); await page.click('#ncGo');
ok(await outcome(page) === 'app', 'Staff Hub opens');
const ids = await page.evaluate(() => {
  const by = n => S.staff.find(p => p.name === n);
  const g = by('Gwen Rodis'), s = by('Sarah Betz'), t = by('Tess Abbott');
  Object.assign(g, { employment: 'Full-time', hireDate: '2024-03-04' });
  Object.assign(s, { employment: 'Part-time', hireDate: '2023-06-12', nick: 'Sam' });
  Object.assign(t, { employment: 'Full-time', hireDate: '2025-01-06' });
  persist();
  const d = new Date(); d.setDate(d.getDate() + 14);
  return { g: g.id, s: s.id, t: t.id, today: todayYMD(), in14: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') };
});
ok(await synced(page), 'staff details saved');
const longDate = ymd => new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

// ---------- 2. the Form library ----------
console.log('2. the Form library');
await page.evaluate(() => { route.page = 'newhire'; route.nhHire = null; route.nhTab = 'forms'; render(); });
await page.waitForSelector('#main .nhRow');
{
  const lib = await page.evaluate(() => Array.from(document.querySelectorAll('#main .panel')).map(pn => ({ h: pn.querySelector('.ph h3').textContent.trim(), rows: Array.from(pn.querySelectorAll('.nhRow b')).map(b => b.textContent.trim()), fill: pn.querySelectorAll('[data-act=efWho]').length })));
  const g = h => lib.find(x => x.h === h) || { rows: [], fill: 0 };
  ok(g('During employment').rows.join('|') === 'Employee Counseling Record|Change of Status or Pay|Policy Manual Update — Acknowledgment|Staff Treatment Agreement|Leave of Absence Confirmation|Response to an Accommodation Request', 'library: During employment — the six forms (' + g('During employment').rows.length + ')');
  ok(g('Leaving').rows.join('|') === 'Notice of Resignation|Resignation Confirmation|Termination of Employment|Job Abandonment Letter|Employee Checkout Record|Exit Interview|Authorization to Release References', 'library: Leaving — the seven forms');
  ok(g('During employment').fill === 6 && g('Leaving').fill === 7, 'each staff form has “Fill out…”');
  ok(g('Before day one').rows.includes('Reference Check') && g('Before day one').rows.includes('Working Interview Agreement') && g('Before day one').fill === 0, 'Before day one: Reference Check and Working Interview Agreement (printed, no Fill out…)');
  ok(g('New-hire packet').rows.includes('Photo & Social Media Release') && g('New-hire packet').rows.includes('Health Benefit Waiver'), 'New-hire packet: Photo & Social Media Release, Health Benefit Waiver');
  const optional = await page.evaluate(() => { const r = Array.from(document.querySelectorAll('#main .nhRow')).find(x => /Health Benefit Waiver/.test(x.textContent)); return r && /Optional/.test(r.textContent); });
  ok(optional, '…the waiver marked Optional (not in every packet)');
  await page.screenshot({ path: 'shots/ef-01-library.png', fullPage: true });
}
// every form, blank and filled for someone, leaves no markup on paper
{
  const bad = await page.evaluate(() => {
    const out = [], p = S.staff.find(x => x.name === 'Gwen Rodis');
    const LEFT = /\{[a-z0-9_:=|-]+\}|\[\?|\[\[|(^|\s)\?[a-z]+(=\S+)?\s/i;
    nhAllForms().filter(f => f.kind === 'markup').forEach(f => {
      const t = h => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent; };
      const blank = t(nhDocHTML(f, nhCtx(null)));
      const filled = t(nhDocHTML(f, nhCtx(efHireOf(p), efX(f, efDefaults(f, p, null), todayYMD()))));
      if (LEFT.test(blank)) out.push(f.id + ' blank: ' + blank.match(LEFT)[0]);
      if (LEFT.test(filled)) out.push(f.id + ' filled: ' + filled.match(LEFT)[0]);
    });
    return out;
  });
  ok(bad.length === 0, 'every form in the library, blank and filled in, prints no markup (' + (bad.join('; ') || 'none') + ')');
}
// a blank copy from the library: the choices are boxes to tick, nothing ticked
{
  const n0 = await prints(page);
  await page.click('#main .nhRow:has-text("Termination of Employment") [data-act=nhPrintOne]');
  const pr = await printed(page, n0);
  const t = text(pr.html);
  ok(pr.title === 'Termination of Employment', 'blank copy prints with the form’s name as the file name (' + pr.title + ')');
  ok(/This letter confirms that your employment/.test(t) && /This is a layoff/.test(t) && (pr.html.match(/class="nhBox"/g) || []).length >= 2 && !/nhBox on/.test(pr.html), 'blank Termination letter: both alternatives, each a box to tick, none ticked');
  ok(!/Reemployment Assistance program is available from FloridaCommerce\.\s*https?:/.test(t) && /FloridaCommerce/.test(t), '…mentions FloridaCommerce’s Reemployment Assistance (no link)');
  ok(!LEFT.test(t), '…no markup on paper');
}
{
  const n0 = await prints(page);
  await page.click('#main .nhRow:has-text("Employee Counseling Record") [data-act=nhPrintOne]');
  const pr = await printed(page, n0);
  ok(/Coaching \(a documented conversation\)/.test(text(pr.html)) && !/nhBox on/.test(pr.html) && !/nhTyped/.test(pr.html) && /nhNewPage/.test(pr.html), 'blank Counseling Record: levels as boxes, writing lines, a second page for comments and signatures');
}

// ---------- 3. a write-up for Gwen from her Paperwork tab ----------
console.log('3. Employee Counseling Record for Gwen');
await page.evaluate(id => goStaff(id, 'paper'), ids.g);
await page.waitForSelector('#main [data-act=efPick]');
ok(!(await page.$('#main .efPanel')), 'Paperwork tab: “Fill out a form” in the bar; no list until one is filled out');
await page.click('#main .ppBar [data-act=efPick]');
await page.waitForSelector('.efPickRow');
{
  const grp = await page.$$eval('.efGrpHd b', els => els.map(e => e.textContent.trim()));
  ok(grp.slice(0, 5).join('|') === 'During employment|Leaving|New-hire packet|Before day one|After the 90-day review', 'the form picker: During employment first, then Leaving, the packet, hiring, later (' + grp.join(', ') + ')');
  await page.screenshot({ path: 'shots/ef-02-picker.png' });
}
await page.click('.efPickRow:has-text("Employee Counseling Record")');
await page.waitForSelector('#efQs');
await settle(page);
{
  const st = await page.evaluate(() => ({
    title: document.querySelector('#modalWrap .mh h3').textContent,
    level: (document.querySelector('[data-q=level] .chip.on') || {}).textContent,
    by: document.getElementById('efq_by').value, next: document.getElementById('efq_next').value,
    date: document.getElementById('efDate').value, wide: document.querySelector('#modalWrap .modal').classList.contains('xwide')
  }));
  ok(st.title === 'Employee Counseling Record — Gwen Rodis' && st.wide, 'fill window: “Employee Counseling Record — Gwen Rodis”, wide, with a preview');
  ok(st.level === 'Verbal warning' && st.by === 'Dr. Amir Akhavan' && /up to and including termination/.test(st.next) && st.date === ids.today, 'starts from the usual answers: Verbal warning, held by Dr. Amir Akhavan, “up to and including termination”, dated today');
  const pv = await prevText(page);
  ok(/Gwen Rodis/.test(pv) && /Orthodontic Assistant/.test(pv) && pv.includes(longDate(ids.today)), 'preview: her name, position and today’s date');
}
await page.click('#efSave');
ok(await waitToast(page, /Fill in: What happened, What needs to change, and by when/, 5000), 'Save without the required parts: “Fill in: What happened, What needs to change, and by when”');
ok((await page.$$eval('#efQs .efMiss', els => els.map(e => e.dataset.q))).join(',') === 'what,expect', '…and those two are marked');
await page.click('[data-q=level] .chip[data-v=written]');
await page.check('[data-q=about] input[value=attendance]');
await page.fill('#efq_what', 'Late three times in October: 10/3, 10/14 and 10/27.\nNo call before the shift.');
await page.fill('#efq_expect', 'On time for every shift from November 3.');
await settle(page);
{
  const on = await page.evaluate(() => Array.from(document.querySelectorAll('#efPrev .nhCk')).filter(c => c.querySelector('.nhBox.on')).map(c => c.textContent.trim()));
  ok(on.join('|') === 'Written warning|Attendance or punctuality', 'preview ticks Written warning and Attendance (' + on.join(', ') + ')');
  const typed = await page.$$eval('#efPrev .nhTyped', els => els.map(e => e.textContent));
  ok(typed.some(t => /Late three times in October/.test(t) && /\n/.test(t)) && typed.some(t => /On time for every shift/.test(t)), 'preview prints what was typed (line breaks kept) in place of writing lines');
  ok(!(await page.evaluate(() => document.querySelector('#efQs .efMiss'))), 'the marks clear as the parts are filled in');
  await page.screenshot({ path: 'shots/ef-03-fill.png' });
}
{
  const n0 = await prints(page);
  await page.click('#efSavePrint');
  ok(await waitToast(page, /“Employee Counseling Record” saved with Gwen’s paperwork/, 5000), 'Save & print: “saved with Gwen’s paperwork”');
  const pr = await printed(page, n0);
  const t = text(pr.html);
  ok(pr.title === 'Employee Counseling Record - Gwen Rodis', 'prints as “Employee Counseling Record - Gwen Rodis”');
  ok(/Gwen Rodis/.test(t) && /Late three times in October/.test(t) && (pr.html.match(/nhBox on/g) || []).length === 2 && !LEFT.test(t), '…with her name, what happened, the two boxes ticked, no markup');
}
await page.waitForSelector('#main .efPanel .efRow');
{
  const row = await page.$eval('#main .efPanel .efRow', r => r.textContent.replace(/\s+/g, ' '));
  ok(/Employee Counseling Record — Written warning/.test(row) && row.includes('Dated ' + new Date(ids.today + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })) && /Attach signed/.test(row), 'Paperwork tab lists it: “Employee Counseling Record — Written warning · Dated …”, with Attach signed');
  const rec = await page.evaluate(() => S.nh.issued.map(r => ({ ...r })));
  ok(rec.length === 1 && rec[0].sid === ids.g && rec[0].form === 'counsel' && rec[0].v.level === 'written' && rec[0].v.about.join() === 'attendance' && rec[0].date === ids.today && rec[0].title === 'Employee Counseling Record', 'kept in the record: whose, which form, the date and the answers as entered');
  const act = await page.evaluate(() => S.activity.slice(0, 3).map(a => a.text).join(' | '));
  ok(/Filled out “Employee Counseling Record” for Gwen Rodis/.test(act), 'activity: “Filled out “Employee Counseling Record” for Gwen Rodis”');
}
ok(await synced(page), 'saved');
{
  const h = await hubRecord(hubUid, HUB.pw);
  ok(h && h.st && h.st.nh && Array.isArray(h.st.nh.issued) && h.st.nh.issued.length === 1 && /Late three times/.test(h.st.nh.issued[0].v.what), 'the server copy holds it, inside the encrypted record');
  ok(!JSON.stringify(h.raw).includes('Late three times') && !JSON.stringify(h.raw).includes('counsel'), '…and nothing of it readable without the password');
  const ai = await page.evaluate(id => ctxStaff(staffById(id)), ids.g);
  ok(!/Late three times|Counseling|counsel/i.test(ai), 'nothing of it goes to the AI (her AI notes)');
}
// change it later
await page.click('#main .efPanel .efRow b.nhLink');
await page.waitForSelector('#efQs');
{
  const st = await page.evaluate(() => ({ info: (document.querySelector('#efQs .infoBox') || {}).textContent || '', level: (document.querySelector('[data-q=level] .chip.on') || {}).textContent, what: document.getElementById('efq_what').value, del: !!document.querySelector('#modalWrap [data-act=efDel]') }));
  ok(/Filled out for Gwen/.test(st.info) && /a signed copy stays as it was/.test(st.info) && st.level === 'Written warning' && /Late three times/.test(st.what) && st.del, 'opening it again: what was filled in, a note that the signed copy stays as it was, and Delete');
}
await page.click('[data-q=level] .chip[data-v=written]');   /* a required choice can't be cleared */
ok(await page.evaluate(() => (document.querySelector('[data-q=level] .chip.on') || {}).textContent === 'Written warning'), 'a required choice stays chosen when clicked again');
await page.click('[data-q=level] .chip[data-v=final]');
await page.fill('#efq_followup', ids.in14);
await page.click('#efSave');
ok(await waitToast(page, /^Saved|Saved/, 5000), 'Save: “Saved”');
{
  const st = await page.evaluate(() => ({ n: S.nh.issued.length, r: { ...S.nh.issued[0] } }));
  ok(st.n === 1 && st.r.v.level === 'final' && st.r.v.followup === ids.in14 && st.r.up >= st.r.at, 'changed in place (still one): Final written warning, a follow-up date');
  ok(/Final written warning/.test(await page.$eval('#main .efPanel .efRow', r => r.textContent)), 'the list shows the new level');
}
// the signed copy comes back
await page.click('#main .efPanel .efRow [data-act=ppAdd]');
await page.waitForSelector('#ppPick', { state: 'attached' });
await page.setInputFiles('#ppPick', [{ name: 'scan_0001.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n') }]);
{
  const kinds = await page.$$eval('#ppList select', els => els.map(e => e.value));
  ok(kinds.join() === 'counsel', 'Attach signed: the upload window already says it’s the Employee Counseling Record (' + kinds.join() + ')');
}
await page.click('#ppGo');
ok(await waitToast(page, /added to Gwen Rodis’s paperwork/, 60000), 'the signed copy is locked and uploaded');
await page.waitForSelector('#main .efPanel .efRow [data-act=ppOpen]');
ok(/Signed copy/.test(await page.$eval('#main .efPanel .efRow', r => r.textContent)), 'the form’s row now opens its Signed copy');
{
  const sec = await page.evaluate(() => { const f = S.paper.find(x => x.kind === 'counsel'); return f ? ppSecOfFile(f) : ''; });
  ok(sec === 'hire', '…filed with the personnel forms');
}

// ---------- 4. a pay change ----------
console.log('4. Change of Status or Pay');
await page.click('#main .ppBar [data-act=efPick]');
await page.waitForSelector('.efPickRow');
await page.click('.efPickRow:has-text("Change of Status or Pay")');
await page.waitForSelector('#efQs');
{
  const st = await page.evaluate(() => ({ tf: document.getElementById('efq_titlefrom').value, sf: document.getElementById('efq_statusfrom').value, eff: document.getElementById('efq_eff').value,
    halves: Array.from(document.querySelectorAll('#efQs .efQ.half')).map(e => e.dataset.q).join(',') }));
  ok(st.tf === 'Orthodontic Assistant' && st.sf === 'Full-time' && st.eff === ids.today, 'starts from her position and status, effective today');
  ok(/payfrom,payto,titlefrom,titleto/.test(st.halves), 'from / to side by side');
}
await page.click('#efSave');
ok(await waitToast(page, /Fill in: What’s changing/, 5000), 'needs what’s changing');
await page.check('[data-q=what] input[value=pay]');
await page.check('[data-q=what] input[value=title]');
await page.fill('#efq_payfrom', '$18.50 an hour'); await page.fill('#efq_payto', '$20 an hour'); await page.fill('#efq_titleto', 'Lead Orthodontic Assistant');
await page.click('[data-q=why] .chip[data-v=review]');
await page.click('[data-q=why] .chip[data-v=review]');   /* not required: clicking again clears it */
ok(await page.evaluate(() => !document.querySelector('[data-q=why] .chip.on')), 'a choice that isn’t required clears when clicked again');
await page.click('[data-q=why] .chip[data-v=review]');
await settle(page);
{
  const rows = await page.$$eval('#efPrev .nhTbl tr', trs => trs.map(t => Array.from(t.children).map(c => c.textContent.trim()).join(' ').replace(/\s+/g, ' ')));
  ok(rows.length === 3 && /Pay \$18\.50 an hour \$20 an hour/.test(rows[1]) && /Position Orthodontic Assistant Lead Orthodontic Assistant/.test(rows[2]), 'preview: only the rows that change — Pay and Position, from and to (' + rows.length + ' rows)');
  ok(await page.evaluate(() => !!Array.from(document.querySelectorAll('#efPrev .nhCk')).find(c => /Performance review/.test(c.textContent) && c.querySelector('.nhBox.on'))), 'the reason ticked');
}
await page.click('#efSave');
ok(await waitToast(page, /“Change of Status or Pay” saved/, 5000), 'saved');
ok(/Change of Status or Pay — Pay, Position/.test(await page.$eval('#main .efPanel', p => p.textContent.replace(/\s+/g, ' '))), 'listed as “Change of Status or Pay — Pay, Position”');

// ---------- 5. an incident write-up → a counseling record ----------
console.log('5. incident → Counseling record');
const incId = await page.evaluate(id => {
  const i = { id: uid(), staffId: id, date: '2026-10-20', severity: 'serious', title: 'Left a patient alone in the chair', description: 'Stepped out for 15 minutes during a bond-up without telling anyone.', action: 'Retraining on chairside coverage', acknowledged: false, ackDate: null, created: Date.now() };
  S.incidents.push(i); persist(); return i.id;
}, ids.t);
await page.evaluate(id => H.viewIncident({ dataset: { id } }), incId);
await page.waitForSelector('#modalWrap [data-act=efFromInc]');
await page.click('#modalWrap [data-act=efFromInc]');
await page.waitForSelector('#efQs');
{
  const st = await page.evaluate(() => ({ info: document.querySelector('#efQs .infoBox').textContent, level: (document.querySelector('[data-q=level] .chip.on') || {}).textContent, when: document.getElementById('efq_when').value, what: document.getElementById('efq_what').value, title: document.querySelector('#modalWrap .mh h3').textContent }));
  ok(st.title === 'Employee Counseling Record — Tess Abbott', 'Counseling record… from Tess’s incident write-up');
  ok(st.level === 'Written warning' && st.when === 'October 20, 2026' && /Left a patient alone in the chair/.test(st.what) && /15 minutes/.test(st.what), 'filled in from it: a serious incident as a Written warning, its date, its title and what happened');
  ok(/incident write-up of Oct 20, 2026/.test(st.info) && /Retraining on chairside coverage/.test(st.info), '…and shows its action taken / plan to use');
}
await page.fill('#efq_expect', 'Hand off the chair before stepping away, every time.');
await page.click('#efSave');
ok(await waitToast(page, /saved with Tess’s paperwork/, 5000), 'saved with Tess’s paperwork');
{
  const r = await page.evaluate(i => ({ ...(S.nh.issued.find(x => x.inc === i) || {}) }), incId);
  ok(r.sid === ids.t && r.form === 'counsel', 'kept with the incident it came from');
}
await page.evaluate(id => H.viewIncident({ dataset: { id } }), incId);
await page.waitForSelector('#modalWrap .mf');
ok(await page.evaluate(() => !document.querySelector('#modalWrap [data-act=efFromInc]') && /Counseling record/.test(document.querySelector('#modalWrap [data-act=efOpen]').textContent)), 'the incident now opens its Counseling record instead of making another');
await page.evaluate(() => closeModal());

// ---------- 6. End employment → the leaving paperwork ----------
console.log('6. leaving paperwork');
await page.evaluate(id => goStaff(id, 'paper'), ids.s);
await page.waitForSelector('#main [data-act=sepStart]');
await page.click('#main [data-act=sepStart]');
await page.waitForSelector('#sepTypes');
await page.click('#sepTypes .chip[data-v=resigned]');
await page.selectOption('#sepReason', 'Moving away');
await page.fill('#sepLast', ids.in14); await page.fill('#sepNotice', ids.today);
await page.click('#sepSave');
await page.waitForSelector('#main .efSep');
{
  const b = await page.$$eval('#main .efSep .efSepBtns button', els => els.map(e => e.textContent.trim()));
  ok(b.join('|') === 'Resignation Confirmation|Notice of Resignation|Employee Checkout Record|Exit Interview|Authorization to Release References', 'Leaving paperwork for a resignation: Resignation Confirmation, Notice of Resignation, Checkout Record, Exit Interview, Authorization to Release References');
  await page.screenshot({ path: 'shots/ef-04-leaving.png', fullPage: true });
}
await page.check('#main .sepCk input[data-k=keys]');
await sleep(300);
await page.check('#main .sepCk input[data-k=pay]');
await sleep(300);
await page.click('#main .efSep button:has-text("Resignation Confirmation")');
await page.waitForSelector('#efQs');
{
  const st = await page.evaluate(() => ({ nd: document.getElementById('efq_noticedate').value, ld: document.getElementById('efq_lastday').value }));
  ok(st.nd === ids.today && st.ld === ids.in14, 'Resignation Confirmation: the notice date and last day from her record');
  await settle(page);
  const pv = await prevText(page);
  ok(/Dear Sam,/.test(pv) && pv.includes('We received your resignation on ' + longDate(ids.today)) && pv.includes('your last day of work will be ' + longDate(ids.in14)), 'the letter: “Dear Sam,” (the name she goes by), the dates written out');
  ok(!/Your final paycheck/.test(pv), 'a line with nothing to say (no payday yet) isn’t printed');
}
await page.fill('#efq_payday', ids.in14);
await settle(page);
ok((await prevText(page)).includes('will be paid on ' + longDate(ids.in14)), '…and is once the final paycheck date is in');
{
  const n0 = await prints(page);
  await page.click('#efSavePrint');
  const pr = await printed(page, n0);
  ok(pr.title === 'Resignation Confirmation - Sarah Betz' && /Dear Sam/.test(text(pr.html)) && /nhLetter/.test(pr.html), 'prints the letter: “Resignation Confirmation - Sarah Betz”');
}
await page.waitForSelector('#main .efSep .efDone');
ok(/Resignation Confirmation/.test(await page.$eval('#main .efSep .efDone', b => b.textContent)), 'the button now shows it’s done (and opens it)');
await page.click('#main .efSep button:has-text("Employee Checkout Record")');
await page.waitForSelector('#efQs');
{
  const on = await page.$$eval('[data-q=done] input:checked', els => els.map(e => e.value).join(','));
  ok(on === 'keys,alarm,pay', 'Checkout Record: ticked from her offboarding checklist — key, alarm code, final pay (' + on + ')');
}
await page.click('#efSave');
ok(await waitToast(page, /“Employee Checkout Record” saved/, 5000), 'saved');
// she was let go instead
await page.click('#main [data-act=sepEdit]');
await page.waitForSelector('#sepTypes');
await page.click('#sepTypes .chip[data-v=terminated]');
await page.selectOption('#sepReason', 'Attendance or tardiness');
await page.click('#sepSave');
await page.waitForSelector('#main .efSep');
{
  const b = await page.$$eval('#main .efSep .efSepBtns button', els => els.map(e => e.textContent.trim()));
  ok(b[0] === 'Termination of Employment' && !b.includes('Resignation Confirmation') && /Employee Checkout Record/.test(b.join('|')), 'changed to Terminated: Termination of Employment offered instead (the Checkout Record stays done)');
}
await page.click('#main .efSep button:has-text("Termination of Employment")');
await page.waitForSelector('#efQs');
{
  const st = await page.evaluate(() => ({ kind: (document.querySelector('[data-q=kind] .chip.on') || {}).dataset.v, reason: document.getElementById('efq_reason').value, ld: document.getElementById('efq_lastday').value }));
  ok(st.kind === 'term' && st.reason === 'Attendance or tardiness' && st.ld === ids.in14, 'Termination: a termination, the reason and last day from her record');
  await settle(page);
  const pv = await prevText(page);
  ok(/ends effective/.test(pv) && !/This is a layoff/.test(pv) && /Reason: Attendance or tardiness/.test(pv) && /Signing means I received it/.test(pv), 'the letter: only the termination wording, the reason, and a line for her to sign she received it');
}
await page.click('#modalWrap [data-act=closeModal]');

// ---------- 7. from the Form library: Fill out… for someone ----------
console.log('7. Fill out… from the library');
await page.evaluate(() => { route.page = 'newhire'; route.nhHire = null; route.nhTab = 'forms'; render(); });
await page.click('#main .nhRow:has-text("Leave of Absence Confirmation") [data-act=efWho]');
await page.waitForSelector('#efWho');
{
  const opts = await page.$$eval('#efWho option', o => o.map(x => x.textContent));
  ok(opts.some(o => /Sarah Betz — Office Coordinator \(leaving\)/.test(o)) && opts.some(o => /Gwen Rodis/.test(o)), 'who it’s for: the staff list (someone leaving marked)');
}
await page.click('#efWhoGo');
ok(await waitToast(page, /Choose who it’s for/, 5000), 'asks who it’s for');
await page.selectOption('#efWho', ids.g);
await page.click('#efWhoGo');
await page.waitForSelector('#efQs');
await page.click('[data-q=leavetype] .chip[data-v=medical]');
await page.fill('#efq_from', '2026-11-09'); await page.fill('#efq_to', '2026-12-07');
await page.click('[data-q=held] .chip[data-v=held]');
await settle(page);
{
  const pv = await prevText(page);
  ok(/Medical leave/.test(pv) && /November 9, 2026/.test(pv) && /You’ll use your available vacation and sick time first/.test(pv) && /We’ll hold your position for you/.test(pv) && !/Medical \(their own health\)/.test(pv), 'the letter says it to her (“Medical leave”, “We’ll hold your position for you”), not the office’s labels');
}
await page.click('#efSave');
ok(await waitToast(page, /saved with Gwen’s paperwork/, 5000), 'saved with Gwen’s paperwork');
{
  const sec = await page.evaluate(() => ppSecOf('loa', ppTypeTitle('loa')) + ',' + ppSecOf('accom', ppTypeTitle('accom')) + ',' + ppSecOf('counsel', ppTypeTitle('counsel')));
  ok(sec === 'med,med,hire', 'signed leave and accommodation letters file with the medical records; write-ups with the personnel forms');
}

// ---------- 8. paperwork types and guesses ----------
console.log('8. paperwork types');
{
  const r = await page.evaluate(() => {
    const L = ppTypeList(), g = id => (L.find(t => t.id === id) || {}).grp;
    return { counsel: g('counsel'), term: g('term'), writeup: g('writeup'), review: g('review'), photo: g('photo'), reference: g('reference'),
      guesses: ['Gwen counseling record signed.pdf', 'Sarah resignation letter.pdf', 'Resignation confirmation.pdf', 'exit interview.jpg', 'photo release.pdf', 'Termination letter.pdf', 'Brandi W4.pdf', 'scan_2026_10_30.pdf', 'Brandi packet signed.pdf', 'policy manual.pdf', 'Policy manual update 2026.pdf', 'reference authorization.pdf'].map(ppGuess) };
  });
  ok(r.counsel === 'During employment' && r.writeup === 'During employment' && r.review === 'During employment' && r.term === 'Leaving' && r.photo === 'New-hire packet' && r.reference === 'Hiring', 'upload types: During employment (with signed reviews and write-ups) and Leaving groups');
  ok(r.guesses.join(',') === 'counsel,resign,resignok,exit,photo,term,w4,other,multi,handbook,policyupd,refauth', 'guessed from file names (' + r.guesses.join(',') + ')');
}

// ---------- 9. new hires and candidates ----------
console.log('9. new hires and candidates');
const hid = await page.evaluate(() => {
  const h = { id: uid(), status: 'active', created: Date.now(), staffId: null, inc: {}, done: {}, tasks: {}, notes: '', name: 'Brandi Testa', team: 'clinical', employment: 'Full-time', position: 'Orthodontic Assistant', start: '2026-11-02' };
  nhS().hires.push(h); persist(); route.page = 'newhire'; route.nhHire = h.id; route.nhTab = 'hires'; render(); return h.id;
});
await page.waitForSelector('#main .nhInc');
{
  const st = await page.evaluate(id => { const h = nhHire(id); return { photo: nhIncluded(nhFormById('photo'), h), waiver: nhIncluded(nhFormById('waiver'), h), packet: nhPacketForms(h).map(f => f.id) }; }, hid);
  ok(st.photo && !st.waiver && st.packet.includes('photo'), 'a new hire’s packet includes the photo release; the waiver is there to tick when needed');
  const n0 = await prints(page);
  await page.click('#main .nhRow:has-text("Health Benefit Waiver") [data-act=nhPrintOne]');
  const pr = await printed(page, n0);
  ok(/Brandi Testa/.test(text(pr.html)) && /Celebrate Primary Care membership/.test(text(pr.html)) && !/nhBox on/.test(pr.html), 'printed for her: her name and the benefit (Celebrate Primary Care membership), the reason left to tick');
}
const cid = await page.evaluate(() => { const c = { id: uid(), status: 'active', stage: 'new', created: Date.now(), stageAt: Date.now(), notes: '', name: 'Jordan Rivera', position: 'Front Desk' }; nhS().cands.push(c); persist(); route.nhHire = null; route.nhTab = 'cands'; render(); candModal(c.id); return c.id; });
await page.waitForSelector('#modalWrap .efCand');
{
  const b = await page.$$eval('#modalWrap .efCand button', els => els.map(e => e.textContent.trim()));
  ok(b.join('|') === 'Reference Check|Working Interview Agreement', 'a candidate card: print the Reference Check or Working Interview Agreement for them');
  const n0 = await prints(page);
  await page.click('#modalWrap .efCand button:has-text("Working Interview Agreement")');
  const pr = await printed(page, n0);
  ok(pr.title === 'Working Interview Agreement - Jordan Rivera' && /invites Jordan Rivera to a working interview for the position of Front Desk/.test(text(pr.html)), '…printed with their name and position');
}
await page.evaluate(() => closeModal());

// ---------- 10. delete, merge, other devices ----------
console.log('10. delete and merge');
await page.evaluate(id => goStaff(id, 'paper'), ids.g);
await page.waitForSelector('#main .efPanel');
{
  const n = await page.$$eval('#main .efPanel .efRow', r => r.length);
  ok(n === 3, 'Gwen’s list: three forms (' + n + ')');
  await page.click('#main .efPanel .efRow:has-text("Leave of Absence") [data-act=efDel]');
  await page.waitForSelector('#cmYes');
  ok(/A signed copy you attached stays with their paperwork/.test(await page.textContent('#modalWrap')), 'Delete asks first (a signed copy stays)');
  await page.click('#cmYes');
  await sleep(300);
  ok((await page.$$eval('#main .efPanel .efRow', r => r.length)) === 2 && !(await page.evaluate(() => S.nh.issued.some(r => r.form === 'loa'))), 'deleted');
}
{
  const m = await page.evaluate(() => {
    const A = { id: 'a1', sid: 'x', form: 'counsel', date: '2026-10-01', v: { level: 'verbal' }, at: 1, up: 1 };
    const B = { id: 'b1', sid: 'x', form: 'exit', date: '2026-10-02', v: {}, at: 2, up: 2 };
    const base = { nh: { issued: [A] } }, here = { nh: { issued: [A, B] } }, there = { nh: { issued: [{ ...A, v: { level: 'final' }, up: 3 }] } };
    const out = shMerge(base, here, there, true, '');
    return out.nh.issued.map(r => r.id + ':' + (r.v.level || '')).sort().join(',');
  });
  ok(m === 'a1:final,b1:', 'two devices: a form added on one and a form changed on the other both kept (' + m + ')');
}
ok(await synced(page), 'all saved');
{
  const h = await hubRecord(hubUid, HUB.pw);
  const L = h && h.st && h.st.nh ? h.st.nh.issued : [];
  ok(L.length === 5 && L.filter(r => r.form === 'counsel').length === 2, 'the server copy: five forms filled out (two counseling records)');
}

// ---------- 11. phones ----------
console.log('11. a phone');
{
  const ph = await device({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p2 = ph.page;
  await p2.goto(PAGE);
  const o = await signIn(p2, E.OWNER.email, PW);
  if (o === 'link') { await p2.fill('#ncHubEmail', HUB.email); await p2.fill('#ncHubPw', HUB.pw); await p2.click('#ncGo'); await outcome(p2); }
  ok(await p2.evaluate(isApp), 'phone: Staff Hub opens');
  await p2.evaluate(id => goStaff(id, 'paper'), ids.g);
  await p2.waitForSelector('#main .efPanel .efRow');
  ok(await noScrollX(p2), 'phone: Paperwork tab with its forms, no sideways scrolling');
  await p2.screenshot({ path: 'shots/ef-05-phone-paper.png', fullPage: true });
  await p2.click('#main .efPanel .efRow b.nhLink');
  await p2.waitForSelector('#efQs');
  await sleep(500);
  const lay = await p2.evaluate(() => { const L = document.querySelector('.efEd .nhEdL').getBoundingClientRect(), R = document.querySelector('.efEd .nhEdR').getBoundingClientRect(), m = document.querySelector('#modalWrap .modal');
    return { stacked: R.top >= L.bottom - 1, fits: m.scrollWidth <= m.clientWidth + 1, oneCol: getComputedStyle(document.querySelector('.efQs')).gridTemplateColumns.split(' ').length === 1 }; });
  ok(lay.stacked && lay.fits && lay.oneCol, 'phone: the fill window stacks the questions over the preview, one column, nothing cut off');
  await p2.screenshot({ path: 'shots/ef-06-phone-fill.png' });
  await p2.evaluate(() => closeModal());
  await p2.evaluate(id => goStaff(id, 'paper'), ids.s);
  await p2.waitForSelector('#main .efSep');
  ok(await noScrollX(p2), 'phone: the leaving paperwork buttons wrap');
  await ph.ctx.close();
}

// ---------- done ----------
console.log('\nerrors on the pages:', errors.length ? errors : 'none');
ok(errors.length === 0, 'no page errors');
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:\n- ' + fails.join('\n- ')); process.exit(1); }
