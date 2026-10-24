// The small pieces that decide which name goes with which patient: no browser, no database.  node test/unit.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const ctx = vm.createContext({ TextEncoder, TextDecoder, crypto: globalThis.crypto, btoa, atob, console });
vm.runInContext(src('core.js').replace(/^'use strict';/, '') + '\nthis.Crypto = Crypto; this.fitsInitials = fitsInitials; this.nameInitials = nameInitials; this.iprNorm = iprNorm; this.cleanName = cleanName; this.canonJSON = canonJSON; this.normName = normName;', ctx);
// FB.chartForms / FB.oneName and the app's search, taken from their sources as they are
const be = src('backend.js'), app = src('app.js');
const grab = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); if (i < 0 || j < 0) throw new Error('not found: ' + a); return s.slice(i, j); };
const mv = src('move.js');
vm.runInContext('const FB = {' + grab(be, '  chartForms(chart) {', '  /* the names NLO Cases has') + grab(be, '  oneName(list) {', '\n  /* ---------- saving') +
  grab(be, '  cleanVis(o) {', '\n\n  /* ---------- the patient index') + '};\n' +
  'let ROWS = []; const IP = { patients: async () => ROWS };\n' + grab(app, 'function ptLabel(p)', '// The name NLO Cases has') + grab(app, 'function iprSamePatient(', '// Today') +
  grab(mv, 'function asObj(v)', 'async function readOld()') + grab(mv, 'const okId = ', '/* the names NLO Cases has for every chart #') +
  'this.FB = FB; this.setRows = r => { ROWS = r; }; this.iprSearch = iprSearch; this.iprSamePatient = iprSamePatient; this.planMove = planMove; this.planSum = planSum; this.idFor = idFor; this.asObj = asObj;', ctx);
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) pass++; else { fail++; console.log('FAIL ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); } };

// initials an older record kept vs. the name NLO Cases has
[['Jane Doe', 'JD', true], ['Jane Doe', 'JMD', true], ['Jane Doe', 'jd', true], ['Mary Ann Smith-Jones', 'MSJ', true], ['Mary Ann Smith-Jones', 'MASJ', true],
 ['Mary Ann Smith-Jones', 'MS', true], ['José Núñez', 'JN', true], ['Ángel Díaz', 'AD', true], ['Carl Zed', 'AB', false], ['Carl Zed', 'CB', false],
 ['Jane Doe', 'JANE DOE', true], ['Jane Doe', 'JOHN DOE', true /* same initials: the chart # decides */], ['Jane Doe', '', true], ['Jane Doe', 'J', true], ['Bob Smith', 'RS', false],
 ['O’Brien Kate', 'OK', true], ['Kate O\'Brien', 'KO', true], ['', 'JD', false]]
  .forEach(([n, i, want]) => check('fitsInitials(' + n + ', ' + i + ')', ctx.fitsInitials(n, i) === want, ctx.fitsInitials(n, i)));
check('nameInitials', ctx.nameInitials('  jane   van der doe ') === 'JD' && ctx.nameInitials('Cher') === 'C' && ctx.nameInitials('') === '');
// chart #s: letters and digits only; the forms NLO Cases may have filed it under
check('iprNorm', ctx.iprNorm(' 15-6541 ') === '156541' && ctx.iprNorm('AB 12/3') === 'ab123');
const forms = ctx.FB.chartForms('156541');
check('chartForms: as typed, and a dash anywhere in an all-digit chart #', forms.includes('156541') && forms.includes('15-6541') && forms.includes('1-56541') && forms.length === 6, forms);
check('chartForms: one with a dash keeps it, and without', JSON.stringify(ctx.FB.chartForms('15-6541').slice(0, 2)) === JSON.stringify(['156541', '15-6541']), ctx.FB.chartForms('15-6541'));
check('chartForms: letters are kept as NLO Cases keys them (lower case, spaces out)', ctx.FB.chartForms('AB 12').includes('ab12'), ctx.FB.chartForms('AB 12'));
// one name, or none when NLO Cases has two different ones
check('oneName', ctx.FB.oneName([{ name: 'Jane Doe' }, { name: 'jane  doe' }]) === 'Jane Doe' && ctx.FB.oneName([{ name: 'Jane Doe' }, { name: 'Jane Dough' }]) === '' && ctx.FB.oneName([]) === '');
// the same JSON whatever order the keys came in
check('canonJSON', ctx.canonJSON({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }) === ctx.canonJSON({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }) && ctx.canonJSON({ a: undefined, b: 2 }) === '{"b":2}');

// search
(async () => {
  ctx.setRows([
    { id: 'a', patient_id: '15-6541', name: 'Jane Doe', ini: 'JD' }, { id: 'b', patient_id: '1234567', name: 'Mark Smith', ini: 'MS' },
    { id: 'c', patient_id: '777', name: '', ini: 'AB' }, { id: 'd', patient_id: '156540', name: 'Janet Dorsey', ini: '' }, { id: 'e', patient_id: '88', name: 'Doe Jansen', ini: '' }]);
  const ids = async q => (await ctx.iprSearch(q)).map(p => p.id).join(',');
  check('search: the exact chart # first, dashes don’t matter', (await ids('156541')).startsWith('a') && (await ids('15 6541')).startsWith('a'), await ids('156541'));
  check('search: part of a chart #', (await ids('1565')).split(',').sort().join(',') === 'a,d', await ids('1565'));
  check('search: a first name, any part', (await ids('jan')).split(',').sort().join(',') === 'a,d,e', await ids('jan'));
  check('search: first and last name in any order', (await ids('doe jane')) === 'a' && (await ids('jane d')).split(',').sort().join(',') === 'a,d', [await ids('doe jane'), await ids('jane d')]);
  check('search: initials on an older record, and a name’s own initials', (await ids('AB')) === 'c' && (await ids('ms')).split(',').includes('b'), [await ids('AB'), await ids('ms')]);
  check('search: nothing for nonsense', (await ids('zzz')) === '' && (await ids('')) === '');

  // the patient on file for a chart # who is the one typed: the same name, or initials it fits (a mistyped chart # never attaches)
  const onFile = [{ id: 'a', name: 'Jane Doe', ini: 'JD', created_at: '2026-01-02' }, { id: 'b', name: '', ini: 'MS', created_at: '2026-01-01' }, { id: 'c', name: '', ini: '', created_at: '2026-01-03' }];
  const same = (l, n) => ctx.iprSamePatient(l, n).map(p => p.id).join(',');
  check('same patient: the same full name (spaces and case don’t matter)', same([onFile[0]], ' jane  DOE ') === 'a' && same([onFile[0]], 'John Smith') === '' && same([onFile[0]], 'Jane Dough') === '', [same([onFile[0]], ' jane  DOE '), same([onFile[0]], 'John Smith')]);
  check('same patient: initials only on file — a name that fits them; none on file — anyone', same([onFile[1]], 'Mark Smith') === 'b' && same([onFile[1]], 'Jane Doe') === '' && same([onFile[2]], 'Anyone Here') === 'c');
  check('same patient: two on file — the one that is, oldest first; no name typed — every one', same(onFile, 'Mark Smith') === 'b,c' && same(onFile, '') === 'b,a,c', [same(onFile, 'Mark Smith'), same(onFile, '')]);

  // the move's plan: ids, who a visit belongs to, visits with no patient
  const V = (d, n) => ({ id: 'x', patient_uuid: 'y', date: d, notes: n || '', upper_ipr: { 'UR1|UL1': '0.2' } });
  const old = { patients: { 'pt-1': { id: 'pt-1', name: 'JD', patient_id: '15-6541' }, 'odd key': { id: 'odd key', name: 'AB', patient_id: '777' }, 'k2': { id: 'fld2', name: 'CD', patient_id: '888' }, junk: 'x' },
    visits: { 'pt-1': { 'v1': V('2026-03-02'), 'v 2': V('2026-04-01') }, 'odd key': { 'v3': V('2026-05-01') }, 'fld2': { 'v4': V('2026-02-01') }, 'gone': { 'v5': V('2026-06-01') }, 'here-only': { 'v6': V('2026-07-01') } } };
  const names = new Map([['156541', [{ name: 'Jane Doe' }]]]);
  const P = await ctx.planMove(old, names, null);
  const odd = await ctx.idFor('odd key'), v2 = await ctx.idFor('v 2');
  check('plan: patients keep their ids; one with characters the database can’t take gets the same new one every time', P.pts.map(x => x.id).sort().join() === ['pt-1', odd, 'k2'].sort().join() && odd === (await ctx.idFor('odd key')) && /^m[0-9a-f]{31}$/.test(odd), P.pts.map(x => x.id));
  check('plan: a visit goes with its patient — under its key, or under the id field IPR Tracker 3 kept on the record', P.vis.find(x => x.id === 'v1').p === 'pt-1' && P.vis.find(x => x.id === v2).p === 'pt-1' && P.vis.find(x => x.id === 'v3').p === odd && P.vis.find(x => x.id === 'v4').p === 'k2', P.vis.map(x => [x.id, x.p]));
  check('plan: visits that belong to no patient are listed, not moved', P.counts.orphans === 2 && P.orphans.map(o => o.pk).sort().join() === 'gone,here-only' && P.counts.vis === 4 && P.counts.pts === 3, P.counts);
  check('plan: Jane Doe’s name from NLO Cases (it fits JD); the visit’s fields kept, its fingerprint added; junk left out', P.pts.find(x => x.id === 'pt-1').body.name === 'Jane Doe' && P.vis.find(x => x.id === 'v1').body.upper_ipr['UR1|UL1'] === '0.2' && !('patient_uuid' in P.vis[0].body) && P.vis[0].body.oh.length === 32 && P.notes.some(n => /empty entr/.test(n)) && P.notes.some(n => /new record id/.test(n)), P.notes);
  const have = { pts: new Map([['here-only', {}]]) };
  const R = await ctx.planMove(old, new Map(), have);
  check('removing the old copy: a visit whose patient is here already (taken out of the old copy before) comes over to them', R.vis.find(x => x.id === 'v6').p === 'here-only' && R.counts.orphans === 1 && R.orphans[0].pk === 'gone', [R.counts, R.orphans]);
  check('the plan’s fingerprint changes with any record or visit with no patient', ctx.planSum(P) !== ctx.planSum(R) && ctx.planSum(P) === ctx.planSum(await ctx.planMove(old, names, null)));
  const dup = { patients: { a: { id: 'a', name: 'AB', patient_id: '1' }, b: { id: 'b', name: 'CD', patient_id: '2' } }, visits: { a: { v1: V('2026-01-01') }, b: { v1: V('2026-01-02') } } };
  const D = await ctx.planMove(dup, new Map(), null), D2 = await ctx.planMove(dup, new Map(), null);
  check('plan: the same visit key under two patients (a hand edit): both kept, the second with a stable id of its own', D.vis.length === 2 && new Set(D.vis.map(x => x.id)).size === 2 && D.vis.map(x => x.id).join() === D2.vis.map(x => x.id).join() && D.vis.find(x => x.id === 'v1').p === 'a', D.vis.map(x => [x.id, x.p]));
  const H = await ctx.planMove({ patients: { b: dup.patients.b }, visits: { b: { v1: V('2026-01-02') } } }, new Map(), { pts: new Map([['a', {}]]), vis: new Map([['v1', { d: { p: 'a' } }]]) });
  check('removing the old copy: a visit key here already under another patient comes over as a visit of its own', H.vis.length === 1 && H.vis[0].id !== 'v1' && H.vis[0].p === 'b', H.vis);
  check('asObj: an array the database hands back for numbered keys', JSON.stringify(ctx.asObj([null, { a: 1 }])) === '{"1":{"a":1}}' && JSON.stringify(ctx.asObj(null)) === '{}');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
