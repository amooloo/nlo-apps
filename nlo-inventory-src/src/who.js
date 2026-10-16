/* =====================================================================
   Who's signed in.
   Each person signs in with their own NLO Cases login (same username and
   password as NLO Cases, Time Off and the Time Clock; Amir, 16 Oct 2026:
   "use the same logins and logout after 10 mins same rules"). The page
   locks after the office's idle minutes (NLO Cases → Team & security,
   10 by default), and every cart, order, receiving and stock step is
   stamped with the person signed in and the time.
   Names and photos come from NLO Cases' roster. Records from before the
   move carry Staff Hub's ids (s_sarah…): a roster entry linked to Staff
   Hub (rid) answers to both.
   ===================================================================== */
/* who can change settings when nobody has been picked yet: Dr. A (and, after the move, the people the old app had) */
const DEFAULT_ADMINS = [];
/* "Pat L.", "Dr. A" — how a name shows on a stamp (the old app's short names looked the same) */
function shortName(name) {
  const n = String(name || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim(); if (!n) return '';
  const p = n.split(' ');
  if (/^dr\.?$/i.test(p[0])) return p.length > 1 ? 'Dr. ' + p[p.length - 1][0].toUpperCase() : 'Dr.';
  return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0].toUpperCase() + '.' : p[0];
}
/* NLO Cases' roster → { id (staff id), rid (Staff Hub id), name, short, title, photo, role, active }, current people first, Dr. A first */
function rosterPeople(list) {
  return listOf(list).filter(r => r && r.sid && r.name).map(r => ({
    id: String(r.sid), rid: typeof r.rid === 'string' && r.rid !== '-' ? r.rid : '', name: String(r.name), short: r.role === 'owner' ? 'Dr. A' : shortName(r.name),
    title: r.role === 'owner' ? 'Orthodontist / Owner' : '', role: r.role === 'owner' ? 'owner' : 'staff', active: r.active === true,
    photo: typeof r.photo === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(r.photo) ? r.photo : ''
  })).sort((a, b) => (b.active - a.active) || (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.name.localeCompare(b.name)));
}
const activePeople = () => (S.people || []).filter(p => p.active);
/* the person behind an id on a record: today's staff id, or a Staff Hub id on records from before the move */
function personById(id) { if (!id) return null; return (S.people || []).find(p => p.id === id) || (S.people || []).find(p => p.rid && p.rid === id) || null; }
/* the person behind a stamped name on an old record (a short name such as "Pat L.") */
function personByName(name) {
  const n = String(name || '').trim().toLowerCase(); if (!n) return null;
  return (S.people || []).find(p => p.short.toLowerCase() === n || p.name.toLowerCase() === n) ||
    (S.people || []).find(p => firstName(p.name).toLowerCase() === firstName(n).toLowerCase() && n.split(/\s+/).length === 1) || null;
}
function avatarHTML(name, cls, id) {
  const p = (id && personById(id)) || personByName(name);
  const label = (p && p.name) || name || '';
  if (p && p.photo) return '<span class="av ' + (cls || '') + '" title="' + esc(label) + '"><img data-src="' + esc(p.photo) + '" alt=""></span>';
  return '<span class="av ' + (cls || '') + '" style="background:' + avColor(label) + '" title="' + esc(label) + '">' + esc(initials(label)) + '</span>';
}
function avColor(n) { const C = ['#385686', '#1D3EA9', '#1F9E7E', '#C2820A', '#D8412E', '#7A5AC8', '#1A8FB0', '#B4304E']; let h = 0; String(n || '').split('').forEach(c => { h = (h * 31 + c.charCodeAt(0)) >>> 0; }); return C[h % C.length]; }

/* ---------- the person signed in ---------- */
function whoNow() {
  const me = B && B.me; if (!me) return null;
  const p = personById(me.staffId);
  const name = (p && p.name) || me.name || 'Someone';
  return { id: me.staffId, short: me.role === 'owner' ? 'Dr. A' : shortName(name), name };
}
/* a record stamped by the person signed in (old records carry Staff Hub's id for them) */
function isMine(id) { const w = whoNow(), p = id && personById(id); return !!(w && p && p.id === w.id); }
/* the stamp put on a step: who did it and when */
function stamp() { const w = whoNow(); return { by: w ? w.short : 'Office', byId: w ? w.id : '', at: nowISO() }; }
/* a step that needs a name: the signed-in person's (the old app asked people to tap their name; signing in says it now) */
function withWho(fn) { const w = whoNow(); if (!w) return toast('Sign in first.', { bad: true }); return fn(w); }
function adminList() { const l = S.settings && Array.isArray(S.settings.invAdmins) ? S.settings.invAdmins.filter(x => typeof x === 'string') : []; return l.length ? l : DEFAULT_ADMINS; }
function isOwnerAccount() { return !!(B && B.isOwner && B.isOwner()); }
function isAdmin() { if (isOwnerAccount()) return true; const w = whoNow(); return !!(w && adminList().includes(w.id)); }
/* who can change settings, by name ("Dr. A or Pat L.") */
function adminNames() {
  const names = ['Dr. A'].concat(adminList().map(id => personById(id)).filter(p => p && p.role !== 'owner' && p.active).map(p => p.short));
  return names.length > 1 ? names.slice(0, -1).join(', ') + ' or ' + names[names.length - 1] : names[0];
}
/* a step only Dr. A and the people he picks can take */
function withAdmin(fn, why, what) { if (!isAdmin()) return toast('Only ' + adminNames() + ' can ' + (what || 'do that') + '.', { bad: true }); return fn(); }

/* the side-menu chip: who's signed in, and Lock */
function renderWho() {
  const el = $('#whoSlot'); if (!el) return;
  const w = whoNow();
  el.innerHTML = w ? '<div class="whoChip">' + avatarHTML(w.short, '', w.id) + '<span class="grow"><b>' + esc(w.name) + '</b><span class="sm">' + (isOwnerAccount() ? 'Dr. A' : isAdmin() ? 'Changes settings' : 'Signed in') + '</span></span><button class="iconBtn lockBtn" data-act="lock" title="Lock (sign out)" aria-label="Lock">' + ic('lock', 17) + '</button></div>' : '';
  const mob = $('#mobWho'); if (mob) mob.innerHTML = w ? avatarHTML(w.short, 'sm', w.id) : '<span class="av sm ghost">?</span>';
}
/* the phone's avatar button: who's signed in, Lock */
ACT.who = () => {
  const w = whoNow(); if (!w) return;
  openModal('<div class="whoHead">' + avatarHTML(w.short, 'xl', w.id) + '<div><h3 style="margin:0">' + esc(w.name) + '</h3><div class="lsub" style="margin:2px 0 0">Signed in · locks after ' + idleMinutes() + ' minutes without activity</div></div></div>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeModal">Close</button><button class="btn btn-pri" data-act="lock">' + ic('lock', 16) + 'Lock</button></div>', { cls: 'mid' });
};
function idleMinutes() { const n = Number(S.cases && S.cases.idleMin); return n > 0 ? n : IDLE_MIN; }
