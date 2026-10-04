// Logic sweep, 4 Oct 2026 (Amir: "do a sweep of the case tracker app and make sure all the logics makes sense") — what it fixed,
// so it stays fixed: Edit keeps a case's step when its type tile is tapped; the Retainer and Metal Rx rules (stale pontic / spring
// circles, the shade first and cut-off lines in full in the special instructions, an arch's parts going with its retainer, the usual
// fitted to the case, the mismatch warnings, space maintainers, the acrylic color); then Amir's answers: finger springs go to
// Specialty with the Hawleys, Specialty's "Daily Case Summary" emails update cases, and upper & lower attachment templates are 2.
// Demo (made-up patients). The Specialty summary below copies the markup of the real email (each cell's words in a <div>, a <br>).
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const cell = (w, txt, head) => '<td width="' + w + '"' + (head ? ' bgcolor="#ffffff"' : '') + '><font size="2" color="#000000" face="Arial">\r\n<div align="center"><font size="' + (head ? 4 : 3) + '" face="calibri">' + (head ? '<b>' + txt + '</b>' : txt) + '</font></div>\r\n</font>\r\n</td>\r\n';
const table = (ws, heads, rows) => '<div align="center"><table border="1" cellpadding="1" cellspacing="2">\r\n<tbody><tr valign="top">\r\n' + heads.map((h, i) => cell(ws[i], h, true)).join('') + '</tr>\r\n' +
  (rows.length ? rows : [heads.map(() => '')]).map(r => '<tr valign="top">\r\n' + r.map((v, i) => cell(ws[i], v ? v + '<br>' : '')).join('') + '</tr>\r\n').join('') + '</tbody></table>\r\n</div>\r\n';
const heading = t => '<div align="center"><font size="5" face="calibri"><b><u>' + t + '</u></b></font></div>\r\n<div align="center"><font size="3" face="calibri"><u><br></u></font></div>\r\n';
function specialtySummary({ received = [], shipped = [], hold = [] } = {}) {
  const trk = t => t ? '<a href="http://www.ShippingCarrier.com" target="_blank"><font size="3" color="#0000ff" face="calibri"><u>' + t + '</u></font></a>' : '';
  return '<div bgcolor="#ffffff" alink="#ff0000">\r\n<font size="2" color="#000000" face="Arial">\r\n<div align="center"><img width="619" height="135" src="cid:logo"></div>\r\n' +
    '<div align="center"><table border="1" cellpadding="1" cellspacing="2" bgcolor="#ffffff">\r\n<tbody><tr valign="top">\r\n<td width="746"><font size="2" color="#000000" face="Arial">\r\n<div align="center"><font size="4" face="calibri"><b>Next Level Orthodontics - Dr.   Amir Akhavan</b></font></div>\r\n</font>\r\n</td>\r\n</tr>\r\n' +
    '<tr valign="top">\r\n<td width="746"><font size="2" color="#000000" face="Arial">\r\n<div align="center"><font size="4" face="calibri">Daily Case Summary Alert for: 10-03-2026 11:59 PM</font></div>\r\n</font>\r\n</td>\r\n</tr>\r\n</tbody></table>\r\n</div>\r\n' +
    heading(received.length ? 'Cases Received Today' : 'No Cases Received Today') + table([428, 318, 318], ['Patient Name', 'Case Number', 'Due Date'], received) +
    heading(shipped.length ? 'Cases Shipped Today' : 'No Cases Shipped Today') + table([294, 134, 209, 102], ['Patient Name', 'Invoice Number', 'Tracking Number', 'Carrier'], shipped.map(r => [r[0], r[1], trk(r[2]), r[3]])) +
    heading(hold.length ? 'Cases On Hold' : 'No Cases On Hold') + table([223, 174, 164, 388], ['Patient Name', 'Case Number', 'Hold Date', 'Hold Reason'], hold) +
    '<div align="center"><font size="3" face="calibri">If you have any questions or comments, please contact our laboratory at <a href="tel:(800)%20522-4636">1-800-522-4636</a> or email us at </font><a href="mailto:customerservice@specialtyappliances.com"><font size="3" color="#0000ff" face="calibri"><u>customerservice@specialtyappliances.com</u></font></a></div>\r\n' +
    '<div align="center"><font size="3" face="calibri">Thank you for your business.</font></div>\r\n</font>\r\n</div>';
}
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } }); await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };

  console.log('\n# Edit keeps the case’s step when its type tile is tapped');
  const pick = await p.evaluate(() => { const c = Array.from(S.cases.values()).find(x => typeOf(x).flow === 'outside' && stageIndex(x) >= 2 && x.status !== 'done'); return { id: c.id, type: c.type, stage: c.stage }; });
  await p.evaluate(id => openDrawer(id), pick.id);
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-stage');
  await p.click('#drawer .tt[data-tile="' + pick.type + '"]');
  check(await p.inputValue('#drawer #cf-stage') === pick.stage, 'its own tile tapped again: still ' + pick.stage);
  const other = pick.type === 'angel' ? 'oliv' : 'angel';
  await p.click('#drawer .tt[data-tile="' + other + '"]');
  check(await p.inputValue('#drawer #cf-stage') === pick.stage, 'switched to ' + other + ' (the same steps): still ' + pick.stage);
  await p.click('#drawer [data-act=saveEdit]'); await p.waitForTimeout(400);
  const saved = await p.evaluate(id => { const c = findCase(id); return { type: c.type, stage: c.stage }; }, pick.id);
  check(saved.type === other && saved.stage === pick.stage, 'saved at its step: ' + JSON.stringify(saved));
  await p.evaluate(() => closeDrawer(true));
  const ap = await p.evaluate(() => { const c = Array.from(S.cases.values()).find(x => x.type === 'appliance' && x.status !== 'done'); c.stage = 'mfg'; return c.id; });
  await p.evaluate(id => openDrawer(id), ap); await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-stage');
  await p.click('#drawer .tt[data-tile="marpe"]');
  check(await p.inputValue('#drawer #cf-stage') === 'approved', 'an appliance in Manufacturing switched to MARPE: Design approved');
  await p.click('#drawer .tt[data-tile="appliance"]');
  check(await p.inputValue('#drawer #cf-stage') === 'mfg', '… and back to Appliance: Manufacturing again');
  await p.click('#drawer [data-act=cancelEdit]'); await p.evaluate(() => closeDrawer(true));
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=appliance]'); await p.click('#ncForm .pickRow[data-g=appliances] .pick[data-v="D2 distalizer"]');
  const d2 = await p.inputValue('#ncForm #cf-stage'); await p.click('#ncForm .tt[data-tile=oliv]');
  check(d2 === 'mfg' && await p.inputValue('#ncForm #cf-stage') === 'submit', 'New case still starts at the type’s first step (D2 in Manufacturing, then Oliv at To submit)');
  await p.evaluate(() => closeModal());

  console.log('\n# Retainer Rx');
  const r = await p.evaluate(() => {
    const out = {};
    let rx = rxCanon({ form: RX_RET, designU: 'hawley', teeth: { UR2: 'pontic' } }); out.flag0 = (rx.acrU || []).includes('pontic');
    rxrTap('UR2', rx, 'adams'); rx = rxCanon(rx); out.flag1 = (rx.acrU || []).includes('pontic'); out.needs = rxNeeds(rx).length; out.pontLine = rxEstimate(rx, {}).lines.some(l => /Pontic/.test(l.l));
    let rx2 = rxCanon({ form: RX_RET, designU: 'hawley', teeth: { UR6: 'finger' } }); rxrClick('claspU', 'adams', true, rx2); rx2 = rxCanon(rx2); out.finger = rx2.teeth.UR6 === 'finger' && rx2.teeth.UL6 === 'adams';
    const c = { patient: 'Test Patient', appliances: ['Hawley retainers'], arches: ['Upper'], type: 'appliance', lab: LAB_SPEC };
    out.pontic = rxFill(c, rxCanon({ form: RX_RET, designU: 'hawley', teeth: { UR2: 'pontic', UR1: 'pontic', UL1: 'pontic', UL2: 'pontic' }, ponticTxt: 'A2' })).txt.map(t => t.s).filter(s => /A2/.test(s));
    const rx4 = rxCanon({ form: RX_RET, designU: 'hawley', accU: ['solder'], solderTxt: 'UR3 tip labially 2 mm with a helix' });
    out.solder = rxFill(c, rx4).txt.map(t => t.s).filter(s => /UR3/.test(s)); rx4.accU = []; out.solderOff = rxFill(c, rxCanon(rx4)).txt.map(t => t.s).filter(s => /UR3/.test(s));
    let rx6 = rxCanon({ form: RX_RET, designU: 'hawley', designL: 'hawley', accL: ['solder'], acrL: ['abp'], colorL: 'Silver glitter', teeth: { LR6: 'adams', LL6: 'adams' } });
    rx6.designL = ''; rxrAfter('designL', 'hawley', false, 'hawley', rx6); rx6 = rxCanon(rx6);
    out.lowerGone = !rx6.accL && !rx6.acrL && !rx6.colorL && !Object.keys(rx6.teeth || {}).some(id => id[0] === 'L') && !rxEstimate(rx6, c).lines.some(l => /lower/.test(l.l));
    const rx7 = rxCanon({ form: RX_RET, irU: 'single', colorU: 'Silver glitter', colorL: 'Silver glitter' });
    out.noColor = !rxFill(c, rx7).box.some(b => /color/.test(b)) && !rxEstimate(rx7, c).lines.some(l => /glitter/i.test(l.l));
    const usual = rxCanon({ form: RX_RET, designU: 'hawley', designL: 'hawley', teeth: { UR6: 'adams', UL6: 'adams', LR6: 'adams', LL6: 'adams' } });
    const up = rxCanon(rxrForCase({ appliances: ['Hawley retainers'], arches: ['Upper'] }, JSON.parse(JSON.stringify(usual)), usual));
    out.upper = up.designU === 'hawley' && !up.designL && !Object.keys(up.teeth).some(id => id[0] === 'L');
    const fs = rxCanon(rxrForCase({ appliances: ['Finger spring with no labial bow'], arches: [] }, JSON.parse(JSON.stringify(usual)), usual));
    out.flipper = fs.designU === 'flipper' && (fs.accU || []).includes('finger') && !fs.designL;
    out.mm = [rxrMismatch({ appliances: ['Hawley retainers'], arches: ['Upper'] }, usual), rxrMismatch({ appliances: ['Hawley retainers'], arches: ['Upper', 'Lower'] }, rxCanon({ form: RX_RET, designU: 'hawley' })), rxrMismatch({ appliances: ['Hawley retainers'], arches: ['Upper', 'Lower'] }, usual)];
    out.nfc = rxText('José');
    return out;
  });
  check(r.flag0 && !r.flag1 && r.needs === 0 && !r.pontLine, 'a pontic swapped for an Adams: its circle goes, no shade asked, not charged');
  check(r.finger, 'the Adams row leaves a finger spring on its 6');
  check(r.pontic.length === 1 && r.pontic[0] === 'A2 (#7, #8, #9, #10)', 'four pontics: the shade prints first — ' + JSON.stringify(r.pontic));
  check(r.solder.length === 2 && r.solder.some(s => /…$/.test(s)) && r.solder.includes('Soldered spring: UR3 tip labially 2 mm with a helix'), 'a typed line too long for the paper: cut there, in full in the special instructions');
  check(r.solderOff.length === 0, 'a typed line whose choice is unticked isn’t printed');
  check(r.lowerGone, 'the lower retainer taken off: its spring, bite plane, glitter and clasps go (form and cost)');
  check(r.noColor, 'a color with only a clear retainer: not ticked, not charged');
  check(r.upper, 'the usual fitted to an upper-only case leaves the lower off');
  check(r.flipper, 'a finger spring on its own starts as a flipper with the finger spring');
  check(/lower retainer.*upper only/.test(r.mm[0]) && /No lower retainer/.test(r.mm[1]) && r.mm[2] === '', 'the Rx says when it no longer matches the case’s Hawley arches');
  check(r.nfc === 'José', 'accents pasted as separate marks print as letters');

  console.log('\n# Metal Rx');
  const m = await p.evaluate(() => {
    const out = {};
    let rx = rxCanon({ form: RX_MET }); rxmTap('UR6', rx, 'sm'); rx = rxCanon(rx); rxmClick('hold', 'tpa', true, rx); rx = rxCanon(rx); out.tpa = rx.teeth;
    let r2 = rxmStartFor(RXM_US.rpe); rxmTap('UR6', r2, 'sm'); r2 = rxCanon(r2); rxmClick('hold', 'sm', false, r2); r2 = rxCanon(r2); out.rpe = r2.teeth;
    out.colorAcc = (rxCanon({ form: RX_MET, exp: ['hyrax'], acc: ['color'] }).acc || []).includes('color');
    const e4 = rxEstimate(rxCanon({ form: RX_MET, exp: ['hyrax'], colorTxt: 'Tie dye' }), {}); out.tie = !e4.lines.some(l => /Tie dye/.test(l.l)) && e4.missing.some(x => /Tie dye/.test(x));
    out.unused = rxmMismatch({ appliances: ['Other metal appliance'] }, rxCanon({ form: RX_MET, other: ['xbow'] }));
    out.p3d = [rxFill({ patient: 'X' }, rxCanon({ form: RX_MET, exp: ['acrylic'], printed3d: true })).box.includes('printed3d'), rxFill({ patient: 'X' }, rxCanon({ form: RX_MET, exp: ['hyrax'], printed3d: true, teeth: { UR6: 'band', UL6: 'band' } })).box.includes('printed3d')];
    return out;
  });
  check(!m.tpa.UR6 && m.tpa.UR7 === 'band' && m.tpa.UL6 === 'band', 'a space maintainer, then a TPA: no band on the space');
  check(m.rpe.UR6 === 'band' && m.rpe.UL6 === 'band' && !m.rpe.UR7, 'an RPE’s space maintainer unticked: the band goes back on UR6');
  check(!m.colorAcc && m.tie, 'the Acrylic Color circle follows the typed color; a custom design isn’t priced as free');
  check(/Xbow.*doesn’t use/.test(m.unused), 'an Xbow on an older Rx is flagged');
  check(!m.p3d[0] && m.p3d[1], 'the 3D printed circle only with bands or crowns');

  console.log('\n# Finger springs go to Specialty (Amir, 4 Oct 2026)');
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=appliance]'); await p.click('#ncForm .pickRow[data-g=appliances] .pick[data-v="Finger spring with no labial bow"]');
  check(await p.getAttribute('#ncForm .pickRow[data-g=lab] .pick[data-v="Specialty Orthodontic Lab"]', 'aria-pressed') === 'true' && await p.isVisible('#ncForm #cf-rxRetSec'), 'a finger spring picks Specialty, and its Retainer Rx shows');
  await p.click('#ncForm .pickRow[data-g=appliances] .pick[data-v="Hawley retainers"]');
  check(!/different labs/.test(await p.textContent('#cf-labHint')), 'Hawley retainers and a finger spring: one lab, one case');
  await p.evaluate(() => closeModal());

  console.log('\n# Specialty’s Daily Case Summary (Amir, 4 Oct 2026: "yes I want specialty added")');
  const from = 'Specialty Appliances Notifications <noreply@specialtyappliances.com>';
  const parse = html => p.evaluate(([h, f]) => mailParse({ from: f, subject: 'Daily Case Summary', html: h, text: '' }), [html, from]);
  const holdOnly = specialtySummary({ hold: [['Wanda Z.', '8800001', '10-01-2026', 'Missing Scan']] });
  const e1 = await parse(holdOnly);
  check(e1.length === 1 && e1[0].co === 'specialty' && e1[0].kind === 'hold' && e1[0].name === 'Wanda Z.' && e1[0].ref === '8800001' && e1[0].holdDate === '10-01-2026' && e1[0].reason === 'Missing Scan', 'the real layout: a hold is read (name, case #, date, reason)');
  const e2 = await parse(specialtySummary({ received: [['Olin T.', '8800010', '10-09-2026'], ['Pia R.', '8800011', '10-10-2026']], shipped: [['Quill B.', '554433', '1Z999AA10123456784', 'UPS']] }));
  check(e2.filter(e => e.kind === 'received').map(e => e.name + '#' + e.ref).join(',') === 'Olin T.#8800010,Pia R.#8800011' && e2.some(e => e.kind === 'shipped' && e.name === 'Quill B.' && e.tracking === '1Z999AA10123456784' && e.carrier === 'UPS'), 'received and shipped rows are read, with the tracking # and carrier');
  // the same email inside a layout table, its first section right at the top of the outer cell (no header table before it)
  const bare = specialtySummary({ received: [['Olin T.', '8800010', '10-09-2026']] }).replace(/<div align="center"><img[\s\S]*?<\/tbody><\/table>\r\n<\/div>\r\n/, '');
  const e3 = await parse('<table width="100%"><tr><td align="center">' + bare + '</td></tr></table>');
  check(e3.length === 1 && e3[0].kind === 'received' && e3[0].name === 'Olin T.' && e3[0].ref === '8800010', 'inside a layout table, the first section is still read');
  check((await p.evaluate(() => mailParse({ from: 'general@partnersdentalstudio.com', subject: 'x', text: '', html: '<p>Cases Shipped Today</p><table><tr><th>Patient Name</th><th>Invoice Number</th><th>Tracking Number</th><th>Carrier</th></tr><tr><td>Robin T.</td><td>228700</td><td>1Z999AA10123456785</td><td>UPS</td></tr></table>' }))).map(e => e.name).join() === 'Robin T.', 'Partners’ summary still reads');
  check(await p.evaluate(() => MAIL_SENDERS.includes('specialtyappliances.com')), 'the email script’s sender list includes specialtyappliances.com');
  const cid = await p.evaluate(() => B.createCase({ type: 'appliance', patient: 'Wanda Zephyr', appliances: ['Herbst'], lab: LAB_SPEC, stage: 'mfg', comments: [], createdAt: Date.now(), createdBy: meSid() }));
  const pid = await p.evaluate(() => B.createCase({ type: 'appliance', patient: 'Wanda Zander', appliances: ['MARPE'], lab: LAB_PART, stage: 'submitted', comments: [], createdAt: Date.now(), createdBy: meSid() }));
  await p.waitForTimeout(400);
  const inbox = (id, html) => p.evaluate(([i, h, f]) => { DEMO.mail.inbox.push({ id: i, at: Date.now(), done: [], mail: { box: 'records@example.com', from: f, subject: 'Daily Case Summary', date: Date.now(), text: '', html: h } }); DEMO.h.inbox(); }, [id, html, from]);
  await inbox('spec1', holdOnly); await p.waitForTimeout(2000);
  let c = await p.evaluate(id => { const c = findCase(id); return { stage: c.stage, labRef: c.labRef, hold: c.labHold, ref: refLabel(c) }; }, cid);
  check(c.hold && c.hold.date === '10-01-2026' && c.hold.reason === 'Missing Scan' && c.labRef === '8800001' && c.ref === 'Specialty case #', 'the Specialty case: lab hold flagged and its Specialty case # saved');
  check(await p.evaluate(id => !findCase(id).labHold, pid), '… not the Partners case with a matching name');
  await inbox('spec2', specialtySummary({ shipped: [['Wanda Z.', '554499', '1Z999AA10123456786', 'UPS']] })); await p.waitForTimeout(2000);
  c = await p.evaluate(id => { const c = findCase(id); return { stage: c.stage, tracking: c.tracking, hold: c.labHold }; }, cid);
  check(c.stage === 'shipped' && /1Z999AA10123456786/.test(c.tracking || '') && !c.hold, 'a later summary: shipped — moves to Shipped with the tracking #, and the hold clears');
  check(await p.evaluate(id => findCase(id).stage, pid) === 'submitted', 'the Partners case stays where it was');

  console.log('\n# Aligner labels: upper & lower attachment templates are 2 (Amir, 4 Oct 2026)');
  const lb = await p.evaluate(() => {
    const base = { patient: 'Test', setType: 'Initial Set', uOn: true, lOn: true, uTotal: 10, lTotal: 8, uStart: 1, lStart: 1, at: true, days: 7, start: '' };
    const g = x => genLabels(Object.assign({}, base, x)), both = g({ atArch: 'UL' });
    return { both: [both[0].atN, both[0].totalAlgn, labelLine(both[1]), labelHTML(both[0], 0).includes('2 templates'), labelHTML(both[1], 1).includes('Upper &amp; Lower')],
      up: [g({ atArch: 'U' })[0].atN, g({ atArch: 'U' })[0].totalAlgn], none: [g({ atArch: '' })[0].atN, g({ atArch: '' })[0].totalAlgn], upOnly: [g({ atArch: 'UL', lOn: false })[0].atN, g({ atArch: 'UL', lOn: false })[0].totalAlgn],
      csv: labelsCSV(both).split('\n').slice(1, 3) };
  });
  check(lb.both[0] === 2 && lb.both[1] === 20 && /templates · upper & lower/.test(lb.both[2]) && lb.both[3] && lb.both[4], 'upper & lower: 2 templates, the box total 10 + 8 + 2 = 20');
  check(lb.up[0] === 1 && lb.up[1] === 19, 'an upper template: 1');
  check(lb.none[0] === 1 && lb.none[1] === 19, 'no answer on the case, the box ticked by hand: 1, as before');
  check(lb.upOnly[0] === 1 && lb.upOnly[1] === 11, 'printing the upper only: just its template');
  check(/AT: 2 templates/.test(lb.csv[0]) && /Attachment Templates \(Upper & Lower\)/.test(lb.csv[1]), 'the CSV for Label Live says the same');

  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
