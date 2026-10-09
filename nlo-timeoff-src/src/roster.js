/* =====================================================================
   Staff Hub's office roster (Amir, 9 Oct 2026: "Staff hub should be the
   source for all staff related things. it should be what's feeding all
   the other apps"). Staff Hub shares a basic team list in the
   nlo-inventory database (nlo/cadence/roster): for each person the name
   they go by, title, whether they're still on staff and their last day,
   their start date and full- or part-time. Time Off takes each person's
   start date (vacation tiers count from it), full-/part-time and last
   day from it; NLO Cases' team, which Time Off shows, takes the name.
   These are the plain parts — who is who, and what Staff Hub says in an
   HR record's terms. Reading it, and putting it in the records, is in
   staffhub.js.
   ===================================================================== */
const SH_OWNER_ID = 's_amir'; // Staff Hub's entry for Dr. A (no time off of his own here)
const SH_NONE = '-';          // a team entry's roster id when Dr. A has said they aren't on Staff Hub (never matched by name)
function shPeopleOf(data) { return Object.values((data && data.people) || {}).filter(p => p && typeof p.id === 'string' && p.id && p.id !== SH_NONE && typeof p.name === 'string' && p.name.trim()); }
function shNorm(s) { return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^dr\.?\s+/, '').replace(/[^a-z\s'-]/g, ' ').replace(/\s+/g, ' ').trim(); }
function shGone(p, today) { return p.active === false || (isISO(p.end) && p.end < today); }
/* a name on Staff Hub's roster, only when it's sure: a first and last name, matching someone's whole name, else their first name (or
   the one they go by) and last name — one person, or one still on staff among several. A single name ("Sarah") never matches. */
function shByName(name, people, today) {
  const n = shNorm(name), parts = n.split(' ').filter(Boolean); if (parts.length < 2) return null;
  const f = parts[0], l = parts[parts.length - 1], t = today || todayISO();
  const one = hit => { if (hit.length === 1) return hit[0]; const cur = hit.filter(p => !shGone(p, t)); return cur.length === 1 ? cur[0] : null; };
  const whole = people.filter(p => shNorm(p.name) === n); if (whole.length) return one(whole);
  return one(people.filter(p => p.last && shNorm(p.last) === l && [p.first, p.nick].some(x => x && shNorm(x) === f)));
}
/* the Staff Hub person an NLO Cases team entry is: by the roster id saved when it was linked (or set by Dr. A), else — a current
   login — by name */
function shFind(r, people, today) {
  if (!r || r.role === 'owner') return null;
  const p = r.rid ? (r.rid === SH_NONE ? null : people.find(x => x.id === r.rid) || null) : r.active ? shByName(r.name, people, today) : null;
  return p && p.id !== SH_OWNER_ID ? p : null;
}
/* NLO Cases' team (Time Off's people) on Staff Hub's roster → Map(sid → person). A saved link wins over a match by name; a person
   two current logins point to the same way is left out (that needs a look, not a guess); a removed login is linked only by its
   saved id, and only to someone no current login is. */
function shLinks(roster, people, today) {
  const byId = [], byName = [], old = [];
  (roster || []).forEach(r => { const p = shFind(r, people, today); if (p) (!r.active ? old : r.rid ? byId : byName).push([r.sid, p]); });
  const count = list => { const m = new Map(); list.forEach(([, p]) => m.set(p.id, (m.get(p.id) || 0) + 1)); return m; };
  const ni = count(byId), nn = count(byName), no = count(old), out = new Map();
  byId.forEach(([sid, p]) => { if (ni.get(p.id) === 1) out.set(sid, p); });
  byName.forEach(([sid, p]) => { if (!ni.has(p.id) && nn.get(p.id) === 1) out.set(sid, p); });
  old.forEach(([sid, p]) => { if (!ni.has(p.id) && !nn.has(p.id) && no.get(p.id) === 1) out.set(sid, p); });
  return out;
}
/* for Team and Settings: who's on Staff Hub without a login here, current logins Staff Hub doesn't have (not counting the ones Dr. A
   said aren't on it), current logins that point to the same person, and Staff Hub people no current login is linked to (to link one
   by hand — someone linked only through a removed login too: a rehire's new login) */
function shTeamState(roster, people, today) {
  const t = today || todayISO(), links = shLinks(roster, people, t), used = new Set(), cur = (roster || []).filter(r => r && r.active && r.role !== 'owner'), twice = new Map();
  (roster || []).forEach(r => { const p = shFind(r, people, t); if (p) used.add(p.id); });
  cur.forEach(r => { const p = shFind(r, people, t); if (p && !links.has(r.sid)) { if (!twice.has(p.id)) twice.set(p.id, { p, names: [] }); twice.get(p.id).names.push(r.name); } });
  const curIds = new Set(cur.filter(r => links.has(r.sid)).map(r => links.get(r.sid).id)), byName = (a, b) => String(a.name).localeCompare(String(b.name));
  return {
    links, logins: cur.length, linked: cur.filter(r => links.has(r.sid)).length,
    noLogin: people.filter(p => p.id !== SH_OWNER_ID && !used.has(p.id) && !shGone(p, t)).sort(byName),
    missing: cur.filter(r => r.rid !== SH_NONE && !shFind(r, people, t)).sort(byName),
    twice: Array.from(twice.values()),
    free: people.filter(p => p.id !== SH_OWNER_ID && !curIds.has(p.id)).sort((a, b) => shGone(a, t) - shGone(b, t) || byName(a, b))
  };
}

/* Staff Hub's word for how someone is employed (Full-time, Part-time, PRN / Temp, Contractor) as an HR record's: 'FT' or 'PT'
   (anyone not full-time earns no paid time off under the handbook), '' when it says nothing Time Off knows */
function shEmpType(e) { const s = String(e || '').toLowerCase(); return /full/.test(s) ? 'FT' : /part|prn|temp|contract|diem|season/.test(s) ? 'PT' : ''; }
/* what Staff Hub says about a person, in an HR record's terms — only what it says: hire (its start date), type with emp (its own
   word), left (its last day; '' while it has them on staff with no last day — someone it shows as gone with no date says nothing) */
function shFacts(p) {
  const o = {};
  if (isISO(p.start)) o.hire = p.start;
  const emp = String(p.employment || '').replace(/\s+/g, ' ').trim().slice(0, 40), t = shEmpType(emp);
  if (t) { o.type = t; o.emp = emp; }
  if (isISO(p.end)) { if (!o.hire || p.end >= o.hire) o.left = p.end; }
  else if (p.active !== false) o.left = '';
  return o;
}
const SH_FIELDS = ['hire', 'type', 'left'];
/* Staff Hub's facts less any Dr. A chose to keep this record's own value for ("Keep ours": rec.shKeep = { field: Staff Hub's value
   then }) — until Staff Hub says something else for it */
function shOwn(rec, f) {
  const keep = rec && rec.shKeep && typeof rec.shKeep === 'object' ? rec.shKeep : {}, o = Object.assign({}, f);
  SH_FIELDS.forEach(k => { if (k in o && k in keep && keep[k] === o[k]) { delete o[k]; if (k === 'type') delete o.emp; } });
  return o;
}
function shMark(f, pid) { return { id: pid, f: SH_FIELDS.filter(k => k in f) }; }
/* Staff Hub's facts put in an HR record (d is changed), with which fields came from it. from: the day a change of full-/part-time
   counts from (when bringing changes into a record that's already here) — the record keeps what it was before, so earlier months'
   balances don't change; none for a new record or the move */
function shApply(d, f, pid, from) {
  if ('hire' in f) d.hire = f.hire;
  if ('type' in f) {
    const was = d.type === 'PT' ? 'PT' : 'FT';
    if (from && was !== f.type) d.typeWas = (Array.isArray(d.typeWas) ? d.typeWas : []).concat([{ until: addDays(from, -1), type: was }]);
    d.type = f.type; d.emp = f.emp;
  } else delete d.emp;
  if ('left' in f) d.left = f.left;
  d.sh = shMark(f, pid);
}
/* what putting Staff Hub's facts in a record would change: list — the start date, full-/part-time and last day that differ (these
   wait for Dr. A); any — anything at all, Staff Hub's word for the employment and which fields came from it included */
function shChanges(rec, f, pid) {
  const list = [], cur = { hire: rec.hire || '', type: rec.type === 'PT' ? 'PT' : 'FT', left: rec.left || '' };
  SH_FIELDS.forEach(k => { if (k in f && f[k] !== cur[k]) list.push({ k, from: cur[k], to: f[k] }); });
  const m = shMark(f, pid), was = rec.sh || {};
  const any = list.length > 0 || (rec.emp || '') !== (f.emp || '') || was.id !== m.id || (Array.isArray(was.f) ? was.f.join() : '') !== m.f.join();
  return { list, any };
}
/* a change in words: "start date Mar 13, 2023 → Mar 1, 2023", "part-time from Oct 9", "last day Oct 30", "on staff (no last day)" */
function shChangeLine(c, f, from) {
  if (c.k === 'hire') return 'start date ' + (c.from ? fmtDate(c.from) + ' → ' : '') + fmtDate(c.to);
  if (c.k === 'type') return empWord(c.to, f && f.emp) + (from ? ' from ' + fmtDate(from) : '');
  return c.to ? 'last day ' + fmtDate(c.to) : 'on staff (no last day)';
}
/* how a record says someone is employed: Staff Hub's word when it gave one, else Full-time / Part-time; empWord in a sentence */
function empText(p) { return p && p.type === 'PT' ? (p.emp && shEmpType(p.emp) === 'PT' ? p.emp : 'Part-time') : 'Full-time'; }
function empWord(type, emp) { return type === 'PT' ? (emp && shEmpType(emp) === 'PT' && !/^part/i.test(emp) ? emp : 'part-time') : 'full-time'; }

/* the move from the old app: a person's row in the old Sheet with Staff Hub's start date, full-/part-time and last day in place of
   the Sheet's, and where they differ → { p, diffs: [{ k, sheet, sh }] } */
function shOverOld(p, f) {
  const o = Object.assign({}, p), diffs = [];
  if (!f) return { p: o, diffs };
  if (f.hire && f.hire !== (p.hire || '')) { diffs.push({ k: 'hire', sheet: p.hire || '', sh: f.hire }); o.hire = f.hire; }
  if (f.type && f.type !== (p.type === 'PT' ? 'PT' : 'FT')) { diffs.push({ k: 'type', sheet: p.type === 'PT' ? 'PT' : 'FT', sh: f.type, emp: f.emp }); o.type = f.type; }
  const was = p.former ? (p.moved || '') : '';
  if ('left' in f && f.left !== was) { diffs.push({ k: 'left', sheet: was, sh: f.left }); o.former = !!f.left; o.moved = f.left; }
  return { p: o, diffs };
}
function shDiffText(d) {
  const ft = empWord;
  if (d.k === 'hire') return 'started ' + fmtDate(d.sh) + (d.sheet ? ' (the Sheet: ' + fmtDate(d.sheet) + ')' : ' (no hire date in the Sheet)');
  if (d.k === 'type') return ft(d.sh, d.emp) + ' (the Sheet: ' + ft(d.sheet) + ')';
  return (d.sh ? 'last day ' + fmtDate(d.sh) : 'still on staff') + (d.sheet ? ' (the Sheet: former staff, moved ' + fmtDate(d.sheet) + ')' : ' (the Sheet: on staff)');
}
