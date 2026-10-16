/* =====================================================================
   Before Inventory opens: the database's rules (Dr. A publishes them,
   from the card below) and, once, the move of Inventory's records from
   its own Realtime Database (nlo-inventory, nlo/*) to the NLO Cases
   project.
   The move: Dr. A connects to the old database with Google (Dr. A's or
   the office account — the ones its rules let read Inventory), the page
   reads everything, shows what it found, and on "Move it now" saves it
   here (supplies, orders, vendors, the activity log by month, the cart,
   the budget, quick-order prices, the bracket order, storage locations,
   who changes settings, the AI keys; photos kept inside records become
   records of their own). Then it counts what's here against what it
   read, money included, and only then marks Inventory moved. Running it
   again saves the same records under the same ids, so a move that
   stopped half way is simply run again.
   The old database isn't changed: it stays as it was (a backup), and the
   alert script keeps its supply numbers up to date for Staff Meeting and
   AISA.
   ===================================================================== */
const MV = { step: 'start', who: '', plan: null, done: 0, total: 0, err: '', res: null, checked: false };

/* ---------- the cards shown before Inventory opens ---------- */
function gateHTML() {
  const g = S.gate, card = (title, body) => '<div class="card gateCard"><div class="cardHd"><h3>' + title + '</h3></div><div class="cardBd">' + body + '</div></div>';
  const again = '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="retryOpen">' + ic('refresh', 15) + 'Check again</button></div>';
  if (g === 'opening') return '<div class="card loadCard"><span class="spin"></span><div style="margin-top:10px">Opening Inventory…</div></div>';
  if (g === 'error') return card('Couldn’t open Inventory', '<p class="small">' + esc(S.loadErr || 'Something went wrong.') + '</p>' + again);
  if (g === 'rules') return isOwnerAccount() ? rulesCardHTML(true) : card('Inventory isn’t ready yet', '<p class="small">The office database needs an update from Dr. A first. Until then, keep using the old Inventory.</p><div class="btnRow"><a class="btn btn-sec btn-sm" href="' + OLD_URL + '">Open the old Inventory</a><button class="btn btn-ghost" data-act="retryOpen">' + ic('refresh', 15) + 'Check again</button></div>');
  if (g === 'notyet') return card('Inventory is moving to your NLO Cases login', '<p class="small">Dr. A is moving the supplies, orders and history over. Until he’s done, keep using the old Inventory.</p><div class="btnRow"><a class="btn btn-sec btn-sm" href="' + OLD_URL + '">Open the old Inventory</a><button class="btn btn-ghost" data-act="retryOpen">' + ic('refresh', 15) + 'Check again</button></div>');
  if (g === 'move') return moveCardHTML();
  return '';
}
ACT.retryOpen = async () => {
  S.gate = 'opening'; renderView(); let r;
  try { r = await B.open(); } catch (e) { r = { st: 'error' }; S.loadErr = errText(e); }
  if (!S.inApp) return;
  S.moved = r.moved || null;
  if (r.st === 'ready') startLive(); else { S.gate = r.st; renderShell(); renderView(); }
};
function rulesText() { return INV_RULES.replace('__OWNER_EMAIL__', String((B.me && B.me.email) || '').toLowerCase()); }
function rulesCardHTML(first) {
  return '<div class="card rulesBox gateCard"><div class="cardHd"><h3>' + (first ? 'One step before Inventory can open' : 'Database rules') + '</h3></div><div class="cardBd">' +
    '<p class="small">The office database needs its updated rules — they add Inventory and keep everything NLO Cases, Leads, A/R, Time Off and the Time Clock already have. It’s the same card those apps show when they need newer rules.</p>' +
    '<ol class="steps small"><li>Press <b>Copy the new rules</b>.</li><li>Open the <b>Firebase console</b> → <b>Firestore Database</b> (left menu) → <b>Rules</b> tab.</li><li>Select everything there (Ctrl+A), paste over it, and press <b>Publish</b>.</li><li>Come back and press <b>Check again</b>.</li></ol>' +
    '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="copyRules">' + ic('copy', 15) + 'Copy the new rules</button>' +
    '<a class="btn btn-sec btn-sm" href="https://console.firebase.google.com/project/nlo-cases/firestore/rules" target="_blank" rel="noopener noreferrer">Open the Firebase console</a>' +
    '<button class="btn btn-ghost" data-act="retryOpen">' + ic('refresh', 15) + 'Check again</button></div>' +
    '<details class="help"><summary>See the rules</summary><textarea readonly id="rulesTxt">' + esc(rulesText()) + '</textarea></details></div></div>';
}
ACT.copyRules = () => { navigator.clipboard.writeText(rulesText()).then(() => toast('Rules copied — paste them over everything in the Firebase console and press Publish.', { ms: 7000 }), () => toast('Couldn’t copy — open “See the rules” and copy them by hand.', { bad: true })); };

/* ---------- the old database (read only; the same Google sign-in NLO Cases and Time Off use for the office roster) ---------- */
const OLD = {
  auth: null, ready: null,
  init() {
    if (OLD.auth) return true;
    if (typeof firebase === 'undefined' || !firebase.auth) return false;
    const cfg = S.emu ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-nlo-cases', appId: 'demo' } : OLD_FB;
    const app = firebase.apps.find(a => a && a.name === 'ipr') || firebase.initializeApp(cfg, 'ipr');
    OLD.auth = app.auth();
    if (S.emu) OLD.auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
    try { OLD.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch (e) { }
    OLD.ready = new Promise(res => { const off = OLD.auth.onAuthStateChanged(u => { off(); res(u); }); });
    return true;
  },
  async user() { if (!OLD.init()) return null; await OLD.ready; return OLD.auth.currentUser || null; },
  /* straight from the click (a sign-in window may only open from one) */
  connect() {
    if (!OLD.init()) return Promise.reject(errCode('unavailable', 'Not available in this browser.'));
    if (S.emu) return OLD.auth.signInAnonymously();
    const p = new firebase.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
    return OLD.auth.signInWithPopup(p);
  },
  async disconnect() { if (OLD.init()) await OLD.auth.signOut(); },
  async read(path) {
    const u = await OLD.user(); if (!u) throw errCode('no-old', 'Not connected to the old Inventory.');
    const tok = await u.getIdToken();
    const url = (S.emu ? 'http://127.0.0.1:9000/' : OLD_FB.databaseURL + '/') + path + '.json?' + (S.emu ? 'ns=demo-nlo-cases&' : '') + 'auth=' + encodeURIComponent(tok);
    let r;
    try { r = await fetch(url, { cache: 'no-store', credentials: 'omit' }); } catch (e) { throw errCode('unavailable', 'Couldn’t reach the old Inventory. Check the internet connection.'); }
    if (r.status === 401 || r.status === 403) throw errCode('permission-denied', 'This Google account (' + (u.email || 'not Dr. A’s or the office’s') + ') can’t read the old Inventory. Connect with Dr. A’s or the office account.');
    if (!r.ok) throw errCode('unavailable', 'The old Inventory answered ' + r.status + '.');
    return r.json();
  }
};
/* what's read: [path under nlo/, needed] — a part that can't be read stops the move only when it's needed */
const OLD_PARTS = [['items', 1], ['orders', 1], ['vendors', 1], ['log', 1], ['cart', 1], ['budget', 1], ['bracketOrder', 0], ['elastoPrices', 0],
  ['settings/locations', 0], ['settings/invAdmins', 0], ['settings/alertsOn', 0], ['settings/geminiProxyUrl', 0], ['settings/invPrefs', 0], ['settings/geminiKey', 0], ['settings/openaiKey', 0]];

/* ---------- the move card ---------- */
function moveCardHTML() {
  const st = MV.step, P = MV.plan;
  let h = '<div class="card gateCard moveCard"><div class="cardHd"><h3>Move Inventory over</h3><span class="sub">one time, about a minute</span></div><div class="cardBd">';
  if (st === 'start' || st === 'connecting' || st === 'reading') {
    h += '<p class="small">Inventory now signs in with NLO Cases logins and locks after ' + idleMinutes() + ' minutes, like NLO Cases. Its supplies, orders, vendors, cart, budget and history move here from the old Inventory once. The old database isn’t changed: it stays as a backup, and Staff Meeting and AISA keep reading a copy of it.</p>' +
      '<ol class="steps small"><li><b>Connect to the old Inventory</b> with your Google account (or the office one) — the same as “Connect to the office roster” in NLO Cases.</li><li>Look over what it found, then press <b>Move it now</b>.</li><li>Inventory checks every count and dollar against the old one, then opens.</li></ol>' +
      (MV.err ? '<div class="lockErr" role="alert">' + esc(MV.err) + '</div>' : '') +
      '<div class="btnRow">' + (MV.who ? '<span class="small muted" style="align-self:center">Connected as <b>' + esc(MV.who) + '</b></span><button class="btn btn-pri btn-sm" data-act="mvRead"' + (st !== 'start' ? ' disabled' : '') + '>' + (st === 'reading' ? 'Reading…' : 'Read the old Inventory') + '</button><button class="btn btn-ghost" data-act="mvSwitch">Use another account</button>'
        : '<button class="btn btn-pri btn-sm" data-act="mvConnect"' + (st !== 'start' ? ' disabled' : '') + '>' + ic('google', 16) + (st === 'connecting' ? 'Connecting…' : st === 'reading' ? 'Reading…' : 'Connect to the old Inventory') + '</button>') + '</div>';
  } else if (st === 'ready' && P) {
    const c = P.counts, row = (l, v) => '<div class="kvRow"><span>' + l + '</span><b>' + v + '</b></div>';
    h += '<p class="small">Found in the old Inventory (read just now):</p>' +
      row('Supplies', c.items + (c.itemsHidden ? ' <span class="muted">(' + c.itemsHidden + ' archived or deleted)</span>' : '')) +
      row('Orders', c.orders + (c.ordersOpen ? ' <span class="muted">(' + c.ordersOpen + ' open or backordered)</span>' : '')) +
      row('Vendors saved', c.vendors) +
      row('Activity log', plural(c.log, 'entry', 'entries') + (P.months.length ? ' <span class="muted">(' + esc(monthLabel(P.months[0].slice(1), true)) + ' – ' + esc(monthLabel(P.months[P.months.length - 1].slice(1), true)) + ')</span>' : '')) +
      row('Money in the log', money(c.money)) +
      row('Spent this month', money(P.spendNow)) +
      row('In the cart', plural(c.cart, 'line')) +
      row('Budget', money(P.monthly, { whole: true }) + ' a month · ' + plural(c.expenses, 'expense')) +
      row('Quick-order prices', c.prices) +
      row('Photos kept inside records', c.pics ? c.pics + ' <span class="muted">(become records of their own)</span>' : 'none') +
      row('Storage locations', c.locations) +
      row('Who changes settings', esc(P.adminNames.join(', ') || 'Dr. A')) +
      row('AI keys', P.hasAi ? 'yes, moved too' : 'none saved') +
      (P.notes.length ? '<div class="hint" style="margin-top:10px"><b>Worth knowing:</b><ul class="mvNotes">' + P.notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul></div>' : '') +
      '<div class="hint">Make sure nobody is using Inventory on another computer while it moves (it takes about a minute).</div>' +
      (MV.err ? '<div class="lockErr" role="alert">' + esc(MV.err) + '</div>' : '') +
      '<div class="btnRow"><button class="btn btn-pri" data-act="mvGo">' + ic('upload', 16) + 'Move it now</button><button class="btn btn-ghost" data-act="mvRead">Read it again</button></div>';
  } else if (st === 'moving' || st === 'checking') {
    const pct = MV.total ? Math.round(MV.done / MV.total * 100) : 0;
    h += '<p class="small">' + (st === 'checking' ? 'Checking every count and dollar…' : 'Saving ' + MV.done + ' of ' + MV.total + ' records…') + ' Keep this page open.</p>' +
      '<div class="bar"><i style="width:' + (st === 'checking' ? 100 : pct) + '%"></i></div>';
  } else if (st === 'done' && MV.res) {
    const r = MV.res;
    h += '<p class="small"><b>Moved.</b> Everything matches the old Inventory: ' + plural(r.items, 'supply', 'supplies') + ', ' + plural(r.orders, 'order') + ', ' + plural(r.vendors, 'saved vendor') + ', ' + plural(r.log, 'log entry', 'log entries') + ', ' + money(r.money) + ' in the log.</p>' +
      '<p class="small">From now on everyone signs in here with their NLO Cases login. The old address will send people here once it’s switched over.</p>' +
      '<div class="btnRow"><button class="btn btn-pri" data-act="mvOpen">Open Inventory</button></div>';
  } else if (st === 'error') {
    h += '<div class="lockErr" role="alert">' + esc(MV.err || 'The move stopped.') + '</div><p class="small">Nothing is marked moved, and the old Inventory wasn’t changed. Running the move again saves the same records over the ones already saved, so it’s safe to try again.</p>' +
      '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="mvRead">Read it again</button></div>';
  }
  return h + '</div></div>';
}
/* after the card is drawn: is this computer already connected to the old Inventory (NLO Cases' roster connection)? */
function moveAfter() {
  if (S.gate !== 'move' || MV.checked) return;
  MV.checked = true;
  OLD.user().then(u => { if (u && !MV.who) { MV.who = u.email || (S.emu ? 'test account' : 'a Google account'); renderView(); } }).catch(() => { });
}
ACT.mvConnect = async () => {
  MV.err = ''; MV.step = 'connecting'; renderView();
  try { const r = await OLD.connect(); MV.who = (r && r.user && r.user.email) || (S.emu ? 'test account' : 'a Google account'); }
  catch (e) { MV.step = 'start'; MV.err = errText(e); renderView(); return; }
  MV.step = 'start'; return ACT.mvRead();
};
ACT.mvSwitch = async () => { await OLD.disconnect().catch(() => { }); MV.who = ''; MV.err = ''; MV.step = 'start'; ACT.mvConnect(); };
ACT.mvRead = async () => {
  MV.err = ''; MV.step = 'reading'; renderView();
  try {
    const old = {}, missing = [];
    for (const [part, needed] of OLD_PARTS) {
      try { old[part] = await OLD.read('nlo/' + part); }
      catch (e) { if (needed) throw e; old[part] = null; missing.push(part); }
    }
    const roster = await B.rosterOnce();
    MV.plan = await planMove(old, roster, missing);
    MV.step = 'ready';
  } catch (e) { console.error(e); MV.step = MV.plan ? 'error' : 'start'; MV.err = errText(e); MV.plan = null; }
  renderView();
};
ACT.mvGo = async () => {
  const P = MV.plan; if (!P) return;
  if (!await confirmBox('Move Inventory now?', 'Make sure nobody is using Inventory on another computer. It takes about a minute; keep this page open.', 'Move it now')) return;
  MV.err = ''; MV.step = 'moving'; MV.done = 0; MV.total = P.pics.length + P.writes.length; S.busy = true; renderView();
  try {
    // photos first (one already saved by an earlier run stays: a photo record is never changed), then the records that point at
    // them; then count everything against what was read
    const have = await B.havePics(P.pics.map(([path]) => path.split('/')[1]));
    await B.moveWrite(P.pics.filter(([path]) => !have.has(path.split('/')[1])).concat(P.writes), (d, n) => { MV.done = d; MV.total = n; if (S.gate === 'move') renderView(); });
    MV.step = 'checking'; renderView();
    const got = await B.moveCounts(), want = P.counts, bad = [];
    [['items', 'supplies'], ['orders', 'orders'], ['vendors', 'saved vendors'], ['log', 'log entries']].forEach(([k, l]) => { if (got[k] !== want[k]) bad.push(l + ': ' + got[k] + ' here, ' + want[k] + ' in the old one'); });
    if (Math.abs(got.money - want.money) > 0.005) bad.push('money in the log: ' + money(got.money) + ' here, ' + money(want.money) + ' in the old one');
    if (bad.length) throw errCode('mismatch', 'The counts don’t match yet — ' + bad.join('; ') + '.');
    const w = whoNow();
    await B.markMoved({ at: Date.now(), by: (w && w.name) || '', from: 'nlo-inventory', counts: { items: got.items, orders: got.orders, vendors: got.vendors, log: got.log, money: got.money, pics: P.pics.length } });
    MV.res = got; MV.step = 'done';
  } catch (e) { console.error(e); MV.step = 'error'; MV.err = errText(e); }
  S.busy = false; renderView();
};
ACT.mvOpen = () => { S.moved = { at: Date.now() }; startLive(); toast('Inventory is open. Everyone signs in here with their NLO Cases login from now on.', { ms: 7000 }); };

/* ---------- working out the move (no saving here): the old records → the records saved here ----------
   old: { 'items': …, 'orders': …, … } as the old database gave them (lists may come as objects); roster: NLO Cases' people
   → { writes: [[path, data]], pics: [[path, data]], counts, months, notes, adminNames, monthly, spendNow, hasAi } */
async function planMove(old, roster, missing) {
  const writes = [], pics = [], notes = [], counts = { items: 0, itemsHidden: 0, orders: 0, ordersOpen: 0, vendors: 0, log: 0, money: 0, cart: 0, expenses: 0, prices: 0, pics: 0, locations: 0 };
  const okId = id => typeof id === 'string' && id.length > 0 && id.length <= 700 && !/\//.test(id) && id !== '.' && id !== '..' && !/^__.*__$/.test(id);
  const skipped = { noId: 0, badId: 0 };
  /* a photo kept inside a record: becomes its own record (made smaller first if it's too big to save) */
  const takePics = async (kind, rec, recId) => {
    for (const k of Object.keys(rec)) {
      const v = rec[k];
      if (typeof v !== 'string' || !/^data:image\//.test(v)) continue;
      const p = await picFrom(v);
      if (!p) { delete rec[k]; notes.push('A photo on ' + kind + ' “' + plainText(rec.name || rec.vendor || recId, 40) + '” couldn’t be read, so it was left behind.'); continue; }
      const id = 'pm_' + hashId(kind + '|' + recId + '|' + k);
      pics.push(['invPics/' + id, { m: p.m, b: p.b, kind: /full|slip/i.test(k) ? 'full' : 'thumb' }]);
      rec[k] = 'pic:' + id; counts.pics++;
    }
  };
  const recs = v => { const out = []; if (v && typeof v === 'object') Object.keys(v).forEach(k => { const r = v[k]; if (r && typeof r === 'object' && !Array.isArray(r)) out.push([k, r]); }); return out; };
  /* supplies, orders, vendors: one record each, under the id the old app used */
  for (const [kind, coll, label] of [['items', 'invItems', 'supply'], ['orders', 'invOrders', 'order'], ['vendors', 'invVendors', 'vendor']]) {
    for (const [, r0] of recs(old[kind])) {
      if (r0.id == null || r0.id === '') { skipped.noId++; continue; }
      const id = String(r0.id); if (!okId(id)) { skipped.badId++; continue; }
      const r = FB.clean(Object.assign({}, r0, { id }));
      delete r.up; delete r.upBy;
      await takePics(label, r, id);
      if (Object.keys(r).length > 110) { notes.push('The ' + label + ' “' + plainText(r.name || r.vendor || id, 40) + '” has too many details to move; it was left behind.'); continue; }
      writes.push([coll + '/' + id, r]); counts[kind]++;
      if (kind === 'items' && (r.deleted || r.archived)) counts.itemsHidden++;
      if (kind === 'orders' && (r.status === 'open' || r.status === 'backordered')) counts.ordersOpen++;
    }
  }
  /* the activity log: one record a month */
  const months = {};
  recs(old.log).forEach(([, e0]) => {
    if (e0.id == null || e0.id === '') { skipped.noId++; return; }
    const e = FB.clean(Object.assign({}, e0, { id: String(e0.id) })), m = FB.logMonth(e);
    (months[m] = months[m] || {})[e.id] = e; counts.log++;
    if (isMoneyEntry(e) && isFinite(Number(e.amount))) counts.money += Number(e.amount);
  });
  counts.money = Math.round(counts.money * 100) / 100;
  const monthIds = Object.keys(months).sort();
  monthIds.forEach(m => { if (Object.keys(months[m]).length > 3000) notes.push('The log for ' + m.slice(1) + ' has more than 3,000 entries.'); writes.push(['invLog/' + m, { e: months[m] }]); });
  /* the shared records */
  const cart = listOf(old.cart).filter(c => c && typeof c === 'object'); counts.cart = cart.length;
  writes.push(['invState/cart', { lines: FB.clean(cart) || [] }]);
  const bud = old.budget && typeof old.budget === 'object' ? old.budget : {}, budOut = {};
  ['monthly', 'categories', 'expenses', 'history', 'changedBy', 'changedAt'].forEach(k => { if (bud[k] != null) budOut[k] = k === 'expenses' || k === 'history' ? listOf(bud[k]) : bud[k]; });
  Object.keys(bud).forEach(k => { if (!(k in budOut) && bud[k] != null) notes.push('The budget’s “' + k + '” wasn’t used by the app and stays behind in the old database.'); });
  if (budOut.monthly == null) budOut.monthly = 8000;
  counts.expenses = listOf(budOut.expenses).length;
  writes.push(['invState/budget', FB.clean(budOut)]);
  const prices = old.elastoPrices && typeof old.elastoPrices === 'object' ? old.elastoPrices : {}; counts.prices = Object.keys(prices).length;
  writes.push(['invState/prices', { p: FB.clean(prices) || {} }]);
  if (old.bracketOrder != null) writes.push(['invState/bracket', { v: FB.clean(old.bracketOrder) }]);
  /* who changes settings: the old app's names (Staff Hub ids) → NLO Cases logins, through Staff Hub's link on each person */
  const people = rosterPeople(roster), owner = people.find(p => p.role === 'owner');
  const oldAdmins = Array.isArray(old['settings/invAdmins']) && old['settings/invAdmins'].length ? old['settings/invAdmins'] : listOf(old['settings/invAdmins']).length ? listOf(old['settings/invAdmins']) : ['s_amir', 's_sarah'];
  const admins = owner ? [owner.id] : [], adminNames = owner ? ['Dr. A'] : [];
  oldAdmins.forEach(rid => {
    if (typeof rid !== 'string') return;
    const p = people.find(x => x.active && (x.rid === rid || x.id === rid));
    if (!p) { if (!/^s_amir$/.test(rid)) notes.push('Someone who changed settings in the old app (' + rid + ') has no NLO Cases login linked to Staff Hub — tick them in Settings → Who can change settings.'); return; }
    if (!admins.includes(p.id)) { admins.push(p.id); adminNames.push(p.short); }
  });
  const locs = listOf(old['settings/locations']).filter(x => typeof x === 'string'); counts.locations = locs.length;
  const set = { locations: locs, invAdmins: admins, alertsOn: old['settings/alertsOn'] === true };
  if (typeof old['settings/geminiProxyUrl'] === 'string' && old['settings/geminiProxyUrl']) set.geminiProxyUrl = old['settings/geminiProxyUrl'];
  if (old['settings/invPrefs'] != null) set.invPrefs = FB.clean(old['settings/invPrefs']);
  writes.push(['invState/settings', set]);
  const ai = {};
  if (typeof old['settings/geminiKey'] === 'string' && old['settings/geminiKey']) ai.gemini = old['settings/geminiKey'];
  if (typeof old['settings/openaiKey'] === 'string' && old['settings/openaiKey']) ai.openai = old['settings/openaiKey'];
  if (Object.keys(ai).length) writes.push(['invState/ai', ai]);
  if (skipped.noId) notes.push(plural(skipped.noId, 'record') + ' in the old database had no id (the old app never showed them), so they stay behind.');
  if (skipped.badId) notes.push(plural(skipped.badId, 'record') + ' had an id the new database can’t take, so they stay behind.');
  (missing || []).forEach(m => notes.push('Couldn’t read “' + m + '” from the old database; it starts empty here.'));
  /* this month's spending from the old records, the app's own way (it must read the same once moved) */
  const D = { items: recs(old.items).map(([, r]) => r), orders: recs(old.orders).map(([, r]) => normOrder(Object.assign({}, r))), log: recs(old.log).map(([, r]) => r), budget: { expenses: listOf(budOut.expenses) } };
  const spendNow = Math.round(monthSpend(monthKey(Date.now()), D).total * 100) / 100;
  return { writes, pics, counts, months: monthIds, notes, adminNames, monthly: Number(budOut.monthly) || 0, spendNow, hasAi: !!Object.keys(ai).length };
}
/* a short id for a moved photo (the same every time the move runs, so running it again replaces, never doubles) */
function hashId(s) { let h1 = 0x811c9dc5, h2 = 0x01000193; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 2246822519) >>> 0; } return h1.toString(36) + h2.toString(36); }
/* a data: URL → { m, b } that fits a photo record, or null */
async function picFrom(d) {
  const m = /^data:(image\/[a-z+.-]+);base64,/i.exec(d); if (!m) return null;
  const type = m[1].toLowerCase(), b = d.slice(d.indexOf(',') + 1);
  try {
    // it has to be a picture the browser can show (then a JPEG, PNG or WebP that fits is kept exactly as it is)
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('bad image')); i.src = d; });
    if (/^image\/(jpeg|png|webp)$/.test(type) && b.length <= PIC_MAX && /^[A-Za-z0-9+/=]*$/.test(b)) return { m: type, b };
    for (const [px, q] of [[1600, 0.82], [1400, 0.75], [1200, 0.7], [1000, 0.65], [800, 0.6], [600, 0.55]]) {
      const k = Math.min(1, px / Math.max(img.naturalWidth || 1, img.naturalHeight || 1)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round((img.naturalWidth || 1) * k)); c.height = Math.max(1, Math.round((img.naturalHeight || 1) * k));
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      const out = c.toDataURL('image/jpeg', q), ob = out.slice(out.indexOf(',') + 1);
      if (ob.length <= PIC_MAX) return { m: 'image/jpeg', b: ob };
    }
  } catch (e) { console.warn('photo', e); }
  return null;
}
