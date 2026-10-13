// Read marks that stay read (Amir, 12 Oct 2026: "the messages on nlo case tracker keeps coming back as unread. i have marked
// the same message as read 3 times and it still showed as unread"). Demo, made-up patients, one browser:
//  - a ✓ on a message another tab already marked (the list on screen was behind) still takes it out of New;
//  - Mark all as read, the same;
//  - another tab on this computer marks one read, or unread: this tab's list and menu follow at once;
//  - the browser can't save (its storage is full): a ✓ still takes for this session, and it says so once.
// (Read marks following a person to their other computers and phone: test/e2e.js, against the emulators.)
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
const URL = (process.env.NLO_PAGE || 'http://127.0.0.1:8765/nlo-cases.html') + '?demo'; // (NLO_PAGE: another copy, e.g. the live one)
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const badge = p => p.evaluate(() => { const e = document.querySelector('#nav-msgs .cnt'); return e && !e.classList.contains('hidden') ? +e.textContent : 0; });
  const tabs = p => p.$$eval('.msgTabs .chip', b => b.map(x => x.textContent.replace(/\s+/g, ' ').trim() + (x.classList.contains('on') ? '*' : '')).join(' | '));
  const newKeys = p => p.$$eval('.msgList .msgItem.new', xs => xs.map(x => x.dataset.k));
  const gone = (p, k) => p.waitForFunction(k => !document.querySelector('.msgList .msgItem.new[data-k="' + k + '"]'), k, { timeout: 3000 }).catch(() => {});
  // as another tab would: straight into this browser's storage (a tab gets no event for its own writes, so this one is behind),
  // then the tap on the list as it is on screen — before anything else redraws it
  const tapBehind = (p, keys, sel) => p.evaluate(([ks, sel]) => {
    const k = 'nloCases.msgSeen.' + meSid(), o = JSON.parse(localStorage.getItem(k) || '{}'); ks.forEach(x => { o[x] = Date.now() - 60000; }); localStorage.setItem(k, JSON.stringify(o));
    const still = ks.every(x => document.querySelector('.msgList .msgItem.new[data-k="' + x + '"]'));
    document.querySelector(sel).click(); return still;
  }, [keys, sel]);
  const open = async (ctx, label) => { const p = await ctx.newPage(); watch(p, errs, label); await p.goto(URL); await p.click('#lgBtn'); await p.waitForSelector('.tiles'); return p; };

  const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } }); await routes(ctx);
  const a = await open(ctx, 'tabA');

  console.log('\n# A ✓ on one another tab already marked (the list here was behind): it still leaves New');
  await a.click('#nav-msgs'); await a.waitForSelector('.msgTabs');
  check(await tabs(a) === 'New4* | Read1 | Archive0' && await badge(a) === 4, 'Messages: New 4, Read 1 (' + await tabs(a) + ')');
  const k0 = (await newKeys(a))[0];
  check(await tapBehind(a, [k0], '.msgList .msgItem[data-k="' + k0 + '"] .msgChk'), 'another tab marked it read; this list was behind, still showing it under New, and its ✓ is tapped');
  await gone(a, k0);
  check(!(await newKeys(a)).includes(k0) && await badge(a) === 3 && await tabs(a) === 'New3* | Read2 | Archive0', 'one tap takes it out of New (' + await tabs(a) + ', menu says ' + await badge(a) + ')');
  check(/Marked as read/.test(await a.textContent('#toasts')), 'and says so');
  await a.screenshot({ path: OUT + '/v60-tick-behind.png' });

  console.log('\n# Mark all as read, when another tab had already marked them');
  const rest = await newKeys(a);
  check(await tapBehind(a, rest, '[data-act=msgAllRead]'), 'another tab marked the other three; this list still shows them, and Mark all as read is tapped');
  await a.waitForSelector('.msgList .msgNone', { timeout: 3000 }).catch(() => {});
  check((await newKeys(a)).length === 0 && await badge(a) === 0 && /all caught up/.test(await a.textContent('.msgList')), 'they all leave New: “You’re all caught up”, the menu clears');
  check(/3 messages marked as read/.test(await a.textContent('#toasts')), '“3 messages marked as read”, with Undo');

  console.log('\n# Another tab on this computer: this one follows at once');
  // (a tab out of sight redraws its list when it's looked at again — the browser holds its drawing back meanwhile — so each
  // check brings the tab it looks at to the front, as a person switching tabs would)
  const look = async (p, tabsWant) => { await p.bringToFront(); await p.waitForFunction(w => Array.from(document.querySelectorAll('.msgTabs .chip')).map(x => x.textContent.replace(/\s+/g, ' ').trim() + (x.classList.contains('on') ? '*' : '')).join(' | ') === w, tabsWant, { timeout: 3000 }).catch(() => {}); };
  const b = await open(ctx, 'tabB'); // (practice mode starts over: one read, the rest new — tab A follows that too)
  await look(a, 'New4* | Read1 | Archive0');
  check(await badge(a) === 4 && await tabs(a) === 'New4* | Read1 | Archive0', 'tab B opens practice mode afresh: tab A’s list follows (' + await tabs(a) + ')');
  await b.click('#nav-msgs'); await b.waitForSelector('.msgTabs');
  const kb = (await newKeys(b))[1];
  await b.click('.msgList .msgItem[data-k="' + kb + '"] .msgChk'); await look(a, 'New3* | Read2 | Archive0');
  check(!(await newKeys(a)).includes(kb) && await badge(a) === 3 && await tabs(a) === 'New3* | Read2 | Archive0', 'tab B ticks one: it leaves tab A’s New at once (' + await tabs(a) + ', menu ' + await badge(a) + ')');
  await a.click('#msgTab-read'); await a.waitForSelector('#msgTab-read.on');
  await a.click('.msgList .msgItem[data-k="' + kb + '"] .msgUn'); await look(b, 'New4* | Read1 | Archive0');
  check((await newKeys(b)).includes(kb) && await badge(b) === 4, 'tab A marks it unread: it’s back under tab B’s New at once (menu ' + await badge(b) + ')');
  await b.screenshot({ path: OUT + '/v60-other-tab.png' });
  await ctx.close();

  console.log('\n# The browser can’t save (its storage is full): a ✓ still takes, and it says so once');
  const ctx2 = await browser.newContext({ viewport: { width: 1360, height: 950 } }); await routes(ctx2);
  await ctx2.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (/nloCases\.msg(Seen|Unseen)\./.test(k)) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return set.call(this, k, v); };
  });
  const c = await open(ctx2, 'full');
  await c.click('#nav-msgs'); await c.waitForSelector('.msgTabs');
  const n0 = (await newKeys(c)).length, kc = (await newKeys(c))[0];
  await c.click('.msgList .msgItem[data-k="' + kc + '"] .msgChk'); await gone(c, kc);
  check(n0 > 1 && !(await newKeys(c)).includes(kc) && (await newKeys(c)).length === n0 - 1 && await badge(c) === n0 - 1, 'the ✓ takes it out of New all the same (' + n0 + ' → ' + (await newKeys(c)).length + ')');
  check(/couldn’t save your read marks/.test(await c.textContent('#toasts')), 'a toast says this browser couldn’t save them');
  await c.click('.msgList .msgItem.new .msgChk'); await c.waitForTimeout(300);
  check((await newKeys(c)).length === n0 - 2 && await c.evaluate(() => (document.getElementById('toasts').textContent.match(/couldn’t save your read marks/g) || []).length) === 1, 'the next ✓ takes too, and the warning isn’t said twice');
  await c.click('#nav-today'); await c.click('#nav-msgs'); await c.waitForSelector('.msgTabs');
  check((await newKeys(c)).length === n0 - 2, 'away and back: still read in this session');
  await c.screenshot({ path: OUT + '/v60-full.png' });
  await ctx2.close();

  const bad = errs.filter(e => !/favicon|fonts/.test(e));
  check(!bad.length, 'no page errors' + (bad.length ? ': ' + bad.join(' | ') : ''));
  await browser.close();
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
