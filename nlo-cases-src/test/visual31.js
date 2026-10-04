// Amir, 3 Oct 2026: "remove the titan link section because we are not using it now. also besides aligners and retainers, hawley
// retainers need upper and lower arch. for now just say upper and lower because I dont have icon for it. Also There should be a
// color selection tool … also when selecting posterior movement locked, it should automatically lock it on the tooth chart" — demo
const { chromium } = require('playwright');
const { routes, watch, panelsOpen } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 2 }); await routes(ctx); await panelsOpen(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const setCase = (id, o) => p.evaluate(([id, o]) => { Object.assign(findCase(id), JSON.parse(JSON.stringify(o))); Object.assign(DEMO.cases.get(id), o); queueRender(); }, [id, o]);
  const newCase = async tile => { await p.evaluate(() => { closeDrawer(true); const m = document.querySelector('#modalWrap'); if (m) m.remove(); }); await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm'); await p.click('#ncForm .tt[data-tile=' + tile + ']'); await p.waitForTimeout(120); };
  const teeth = sel => p.evaluate(sel => JSON.parse(document.querySelector(sel + ' #cf-teeth').value || '{}'), sel);
  const nomove = t => Object.keys(t).filter(k => t[k].includes('nomove')).sort().join(',');
  const POST = await p.evaluate(() => POSTERIORS.slice().sort().join(','));
  const POST_U = await p.evaluate(() => POSTERIORS.filter(k => k[0] === 'U').sort().join(','));

  // ---- Titan link: not asked on a new in-house case; a case that has one still shows it in Edit
  await newCase('nla');
  check(!(await p.$('#ncForm #cf-titanUrl')), 'New case, in-house: no Titan link section');
  const withLink = await p.evaluate(() => { const c = openCases().find(x => x.type === 'nla'); return c.id; });
  const without = await p.evaluate(id => openCases().find(x => x.type === 'nla' && x.id !== id).id, withLink);
  await setCase(withLink, { titanUrl: 'https://client.titandentaldesign.com/Live/index.html#case-demo' }); await setCase(without, { titanUrl: '' });
  await p.evaluate(() => { const m = document.querySelector('#modalWrap'); if (m) m.remove(); });
  await p.evaluate(id => openDrawer(id), without); await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer .cf');
  check(!(await p.$('#drawer #cf-titanUrl')), 'Edit, a case without a Titan link: no Titan link section');
  await p.click('#drawer [data-act=cancelEdit]'); await p.evaluate(() => closeDrawer(true));
  await p.evaluate(id => openDrawer(id), withLink);
  check(await p.isVisible('#drawer a:has-text("Open this case in Titan")'), 'a case saved with a link still has Open this case in Titan');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer .cf');
  check(await p.isVisible('#drawer #cf-titanUrl') && /case-demo/.test(await p.inputValue('#drawer #cf-titanUrl')), '… and Edit shows its link (to keep or clear)');
  await p.click('#drawer [data-act=cancelEdit]'); await p.evaluate(() => closeDrawer(true));

  // ---- Hawley retainers: Upper / Lower in words, and the acrylic color as Specialty's guide in swatches (Amir, 4 Oct 2026: "the
  //      high resolution color palette" — his chart of Specialty's Acrylic Color Guide)
  await newCase('appliance');
  check(!(await p.isVisible('#ncForm #cf-hawleyWrap')) && !(await p.isVisible('#ncForm #cf-acrWrap')), 'Appliance: no Hawley questions (or colors) until Hawley retainers is tapped');
  await p.click('#ncForm .pickRow[data-g=appliances] .pick[data-v="Hawley retainers"]'); await p.waitForTimeout(100);
  const hw = await p.evaluate(() => ({ shown: !!document.querySelector('#ncForm #cf-hawleyWrap').offsetParent,
    arch: Array.from(document.querySelectorAll('#ncForm .pickRow[data-g=hawleyArch] .pick')).map(b => b.textContent.trim() + (b.querySelector('img,svg,.archIc') ? '+icon' : '')).join('|'),
    colors: Array.from(document.querySelectorAll('#ncForm .pickRow[data-g=acrylic] .pick')).map(b => b.dataset.v),
    groups: Array.from(document.querySelectorAll('#ncForm .acrPal .acrGh')).map(h => h.textContent.replace(/\s+/g, ' ').trim()).join('|'),
    glitterRow: !!document.querySelector('#ncForm .pickRow[data-g=glitter]'), forWho: document.querySelector('#ncForm #cf-acrFor').textContent }));
  console.log('   ' + JSON.stringify(Object.assign({}, hw, { colors: hw.colors.length })));
  check(hw.shown && hw.arch === 'Upper|Lower', 'Hawley retainers tapped: “Hawley arch — Upper / Lower”, in words (no icon)');
  check(hw.colors.length === 35 && hw.colors[0] === 'Clear' && ['Black cherry', 'Tangerine', 'Party mix glitter', 'Moon glow', 'Cotton candy swirl', 'Tie dye'].every(c => hw.colors.includes(c)) &&
    hw.groups === 'Specialty colors free|Glitter $9.50|Glow $9.50|Swirls $9.50|Custom designs not on the price list' && !hw.glitterRow && hw.forWho === 'for the Hawley',
    'Acrylic color “for the Hawley”: Clear and Specialty’s 34 colors in their five groups with the prices; no separate Glitter switch');
  await p.waitForFunction(() => Array.from(document.querySelectorAll('#ncForm .acrPal img')).every(i => i.complete && i.naturalWidth > 0), null, { timeout: 8000 }).catch(() => {});
  check(await p.evaluate(() => { const im = Array.from(document.querySelectorAll('#ncForm .acrPal img')); return im.length === 34 && im.every(i => i.complete && i.naturalWidth >= 144 && /^nlo-cases-pics\/acr-/.test(i.getAttribute('src'))); }),
    'the 34 swatch pictures load from nlo-cases-pics/ at full size (144 px, shown at 44)');
  check(await p.evaluate(() => routeLabName = (pressed(document.querySelector('.modal'), 'lab')[0] || '')) === 'Specialty Orthodontic Lab', 'Hawley goes to Specialty (Amir, 4 Oct 2026; Partners before)');
  await p.fill('#ncForm #cf-patient', 'Hattie Hawleyson');
  await p.click('#ncSave'); await p.waitForSelector('#ncErr .lockErr', { timeout: 5000 }).catch(() => {});
  check(/arch for the Hawley/.test(await p.textContent('#ncErr')) && await p.evaluate(() => document.querySelector('#ncForm .pickRow[data-g=hawleyArch]').classList.contains('need')), 'New case without the arch is stopped (“Pick the arch for the Hawley retainers…”, row outlined)');
  await p.click('#ncForm .pickRow[data-g=hawleyArch] .pick[data-v=Upper]'); await p.click('#ncForm .pickRow[data-g=hawleyArch] .pick[data-v=Lower]');
  await p.click('#ncForm .pickRow[data-g=acrylic] .pick[data-v="Blue glitter"]');
  check(await p.inputValue('#ncForm #cf-detail') === 'Hawley retainers (upper & lower, blue glitter)', 'what’s being made: “Hawley retainers (upper & lower, blue glitter)”');
  await p.click('#ncForm .pickRow[data-g=acrylic] .pick[data-v="Party mix glitter"]');
  check(await p.evaluate(() => Array.from(document.querySelectorAll('#ncForm .pickRow[data-g=acrylic] .pick[aria-pressed=true]')).map(b => b.dataset.v).join()) === 'Party mix glitter', 'one color at a time (Party mix glitter replaces Blue glitter)');
  await (await p.$('#ncForm #cf-acrWrap')).evaluate(e => e.closest('.cfSec').scrollIntoView({ block: 'center' })); await p.mouse.move(5, 5); await p.waitForTimeout(300);
  await (await p.$('#ncForm #cf-acrWrap')).screenshot({ path: OUT + '/v31-hawley.png' });
  await p.click('#ncSave'); await p.waitForSelector('#ncForm', { state: 'detached', timeout: 5000 }).catch(() => {});
  const hid = await p.evaluate(() => (openCases().find(c => c.patient === 'Hattie Hawleyson') || {}).id);
  const saved = hid && await p.evaluate(id => { const d = DEMO.cases.get(id); return { arches: (d.arches || []).join(), acrylic: d.acrylic, glitter: d.glitter, detail: d.detail }; }, hid);
  check(saved && saved.arches === 'Upper,Lower' && saved.acrylic === 'Party mix glitter' && saved.glitter === '' && saved.detail === 'Hawley retainers (upper & lower, party mix glitter)', 'saved: Upper & Lower, Party mix glitter (' + JSON.stringify(saved) + ')');
  await p.evaluate(id => openDrawer(id), hid); await p.waitForSelector('#drawer .dsList');
  const badge = await p.evaluate(() => { const b = Array.from(document.querySelectorAll('#drawer .badge.t-appl')).find(x => /Hawley/.test(x.textContent)); return b && { t: b.textContent, sw: !!b.querySelector('.sw') }; });
  check(badge && badge.t === 'Hawley retainers (upper & lower, party mix glitter)' && badge.sw, 'the case’s badge: “Hawley retainers (upper & lower, party mix glitter)” with its color dot');
  check(/Scanned with [^.]+ for Hawley retainers, upper & lower, party mix glitter acrylic \(Specialty Orthodontic Lab\)\./.test(await p.evaluate(id => chartNote(findCase(id)), hid)), 'chart note: “… for Hawley retainers, upper & lower, party mix glitter acrylic (Specialty Orthodontic Lab).”');
  // Edit keeps them; one arch; the Schwarz instead: standard colors only
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-hawleyWrap', { state: 'attached' });
  const ed = await p.evaluate(() => ({ arch: Array.from(document.querySelectorAll('#drawer .pickRow[data-g=hawleyArch] .pick[aria-pressed=true]')).map(b => b.dataset.v).join(), col: (document.querySelector('#drawer .pickRow[data-g=acrylic] .pick[aria-pressed=true]') || {}).dataset?.v }));
  check(ed.arch === 'Upper,Lower' && ed.col === 'Party mix glitter', 'Edit shows the arch and color as saved');
  await p.click('#drawer .pickRow[data-g=hawleyArch] .pick[data-v=Lower]');
  check(await p.inputValue('#drawer #cf-detail') === 'Hawley retainers (upper, party mix glitter)', 'upper only: “Hawley retainers (upper, party mix glitter)”');
  await p.click('#drawer [data-act=saveEdit]'); await p.waitForTimeout(400);
  const ed2 = await p.evaluate(id => { const d = DEMO.cases.get(id); return (d.arches || []).join() + '|' + d.acrylic + '|' + d.glitter; }, hid);
  check(ed2 === 'Upper|Party mix glitter|', 'saved from Edit: Upper, Party mix glitter (' + ed2 + ')');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-hawleyWrap', { state: 'attached' });
  await p.click('#drawer .pickRow[data-g=appliances] .pick[data-v="Hawley retainers"]'); await p.click('#drawer .pickRow[data-g=appliances] .pick[data-v="Schwartz"]'); await p.waitForTimeout(150);
  const un = await p.evaluate(() => ({ hawley: !document.querySelector('#drawer #cf-hawleyWrap').hidden, colors: !document.querySelector('#drawer #cf-acrWrap').hidden, forWho: document.querySelector('#drawer #cf-acrFor').textContent,
    off: Array.from(document.querySelectorAll('#drawer .acrS[aria-disabled=true]')).length, on: Array.from(document.querySelectorAll('#drawer .acrS:not([aria-disabled])')).map(b => b.dataset.v).join(','),
    picked: Array.from(document.querySelectorAll('#drawer .pickRow[data-g=acrylic] .pick[aria-pressed=true]')).length, hint: document.querySelector('#drawer #cf-acrHint').textContent }));
  console.log('   ' + JSON.stringify(un));
  check(!un.hawley && un.colors && un.forWho === 'for the Schwarz' && un.off === 24 && un.on.split(',').length === 11 && un.picked === 0 && /standard colors only/.test(un.hint),
    'Hawley → Schwarz: the arch goes; the colors stay “for the Schwarz” with only Clear and Specialty’s 10 standard colors (glitter, glow, swirls and designs greyed out, Party mix glitter taken off)');
  await p.click('#drawer .pickRow[data-g=acrylic] .pick[data-v="Tie dye"]', { force: true });
  check(!(await p.evaluate(() => pressed(document.querySelector('#drawer'), 'acrylic').length)), '… a greyed-out one can’t be picked');
  await p.click('#drawer .pickRow[data-g=acrylic] .pick[data-v="Teal"]');
  await p.click('#drawer [data-act=saveEdit]'); await p.waitForTimeout(400);
  const ed3 = await p.evaluate(id => { const d = DEMO.cases.get(id); return { arches: (d.arches || []).length, acrylic: d.acrylic, glitter: d.glitter, appl: (d.appliances || []).join() }; }, hid);
  check(ed3.appl === 'Schwartz' && !ed3.arches && ed3.acrylic === 'Teal' && ed3.glitter === '', '… saved as a Schwarz in Teal, without the Hawley arch (' + JSON.stringify(ed3) + ')');
  await p.evaluate(() => closeDrawer(true));
  // a case from before the guide: Blue with the old Glitter switch shows as Blue glitter, and saves untouched as it was; Purple shows as an earlier choice
  const old = await p.evaluate(() => openCases().find(c => c.type === 'appliance' && c.stage === 'submit').id);
  await setCase(old, { appliances: ['Hawley retainers'], arches: ['Upper'], acrylic: 'Blue', glitter: true, rx: '', rxRet: '', rxFun: '' }); // (the demo's Herbst case, made a Hawley without its Herbst Rx)
  await p.evaluate(id => openDrawer(id), old); await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-acrWrap', { state: 'attached' });
  check(await p.evaluate(() => pressed(document.querySelector('#drawer'), 'acrylic').join()) === 'Blue glitter' && !(await p.evaluate(() => editDirty())), 'an older case with Blue + Glitter: Blue glitter picked, and nothing counts as changed');
  await p.click('#drawer [data-act=cancelEdit]'); await setCase(old, { acrylic: 'Purple', glitter: '' });
  await p.evaluate(() => closeDrawer(true)); await p.evaluate(id => openDrawer(id), old); await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-acrWrap', { state: 'attached' });
  check(await p.evaluate(() => { const b = document.querySelector('#drawer .acrS.old'); return !!b && b.dataset.v === 'Purple' && b.getAttribute('aria-pressed') === 'true'; }) && !(await p.evaluate(() => editDirty())), '… Purple (not on Specialty’s guide) shows as an earlier choice, still picked');
  await p.click('#drawer [data-act=cancelEdit]'); await p.evaluate(() => closeDrawer(true));
  // retainers keep their own Arch question (with the tray icons)
  await newCase('retainer');
  check(await p.isVisible('#ncForm .pickRow[data-g=arches] .pick[data-v=Upper] .archIc') && !(await p.isVisible('#ncForm #cf-hawleyWrap')), 'Retainers keep their own Arch question with the icons; no Hawley questions');

  // ---- No posterior movement locks the back teeth on the tooth chart
  await newCase('oliv');
  const npm = '#ncForm .pickRow[data-g=instrPicks] .pick[data-v="No posterior teeth movement"]';
  await p.click(npm); await p.waitForTimeout(100);
  let t = await teeth('#ncForm');
  check(nomove(t) === POST, 'tap “No posterior movement”: every back tooth (4–7, upper and lower) is marked Don’t move on the chart');
  check(/Don.t move: all posteriors \(4–7\)/.test(await p.textContent('#ncForm #cf-teethSum')), 'the chart says “Don’t move: all posteriors (4–7)”');
  await (await p.$('#ncForm #cf-tc')).evaluate(e => e.scrollIntoView({ block: 'center' })); await p.mouse.move(5, 5); await p.waitForTimeout(200);
  await (await p.$('#ncForm #cf-tc')).screenshot({ path: OUT + '/v31-lock.png' });
  await p.click(npm); await p.waitForTimeout(100);
  check(nomove(await teeth('#ncForm')) === '', 'untap it: the marks come off');
  // upper only: just the upper back teeth; a missing tooth is skipped; a Don't move put there by hand stays
  await p.click('#ncForm .pickRow[data-g=treatArch] .pick[data-v=U]');
  await p.click('#ncForm #cf-tc [data-tool=missing]'); await p.click('#ncForm #cf-tc .tooth[data-t=UL6]');
  await p.click('#ncForm #cf-tc [data-tool=nomove]'); await p.click('#ncForm #cf-tc .tooth[data-t=UR7]');
  await p.click(npm); await p.waitForTimeout(100); t = await teeth('#ncForm');
  check(nomove(t) === POST_U.split(',').filter(k => k !== 'UL6').join(',') && t.UL6.join() === 'missing', 'Upper only: just the upper back teeth; the missing UL6 is left alone');
  await p.click(npm); await p.waitForTimeout(100); t = await teeth('#ncForm');
  check(nomove(t) === 'UR7', 'untapping takes off only what it added (UR7, marked by hand before, stays)');
  // saved, then Edit: untapping a saved lock clears it
  await p.click('#ncForm .pickRow[data-g=treatArch] .pick[data-v=UL]'); await p.click('#ncForm #cf-tc [data-tq=clear]');
  await p.click(npm); await p.fill('#ncForm #cf-patient', 'Pax Posterlock'); await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=yes]');
  await p.click('#ncSave'); await p.waitForSelector('#ncForm', { state: 'detached', timeout: 5000 }).catch(() => {});
  const lid = await p.evaluate(() => (openCases().find(c => c.patient === 'Pax Posterlock') || {}).id);
  const lk = await p.evaluate(id => { const d = DEMO.cases.get(id); return { n: Object.keys(d.teeth || {}).filter(k => d.teeth[k].includes('nomove')).length, note: d.teethNote, ins: d.instructions }; }, lid);
  check(lk.n === 16 && /Don.t move: all posteriors/.test(lk.note) && /No posterior teeth movement/.test(lk.ins), 'saved: the instruction and the 16 back teeth Don’t move (“' + lk.note + '”)');
  check(/Don't move: all posteriors \(4-7\)/.test(await p.evaluate(id => chartNote(findCase(id)), lid)), 'the chart note carries “Don’t move: all posteriors (4-7)”');
  await p.evaluate(id => openDrawer(id), lid); await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-tc');
  await p.click('#drawer .pickRow[data-g=instrPicks] .pick[data-v="No posterior teeth movement"]'); await p.waitForTimeout(100);
  check(nomove(await teeth('#drawer')) === '', 'Edit: untapping it on a saved case takes the lock off the back teeth');
  await p.click('#drawer [data-act=cancelEdit]'); await p.evaluate(() => closeDrawer(true));
  // phones
  await p.setViewportSize({ width: 390, height: 844 });
  await newCase('appliance'); await p.click('#ncForm .pickRow[data-g=appliances] .pick[data-v="Hawley retainers"]'); await p.waitForTimeout(150);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= 390), 'phone: the Hawley questions fit, no sideways scrolling');
  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
