// nloMatch on made-up names (no browser, no emulators): the functions are taken from cadence.html itself.
// node match_unit.mjs
import fs from 'node:fs'; import vm from 'node:vm';
const src = fs.readFileSync(new URL('../../cadence.html', import.meta.url), 'utf8');
const grab = name => { const i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error(name); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } } };
const ctx = { nloRos: null };
vm.createContext(ctx);
vm.runInContext(`function nloRosActive(p){return !!p&&p.active!==!1&&!(p.end&&p.end<='2026-10-23')}
function nloRosFind(st){if(!nloRos||!st)return null;const k=st.rid||st.id;return nloRos.find(x=>x.id===k)||null}
function nloRosOff(st){const p=nloRosFind(st);return !!p&&!nloRosActive(p)}
${grab('nloErr')}\n${grab('nloNm')}\n${grab('nloFL')}\n${grab('nloMatch')}`, ctx);
const S = (id, name, status = 'active', rid) => Object.assign({ id, name, status }, rid ? { rid } : {});
const e = { staff: [S('s_amir', 'Dr. Amir Akhavan', 'admin'), S('s_sarah', 'Sarah Betz', 'manager'), S('s_gwen', 'Gwen Rodis'), S('s_kaylee', 'Kaylee Doty'),
  S('s_angelika', 'Angelika Rodriguez'), S('s_savannah', 'Savannah Saunders'), S('s_wila', 'Wila Jordan'), S('s_mary', "Mary O'Neil"), S('s_bri', 'Bri Brower'),
  S('s_alex1', 'Alex Morgan'), S('s_alex2', 'Alex Morgan'), S('cad_old', 'Tess Barlow', 'active', 's_tess')] };
ctx.nloRos = [
  { id: 's_amir', name: 'Amir Akhavan', first: 'Amir', last: 'Akhavan', active: true },
  { id: 's_angelika', name: 'Angelika Rodriguez', first: 'Angelika', last: 'Rodriguez', nick: 'Angie', active: true },
  { id: 's_savannah', name: 'Savannah Saunders', first: 'Savannah', last: 'Saunders', active: true },
  { id: 's_bri', name: 'Bri Brower', first: 'Bri', last: 'Brower', active: false, end: '2026-09-20' },
  { id: 's_newhire', name: 'Nina Newhire', first: 'Nina', last: 'Newhire', active: true },
  { id: 's_tess', name: 'Tess Barlow', first: 'Tess', last: 'Barlow', active: true }];
let pass = 0, fail = 0;
const t = (w, want, what) => { let got; try { got = ctx.nloMatch(e, Object.assign({ role: 'staff', name: '', rname: '', rid: '' }, w)).id; } catch (x) { got = '!' + x.code; } if (got === want) { pass++; console.log('  ok  ' + what + ' → ' + got); } else { fail++; console.log('  FAIL ' + what + ': got ' + got + ', want ' + want); } };
t({ role: 'owner', name: 'Amir Akhavan', rid: 's_amir' }, 's_amir', 'owner by link');
t({ role: 'owner', name: 'Amir Akhavan', rid: 's_gwen' }, 's_amir', 'owner with a stray link still gets the admin entry');
t({ role: 'owner', name: 'Dr. A' }, 's_amir', 'owner with no link');
t({ name: 'Gwen Rodis', rid: 's_gwen' }, 's_gwen', 'link');
t({ name: 'Maria Jordan', rid: 's_wila' }, 's_wila', 'link beats a different name');
t({ name: 'Kaylee Doty' }, 's_kaylee', 'whole name, no link');
t({ name: 'Kaylee Ann Doty' }, 's_kaylee', 'middle name');
t({ name: 'kaylee  doty ' }, 's_kaylee', 'case and spaces');
t({ name: 'Angie Rodriguez' }, 's_angelika', 'Staff Hub chair name + last name');
t({ name: 'Mary O’Neil' }, 's_mary', 'curly apostrophe');
t({ name: 'Savannah Saunders' }, 's_savannah', 'new last name, as Staff Hub has it');
t({ name: 'Gwen' }, '!not-linked', 'first name alone never matches');
t({ name: 'Ghost Person' }, '!not-linked', 'nobody by that name');
t({ name: 'Alex Morgan' }, '!ambiguous', 'two people with one name');
t({ name: 'Bri Brower', rid: 's_bri' }, '!left', 'Staff Hub says she left');
t({ name: 'Dr. Amir Akhavan' }, '!admin-only', 'a staff login named like Dr. A');
t({ name: 'Amir Akhavan', rid: 's_amir' }, '!admin-only', 'a staff login linked to Dr. A');
t({ name: 'Nina Newhire', rid: 's_newhire' }, '!not-in-cadence', 'linked to Staff Hub, not in Cadence yet');
t({ name: 'Gwen Rodis', rid: 's_gone_from_hub' }, 's_gwen', 'a stale link falls back to the name');
t({ name: 'Tess Barlow', rid: 's_tess' }, 'cad_old', 'Cadence entry linked by its own rid');
t({ name: 'Gwen Rodis', rid: '-' }, 's_gwen', 'rid "-" (not on Staff Hub) uses the name');
ctx.nloRos = null;
t({ name: 'Angie Rodriguez' }, '!not-linked', 'without Staff Hub’s roster the chair name can’t be known');
t({ name: 'Kaylee Doty' }, 's_kaylee', 'without the roster, names still work');
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
