/* =====================================================================
   Who's at the computer.
   The office computers stay signed in with the office Google account, so
   the account can't say who's using it. The person taps their name once;
   it's kept on that computer for WHO_MINUTES after their last step, shown
   in the side menu with a one-tap switch (Amir, 15 Oct 2026: "Tap name,
   kept 10 min"). Every cart, order, receiving and stock step is stamped
   with that name and the time.
   Names and photos come from Staff Hub's office roster
   (nlo/cadence/roster); the built-in list below is only for when it
   can't be read.
   ===================================================================== */
const WHO_KEY = 'nloInv.who';
const OWNER_ID = 's_amir';
/* who can change settings, budgets, vendors and prices (as in the old app: Dr. A and Sarah); Settings → Who can change settings */
const DEFAULT_ADMINS = ['s_amir', 's_sarah'];
/* only if the shared roster (Staff Hub) can't be read: short names only, since this page itself is public */
const FALLBACK_STAFF = [
  { id: 's_amir', name: 'Dr. Akhavan', short: 'Dr. A', title: 'Orthodontist / Owner' },
  { id: 's_sarah', name: 'Sarah B.', short: 'Sarah B.', title: 'Office Coordinator' },
  { id: 's_savannah', name: 'Savannah S.', short: 'Savannah S.', title: 'Scheduling Coordinator' },
  { id: 's_wila', name: 'Wila J.', short: 'Wila J.', title: 'Treatment Coordinator' },
  { id: 's_eve', name: 'Eve P.', short: 'Eve P.', title: 'Clinical & Marketing Coordinator' },
  { id: 's_angelika', name: 'Angelika R.', short: 'Angelika R.', title: 'Clinical Assistant' },
  { id: 's_gwen', name: 'Gwen R.', short: 'Gwen R.', title: 'Clinical Assistant' },
  { id: 's_kaylee', name: 'Kaylee D.', short: 'Kaylee D.', title: 'Clinical Assistant' }
];
/* the roster as a list of current people: { id, name, short, title, photo } (Dr. A first) */
function rosterPeople(roster) {
  const people = Object.values((roster && roster.people) || {}).filter(p => p && p.id && p.name && p.active !== false && !(p.end && p.end < todayISO()));
  if (!people.length) return FALLBACK_STAFF.slice();
  return people.map(p => ({ id: p.id, name: p.name, short: p.short || p.nick || firstName(p.name), title: p.title || '', photo: typeof p.photo === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(p.photo) ? p.photo : '' }))
    .sort((a, b) => (a.id === OWNER_ID ? -1 : b.id === OWNER_ID ? 1 : a.name.localeCompare(b.name)));
}
/* everyone the roster has ever had, for names on old records */
function personById(id) { return (S.people || []).find(p => p.id === id) || null; }
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

/* ---------- the current person ---------- */
function whoLoad() { try { const w = JSON.parse(localStorage.getItem(WHO_KEY) || 'null'); if (w && w.id && w.short && w.at) S.who = w; } catch (e) { } }
function whoSave() { try { if (S.who) localStorage.setItem(WHO_KEY, JSON.stringify(S.who)); else localStorage.removeItem(WHO_KEY); } catch (e) { } }
function whoLeftMs() { return S.who ? Math.max(0, S.who.at + WHO_MINUTES * 60000 - Date.now()) : 0; }
function whoNow() { return S.who && whoLeftMs() > 0 ? S.who : null; }
function whoTouch() { if (whoNow()) { S.who.at = Date.now(); whoSave(); } }
function whoSet(p) { S.who = { id: p.id, short: p.short, name: p.name, at: Date.now() }; whoSave(); renderWho(); }
function whoClear() { S.who = null; whoSave(); renderWho(); }
/* the stamp put on a step: who did it and when */
function stamp() { const w = whoNow(); return { by: w ? w.short : 'Office', byId: w ? w.id : '', at: nowISO() }; }
/* run a step that needs a name: straight away when someone's tapped in, else after they tap their name */
function withWho(fn, why) {
  const w = whoNow();
  if (w) { whoTouch(); return fn(w); }
  openWhoPicker(why, () => { const n = whoNow(); if (n) fn(n); });
}
function isAdmin() {
  if (S.demo) return true;
  const w = whoNow(), list = (S.settings && Array.isArray(S.settings.invAdmins) && S.settings.invAdmins.length) ? S.settings.invAdmins : DEFAULT_ADMINS;
  return isOwnerAccount() || !!(w && list.includes(w.id));
}
/* who can change settings, by name ("Dr. A or Pat L.") */
function adminNames() {
  const list = (S.settings && Array.isArray(S.settings.invAdmins) && S.settings.invAdmins.length) ? S.settings.invAdmins : DEFAULT_ADMINS;
  const names = list.map(id => (personById(id) || {}).short).filter(Boolean);
  return names.length ? names.slice(0, -1).join(', ') + (names.length > 1 ? ' or ' : '') + names[names.length - 1] : 'Dr. A or the office coordinator';
}
/* a step only Dr. A and the people he picks can take: asks for a name first, then checks it */
function withAdmin(fn, why, what) {
  return withWho(() => { if (!isAdmin()) return toast('Only ' + adminNames() + ' can ' + (what || 'do that') + '.', { bad: true }); return fn(); }, why);
}
/* Dr. A's own Google account (his laptop, his phone) */
function isOwnerAccount() { return !!(B && B.user && String(B.user.email || '').toLowerCase() === OWNER_EMAIL); }

function openWhoPicker(why, then) {
  const cur = whoNow();
  const people = S.people && S.people.length ? S.people : FALLBACK_STAFF;
  openModal('<h3>Who’s this?</h3><div class="lsub">' + esc(why || 'Tap your name.') + ' It stays on this computer for ' + WHO_MINUTES + ' minutes after your last step.</div>' +
    '<div class="whoGrid">' + people.map(p => '<button class="whoBtn' + (cur && cur.id === p.id ? ' me' : '') + '" data-act="whoPick" data-id="' + esc(p.id) + '">' + avatarHTML(p.name, 'xl', p.id) + '<span>' + esc(p.short) + '</span><span class="t">' + esc(firstWords(p.title, 3)) + '</span></button>').join('') + '</div>' +
    '<div class="mFt">' + (cur ? '<button class="btn btn-ghost" data-act="whoOff">Not me — clear the name</button>' : '') + '<button class="btn btn-sec" data-act="closeModal">Cancel</button></div>', { cls: 'mid', onClose: () => { S.whoThen = null; } });
  S.whoThen = then || null;
}
function firstWords(s, n) { return String(s || '').split(/\s+/).slice(0, n).join(' '); }
ACT.whoPick = t => {
  const p = (S.people && S.people.length ? S.people : FALLBACK_STAFF).find(x => x.id === t.dataset.id); if (!p) return;
  whoSet(p); const then = S.whoThen; S.whoThen = null; closeModal(true);
  toast('Hi, ' + firstName(p.name) + '. Your name stays on this computer for ' + WHO_MINUTES + ' minutes.');
  if (then) then(); else renderView();
};
ACT.whoOff = () => { whoClear(); S.whoThen = null; closeModal(true); renderView(); };
ACT.who = () => openWhoPicker('Tap your name, so your steps carry it.');
/* the side-menu chip, refreshed every 20 seconds so the countdown is honest */
function renderWho() {
  const el = $('#whoSlot'); if (!el) return;
  const w = whoNow();
  if (!w) el.innerHTML = '<button class="whoChip off" data-act="who"><span class="av ghost">?</span><span class="grow"><b>Tap your name</b><span class="sm">before adding or ordering</span></span></button>';
  else {
    const m = Math.max(1, Math.ceil(whoLeftMs() / 60000));
    el.innerHTML = '<button class="whoChip" data-act="who" title="Change who’s using this computer">' + avatarHTML(w.short, '', w.id) + '<span class="grow"><b>' + esc(w.short) + '</b><span class="sm">Kept ' + m + ' more min · change</span></span></button>';
  }
  const mob = $('#mobWho'); if (mob) mob.innerHTML = w ? avatarHTML(w.short, 'sm', w.id) : '<span class="av sm ghost">?</span>';
}
