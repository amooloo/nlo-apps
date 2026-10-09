// Messages: New / Read / Archive (Amir, 9 Oct 2026: "the messages should be removed once marked as read and then move to archive
// after 30 days. or they need to be grayed out or stamped or something because right now its not clear except for the fact
// that the badge is gone"). A read message leaves New, sits greyed out under Read with a "Read <when>" stamp for 30 days, then
// it's under Archive. Demo, made-up patients.
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } }); await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const badge = () => p.evaluate(() => { const e = document.querySelector('#nav-msgs .cnt'); return e && !e.classList.contains('hidden') ? +e.textContent : 0; });
  const tabs = () => p.$$eval('.msgTabs .chip', b => b.map(x => x.textContent.replace(/\s+/g, ' ').trim() + (x.classList.contains('on') ? '*' : '')).join(' | '));
  const rows = (sel) => p.$$eval(sel || '.msgList .msgRow', rs => rs.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  const tab = async k => { await p.click('#msgTab-' + k); await p.waitForSelector('#msgTab-' + k + '.on'); };

  console.log('\n# New: only what you haven’t read, each with a ✓');
  check(await badge() === 4, 'the menu says 4 new (' + await badge() + ')');
  await p.click('#nav-msgs'); await p.waitForSelector('.msgTabs');
  check(await tabs() === 'New4* | Read1 | Archive0', 'tabs: New 4 (picked), Read 1, Archive 0 (' + await tabs() + ')');
  check((await p.$$('.msgList .msgItem.new')).length === 4 && (await p.$$('.msgList .msgItem .msgChk')).length === 4 && !(await p.$('.msgList .msgRow.seen')),
    'New lists the 4 unread, each with its ✓ — the one already read isn’t there');
  check(!(await rows()).some(t => /thin edge/.test(t)), 'Angelika’s note (read yesterday) has left New');
  check(await p.textContent('.msgCard .cardHd h3') === 'Notes and stickers for you' && /4 new/.test(await p.textContent('.msgCard .cardHd .sub')), 'the card still says “Notes and stickers for you · 4 new”');
  await p.screenshot({ path: OUT + '/v58-new.png' });
  const tabsY = () => p.evaluate(() => Math.round(document.querySelector('.msgTabs').getBoundingClientRect().top)), y0 = await tabsY();

  console.log('\n# Read: greyed out, stamped with when it was read');
  await tab('read');
  const rd = await p.evaluate(() => { const r = document.querySelector('.msgList .msgRow.seen'); if (!r) return null; const cs = e => getComputedStyle(e);
    return { tx: r.textContent.replace(/\s+/g, ' '), stamp: (r.querySelector('.msgStamp') || {}).textContent || '', pt: cs(r.querySelector('.msgPt')).color, filt: cs(r.querySelector('.pav')).filter,
      op: cs(r.querySelector('.pav')).opacity, un: !!r.closest('.msgItem').querySelector('.msgUn'), chk: !!r.closest('.msgItem').querySelector('.msgChk'), foot: (document.querySelector('.msgFoot') || {}).textContent || '' }; });
  check(!!rd && /thin edge/.test(rd.tx) && /^Read (today|yesterday), \d/.test(rd.stamp), 'Angelika’s note, stamped “' + (rd && rd.stamp) + '”');
  check(!!rd && rd.pt === 'rgb(107, 118, 133)' && /grayscale\(1\)/.test(rd.filt) && rd.op === '0.5', 'greyed out: grey name, grey photo (' + (rd && [rd.pt, rd.filt, rd.op].join(' · ')) + ')');
  check(!!rd && rd.un && !rd.chk && /30 days after it was read/.test(rd.foot), 'Mark unread on it (no ✓), and “Each one moves to Archive 30 days after it was read.”');
  check(await tabsY() === y0, 'the tabs stay put when Mark all as read isn’t there (' + y0 + ' / ' + await tabsY() + ')');
  await p.screenshot({ path: OUT + '/v58-read.png' });

  console.log('\n# The ✓: out of New at once (Undo puts it back)');
  await tab('new');
  const first = await p.getAttribute('.msgList .msgItem.new', 'data-k');
  await p.click('.msgList .msgItem.new .msgChk');
  await p.waitForFunction(k => !document.querySelector('.msgList .msgItem[data-k="' + k + '"]'), first);
  check(await badge() === 3 && await tabs() === 'New3* | Read2 | Archive0', 'gone from New, under Read (' + await tabs() + '), the menu says 3');
  check(await p.evaluate(() => document.activeElement && document.activeElement.classList.contains('msgChk')), 'the keyboard stays on the list (the next row’s ✓)');
  check(/Marked as read/.test(await p.textContent('#toasts .toast')), 'a toast says so, with Undo');
  await p.click('#toasts .toast button:has-text("Undo")');
  await p.waitForSelector('.msgList .msgItem[data-k="' + first + '"]');
  check(await badge() === 4 && await tabs() === 'New4* | Read1 | Archive0', 'Undo: back under New (' + await tabs() + ')');

  console.log('\n# Opening one: the case opens; the message leaves New');
  const note = await p.evaluate(() => { const r = document.querySelector('.msgList .msgRow.new[data-act=msgOpen]'); return r && { id: r.dataset.id, n: r.dataset.n }; });
  await p.click('.msgList .msgRow.new[data-act=msgOpen]'); await p.waitForSelector('#drawer .cmt.flash', { timeout: 5000 }).catch(() => {});
  check(await p.isVisible('#drawer [data-note="' + note.n + '"]'), 'the case opens at the note');
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  check(!(await p.$('.msgList .msgItem[data-k="' + note.id + '/' + note.n + '"]')) && await badge() === 3, 'back on Messages: it’s no longer under New (3 left)');
  await tab('read');
  const st = await p.evaluate(k => { const i = document.querySelector('.msgList .msgItem[data-k="' + k + '"]'); return i ? i.querySelector('.msgStamp').textContent : ''; }, note.id + '/' + note.n);
  check(/^Read today, \d/.test(st), 'under Read: “' + st + '”');

  console.log('\n# Mark all as read, and Mark unread on one');
  await tab('new');
  await p.click('[data-act=msgAllRead]'); await p.waitForSelector('.msgNone');
  check(/You’re all caught up/.test(await p.textContent('.msgNone')) && await badge() === 0 && !(await p.$('[data-act=msgAllRead]')), 'New: “You’re all caught up”, no badge, no Mark all as read');
  check(await tabs() === 'New0* | Read5 | Archive0' && /3 messages marked as read/.test(await p.textContent('#toasts')), 'all five under Read; “3 messages marked as read” with Undo (' + await tabs() + ')');
  await tab('read');
  const stk = await p.getAttribute('.msgList .msgItem:has(.stkMsg)', 'data-k');
  await p.click('.msgList .msgItem[data-k="' + stk + '"] .msgUn');
  await p.waitForFunction(k => !document.querySelector('.msgList .msgItem[data-k="' + k + '"]'), stk);
  check(await badge() === 1 && await tabs() === 'New1 | Read4* | Archive0', 'Mark unread: the sticker goes back under New, the menu says 1 (' + await tabs() + ')');
  check(await p.evaluate(() => getComputedStyle(document.querySelector('#msgTab-new .c')).backgroundColor) === 'rgb(238, 79, 58)', 'the New tab’s count is red while you’re on another tab');
  await p.click('.msgList .msgItem .msgUn'); // (one more back, for the pictures)

  console.log('\n# Archive: 30 days after it was read — and one never opened');
  const arc = await p.evaluate(() => {
    const me = meSid(), open = openCases().filter(c => c.status === 'open'), a = open[7], b = open[8], d = 864e5;
    a.comments = (a.comments || []).concat([{ id: 'old1', at: Date.now() - 40 * d, by: 'sarah', text: '@Dr. A Partners confirmed the new shipping address.', to: [me] }]);
    b.comments = (b.comments || []).concat([{ id: 'old2', at: Date.now() - 45 * d, by: 'gwen', text: '@Dr. A can we move her delivery to the afternoon?', to: [me] },
      { id: 'old3', at: Date.now() - 20 * d, by: 'kaylee', text: '@Dr. A mom will bring the retainer case on Tuesday.', to: [me] }]);
    const m = JSON.parse(localStorage.getItem('nloCases.msgSeen.' + me)); m[a.id + '/old1'] = Date.now() - 31 * d; m[b.id + '/old3'] = Date.now() - 18 * d;
    localStorage.setItem('nloCases.msgSeen.' + me, JSON.stringify(m)); renderNav(); renderView();
    return { a: a.id + '/old1', b: b.id + '/old2', c: b.id + '/old3' };
  });
  await p.waitForTimeout(100);
  check(await tabs() === 'New2 | Read4* | Archive2', 'read 31 days ago and never opened at 45 days: both in Archive; read 18 days ago: under Read (' + await tabs() + ')');
  check(await badge() === 2, 'neither counts as new (the menu says 2)');
  await tab('arch');
  const ar = await p.evaluate(k => { const s = i => { const x = document.querySelector('.msgList .msgItem[data-k="' + i + '"]'); return x ? ((x.querySelector('.msgStamp') || {}).textContent || '(no stamp)') : null; };
    return { a: s(k.a), b: s(k.b), un: !!document.querySelector('.msgList .msgUn, .msgList .msgChk'), foot: (document.querySelector('.msgFoot') || {}).textContent || '' }; }, arc);
  check(/^Read [A-Z][a-z]{2} \d+$/.test(ar.a || '') && ar.b === '(no stamp)' && !ar.un, 'Archive: “' + ar.a + '” on the one read, no stamp on the one never opened here, no buttons');
  check(/Read more than 30 days ago, or not opened within 30 days/.test(ar.foot), 'Archive says what’s in it');
  await p.screenshot({ path: OUT + '/v58-archive.png' });
  await p.click('.msgList .msgItem[data-k="' + arc.b + '"] .msgRow'); await p.waitForSelector('#drawer [data-note="old2"]', { timeout: 5000 }).catch(() => {});
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  check(await tabs() === 'New2 | Read4 | Archive2*', 'opening the never-opened one from Archive leaves it there (it doesn’t jump to Read)');

  console.log('\n# Read marks kept before today (ids only) carry over as read');
  const mig = await p.evaluate(k => {
    const me = meSid(); localStorage.removeItem('nloCases.msgSeen.' + me); localStorage.setItem('nloCases.msgRead.' + me, JSON.stringify([k]));
    const r = msgRead(); return { has: r.has(k), t: r.get(k), saved: localStorage.getItem('nloCases.msgSeen.' + me), old: localStorage.getItem('nloCases.msgRead.' + me) };
  }, arc.c);
  check(mig.has && mig.t === 0 && JSON.parse(mig.saved)[arc.c] === 0 && mig.old === JSON.stringify([arc.c]), 'the older list is read in (time unknown), saved the new way, and left as it was');
  await p.evaluate(() => { renderNav(); renderView(); }); await tab('read');
  const ms = await p.evaluate(k => { const x = document.querySelector('.msgList .msgItem[data-k="' + k + '"] .msgStamp'); return x ? x.textContent : null; }, arc.c);
  check(ms === 'Read', 'its stamp just says “Read” (' + ms + ')');
  check(await badge() === 5 && await tabs() === 'New5 | Read1* | Archive2', 'the rest count as new again on this made-up computer (' + await tabs() + ')');

  console.log('\n# Phone');
  await p.setViewportSize({ width: 390, height: 844 }); await p.evaluate(() => { localStorage.setItem('nloCases.msgSeen.' + meSid(), '{}'); renderView(); }); await tab('new');
  await p.click('.msgList .msgItem.new .msgChk'); await p.waitForTimeout(150); await tab('read');
  const fit = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, it: Array.from(document.querySelectorAll('.msgItem')).every(i => i.getBoundingClientRect().right <= document.documentElement.clientWidth + 1) }));
  check(fit.sw <= fit.cw && fit.it, 'no sideways scrolling; every row fits (' + fit.sw + '/' + fit.cw + ')');
  const un = await p.evaluate(() => { const i = document.querySelector('.msgItem.seen'), r = i.querySelector('.msgRow').getBoundingClientRect(), u = i.querySelector('.msgUn').getBoundingClientRect(); return { rowW: Math.round(r.width), below: u.top >= r.bottom - 12, right: Math.round(r.right - u.right) }; });
  check(un.below && un.rowW > 300 && un.right < 4, 'phone: Mark unread sits under the message, which keeps the full width (' + JSON.stringify(un) + ')');
  await p.screenshot({ path: OUT + '/v58-phone.png' });

  const bad = errs.filter(e => !/Failed to load resource/.test(e));
  console.log(fails ? 'FAILURES' : 'ALL OK'); console.log('ERRORS: ' + (bad.length ? bad.join('\n') : 'none'));
  await browser.close(); process.exit(fails || bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
