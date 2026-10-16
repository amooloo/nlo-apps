/* =====================================================================
   UI — sign-in, the shell (side menu, top bar, phone bars), dialogs,
   the side drawer, toasts and the click/change/input wiring. Each screen
   lives in its own file and registers its renderer in VIEWS.
   ===================================================================== */
/* ---------- icons ---------- */
const IC = {
  home: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
  box: '<path d="M4 8l8-4 8 4v8.5l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8.5"/>',
  cart: '<circle cx="9" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/><path d="M3 4h2.4l2.2 10.6a1.5 1.5 0 001.5 1.2h7.7a1.5 1.5 0 001.4-1.1L20 8H6.2"/>',
  truck: '<path d="M3 6.5h11v9.5H3z"/><path d="M14 9.5h3.6l3 3.3V16H14"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  chart: '<path d="M4 20.5h16.5"/><path d="M6.5 17V11M11 17V6.5M15.5 17v-4M20 17V9"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  build: '<path d="M4 20.5V6.5l7-3v17"/><path d="M11 9.5h9v11"/><path d="M7 8.5h1M7 12h1M7 15.5h1M14.5 13h1.5M14.5 16.5h1.5"/><path d="M3 20.5h18"/>',
  gear: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
  scan: '<path d="M4 8V5.5A1.5 1.5 0 015.5 4H8M16 4h2.5A1.5 1.5 0 0120 5.5V8M20 16v2.5a1.5 1.5 0 01-1.5 1.5H16M8 20H5.5A1.5 1.5 0 014 18.5V16"/><path d="M7.5 9v6M10.5 9v6M13.5 9v6M16.5 9v6"/>',
  camera: '<path d="M4.5 8h3l1.5-2.5h6L16.5 8h3a1 1 0 011 1v9.5a1 1 0 01-1 1h-15a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  next: '<path d="M9 6l6 6-6 6"/>', back: '<path d="M15 6l-6 6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l1 12.5h9l1-12.5"/>',
  edit: '<path d="M4 20h4l10.5-10.5-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  call: '<path d="M6.2 3.8l2.6-.3 1.6 4.2-2 1.4a10.6 10.6 0 006.5 6.5l1.4-2 4.2 1.6-.3 2.6a2 2 0 01-2.1 1.7A16.5 16.5 0 014.5 5.9a2 2 0 011.7-2.1z"/>',
  text: '<path d="M4.5 5.5h15a1 1 0 011 1v9a1 1 0 01-1 1h-8l-4.5 3.5v-3.5h-2.5a1 1 0 01-1-1v-9a1 1 0 011-1z"/><path d="M8 10h8M8 13h5"/>',
  email: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
  web: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 3.6 5.4 3.6 8.5s-1.2 5.9-3.6 8.5c-2.4-2.6-3.6-5.4-3.6-8.5s1.2-5.9 3.6-8.5z"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0014 4.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5"/>',
  undo: '<path d="M8.5 6.5L4 11l4.5 4.5"/><path d="M4.5 11h10a5 5 0 010 10h-3"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 11-2.2-5.3"/><path d="M19.5 4v4.5H15"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4 19.5h16"/>',
  upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4 19.5h16"/>',
  receive: '<path d="M4 8l8-4 8 4v8.5l-8 4-8-4z"/><path d="M8.5 11.5l2.5 2.5 4.5-4.5"/>',
  doc: '<path d="M7 3.5h7l4 4V20a.5.5 0 01-.5.5h-10.5a.5.5 0 01-.5-.5V4a.5.5 0 01.5-.5z"/><path d="M14 3.5V8h4M9 12h6M9 15.5h6"/>',
  spark: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1-5.1-1.9 5.1-1.9z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  photo: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-8.5 8"/>',
  tag: '<path d="M3.5 12.2V4.5a1 1 0 011-1h7.7l8.3 8.3a1 1 0 010 1.4l-7 7a1 1 0 01-1.4 0z"/><circle cx="8" cy="8" r="1.5"/>',
  pin: '<path d="M12 21s6.5-6 6.5-11a6.5 6.5 0 10-13 0c0 5 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  archive: '<rect x="3.5" y="4.5" width="17" height="4" rx="1"/><path d="M5 8.5v10a1 1 0 001 1h12a1 1 0 001-1v-10M10 12.5h4"/>',
  warn: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20c1.3-3.6 4.2-5.5 7.5-5.5s6.2 1.9 7.5 5.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.3"/><path d="M8 10.5V7.8a4 4 0 018 0v2.7"/>',
  out: '<path d="M14 4.5h4.5a1 1 0 011 1v13a1 1 0 01-1 1H14"/><path d="M10 16l4-4-4-4M14 12H4"/>',
  apps: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  dollar: '<path d="M12 3.5v17"/><path d="M16.5 7.5c-.6-1.6-2.3-2.5-4.5-2.5-2.6 0-4.3 1.3-4.3 3.2 0 4.4 9 2.3 9 6.8 0 2-1.9 3.5-4.7 3.5-2.4 0-4.2-1-4.8-2.8"/>',
  count: '<path d="M5 6.5h14M5 12h14M5 17.5h9"/>',
  back2: '<path d="M4 12h12.5"/><path d="M10 6l-6 6 6 6"/>',
  pause: '<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>',
  print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7.5" rx="1.5"/><path d="M7 14h10v6H7z"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.3"/>',
  google: '<path d="M20.5 12.2c0-.6-.1-1.2-.2-1.8H12v3.4h4.8a4.1 4.1 0 01-1.8 2.7v2.2h2.9c1.7-1.6 2.6-3.9 2.6-6.5z"/><path d="M12 21c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.3 0-4.3-1.6-5-3.7H4v2.3A9 9 0 0012 21z"/><path d="M7 13.8a5.4 5.4 0 010-3.5V8H4a9 9 0 000 8.1z"/><path d="M12 6.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 004 8l3 2.3c.7-2.1 2.7-3.7 5-3.7z"/>'
};
function ic(n, s) { s = s || 18; return '<svg class="i" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IC[n] || '') + '</svg>'; }

/* ---------- toasts ---------- */
function toast(msg, opt) {
  opt = opt || {}; const el = document.createElement('div'); el.className = 'toast' + (opt.bad ? ' bad' : ''); el.setAttribute('role', 'status');
  el.innerHTML = esc(msg) + (opt.action ? ' <button class="linkBtn" style="color:var(--mint);margin-left:10px;pointer-events:auto">' + esc(opt.action) + '</button>' : '');
  if (opt.action) el.querySelector('button').onclick = () => { opt.onAction(); el.remove(); };
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), opt.ms || (opt.action ? 8000 : 3800));
}
function errText(e) {
  const c = String((e && (e.code || e.message)) || '');
  if (/PERMISSION_DENIED|permission/i.test(c)) return 'The database said no. This account may not be allowed to change that.';
  if (/network|unavailable|offline/i.test(c)) return 'Can’t reach the database. Check the internet connection.';
  if (/popup-closed|cancelled-popup/i.test(c)) return 'Sign-in window closed before it finished.';
  if (/popup-blocked/i.test(c)) return 'The browser blocked the sign-in window. Allow pop-ups for this page and try again.';
  if (/not-allowed/i.test(c)) return 'That Google account isn’t one of the office accounts.';
  return (e && e.message) ? String(e.message).replace(/^Firebase:\s*/, '') : 'Something went wrong.';
}
async function act(fn, okMsg) { try { await fn(); if (okMsg) toast(okMsg); return true; } catch (e) { console.error(e); toast(errText(e), { bad: true }); return false; } }
function busyBtn(btn, on, label) { if (!btn) return; if (on) { btn.dataset.l = btn.innerHTML; btn.textContent = label || 'Working…'; btn.disabled = true; } else { btn.innerHTML = btn.dataset.l || btn.innerHTML; btn.disabled = false; } }

/* ---------- boot ---------- */
function boot() {
  const qs = new URLSearchParams(location.search);
  const local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  S.demo = DEMO_ONLY || qs.has('demo'); S.emu = local && qs.has('emu');
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', e => { S.downOn = e.target; }, true);
  whoLoad();
  setInterval(() => { renderWho(); if (S.inApp && !whoNow() && S.who) { S.who = null; whoSave(); renderWho(); } }, 20000);
  if (S.demo) { DEMO.init(); B = FB; $('#demoBar').classList.remove('hidden'); document.body.classList.add('demo'); enterApp(); return; }
  B = FB;
  /* the old app kept copies of the AI keys on each office computer; this one reads them only when a step needs them */
  try { ['nlo-gemini-key', 'nlo_openai_key'].forEach(k => localStorage.removeItem(k)); } catch (e) { }
  if (!FB.init(S.emu)) { lockScreen('unconfigured'); return; }
  FB.onUser(u => {
    if (u === undefined) return lockScreen('loading');
    if (!u) { if (S.inApp) leaveApp(); return lockScreen('signin'); }
    if (!FB.allowed(u)) { FB.signOut(); return lockScreen('signin', { err: 'That Google account (' + u.email + ') isn’t one of the office accounts. Sign in with the office account.' }); }
    if (!S.inApp) enterApp();
  });
  window.addEventListener('online', renderSync); window.addEventListener('offline', renderSync);
}
function lockScreen(mode, info) {
  info = info || {};
  $('#lockWrap').classList.remove('hidden'); $('#app').classList.add('hidden');
  const card = $('#lockCard'); let h = '';
  const err = info.err ? '<div class="lockErr" role="alert">' + esc(info.err) + '</div>' : '';
  if (mode === 'loading') h = '<div class="lsub" style="text-align:center"><span class="spin"></span> Loading…</div>';
  else if (mode === 'unconfigured') h = '<h1>Almost ready</h1><div class="lsub">This copy can’t reach the office database.</div><p class="desc">To look around with made-up supplies, open the demo.</p><a class="btn btn-pri btn-block" href="?demo">Open the demo</a>';
  else h = '<h1>Sign in</h1><div class="lsub">Next Level Orthodontics · supplies and orders</div>' + err +
    '<p class="desc">Use the office Google account. After that, each person just taps their name.</p>' +
    '<button class="btn btn-pri btn-block" data-act="signIn" id="signInBtn">' + ic('google', 18) + 'Sign in with Google</button>' +
    '<div class="lockFoot">Office computers stay signed in. Only the office accounts can open Inventory.</div>';
  card.innerHTML = h;
}
ACT.signIn = async t => { busyBtn(t, true, 'Opening Google…'); try { await FB.signIn(); } catch (e) { busyBtn(t, false); lockScreen('signin', { err: errText(e) }); } };
ACT.signOut = async () => { if (!await confirmBox('Sign this computer out?', 'Everyone on it will need the office Google password to get back in.', 'Sign out', true)) return; whoClear(); await FB.signOut(); };

function enterApp() {
  S.inApp = true; S.view = (location.hash || '').replace('#', '') || 'home'; if (!VIEWS[S.view]) S.view = 'home';
  $('#lockWrap').classList.add('hidden'); $('#app').classList.remove('hidden');
  renderShell(); renderView();
  B.start({
    data(key, val) { setData(key, val); queueRender(); },
    loaded() { S.loadErr = ''; queueRender(); },
    error(key, e) { S.loadErr = errText(e); console.error(key, e); queueRender(); },
    soft(key) { S.denied[key] = true; queueRender(); },
    online(on) { S.online = on; renderSync(); renderBanner(); }
  });
}
function leaveApp() { S.inApp = false; B.stop && B.stop(); closeModal(true); closeDrawer(); }
function allLoaded() { return ['items', 'orders', 'vendors', 'log', 'cart', 'budget'].every(k => S.loaded[k]); }

/* ---------- the data, as the screens use it ---------- */
function setData(key, val) {
  S.loaded[key] = true;
  if (key === 'items') S.D.items = listOf(val).filter(i => i && i.id != null).map(normItem);
  else if (key === 'orders') S.D.orders = listOf(val).filter(o => o && o.id != null).map(normOrder);
  else if (key === 'vendors') S.D.vendors = mergeVendors(listOf(val));
  else if (key === 'log') S.D.log = sortLogNewestFirst(listOf(val).filter(e => e && e.id != null));
  else if (key === 'cart') S.D.cart = listOf(val).filter(c => c && (c.itemId || c.name)).map(normCartLine);
  else if (key === 'bracketOrder') S.D.bracketOrder = val || {};
  else if (key === 'budget') S.D.budget = Object.assign({ monthly: 8000, categories: {}, expenses: [], history: [] }, val || {});
  else if (key === 'elastoPrices') S.D.elastoPrices = val || {};
  else if (key === 'settings') S.settings = val || {};
  else if (key === 'roster') { S.D.roster = val; S.people = rosterPeople(val); renderWho(); }
}
function normItem(i) { if (i.cat && CAT_MIGRATION[i.cat]) i.cat = CAT_MIGRATION[i.cat]; if (!CAT_BY_ID[i.cat]) i.cat = 'misc'; return i; }
function normOrder(o) { o.items = listOf(o.items).filter(Boolean); o.trail = listOf(o.trail).filter(Boolean); return o; }
function normCartLine(c) { if (!c.lineId) c.lineId = 'c-' + (c.itemId || '') + '-' + (c.addedAt || ''); c.trail = listOf(c.trail).filter(Boolean); return c; }
function mergeVendors(saved) {
  const out = VENDORS.map(dv => { const sv = saved.find(s => s && s.id === dv.id); return sv ? Object.assign({}, dv, sv) : Object.assign({}, dv); });
  saved.forEach(sv => { if (sv && sv.id && !VENDORS.find(dv => dv.id === sv.id)) out.push(sv); });
  return out.filter(v => v && !v.deleted);
}
const items = () => S.D.items.filter(i => !i.deleted);
const activeItems = () => items().filter(i => !i.archived);
const itemById = id => S.D.items.find(i => i.id === id) || null;
const orderById = id => S.D.orders.find(o => o.id === id) || null;
function vendorByName(n) { if (!n) return null; return S.D.vendors.find(v => v.name === n) || S.D.vendors.find(v => vendorNamesSimilar(v.name, n)) || null; }
function vendorObj(n) { return vendorByName(n) || { name: n || '' }; }

/* ---------- shell ---------- */
const NAV = [
  ['home', 'Home', 'home'], ['supplies', 'Supplies', 'box'], ['cart', 'Cart', 'cart'], ['orders', 'Orders', 'truck'],
  ['quick', 'Quick order', 'bolt'], ['budget', 'Budget', 'chart'], ['activity', 'Activity', 'clock'], ['vendors', 'Vendors', 'build']
];
function renderShell() {
  const btn = (mob, [k, l, i]) => '<button class="navBtn" data-act="nav" data-v="' + k + '" id="' + (mob ? 'm' : '') + 'nav-' + k + '">' + ic(i) + '<span>' + l + '</span><span class="cnt hidden"></span></button>';
  const navBtns = mob => NAV.map(n => btn(mob, n)).join('') + (mob ? '' : '<div class="navLbl">Office</div>') + btn(mob, ['settings', 'Settings', 'gear']);
  $('#side').innerHTML = '<div class="sideTop"><img data-src="' + LOGO + '" alt="Next Level Orthodontics"><div class="appTag">Inventory</div></div>' +
    '<nav class="nav" aria-label="Main">' + navBtns(false) + '</nav>' +
    '<div class="sideFoot"><div id="whoSlot"></div>' +
    '<a class="sideLink" href="' + APPS_HOME + '">' + ic('apps', 14) + 'NLO Apps</a>' +
    '<div class="syncLine" id="syncLine"></div></div>';
  $('#mobTop').innerHTML = '<img data-src="' + LOGO + '" alt="NLO"><span class="appTag" style="font-size:11px;letter-spacing:.24em">Inventory</span><span style="flex:1"></span>' +
    '<button class="iconBtn" style="color:#fff" data-act="scan" aria-label="Scan a barcode">' + ic('scan') + '</button>' +
    '<a class="iconBtn" style="color:#fff" href="' + APPS_HOME + '" aria-label="NLO Apps" title="NLO Apps">' + ic('apps') + '</a>' +
    '<button class="iconBtn" data-act="who" aria-label="Who’s using this" id="mobWho"></button>';
  $('#mobNav').innerHTML = navBtns(true);
  if (!$('#askFab')) document.body.insertAdjacentHTML('beforeend', '<button id="askFab" class="askFab" data-act="askOpen" title="Ask about spending, orders and who did what" aria-label="Ask">' + ic('spark', 16) + '<span class="t">Ask</span></button>');
  renderWho(); renderSync(); renderNav();
}
function counts() {
  const open = S.D.orders.filter(o => o.status === 'open'), late = open.filter(orderLate);
  return { cart: S.D.cart.length, open: open.length, late: late.length, back: S.D.orders.filter(o => o.status === 'backordered').length };
}
function renderNav() {
  const c = counts();
  const set = (k, n, red) => ['nav-', 'mnav-'].forEach(p => { const el = $('#' + p + k + ' .cnt'); if (!el) return; el.textContent = n; el.classList.toggle('hidden', !n); el.classList.toggle('red', !!red); });
  set('cart', c.cart); set('orders', c.open + c.back, c.late > 0);
  $$('.navBtn[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
  document.title = (c.cart ? '(' + c.cart + ') ' : '') + 'NLO Inventory';
}
function renderSync() {
  const el = $('#syncLine'); if (!el) return;
  let cls = 'ok', t = S.demo ? 'Demo · nothing saved' : 'Live · v' + APP_VERSION;
  if (!S.demo && (!navigator.onLine || !S.online)) { cls = 'bad'; t = 'Offline · saves when back'; }
  else if (B && B.pending > 0) { cls = 'busy'; t = 'Saving…'; }
  el.innerHTML = '<span class="dot ' + cls + '"></span>' + t;
}
function renderBanner() {
  const el = $('#bannerSlot'); if (!el) return;
  let h = '';
  if (!S.demo && (!navigator.onLine || !S.online) && allLoaded()) h = '<div class="banner off">' + ic('warn', 16) + 'No connection. What you do now saves as soon as it’s back — keep this page open.</div>';
  else if (S.loadErr) h = '<div class="banner off">' + ic('warn', 16) + esc(S.loadErr) + '</div>';
  el.innerHTML = h;
}
const TITLES = { home: 'Home', supplies: 'Supplies', cart: 'Cart', orders: 'Orders', quick: 'Quick order', budget: 'Budget', activity: 'Activity', vendors: 'Vendors', settings: 'Settings' };
const SEARCH_VIEWS = { supplies: 'Search supplies, SKUs, vendors…', orders: 'Search vendor, item, order #, who…', activity: 'Search activity…', vendors: 'Search vendors…' };
function topBar() {
  const v = S.view, acts = (VIEWS[v] && VIEWS[v].actions) ? VIEWS[v].actions() : '';
  return '<div class="topBar"><h2>' + esc(TITLES[v] || '') + '</h2>' +
    (SEARCH_VIEWS[v] ? '<label class="searchBox">' + ic('search', 17) + '<span class="hidden">Search</span><input id="q" type="search" placeholder="' + esc(SEARCH_VIEWS[v]) + '" value="' + esc(S.q) + '" aria-label="Search" autocomplete="off"></label>' : '<span style="flex:1"></span>') +
    '<div class="topActs">' + acts + '<button class="btn btn-sec scanBtn" data-act="scan" title="Scan a barcode or QR code">' + ic('scan', 16) + 'Scan</button></div></div>';
}
function queueRender() { if (S.renderQ) return; S.renderQ = true; requestAnimationFrame(() => { S.renderQ = false; if (S.inApp) { renderView(true); renderNav(); renderBanner(); } }); }
function renderView(keep) {
  if (!S.inApp) return;
  const v = $('#view'), qf = document.activeElement && document.activeElement.id === 'q';
  const y = keep ? window.scrollY : 0;
  $('#topSlot').innerHTML = topBar();
  if (!allLoaded()) v.innerHTML = '<div class="card loadCard"><span class="spin"></span><div style="margin-top:10px">Loading the office’s supplies…</div></div>';
  else { try { v.innerHTML = VIEWS[S.view].render(); } catch (e) { console.error(e); v.innerHTML = '<div class="card loadCard">This screen hit a problem: ' + esc(e.message) + '</div>'; } }
  hydrateImages(v);
  if (VIEWS[S.view] && VIEWS[S.view].after) VIEWS[S.view].after();
  if (qf) { const q = $('#q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
  if (keep) window.scrollTo(0, y);
  if (S.drawer) refreshDrawer();
  renderNav();
}
function go(view, opts) {
  if (!VIEWS[view]) view = 'home';
  if (S.view !== view) { S.q = (opts && opts.q) || ''; }
  S.view = view; history.replaceState(null, '', '#' + view);
  closeDrawer(); renderView(); window.scrollTo(0, 0);
}
ACT.nav = t => go(t.dataset.v);

/* ---------- images: item photos are big data URLs, so they're made into blob URLs once and filled in after a render ---------- */
function photoOf(item, full) {
  if (!item) return '';
  if (full && (item.imgFullUrl || item.imgFull)) return item.imgFullUrl || item.imgFull;
  return item.imgUrl || item.img || item.imgFullUrl || item.imgFull || (item.imgKey && PRODUCT_IMGS[item.imgKey]) || '';
}
function imgSrc(src) {
  if (!src || !/^data:/.test(src)) return src;
  const k = src.length + ':' + src.slice(-40);
  if (S.imgCache.has(k)) return S.imgCache.get(k);
  try { const url = URL.createObjectURL(dataUrlToBlob(src)); S.imgCache.set(k, url); return url; } catch (e) { return src; }
}
function thumbHTML(item, cls) {
  const has = !!photoOf(item);
  return '<span class="thumb ' + (cls || '') + '">' + (has ? '<img data-img="' + esc(item.id) + '" alt="">' : ic('box', cls === 'lg' ? 34 : 20)) + '</span>';
}
/* images are written as data-src (never src="…" inside the script: the browser's look-ahead would try to fetch those bits of script) and filled in here */
function hydrateSrc(root) {
  if (!root || root.nodeType !== 1) return;
  const one = im => { const u = im.getAttribute('data-src'); im.removeAttribute('data-src'); if (u) im.src = imgSrc(u); };
  if (root.matches('img[data-src]')) one(root);
  $$('img[data-src]', root).forEach(one);
}
new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(hydrateSrc))).observe(document.documentElement, { childList: true, subtree: true });
function hydrateImages(root) {
  hydrateSrc(root || document.body);
  $$('img[data-img]', root || document).forEach(im => { const it = itemById(im.dataset.img); const s = it && photoOf(it, im.dataset.full === '1'); if (s) im.src = imgSrc(s); im.removeAttribute('data-img'); });
  $$('img[data-vlogo]', root || document).forEach(im => { im.onerror = () => { im.replaceWith(Object.assign(document.createElement('span'), { className: 'vlogo none', innerHTML: ic('build', 14) })); }; im.removeAttribute('data-vlogo'); });
}
function vlogoHTML(v, cls) {
  const u = vendorLogoUrl(v && v.id ? v : vendorObj(v && v.name));
  return u ? '<img class="vlogo ' + (cls || '') + '" data-src="' + esc(u) + '" alt="" loading="lazy" data-vlogo="1" referrerpolicy="no-referrer">' : '<span class="vlogo none ' + (cls || '') + '">' + ic('build', 14) + '</span>';
}

/* ---------- dialogs ---------- */
function openModal(html, opt) {
  opt = opt || {}; closeModal(true);
  const w = document.createElement('div'); w.id = 'modalWrap';
  w.innerHTML = '<div class="modal ' + (opt.cls || '') + '" role="dialog" aria-modal="true">' + html + '</div>';
  document.body.appendChild(w); S.modal = opt;
  /* closes on the backdrop only when the press both starts and ends there, so dragging across a text box never closes it */
  w.addEventListener('click', e => { if (e.target === w && S.downOn === w && !opt.sticky) closeModal(); });
  hydrateImages(w);
  const f = opt.focus ? $(opt.focus, w) : $('input:not([type=hidden]):not([readonly]),select,textarea', w);
  if (f && !opt.noFocus) setTimeout(() => { try { f.focus(); if (f.select && f.type !== 'number') f.select(); } catch (e) { } }, 30);
  return w;
}
function closeModal(silent) {
  const w = $('#modalWrap'); if (!w) return;
  const opt = S.modal || {};
  const ask = !silent && (typeof opt.confirmClose === 'function' ? opt.confirmClose() : opt.confirmClose);
  if (ask) return askClose(w, ask);
  w.remove(); S.modal = null;
  /* cleanup runs however the dialog goes away (even when another dialog replaces it) — e.g. turning the camera off */
  if (opt.cleanup) { try { opt.cleanup(); } catch (e) { console.warn(e); } }
  if (!silent && opt.onClose) opt.onClose();
}
ACT.closeModal = () => closeModal();
/* "close without saving?" is asked inside the dialog, not with the browser's own pop-up (which looks foreign and is blocked in some places) */
function askClose(w, text) {
  const m = $('.modal', w); if (!m) return;
  const had = $('.askClose', m); if (had) { const b = $('[data-ask="keep"]', had); if (b) b.focus(); return; }
  const bar = document.createElement('div'); bar.className = 'askClose'; bar.setAttribute('role', 'alertdialog'); bar.setAttribute('aria-label', text);
  bar.innerHTML = '<span class="grow">' + esc(text) + '</span><button type="button" class="btn btn-sec btn-sm" data-ask="keep">Keep working</button><button type="button" class="btn btn-danger btn-sm" data-ask="close">Close it</button>';
  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-ask]'); if (!b) return; e.stopPropagation();
    if (b.dataset.ask === 'close') { if (S.modal) S.modal.confirmClose = null; closeModal(); } else bar.remove();
  });
  m.appendChild(bar); setTimeout(() => { try { $('[data-ask="keep"]', bar).focus(); } catch (e) { } }, 20);
}
/* the app's own yes/no (and "type a value") box, instead of the browser's — resolves false when cancelled */
function confirmBox(title, text, okLabel, danger, opt) {
  opt = opt || {};
  return new Promise(res => {
    let done = false; const fin = v => { if (done) return; done = true; res(v); };
    const w = openModal('<h3>' + esc(title) + '</h3>' + (text ? '<p class="lsub" style="font-size:13.5px;color:var(--grey-600);white-space:pre-line">' + esc(text) + '</p>' : '') +
      (opt.input ? field(opt.input, '<input id="cbVal" ' + (opt.number ? 'type="number" inputmode="decimal" min="0" step="0.01" ' : '') + 'value="' + esc(opt.value || '') + '" placeholder="' + esc(opt.placeholder || '') + '" data-enter="#cbYes">') : '') +
      '<div class="mFt"><button class="btn btn-sec" id="cbNo">Cancel</button><button class="btn ' + (danger ? 'btn-danger' : 'btn-pri') + '" id="cbYes">' + esc(okLabel || 'OK') + '</button></div>', { cls: 'mid', focus: opt.input ? '#cbVal' : '#cbYes', cleanup: () => fin(false) });
    $('#cbNo', w).onclick = () => { fin(false); closeModal(true); };
    $('#cbYes', w).onclick = () => { const v = opt.input ? $('#cbVal', w).value : true; fin(opt.input ? v : true); closeModal(true); };
  });
}
function modalEl() { return $('#modalWrap .modal'); }

/* ---------- the side drawer (a supply, an order) ---------- */
/* a record saved a moment ago may not have come back from the database yet: the drawer waits for it (briefly) */
function openDrawer(kind, id) { S.drawer = { kind, id, wait: Date.now() }; refreshDrawer(); }
function refreshDrawer() {
  if (!S.drawer) return;
  const fn = DRAWERS[S.drawer.kind]; const html = fn ? fn(S.drawer.id) : '';
  if (!html) { if (S.drawer.wait && Date.now() - S.drawer.wait < 6000) return; return closeDrawer(); }
  S.drawer.wait = 0;
  let sc = $('#scrim'), d = $('#drawer');
  const y = d ? ($('.dBd', d) || {}).scrollTop || 0 : 0;
  if (!sc) { sc = document.createElement('div'); sc.id = 'scrim'; sc.addEventListener('click', closeDrawer); document.body.appendChild(sc); }
  if (!d) { d = document.createElement('aside'); d.id = 'drawer'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); document.body.appendChild(d); }
  d.innerHTML = html; hydrateImages(d);
  const bd = $('.dBd', d); if (bd) bd.scrollTop = y;
}
function closeDrawer() { S.drawer = null; const d = $('#drawer'), s = $('#scrim'); if (d) d.remove(); if (s) s.remove(); }
ACT.closeDrawer = () => closeDrawer();

/* ---------- wiring ---------- */
function onClick(e) {
  const t = e.target.closest('[data-act]'); if (!t || t.disabled) return;
  const fn = ACT[t.dataset.act]; if (!fn) return;
  if (t.tagName === 'A' && !t.getAttribute('href')) e.preventDefault();
  if (t.tagName === 'BUTTON' && t.type === 'submit') e.preventDefault();
  fn(t, e);
}
function onChange(e) { const t = e.target.closest('[data-chg]'); if (t && CHG[t.dataset.chg]) CHG[t.dataset.chg](t, e); }
function onInput(e) {
  if (e.target.id === 'q') { S.q = e.target.value; searchSoon(); return; }
  const t = e.target.closest('[data-inp]'); if (t && INP[t.dataset.inp]) INP[t.dataset.inp](t, e);
}
const searchSoon = debounce(() => renderView(true), 120);
function onKey(e) {
  if (e.key === 'Escape') { const ask = $('#modalWrap .askClose'); if (ask) ask.remove(); else if ($('#modalWrap')) closeModal(); else if (S.drawer) closeDrawer(); return; }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-act][role=button]')) { e.preventDefault(); e.target.click(); }
  if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-enter]')) { e.preventDefault(); const b = $(e.target.dataset.enter); if (b) b.click(); }
}
/* the shared demo page can't print or save files (where it's hosted blocks both); the real app can */
function demoBlocked(what) { if (!DEMO_ONLY) return false; toast(what === 'print' ? 'Printing works in the real app — this demo page can’t open a print window.' : 'Downloads work in the real app — this demo page can’t save files.'); return true; }
async function copyText(s) { try { await navigator.clipboard.writeText(s); toast('Copied.'); } catch (e) { toast('Couldn’t copy — select the text and copy it.', { bad: true }); } }
function field(label, inner, hint) { return '<div class="field"><label>' + esc(label) + '</label>' + inner + (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>'; }
function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
