// Compare the IPR note built by NLO Cases with the IPR Tracker's own buildChartNote ("lines" format).
const fs = require('fs'); const vm = require('vm');
const ipr = fs.readFileSync('/home/claude/nlo-apps/IPR_Tracker.html', 'utf8');
const grab = (start, endMarker) => { const i = ipr.indexOf(start); const j = ipr.indexOf(endMarker, i); if (i < 0 || j < 0) throw new Error('not found ' + start); return ipr.slice(i, j); };
const orig = [
  grab('function initContacts(teeth)', 'function initBT'),
  grab('function canonContacts(teeth, raw, blank)', 'function sumContacts'),
  grab('function sumContacts(contacts)', '// Parse a value'),
  grab('function jp(val, fallback)', 'function load('),
  grab('function addContacts(a, b)', '// ─── Tooth SVG'),
  grab('const NOTE_DASH', '// UI preference'),
  'const UPPER = ' + JSON.stringify(["UR7","UR6","UR5","UR4","UR3","UR2","UR1","UL1","UL2","UL3","UL4","UL5","UL6","UL7"]) + '; const LOWER = ' + JSON.stringify(["LR7","LR6","LR5","LR4","LR3","LR2","LR1","LL1","LL2","LL3","LL4","LL5","LL6","LL7"]) + ';'
].join('\n');
const A = vm.createContext({}); vm.runInContext(orig + '\nthis.build = buildChartNote; this.canon = canonContacts; this.add = addContacts; this.init = initContacts; this.jp = jp;', A);
const B = vm.createContext({ S: { demo: false }, TextEncoder, TextDecoder, crypto: globalThis.crypto, btoa, atob }); vm.runInContext(fs.readFileSync('src/core.js', 'utf8').replace(/^'use strict';/, '') + '\n' + fs.readFileSync('src/ipr.js', 'utf8') + '\nthis.fromVisits = iprNoteFromVisits;', B);
const U = ["UR7","UR6","UR5","UR4","UR3","UR2","UR1","UL1","UL2","UL3","UL4","UL5","UL6","UL7"], L = ["LR7","LR6","LR5","LR4","LR3","LR2","LR1","LL1","LL2","LL3","LL4","LL5","LL6","LL7"];
const keys = t => t.slice(0, -1).map((x, i) => x + '|' + t[i + 1]);
const r = n => Math.floor(Math.random() * n);
const vals = ['', '0.1', '0.2', '0.3', '0.5', '0.8'];
const rmap = (t, bt) => { const o = {}; keys(t).forEach(k => { if (Math.random() < 0.18) o[k] = bt ? true : vals[1 + r(5)]; }); return Math.random() < 0.3 ? JSON.stringify(o) : o; };
let same = 0, diff = 0;
for (let i = 0; i < 500; i++) {
  const nv = 1 + r(4); const visits = [];
  for (let j = 0; j < nv; j++) visits.push({ date: '2026-0' + (1 + j) + '-1' + r(9), created_at: '2026-01-01T00:00:0' + j, upper_ipr: rmap(U), lower_ipr: rmap(L), upper_spaces: rmap(U), lower_spaces: rmap(L), upper_bt: rmap(U, true), lower_bt: rmap(L, true) });
  const mine = B.fromVisits(visits).note;
  // the IPR Tracker's way: newest visit's contacts; cumulative = sum over the visit history
  const vs = visits.slice().sort((a, b) => b.date.localeCompare(a.date)); const v = vs[0];
  const cum = (k, t) => vs.reduce((acc, x) => A.add(acc, A.canon(t, A.jp(x[k], null), '')), A.init(t));
  const theirs = A.build({ upper: A.canon(U, A.jp(v.upper_ipr, null), ''), lower: A.canon(L, A.jp(v.lower_ipr, null), ''), upperSpaces: A.canon(U, A.jp(v.upper_spaces, null), ''), lowerSpaces: A.canon(L, A.jp(v.lower_spaces, null), ''), upperBT: A.canon(U, A.jp(v.upper_bt, null), false), lowerBT: A.canon(L, A.jp(v.lower_bt, null), false), format: 'lines', incIPR: true, incCum: true, cumUpper: cum('upper_ipr', U), cumLower: cum('lower_ipr', L), visitCount: vs.length });
  if (mine === theirs) same++; else { diff++; if (diff < 3) console.log('DIFF\n---mine\n' + mine + '\n---theirs\n' + theirs); }
}
console.log('identical:', same, ' different:', diff);
console.log('\nsample:\n' + B.fromVisits([{ date: '2026-09-10', upper_ipr: {}, lower_ipr: {}, upper_spaces: { 'UR2|UR1': '0.1', 'UR1|UL1': '0.1', 'UL1|UL2': '0.2' }, lower_spaces: {}, upper_bt: {}, lower_bt: {} }]).note);
process.exit(diff ? 1 : 0);
