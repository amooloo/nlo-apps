// Practice on your own (Amir, 6 Oct 2026: "for training purposes, can you make a demo mode where nothing gets recorded and you can just play
// around?"): the practice copy without the tour — from My account, and from the sign-in screen. Made-up patients only.
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
const BASE = 'http://127.0.0.1:8765/nlo-cases.html';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } }); await routes(ctx);
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };

  console.log('\n# The sign-in screen: a way in for training');
  const s = await ctx.newPage(); watch(s, errs, 'signin');
  await s.goto(BASE); await s.waitForSelector('#lgUser', { timeout: 15000 });
  const lk = await s.evaluate(() => { const a = document.querySelector('#lgPractice'); return a ? { href: a.getAttribute('href'), target: a.target, text: a.closest('.lockFoot').textContent } : null; });
  check(lk && /\/nlo-cases\.html\?demo&practice=staff$/.test(lk.href) && lk.target === '_blank' && /made-up patients/.test(lk.text) && /nothing is saved/.test(lk.text), 'under Sign in: “Practice with made-up patients — for training, nothing is saved” (a new tab, no login needed)');
  await s.screenshot({ path: OUT + '/v53-signin.png' });
  const [pr] = await Promise.all([ctx.waitForEvent('page'), s.click('#lgPractice')]);
  watch(pr, errs, 'practice');
  await pr.waitForSelector('.tiles', { timeout: 15000 }); await pr.waitForTimeout(900);
  const st = await pr.evaluate(() => ({ me: B.me.name, owner: isOwner(), tour: !!document.querySelector('#tourCard'), bar: document.querySelector('#demoBar').textContent, sync: document.querySelector('#syncLine').textContent, n: openCases().length }));
  check(st.me === 'Practice User' && !st.owner && st.n > 10, 'it opens signed in, as a staff member, with made-up patients (' + st.n + ' open cases)');
  check(!st.tour, 'no tour: just play around');
  check(st.bar === 'Practice — made-up patients, nothing is saved' && st.sync === 'Practice · nothing saved', 'it says so at the bottom, and by the Lock button');
  await pr.screenshot({ path: OUT + '/v53-practice.png' });

  console.log('\n# Nothing is recorded: a fresh start any time');
  await pr.click('.topBar [data-act=newCase]'); await pr.waitForSelector('#ncForm');
  await pr.click('#ncForm .tt[data-tile=oliv]'); await pr.fill('#cf-patient', 'Trainee Tryout');
  await pr.click('#ncSave'); await pr.waitForSelector('#modalWrap', { state: 'detached', timeout: 5000 }).catch(() => {});
  check(await pr.evaluate(() => openCases().some(c => c.patient === 'Trainee Tryout')), 'a trainee’s case is there while they play');
  await pr.click('#nav-account'); await pr.waitForSelector('[data-act=practiceFresh]');
  const card = await pr.evaluate(() => ({ text: document.querySelector('[data-act=practiceFresh]').closest('.card').textContent, tour: document.querySelector('[data-act=tourOpen]').textContent }));
  check(/You’re in practice mode: made-up patients, and nothing you do here is saved/.test(card.text) && card.tour === 'Take the tour', 'My account (practice): Take the tour, and Fresh start');
  await pr.click('[data-act=practiceFresh]'); await pr.waitForSelector('.tiles', { timeout: 15000 }); await pr.waitForTimeout(400);
  check(await pr.evaluate(() => !openCases().some(c => c.patient === 'Trainee Tryout') && B.me.name === 'Practice User' && !document.querySelector('#tourCard')), 'Fresh start: the made-up patients as they were, still signed in, still no tour');
  await pr.click('#nav-account'); await pr.waitForSelector('[data-act=tourOpen]'); await pr.click('[data-act=tourOpen]');
  await pr.waitForFunction(() => TOUR.on && TOUR.steps[TOUR.i].id === 'hi', null, { timeout: 5000 }).catch(() => {});
  check(await pr.evaluate(() => TOUR.on && TOUR.steps[TOUR.i].id === 'hi'), 'Take the tour, from there: it starts right in this tab');
  await pr.close();

  console.log('\n# My account in the app: Take the tour, or Practice on my own');
  const p = await ctx.newPage(); watch(p, errs, 'app');
  await p.goto(BASE + '?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  await p.click('#nav-account'); await p.waitForSelector('[data-act=practiceOpen]');
  const acc = await p.evaluate(() => ({ text: document.querySelector('[data-act=practiceOpen]').closest('.card').textContent, btns: Array.from(document.querySelectorAll('[data-act=practiceOpen], [data-act=tourOpen]')).map(b => b.textContent) }));
  check(acc.btns.join(' | ') === 'Take the tour | Practice on my own' && /Take the 5-minute hands-on tour, or just play around/.test(acc.text), 'Tour & practice: Take the tour | Practice on my own');
  await p.screenshot({ path: OUT + '/v53-account.png' });
  const [pop] = await Promise.all([ctx.waitForEvent('page'), p.click('[data-act=practiceOpen]')]);
  watch(pop, errs, 'owner-practice');
  check(/nlo-cases\.html\?demo&practice=owner$/.test(pop.url()), 'Practice on my own opens the practice copy in its own tab — as Dr. A for Dr. A (' + pop.url().replace(/^.*\//, '') + ')');
  await pop.waitForSelector('.tiles', { timeout: 15000 }); await pop.waitForTimeout(900);
  check(await pop.evaluate(() => B.me.name === 'Dr. Akhavan' && isOwner() && !!document.querySelector('#nav-admin') && !document.querySelector('#tourCard')), 'signed in as Dr. A (Team & security, Workload…), no tour');
  await pop.close();

  const bad = errs.filter(e => !/Failed to load resource/.test(e));
  console.log(fails ? 'FAILURES' : 'ALL OK'); console.log('ERRORS: ' + (bad.length ? bad.join('\n') : 'none'));
  await browser.close(); process.exit(fails || bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
