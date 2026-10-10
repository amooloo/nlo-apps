/* ================= NLO Botox: app ================= */
var LS_KEY = 'nloBotox.v1';
var FRAMED = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();
var CAN_PRINT = !FRAMED && typeof window.print === 'function';

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function isoOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function todayISO() { return isoOf(new Date()); }
function parseISO(iso) { var p = String(iso || '').split('-').map(Number); return p.length === 3 && p[0] ? new Date(p[0], p[1] - 1, p[2]) : null; }
function fmtDate(iso) { var d = parseISO(iso); return d ? pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + '/' + d.getFullYear() : ''; }
function addDays(iso, n) { var d = parseISO(iso) || new Date(); d.setDate(d.getDate() + n); return isoOf(d); }
function weekdayOf(iso) { var d = parseISO(iso); return d ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] : ''; }
function fmtTime(h, m) { var ap = h >= 12 ? 'PM' : 'AM', hh = h % 12 || 12; return hh + ':' + pad2(m) + ' ' + ap; }
function fmtDateTime(v) {
  if (!v) return '';
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return v;
  return m[2] + '/' + m[3] + '/' + m[1] + ' ' + fmtTime(+m[4], +m[5]);
}
function fmtU(n) { return String(+(+n).toFixed(2)); }
function fmtMl(n) { return n >= 0.1 ? n.toFixed(2) : String(+n.toFixed(4)); }
function fmtMarks(n) { return String(+n.toFixed(2)); }
function roundTo(v, step) { return +(Math.round(v / step) * step).toFixed(2); }

/* ---------- state ---------- */
var S = {
  view: 'map', mapInd: 'glabella',
  show: { muscles: true, caution: true, marks: true },
  product: 'xeomin', vial: 100, diluent: 2.5, diluentType: 'bact',
  lot: '', exp: '', recon: '',
  patient: { name: '', dob: '', chart: '' }, date: todayISO(), injector: 'Dr. Akhavan', assistant: '',
  items: [],
  checks: { screen: false, consent: false, photos: false, tolerated: false, aftercare: false },
  wasted: '', notes: '', followWeeks: 2,
  doc: 'record', lang: 'en', conv: null, noteGen: null,
  myDefaults: {}
};

function savePrefs() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      view: S.view, mapInd: S.mapInd, show: S.show, product: S.product, vial: S.vial, diluent: S.diluent,
      diluentType: S.diluentType, injector: S.injector, lang: S.lang, doc: S.doc, myDefaults: S.myDefaults
    }));
  } catch (e) { /* storage unavailable: preferences just won't persist */ }
}
function loadPrefs() {
  var p = null;
  try { p = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { p = null; }
  if (!p || typeof p !== 'object') return;
  if (VIEWS[p.view]) S.view = p.view;
  if (IND[p.mapInd]) S.mapInd = p.mapInd;
  if (p.show && typeof p.show === 'object') ['muscles', 'caution', 'marks'].forEach(function (k) { if (typeof p.show[k] === 'boolean') S.show[k] = p.show[k]; });
  if (PRODUCTS[p.product]) {
    S.product = p.product;
    var pr = PRODUCTS[p.product];
    S.vial = pr.vials.indexOf(+p.vial) >= 0 ? +p.vial : (pr.vials.indexOf(100) >= 0 ? 100 : pr.vials[0]);
    var dl = parseFloat(p.diluent);
    S.diluent = dl > 0 && dl <= 20 ? dl : pr.label[S.vial];
  }
  if (p.diluentType === 'pf' || p.diluentType === 'bact') S.diluentType = p.diluentType;
  if (typeof p.injector === 'string') S.injector = p.injector.slice(0, 80);
  if (p.lang === 'en' || p.lang === 'es') S.lang = p.lang;
  if (DOCS[p.doc]) S.doc = p.doc;
  if (p.myDefaults && typeof p.myDefaults === 'object') {
    Object.keys(p.myDefaults).forEach(function (id) {
      if (!IND[id] || typeof p.myDefaults[id] !== 'object') return;
      var clean = {};
      Object.keys(p.myDefaults[id]).forEach(function (k) { var v = +p.myDefaults[id][k]; if (isFinite(v) && v >= 0 && v <= 100) clean[k] = v; });
      S.myDefaults[id] = clean;
    });
  }
}

/* ---------- product + dose helpers ---------- */
function prod() { return PRODUCTS[S.product]; }
function ratio() { return prod().ratio; }
function stepOf(ind) { return ratio() === 1 ? ind.step : 1; }
function rangeOf(p) { var r = ratio(); return { min: +(p.min * r).toFixed(2), max: +(p.max * r).toFixed(2) }; }
function conc() { return S.vial / S.diluent; }               /* units per mL */
function per01() { return conc() / 10; }                       /* units per 0.1 mL */
function perMark() { return conc() / 100; }                    /* units per 0.01 mL syringe mark */
function unitWord() { return ratio() === 1 ? 'U' : prod().name + ' U'; }
function diluentName() { return S.diluentType === 'bact' ? 'bacteriostatic 0.9% NaCl' : 'preservative-free 0.9% NaCl'; }
/* Use-by: the label allows 24 hours after mixing. With bacteriostatic saline the AAFE course (and a 2015
   consensus statement) allow up to 4 weeks refrigerated, which is off-label. */
var AAFE_DAYS = 28;
function useByHrs() { return S.diluentType === 'bact' ? AAFE_DAYS * 24 : prod().useHrs; }
function useByTxt() { return S.recon ? fmtDateTime(addHours(S.recon, useByHrs())) : ''; }
function useByRule() { return S.diluentType === 'bact' ? '4 weeks, AAFE; label ' + prod().useHrs + ' h' : prod().useHrs + ' h, label'; }
/* A site is right (R), left (L) or, for midline sites such as the procerus, a single M. */
function sidesOf(p) { return p.mid ? ['M'] : ['R', 'L']; }
function publishedDose(p, side) {
  if (side === 'M') return p.dose;
  return side === 'R' ? (p.doseR != null ? p.doseR : p.dose) : (p.doseL != null ? p.doseL : p.dose);
}
function baseDose(id, p, side) {
  var md = S.myDefaults[id] || {}, k = p.id + '|' + side;
  if (md[k] != null) return md[k];
  return publishedDose(p, side);
}
function defaultsFor(id, published) {
  var ind = IND[id], r = ratio(), st = stepOf(ind), d = {};
  ind.points.forEach(function (p) {
    sidesOf(p).forEach(function (sd) {
      var b = published ? publishedDose(p, sd) : baseDose(id, p, sd);
      d[p.id + '|' + sd] = roundTo(b * r, st);
    });
  });
  return d;
}
function hasMyDefaults(id) { return !!(S.myDefaults[id] && Object.keys(S.myDefaults[id]).length); }
function siteLabel(ind, p) { return ind.group === 'gs' ? ind.chip + ': ' + p.name : p.name; }
function sortItems() { S.items.sort(function (a, b) { return IND_ORDER.indexOf(a.id) - IND_ORDER.indexOf(b.id); }); }
function findItem(id) { for (var i = 0; i < S.items.length; i++) if (S.items[i].id === id) return S.items[i]; return null; }
function addItem(id) {
  if (!IND[id] || findItem(id)) return;
  S.items.push({ id: id, d: defaultsFor(id) });
  sortItems();
}
function pointRows() {
  var rows = [];
  S.items.forEach(function (it) {
    var ind = IND[it.id];
    ind.points.forEach(function (p) {
      rows.push({ it: it, ind: ind, p: p, mid: !!p.mid, R: it.d[p.id + '|R'] || 0, L: it.d[p.id + '|L'] || 0, M: it.d[p.id + '|M'] || 0, key: it.id + '.' + p.id });
    });
  });
  return rows;
}
function itemSides(it) {
  var R = 0, L = 0, M = 0;
  IND[it.id].points.forEach(function (p) { R += it.d[p.id + '|R'] || 0; L += it.d[p.id + '|L'] || 0; M += it.d[p.id + '|M'] || 0; });
  return { R: R, L: L, M: M, T: R + L + M };
}
function totals() {
  var R = 0, L = 0, M = 0, sites = 0;
  pointRows().forEach(function (r) { R += r.R; L += r.L; M += r.M; sites += (r.R > 0) + (r.L > 0) + (r.M > 0); });
  var T = R + L + M;
  return { R: R, L: L, M: M, T: T, sites: sites, ml: T / conc(), vials: T > 0 ? Math.ceil(T / S.vial - 1e-9) : 0 };
}
function sideTxt(R, L, M) { return 'R ' + fmtU(R) + ', L ' + fmtU(L) + (M ? ', midline ' + fmtU(M) : ''); }

/* ---------- diagram points ---------- */
function indPts(id, view, doses) {
  var ind = IND[id], pts = [];
  ind.points.forEach(function (p) {
    sidesOf(p).forEach(function (sd) {
      if (view === 'latR' && sd !== 'R') return;
      if (view === 'latL' && sd !== 'L') return;
      var u = doses[p.id + '|' + sd] || 0, rg = rangeOf(p);
      var x = sd === 'M' ? 200 : view === 'front' ? (sd === 'R' ? p.x : 400 - p.x) : (view === 'latL' ? 400 - p.x : p.x);
      pts.push({ x: x, y: p.y, text: fmtU(u) + ' U', pref: p.pref, mirror: view === 'front' && sd === 'L', key: id + '.' + p.id + '|' + sd, warn: u > rg.max, zero: u === 0 });
    });
  });
  return pts;
}
/* Figures are drawn after they are in the page, so text can be sized to the drawn width. */
var FIGQ = {}, figSeq = 0;
function figSlot(view, opt, cls) {
  var id = 'fig' + (++figSeq);
  FIGQ[id] = { view: view, opt: opt };
  return '<figure class="' + (cls || '') + '" data-fig="' + id + '"></figure>';
}
function drawFigs(root) {
  $$('figure[data-fig]', root || document).forEach(function (f) {
    var q = FIGQ[f.getAttribute('data-fig')];
    if (!q) return;
    var px = Math.min(f.clientWidth || 420, 560);
    f.innerHTML = faceSVG(q.view, Object.assign({}, q.opt, { px: px }));
  });
  Object.keys(FIGQ).forEach(function (id) { if (!document.querySelector('figure[data-fig="' + id + '"]')) delete FIGQ[id]; });
}

function planViews() {
  var front = false, lat = false;
  S.items.forEach(function (it) { if (IND[it.id].view === 'lat') lat = true; else front = true; });
  return { front: front, lat: lat };
}
function planFigOpts(view, o) {
  o = o || {};
  var pts = [], hi = [], caution = [], marks = [], ids = [];
  S.items.forEach(function (it) {
    var ind = IND[it.id];
    if ((view === 'front') !== (ind.view === 'front')) return;
    ids.push(it.id);
    pts = pts.concat(indPts(it.id, view, it.d));
    ind.hi.forEach(function (m) { if (hi.indexOf(m) < 0) hi.push(m); });
    ind.caution.forEach(function (m) { if (caution.indexOf(m) < 0) caution.push(m); });
    ind.marks.forEach(function (m) { if (marks.indexOf(m) < 0) marks.push(m); });
  });
  if (o.print) {
    /* the printed record shows only what was injected */
    pts = pts.filter(function (p) { return !p.zero; });
    caution = [];
    marks = marks.filter(function (m) { return m === 'safe' || m === 'thumb'; });
  }
  return {
    pts: pts, hi: hi, muscles: o.print ? true : S.show.muscles,
    caution: o.print || S.show.caution ? caution : [], marks: o.print || S.show.marks ? marks : [],
    vb: zoomFor(view, ids), print: !!o.print, inch: o.inch, idp: (o.idp || 'pl') + view
  };
}
function planFigure(view, o) { return faceSVG(view, planFigOpts(view, o)); }

/* ---------- views ---------- */
var VIEWS = {
  map: { title: 'Injection map', sub: 'Sites, doses and landmarks for each treatment area' },
  plan: { title: 'Treatment plan', sub: 'Doses per site, totals and the chart note for this visit' },
  dilution: { title: 'Dilution & syringe', sub: 'Concentration, volume per dose and insulin-syringe marks' },
  print: { title: 'Forms & handouts', sub: 'Treatment record, consent, health screening, aftercare and the chairside card' },
  safety: { title: 'Safety & complications', sub: 'Who not to treat, how to avoid problems, and what to do when they happen' },
  sources: { title: 'Products & sources', sub: 'Units and storage by product, and the literature behind every dose' }
};

function setView(v) {
  if (!VIEWS[v]) return;
  S.view = v;
  savePrefs();
  render();
  var main = $('#main');
  if (main) window.scrollTo(0, 0);
}

function renderShell() {
  $$('.sb-item').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === S.view); b.setAttribute('aria-current', b.getAttribute('data-view') === S.view ? 'page' : 'false'); });
  var n = S.items.length, c = $('#sbCount');
  if (c) { c.textContent = n ? String(n) : ''; c.hidden = !n; }
  $('#pageTitle').textContent = VIEWS[S.view].title;
  $('#pageSub').textContent = VIEWS[S.view].sub;
  $('#prodChipTxt').textContent = prod().name + ' ' + S.vial + ' U · ' + fmtU(S.diluent) + ' mL · ' + fmtU(per01()) + ' U/0.1 mL';
  $$('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'panel-' + S.view); });
}

function render() {
  renderShell();
  if (S.view === 'map') renderMap();
  else if (S.view === 'plan') renderPlan();
  else if (S.view === 'dilution') renderDilution();
  else if (S.view === 'print') renderPrint();
  else if (S.view === 'safety') renderSafety();
  else if (S.view === 'sources') renderSources();
}

/* keep keyboard focus across re-renders */
function withFocus(fn) {
  var a = document.activeElement, sig = null;
  if (a && a.getAttribute) sig = { act: a.getAttribute('data-act'), k: a.getAttribute('data-k'), id: a.id };
  fn();
  if (!sig) return;
  var el = null;
  if (sig.id) el = document.getElementById(sig.id);
  if (!el && sig.act) el = $('[data-act="' + sig.act + '"]' + (sig.k ? '[data-k="' + CSS.escape(sig.k) + '"]' : ''));
  if (el && el.focus) el.focus();
}

/* ---------- shared fragments ---------- */
function toggleChips() {
  var t = [['muscles', 'Muscles'], ['caution', 'Caution zones'], ['marks', 'Landmarks']];
  return '<div class="chips" role="group" aria-label="Diagram layers">' + t.map(function (x) {
    return '<button class="chip" data-act="layer" data-k="' + x[0] + '" aria-pressed="' + (S.show[x[0]] ? 'true' : 'false') + '">' + x[1] + '</button>';
  }).join('') + '</div>';
}
function legendHTML(views, hasOpt) {
  var lat = views.lat;
  var out = ['<span><i class="lg lg-site"></i>Injection site (dose per site)</span>'];
  if (hasOpt) out.push('<span><i class="lg lg-opt"></i>Optional site (0 U now)</span>');
  if (S.show.muscles) out.push('<span><i class="lg lg-mus"></i>Target muscle</span>');
  if (S.show.caution) out.push('<span><i class="lg lg-caution"></i>Caution zone</span>');
  if (S.show.caution && lat) out.push('<span><i class="lg lg-vessel"></i>Artery</span><span><i class="lg lg-nerve"></i>Nerve</span>');
  if (S.show.marks) out.push('<span><i class="lg lg-mark"></i>Landmark</span>');
  if (S.show.marks && lat) out.push('<span><i class="lg lg-safe"></i>Masseter safe zone</span>');
  return '<div class="legend">' + out.join('') + '</div>';
}
var MUSCLE_TXT = {
  oo: 'orbicularis oris', oculi: 'orbicularis oculi (lateral)', procerus: 'procerus', corrugator: 'corrugators', frontalis: 'frontalis',
  llsan: 'LLSAN', lls: 'LLS', zmi: 'zygomaticus minor', zmj: 'zygomaticus major', dao: 'DAO', dli: 'DLI', mentalis: 'mentalis',
  masseter: 'masseter', temporalis: 'temporalis', risorius: 'risorius'
};
function optTag(p) { return p.opt ? ' <span class="opt-tag">optional</span>' : ''; }
function muscleNames(ind) {
  return ind.hi.map(function (k) { return MUSCLE_TXT[k] || k; }).join(', ');
}
function refList(keys) {
  return '<ol class="refs">' + keys.map(function (k) {
    var r = REFS[k];
    if (!r) return '';
    return '<li>' + esc(r.t) + (r.u ? ' <a href="' + esc(r.u) + '" target="_blank" rel="noopener">Link</a>' : '') + '</li>';
  }).join('') + '</ol>';
}
function productSelect(id) {
  return '<select id="' + id + '" data-act="product">' + PRODUCT_ORDER.map(function (k) {
    var p = PRODUCTS[k];
    return '<option value="' + k + '"' + (k === S.product ? ' selected' : '') + '>' + esc(p.name) + ' (' + esc(p.generic) + ')</option>';
  }).join('') + '</select>';
}
function vialSelect(id) {
  return '<select id="' + id + '" data-act="vial">' + prod().vials.map(function (v) {
    return '<option value="' + v + '"' + (v === S.vial ? ' selected' : '') + '>' + v + ' U vial</option>';
  }).join('') + '</select>';
}
function diluentSelect(id) {
  return '<select id="' + id + '" data-bind="diluentType"><option value="bact"' + (S.diluentType === 'bact' ? ' selected' : '') + '>Bacteriostatic 0.9% NaCl (AAFE)</option>' +
    '<option value="pf"' + (S.diluentType === 'pf' ? ' selected' : '') + '>Preservative-free 0.9% NaCl (label)</option></select>';
}
/* Dysport: the label puts at most 2.5 mL in the vial, so no larger presets. */
function presetMl() {
  var v = S.vial, p = S.product;
  if (p === 'dysport') return v === 300 ? [1.5, 2.5, 3] : [1, 2, 2.5];
  if (v === 50) return [0.5, 1, 1.25, 2];
  if (v === 200) return [2, 4, 5, 8];
  return [1, 2, 2.5, 4];
}
function convBanner() {
  if (!S.conv) return '';
  return '<div class="alert banner" role="status"><div><b>Doses converted.</b> ' + esc(S.conv) +
    ' Units are not interchangeable between products. Check every dose before injecting.</div>' +
    '<button class="btn-link" data-act="dismiss-conv">Dismiss</button></div>';
}

/* ---------- Injection map ---------- */
function renderMap() {
  var ind = IND[S.mapInd], doses = defaultsFor(S.mapInd), lat = ind.view === 'lat';
  var list = GROUPS.map(function (g) {
    var btns = IND_ORDER.filter(function (id) { return IND[id].group === g.id; }).map(function (id) {
      var x = IND[id];
      return '<button class="ind-btn" data-act="map-ind" data-k="' + id + '" aria-current="' + (id === S.mapInd ? 'true' : 'false') + '">' +
        (findItem(id) ? '<span class="in-plan">In plan</span>' : '') + esc(x.name) + '</button>';
    }).join('');
    return '<div class="ind-group"><h4 class="eyebrow">' + esc(g.name) + '</h4>' + btns + '</div>';
  }).join('');

  var common = { hi: ind.hi, muscles: S.show.muscles, caution: S.show.caution ? ind.caution : [], marks: S.show.marks ? ind.marks : [] };
  var view = lat ? 'latR' : 'front', mapPts = indPts(S.mapInd, view, doses);
  var figs = '<div class="diagram-wrap">' + figSlot(view, Object.assign({
    pts: mapPts, vb: zoomFor(view, [S.mapInd]), idp: 'm' + view,
    caption: ind.name + (lat ? ', right side' : ', front view')
  }, common)) + '</div>';

  var R = 0, L = 0, M = 0, nSites = 0, nOpt = 0;
  ind.points.forEach(function (p) {
    sidesOf(p).forEach(function (sd) { var u = doses[p.id + '|' + sd] || 0; if (u > 0) nSites++; else nOpt++; });
    R += doses[p.id + '|R'] || 0; L += doses[p.id + '|L'] || 0; M += doses[p.id + '|M'] || 0;
  });
  var uw = unitWord();
  var rows = ind.points.map(function (p) {
    var rg = rangeOf(p), dR = doses[p.id + '|R'], dL = doses[p.id + '|L'];
    var dose = p.mid ? fmtU(doses[p.id + '|M']) + ' midline' : dR === dL ? fmtU(dR) : 'R ' + fmtU(dR) + ' / L ' + fmtU(dL);
    return '<tr><td>' + esc(p.name) + optTag(p) + '<span class="sub">' + esc(p.muscle) + '</span></td><td class="r tnum">' + dose + '</td><td class="tnum">' + fmtU(rg.min) + '–' + fmtU(rg.max) + '</td><td>' + esc(p.depth) + '</td></tr>';
  }).join('');
  var group = GROUPS.filter(function (g) { return g.id === ind.group; })[0];
  var inPlan = !!findItem(S.mapInd);

  var detail =
    '<div class="card detail-card"><div class="card-hdr"><h3>Dosing</h3>' +
    '<button class="btn ' + (inPlan ? 'btn-outline' : 'btn-primary') + ' btn-sm" data-act="add-plan" data-k="' + S.mapInd + '">' + (inPlan ? 'Open in plan' : 'Add to plan') + '</button></div>' +
    '<div class="card-body detail">' +
    '<p class="aim">' + esc(ind.aim) + '</p>' +
    '<div class="dose-sum"><div class="tile"><div class="k">Right</div><div class="v">' + fmtU(R) + ' <small>' + uw + '</small></div></div>' +
    '<div class="tile"><div class="k">Left</div><div class="v">' + fmtU(L) + ' <small>' + uw + '</small></div></div>' +
    (M ? '<div class="tile"><div class="k">Midline</div><div class="v">' + fmtU(M) + ' <small>' + uw + '</small></div></div>' : '') +
    '<div class="tile"><div class="k">Total</div><div class="v">' + fmtU(R + L + M) + ' <small>' + uw + '</small></div></div>' +
    '<div class="tile"><div class="k">Sites</div><div class="v">' + nSites + '</div>' + (nOpt ? '<div class="opt-n">+' + nOpt + ' optional</div>' : '') + '</div></div>' +
    (ratio() !== 1 ? '<p class="info" style="margin-bottom:12px">Shown in ' + esc(prod().name) + ' units, converted from the published Botox doses at ' + ratio() + ' : 1. Units are not interchangeable.</p>' : '') +
    (hasMyDefaults(S.mapInd) ? '<p class="note" style="margin-bottom:12px"><b>Your saved doses</b> are shown. <button class="btn-link" data-act="clear-mine" data-k="' + S.mapInd + '">Use published doses</button></p>' : '') +
    '<div class="tbl-wrap"><table class="tbl pts-tbl"><thead><tr><th>Site</th><th class="r">' + uw + '/site</th><th>Range</th><th>Depth</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<h4>Usual dosing</h4><p>' + esc(ind.typical) + '</p>' +
    '<h4>Technique</h4><ol>' + ind.technique.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol>' +
    '<h4>Watch for</h4><ul>' + ind.cautions.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
    '<h4>Onset and duration</h4><p>' + esc(ind.onset) + ' ' + esc(ind.duration) + '</p>' +
    '<h4>Evidence</h4>' + refList(ind.refs) +
    '</div></div>';

  $('#panel-map').innerHTML =
    '<div class="map-grid">' +
    '<nav class="ind-list" aria-label="Treatment areas">' + list + '</nav>' +
    '<div class="card diagram-card"><div class="card-hdr"><h3>' + esc(ind.name) + '</h3>' + toggleChips() + '</div>' +
    '<div class="card-body">' + (group && group.note ? '<p class="info" style="margin:4px 0 10px">' + esc(group.note) + '</p>' : '') +
    figs + legendHTML({ front: !lat, lat: lat }, mapPts.some(function (p) { return p.zero; })) +
    '<p class="small-muted" style="margin:8px 0 0;font-size:12px;color:var(--grey-500)">Target muscles: ' + esc(muscleNames(ind)) + '. ' + (lat ? 'Right side shown; the left side mirrors it. Doses are per site.' : 'Viewed facing the patient: their right is on your left.') + '</p>' +
    '</div></div>' + detail + '</div>';
  drawFigs($('#panel-map'));
}

/* ---------- Treatment plan ---------- */
function stepperHTML(it, p, sd) {
  var ind = IND[it.id], k = it.id + '.' + p.id + '|' + sd, u = it.d[p.id + '|' + sd] || 0, rg = rangeOf(p), st = stepOf(ind);
  var hardMax = rg.max * 2, warn = u > rg.max;
  var label = siteLabel(ind, p) + ', ' + (sd === 'R' ? 'right' : sd === 'L' ? 'left' : 'midline');
  return '<div class="stepper' + (warn ? ' warn' : '') + '">' +
    '<button data-act="dec" data-k="' + k + '" aria-label="Less for ' + esc(label) + '"' + (u <= 0 ? ' disabled' : '') + '>−</button>' +
    '<output aria-live="polite">' + fmtU(u) + ' ' + (ratio() === 1 ? 'U' : 'u') + '</output>' +
    '<button data-act="inc" data-k="' + k + '" aria-label="More for ' + esc(label) + '"' + (u + st > hardMax + 1e-9 ? ' disabled' : '') + '>+</button></div>';
}
function volTxt(u) { if (!u) return '—'; var ml = u / conc(); return fmtMl(ml) + ' mL · ' + fmtMarks(ml * 100) + ' marks'; }

function itemsHTML() {
  if (!S.items.length) {
    return '<div class="empty"><h4>No areas yet</h4><p>Add a treatment area to start the plan. Each one loads its starting doses (AAFE course or published), which you can then adjust site by site. Optional sites start at 0 U.</p>' +
      '<div class="chips">' + IND_ORDER.map(function (id) { return '<button class="chip" data-act="quick-add" data-k="' + id + '">+ ' + esc(IND[id].chip) + '</button>'; }).join('') + '</div></div>';
  }
  return S.items.map(function (it) {
    var ind = IND[it.id], sides = itemSides(it), warns = [];
    var rows = ind.points.map(function (p) {
      var rg = rangeOf(p), uR = it.d[p.id + '|R'] || 0, uL = it.d[p.id + '|L'] || 0, uM = it.d[p.id + '|M'] || 0;
      if (uR > rg.max || uL > rg.max || uM > rg.max) warns.push(p.name + ': above the usual ' + fmtU(rg.min) + '–' + fmtU(rg.max) + ' ' + unitWord() + ' per site');
      var cells = p.mid
        ? '<td colspan="2" data-l="Midline">' + stepperHTML(it, p, 'M') + ' <span class="vol mid-tag">midline</span><div class="vol">' + volTxt(uM) + '</div></td>'
        : '<td data-l="Right">' + stepperHTML(it, p, 'R') + '<div class="vol">' + volTxt(uR) + '</div></td>' +
          '<td data-l="Left">' + stepperHTML(it, p, 'L') + '<div class="vol">' + volTxt(uL) + '</div></td>';
      return '<tr data-flash="' + it.id + '.' + p.id + '"><td class="site">' + esc(p.name) + optTag(p) + '<small>' + esc(p.depth) + '</small></td>' + cells + '</tr>';
    }).join('');
    var pair = it.id === 'forehead' && !findItem('glabella')
      ? '<p class="note" style="margin:8px 0 0">Treat forehead lines together with the glabella to lower the risk of brow drop. <button class="btn-link" data-act="quick-add" data-k="glabella">Add glabella</button></p>' : '';
    return '<div class="item" data-item="' + it.id + '"><div class="item-hdr"><div><h5>' + esc(ind.name) + '</h5>' +
      '<div class="meta tnum">' + sideTxt(sides.R, sides.L, sides.M) + ' \u00B7 ' + fmtU(sides.T) + ' ' + unitWord() + ' total. Usual: ' + esc(ind.typical) + '</div></div>' +
      '<div class="item-tools"><button class="btn-link" data-act="swap" data-k="' + it.id + '">Swap sides</button>' +
      '<button class="btn-link" data-act="reset" data-k="' + it.id + '">Reset</button>' +
      '<button class="btn-link" data-act="save-mine" data-k="' + it.id + '">Save as my default</button>' +
      '<button class="btn-link danger" data-act="remove" data-k="' + it.id + '" aria-label="Remove ' + esc(ind.name) + '">Remove</button></div></div>' +
      '<div class="tbl-wrap"><table class="tbl site-tbl"><thead><tr><th>Site</th><th>Right</th><th>Left</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (warns.length ? '<p class="warn-txt">' + warns.map(esc).join('<br>') + '</p>' : '') + pair +
      '</div>';
  }).join('');
}

function addAreaSelect() {
  return '<select id="addArea" data-act="add-area" aria-label="Add a treatment area"><option value="">Add an area…</option>' +
    GROUPS.map(function (g) {
      return '<optgroup label="' + esc(g.name) + '">' + IND_ORDER.filter(function (id) { return IND[id].group === g.id; }).map(function (id) {
        return '<option value="' + id + '"' + (findItem(id) ? ' disabled' : '') + '>' + esc(IND[id].name) + '</option>';
      }).join('') + '</optgroup>';
    }).join('') + '</select>';
}

function renderPlan() {
  var checks = [['screen', 'Health screening reviewed, no contraindications'], ['consent', 'Consent signed'], ['photos', 'Pre-treatment photos taken'],
    ['tolerated', 'Tolerated well, no immediate complications'], ['aftercare', 'Aftercare given, verbal and written']];
  var html =
    '<div class="plan-grid"><div class="plan-main">' + convBanner() +
    '<div class="card"><div class="card-hdr"><h3>Patient & visit</h3><span class="eyebrow">Not saved</span></div><div class="card-body">' +
    '<div class="grid-3">' +
    fld('pName', 'Patient', '<input id="pName" data-bind="patient.name" autocomplete="off" value="' + esc(S.patient.name) + '">') +
    fld('pDob', 'Date of birth', '<input id="pDob" type="date" data-bind="patient.dob" value="' + esc(S.patient.dob) + '">') +
    fld('pChart', 'Chart #', '<input id="pChart" data-bind="patient.chart" autocomplete="off" value="' + esc(S.patient.chart) + '">') +
    fld('pDate', 'Visit date', '<input id="pDate" type="date" data-bind="date" value="' + esc(S.date) + '">') +
    fld('pInj', 'Injector', '<input id="pInj" data-bind="injector" value="' + esc(S.injector) + '">') +
    fld('pAsst', 'Assistant', '<input id="pAsst" data-bind="assistant" value="' + esc(S.assistant) + '">') +
    '</div><p class="hint" style="margin:10px 0 0;font-size:11.5px;color:var(--grey-500)">Patient details stay on this screen only. Nothing about the patient is stored; closing the page clears it.</p></div></div>' +

    '<div class="card"><div class="card-hdr"><h3>Product & dilution</h3></div><div class="card-body"><div class="grid-3">' +
    fld('plProd', 'Product', productSelect('plProd')) +
    fld('plVial', 'Vial', vialSelect('plVial')) +
    fld('plDil', 'Diluent (mL)', '<input id="plDil" type="number" inputmode="decimal" min="0.1" max="20" step="0.05" data-act="diluent" value="' + S.diluent + '">') +
    fld('plDilType', 'Diluent', diluentSelect('plDilType')) +
    fld('plLot', 'Lot #', '<input id="plLot" data-bind="lot" autocomplete="off" value="' + esc(S.lot) + '">') +
    fld('plExp', 'Expires', '<input id="plExp" data-bind="exp" placeholder="MM/YYYY" autocomplete="off" value="' + esc(S.exp) + '">') +
    fld('plRecon', 'Reconstituted', '<input id="plRecon" type="datetime-local" data-bind="recon" value="' + esc(S.recon) + '">') +
    '<div class="field span-2"><span class="lbl">Concentration</span><div class="conc" id="planConc"></div></div>' +
    '</div></div></div>' +

    '<div class="card"><div class="card-hdr"><h3>Areas & doses</h3>' + (S.items.length ? '<div class="field" style="min-width:220px">' + addAreaSelect() + '</div>' : '') + '</div>' +
    '<div id="planItems">' + itemsHTML() + '</div></div>' +

    '<div class="card"><div class="card-hdr"><h3>Visit checks & notes</h3></div><div class="card-body">' +
    '<div class="checks">' + checks.map(function (c) {
      return '<label class="check"><input type="checkbox" id="chk-' + c[0] + '" data-bind="checks.' + c[0] + '"' + (S.checks[c[0]] ? ' checked' : '') + '>' + esc(c[1]) + '</label>';
    }).join('') + '</div>' +
    '<div class="grid-3" style="margin-top:14px">' +
    fld('plWaste', 'Wasted units', '<input id="plWaste" type="number" min="0" step="0.5" inputmode="decimal" data-bind="wasted" value="' + esc(S.wasted) + '">') +
    fld('plFollow', 'Follow-up', '<select id="plFollow" data-bind="followWeeks">' + [1, 2, 3, 4].map(function (w) { return '<option value="' + w + '"' + (+S.followWeeks === w ? ' selected' : '') + '>' + w + ' week' + (w > 1 ? 's' : '') + '</option>'; }).join('') + '</select>') +
    '<div class="field"><span class="lbl">Follow-up date</span><div class="conc" id="planFollowDate" style="background:var(--page)"></div></div>' +
    '<div class="field span-all"><label for="plNotes">Complications or other notes</label><textarea id="plNotes" data-bind="notes" rows="2">' + esc(S.notes) + '</textarea></div>' +
    '</div></div></div>' +
    '</div>' +

    '<aside class="plan-side" aria-label="Plan summary">' +
    '<div class="card"><div class="card-hdr"><h3>Injection map</h3>' + toggleChips() + '</div><div class="card-body" id="planFigs"></div></div>' +
    '<div class="card"><div class="card-hdr"><h3>Totals</h3></div><div class="card-body"><div class="dose-sum" id="planTotals" style="margin:0"></div><p id="planVials" style="margin:10px 0 0;font-size:12.5px;color:var(--grey-600)"></p></div></div>' +
    '<div class="card note-box"><div class="card-hdr"><h3>Chart note</h3><div class="btn-row"><span class="copy-ok" id="copyOk" aria-live="polite"></span><button class="btn btn-primary btn-sm" data-act="copy-note">Copy</button></div></div>' +
    '<div class="card-body"><textarea id="noteTxt" aria-label="Chart note" spellcheck="false"></textarea>' +
    '<p style="margin:8px 0 0;font-size:11.5px;color:var(--grey-500)">Edit before copying if you like. Changing the plan rewrites the note.</p></div></div>' +
    '<div class="card"><div class="card-hdr"><h3>Print for this visit</h3></div><div class="card-body">' + printButtons(['record', 'consent', 'screening', 'aftercare']) + '</div></div>' +
    '</aside></div>';
  withFocus(function () { $('#panel-plan').innerHTML = html; });
  refreshPlanOutputs();
}
function fld(id, label, control) { return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' + control + '</div>'; }
function addHours(dtl, h) {
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(dtl || '');
  if (!m) return '';
  var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  d.setHours(d.getHours() + h);
  return isoOf(d) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function printButtons(ids) {
  if (!CAN_PRINT) {
    return '<p class="info framed-note">Printing works from the NLO Apps copy of this page (this preview window can’t open the print dialog). Every form can be reviewed under Forms & handouts.</p>' +
      '<div class="btn-row" style="margin-top:10px"><button class="btn btn-outline btn-sm" data-act="go-doc" data-k="' + ids[0] + '">Review forms</button></div>';
  }
  return '<div class="btn-row">' + ids.map(function (id, i) {
    return '<button class="btn ' + (i === 0 ? 'btn-primary' : 'btn-outline') + ' btn-sm" data-act="print" data-k="' + id + '">' + esc(DOCS[id].short) + '</button>';
  }).join('') + '</div>';
}

function refreshPlanOutputs() {
  if (S.view !== 'plan') return;
  var t = totals(), uw = unitWord();
  var c = $('#planConc');
  if (c) c.innerHTML = '<b>' + fmtU(per01()) + '</b> ' + uw + ' per 0.1 mL <span style="font-weight:500;color:var(--grey-600)">· ' + fmtU(perMark()) + ' ' + uw + ' per syringe mark' +
    (S.recon ? ' · use by ' + esc(useByTxt()) + ' (' + esc(useByRule()) + ')' : '') + '</span>';
  var fd = $('#planFollowDate');
  if (fd) { var iso = addDays(S.date, S.followWeeks * 7); fd.textContent = weekdayOf(iso) + ' ' + fmtDate(iso); }
  var figs = $('#planFigs');
  if (figs) {
    var v = planViews(), h = '';
    if (!v.front && !v.lat) h = '<p style="margin:6px 0;color:var(--grey-500);font-size:13px">Sites appear here as you add areas.</p>';
    else {
      if (v.front) h += '<div class="diagram-wrap">' + figSlot('front', planFigOpts('front')) + '</div>';
      if (v.lat) h += '<div class="diagram-wrap two">' + figSlot('latR', planFigOpts('latR')) + figSlot('latL', planFigOpts('latL')) + '</div>';
      h += legendHTML(v, pointRows().some(function (r) { return r.mid ? !r.M : (!r.R || !r.L); }));
    }
    figs.innerHTML = h;
    drawFigs(figs);
  }
  var tt = $('#planTotals');
  if (tt) tt.innerHTML =
    '<div class="tile"><div class="k">Total</div><div class="v">' + fmtU(t.T) + ' <small>' + uw + '</small></div></div>' +
    '<div class="tile"><div class="k">' + (t.M ? 'R / L / mid' : 'Right / left') + '</div><div class="v">' + fmtU(t.R) + ' / ' + fmtU(t.L) + (t.M ? ' / ' + fmtU(t.M) : '') + '</div></div>' +
    '<div class="tile"><div class="k">Volume</div><div class="v">' + (t.T ? fmtMl(t.ml) : '0') + ' <small>mL</small></div></div>' +
    '<div class="tile"><div class="k">Sites</div><div class="v">' + t.sites + '</div></div>';
  var vi = $('#planVials');
  if (vi) vi.textContent = t.T ? 'Needs ' + t.vials + ' × ' + S.vial + ' U vial' + (t.vials > 1 ? 's' : '') + '; ' + fmtU(t.vials * S.vial - t.T) + ' ' + uw + ' left over if the vial is used for this patient only.' : '';
  var note = $('#noteTxt');
  if (note) {
    var gen = chartNote();
    if (gen !== S.noteGen) { note.value = gen; S.noteGen = gen; }
  }
  var count = $('#sbCount');
  if (count) { count.textContent = S.items.length ? String(S.items.length) : ''; count.hidden = !S.items.length; }
}

function chartNote() {
  var pr = prod(), t = totals(), L = [];
  L.push('BOTULINUM TOXIN TREATMENT ' + fmtDate(S.date));
  if (!S.items.length) { L.push('No treatment areas in the plan yet.'); return L.join('\n'); }
  L.push('Areas: ' + S.items.map(function (it) { return IND[it.id].name; }).join('; ') + '.');
  var pl = 'Product: ' + pr.name + ' (' + pr.generic + '), ' + S.vial + ' U vial';
  if (S.lot.trim()) pl += ', lot ' + S.lot.trim();
  if (S.exp.trim()) pl += ', exp ' + S.exp.trim();
  L.push(pl + '.');
  var dl = 'Dilution: ' + fmtU(S.diluent) + ' mL ' + diluentName() + ' = ' + fmtU(per01()) + ' U per 0.1 mL';
  if (S.recon) dl += '; reconstituted ' + fmtDateTime(S.recon);
  L.push(dl + '.');
  var pre = [];
  if (S.checks.screen) pre.push('Health screening reviewed; no contraindications.');
  if (S.checks.consent) pre.push('Informed consent signed.');
  if (S.checks.photos) pre.push('Pre-treatment photos taken.');
  if (pre.length) L.push(pre.join(' '));
  L.push('Sites (units):');
  pointRows().forEach(function (r) {
    if (!r.R && !r.L && !r.M) return;
    var parts = [];
    if (r.M) parts.push(fmtU(r.M) + ' (midline)');
    if (r.R) parts.push('R ' + fmtU(r.R));
    if (r.L) parts.push('L ' + fmtU(r.L));
    L.push('  ' + siteLabel(r.ind, r.p) + ': ' + parts.join(', '));
  });
  L.push('Total ' + fmtU(t.T) + ' U (' + sideTxt(t.R, t.L, t.M) + '), ' + fmtMl(t.ml) + ' mL.' + (String(S.wasted).trim() !== '' ? ' Wasted ' + fmtU(+S.wasted || 0) + ' U.' : ''));
  if (S.checks.tolerated) L.push('Tolerated well; no immediate complications.');
  if (S.notes.trim()) L.push(S.notes.trim());
  if (S.checks.aftercare) L.push('Aftercare instructions reviewed verbally and given in writing.');
  L.push('Follow-up in ' + S.followWeeks + ' week' + (S.followWeeks > 1 ? 's' : '') + ' (' + fmtDate(addDays(S.date, S.followWeeks * 7)) + ').');
  L.push('Injector: ' + (S.injector.trim() || '________') + (S.assistant.trim() ? '. Assistant: ' + S.assistant.trim() : '') + '.');
  return L.join('\n');
}

/* ---------- Dilution ---------- */
function renderDilution() {
  var pr = prod(), uw = unitWord();
  var doses = ratio() === 1 ? [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30] : [2.5, 5, 7.5, 10, 12.5, 15, 20, 25, 30, 40, 50, 60, 75];
  var rows = doses.map(function (u) {
    var ml = u / conc();
    return '<tr><td class="tnum"><b>' + fmtU(u) + '</b> ' + uw + '</td><td class="r tnum">' + fmtMl(ml) + '</td><td class="r tnum">' + fmtMarks(ml * 100) + '</td></tr>';
  }).join('');
  var prodRows = PRODUCT_ORDER.map(function (k) {
    var p = PRODUCTS[k];
    return '<tr' + (k === S.product ? ' style="background:var(--mint-100)"' : '') + '><td><b>' + esc(p.name) + '</b><br><span style="font-size:11px;color:var(--grey-500)">' + esc(p.generic) + '</span></td>' +
      '<td class="tnum">' + p.vials.join(', ') + ' U</td><td class="r tnum">' + p.glabellar + ' U</td><td class="r tnum">' + (p.ratio === 1 ? '1 : 1' : p.ratio + ' : 1') + '</td><td class="tnum">' + p.useHrs + ' h</td></tr>';
  }).join('');
  var useBy = useByTxt();
  var storeTxt = S.diluentType === 'bact'
    ? 'With bacteriostatic saline, the AAFE course and a 2015 consensus statement allow up to 4 weeks refrigerated at 2–8 °C (not in the door); that is off-label. The label: preservative-free saline, use within ' + pr.useHrs + ' hours. Do not freeze. Write the mixing date on the vial.'
    : 'Label: preservative-free saline; use within ' + pr.useHrs + ' hours of reconstitution, refrigerated at 2–8 °C (36–46 °F). Do not freeze.';
  $('#panel-dilution').innerHTML = convBanner() +
    '<div class="dil-grid"><div class="card"><div class="card-hdr"><h3>Vial</h3></div><div class="card-body" style="display:grid;gap:12px">' +
    fld('dlProd', 'Product', productSelect('dlProd')) +
    fld('dlVial', 'Vial', vialSelect('dlVial')) +
    '<div class="field"><label for="dlDil">Diluent added (mL)</label><input id="dlDil" type="number" inputmode="decimal" min="0.1" max="20" step="0.05" data-act="diluent" value="' + S.diluent + '">' +
    '<div class="presets">' + presetMl().map(function (m) {
      return '<button class="chip" data-act="preset" data-k="' + m + '" aria-pressed="' + (Math.abs(m - S.diluent) < 1e-9 ? 'true' : 'false') + '">' + fmtU(m) + ' mL' + (pr.label[S.vial] === m && pr.onLabel.indexOf(S.vial) >= 0 ? ' (label)' : '') + '</button>';
    }).join('') + '</div></div>' +
    fld('dlDilType', 'Diluent', diluentSelect('dlDilType')) +
    fld('dlRecon', 'Reconstituted at', '<input id="dlRecon" type="datetime-local" data-bind="recon" value="' + esc(S.recon) + '">') +
    '<p class="note" id="dlUseBy" style="margin:0">' + (useBy ? '<b>Use by ' + esc(useBy) + '</b> (' + esc(useByRule()) + '). ' : '') + esc(storeTxt) + '</p>' +
    '<p style="margin:0;font-size:12px;color:var(--grey-600)">' + esc(pr.note) + '</p>' +
    '</div></div>' +
    '<div style="min-width:0"><div class="big-read">' +
    '<div class="tile"><div class="k">Per 0.1 mL</div><div class="v">' + fmtU(per01()) + ' <small>' + uw + '</small></div></div>' +
    '<div class="tile"><div class="k">Per mL</div><div class="v">' + fmtU(conc()) + ' <small>' + uw + '</small></div></div>' +
    '<div class="tile"><div class="k">Per syringe mark</div><div class="v">' + fmtU(perMark()) + ' <small>' + uw + '</small></div></div></div>' +
    '<p style="font-size:12px;color:var(--grey-500);margin:8px 2px 16px">A syringe mark is one line on a U-100 insulin syringe (0.01 mL). Insulin-syringe markings are not toxin units.</p>' +
    '<div class="card"><div class="card-hdr"><h3>Dose to volume</h3><span class="eyebrow">' + esc(pr.name) + ' ' + S.vial + ' U + ' + fmtU(S.diluent) + ' mL</span></div><div class="card-body"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Dose</th><th class="r">Volume (mL)</th><th class="r">Syringe marks</th></tr></thead><tbody>' + rows + '</tbody></table></div></div></div>' +
    '<div class="card"><div class="card-hdr"><h3>Units between products</h3></div><div class="card-body"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Product</th><th>Vials</th><th class="r">Glabellar label dose</th><th class="r">Units per Botox U</th><th>Use within</th></tr></thead><tbody>' + prodRows + '</tbody></table></div>' +
    '<p style="margin:10px 0 0;font-size:12px;color:var(--grey-600)">Each label says its units are specific to that product and cannot be converted. The ratios come from the labeled glabellar doses and are what this app uses when you switch products in a plan. Confirm every converted dose.</p></div></div>' +
    '</div></div>';
}

/* ---------- Printables ---------- */
var DOCS = {
  record: { name: 'Treatment record', short: 'Treatment record', desc: 'This visit: map with doses, site table, lot, dilution and the 2-week follow-up box.', tag: 'From plan' },
  blank: { name: 'Blank charting sheet', short: 'Blank chart', desc: 'Front and side views to mark by hand, with an empty site table.' },
  consent: { name: 'Informed consent', short: 'Consent', desc: 'Areas, off-label use, risks, alternatives and signatures.', lang: true },
  screening: { name: 'Health screening', short: 'Screening', desc: 'Yes/no questions on pregnancy, nerve-muscle disease, recent toxin, medicines.', lang: true },
  aftercare: { name: 'Before & aftercare', short: 'Aftercare', desc: 'Patient handout: before the visit, the first day, what to expect, when to call.', lang: true },
  card: { name: 'Chairside reference card', short: 'Chairside card', desc: 'One page to laminate: maps, doses for every area, dilution and emergencies.' }
};
var DOC_ORDER = ['record', 'consent', 'screening', 'aftercare', 'blank', 'card'];

function renderPrint() {
  var d = DOCS[S.doc];
  var list = DOC_ORDER.map(function (id) {
    var x = DOCS[id];
    return '<button class="doc-btn" data-act="doc" data-k="' + id + '" aria-current="' + (id === S.doc ? 'true' : 'false') + '">' + (x.tag ? '<span class="tag">' + esc(x.tag) + '</span>' : (x.lang ? '<span class="tag">EN / ES</span>' : '')) + esc(x.name) + '<small>' + esc(x.desc) + '</small></button>';
  }).join('');
  var bar = '<div class="preview-bar"><div class="btn-row">' +
    (d.lang ? '<div class="seg" role="group" aria-label="Language"><button data-act="lang" data-k="en" aria-pressed="' + (S.lang === 'en') + '">English</button><button data-act="lang" data-k="es" aria-pressed="' + (S.lang === 'es') + '">Español</button></div>' : '') +
    '</div>' + (CAN_PRINT ? '<button class="btn btn-primary" data-act="print" data-k="' + S.doc + '">Print ' + esc(d.short.toLowerCase()) + '</button>' : '') + '</div>';
  var notes = '';
  if (S.doc === 'record' && !S.items.length) notes += '<p class="note" style="margin-bottom:12px"><b>The plan is empty.</b> Add areas in the treatment plan to fill this record, or print the blank charting sheet to chart by hand.</p>';
  if (d.lang && S.lang === 'es') notes += '<p class="info" style="margin-bottom:12px">Have a fluent team member read the Spanish version once before you first use it.</p>';
  if (!CAN_PRINT) notes += '<p class="info" style="margin-bottom:12px">This preview window can’t open the print dialog. Print from the NLO Apps copy of this page; everything here prints the same way.</p>';
  $('#panel-print').innerHTML = '<div class="print-grid"><div class="doc-list" role="list">' + list + '</div><div style="min-width:0">' + bar + notes +
    '<div class="paper-wrap" id="paperWrap"><div class="paper" id="paper"><div class="doc">' + buildDoc(S.doc) + '</div></div></div></div></div>';
  fitPaper();
  $$('#paper img').forEach(function (img) { if (!img.complete) img.addEventListener('load', fitPaper); });
}
function fitPaper() {
  var wrap = $('#paperWrap'), paper = $('#paper');
  if (!wrap || !paper) return;
  paper.style.transform = 'none';
  var w = wrap.clientWidth, natural = paper.offsetWidth, z = Math.min(1, w / natural);
  paper.style.transform = 'scale(' + z + ')';
  wrap.style.height = Math.ceil(paper.offsetHeight * z) + 'px';
}

function printDoc(id) {
  if (!CAN_PRINT || !DOCS[id]) return;
  var root = $('#printRoot');
  root.innerHTML = '<div class="doc">' + buildDoc(id) + '</div>';
  var cleanup = function () { root.innerHTML = ''; window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  setTimeout(function () { window.print(); }, 50);
}

/* ---------- document builders ---------- */
var OFFICE_FOOTER = '320 NW 76th Drive, Gainesville, FL 32607 &nbsp;|&nbsp; (352) 332-7466 &nbsp;|&nbsp; nextlevelortho.com';
function letterhead(title, sub, compact) {
  if (compact) {
    return '<div class="pd-header compact"><img class="pd-logo" src="' + NLO_LOGO + '" alt="Next Level Orthodontics"><div><h1>' + esc(title) + '</h1>' + (sub ? '<div class="pd-sub">' + esc(sub) + '</div>' : '') + '</div></div>';
  }
  return '<div class="pd-header"><img class="pd-logo" src="' + NLO_LOGO + '" alt="Next Level Orthodontics"><h1>' + esc(title) + '</h1>' + (sub ? '<div class="pd-sub">' + esc(sub) + '</div>' : '') + '</div>';
}
function pdLine(label, value, cls) { return '<div class="pd-line' + (cls ? ' ' + cls : '') + '"><span class="pd-label">' + esc(label) + ':</span><span class="pd-val">' + esc(value || '') + '</span></div>'; }
function box(on) { return '<span class="box">' + (on ? '✓' : '') + '</span>'; }
function footer() { return '<div class="pd-footer">' + OFFICE_FOOTER + '</div>'; }
function lines(n) { var s = '<div class="lines">'; for (var i = 0; i < n; i++) s += '<div></div>'; return s + '</div>'; }

function buildDoc(id) {
  if (id === 'record') return docRecord();
  if (id === 'blank') return docBlank();
  if (id === 'consent') return docConsent();
  if (id === 'screening') return docScreening();
  if (id === 'aftercare') return docAftercare();
  if (id === 'card') return docCard();
  return '';
}

function docRecord() {
  var pr = prod(), t = totals(), v = planViews(), rows = pointRows().filter(function (r) { return r.R || r.L || r.M; });
  var h = [letterhead('Botulinum Toxin Treatment Record', 'Neuromodulator treatment · ' + pr.name + ' (' + pr.generic + ')', true)];
  h.push('<div class="pd-info">' + pdLine('Patient', S.patient.name) + pdLine('Date of birth', fmtDate(S.patient.dob)) + pdLine('Chart #', S.patient.chart) +
    pdLine('Visit date', fmtDate(S.date)) + pdLine('Injector', S.injector) + pdLine('Assistant', S.assistant) + '</div>');
  h.push('<div class="pd-info">' + pdLine('Vial', S.vial + ' U') + pdLine('Lot #', S.lot) + pdLine('Expires', S.exp) +
    pdLine('Dilution', fmtU(S.diluent) + ' mL ' + diluentName() + ' = ' + fmtU(per01()) + ' U/0.1 mL', 'span2') +
    pdLine('Reconstituted', fmtDateTime(S.recon)) +
    pdLine('Areas', S.items.map(function (it) { return IND[it.id].chip; }).join(', '), 'span2') +
    pdLine('Use by', useByTxt()) + '</div>');
  var tight = rows.length > 8;
  if (v.front || v.lat) {
    var figs = '<div class="figs">';
    var solo = !(v.front && v.lat), wF = solo ? 2.65 : 2.6, wL = solo ? 2.15 : 2.05;
    /* Keep the record on one letter page: shrink the drawings when the site table is long.
       Heights in CSS px at the 7.4 in print width; the fixed parts measure about 436 px. */
    var ids = S.items.map(function (it) { return it.id; });
    var zf = zoomFor('front', ids.filter(function (id) { return IND[id].view === 'front'; }));
    var zl = zoomFor('latR', ids.filter(function (id) { return IND[id].view === 'lat'; }));
    var h0 = Math.max(v.front ? wF * 96 * zf[3] / zf[2] : 0, v.lat ? wL * 96 * zl[3] / zl[2] : 0);
    var areasTxt = S.items.map(function (it) { return IND[it.id].chip; }).join(', ');
    var room = 955 - 436 - (areasTxt.length > 58 ? 18 : 0) - (43 + rows.length * (tight ? 16 : 19.7)) - 15 - 6;
    var sc = Math.max(0.72, Math.min(1, room / h0));
    wF = +(wF * sc).toFixed(2); wL = +(wL * sc).toFixed(2);
    if (v.front) figs += '<figure class="fig-front" style="width:' + wF + 'in">' + planFigure('front', { print: true, inch: wF, idp: 'rec' }) + '<figcaption>Front (patient’s right on the left)</figcaption></figure>';
    if (v.lat) figs += '<figure class="fig-lat" style="width:' + wL + 'in">' + planFigure('latR', { print: true, inch: wL, idp: 'rec' }) + '<figcaption>Right side</figcaption></figure>' +
      '<figure class="fig-lat" style="width:' + wL + 'in">' + planFigure('latL', { print: true, inch: wL, idp: 'rec' }) + '<figcaption>Left side</figcaption></figure>';
    h.push(figs + '</div>');
  }
  var uw = unitWord();
  h.push('<table' + (tight ? ' class="tight"' : '') + '><thead><tr><th>Site</th><th>Depth</th><th class="r">R (' + uw + ')</th><th class="r">L (' + uw + ')</th><th class="r">mL each</th></tr></thead><tbody>' +
    (rows.length ? rows.map(function (r) {
      if (r.mid) return '<tr><td>' + esc(siteLabel(r.ind, r.p)) + '</td><td>' + esc(r.p.depth) + '</td><td colspan="2" style="text-align:center">' + fmtU(r.M) + ' midline</td><td class="r">' + fmtMl(r.M / conc()) + '</td></tr>';
      var mlR = r.R / conc(), mlL = r.L / conc();
      var ml = r.R && r.L && Math.abs(r.R - r.L) < 1e-9 ? fmtMl(mlR) : [r.R ? 'R ' + fmtMl(mlR) : '', r.L ? 'L ' + fmtMl(mlL) : ''].filter(Boolean).join(' · ');
      return '<tr><td>' + esc(siteLabel(r.ind, r.p)) + '</td><td>' + esc(r.p.depth) + '</td><td class="r">' + (r.R ? fmtU(r.R) : '—') + '</td><td class="r">' + (r.L ? fmtU(r.L) : '—') + '</td><td class="r">' + ml + '</td></tr>';
    }).join('') : '<tr><td colspan="5">&nbsp;</td></tr><tr><td colspan="5">&nbsp;</td></tr><tr><td colspan="5">&nbsp;</td></tr>') +
    '</tbody><tfoot><tr><td colspan="2">Total ' + fmtU(t.T) + ' ' + uw + (t.M ? ' (midline ' + fmtU(t.M) + ')' : '') + ' · ' + (t.T ? fmtMl(t.ml) : '0') + ' mL</td><td class="r">' + fmtU(t.R) + '</td><td class="r">' + fmtU(t.L) + '</td><td class="r">Wasted: ' + (String(S.wasted).trim() !== '' ? fmtU(+S.wasted || 0) + ' U' : '______') + '</td></tr></tfoot></table>');
  h.push('<div class="opts three" style="margin-top:7px">' +
    '<div>' + box(S.checks.screen) + 'Screening OK, no contraindications</div>' +
    '<div>' + box(S.checks.consent) + 'Consent signed</div>' +
    '<div>' + box(S.checks.photos) + 'Pre-treatment photos</div>' +
    '<div>' + box(S.checks.tolerated) + 'Tolerated well, no complications</div>' +
    '<div>' + box(S.checks.aftercare) + 'Aftercare given</div>' +
    '<div>Follow-up: <b>' + esc(weekdayOf(addDays(S.date, S.followWeeks * 7)) + ' ' + fmtDate(addDays(S.date, S.followWeeks * 7))) + '</b></div></div>');
  h.push('<div class="pd-info" style="margin-top:6px">' + pdLine('Notes', S.notes.trim(), 'full') + '</div>');
  h.push('<div class="pd-tail"><div class="pd-sig-area"><div class="pd-sig">Injector signature & date</div><div class="pd-sig">Orthodontist (Dr. Akhavan)</div></div>' +
    followUpBox() + footer() + '</div>');
  return h.join('');
}
function followUpBox() {
  return '<div class="followup"><div class="fu-h">2-week follow-up</div>' +
    '<div class="pd-info">' + pdLine('Date', '') + pdLine('Seen by', '') + pdLine('Next treatment due', '') + '</div>' +
    '<div class="opts four"><div>' + box() + 'Result as planned</div><div>' + box() + 'Under-treated</div><div>' + box() + 'Uneven, balance</div><div>' + box() + 'Side effect</div></div>' +
    '<div class="pd-info">' + pdLine('Touch-up site', '') + pdLine('Units', '') + pdLine('Lot #', '') + '</div></div>';
}

function docBlank() {
  var h = [letterhead('Botulinum Toxin Charting Sheet', 'Mark each site and dose by hand', true)];
  h.push('<div class="pd-info">' + pdLine('Patient', '') + pdLine('Date of birth', '') + pdLine('Chart #', '') + pdLine('Visit date', '') + pdLine('Injector', '') + pdLine('Assistant', '') + '</div>');
  h.push('<div class="pd-info">' + pdLine('Product', '') + pdLine('Lot #', '') + pdLine('Expires', '') + pdLine('Vial / diluent', '') + pdLine('Units per 0.1 mL', '') + pdLine('Reconstituted', '') + '</div>');
  h.push('<div class="figs">' +
    '<figure class="fig-front">' + faceSVG('front', { pts: [], hi: [], vb: ZOOM.front, print: true, inch: 2.6, idp: 'blF' }) + '<figcaption>Front (patient’s right on the left)</figcaption></figure>' +
    '<figure class="fig-lat">' + faceSVG('latR', { pts: [], hi: [], marks: ['safe'], vb: ZOOM.lat, print: true, inch: 2.05, idp: 'blR' }) + '<figcaption>Right side (masseter safe zone shaded)</figcaption></figure>' +
    '<figure class="fig-lat">' + faceSVG('latL', { pts: [], hi: [], marks: ['safe'], vb: ZOOM.lat, print: true, inch: 2.05, idp: 'blL' }) + '<figcaption>Left side</figcaption></figure></div>');
  var body = '';
  for (var i = 1; i <= 7; i++) body += '<tr><td class="r" style="width:24px;height:20px">' + i + '</td><td></td><td></td><td></td><td></td><td></td></tr>';
  h.push('<table><thead><tr><th class="r">#</th><th>Site</th><th>Depth</th><th class="r">R (U)</th><th class="r">L (U)</th><th class="r">mL each</th></tr></thead><tbody>' + body +
    '</tbody><tfoot><tr><td colspan="3">Total units: ________ &nbsp; Volume: ________ mL</td><td></td><td></td><td class="r">Wasted: ______</td></tr></tfoot></table>');
  h.push('<div class="opts" style="margin-top:7px"><div>' + box() + 'Screening reviewed, no contraindications</div><div>' + box() + 'Consent signed</div><div>' + box() + 'Pre-treatment photos taken</div><div>' + box() + 'Aftercare given, verbal and written</div></div>');
  h.push('<div class="pd-tail"><div class="pd-sig-area"><div class="pd-sig">Injector signature & date</div><div class="pd-sig">Orthodontist (Dr. Akhavan)</div></div>' +
    followUpBox() + footer() + '</div>');
  return h.join('');
}

/* Patient handouts spell the month out, so 04/12 can't be read as 4 December by a Spanish reader. */
var MONTHS = { en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] };
var WDAYS = { en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], es: ['dom', 'lun', 'mar', 'mi\u00E9', 'jue', 'vie', 's\u00E1b'] };
function fmtDateLong(iso, lang, withDay) {
  var d = parseISO(iso);
  if (!d) return '';
  var m = MONTHS[lang][d.getMonth()], wd = withDay ? WDAYS[lang][d.getDay()] + ', ' : '';
  return lang === 'es' ? wd + d.getDate() + ' ' + m + ' ' + d.getFullYear() : wd + m + ' ' + d.getDate() + ', ' + d.getFullYear();
}
function patientBlock(T) {
  return '<div class="pd-info">' + pdLine(T.common.patient, S.patient.name) + pdLine(T.common.dob, fmtDateLong(S.patient.dob, S.lang)) + pdLine(T.common.date, S.patient.name ? fmtDateLong(S.date, S.lang) : '') + '</div>';
}
function docConsent() {
  var T = PTXT[S.lang], C = T.consent, used = {};
  S.items.forEach(function (it) { used[IND[it.id].consent] = true; });
  var pr = prod(), h = [letterhead(C.title, C.sub.replace('{p}', pr.brand + ' (' + pr.generic + ')')), patientBlock(T)];
  h.push('<div class="pd-h">' + esc(C.areasLabel) + '</div><div class="opts">' + ['glabella', 'forehead', 'crows', 'gs', 'brux', 'contour', 'chin', 'corners', 'lips', 'other'].map(function (k) {
    return '<div>' + box(used[k]) + esc(C.areas[k]) + '</div>';
  }).join('') + '</div>');
  C.sections.forEach(function (s) {
    h.push('<div class="pd-h">' + esc(s.h) + '</div>');
    if (s.p) s.p.forEach(function (p) { h.push('<p>' + esc(p) + '</p>'); });
    if (s.approval) h.push('<p>' + esc(C.approval[S.product] + ' ' + C.offLabel) + '</p><p>' + esc(C.minorsOff) + '</p>');
    if (s.list) h.push('<ul>' + s.list.map(function (li) { return '<li>' + li + '</li>'; }).join('') + '</ul>');
  });
  h.push('<div class="init-row"><span class="init">' + esc(T.common.initials) + '</span><span>' + esc(C.photos) + '</span></div>');
  h.push('<div class="init-row"><span class="init">' + esc(T.common.initials) + '</span><span>' + esc(C.photosEdu) + ' &nbsp; ' + box() + esc(T.common.yes) + ' &nbsp; ' + box() + esc(T.common.no) + '</span></div>');
  h.push('<div class="pd-tail"><p class="pd-ack">' + esc(C.acknowledge) + '</p><p class="small">' + esc(C.minor) + '</p>' +
    '<div class="pd-sig-area"><div class="pd-sig">' + esc(C.sigPatient) + '</div><div class="pd-sig">' + esc(C.sigName) + '</div></div>' +
    '<div class="pd-sig-area"><div class="pd-sig">' + esc(C.sigWitness) + '</div><div class="pd-sig">' + esc(C.sigDoctor) + '</div></div>' + footer() + '</div>');
  return h.join('');
}
function docScreening() {
  var T = PTXT[S.lang], Q = T.screening;
  var h = [letterhead(Q.title, Q.sub), patientBlock(T), '<p>' + esc(Q.intro) + '</p>'];
  h.push('<table class="yn"><thead><tr><th style="width:22px">#</th><th></th><th class="r" style="width:34px">' + esc(T.common.yes) + '</th><th class="r" style="width:34px">' + esc(T.common.no) + '</th></tr></thead><tbody>' +
    Q.q.map(function (q, i) { return '<tr><td>' + (i + 1) + '</td><td>' + esc(q) + '</td><td class="c">' + box() + '</td><td class="c">' + box() + '</td></tr>'; }).join('') + '</tbody></table>');
  h.push('<div class="pd-h">' + esc(Q.meds) + '</div>' + lines(2));
  h.push('<div class="pd-h">' + esc(Q.allergies) + '</div>' + lines(1));
  h.push('<div class="pd-h">' + esc(Q.details) + '</div>' + lines(2));
  h.push('<div class="pd-tail"><p class="pd-ack">' + esc(Q.confirm) + '</p>' +
    '<div class="pd-sig-area"><div class="pd-sig">' + esc(Q.sigPatient) + '</div><div class="pd-sig">' + esc(Q.sigReviewed) + '</div></div>' +
    '<div class="pd-note" style="margin-top:14px"><b>Office use:</b> Cleared for treatment &nbsp; ' + box() + 'Yes &nbsp; ' + box() + 'No &nbsp; ' + box() + 'Deferred. Reason: ______________________________</div>' + footer() + '</div>');
  return h.join('');
}
function docAftercare() {
  var T = PTXT[S.lang], A = T.aftercare;
  var follow = (S.patient.name || S.items.length) ? fmtDateLong(addDays(S.date, S.followWeeks * 7), S.lang, true) : '';
  var h = [letterhead(A.title.replace('{p}', prod().name), A.sub), patientBlock(T)];
  var ul = function (list) { return '<ul>' + list.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'; };
  h.push('<div class="two-col tight"><div><div class="pd-h">' + esc(A.before) + '</div>' + ul(A.beforeList) +
    '<div class="pd-h">' + esc(A.after) + '</div>' + ul(A.afterList) + '</div>' +
    '<div><div class="pd-h">' + esc(A.expect) + '</div>' + ul(A.expectList) +
    '<div class="pd-h">' + esc(A.call) + '</div>' + ul(A.callList) + '</div></div>');
  h.push('<div class="pd-h">' + esc(A.follow) + '</div><div class="pd-info two">' + pdLine(A.followTxt, follow, 'full') + '</div>');
  h.push('<div class="pd-tail"><div class="pd-emerg"><b>' + esc(A.emergTitle) + '</b> ' + esc(A.emergTxt) + '</div>' +
    '<p style="text-align:center;font-weight:700;margin-top:8px">' + esc(A.office) + '</p>' + footer() + '</div>');
  return h.join('');
}
function docCard() {
  var r = ratio(), uw = unitWord();
  var unitNote = r === 1 ? 'Doses in ' + prod().name + ' units per injection site' : 'Doses in ' + prod().name + ' units, converted from published Botox doses at ' + r + ' : 1 (not interchangeable; confirm)';
  var h = [letterhead('Botulinum Toxin Chairside Reference', unitNote, true)];
  var fPts = [], lPts = [];
  ['glabella', 'forehead', 'crows', 'gs-ant', 'mentalis', 'dao'].forEach(function (id) { fPts = fPts.concat(indPts(id, 'front', defaultsFor(id))); });
  /* label the patient's right side only; the left mirrors it */
  fPts.forEach(function (p) { if (/\|L$/.test(p.key)) p.nopill = true; });
  ['mass-brux', 'temporalis'].forEach(function (id) { lPts = lPts.concat(indPts(id, 'latR', defaultsFor(id))); });
  var pr = prod(), dilRows = presetMl().map(function (m) {
    var c = S.vial / m;
    return '<tr><td>' + S.vial + ' U + ' + fmtU(m) + ' mL' + (pr.label[S.vial] === m && pr.onLabel.indexOf(S.vial) >= 0 ? ' (label)' : '') + '</td><td class="r">' + fmtU(c / 10) + '</td><td class="r">' + fmtU(c / 100) + '</td></tr>';
  }).join('');
  h.push('<div class="card-top"><figure class="fig-card">' + faceSVG('front', { pts: fPts, hi: ['frontalis', 'corrugator', 'procerus', 'oculi', 'llsan', 'lls', 'zmi', 'mentalis', 'dao'], muscles: true, vb: ZOOM.face, print: true, inch: 2.15, idp: 'cdF' }) +
    '<figcaption>Upper face, gummy smile (anterior), mentalis, DAO. Doses on the patient\u2019s right; the left mirrors it</figcaption></figure>' +
    '<figure class="fig-card lat">' + faceSVG('latR', { pts: lPts, hi: ['masseter', 'temporalis'], muscles: true, marks: ['safe', 'thumb'], vb: ZOOM.lat, print: true, inch: 1.8, idp: 'cdR' }) +
    '<figcaption>Masseter (bruxism), temporalis. Hollow dot: optional site</figcaption></figure>' +
    '<div><div class="pd-h" style="margin-top:0">Dilution: ' + esc(pr.name) + '</div><table><thead><tr><th>Vial + diluent</th><th class="r">' + uw + '/0.1 mL</th><th class="r">' + uw + '/mark</th></tr></thead><tbody>' + dilRows + '</tbody></table>' +
    '<p class="small" style="margin-top:4px">A mark is one line on a U-100 insulin syringe (0.01 mL). Label: use within ' + pr.useHrs + ' h of mixing, refrigerated 2–8 °C; AAFE, with bacteriostatic saline: up to 4 weeks (off-label). Retreat no sooner than every 3 months.</p>' +
    '<div class="pd-emerg" style="margin-top:6px"><b>Emergency:</b> trouble swallowing, speaking or breathing, or spreading weakness, hours to weeks later: call 911. Allergic reaction: office medical emergency protocol.</div></div></div>');
  h.push('<table class="card-tbl"><colgroup><col style="width:15%"><col style="width:6%"><col style="width:8%"><col style="width:8%"><col style="width:38%"><col style="width:25%"></colgroup><thead><tr><th>Area</th><th class="r">Sites</th><th class="r">' + uw + '/site</th><th class="r">Total</th><th>Where</th><th>Watch for</th></tr></thead><tbody>' +
    IND_ORDER.map(function (id) {
      var ind = IND[id], d = defaultsFor(id), T = 0, n = 0, per = [];
      ind.points.forEach(function (p) { sidesOf(p).forEach(function (sd) { var u = d[p.id + '|' + sd]; if (!u) return; T += u; n++; per.push(fmtU(u)); }); });
      var uniq = per.filter(function (x, i) { return per.indexOf(x) === i; });
      return '<tr><td><b>' + esc(ind.chip) + '</b></td><td class="r">' + n + '</td><td class="r">' + uniq.join(' / ') + '</td><td class="r">' + fmtU(T) + '</td><td>' + esc(CARD_WHERE[id]) + '</td><td>' + esc(CARD_WATCH[id]) + '</td></tr>';
    }).join('') + '</tbody></table>');
  h.push('<div class="pd-tail"><p class="small" style="margin:6px 0 0"><b>Every visit:</b> screening and consent signed; photos at rest and in motion; check product, lot and expiry and label the vial; mark sites with the patient animating; follow up at 2 weeks before any touch-up.</p>' + footer() + '</div>');
  return h.join('');
}
var CARD_WHERE = {
  glabella: 'Procerus midline; corrugator above the medial brow + lateral site ≥1 cm above the rim; thumb on the rim',
  forehead: 'Lower row ≥2 cm above brow, ≥1.5 cm above glabellar sites (midline + near each temporal crest); upper row 2 sites',
  crows: '1.5 cm outside the lateral canthus, outside the rim; sites ~1 cm apart; just under the skin, away from the eye',
  'gs-ant': 'Yonsei point: 1 cm lateral to ala, 3 cm above commissure line',
  'gs-post': 'NLF point of greatest fold on smile + 2 cm lateral on zyg. major',
  'gs-mixed': 'Yonsei (half dose) + both posterior points',
  'gs-asym': 'Yonsei (front) or fold + lateral points (back); more on the higher side',
  'mass-brux': 'AAFE start: 1 central site; add upper/lower to titrate. Below tragus–commissure line, ≥1 cm behind ant. border, ≥1.5 cm above lower border; deep + superficial',
  'mass-hyp': 'Same safe zone, spread over the bulk; deep + superficial at every site',
  'temporalis': 'Bulkiest part or tender points, ≥4.5 cm above the arch; deep to bone; back site optional',
  'mentalis': '0.5 cm either side of pogonion; 3 U deep + 1 U superficial',
  'dao': 'On the marionette fold, middle and lower thirds; 4–5 mm deep',
  'perioral': '4 upper + 3 lower sites, 2–3 mm outside the vermilion; ≥1.5 cm from corners',
  'lipflip': 'Upper vermilion border, 2 sites each side of the philtrum'
};
var CARD_WATCH = {
  glabella: 'Lid ptosis if low/lateral; inner brow drop if high',
  forehead: 'Brow drop if low; treat with glabella',
  crows: 'Dry eye, lid or smile change if inside rim or low',
  'gs-ant': 'Lip ptosis, long upper lip',
  'gs-post': 'Flattened or uneven smile',
  'gs-mixed': 'Lip ptosis (doses add up)',
  'gs-asym': 'Do not inject a weak (palsy) side',
  'mass-brux': 'Bulging if only deep; uneven smile; chewing fatigue',
  'mass-hyp': 'Hollow cheek; bulging if only deep',
  'temporalis': 'STA, bruising, brow drop if too low/anterior',
  'mentalis': 'Lip incompetence if high; DLI if lateral',
  'dao': 'DLI: uneven lower lip if medial or deep',
  'perioral': 'Straws, whistling, weak lip seal',
  'lipflip': 'Straws, whistling; avoid in wind players'
};

/* ---------- Safety & sources ---------- */
function renderSafety() {
  var cx = [
    ['Eyelid droop (ptosis)', 'Toxin reaching the levator palpebrae: glabella sites too low or lateral, large volumes, rubbing afterward', 'Thumb on the upper orbital rim during corrugator sites; lateral site at least 1 cm above the rim; small volumes; no massage', 'Oxymetazoline 0.1% drops (Upneeq, FDA-approved for acquired eyelid droop) or apraclonidine 0.5% (off-label) can lift the lid a little while it wears off; resolves over weeks'],
    ['Brow drop or heavy brow', 'Forehead over-treated, injected too low, or treated without the glabella; low brows to begin with. Inner brow: glabellar toxin reaching the lower medial frontalis (sites too high or shallow)', 'Lower row at least 2 cm above the brow and 1.5 cm above glabellar sites; treat the glabella too; lower doses for low brows', 'Resolves over weeks'],
    ['Peaked lateral brow', 'Lateral frontalis still active after central forehead treatment', 'Include the sites near the temporal crests', '1–2 U into the lateral frontalis above the peak at the 2-week visit'],
    ['Dry eye, lower-lid weakness, double vision', 'Crow’s-feet injection inside the orbital rim or too deep', 'Stay 1.5 cm or more from the canthus, outside the rim; just under the skin, angled away from the eye', 'Lubricating drops; eye exam for double vision; resolves over weeks'],
    ['Bruising, swelling', 'Vessel puncture; blood thinners, NSAIDs, fish oil', 'Avoid visible veins (common at the crow’s feet); ice; gentle pressure', 'Cold packs; fades in 1–2 weeks'],
    ['Headache', 'Common after injection', 'None reliable', 'Acetaminophen; usually 1–2 days'],
    ['Uneven or flattened smile', 'Spread to zygomaticus major or risorius: masseter injected too far forward; too much at the posterior gummy-smile points', 'Stay in the masseter safe zone; low, even gummy-smile doses', 'Wait 6–12 weeks; a small balancing dose on the other side can even it out'],
    ['Upper-lip drop or long lip', 'Gummy-smile dose too high or too lateral', 'Start at 2–2.5 U per side and titrate', 'No reversal; resolves over weeks. Lower the dose next time'],
    ['Lower-lip asymmetry, drooling, trouble sipping', 'Spread to the DLI or orbicularis oris: DAO injected medial to the fold or too deep, mentalis too high, too much perioral toxin', 'DAO on the fold, not medial to it; mentalis ≥1 cm below the sulcus; low perioral doses', 'Resolves over weeks'],
    ['Chewing fatigue', 'Expected with masseter doses', 'Warn the patient; use the lowest effective dose', 'Softer diet; settles in 2–4 weeks'],
    ['Masseter bulge on clenching', 'Deep-only injection; the superficial layer above the deep tendon is left untreated', 'Give part of each dose deep and part superficially', 'At the 2–4 week visit, a small superficial dose into the bulge'],
    ['Hollow cheek', 'Masseter injected too far forward or too high', 'Stay behind the anterior border + 1 cm', 'Resolves as the effect wears off'],
    ['No effect or weaker over time', 'Usually dose or placement; rarely neutralizing antibodies', 'Lowest effective dose; at least 3 months between sessions; avoid frequent boosters', 'Review dose and placement first. Antibodies act against every type A brand, so switching rarely helps; if suspected, pause treatment for several months, then consider Xeomin']
  ];
  $('#panel-safety').innerHTML =
    '<div class="card emerg"><div class="card-hdr"><h3>Emergencies</h3></div><div class="card-body"><ul class="plain-list">' +
    '<li><b>Distant spread of toxin effect (boxed warning):</b> trouble swallowing, speaking or breathing, generalized weakness, double or blurred vision, ptosis, hoarseness or loss of bladder control, hours to weeks after injection. Call 911; this can be life-threatening.</li>' +
    '<li><b>Allergic reaction or anaphylaxis</b> (hives, facial or tongue swelling, wheezing, low blood pressure): follow the office medical emergency protocol and call 911.</li>' +
    '<li><b>Vasovagal faint:</b> lay the patient flat, raise the legs, monitor.</li></ul></div></div>' +
    '<div class="ref-grid" style="margin-top:16px">' +
    '<div class="card"><div class="card-hdr"><h3>Do not treat</h3></div><div class="card-body"><ul class="plain-list">' +
    '<li>Allergy to any botulinum toxin product or an ingredient (label contraindication). Dysport: also cow’s milk protein allergy.</li>' +
    '<li>Infection at the injection site (label contraindication).</li></ul>' +
    '<h4 class="eyebrow" style="margin:16px 0 6px">Defer or get clearance</h4><ul class="plain-list">' +
    '<li>Pregnancy or breastfeeding (no adequate safety data).</li>' +
    '<li>Myasthenia gravis, Lambert-Eaton syndrome, ALS or other neuromuscular disease: higher risk of swallowing and breathing problems.</li>' +
    '<li>Existing trouble swallowing or breathing.</li>' +
    '<li>Botulinum toxin anywhere in the body within the last 4 months (the retreatment interval is at least 3 months).</li>' +
    '<li>Aminoglycosides or other drugs that affect neuromuscular transmission, anticholinergics (including some allergy, cold and sleep medicines), muscle relaxants.</li>' +
    '<li>Heart disease (label: use caution with pre-existing cardiovascular disease).</li>' +
    '<li>Facial-nerve weakness on the side to be treated; unrealistic expectations.</li></ul></div></div>' +
    '<div class="card"><div class="card-hdr"><h3>Before every injection</h3></div><div class="card-body"><ol class="plain-list">' +
    '<li>Health screening completed and reviewed.</li><li>Consent signed (parent or guardian if under 18).</li>' +
    '<li>Photos at rest and in motion (frown, brow raise, smile, clench); profile for the masseter.</li>' +
    '<li>Product, lot and expiry checked; vial labeled with diluent volume and time.</li>' +
    '<li>Sites marked with the patient animating; skin cleaned.</li>' +
    '<li>Emergency kit and protocol in reach.</li>' +
    '<li>Aftercare handout given; follow-up booked at 2 weeks.</li></ol></div></div></div>' +
    '<div class="card" style="margin-top:16px"><div class="card-hdr"><h3>Complications</h3></div><div class="card-body"><div class="tbl-wrap"><table class="tbl cx-tbl"><thead><tr><th>Problem</th><th>Usual cause</th><th>Prevention</th><th>What to do</th></tr></thead><tbody>' +
    cx.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td><td>' + esc(r[3]) + '</td></tr>'; }).join('') +
    '</tbody></table></div><p style="margin:10px 0 0;font-size:12px;color:var(--grey-600)">Unwanted weakness from toxin cannot be reversed; it fades as nerve endings recover, usually over weeks to a few months.</p></div></div>' +
    '<div class="card" style="margin-top:16px"><div class="card-hdr"><h3>Sources</h3></div><div class="card-body">' + refList(['pi', 'xeoPi', 'hong', 'lee2017', 'fatani', 'muszalska']) + '</div></div>';
}
function renderSources() {
  var all = Object.keys(REFS);
  $('#panel-sources').innerHTML =
    '<div class="card"><div class="card-hdr"><h3>Products</h3></div><div class="card-body"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Product</th><th>Vials</th><th>Standard dilution</th><th class="r">Glabellar dose</th><th>After reconstitution</th><th>Notes</th></tr></thead><tbody>' +
    PRODUCT_ORDER.map(function (k) {
      var p = PRODUCTS[k];
      var dil = p.vials.map(function (v) { return v + ' U + ' + fmtU(p.label[v]) + ' mL = ' + fmtU(v / p.label[v] / 10) + ' U/0.1 mL' + (p.onLabel.indexOf(v) >= 0 ? ' (label)' : ''); }).join('<br>');
      return '<tr><td><b>' + esc(p.name) + '</b><br><span style="font-size:11px;color:var(--grey-500)">' + esc(p.generic) + '</span></td><td class="tnum">' + p.vials.join(', ') + ' U</td><td class="tnum" style="white-space:nowrap">' + dil + '</td><td class="r tnum">' + p.glabellar + ' U</td><td>Label: within ' + p.useHrs + ' h, 2–8 °C</td><td>' + esc(p.note) + '</td></tr>';
    }).join('') + '</tbody></table></div>' +
    '<p style="margin:10px 0 0;font-size:12px;color:var(--grey-600)">The 200 U Botox vial is the therapeutic product; 5 mL gives the same 4 U per 0.1 mL as the cosmetic vials. Other products (for example Daxxify or Letybo) are not built in; check their labels for dilution and units.</p>' +
    '<p style="margin:8px 0 0;font-size:12px;color:var(--grey-600)"><b>Approvals (adults):</b> Xeomin for glabellar, forehead and lateral canthal (crow\u2019s feet) lines; BOTOX Cosmetic for the same three plus platysma bands; Dysport for glabellar lines in adults under 65; Jeuveau for glabellar lines. The lower-face and jaw areas are off-label for every product, and every use is off-label under 18. BOTOX Cosmetic for masseter muscle prominence is under FDA review (application accepted August 2026).</p>' +
    '<p style="margin:8px 0 0;font-size:12px;color:var(--grey-600)"><b>Storage after mixing:</b> every label says preservative-free saline and use within 24 hours. The AAFE course mixes with bacteriostatic saline and uses the vial for up to 4 weeks refrigerated, in line with a 2015 consensus statement (Alam et al.); that is off-label. Choose the diluent in the plan or on the dilution page and the use-by time follows it.</p></div></div>' +
    '<div class="card" style="margin-top:16px"><div class="card-hdr"><h3>About the doses</h3></div><div class="card-body"><p style="margin:0 0 8px;font-size:13px;line-height:1.6;max-width:80ch">Where the AAFE Level I course gives a starting dose (glabella, forehead, crow\u2019s feet, lip lines, masseter and temporalis), the defaults follow it; the label and literature doses are listed under Usual dosing. The other areas use published starting doses from the literature. Doses are units per injection site for Xeomin or Botox, which are dosed 1 : 1. Some sites start at 0 U as optional sites to add when titrating. They are for a trained injector to adjust to the patient. Mazzuco and Hexsel’s gummy-smile series used Dysport units, so their numbers are not used directly. Saved defaults (“Save as my default”) live only in this browser.</p>' +
    '<p style="margin:0;font-size:13px;line-height:1.6;max-width:80ch">The app stores no patient information. Names and dates typed into the plan exist only on screen until the page is closed.</p></div></div>' +
    '<div class="card" style="margin-top:16px"><div class="card-hdr"><h3>References</h3></div><div class="card-body">' + refList(all) + '</div></div>';
}

/* ---------- events ---------- */
function setByPath(path, val) {
  var parts = path.split('.'), o = S;
  for (var i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = val;
}
function changeProduct(k) {
  if (!PRODUCTS[k] || k === S.product) return;
  var oldR = ratio(), oldName = prod().name;
  S.product = k;
  var pr = prod(), newR = pr.ratio;
  if (pr.vials.indexOf(S.vial) < 0) S.vial = pr.vials.indexOf(100) >= 0 ? 100 : pr.vials[0];
  S.diluent = pr.label[S.vial];
  if (S.items.length && oldR !== newR) {
    S.items.forEach(function (it) {
      var st = stepOf(IND[it.id]);
      Object.keys(it.d).forEach(function (key) { it.d[key] = roundTo(it.d[key] * newR / oldR, st); });
    });
    S.conv = 'Changed from ' + oldName + ' to ' + pr.name + ' at ' + (newR / oldR >= 1 ? fmtU(newR / oldR) + ' : 1' : '1 : ' + fmtU(oldR / newR)) + '.';
  } else if (oldR === newR) {
    S.conv = null;
  }
  savePrefs();
}
function changeVial(v) {
  v = +v;
  if (prod().vials.indexOf(v) < 0) return;
  S.vial = v;
  S.diluent = prod().label[v];
  savePrefs();
}
function changeDiluent(v) {
  var n = parseFloat(v);
  if (!(n > 0) || n > 20) return false;
  S.diluent = +n.toFixed(3);
  savePrefs();
  return true;
}
function stepDose(key, dir) {
  var m = /^([\w-]+)\.([\w]+)\|([RLM])$/.exec(key);
  if (!m) return;
  var it = findItem(m[1]); if (!it) return;
  var ind = IND[m[1]], p = ind.points.filter(function (x) { return x.id === m[2]; })[0]; if (!p) return;
  var st = stepOf(ind), k = m[2] + '|' + m[3], rg = rangeOf(p);
  var v = roundTo((it.d[k] || 0) + dir * st, st);
  if (v < 0) v = 0;
  if (v > rg.max * 2) v = rg.max * 2;
  it.d[k] = v;
}

function copyNote() {
  var ta = $('#noteTxt'), ok = $('#copyOk');
  if (!ta) return;
  var done = function (msg) { if (ok) { ok.textContent = msg; setTimeout(function () { ok.textContent = ''; }, 2500); } };
  var fallback = function () {
    ta.focus(); ta.select();
    var worked = false;
    try { worked = document.execCommand('copy'); } catch (e) { worked = false; }
    done(worked ? 'Copied' : 'Selected. Press Ctrl+C or ⌘C');
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(function () { done('Copied'); }, fallback);
    } else fallback();
  } catch (e) { fallback(); }
}

function flash(prefix, on) {
  $$('.face [data-key^="' + prefix + '|"]').forEach(function (el) { el.classList.toggle('flash', on); });
}

function onClick(e) {
  var t = e.target.closest('[data-act],[data-view]');
  if (!t) return;
  if (t.hasAttribute('data-view')) { setView(t.getAttribute('data-view')); return; }
  var act = t.getAttribute('data-act'), k = t.getAttribute('data-k');
  if (t.tagName === 'SELECT' || t.tagName === 'INPUT') return;
  switch (act) {
    case 'layer': S.show[k] = !S.show[k]; savePrefs(); withFocus(render); break;
    case 'map-ind': S.mapInd = k; savePrefs(); withFocus(renderMap); break;
    case 'add-plan': addItem(k); setView('plan'); break;
    case 'quick-add': addItem(k); withFocus(renderPlan); renderShell(); break;
    case 'clear-mine': delete S.myDefaults[k]; savePrefs(); withFocus(renderMap); break;
    case 'inc': case 'dec': stepDose(k, act === 'inc' ? 1 : -1); withFocus(function () { $('#planItems').innerHTML = itemsHTML(); }); refreshPlanOutputs(); break;
    case 'swap': {
      var it = findItem(k); if (!it) break;
      IND[k].points.forEach(function (p) { if (p.mid) return; var a = it.d[p.id + '|R']; it.d[p.id + '|R'] = it.d[p.id + '|L']; it.d[p.id + '|L'] = a; });
      withFocus(function () { $('#planItems').innerHTML = itemsHTML(); }); refreshPlanOutputs(); break;
    }
    case 'reset': { var it2 = findItem(k); if (it2) it2.d = defaultsFor(k); withFocus(function () { $('#planItems').innerHTML = itemsHTML(); }); refreshPlanOutputs(); break; }
    case 'save-mine': {
      var it3 = findItem(k); if (!it3) break;
      var r = ratio(), md = {};
      Object.keys(it3.d).forEach(function (key) { md[key] = +(Math.round(it3.d[key] / r / 0.25) * 0.25).toFixed(2); });
      S.myDefaults[k] = md; savePrefs();
      t.textContent = 'Saved';
      setTimeout(function () { if (t.isConnected) t.textContent = 'Save as my default'; }, 1800);
      break;
    }
    case 'remove': S.items = S.items.filter(function (x) { return x.id !== k; }); renderPlan(); renderShell(); break;
    case 'copy-note': copyNote(); break;
    case 'dismiss-conv': S.conv = null; render(); break;
    case 'preset': if (changeDiluent(k)) withFocus(render); break;
    case 'doc': S.doc = k; savePrefs(); withFocus(renderPrint); break;
    case 'go-doc': S.doc = k; savePrefs(); setView('print'); break;
    case 'lang': S.lang = k; savePrefs(); withFocus(renderPrint); break;
    case 'print': printDoc(k); break;
    case 'prod-chip': setView('dilution'); break;
  }
}
function onChange(e) {
  var t = e.target, act = t.getAttribute('data-act');
  if (act === 'product') { changeProduct(t.value); withFocus(render); return; }
  if (act === 'vial') { changeVial(t.value); withFocus(render); return; }
  if (act === 'add-area') { if (t.value) { addItem(t.value); renderPlan(); renderShell(); } return; }
  if (act === 'diluent') { if (changeDiluent(t.value)) withFocus(render); else t.value = S.diluent; return; }
  var b = t.getAttribute('data-bind');
  if (b) { bindValue(t, b); if (S.view === 'dilution') withFocus(renderDilution); }
}
function onInput(e) {
  var t = e.target, b = t.getAttribute('data-bind');
  if (b && t.type !== 'checkbox' && t.tagName !== 'SELECT') { bindValue(t, b, true); }
  if (t.getAttribute('data-act') === 'diluent') {
    if (changeDiluent(t.value)) {
      renderShell();
      if (S.view === 'plan') { var pi = $('#planItems'); if (pi) pi.innerHTML = itemsHTML(); refreshPlanOutputs(); }
      else if (S.view === 'dilution') refreshDilutionLive();
    }
  }
}
function bindValue(t, path, live) {
  var v = t.type === 'checkbox' ? t.checked : t.value;
  if (path === 'followWeeks') v = +v || 2;
  if (path === 'injector') savePrefsSoon();
  if (path === 'diluentType') savePrefsSoon();
  setByPath(path, v);
  if (S.view === 'plan') refreshPlanOutputs();
}
var prefTimer = null;
function savePrefsSoon() { clearTimeout(prefTimer); prefTimer = setTimeout(savePrefs, 400); }
function refreshDilutionLive() {
  /* typing in the diluent box: re-render the dilution panel but keep the cursor in the box */
  var el = $('#dlDil'), pos = el ? el.selectionStart : null, val = el ? el.value : null;
  renderDilution();
  var n = $('#dlDil');
  if (n && val != null) { n.value = val; n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* number inputs */ } }
}

function init() {
  loadPrefs();
  var h = (location.hash || '').replace('#', '');
  if (VIEWS[h]) S.view = h;
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('mouseover', function (e) { var r = e.target.closest('[data-flash]'); if (r) flash(r.getAttribute('data-flash'), true); });
  document.addEventListener('mouseout', function (e) { var r = e.target.closest('[data-flash]'); if (r) flash(r.getAttribute('data-flash'), false); });
  var rz = null;
  window.addEventListener('resize', function () {
    clearTimeout(rz);
    rz = setTimeout(function () { drawFigs(); if (S.view === 'print') fitPaper(); }, 120);
  });
  window.addEventListener('hashchange', function () { var v = (location.hash || '').replace('#', ''); if (VIEWS[v] && v !== S.view) setView(v); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (S.view === 'print') fitPaper(); });
  render();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
