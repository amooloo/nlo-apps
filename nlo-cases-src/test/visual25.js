// Amir, 3 Oct 2026: his Allied Star and iTero pictures for the scanner types — as drawers ("have them halfway hidden and when
// you hover over them they will fully move up, almost like you are picking them from a drawer"), the scanner in the case's
// Details linking to where its scans are ("myitero.com or allied-star"), and tiles that come alive on hover — demo
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
  // each drawer: its wand (picture, how far it's out, its tilt) and its front
  const row = root => p.$$eval(root + ' .pickRow[data-g=scanner] .pick', bs => bs.map(b => {
    const i = b.querySelector('img.scanWand'), r = i && i.getBoundingClientRect(), br = b.getBoundingClientRect(), f = b.querySelector('.scanFront'), fr = f.getBoundingClientRect(), m = i && new DOMMatrix(getComputedStyle(i).transform);
    return { v: b.dataset.v, text: b.textContent.trim(), on: b.getAttribute('aria-pressed'), k: i && i.dataset.pic, ok: !!i && i.complete && i.naturalWidth > 0, h: i && Math.round(i.offsetHeight),
      lift: m ? Math.round(m.m42) : null, tilt: m ? Math.round(Math.atan2(m.m12, m.m11) * 180 / Math.PI) : null, hidden: r ? Math.round(Math.max(0, r.bottom - fr.top)) : null,
      front: getComputedStyle(f).backgroundColor, bw: Math.round(br.width), bh: Math.round(br.height) }; }));
  const settle = () => p.waitForTimeout(700);

  // ---- New case: the two drawers; the picked one's wand is out, the other half in
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=oliv]'); await p.waitForTimeout(120);
  const sr = await p.$('#ncForm .pickRow[data-g=scanner]'); await sr.evaluate(e => e.scrollIntoView({ block: 'center' })); await p.mouse.move(5, 5); await settle();
  let r = await row('#ncForm'); console.log('   ' + JSON.stringify(r));
  check(r.length === 2 && r.map(x => x.v + '=' + x.text).join('|') === 'Allied Star=Allied Star|iTero=iTero', 'two drawers: Allied Star and iTero (a new aligner case starts on Allied Star, as before)');
  check(r[0].k === 'scanv-allied' && r[1].k === 'scanv-itero' && r.every(x => x.ok && x.h === 114), 'each has its wand standing up (Amir’s pictures, loaded)');
  check(r[0].on === 'true' && r[0].lift === 0 && r[0].tilt === 0 && r[0].hidden <= 2, 'the picked one (Allied Star) is out of its drawer, standing straight');
  check(r[1].on === 'false' && r[1].lift === 57 && r[1].tilt === -7 && r[1].hidden >= 50 && r[1].hidden <= 64, 'the other (iTero) is half in its drawer, leaning (' + r[1].hidden + ' px behind the front)');
  check(r[0].front === 'rgb(100, 244, 201)' && r[1].front !== r[0].front, 'the picked drawer’s front is mint, with a ✓');
  const b = await sr.boundingBox(); const clip = { x: b.x - 16, y: b.y - 34, width: 300, height: b.height + 44 };
  await p.screenshot({ path: OUT + '/v25-drawers.png', clip });
  // pointing at the iTero lifts it out; moving away lets it back in
  await p.hover('#ncForm .scanPick[data-v=iTero]'); await settle();
  r = await row('#ncForm');
  check(r[1].lift === 0 && r[1].tilt === 0 && r[1].on === 'false', 'pointing at the iTero lifts it all the way out (not picked yet)');
  await p.screenshot({ path: OUT + '/v25-drawers-hover.png', clip });
  await p.mouse.move(5, 5); await settle();
  check((await row('#ncForm'))[1].lift === 57, 'moving away lets it back into its drawer');
  // the keyboard lifts it too
  await p.focus('#ncForm .scanPick[data-v=iTero]'); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab'); await settle();
  check((await row('#ncForm'))[1].lift === 0, 'tabbing to it lifts it too');
  // tapping picks it: it stays out, Allied Star goes back in
  await p.click('#ncForm .scanPick[data-v=iTero]'); await p.mouse.move(5, 5); await p.evaluate(() => document.activeElement.blur()); await settle();
  r = await row('#ncForm');
  check(r[1].on === 'true' && r[1].lift === 0 && r[0].on === 'false' && r[0].lift === 57 && await p.evaluate(() => readCaseForm(document.querySelector('.modal')).scanner) === 'iTero', 'picking the iTero: it stays out, Allied Star goes back in; the case gets iTero');
  await p.screenshot({ path: OUT + '/v25-drawers-itero.png', clip });

  // ---- tiles come alive on hover: the tile lifts, its picture pops
  const tt = '#ncForm .tt[data-tile=appliance]';
  await p.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'center' }), tt); await p.mouse.move(5, 5); await p.waitForTimeout(300);
  const lift = s => p.$eval(s, e => Math.round(new DOMMatrix(getComputedStyle(e).transform).m42));
  check(await lift(tt) === 0, 'tiles sit still until pointed at');
  await p.hover(tt); await settle();
  const pop = await p.$eval(tt, e => ({ anim: getComputedStyle(e.querySelector('.tmed > *')).animationName, scale: new DOMMatrix(getComputedStyle(e.querySelector('.tmed > *')).transform).a }));
  check(await lift(tt) === -3 && pop.anim === 'tilePop' && pop.scale > 1.04 && pop.scale < 1.08, 'pointing at a case-type tile lifts it 3 px and its picture pops (with a little wiggle)');
  await p.hover('#ncForm .pick.itile'); await settle();
  check(await lift('#ncForm .pick.itile') === -3 && await p.$eval('#ncForm .pick.itile .isvg', e => getComputedStyle(e).animationName) === 'tilePop', 'Dr. A’s instruction tiles too');
  await p.click('.modal [data-act=closeModal]');
  await p.hover('.tiles .tile'); await settle();
  check(await lift('.tiles .tile') === -3, 'and the Today count tiles');
  // "reduce motion" on that computer: no animation
  await p.emulateMedia({ reducedMotion: 'reduce' }); await p.mouse.move(5, 5); await p.waitForTimeout(300);
  await p.hover('.tiles .tile'); await p.waitForTimeout(400);
  check(await lift('.tiles .tile') === 0, 'with “reduce motion” turned on, nothing moves');
  await p.emulateMedia({ reducedMotion: 'no-preference' });

  // ---- the case's Details: the scanner links to where its scans are (copies the name, like the portals)
  const id = await p.evaluate(() => openCases().find(c => c.scanner === 'Allied Star').id);
  await p.evaluate(id => openDrawer(id), id); await p.waitForSelector('#drawer .kv');
  const det = () => p.evaluate(() => { const v = Array.from(document.querySelectorAll('#drawer .kv > div')).find(d => d.querySelector('.k').textContent === 'Scanner').querySelector('.v'), a = v.querySelector('a.scanLink'), i = v.querySelector('img.scanIc');
    return { text: v.textContent, href: a && a.getAttribute('href'), target: a && a.target, rel: a && a.rel, act: a && a.dataset.act, title: a && a.title, k: i && i.dataset.pic, ok: !!i && i.complete && i.naturalWidth > 0, h: i && Math.round(i.getBoundingClientRect().height) }; });
  let d = await det();
  check(d.text === 'Allied Star' && d.href === 'https://asconnect.allied-star.com/' && d.target === '_blank' && /noopener/.test(d.rel) && d.act === 'portal', 'Details: “Allied Star” links to AlliedStar’s AS Connect (new tab; copies the patient’s name like the portals)');
  check(d.k === 'scan-allied' && d.ok && d.h === 22 && /AS Connect/.test(d.title), 'with its small picture, and a tooltip saying where it goes');
  const kvd = await p.evaluateHandle(() => Array.from(document.querySelectorAll('#drawer .kv > div')).find(d => d.querySelector('.k').textContent === 'Scanner'));
  await kvd.screenshot({ path: OUT + '/v25-details.png' });
  const it = await p.evaluate(() => { const c = openCases().find(c => c.scanner === 'Allied Star' && c.id !== S.openId); c.scanner = 'iTero'; DEMO.cases.get(c.id).scanner = 'iTero'; return c.id; });
  await p.evaluate(id => { closeDrawer(true); openDrawer(id); }, it); await p.waitForSelector('#drawer .kv');
  d = await det();
  check(d.text === 'iTero' && d.href === 'https://myitero.com/' && d.k === 'scan-itero' && /MyiTero/.test(d.title), 'an iTero case links to MyiTero (myitero.com)');
  // Edit: the drawers, the case's scanner out
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer .pickRow[data-g=scanner]'); await p.mouse.move(5, 5); await settle();
  r = await row('#drawer');
  check(r.every(x => x.ok) && r[1].on === 'true' && r[1].lift === 0 && r[0].lift === 57, 'Edit: the same drawers, the case’s scanner (iTero) out');
  await p.click('#drawer [data-act=cancelEdit]');
  // a case with no scanner: just the dash
  const none = await p.evaluate(() => (openCases().find(c => !c.scanner) || {}).id);
  await p.evaluate(id => { closeDrawer(true); openDrawer(id); }, none); await p.waitForSelector('#drawer .kv');
  check(await p.evaluate(() => { const v = Array.from(document.querySelectorAll('#drawer .kv > div')).find(d => d.querySelector('.k').textContent === 'Scanner').querySelector('.v'); return !v.querySelector('img,a') && v.textContent === '—'; }), 'no scanner: no picture or link, just “—”');

  // ---- phone: the drawers fit; tapping picks
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(() => { closeDrawer(true); newCaseModal(); }); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=nla]'); await p.waitForTimeout(120);
  r = await row('#ncForm');
  check(r.every(x => x.ok && x.bw === 118) && await p.evaluate(() => document.documentElement.scrollWidth <= 390), 'phone: both drawers fit, no sideways scrolling');
  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
