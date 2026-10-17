/* =====================================================================
   Mari's List — the office's Mari's List member prices, in Inventory
   (Amir, 17 Oct 2026, once the price lists were saved from the member
   portal: "okay all of that needs to be in the inventory app some how").
   - Every Mari's List vendor's deal, code and how to get it (email, call,
     text, their website), with its price files; the member prices from
     those files, searchable; which of them are the same as the office's
     supplies, and what they'd save.
   - Where it's used: the Mari's List screen (everyone), a Mari's List
     part in each supply's drawer, the cart and the place-order dialog (the
     vendor's deal and code; "we're Mari's List members" in the email or
     text when the vendor asks to be told), and Dr. A's Home (what's
     cheaper on Mari's List).
   - Mari's List's prices stay in the office: they're kept in the office
     database (invMl), never in this page — it's published from a public
     repo. Dr. A loads them from a file (Settings → Mari's List) that
     Claude makes from the member portal; everyone signed in reads them;
     only he links them to supplies.
   ===================================================================== */
S.ml = { off: false, info: null, match: {}, rows: null, rowsVer: '', byKey: null, loading: '', err: '', vById: new Map() };
const ML_CATS = [['supplies', 'Clinical supplies'], ['lab', 'Lab & aligners'], ['patients', 'Patient items'], ['office', 'Office & equipment'], ['services', 'Services']];
const ML_CAT_LABEL = Object.fromEntries(ML_CATS);
const ML_PORTAL = 'https://portal.marislist.com';
const ML_SHOW = 150;      // results shown at once
const ML_PART = 900000;   // bytes in one saved part (a record holds 1 MiB)
const ML_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;   // a plain address (nothing that adds to a mailto: link)

/* ---------- the data, as it comes from the database ---------- */
function mlData(key, val) {
  const had = !!S.ml.info;
  if (key === 'mlOff') S.ml.off = val === true;
  else if (key === 'mlInfo') {
    S.ml.info = val && Array.isArray(val.vendors) ? val : null;
    S.ml.vById = new Map(listOf(S.ml.info && S.ml.info.vendors).filter(v => v && v.id).map(v => [v.id, v])); S.ml.vfCache = null;
    if (!S.ml.info || S.ml.rowsVer !== S.ml.info.ver) { S.ml.rows = null; S.ml.byKey = null; S.ml.rowsVer = ''; }
  } else if (key === 'mlMatch') S.ml.match = val && typeof val === 'object' ? val : {};
  /* the menu shows Mari's List to everyone once there's something in it */
  if (had !== !!S.ml.info && S.inApp && S.gate === 'ready') renderShell();
}
function mlOn() { return !!S.ml.info; }
function mlVendors() { return listOf(S.ml.info && S.ml.info.vendors).filter(v => v && v.id); }
function mlVendorById(id) { return S.ml.vById.get(id) || null; }
/* the Mari's List vendor an office vendor name stands for (Reliance Orthodontics → Reliance; ZenduraDental → Zendura) */
function mlVendorFor(name) {
  if (!name || !mlOn()) return null;
  const n = String(name), c = S.ml.vfCache || (S.ml.vfCache = new Map());
  if (!c.has(n)) c.set(n, mlVendors().find(v => v.cat !== 'services' && [v.name].concat(listOf(v.aka)).some(a => a && (a.toLowerCase() === n.toLowerCase() || vendorNamesSimilar(a, n)))) || null);
  return c.get(n);
}
/* the name the office knows a Mari's List vendor by, when it buys from it ('' when it doesn't) */
function mlOurName(mv) {
  if (!mv) return '';
  const names = new Set(S.D.vendors.map(v => v.name).filter(Boolean));
  activeItems().forEach(i => allSources(i).forEach(s => { if (s.vendor) names.add(s.vendor); }));
  for (const n of names) if (mlVendorFor(n) === mv) return n;
  return '';
}
/* (cart.js's plainText() makes text plain for a text message; this one only shortens) */
function mlCut(s, max) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return max && s.length > max ? s.slice(0, max - 1).replace(/[\s,;.:—–-]+$/, '') + '…' : s; }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return String(u || ''); } }
/* a vendor's logo: the office's own logo for it, else its site's icon, else its initials */
function mlLogoHTML(mv, cls) {
  const ours = mv && S.D.vendors.find(v => mlVendorFor(v.name) === mv && vendorLogoUrl(v));
  if (ours) return vlogoHTML(ours, cls);
  const w = mv && webUrl(mv.web);
  const ini = String((mv && mv.name) || '?').replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
  if (w) return '<img class="vlogo ' + (cls || '') + '" data-src="' + esc('https://www.google.com/s2/favicons?domain=' + encodeURIComponent(hostOf(w)) + '&sz=128') + '" alt="" loading="lazy" data-vlogo="1" data-ini="' + esc(ini) + '" referrerpolicy="no-referrer">';
  return '<span class="vlogo mlIni ' + (cls || '') + '">' + esc(ini) + '</span>';
}

/* ---------- the prices: read when a screen needs them, then kept for the visit ----------
   A row is [vendor id, item #, description, unit, member price, retail price, section, note, file]; its key (for links to
   supplies) is made from the vendor, the item # (or the description) and the unit, so it stays the same when a newer set of
   the same price lists is loaded. */
function mlHash(s) { let h = 5381; s = String(s || ''); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
function mlKeys(rows) {
  const seen = new Map();
  return rows.map(r => {
    const base = r[0] + '|' + (r[1] ? String(r[1]).trim().toUpperCase() : '#' + mlHash(String(r[2] || '').toLowerCase())) + '|' + String(r[3] || '').trim().toLowerCase();
    const n = (seen.get(base) || 0) + 1; seen.set(base, n);
    return n > 1 ? base + '~' + n : base;
  });
}
function mlIndex(raw, ver) {
  const keys = mlKeys(raw), byKey = new Map();
  const rows = raw.map((a, k) => {
    const mv = mlVendorById(a[0]) || { id: a[0], name: a[0] };
    const r = { k: keys[k], v: a[0], n: a[1] || '', d: a[2] || '', u: a[3] || '', p: typeof a[4] === 'number' ? a[4] : null, r: typeof a[5] === 'number' ? a[5] : null, s: a[6] || '', note: a[7] || '', f: Number.isInteger(a[8]) ? a[8] : -1, mv };
    r.dt = normSearch(r.d + ' ' + r.n);
    r.t = normSearch([mv.name, r.n, r.d, r.u, r.s, r.note].join(' '));
    byKey.set(r.k, r);
    return r;
  });
  S.ml.rows = rows; S.ml.byKey = byKey; S.ml.rowsVer = ver;
}
/* (once reading a set has failed, it's tried again only on Try again or a newer set — a screen redrawing never loops on it) */
function mlEnsureRows() {
  const info = S.ml.info; if (!info || !B.mlRows) return;
  if (S.ml.rows && S.ml.rowsVer === info.ver) return;
  if (S.ml.loading === info.ver || (S.ml.err && S.ml.errVer === info.ver)) return;
  S.ml.loading = info.ver; S.ml.err = '';
  B.mlRows(info).then(raw => {
    if (S.ml.info && S.ml.info.ver === info.ver) mlIndex(raw, info.ver);
    S.ml.loading = ''; queueRender();
  }).catch(e => { console.warn('marislist', e); S.ml.loading = ''; S.ml.err = errText(e); S.ml.errVer = info.ver; queueRender(); });
}
ACT.mlRetry = () => { S.ml.err = ''; S.ml.errVer = ''; mlEnsureRows(); renderView(true); };
function mlRowByKey(k) { return (S.ml.byKey && S.ml.byKey.get(k)) || null; }

/* ---------- searching: every word, however it's spelled (sm = small, ss = stainless, o-ties = elastomeric ligatures …) ---------- */
const ML_SYN = {
  small: ['sm', 'sml'], sm: ['small'], medium: ['med', 'md'], med: ['medium'], md: ['medium'], large: ['lg', 'lrg'], lg: ['large'],
  xlarge: ['xl', 'x-large'], xl: ['x-large', 'xlarge', 'extra large'], xsmall: ['xs', 'x-small'], xs: ['x-small', 'xsmall', 'extra small'],
  niti: ['nickel titanium', 'ni-ti', 'nitinol', 'nt3'], stainless: ['ss', 's/s'], ss: ['stainless'], tma: ['beta ti', 'beta-ti', 'beta titanium'],
  'o-tie': ['o tie', 'otie', 'o-ring', 'o ring', 'elastomeric ligature', 'elastic ligature', 'ligature tie', 'alastik', 'module'],
  otie: ['o-tie', 'o tie', 'o-ring', 'elastomeric ligature', 'ligature tie'], ligature: ['lig'], chain: ['e-chain', 'power chain'],
  glove: ['gloves'], nitrile: ['nitril'], mask: ['masks', 'face mask'], pouch: ['pouches', 'sterilization pouch', 'steri pouch'],
  bur: ['burs', 'carbide'], elastic: ['elastics', 'rubber band', 'intraoral'], cutter: ['cutters', 'nipper'], plier: ['pliers'],
  bracket: ['brackets', 'brkt'], tube: ['tubes', 'buccal tube'], band: ['bands'], wire: ['wires', 'archwire'], archwire: ['arch wire', 'wire'],
  retainer: ['retainers'], aligner: ['aligners'], etch: ['etchant', 'phosphoric'], adhesive: ['paste', 'bonding'], cheek: ['cheek retractor'],
  retractor: ['retractors'], mirror: ['mirrors'], brush: ['brushes', 'toothbrush'], floss: ['flosser', 'threader'], wax: ['relief wax', 'ortho wax']
};
/* a short word (sm, lg, ss, 16) matches only as a word of its own ("ss" isn't in "glass", ".016" isn't ".016 x .022") */
function mlTest(a) {
  if (a.length > 3) return t => t.includes(a);
  const re = new RegExp('(^|[^a-z0-9])' + a.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') + '($|[^a-z0-9])');
  return t => re.test(t);
}
function mlWords(q) {
  return normSearch(q).split(/\s+/).filter(Boolean).map(w => {
    if (w.length > 4 && /(x|ch|sh)es$/.test(w)) w = w.slice(0, -2);
    else if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) w = w.slice(0, -1);
    const alts = Array.from(new Set([w].concat(ML_SYN[w] || []).map(normSearch)));
    return { w, alts, tests: alts.map(mlTest) };
  });
}
/* opt: v (one vendor), loose (most of the words, best first: "Find it on Mari's List" from a supply), sort */
function mlSearch(q, opt) {
  opt = opt || {};
  const rows = S.ml.rows || [], words = mlWords(q), out = [];
  if (!words.length) { const all = opt.v ? rows.filter(r => r.v === opt.v) : []; return opt.sort === 'price' ? all.slice().sort((a, b) => (a.p == null ? Infinity : a.p) - (b.p == null ? Infinity : b.p)) : all; }
  const need = opt.loose ? Math.max(1, Math.ceil(words.length * 0.6)) : words.length;
  for (const r of rows) {
    if (opt.v && r.v !== opt.v) continue;
    let hit = 0, inD = 0;
    for (const w of words) {
      if (w.tests.some(f => f(r.t))) { hit++; if (w.tests.some(f => f(r.dt))) inD++; }
      else if (!opt.loose) break;
    }
    if (hit >= need) out.push({ r, hit, inD });
  }
  const price = x => x.r.p == null ? Infinity : x.r.p;
  if (opt.sort === 'price') out.sort((a, b) => price(a) - price(b));
  else if (opt.sort === 'vendor') out.sort((a, b) => a.r.mv.name.localeCompare(b.r.mv.name) || price(a) - price(b));
  else out.sort((a, b) => (b.hit - a.hit) || (b.inD - a.inD) || (a.r.d.length - b.r.d.length) || price(a) - price(b));
  return out.map(x => x.r);
}
/* how many pieces one unit holds, when the unit (or the description) says so plainly: "Pack of 10", "10/pk", "Box of 200", "10EA" */
function mlCount(r) {
  const one = s => {
    s = String(s || '');
    const m = s.match(/\b(?:pack|pk|pkg|box|bx|bag|bg|case|cs|carton|ctn|kit|jar|bottle|btl|tub|roll|sleeve|bundle|set)\s+of\s+(\d[\d,]*)\b/i)
      || s.match(/\b(\d[\d,]*)\s*\/\s*(?:pack|pk|pkg|box|bx|bag|bg|case|cs|carton|ctn|kit|jar|btl|bottle|roll|sleeve|set|tub|bundle)\b/i)
      || s.match(/\b(\d[\d,]*)\s*[- ]?(?:pack|pk|ct|count|pcs|pieces)\b/i)
      || s.match(/\b(\d[\d,]*)\s*ea\b/i);
    const n = m ? Number(m[1].replace(/,/g, '')) : 0;
    return n >= 2 && n <= 100000 ? n : 0;
  };
  return one(r.u) || one(r.d);
}
function mlEach(p) { return p < 0.1 ? '$' + p.toFixed(3) : money(p); }
/* the member price, with the retail one and the piece price when the file says enough */
function mlPriceHTML(r, big) {
  if (r.p == null) return '<span class="muted">' + esc(r.note || 'no price') + '</span>';
  const off = r.r && r.r > r.p ? Math.round((1 - r.p / r.r) * 100) : 0, n = mlCount(r);
  return '<b' + (big ? ' class="big2"' : '') + '>' + money(r.p) + '</b>' + (r.u ? '<small>' + esc(r.u) + '</small>' : '') +
    (r.r ? '<small>retail ' + money(r.r) + (off ? ' · ' + off + '% off' : '') + '</small>' : '') + (n ? '<small>≈ ' + mlEach(r.p / n) + ' each</small>' : '');
}

/* ---------- the office's supplies: what's linked to Mari's List, and what it saves ----------
   A link: { k: row key, x: how many of the supply's counted units one Mari's List unit is, and what the row said (v, n, d, u, p, r)
   when it was linked — so a drawer shows it without reading every price } */
function mlLinks(itemId) { return listOf((S.ml.match || {})[itemId]).filter(m => m && m.k); }
/* the linked row now (the newest prices once they're read), else as it was linked */
function mlLinkRow(m) { const r = mlRowByKey(m.k); return r ? { k: r.k, v: r.v, n: r.n, d: r.d, u: r.u, p: r.p, r: r.r } : m; }
/* units of a supply received in the last 365 days (what a year of it is, for the savings) */
function mlYearUnits(itemId) {
  let n = 0;
  S.D.orders.forEach(o => { if (o.status !== 'received' || daysAgo(o.dateReceived || o.dateOrdered) > 365) return; o.items.forEach(l => { if (l.itemId === itemId) n += lineStockDelta(l); }); });
  return n;
}
function mlCompare(it, m) {
  const row = mlLinkRow(m), x = Number(m.x) > 0 ? Number(m.x) : 1, cp = countPrice(primarySource(it));
  const sim = m.s === 'similar';
  if (row.p == null) return { row, x, sim, per: null, cp, diff: null, pct: null, year: null };
  const per = row.p / x, diff = cp == null ? null : cp - per, pct = cp ? diff / cp : null, units = mlYearUnits(it.id);
  return { row, x, sim, per, cp, diff, pct, year: diff != null && units ? diff * units : null };
}
/* the best Mari's List price linked to a supply (null: none, or no price to compare) */
function mlBest(it) {
  const all = mlLinks(it.id).map(m => mlCompare(it, m)).filter(c => c.per != null);
  return all.sort((a, b) => a.per - b.per)[0] || null;
}
function mlSaveTag(c) {
  if (!c || c.pct == null) return '';
  if (c.pct >= 0.03) return '<span class="mlSave">Save ' + Math.round(c.pct * 100) + '%</span>';
  if (c.pct > -0.03) return '<span class="mlSave same">Same price</span>';
  return '<span class="mlSave more">' + Math.round(-c.pct * 100) + '% more</span>';
}
/* the supplies a linked Mari's List price beats by 3% or more, the biggest yearly saving (by last year's buying) first */
function mlCheaper() {
  return activeItems().map(it => ({ it, c: mlBest(it) })).filter(x => x.c && x.c.pct != null && x.c.pct >= 0.03)
    .sort((a, b) => ((b.c.year || 0) - (a.c.year || 0)) || (b.c.pct - a.c.pct));
}

/* ---------- the screen ---------- */
VIEWS.ml = {
  render() {
    const u = S.ui.ml || (S.ui.ml = { cat: '', sort: 'best', v: '', for: '', loose: false });
    if (S.ml.off) return isOwnerAccount() ? mlRulesCardHTML() : '<div class="card"><div class="empty">Mari’s List prices aren’t set up yet. Dr. A is on it.</div></div>';
    if (!mlOn()) return isOwnerAccount() ? '<div class="card mlIntro"><div class="cardHd"><h3>Mari’s List prices</h3></div><div class="cardBd"><p class="small">Load the Mari’s List file Claude made from the member portal, and everyone here sees each vendor’s deal, code and how to order — and the member prices, next to what you pay now.</p>' + mlLoadBtnHTML() + '</div></div>' : '<div class="card"><div class="empty">Dr. A hasn’t loaded the Mari’s List prices yet.</div></div>';
    const info = S.ml.info, vs = mlVendors(), withPrices = vs.filter(v => v.n > 0).length;
    let h = '<div class="hello">Member prices from the <a href="' + ML_PORTAL + '" target="_blank" rel="noopener noreferrer">Mari’s List portal</a>' + (info.at ? ', as of <b>' + esc(fmtDate(info.at)) + '</b>' : '') + ' · ' + plural(vs.length, 'vendor') + ' · ' + Number(info.rows || 0).toLocaleString('en-US') + ' member prices from ' + withPrices + ' of them</div>';
    const forIt = u.for ? itemById(u.for) : null;
    if (forIt) {
      const cp = countPrice(primarySource(forIt));
      h += '<div class="mlFor">' + thumbHTML(forIt, 'md') + '<div class="grow"><b>Mari’s List prices for ' + esc(forIt.name) + '</b><span>' + (cp != null ? 'You pay ' + money(cp) + ' per ' + esc(countUnit(forIt)) + ((primarySource(forIt) || {}).vendor ? ' at ' + esc(primarySource(forIt).vendor) : '') + '. ' : '') +
        (isAdmin() ? 'Tap <b>Same as ours</b> on the one that’s the same product.' : 'Dr. A links the one that’s the same product.') + (u.loose ? ' These are the closest matches — change the words to look for something else.' : '') + '</span></div><button class="btn btn-ghost btn-sm" data-act="mlForDone">' + ic('x', 14) + 'Done</button></div>';
    }
    const q = S.q.trim();
    if (q || u.v) {
      mlEnsureRows();
      if (!S.ml.rows) return h + (S.ml.err ? '<div class="card"><div class="empty">' + esc(S.ml.err) + '<br><br><button class="btn btn-sec btn-sm" data-act="mlRetry">' + ic('refresh', 14) + 'Try again</button></div></div>' : '<div class="card loadCard"><span class="spin"></span><div style="margin-top:10px">Reading the member prices…</div></div>');
      const all = mlSearch(q, { v: u.v, loose: !!(u.loose && forIt), sort: u.sort }), mv = u.v ? mlVendorById(u.v) : null;
      h += '<div class="filters">' + (mv ? '<button class="chip on" data-act="mlV" data-v="">' + esc(mv.name) + ' ' + ic('x', 12) + '</button>' : '') +
        '<select data-chg="mlSort" aria-label="Sort">' + [['best', 'Best match'], ['price', 'Lowest price'], ['vendor', 'By vendor']].map(([k, l]) => '<option value="' + k + '"' + (u.sort === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
        '<span class="muted small">' + (all.length > ML_SHOW ? 'the first ' + ML_SHOW + ' of ' + all.length.toLocaleString('en-US') + ' — add a word to narrow it' : plural(all.length, 'price')) + '</span></div>';
      if (!all.length) return h + '<div class="card"><div class="empty">No Mari’s List price matches “' + esc(q) + '”' + (mv ? ' at ' + esc(mv.name) : '') + '. Try fewer or other words (a brand, a size, an item #).</div></div>';
      return h + '<div class="card mlList">' + all.slice(0, ML_SHOW).map(r => mlRowHTML(r, forIt)).join('') + '</div>';
    }
    /* what's cheaper for the supplies already linked */
    const cheap = mlCheaper();
    if (cheap.length) h += mlCheaperCardHTML(cheap, 6, false);
    const counts = {}; vs.forEach(v => { counts[v.cat] = (counts[v.cat] || 0) + 1; });
    h += '<div class="chips"><button class="chip' + (!u.cat ? ' on' : '') + '" data-act="mlCat" data-c="">All<span class="c">' + vs.length + '</span></button>' +
      (vs.some(v => mlOurName(v)) ? '<button class="chip' + (u.cat === 'ours' ? ' on' : '') + '" data-act="mlCat" data-c="ours">We buy from<span class="c">' + vs.filter(v => mlOurName(v)).length + '</span></button>' : '') +
      ML_CATS.filter(([k]) => counts[k]).map(([k, l]) => '<button class="chip' + (u.cat === k ? ' on' : '') + '" data-act="mlCat" data-c="' + k + '">' + esc(l) + '<span class="c">' + counts[k] + '</span></button>').join('') + '</div>';
    const list = vs.filter(v => !u.cat || (u.cat === 'ours' ? !!mlOurName(v) : v.cat === u.cat))
      .sort((a, b) => ML_CATS.findIndex(c => c[0] === a.cat) - ML_CATS.findIndex(c => c[0] === b.cat) || (mlOurName(b) ? 1 : 0) - (mlOurName(a) ? 1 : 0) || ((b.n > 0) - (a.n > 0)) || a.name.localeCompare(b.name));
    if (!list.length) return h + '<div class="card"><div class="empty">None here.</div></div>';
    let grid = '', cat = null;
    list.forEach(v => { if (!u.cat && v.cat !== cat) { cat = v.cat; grid += '<div class="catHead">' + esc(ML_CAT_LABEL[cat] || '') + '<span class="c">' + list.filter(x => x.cat === cat).length + '</span></div>'; } grid += mlVendorCardHTML(v); });
    return h + '<div class="mlGrid">' + grid + '</div>';
  },
  after() { const u = S.ui.ml || {}; if (mlOn() && (S.q.trim() || u.v)) mlEnsureRows(); }
};
function mlVendorCardHTML(v) {
  const ours = mlOurName(v);
  return '<div class="mlv' + (ours ? ' ours' : '') + '" data-act="mlVendor" data-id="' + esc(v.id) + '" role="button" tabindex="0">' +
    '<div class="mlvHd">' + mlLogoHTML(v, 'lg') + '<div class="grow"><b>' + esc(v.name) + '</b><span>' + esc(ML_CAT_LABEL[v.cat] || '') + (v.n ? ' · ' + Number(v.n).toLocaleString('en-US') + ' prices' : '') + '</span></div>' +
    (ours ? '<span class="fl cart" title="In your vendors as ' + esc(ours) + '">' + ic('check', 11) + 'We buy here</span>' : '') + '</div>' +
    '<div class="mlvDeal">' + esc(v.deal || '') + '</div>' +
    '<div class="mlvFt">' + (v.code ? '<button class="mlCode" data-act="mlCopy" data-t="' + esc(v.code) + '" title="Copy the code">' + ic('copy', 12) + esc(v.code) + '</button>' : '') + '<span class="muted small">' + esc(mlCut(v.how || '', 90)) + '</span></div></div>';
}
function mlRowHTML(r, forIt) {
  const linked = forIt && mlLinks(forIt.id).some(m => m.k === r.k);
  return '<div class="mlr" data-act="mlRow" data-k="' + esc(r.k) + '" role="button" tabindex="0">' + mlLogoHTML(r.mv) +
    '<div class="mid"><div class="nm">' + esc(r.d) + '</div><div class="sub"><span class="v">' + esc(r.mv.name) + '</span>' + (r.n ? '<span>#' + esc(r.n) + '</span>' : '') + (r.s ? '<span>' + esc(r.s) + '</span>' : '') + (r.note ? '<span>' + esc(r.note) + '</span>' : '') + '</div></div>' +
    '<div class="pr">' + mlPriceHTML(r) + '</div>' +
    (forIt && isAdmin() ? (linked ? '<span class="fl cart">' + ic('check', 11) + 'Linked</span>' : '<button class="btn btn-sec btn-sm" data-act="mlLinkAsk" data-k="' + esc(r.k) + '">Same as ours</button>') : '') + '</div>';
}
function mlCheaperCardHTML(list, max, home) {
  return '<div class="card mlCheap"' + (home ? ' style="margin-top:18px"' : ' style="margin-bottom:18px"') + '><div class="cardHd"><h3>Cheaper on Mari’s List</h3><span class="sub">' + plural(list.length, 'supply', 'supplies') + ' you buy</span><span style="flex:1"></span>' + (home ? '<button class="btn btn-ghost btn-sm" data-act="nav" data-v="ml">' + ic('tag', 14) + 'Mari’s List</button>' : '') + '</div><div class="cardBd" style="padding-top:0">' +
    list.slice(0, max).map(({ it, c }) => '<div class="row" data-act="openItem" data-id="' + esc(it.id) + '">' + thumbHTML(it, 'sm') + '<div class="grow"><span class="pt">' + esc(it.name) + '</span><span class="meta">You pay ' + money(c.cp) + ' · ' + esc(mlVendorName(c.row.v)) + ' ' + money(c.per) + ' per ' + esc(countUnit(it)) + (c.sim ? ' (similar item)' : '') + (c.year ? ' · saves about ' + money(c.year, { whole: true }) + ' a year' : '') + '</span>' +
      '<button class="mlQuoteBtn" data-act="mlQuote" data-k="' + esc(c.row.k) + '" data-id="' + esc(it.id) + '" title="Writes the email to ' + esc(mlVendorName(c.row.v)) + '">' + ic('email', 13) + 'Ask for a quote</button></div>' + mlSaveTag(c) + '</div>').join('') +
    (list.length > max ? '<div class="muted small" style="padding:6px 8px">and ' + (list.length - max) + ' more — each supply’s drawer shows its Mari’s List prices</div>' : '') + '</div></div>';
}
function mlVendorName(id) { const v = mlVendorById(id); return v ? v.name : id; }
ACT.mlCat = t => { S.ui.ml.cat = t.dataset.c; renderView(true); };
ACT.mlV = t => { S.ui.ml.v = t.dataset.v || ''; renderView(true); };
CHG.mlSort = t => { S.ui.ml.sort = t.value; renderView(true); };
ACT.mlCopy = (t, e) => { if (e) e.stopPropagation(); copyText(t.dataset.t); };
ACT.mlVendor = (t, e) => { if (e && e.target.closest('[data-act]') !== t) return; openDrawer('mlv', t.dataset.id); };
ACT.mlRow = (t, e) => { if (e && e.target.closest('[data-act]') !== t) return; openDrawer('mlr', t.dataset.k); };
ACT.mlForDone = () => { S.ui.ml.for = ''; S.ui.ml.loose = false; S.q = ''; renderView(); };
ACT.mlVendorPrices = t => { const u = S.ui.ml || (S.ui.ml = { cat: '', sort: 'best', v: '', for: '', loose: false }); u.v = t.dataset.id; u.for = ''; u.loose = false; S.q = ''; closeDrawer(); go('ml'); };

/* ---------- a vendor's drawer: the deal, the code, how to get it, its price files ---------- */
function mlContactsHTML(mv) {
  const dk = typeof devKind === 'function' ? devKind() : 'pc';
  return listOf(mv.contacts).map(c => {
    const who = c.who ? ' · ' + esc(c.who) : '';
    if (c.k === 'email' && ML_EMAIL.test(c.v || '')) return '<a class="btn btn-sec btn-sm" href="' + esc(mlHelloMail(mv, c.v, c.who)) + '">' + ic('email', 15) + esc(c.v) + who + '</a>';
    if (c.k === 'phone') { const d = dialable(c.v); return d.num ? '<a class="btn btn-sec btn-sm" href="tel:' + esc(d.num + (d.ext ? ',' + d.ext : '')) + '">' + ic('call', 15) + esc(c.v) + who + '</a>' : ''; }
    if (c.k === 'text') { const d = dialable(c.v); return !d.num ? '' : dk === 'pc' ? '<button class="btn btn-sec btn-sm" data-act="mlCopy" data-t="' + esc(c.v) + '" title="This computer can’t send a text: copy the number for your phone">' + ic('text', 15) + 'Text ' + esc(c.v) + who + '</button>' : '<a class="btn btn-sec btn-sm" href="sms:' + esc(d.num) + '">' + ic('text', 15) + 'Text ' + esc(c.v) + who + '</a>'; }
    if (c.k === 'web') { const u = webUrl(c.v); return u ? '<a class="btn btn-sec btn-sm" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + ic('web', 15) + esc(hostOf(u)) + who + '</a>' : ''; }
    return '';
  }).join('');
}
function mlHowHTML(mv) {
  return '<div class="mlHow">' + (mv.code ? '<div class="mlCodeBig"><span>Code</span><b>' + esc(mv.code) + '</b><button class="btn btn-ghost btn-sm" data-act="mlCopy" data-t="' + esc(mv.code) + '">' + ic('copy', 14) + 'Copy</button></div>' : '') +
    (mv.how ? '<div class="txt">' + esc(mv.how) + '</div>' : '') + (listOf(mv.contacts).length ? '<div class="btnRow">' + mlContactsHTML(mv) + '</div>' : '') + '</div>';
}
DRAWERS.mlv = id => {
  const mv = mlVendorById(id); if (!mv) return '';
  const ours = mlOurName(mv), files = listOf(mv.files).filter(f => f && webUrl(f.u));
  const linked = activeItems().map(it => ({ it, ls: mlLinks(it.id).filter(m => mlLinkRow(m).v === id) })).filter(x => x.ls.length);
  let h = '<div class="dHd">' + mlLogoHTML(mv, 'lg') + '<div style="flex:1;min-width:0"><h3>' + esc(mv.name) + '</h3><div class="sub"><span class="badge">' + esc(ML_CAT_LABEL[mv.cat] || '') + '</span>' + (ours ? '<span class="badge" style="background:var(--mint-100);color:var(--mint-700)">' + ic('check', 11) + 'We buy here' + (ours !== mv.name ? ' (' + esc(ours) + ')' : '') + '</span>' : '') + (mv.uses ? '<span class="badge">The office uses them</span>' : '') + '</div></div><button class="iconBtn" data-act="closeDrawer" aria-label="Close">' + ic('x') + '</button></div><div class="dBd">';
  h += '<div class="sec" style="margin-top:0"><h5>Mari’s List deal</h5><div class="mlDealBig">' + esc(mv.deal || '—') + '</div></div>';
  h += '<div class="sec"><h5>How to get it</h5>' + mlHowHTML(mv) + '</div>';
  if (mv.n) h += '<div class="sec"><h5>Member prices</h5><div class="kvRow"><span>' + Number(mv.n).toLocaleString('en-US') + ' prices from ' + plural(files.length || 1, 'price list') + '</span><button class="btn btn-act btn-sm" data-act="mlVendorPrices" data-id="' + esc(id) + '">' + ic('search', 14) + 'See them</button></div></div>';
  if (files.length) h += '<div class="sec"><h5>Price files</h5>' + files.map(f => '<div class="kvRow"><span>' + ic('doc', 13) + ' ' + esc(f.t || 'Price list') + (f.d ? ' <span class="muted">(' + esc(f.d) + ')</span>' : '') + '</span><a class="btn btn-ghost btn-sm" href="' + esc(webUrl(f.u)) + '" target="_blank" rel="noopener noreferrer">Open ' + ic('link', 12) + '</a></div>').join('') + '</div>';
  if (linked.length) h += '<div class="sec"><h5>Your supplies with its prices</h5>' + linked.map(({ it, ls }) => { const c = mlCompare(it, ls[0]); return '<div class="row" data-act="openItem" data-id="' + esc(it.id) + '">' + thumbHTML(it, 'sm') + '<div class="grow"><span class="pt">' + esc(it.name) + '</span><span class="meta">' + (c.per != null ? money(c.per) + ' per ' + esc(countUnit(it)) + (c.cp != null ? ' · you pay ' + money(c.cp) : '') : esc(c.row.d)) + '</span></div>' + mlSaveTag(c) + '</div>'; }).join('') +
    '<div class="btnRow"><button class="btn btn-act btn-sm" data-act="mlQuote" data-v="' + esc(id) + '">' + ic('email', 14) + 'Ask for a quote on ' + (linked.length === 1 ? 'it' : 'these ' + linked.length) + '</button></div></div>';
  if (mv.note) h += '<div class="sec"><h5>Notes</h5><div class="txt">' + esc(mv.note) + '</div></div>';
  h += '<div class="hint" style="margin-top:18px">From the Mari’s List member portal' + (S.ml.info && S.ml.info.at ? ', ' + esc(fmtDate(S.ml.info.at)) : '') + '. For the office only — Mari’s List’s prices aren’t to be shared. <a href="' + ML_PORTAL + '" target="_blank" rel="noopener noreferrer">Open the portal</a></div>';
  return h + '</div>';
};
/* ---------- one price's drawer ---------- */
DRAWERS.mlr = k => {
  const r = mlRowByKey(k) || mlSnapRow(k);
  if (!r) { mlEnsureRows(); return S.ml.rows || S.ml.err ? '' : '<div class="dHd"><h3>Mari’s List</h3><span style="flex:1"></span><button class="iconBtn" data-act="closeDrawer" aria-label="Close">' + ic('x') + '</button></div><div class="dBd"><div class="loadCard"><span class="spin"></span> Reading the member prices…</div></div>'; }
  const mv = mlVendorById(r.v) || { id: r.v, name: r.v }, f = Number.isInteger(r.f) && r.f >= 0 ? listOf(mv.files)[r.f] : null;
  const linkedTo = activeItems().filter(it => mlLinks(it.id).some(m => m.k === k));
  const forIt = S.ui.ml && S.ui.ml.for ? itemById(S.ui.ml.for) : null;
  let h = '<div class="dHd">' + mlLogoHTML(mv, 'lg') + '<div style="flex:1;min-width:0"><h3 style="font-size:18px">' + esc(r.d) + '</h3><div class="sub"><span class="badge">' + esc(mv.name) + '</span>' + (r.n ? '<span class="badge">#' + esc(r.n) + '</span>' : '') + (r.s ? '<span class="badge">' + esc(r.s) + '</span>' : '') + '</div></div><button class="iconBtn" data-act="closeDrawer" aria-label="Close">' + ic('x') + '</button></div><div class="dBd">';
  h += '<div class="sec" style="margin-top:0"><h5>Mari’s List price</h5><div class="mlBigPrice">' + mlPriceHTML(r, true) + '</div>' + (r.note ? '<div class="hint">' + esc(r.note) + '</div>' : '') +
    '<div class="btnRow"><button class="btn btn-act" data-act="mlQuote" data-k="' + esc(k) + '">' + ic('email', 15) + 'Ask ' + esc(mv.name) + ' for a quote</button></div></div>';
  if (linkedTo.length) h += '<div class="sec"><h5>Your supplies it’s linked to</h5>' + linkedTo.map(it => { const c = mlCompare(it, mlLinks(it.id).find(m => m.k === k)); return '<div class="row" data-act="openItem" data-id="' + esc(it.id) + '">' + thumbHTML(it, 'sm') + '<div class="grow"><span class="pt">' + esc(it.name) + '</span><span class="meta">' + (c.sim ? 'similar item · ' : 'same item · ') + (c.per != null ? '1 ' + esc(r.u || 'unit') + ' = ' + esc(qtyUnit(c.x, countUnit(it))) + ' · ' + money(c.per) + ' per ' + esc(countUnit(it)) + (c.cp != null ? ' · you pay ' + money(c.cp) : '') : '') + '</span></div>' + mlSaveTag(c) + (isAdmin() ? '<button class="iconBtn" data-act="mlUnlink" data-id="' + esc(it.id) + '" data-k="' + esc(k) + '" aria-label="Not the same" title="Not the same — take the link off">' + ic('x', 15) + '</button>' : '') + '</div>'; }).join('') + '</div>';
  if (isAdmin()) h += '<div class="btnRow">' + (forIt && !linkedTo.includes(forIt) ? '<button class="btn btn-act" data-act="mlLinkAsk" data-k="' + esc(k) + '">' + ic('link', 15) + 'Same as ' + esc(mlCut(forIt.name, 28)) + '</button>' : '') + '<button class="btn btn-ghost" data-act="mlLinkPick" data-k="' + esc(k) + '">' + ic('link', 15) + 'Same as one of our supplies…</button></div>';
  h += '<div class="sec"><h5>How to get it from ' + esc(mv.name) + '</h5>' + (mv.deal ? '<div class="txt" style="margin-bottom:8px">' + esc(mv.deal) + '</div>' : '') + mlHowHTML(mv) + '<div class="btnRow"><button class="btn btn-ghost btn-sm" data-act="mlVendor" data-id="' + esc(mv.id) + '">' + ic('build', 14) + 'All about ' + esc(mv.name) + '</button></div></div>';
  if (f && webUrl(f.u)) h += '<div class="sec"><h5>From</h5><div class="kvRow"><span>' + ic('doc', 13) + ' ' + esc(f.t || 'Price list') + (f.d ? ' <span class="muted">(' + esc(f.d) + ')</span>' : '') + '</span><a class="btn btn-ghost btn-sm" href="' + esc(webUrl(f.u)) + '" target="_blank" rel="noopener noreferrer">Open ' + ic('link', 12) + '</a></div></div>';
  return h + '</div>';
};
/* a linked row known only from its link (the prices not read yet) */
function mlSnapRow(k) {
  for (const id of Object.keys(S.ml.match || {})) { const m = mlLinks(id).find(x => x.k === k); if (m) return { k, v: m.v, n: m.n || '', d: m.d || '', u: m.u || '', p: typeof m.p === 'number' ? m.p : null, r: typeof m.r === 'number' ? m.r : null, s: '', note: '', f: -1 }; }
  return null;
}

/* ---------- in a supply's drawer ---------- */
function mlItemSecHTML(it) {
  if (!mlOn()) return '';
  const links = mlLinks(it.id), src = primarySource(it), mvOurs = src && mlVendorFor(src.vendor);
  let h = '<div class="sec mlSec"><h5>' + ic('tag', 12) + ' Mari’s List</h5>';
  links.forEach(m => {
    const c = mlCompare(it, m), mv = mlVendorById(c.row.v) || { id: c.row.v, name: c.row.v };
    h += '<div class="srcRow mlLinkRow" data-act="mlRow" data-k="' + esc(m.k) + '" role="button" tabindex="0">' + mlLogoHTML(mv) + '<div style="min-width:0"><div class="v">' + esc(mv.name) + ' ' + mlSaveTag(c) + (m.s === 'similar' ? '<span class="mlSim" title="Another maker’s product with the same specs">similar item</span>' : '') + '</div><div class="k">' + esc(c.row.d) + (c.row.n ? ' · #' + esc(c.row.n) : '') + '</div></div>' +
      '<div class="p">' + (c.row.p == null ? '<span class="muted">—</span>' : money(c.row.p) + '<small>per ' + esc(c.row.u || 'unit') + (c.x !== 1 ? ' · ' + money(c.per) + '/' + esc(countUnit(it)) : '') + '</small>' + (c.year ? '<small>≈ ' + money(c.year, { whole: true }) + ' a year</small>' : '')) + '</div></div>';
  });
  if (mvOurs) h += '<div class="mlNote" data-act="mlVendor" data-id="' + esc(mvOurs.id) + '" role="button" tabindex="0">' + esc(src.vendor) + ' is on Mari’s List: ' + esc(mlCut(mvOurs.deal || '', 110)) + (mvOurs.code ? ' Code <b>' + esc(mvOurs.code) + '</b>.' : '') + '</div>';
  if (!links.length && !mvOurs) h += '<div class="muted small">Not linked to a Mari’s List price yet.</div>';
  /* a quote from the vendor with the best linked price (or the only one, when none says a price) — unless it costs more */
  const q = mlBest(it) || (links.length ? mlCompare(it, links[0]) : null), qmv = q && mlVendorById(q.row.v);
  h += '<div class="btnRow">' + (q && q.row.k && (q.pct == null || q.pct > -0.03) ? '<button class="btn btn-sec" data-act="mlQuote" data-k="' + esc(q.row.k) + '" data-id="' + esc(it.id) + '">' + ic('email', 15) + 'Ask ' + esc(qmv ? qmv.name : q.row.v) + ' for a quote</button>' : '') +
    '<button class="btn btn-ghost" data-act="mlFind" data-id="' + esc(it.id) + '">' + ic('search', 15) + (links.length ? 'Look for more on Mari’s List' : 'Find it on Mari’s List') + '</button></div>';
  return h + '</div>';
}
/* the words to look for: the supply's name, without what's only on our label */
function mlQueryFor(it) {
  return String(it.name || '').replace(/[—–"“”()]/g, ' ').replace(/[.,;:]+(?=\s|$)/g, ' ').replace(/\b(\d+)-(stick|ring|ct|pk|pack)\b/gi, '$1 $2').split(/\s+/)
    .filter(w => w && w.length > 1 && !/^(the|and|for|with|of|per|pkg|pack|box|bag|color|colors|assorted)$/i.test(w)).slice(0, 6).join(' ');
}
ACT.mlFind = t => {
  const it = itemById(t.dataset.id); if (!it) return;
  S.ui.ml = Object.assign(S.ui.ml || { cat: '', sort: 'best' }, { for: it.id, loose: true, v: '' });
  closeDrawer(); S.view = 'ml'; history.replaceState(null, '', '#ml'); S.q = mlQueryFor(it); renderView(); window.scrollTo(0, 0);
};

/* ---------- linking a price to a supply (Dr. A) ---------- */
ACT.mlLinkPick = t => withAdmin(() => {
  const r = mlRowByKey(t.dataset.k) || mlSnapRow(t.dataset.k); if (!r) return;
  S.ui.mlPick = { k: r.k };
  openModal('<h3>Same as one of our supplies</h3><div class="lsub">' + esc(r.d) + ' · ' + esc(mlVendorName(r.v)) + '</div>' +
    field('Which supply?', '<input id="mlPickQ" placeholder="Type to find it" data-inp="mlPickQ" autocomplete="off">') + '<div id="mlPickList" class="mlPick"></div>', { cls: 'mid', focus: '#mlPickQ' });
  INP.mlPickQ();
}, '', 'link Mari’s List prices');
INP.mlPickQ = () => {
  const q = val('mlPickQ').trim(), box = $('#mlPickList'); if (!box) return;
  const list = (q ? activeItems().filter(i => matchesAll(itemSearchText(i), q)) : activeItems()).slice(0, 12);
  box.innerHTML = list.map(i => '<button class="row" data-act="mlLinkAsk" data-k="' + esc(S.ui.mlPick.k) + '" data-id="' + esc(i.id) + '">' + thumbHTML(i, 'sm') + '<span class="grow"><span class="pt">' + esc(i.name) + '</span><span class="meta">' + esc([(primarySource(i) || {}).vendor, countPrice(primarySource(i)) != null ? money(countPrice(primarySource(i))) + ' per ' + countUnit(i) : ''].filter(Boolean).join(' · ')) + '</span></span></button>').join('') || '<div class="empty">No supply matches.</div>';
  hydrateImages(box);
};
/* how many of the supply's counted units one Mari's List unit is: the same when both say how many are inside */
function mlGuessX(it, r) {
  const n = mlCount(r), ours = Number(it.baseUnitsPerOrderUnit) > 1 ? Number(it.baseUnitsPerOrderUnit) : mlCount({ u: (it.note || '').split('·')[0], d: it.name });
  if (n && ours) { const x = n / ours; return x >= 0.01 && x <= 1000 ? Math.round(x * 1000) / 1000 : 1; }
  return 1;
}
ACT.mlLinkAsk = (t, e) => withAdmin(() => {
  if (e) e.stopPropagation();
  const r = mlRowByKey(t.dataset.k) || mlSnapRow(t.dataset.k), it = itemById(t.dataset.id || (S.ui.ml && S.ui.ml.for)); if (!r || !it) return;
  const cp = countPrice(primarySource(it)), x = mlGuessX(it, r);
  S.ui.mlLink = { k: r.k, id: it.id };
  openModal('<h3>Same product?</h3><div class="lsub">Links this Mari’s List price to <b>' + esc(it.name) + '</b>, so its drawer, the cart and Home compare them.</div>' +
    '<div class="mlPair"><div>' + thumbHTML(it, 'md') + '<b>' + esc(it.name) + '</b><span>' + (cp != null ? money(cp) + ' per ' + esc(countUnit(it)) : 'no price saved') + ((primarySource(it) || {}).vendor ? ' · ' + esc(primarySource(it).vendor) : '') + '</span></div>' +
    '<div>' + mlLogoHTML(r.mv || mlVendorById(r.v) || { name: r.v }, 'lg') + '<b>' + esc(r.d) + '</b><span>' + (r.p != null ? money(r.p) + ' per ' + esc(r.u || 'unit') : 'no price') + ' · ' + esc(mlVendorName(r.v)) + '</span></div></div>' +
    '<div class="bigRow">1 ' + esc(r.u || 'unit') + ' of theirs = <input id="mlX" type="number" inputmode="decimal" min="0.001" step="any" value="' + esc(String(x)) + '" class="xs" aria-label="How many of ours" data-inp="mlX" data-enter="#mlLinkGo"> ' + esc(unitWord(countUnit(it), 2)) + ' of ours</div>' +
    '<div class="hint" id="mlXSay"></div>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeModal">Cancel</button><button class="btn btn-pri" id="mlLinkGo" data-act="mlLinkGo">' + ic('link', 15) + 'Link them</button></div>', { cls: 'mid', focus: '#mlX' });
  INP.mlX();
}, '', 'link Mari’s List prices');
INP.mlX = () => {
  const L = S.ui.mlLink, it = L && itemById(L.id), r = L && (mlRowByKey(L.k) || mlSnapRow(L.k)), el = $('#mlXSay'); if (!it || !r || !el) return;
  const x = num(val('mlX')), cp = countPrice(primarySource(it));
  if (!(x > 0) || r.p == null) { el.textContent = ''; return; }
  const per = r.p / x;
  el.innerHTML = 'That’s ' + money(per) + ' per ' + esc(countUnit(it)) + (cp != null ? ' — you pay ' + money(cp) + (cp - per > 0.005 ? ': <b style="color:var(--mint-700)">' + Math.round((1 - per / cp) * 100) + '% less</b>' : cp - per < -0.005 ? ': ' + Math.round((per / cp - 1) * 100) + '% more' : ': the same') : '') + '.';
};
ACT.mlLinkGo = t => withAdmin(async () => {
  const L = S.ui.mlLink, it = L && itemById(L.id), r = L && (mlRowByKey(L.k) || mlSnapRow(L.k)), x = num(val('mlX'));
  if (!it || !r) return closeModal(true);
  if (!(x > 0)) return toast('How many of ours is one of theirs?', { bad: true });
  const s = stamp(), entry = { k: r.k, x: Math.round(x * 1000) / 1000, s: 'same', v: r.v, n: r.n || '', d: r.d, u: r.u || '', p: r.p, r: r.r, by: s.by, at: s.at };
  const list = mlLinks(it.id).filter(m => m.k !== r.k).concat([entry]);
  busyBtn(t, true, 'Linking…');
  if (await act(() => B.mlMatchSet(it.id, list), 'Linked to ' + mlCut(it.name, 40) + '.')) { closeModal(true); if (S.drawer && S.drawer.kind === 'mlr') refreshDrawer(); } else busyBtn(t, false);
}, '', 'link Mari’s List prices');
ACT.mlUnlink = (t, e) => withAdmin(async () => {
  if (e) e.stopPropagation();
  const it = itemById(t.dataset.id); if (!it) return;
  if (!await confirmBox('Not the same?', 'Takes this Mari’s List price off ' + it.name + '. The price stays on Mari’s List.', 'Take it off', true)) return;
  act(() => B.mlMatchSet(it.id, mlLinks(it.id).filter(m => m.k !== t.dataset.k)), 'Taken off.');
}, '', 'link Mari’s List prices');

/* ---------- Home (Dr. A), the cart and the place-order dialog ---------- */
function mlHomeCardHTML() { if (!mlOn() || !isAdmin()) return ''; const list = mlCheaper(); return list.length ? mlCheaperCardHTML(list, 5, true) : ''; }
/* a cart vendor that's on Mari's List: its deal and code, in the vendor's card */
function mlCartVendorHTML(vn) {
  const mv = mlVendorFor(vn); if (!mv) return '';
  return '<button class="mlChip" data-act="mlVendor" data-id="' + esc(mv.id) + '" title="' + esc(mv.deal || '') + '">' + ic('tag', 12) + 'Mari’s List' + (mv.code ? ' · code <b>' + esc(mv.code) + '</b>' : mv.say ? ' · say you’re a member' : '') + '</button>';
}
/* a cart line Mari's List has cheaper at another vendor */
function mlCartLineHTML(c) {
  const it = itemById(c.itemId), b = it && mlBest(it); if (!b || b.pct == null || b.pct < 0.03) return '';
  const mv = mlVendorById(b.row.v), here = mlVendorFor(c.vendor);
  if (here && mv && here.id === mv.id && Math.abs(b.diff) < 0.01) return '';
  return '<div class="note mlLineNote" data-act="mlRow" data-k="' + esc(b.row.k || '') + '" role="button" tabindex="0">' + ic('tag', 12) + ' Mari’s List: ' + money(b.per) + ' per ' + esc(countUnit(it)) + ' at ' + esc(mv ? mv.name : b.row.v) + ' — ' + Math.round(b.pct * 100) + '% less' + (b.sim ? ' (similar item)' : '') + '</div>';
}
/* in the place-order dialog: how to get the member price from this vendor */
function mlPlaceHTML(vn) {
  const mv = mlVendorFor(vn); if (!mv) return '';
  return '<div class="mlPlace">' + ic('tag', 16) + '<div class="grow"><b>Mari’s List member pricing' + (mv.deal ? ': ' + esc(mlCut(mv.deal, 120)) : '') + '</b><span>' + esc(mv.how || '') + (mv.say ? ' The email and the text below say so.' : '') + '</span></div>' + (mv.code ? '<button class="mlCode" data-act="mlCopy" data-t="' + esc(mv.code) + '" title="Copy the code">' + ic('copy', 12) + esc(mv.code) + '</button>' : '') + '</div>';
}
/* the line the order email and text carry for a vendor that asks to be told */
function mlOrderSay(vn) { const mv = mlVendorFor(vn); return mv && mv.say ? 'We’re Mari’s List members — please apply our Mari’s List pricing.' : ''; }

/* ---------- asking a vendor for a quote ----------
   Amir, 17 Oct 2026, of gloves Mari's List has cheaper at Allure: "there is option to email but then it's blank. There should be
   the option to ask for a quote so it would write out an email asking for a quote for the specific item just to verify that it
   is in fact the price we think it is".
   - "Ask for a quote" is on a price, on a supply's Mari's List part, on each "Cheaper on Mari's List" line and on a vendor (for
     all the office's supplies linked to its prices). It opens the email, written out: each item as the price list names it
     (item #, unit), the member price we have and the list it's from, what it would replace when it's another maker's, how many
     (the supply's last order, in their units — changeable in the dialog), and a request to confirm the price, the shipping and
     any minimum. Nothing is saved.
   - It goes to the address Mari's List gives for the vendor, else the office's rep or email for them. A vendor's own email
     button opens with a hello and the office's sign-off, never blank. */
function mlMailto(to, subject, body) { return 'mailto:' + (to || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body); }
function mlGmail(to, subject, body) { return 'https://mail.google.com/mail/?view=cm&fs=1' + (to ? '&to=' + encodeURIComponent(to) : '') + '&su=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body); }
/* who a quote goes to */
function mlQuoteTo(mv) {
  const c = listOf(mv && mv.contacts).find(c => c && c.k === 'email' && ML_EMAIL.test(c.v || ''));
  if (c) return { email: c.v, who: c.who || '' };
  const ov = (mv && vendorByName(mlOurName(mv))) || {};
  if (ML_EMAIL.test(ov.repEmail || '')) return { email: ov.repEmail, who: ov.rep || '' };
  if (ML_EMAIL.test(ov.email || '')) return { email: ov.email, who: '' };
  return { email: '', who: '' };
}
/* the sign-off: who's writing, and the office (where it ships to, for the shipping cost) */
function mlSignOff() { const w = whoNow(), n = signName(w); return 'Thank you!\n' + (n ? n + '\n' : '') + OFFICE.name + '\n' + OFFICE.address + '\n' + OFFICE.phone; }
/* a vendor's email button: a hello, never a blank email */
function mlHelloMail(mv, to, who) {
  return mlMailto(to, 'Mari’s List member — ' + OFFICE.name, 'Hello' + (who ? ' ' + firstName(who) : '') + ',\n\nWe’re Mari’s List members' + (mv && mv.code ? ' (code ' + mv.code + ')' : '') + '.\n\n\n\n' + mlSignOff());
}
/* how many we'd order, in their units: what the supply's last order put on the shelf ('' when it's never been ordered) */
function mlQuoteQty(it, x) {
  if (!it) return '';
  let last = null;
  S.D.orders.forEach(o => {
    if (!o || o.status === 'voided') return;
    const l = listOf(o.items).find(l => l && l.itemId === it.id), t = msOf(o.orderedAt || o.dateOrdered || o.dateReceived);
    if (l && lineStockDelta(l) > 0 && (!last || t > last.t)) last = { t, n: lineStockDelta(l) };
  });
  return last ? String(Math.max(1, Math.round(last.n / (x > 0 ? x : 1)))) : '';
}
/* the lines a tap asks about: one price (for the supply it was tapped on, else every supply linked to it), or everything the
   office has linked at one vendor */
function mlQuoteLines(t) {
  const out = [], seen = new Set();
  const add = (k, it) => {
    if (seen.has(k + '|' + (it ? it.id : ''))) return; seen.add(k + '|' + (it ? it.id : ''));
    const m = it && mlLinks(it.id).find(m => m.k === k);
    out.push({ k, id: it ? it.id : '', qty: it ? mlQuoteQty(it, m && Number(m.x) > 0 ? Number(m.x) : 1) : '' });
  };
  if (t.dataset.k) {
    const k = t.dataset.k, it = t.dataset.id ? itemById(t.dataset.id) : null, ls = it ? [it] : activeItems().filter(i => mlLinks(i.id).some(m => m.k === k));
    if (ls.length) ls.forEach(i => add(k, i)); else add(k, null);
  } else if (t.dataset.v) activeItems().forEach(it => mlLinks(it.id).forEach(m => { if (mlLinkRow(m).v === t.dataset.v) add(m.k, it); }));
  return out.filter(l => mlRowByKey(l.k) || mlSnapRow(l.k));
}
function mlQuoteItemText(r, l, mv) {
  const it = l.id ? itemById(l.id) : null, m = it && mlLinks(it.id).find(m => m.k === r.k), f = Number.isInteger(r.f) && r.f >= 0 ? listOf(mv.files)[r.f] : null, q = num(l.qty);
  return '• ' + r.d +
    (r.n || r.u ? '\n  ' + [r.n ? 'Item # ' + r.n : '', r.u ? 'Unit: ' + r.u : ''].filter(Boolean).join(' · ') : '') +
    '\n  Mari’s List price we have: ' + (r.p != null ? money(r.p) + (r.note ? ' (' + r.note + ')' : '') : (r.note || 'none listed')) +
    (f && f.t ? '\n  Price list: ' + f.t + (f.d && f.t.indexOf(f.d) < 0 ? ', ' + f.d : '') : '') +
    (it && m && m.s === 'similar' ? '\n  To replace what we use now: ' + it.name : '') +
    (q > 0 ? '\n  Quantity: ' + qtyFmt(q) : '');
}
/* the email: { to, who, subject, body } */
function mlQuoteText(Q) {
  const mv = mlVendorById(Q.v) || { id: Q.v, name: Q.v }, to = mlQuoteTo(mv), ov = vendorByName(mlOurName(mv)) || {};
  const ls = Q.lines.map(l => ({ l, r: mlRowByKey(l.k) || mlSnapRow(l.k) })).filter(x => x.r), one = ls.length === 1;
  const subject = 'Quote request: ' + (one ? mlCut(ls[0].r.d, 60) + (ls[0].r.n ? ' (#' + ls[0].r.n + ')' : '') : ls.length + ' items') + ' — ' + OFFICE.name;
  const body = 'Hello' + (to.who ? ' ' + firstName(to.who) : '') + ',\n\n' +
    'We’re Mari’s List members' + (mv.code ? ' (code ' + mv.code + ')' : '') + (ov.acct ? '; our account with you is ' + ov.acct : '') + '. Could you send us a quote for ' + (one ? 'this item' : 'these items') + '? We’d like to check the member price before we order.\n\n' +
    ls.map(x => mlQuoteItemText(x.r, x.l, mv)).join('\n\n') +
    '\n\nPlease confirm ' + (one ? 'that’s our member price' : 'those are our member prices') + ', and let us know the shipping cost and any minimum order.\n\n' + mlSignOff();
  return { to: to.email, who: to.who, subject, body };
}
ACT.mlQuote = (t, e) => {
  if (e) e.stopPropagation();
  const lines = mlQuoteLines(t), r0 = lines[0] && (mlRowByKey(lines[0].k) || mlSnapRow(lines[0].k));
  if (!r0) return toast('There’s no Mari’s List price here to ask about.', { bad: true });
  S.ui.quote = { v: r0.v, lines };
  renderQuote();
};
function renderQuote() {
  const Q = S.ui.quote, mv = mlVendorById(Q.v) || { id: Q.v, name: Q.v }, T = mlQuoteText(Q), dk = typeof devKind === 'function' ? devKind() : 'pc';
  const items = Q.lines.map((l, i) => {
    const r = mlRowByKey(l.k) || mlSnapRow(l.k), it = l.id ? itemById(l.id) : null; if (!r) return '';
    return '<div class="mlq">' + (it ? thumbHTML(it, 'sm') : mlLogoHTML(mv)) + '<div class="grow"><b>' + esc(r.d) + '</b><span>' + esc([r.n ? '#' + r.n : '', r.u, r.p != null ? money(r.p) : r.note].filter(Boolean).join(' · ')) + '</span>' + (it ? '<span class="for">for ' + esc(it.name) + '</span>' : '') + '</div>' +
      '<label class="mlqQty"><span>How many' + (r.u ? ' (' + esc(mlCut(r.u, 22)) + ')' : '') + '</span><input type="number" inputmode="numeric" min="0" step="1" value="' + esc(l.qty || '') + '" placeholder="—" data-inp="mlQuoteQty" data-i="' + i + '" id="mlqQty' + i + '"></label></div>';
  }).join('');
  openModal('<h3>Ask ' + esc(mv.name) + ' for a quote</h3>' +
    '<div class="lsub">' + (T.to ? 'To <b>' + esc(T.to) + '</b>' + (T.who ? ' (' + esc(T.who) + ')' : '') : 'No email saved for ' + esc(mv.name) + ' — add the address in your email, or copy the email into their website’s form') + '. It asks them to confirm the member price, the shipping and any minimum.</div>' +
    '<div class="mlqList">' + items + '</div>' +
    '<div class="btnRow"><a class="btn btn-act" id="mlQuoteMail" href="' + esc(mlMailto(T.to, T.subject, T.body)) + '">' + ic('email', 16) + 'Write the email</a>' +
    (dk === 'pc' || dk === 'mac' ? '<span class="hint" style="margin:0">Didn’t open? <a id="mlQuoteGmail" href="' + esc(mlGmail(T.to, T.subject, T.body)) + '" target="_blank" rel="noopener">Write it in Gmail</a></span>' : '') + '</div>' +
    (!T.to && listOf(mv.contacts).length ? '<div class="btnRow">' + mlContactsHTML(mv) + '</div>' : '') +
    '<div class="subH">The email</div><div class="mlqSubj"><span>Subject</span><b id="mlQuoteSubj">' + esc(T.subject) + '</b></div><div class="copyBox" id="mlQuoteTxt">' + esc(T.body) + '</div>' +
    '<div class="btnRow"><button class="btn btn-ghost" data-act="mlQuoteCopy">' + ic('copy', 15) + 'Copy the email</button></div>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeModal">Close</button></div>', { cls: 'wide', noFocus: true });
}
/* a new quantity: the email (and its links) say it at once */
INP.mlQuoteQty = t => {
  const Q = S.ui.quote, l = Q && Q.lines[Number(t.dataset.i)]; if (!l) return;
  l.qty = t.value;
  const T = mlQuoteText(Q), a = $('#mlQuoteMail'), g = $('#mlQuoteGmail'), x = $('#mlQuoteTxt');
  if (a) a.href = mlMailto(T.to, T.subject, T.body);
  if (g) g.href = mlGmail(T.to, T.subject, T.body);
  if (x) x.textContent = T.body;
};
ACT.mlQuoteCopy = () => { const Q = S.ui.quote; if (Q) copyText(mlQuoteText(Q).body); };

/* ---------- Settings → Mari's List (Dr. A): the new rules, loading a set ---------- */
function mlRulesStepsHTML() {
  return '<p class="small">The office database needs its updated rules before it keeps the Mari’s List prices (they keep everything else as it is):</p>' +
    '<ol class="steps small"><li>Press <b>Copy the new rules</b>.</li><li>Open the <b>Firebase console</b> → <b>Firestore Database</b> (left menu) → <b>Rules</b> tab.</li><li>Select everything there (Ctrl+A), paste over it, and press <b>Publish</b>.</li><li>Come back and press <b>Check again</b>.</li></ol>' +
    '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="copyRules">' + ic('copy', 15) + 'Copy the new rules</button><a class="btn btn-sec btn-sm" href="https://console.firebase.google.com/project/nlo-cases/firestore/rules" target="_blank" rel="noopener noreferrer">Open the Firebase console</a><button class="btn btn-ghost" data-act="mlCheck">' + ic('refresh', 15) + 'Check again</button></div>';
}
function mlRulesCardHTML() { return '<div class="card"><div class="cardHd"><h3>Mari’s List needs the new rules</h3></div><div class="cardBd">' + mlRulesStepsHTML() + '</div></div>'; }
ACT.mlCheck = () => { if (B.watchMl) { S.ml.off = false; B.watchMl(); setTimeout(() => renderView(true), 900); } };
function mlLoadBtnHTML() {
  return '<label class="btn btn-pri btn-sm mlFileBtn">' + ic('upload', 15) + 'Load a Mari’s List file<input type="file" accept=".json,application/json" data-chg="mlFile" class="hidden" id="mlFile"></label>';
}
function mlSettingsCardHTML(owner) {
  if (!owner) return '';
  const info = S.ml.info;
  let h = '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Mari’s List</h3><span class="sub">member prices, deals and codes</span></div><div class="cardBd">';
  if (S.ml.off) return h + '<div class="kvRow"><span>Kept in the office database</span><b><span class="stat wait">Needs the new rules</span></b></div>' + mlRulesStepsHTML() + '</div></div>';
  if (info) {
    const vs = mlVendors(), linked = Object.keys(S.ml.match || {}).filter(id => itemById(id) && mlLinks(id).length).length;
    h += '<div class="kvRow"><span>Prices from the portal</span><b>' + esc(fmtDate(info.at) || '—') + '</b></div>' +
      '<div class="kvRow"><span>Vendors · prices</span><b>' + vs.length + ' · ' + Number(info.rows || 0).toLocaleString('en-US') + '</b></div>' +
      '<div class="kvRow"><span>Your supplies linked to a price</span><b>' + linked + '</b></div>' +
      (info.loadedAt ? '<div class="kvRow"><span>Loaded</span><b>' + esc(fmtWhen(info.loadedAt)) + (info.loadedBy ? ' · ' + esc(info.loadedBy) : '') + '</b></div>' : '');
  } else h += '<div class="kvRow"><span>Loaded</span><b><span class="stat off">Not yet</span></b></div>';
  h += '<div class="btnRow">' + mlLoadBtnHTML() + (info ? '<button class="btn btn-ghost btn-sm" data-act="nav" data-v="ml">' + ic('tag', 14) + 'Open Mari’s List</button>' : '') + '</div>' +
    '<div class="hint">Claude makes the file from the Mari’s List member portal (ask for a new one when the price lists change). It’s kept in the office database: everyone signed in to Inventory sees the prices, only you load them or link them to supplies. Mari’s List asks that member prices stay in the office.</div>';
  return h + '</div></div>';
}
/* a Mari's List file → what's saved: the vendors, the price rows in parts, the links to supplies */
function mlClean(s, max) { return String(s == null ? '' : s).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max); }
function mlParse(text) {
  let d; try { d = JSON.parse(text); } catch (e) { throw errCode('bad-file', 'That isn’t a Mari’s List file.'); }
  if (!d || d.kind !== 'nlo-marislist' || !Array.isArray(d.vendors) || !Array.isArray(d.rows)) throw errCode('bad-file', 'That isn’t a Mari’s List file.');
  const ids = new Set(), vendors = [];
  d.vendors.forEach(v => {
    if (!v || !/^[a-z0-9]{1,24}$/.test(v.id || '') || ids.has(v.id) || !v.name) return; ids.add(v.id);
    const o = { id: v.id, name: mlClean(v.name, 80), cat: ML_CAT_LABEL[v.cat] ? v.cat : 'supplies', deal: mlClean(v.deal, 600), how: mlClean(v.how, 400), n: 0 };
    if (v.code) o.code = mlClean(v.code, 40);
    if (v.say) o.say = true;
    if (v.uses) o.uses = true;
    if (webUrl(v.web)) o.web = webUrl(v.web);
    if (v.note) o.note = mlClean(v.note, 400);
    const aka = listOf(v.aka).map(a => mlClean(a, 60)).filter(Boolean).slice(0, 8); if (aka.length) o.aka = aka;
    const cs = listOf(v.contacts).filter(c => c && ['phone', 'text', 'email', 'web'].includes(c.k) && c.v).map(c => Object.assign({ k: c.k, v: mlClean(c.v, 120) }, c.who ? { who: mlClean(c.who, 60) } : {}))
      .filter(c => c.k === 'web' ? !!webUrl(c.v) : c.k === 'email' ? ML_EMAIL.test(c.v) : /\d{3}/.test(c.v)).slice(0, 6);
    if (cs.length) o.contacts = cs;
    const fs = listOf(v.files).filter(f => f && webUrl(f.u)).map(f => ({ t: mlClean(f.t, 120), u: webUrl(f.u), d: mlClean(f.d, 20) })).slice(0, 12);
    if (fs.length) o.files = fs;
    vendors.push(o);
  });
  if (!vendors.length) throw errCode('bad-file', 'That file has no vendors.');
  const vIdx = new Map(vendors.map(v => [v.id, v])), rows = [], keep = []; let dropped = 0;
  d.rows.forEach((a, i) => {
    const v = Array.isArray(a) && vIdx.get(a[0]), desc = Array.isArray(a) ? mlClean(a[2], 240) : '';
    const p = Array.isArray(a) && typeof a[4] === 'number' && isFinite(a[4]) && a[4] >= 0 && a[4] < 1e6 ? Math.round(a[4] * 100) / 100 : null;
    const r = Array.isArray(a) && typeof a[5] === 'number' && isFinite(a[5]) && a[5] > 0 && a[5] < 1e6 ? Math.round(a[5] * 100) / 100 : null;
    if (!v || !desc || (p == null && !a[7])) { dropped++; keep.push(-1); return; }
    keep.push(rows.length); v.n++;
    rows.push([v.id, mlClean(a[1], 40), desc, mlClean(a[3], 60), p, r, mlClean(a[6], 80), mlClean(a[7], 160), Number.isInteger(a[8]) && a[8] >= 0 && a[8] < 12 ? a[8] : -1]);
  });
  const keys = mlKeys(rows), match = {}; let unmatched = 0;
  Object.keys(d.match && typeof d.match === 'object' ? d.match : {}).forEach(id => {
    if (!/^[A-Za-z0-9_.\-]{1,80}$/.test(id)) return;
    const list = listOf(d.match[id]).map(m => { const j = m && Number.isInteger(m.i) ? keep[m.i] : -1; if (j == null || j < 0) { unmatched++; return null; } const a = rows[j]; return { k: keys[j], x: Number(m.x) > 0 ? Math.round(Number(m.x) * 1000) / 1000 : 1, s: m.s === 'same' ? 'same' : 'similar', v: a[0], n: a[1], d: a[2], u: a[3], p: a[4], r: a[5], by: 'Mari’s List file' }; }).filter(Boolean);
    if (list.length) match[id] = list;
  });
  return { at: mlClean(d.at, 20), src: mlClean(d.src, 200), vendors, rows, keys, match, dropped, unmatched };
}
/* the parts: each under ML_PART bytes */
function mlParts(rows) {
  const enc = new TextEncoder(), parts = []; let cur = [], size = 2;
  rows.forEach(r => { const s = JSON.stringify(r), n = enc.encode(s).length + 1; if (cur.length && size + n > ML_PART) { parts.push('[' + cur.join(',') + ']'); cur = []; size = 2; } cur.push(s); size += n; });
  if (cur.length) parts.push('[' + cur.join(',') + ']');
  return parts;
}
CHG.mlFile = async t => {
  const f = t.files && t.files[0]; t.value = ''; if (!f) return;
  if (!isOwnerAccount()) return toast('Only Dr. A can load Mari’s List prices.', { bad: true });
  if (f.size > 40 * 1024 * 1024) return toast('That file is too big to be a Mari’s List file.', { bad: true });
  let P; try { P = mlParse(await f.text()); } catch (e) { return toast(errText(e), { bad: true }); }
  /* links made here before stay when their price is still in the new set (with its new price) */
  const kept = {}; let lost = 0, carried = 0; const keyAt = new Map(P.keys.map((k, j) => [k, j]));
  Object.keys(S.ml.match || {}).forEach(id => mlLinks(id).forEach(m => {
    if (m.by === 'Mari’s List file' || (P.match[id] || []).some(x => x.k === m.k)) return;
    const j = keyAt.get(m.k); if (j == null) { lost++; return; }
    const a = P.rows[j]; (kept[id] = kept[id] || []).push(Object.assign({}, m, { v: a[0], n: a[1], d: a[2], u: a[3], p: a[4], r: a[5] })); carried++;
  }));
  Object.keys(kept).forEach(id => { P.match[id] = (P.match[id] || []).concat(kept[id]); });
  S.ui.mlLoad = P;
  const nItems = Object.keys(P.match).filter(id => itemById(id)).length, withPrices = P.vendors.filter(v => v.n).length;
  openModal('<h3>Load these Mari’s List prices?</h3><div class="lsub">' + esc(f.name) + (P.at ? ' · from the portal ' + esc(fmtDate(P.at)) : '') + '</div>' +
    '<div class="kvRow"><span>Vendors</span><b>' + P.vendors.length + ' (' + withPrices + ' with price lists)</b></div>' +
    '<div class="kvRow"><span>Member prices</span><b>' + P.rows.length.toLocaleString('en-US') + '</b></div>' +
    '<div class="kvRow"><span>Your supplies linked to one</span><b>' + nItems + '</b></div>' +
    (P.dropped ? '<div class="hint">' + plural(P.dropped, 'line') + ' without a vendor, description or price left out.</div>' : '') +
    (carried ? '<div class="hint">' + plural(carried, 'link') + ' you made stay, with the new prices.</div>' : '') +
    (lost ? '<div class="notice">' + plural(lost, 'link') + ' you made point at prices that aren’t in this set any more; they come off.</div>' : '') +
    (S.ml.info ? '<div class="hint">It replaces the set loaded ' + esc(fmtWhen(S.ml.info.loadedAt) || 'before') + '.</div>' : '') +
    '<div class="hint">Everyone signed in to Inventory will see these prices. They stay in the office database.</div>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeModal">Cancel</button><button class="btn btn-pri" data-act="mlLoadGo">' + ic('upload', 15) + 'Load them</button></div>', { cls: 'mid', noFocus: true });
};
ACT.mlLoadGo = t => withAdmin(async () => {
  const P = S.ui.mlLoad; if (!P) return closeModal(true);
  const s = stamp(), parts = mlParts(P.rows), ver = (Date.now().toString(36) + hexId(2)).slice(0, 16);
  const info = { ver, at: P.at, src: P.src, vendors: P.vendors, parts: parts.length, rows: P.rows.length, loadedAt: s.at, loadedBy: s.by };
  busyBtn(t, true, 'Saving…'); S.busy = true;
  try {
    await B.mlSave({ info, parts, match: P.match }, (i, n) => { t.textContent = 'Saving part ' + i + ' of ' + n + '…'; });
    S.ui.mlLoad = null; closeModal(true); toast('Mari’s List prices loaded: ' + P.rows.length.toLocaleString('en-US') + ' prices from ' + P.vendors.length + ' vendors.', { action: 'Open', onAction: () => go('ml') });
  } catch (e) { console.error(e); busyBtn(t, false); toast(errText(e), { bad: true }); }
  S.busy = false;
}, '', 'load Mari’s List prices');
