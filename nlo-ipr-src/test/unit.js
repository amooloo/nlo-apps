// The small pieces that decide which name goes with which patient: no browser, no database.  node test/unit.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const ctx = vm.createContext({ TextEncoder, TextDecoder, crypto: globalThis.crypto, btoa, atob, console });
vm.runInContext(src('core.js').replace(/^'use strict';/, '') + '\nthis.fitsInitials = fitsInitials; this.nameInitials = nameInitials; this.iprNorm = iprNorm; this.cleanName = cleanName; this.canonJSON = canonJSON; this.normName = normName;', ctx);
// FB.chartForms / FB.oneName and the app's search, taken from their sources as they are
const be = src('backend.js'), app = src('app.js');
const grab = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); if (i < 0 || j < 0) throw new Error('not found: ' + a); return s.slice(i, j); };
vm.runInContext('const FB = {' + grab(be, '  chartForms(chart) {', '  /* the names NLO Cases has') + grab(be, '  oneName(list) {', '\n  /* ---------- saving') + '};\n' +
  'let ROWS = []; const IP = { patients: async () => ROWS };\n' + grab(app, 'function ptLabel(p)', '// The name NLO Cases has') +
  'this.FB = FB; this.setRows = r => { ROWS = r; }; this.iprSearch = iprSearch;', ctx);
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
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
