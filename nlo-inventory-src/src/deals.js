/* =====================================================================
   Vendor deals — the offers in the vendors' promo emails, on supplies
   the office buys. Amir, 16 Oct 2026: "can you find a way for us to get
   live updates on things from Marislist that we actually use? they send
   emails and also they have a website. I usually don't see the
   promotions or I miss them" — and, on a Deal tag: "souldn't they
   appear in the dashboard instead? … the items … or maybe both".
   The alert script (robot/script.js, version 4) reads the promo emails
   in Dr. A's Gmail every hour (6 AM to 9 PM), asks the AI which of the
   office's supplies an offer covers, saves the offer here (invDeals:
   only it may) and pushes it to his phone; it takes an offer off when it
   ends. Only promo emails from vendors go to the AI — never an order,
   shipping, case or patient email.
   Here: Home leads with them, as big photos of the supplies on each
   offer; those supplies carry a Deal tag (Supplies, the drawer, the
   cart), and adding one to the cart puts the offer (and its code) in
   the line's note, for whoever orders. Dr. A takes an offer off with
   Done; "See the email" opens it in his Gmail.
   ===================================================================== */
const DEAL_DAYS = 21;                     // an offer that doesn't say when it ends shows this long (the alert script takes it off then too)
const DEALS_HOME = 4, DEAL_CARDS = 8;     // offers on Home, and supplies shown for each
const dealStr = (v, n) => { const s = v == null ? '' : String(v).trim(); return n && s.length > n ? s.slice(0, n - 1) + '…' : s; };

/* the offers still on, with their supplies still in the catalog, the soonest to end first → { list, by: supply id → [{deal, line}] }
   (worked out once per change: the photo grid asks for every card) */
let dealMemo = null;
function dealIndex() {
  const t = todayISO();
  if (dealMemo && dealMemo.d === S.D.deals && dealMemo.i === S.D.items && dealMemo.t === t) return dealMemo;
  const byId = new Map(); S.D.items.forEach(i => { if (i && i.id != null && !i.deleted && !i.archived) byId.set(String(i.id), i); });
  const list = [];
  listOf(S.D.deals).forEach(d => {
    if (!d || typeof d !== 'object') return;
    const end = /^\d{4}-\d{2}-\d{2}$/.test(String(d.ends || '')) ? String(d.ends) : (Number(d.at) > 0 ? isoOf(new Date(Number(d.at) + DEAL_DAYS * 864e5)) : '');
    if (!end || end < t) return;
    const seen = new Set(), lines = [];
    listOf(d.items).forEach(x => { const it = x && typeof x === 'object' ? byId.get(String(x.id)) : null; if (!it || seen.has(it.id)) return; seen.add(it.id); lines.push({ id: it.id, what: dealStr(x.what, 120), price: dealStr(x.price, 40) }); });
    if (lines.length) list.push(Object.assign({}, d, { vendor: dealStr(d.vendor, 120), title: dealStr(d.title, 200), how: dealStr(d.how, 400), ends: /^\d{4}-\d{2}-\d{2}$/.test(String(d.ends || '')) ? String(d.ends) : '', end, lines }));
  });
  list.sort((a, z) => a.end.localeCompare(z.end) || (Number(z.at) || 0) - (Number(a.at) || 0));
  const by = new Map(); list.forEach(d => d.lines.forEach(l => { if (!by.has(l.id)) by.set(l.id, []); by.get(l.id).push({ deal: d, line: l }); }));
  dealMemo = { d: S.D.deals, i: S.D.items, t, list, by };
  return dealMemo;
}
function liveDeals() { return dealIndex().list; }
function dealsFor(id) { return dealIndex().by.get(id) || []; }
function dealOn(id) { return dealsFor(id)[0] || null; }
/* "ends in 3 days", "ends Oct 31" — or, with no end date given, when it was emailed */
function dealEnds(d) {
  if (!d.ends) return 'emailed ' + fmtAgo(d.at);
  const n = daysBetween(todayISO(), d.ends);
  return n <= 0 ? 'ends today' : n === 1 ? 'ends tomorrow' : n < 7 ? 'ends in ' + n + ' days' : 'ends ' + fmtDate(d.ends);
}
function dealSoon(d) { return !!d.ends && daysBetween(todayISO(), d.ends) <= 2; }
/* what the office usually pays (from the deal's vendor, if it buys it there) */
function dealUsual(it, vendor) {
  const s = (vendor && allSources(it).find(x => vendorNamesSimilar(x.vendor, vendor))) || primarySource(it), cp = countPrice(s);
  if (cp == null) return '';
  return buysBigger(it) ? money(cp * perBuy(it)) + '/' + buyUnit(it) : money(cp) + '/' + countUnit(it);
}
/* the email, in Dr. A's Gmail (only he can open it) */
function dealMailUrl(d) { const u = String((d && d.mail) || ''); return isOwnerAccount() && /^https:\/\/mail\.google\.com\/[^\s"'<>]*$/.test(u) ? u : ''; }
/* the offer as the cart line's note says it, for whoever orders */
function dealNote(dl) {
  const d = dl.deal, l = dl.line;
  return dealStr('Deal from ' + (d.vendor || 'a vendor') + ': ' + (l.what || d.title) + (l.price ? ', ' + l.price : '') + (d.how ? ' — ' + d.how : '') + (d.ends ? ' · ends ' + fmtDate(d.ends) : ''), 240);
}
function dealLineHTML(dl, cls) {
  const d = dl.deal, l = dl.line, mail = dealMailUrl(d);
  return '<div class="notice deal' + (cls ? ' ' + cls : '') + '">' + ic('tag', 15) + '<span><b>' + esc(d.vendor || 'A vendor') + ':</b> ' + esc(l.what || d.title) + (l.price ? ' — <b>' + esc(l.price) + '</b>' : '') +
    ' · <span class="' + (dealSoon(d) ? 'soon' : '') + '">' + esc(dealEnds(d)) + '</span>' + (d.how ? '<br>' + esc(d.how) : '') + (mail ? ' · <a href="' + esc(mail) + '" target="_blank" rel="noopener noreferrer">See the email</a>' : '') + '</span></div>';
}

/* ---------- Home: the offers first, big photos of the supplies on them ---------- */
function dealsHomeHTML() {
  const list = liveDeals(); if (!list.length) return '';
  const boss = isOwnerAccount(), n = dealIndex().by.size;
  return '<div class="card dealsCard"><div class="cardHd"><h3>' + ic('tag', 17) + 'Deals on things you buy</h3><span class="sub">' + plural(list.length, 'offer') + ' · ' + plural(n, 'supply', 'supplies') + '</span><span style="flex:1"></span>' +
    (list.length > DEALS_HOME || list.some(d => d.lines.length > DEAL_CARDS) ? '<button class="btn btn-sec btn-sm" data-act="supDeals">See all</button>' : '') + '</div><div class="cardBd">' +
    list.slice(0, DEALS_HOME).map(d => dealBandHTML(d, boss)).join('') + '</div></div>';
}
function dealBandHTML(d, boss) {
  const mail = dealMailUrl(d);
  return '<div class="dealBand"><div class="dbHd">' + vlogoHTML(vendorObj(d.vendor), 'lg') + '<div class="grow"><b class="dt">' + esc(d.title || 'An offer') + '</b>' +
    '<span class="dm">' + esc(d.vendor || 'A vendor') + ' · <span class="' + (dealSoon(d) ? 'soon' : '') + '">' + esc(dealEnds(d)) + '</span>' + (d.how ? ' · <span title="' + esc(d.how) + '">' + esc(dealStr(d.how, 150)) + '</span>' : '') + '</span></div>' +
    (boss ? '<div class="dbAct">' + (mail ? '<a class="btn btn-ghost btn-sm" href="' + esc(mail) + '" target="_blank" rel="noopener noreferrer">' + ic('email', 15) + 'See the email</a>' : '') +
      '<button class="btn btn-ghost btn-sm" data-act="dealDone" data-id="' + esc(d.id) + '" title="Take this offer off for everyone">' + ic('check', 15) + 'Done</button></div>' : '') + '</div>' +
    '<div class="dbRow">' + d.lines.slice(0, DEAL_CARDS).map(l => dealCardHTML(itemById(l.id), l, d)).join('') + '</div>' +
    (d.lines.length > DEAL_CARDS ? '<button class="btn btn-ghost btn-sm" data-act="supDeals" style="margin-top:8px">and ' + (d.lines.length - DEAL_CARDS) + ' more</button>' : '') + '</div>';
}
/* a supply on an offer: its photo big, the offer on it, then its name, the deal price and what the office usually pays, and Add */
function dealCardHTML(it, l, d) {
  if (!it) return '';
  const c = inCartLine(it.id), has = !!photoOf(it), usual = dealUsual(it, d.vendor);
  return '<div class="pcard dcard" data-act="openItem" data-id="' + esc(it.id) + '" role="button" tabindex="0" aria-label="' + esc(it.name || 'Supply') + '">' +
    '<div class="ph' + (has ? '' : ' none') + '">' + (has ? photoImgHTML(it, false, true) : ic('box', 40) + '<span>No photo yet</span>') +
    '<div class="ptags"><span class="ptag deal">' + ic('tag', 11) + 'Deal</span>' + (c ? '<span class="ptag cart">' + ic('cart', 11) + 'In cart</span>' : '') + '</div>' +
    (has ? '<button class="pzoom" data-act="viewPhoto" data-id="' + esc(it.id) + '" aria-label="See the photo full size" title="See it full size">' + ic('zoom', 16) + '</button>' : '') +
    '<div class="dwhat">' + esc(l.what || d.title) + '</div></div>' +
    '<div class="pbd"><div class="nm">' + esc(it.name || 'Unnamed') + '</div>' +
    (l.price || usual ? '<div class="dpx">' + (l.price ? '<b title="' + esc(l.price) + '">' + esc(l.price) + '</b>' : '') + (usual ? '<span title="What the office usually pays">usually ' + esc(usual) + '</span>' : '') + '</div>' : '') +
    '<div class="dft"><button class="addBtn' + (c ? ' in' : '') + '" data-act="dealAdd" data-id="' + esc(it.id) + '" data-deal="' + esc(d.id) + '" title="Add to the cart">' + ic(c ? 'check' : 'cart', 15) + (c ? 'In the cart' : 'Add to cart') + '</button></div></div></div>';
}
ACT.dealAdd = (t, e) => {
  if (e) e.stopPropagation();
  const it = itemById(t.dataset.id); if (!it) return;
  openAddToCart(it, null, dealsFor(it.id).find(x => String(x.deal.id) === t.dataset.deal) || dealOn(it.id));
};
ACT.supDeals = () => { S.ui.sup = Object.assign(S.ui.sup || { sort: 'cat' }, { show: 'deal', cat: '' }); go('supplies'); };
ACT.dealDone = t => {
  const d = liveDeals().find(x => String(x.id) === t.dataset.id) || S.D.deals.find(x => String(x.id) === t.dataset.id); if (!d) return;
  withAdmin(async () => {
    if (!await confirmBox('Take this offer off?', (d.vendor ? d.vendor + ': ' : '') + (d.title || 'this offer') + '. It comes off Home and its supplies for everyone (the email stays in your Gmail).', 'Take it off', false)) return;
    act(() => B.dealDone(d.id), 'Taken off.');
  }, '', 'take an offer off');
};

/* ---------- Settings (Dr. A): what it needs, and whether it's working ---------- */
function dealsCardHTML(owner) {
  if (!owner) return '';
  const b = S.ui.beat, ver = b && !b.none ? Number(b.ver) || 0 : 0, list = liveDeals(), n = dealIndex().by.size;
  let h = '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Vendor deals</h3><span class="sub">from the promo emails in your Gmail</span></div><div class="cardBd">' +
    '<div class="kvRow"><span>Shown on Home, with a Deal tag on the supply</span><b>' + (S.dealsOff ? '<span class="stat wait">Needs the new rules</span>' : '<span class="stat ok">On</span>') + '</b></div>';
  if (S.dealsOff) h += '<div class="hint" style="margin-top:2px">The office database needs its updated rules to keep the deals (they keep everything else as it is):</div>' +
    '<ol class="steps small"><li>Press <b>Copy the new rules</b>.</li><li>Open the <b>Firebase console</b> → <b>Firestore Database</b> (left menu) → <b>Rules</b> tab.</li><li>Select everything there (Ctrl+A), paste over it, and press <b>Publish</b>.</li><li>Come back and press <b>Check again</b>.</li></ol>' +
    '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="copyRules">' + ic('copy', 15) + 'Copy the new rules</button><a class="btn btn-sec btn-sm" href="https://console.firebase.google.com/project/nlo-cases/firestore/rules" target="_blank" rel="noopener noreferrer">Open the Firebase console</a><button class="btn btn-ghost" data-act="dealsCheck">' + ic('refresh', 15) + 'Check again</button></div>';
  h += '<div class="kvRow"><span>The alert script reads your vendors’ promo emails</span><b>' + (S.demo ? '<span class="stat off">Not in the demo</span>' : !b ? '…' : ver >= 4 ? '<span class="stat ok">On</span>' : '<span class="stat wait">Update it</span>') + '</b></div>';
  if (!S.demo && b && ver < 4) h += '<ol class="steps small"><li>Press <b>Get the alert script</b> (it copies the new version).</li>' +
    '<li>Open your <a href="' + ALERT_SCRIPT_URL + '" target="_blank" rel="noopener noreferrer">NLO Inventory Alerts</a> script, click in <b>Code.gs</b>, select everything (Ctrl+A), paste over it, and press <b>Save</b>.</li>' +
    '<li>Pick <b>setup</b> next to Run and press <b>Run</b>. Google asks you once to allow Gmail (its screen lists everything Gmail access could do): the script only reads your vendors’ promo emails — it doesn’t change or delete any email, and it still sends only your alerts.</li></ol>' +
    '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="alertScript">' + ic('copy', 15) + 'Get the alert script</button></div>';
  else if (b && !b.none && /Deals/.test(String(b.err || ''))) h += '<div class="hint" style="color:var(--coral-700)">' + esc(String(b.err).split(' · ').filter(x => /Deals/.test(x)).join(' · ')) + '</div>';
  h += '<div class="kvRow"><span>On now</span><b>' + (list.length ? plural(list.length, 'offer') + ' · ' + plural(n, 'supply', 'supplies') : 'none') + '</b></div>' +
    (list.length ? '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="nav" data-v="home">' + ic('home', 15) + 'See them on Home</button></div>' : '') +
    '<details class="help"><summary>How it works</summary><div class="hint">Every hour from 6 AM to 9 PM the alert script looks at new emails from your vendors and Mari’s List. Order, shipping, invoice and case emails — and anything mentioning a patient — are skipped; only the offers go to the AI (your Gemini key, above), with your supply list, to find the supplies they cover. ' +
    'An offer on something you buy shows on Home for everyone, with big photos (and a Deal tag on the supply) until it ends — or ' + DEAL_DAYS + ' days, when the email doesn’t say — and comes to your phone as a push (while the phone push is on). Friday mornings you get an email roundup of the week’s offers, including ones on things you don’t buy yet. Done takes one off.</div></details></div></div>';
  return h;
}
ACT.dealsCheck = async t => {
  if (!B.watchDeals) return;
  busyBtn(t, true, 'Checking…');
  await Promise.race([B.watchDeals(), new Promise(r => setTimeout(r, 10000))]);
  if (!S.inApp) return;
  busyBtn(t, false); renderView(true);
  toast(S.dealsOff ? 'The database’s rules don’t have the deals yet. Paste the new ones, Publish, wait a minute, then Check again.' : 'The deals are on.', S.dealsOff ? { bad: true, ms: 8000 } : {});
};
