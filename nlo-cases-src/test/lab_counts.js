/* The export's aligner counts on an in-house case (lab.js labEffect, 6 Nov 2026): nobody typed them → filled in; what the lab filled in
   before → follows a re-export (the rest of the set, a reprint); typed before the order reached the case → the export's counts, with
   what the case said in the history; changed by hand after the order was on the case → kept, with "Use these" offered.
   Runs on core.js + lab.js alone (no browser, no emulators): node test/lab_counts.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const g = { console, window: { console }, document: { addEventListener() { }, readyState: 'complete' }, localStorage: { getItem: () => null, setItem() { }, removeItem() { } }, navigator: { userAgent: 'node' }, location: { search: '', hash: '', href: 'http://localhost/' },
  setTimeout, clearTimeout, TextEncoder, TextDecoder, crypto: require('crypto').webcrypto, esc: s => String(s == null ? '' : s), ic: () => '', fmtWhen: () => '', fmtDay: () => '', money: () => '' };
g.window.location = g.location; vm.createContext(g);
vm.runInContext('const ADMIN_ACTS = {};\n' + src('core.js') + '\n' + src('lab.js') + '\n;this.X = { labEffect, labCountsDiff, labCountsNote, labCountsHint, labHistText, labAction, labOwnerOf, labFollowsText };', g, { filename: 'core+lab.js' });
const { labEffect, labCountsDiff, labCountsNote, labHistText, labAction, labOwnerOf, labFollowsText } = g.X;
let pass = 0, fail = 0;
const check = (ok, what) => { ok ? pass++ : fail++; console.log((ok ? 'ok   ' : 'FAIL ') + what); };
const order = (au, al, tu, tl, at, key) => ({ key: key || '80871D', pid: '80871', rev: 'D', first: 'Pat', last: 'Export', ordered: '2026-11-05T09:10:11', due: '', au, al, tu, tl,
  a: { n: au + al, atTrimmer: 0, trimmed: 0 }, t: { n: tu + tl, atTrimmer: 0, trimmed: 0 }, lv: {}, act: at, at, pc: 'LAB' });
const nla = o => Object.assign({ id: 'c1', type: 'nla', status: 'open', stage: 'txp', patient: 'Pat Export', treatArch: '' }, o);
const apply = (c, o) => { const e = labEffect(c, o); return { e, c: Object.assign({}, c, e.set) }; };
const n = v => Number(v) || 0;

// 1) nobody typed the counts: the export fills them in, with the template answer, and notes what it filled
let r = apply(nla({}), order(10, 8, 1, 1, 1000));
check(r.c.alU === 10 && r.c.alL === 8 && r.c.aligners === 18 && r.c.atTemplates === 'UL' && r.c.labOrd.key === '80871D', 'no counts yet → U 10 · L 8 (18), templates Upper & Lower from the export');
check(JSON.stringify(r.c.labOrd.filled) === JSON.stringify({ alU: 10, alL: 8, aligners: 18, atTemplates: 'UL' }) && !Object.keys(r.e.was).length, 'the order remembers what it filled in; nothing was there before');
check(/^Lab PC |filled in the aligner counts from the export \(U 10 · L 8\), answered attachment templates from the export$/.test('Lab PC |' + labHistText(labAction(order(10, 8, 1, 1, 1000), r.e))) && labAction(order(10, 8, 1, 1, 1000), r.e).first === 1,
  'history: "found Ortho Factory order …, filled in the aligner counts from the export (U 10 · L 8), answered attachment templates from the export" (' + labHistText(labAction(order(10, 8, 1, 1, 1000), r.e)) + ')');
check(labOwnerOf(r.c, r.c.labOrd, 'al') === 'lab' && labOwnerOf(r.c, r.c.labOrd, 'at') === 'lab', 'the counts and the template answer are the lab’s');

// 2) the rest of the set exported later (same order #): the lab's counts follow the export
let c2 = r.c, r2 = apply(c2, order(20, 16, 1, 1, 2000));
check(r2.c.alU === 20 && r2.c.alL === 16 && r2.c.aligners === 36 && r2.c.labOrd.filled.alU === 20 && r2.c.labOrd.filled.alL === 16, 'a later export of the same order with more aligners → U 20 · L 16 (the lab’s counts follow the export)');
check(JSON.stringify(r2.e.was) === JSON.stringify({ alU: 10, alL: 8 }) && /updated the aligner counts from the export \(U 20 · L 16\) \(this case said U 10 · L 8\)/.test(labHistText(labAction(order(20, 16, 1, 1, 2000), r2.e))),
  'history: "updated the aligner counts from the export (U 20 · L 16) (this case said U 10 · L 8)" (' + labHistText(labAction(order(20, 16, 1, 1, 2000), r2.e)) + ')');
check(!labCountsDiff(r2.c), 'no "Use these" note: the case says what the export says');

// 3) counts typed before the export reached the case (at TxP approved, from the plan): the export's counts go on, the history keeps the typed ones
let r3 = apply(nla({ alU: 20, alL: 20, aligners: 40, atTemplates: 'none' }), order(20, 18, 1, 0, 3000));
check(r3.c.alU === 20 && r3.c.alL === 18 && r3.c.aligners === 38 && r3.c.atTemplates === 'U', 'typed U 20 · L 20 / no templates, then the first export says U 20 · L 18 with an upper template → the export’s');
check(JSON.stringify(r3.e.was) === JSON.stringify({ alU: 20, alL: 20, atTemplates: 'none' }), 'what the case said is kept for the history (' + JSON.stringify(r3.e.was) + ')');
check(/updated the aligner counts from the export \(U 20 · L 18\) \(this case said U 20 · L 20\), changed attachment templates from the export \(this case said None\)/.test(labHistText(labAction(order(20, 18, 1, 0, 3000), r3.e))),
  'history says both (' + labHistText(labAction(order(20, 18, 1, 0, 3000), r3.e)) + ')');
check(!labCountsDiff(r3.c), 'no note afterwards');

// 4) changed by hand after the order was on the case: a correction — kept, the lab's offered
let c4 = Object.assign({}, r3.c, { alU: 22, alL: 18, aligners: 40 }), r4 = apply(c4, order(24, 18, 1, 0, 4000));
check(r4.c.alU === 22 && r4.c.alL === 18 && !('alU' in r4.e.set) && r4.e.set.labOrd && r4.e.set.labOrd.au === 24, 'U changed by hand to 22 after the export; a new export says 24 → the hand count stays, the order’s reading is kept');
const d4 = labCountsDiff(r4.c);
check(d4 && d4.lab === 'U 24 · L 18' && d4.mine === 'U 22 · L 18' && d4.n === 42 && /Use these/.test(labCountsNote(r4.c)) && /lab 42/.test(g.X.labCountsHint(r4.c)) && /Ortho Factory has U 24 · L 18/.test(g.X.labCountsHint(r4.c, true)),
  'the Aligners note offers the lab’s (U 24 · L 18 vs U 22 · L 18); rows and cards say "lab 42", the folded line "Ortho Factory has U 24 · L 18"');
check(labOwnerOf(r4.c, r4.c.labOrd, 'al') === 'hand' && labOwnerOf(r4.c, r4.c.labOrd, 'at') === 'lab', 'the counts are by hand, the template answer still the lab’s');

// 5) a case linked before today's app (the order on it, no record of what it filled) with typed counts: left alone, the note shows
let c5 = nla({ alU: 20, alL: 20, aligners: 40, labOrd: Object.assign({}, order(20, 18, 0, 0, 1000)) }), r5 = apply(c5, order(20, 18, 0, 0, 5000));
check(r5.c.alU === 20 && r5.c.alL === 20 && labCountsDiff(r5.c) && labCountsDiff(r5.c).lab === 'U 20 · L 18', 'an order already on the case from before (no record of filling): typed counts stay, the note offers the export’s');

// 6) one arch: only that arch's count; the lower stays empty
let r6 = apply(nla({ treatArch: 'U' }), order(10, 8, 1, 1, 6000));
check(r6.c.alU === 10 && r6.c.alL === '' && r6.c.aligners === 10 && r6.c.atTemplates === 'U', 'upper arch only → U 10, no lower, templates Upper');

// 7) an older reading than the one kept changes nothing; the same reading again changes nothing
let r7 = apply(r2.c, order(5, 5, 0, 0, 1500));
check(!Object.keys(r7.e.set).length, 'an older reading (before the one kept) changes nothing');
let r8 = apply(r2.c, order(20, 16, 1, 1, 2000));
check(!Object.keys(r8.e.set).length, 'the same reading again changes nothing');

// 8) an export with no aligners (templates only, or the Tray Maker's pieces) never touches the counts
let r9 = apply(nla({ alU: 20, alL: 20, aligners: 40 }), order(0, 0, 1, 1, 9000));
check(r9.c.alU === 20 && r9.c.alL === 20 && !('alU' in r9.e.set) && !('atTemplates' in r9.e.set), 'an order with no aligners leaves the counts and templates alone');

// 9) "Not this order" can still take back what the lab filled (the record of it is there) — the unlink reads labOrd.filled
check(r2.c.labOrd.filled.alU === 20 && r2.c.labOrd.filled.atTemplates === 'UL', 'labOrd.filled holds the lab’s latest values for Not this order to take back');

// 10) Today: a re-export under a new revision letter says so
check(labFollowsText(r2.c, order(22, 16, 1, 1, 7000, '80871E')) === 'a newer export of the order this case follows (80871D → 80871E) — Link moves the case onto it, counts included'
  && labFollowsText(r2.c, Object.assign(order(6, 6, 0, 0, 7000, '91002C'), { pid: '91002' })) === 'its case follows another order (80871D)', 'Today’s hint tells a new revision of the same order from another order');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
