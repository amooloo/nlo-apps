// ─── Data layer: the sbGet / sbPost / sbPatch the IPR Tracker has always used, now over the sealed records ───
// backend.js: IP holds every patient, opened, while someone is signed in; a patient's visits are read when they're opened.
// The Supabase-style query strings (eq., ilike., or=(), order=, limit=) are evaluated here, on the opened records.
function fbParseCond(field, spec) {
  // spec like "eq.15-6541" or "ilike.*jg*"
  const dot = spec.indexOf(".");
  return { field: field, op: spec.slice(0, dot), val: spec.slice(dot + 1) };
}
function fbIlikeRegex(pat) {
  const esc = pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + esc + "$", "i");
}
function fbMatch(row, c) {
  const v = row[c.field] === undefined || row[c.field] === null ? "" : String(row[c.field]);
  if (c.op === "eq") return v === c.val;
  if (c.op === "ilike") return fbIlikeRegex(c.val).test(v);
  return false;
}
function fbOrder(rows, orderSpec) {
  if (!orderSpec) return rows;
  const keys = orderSpec.split(",").map(s => {
    const parts = s.split(".");
    return { field: parts[0], desc: parts[1] === "desc" };
  });
  return rows.slice().sort((a, b) => {
    for (const k of keys) {
      const av = a[k.field] === undefined || a[k.field] === null ? "" : String(a[k.field]);
      const bv = b[k.field] === undefined || b[k.field] === null ? "" : String(b[k.field]);
      if (av < bv) return k.desc ? 1 : -1;
      if (av > bv) return k.desc ? -1 : 1;
    }
    return 0;
  });
}
function fbLimit(rows, lim) {
  const n = parseInt(lim, 10);
  return isNaN(n) ? rows : rows.slice(0, n);
}
async function sbGet(path) {
  const q = path.split("?");
  const table = q[0];
  const params = new URLSearchParams(q[1] || "");
  if (table === "patients") {
    let rows = await IP.patients();
    for (const [k, v] of params.entries()) {
      if (k === "select" || k === "order" || k === "limit") continue;
      if (k === "or") {
        const conds = v.replace(/^\(/, "").replace(/\)$/, "").split(",").map(s => {
          const dot = s.indexOf(".");
          return fbParseCond(s.slice(0, dot), s.slice(dot + 1));
        });
        rows = rows.filter(r => conds.some(c => fbMatch(r, c)));
      } else {
        const c = fbParseCond(k, v);
        rows = rows.filter(r => fbMatch(r, c));
      }
    }
    return fbLimit(fbOrder(rows, params.get("order")), params.get("limit"));
  }
  if (table === "visits") {
    const pu = (params.get("patient_uuid") || "").replace(/^eq\./, "");
    if (!pu) return [];
    const rows = await IP.visits(pu);
    return fbLimit(fbOrder(rows, params.get("order") || "date.desc"), params.get("limit"));
  }
  throw new Error("Unknown table: " + table);
}
async function sbPost(table, body) {
  if (table === "patients") return [await IP.createPatient({ chart: body.patient_id, name: body.name })];
  if (table === "visits") {
    if (!body.patient_uuid) throw new Error("Visit missing patient_uuid");
    const { patient_uuid, ...rest } = body;
    return [await IP.createVisit(patient_uuid, rest)];
  }
  throw new Error("Unknown table: " + table);
}
async function sbPatch(path, body) {
  const q = path.split("?");
  const table = q[0];
  const params = new URLSearchParams(q[1] || "");
  const id = (params.get("id") || "").replace(/^eq\./, "");
  if (!id) throw new Error("PATCH needs id=eq.<id>");
  if (table === "visits") { const { patient_uuid, ...rest } = body || {}; return [await IP.saveVisit(id, rest)]; }
  if (table === "patients") return [await IP.savePatient(id, { chart: body.patient_id, name: body.name })];
  throw new Error("Unknown table: " + table);
}
// Today's date on this computer's clock (IPR Tracker 3 used the UTC date, so an evening visit got tomorrow's date)
function localToday() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
// What a patient is called on screen: the full name, else the initials an older record kept
function ptLabel(p) { return (p && (p.name || p.ini)) || ""; }
function ptSort(a, b) { return ptLabel(a).localeCompare(ptLabel(b)) || String(a.patient_id).localeCompare(String(b.patient_id)); }
// Find patients: by chart # (dashes and spaces don't matter, part of one is fine), by name (any part of it, in any order —
// "doe", "jan", "jane d"), or by initials ("JD"). Best matches first.
async function iprSearch(q) {
  const rows = await IP.patients();
  q = String(q || "").trim(); if (!q) return [];
  const a = iprNorm(q), whole = normName(q), words = whole.split(" ").filter(Boolean), letters = /^[a-z]{2,4}$/i.test(q) ? q.toUpperCase() : "";
  const score = p => {
    const ch = iprNorm(p.patient_id), nm = normName(p.name), toks = nm ? nm.split(" ") : [];
    if (a && ch && ch === a) return 0;
    if (a && /\d/.test(a) && ch.includes(a)) return 1;
    if (toks.length && words.length && words.every(w => toks.some(t => t.startsWith(w)))) return 2;
    if (nm && nm.includes(whole)) return 3;
    if (letters && ((p.ini || "").toUpperCase() === letters || nameInitials(p.name) === letters)) return 4;
    return -1;
  };
  return rows.map(p => [score(p), p]).filter(x => x[0] >= 0).sort((x, y) => x[0] - y[0] || ptSort(x[1], y[1])).map(x => x[1]).slice(0, 50);
}
async function iprAllPatients() { return (await IP.patients()).slice().sort(ptSort); }
// The name NLO Cases has for a chart # ('' when it has none, or two different ones)
async function iprCaseName(chart) {
  if (iprNorm(chart).length < 3) return "";
  try { return FB.oneName((await FB.caseNames([chart])).get(iprNorm(chart))); } catch (e) { return ""; }
}
// A patient opened with initials only (moved from IPR Tracker 3, or added before NLO Cases had the case): the name NLO Cases
// has for the chart # goes on the record — when it fits the initials. Quietly; the patient on screen is updated with it.
async function iprFillName(p) {
  if (!p || p.name || p.locked || !p.patient_id) return null;
  const name = await iprCaseName(p.patient_id);
  if (!name || !fitsInitials(name, p.ini)) return null;
  try { return await IP.savePatient(p.id, { name }, { a: "name", how: "cases" }); } catch (e) { return null; }
}

// ─── Constants ────────────────────────────────────────────────────────────────
const UPPER = ["UR7", "UR6", "UR5", "UR4", "UR3", "UR2", "UR1", "UL1", "UL2", "UL3", "UL4", "UL5", "UL6", "UL7"];
const LOWER = ["LR7", "LR6", "LR5", "LR4", "LR3", "LR2", "LR1", "LL1", "LL2", "LL3", "LL4", "LL5", "LL6", "LL7"];
/* The assistant list: the office's people from NLO Cases (Team & security — names and photos follow Staff Hub), shown by
   first name (Dr. A as "Dr. A", last), the way the IPR Tracker has always saved them. A visit keeps the name as shown. */
let iprStaffNamesCur = [];
const iprRosterSubs = new Set();
let iprRosterBySid = {};
function iprStaffNamesNow() { return iprStaffNamesCur; }
function iprRosterSubscribe(f) { iprRosterSubs.add(f); return () => { iprRosterSubs.delete(f); }; }
/* small round photos for the assistant picker, keyed by the name shown in the list. Someone whose login is turned off shows in
   grayscale. No photo = nothing extra is drawn. */
let iprPhotosCur = {}, iprPhotosSig = "";
function iprPhotosNow() { return iprPhotosCur; }
/* each person's name as the list shows it: the owner "Dr. A"; everyone else their first name — with their last name's initial
   when two people share a first name */
function iprShownNames(list) {
  const out = {}, firsts = {};
  list.forEach(r => { if (r.role !== "owner") { const f = firstName(r.name).toLowerCase(); firsts[f] = (firsts[f] || 0) + 1; } });
  list.forEach(r => {
    if (r.role === "owner") { out[r.sid] = "Dr. A"; return; }
    const f = firstName(r.name), parts = cleanName(r.name).split(" ");
    out[r.sid] = firsts[f.toLowerCase()] > 1 && parts.length > 1 ? f + " " + parts[parts.length - 1][0] + "." : (f || cleanName(r.name) || r.sid);
  });
  return out;
}
function iprRosterApply(list) {
  list = (Array.isArray(list) ? list : []).filter(r => r && r.sid && (r.name || r.role === "owner"));
  const shown = iprShownNames(list); iprRosterBySid = shown;
  const ph = {};
  list.forEach(r => {
    if (typeof r.photo === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(r.photo) && r.photo.length < 60000)
      ph[shown[r.sid].toLowerCase()] = { photo: r.photo, gone: r.active !== true };
  });
  const sig = Object.keys(ph).sort().map(k => k + (ph[k].gone ? "g" : "a") + ph[k].photo.length + ph[k].photo.slice(-24)).join("|");
  const photosChanged = sig !== iprPhotosSig;
  if (photosChanged) { iprPhotosCur = ph; iprPhotosSig = sig; }
  const dr = n => /^dr\b/i.test(n) ? 1 : 0;
  const next = list.filter(r => r.active === true).map(r => shown[r.sid]).filter((n, i, a) => n && a.indexOf(n) === i).sort((a, b) => dr(a) - dr(b) || a.localeCompare(b));
  const namesChanged = next.join("\n") !== iprStaffNamesCur.join("\n");
  if (namesChanged) iprStaffNamesCur = next;
  if (namesChanged || photosChanged) iprRosterSubs.forEach(f => f());
}
/* the assistant a new visit starts with: whoever is signed in (an assistant at the chair), else the last one picked here */
function iprDefaultAssistant() {
  const me = FB.me && !FB.isOwner() ? iprRosterBySid[FB.me.staffId] : "";
  if (me && iprStaffNamesCur.indexOf(me) !== -1) return me;
  try { const a = localStorage.getItem("ipr_last_asst") || ""; return iprStaffNamesCur.indexOf(a) !== -1 ? a : ""; } catch (e) { return ""; }
}
/* Assistant <select>: re-renders live when the roster changes. A saved name that is no longer on the list
   (e.g. a former assistant on an old visit) is added as an extra option for that record only, so it still
   shows and is kept as-is if the visit is saved again. */
function IprAsstSelect(props) {
  const { blank, ...rest } = props;
  const names = React.useSyncExternalStore(iprRosterSubscribe, iprStaffNamesNow);
  const v = props.value || "";
  const list = v && names.indexOf(v) === -1 ? names.concat([v]) : names;
  const photos = React.useSyncExternalStore(iprRosterSubscribe, iprPhotosNow);
  const info = v ? photos[String(v).trim().toLowerCase()] : null;
  const opts = [React.createElement("option", { key: "", value: "" }, blank)].concat(list.map(n => React.createElement("option", { key: n, value: n }, n)));
  if (!info) return React.createElement("select", rest, opts);
  const face = React.createElement("span", { "aria-hidden": "true", style: { width: 28, height: 28, borderRadius: "50%", flex: "none", overflow: "hidden", display: "inline-flex", filter: info.gone ? "grayscale(1)" : undefined } },
    React.createElement("img", { src: info.photo, alt: "", style: { width: "100%", height: "100%", objectFit: "cover", display: "block" } }));
  return React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 } }, face,
    React.createElement("select", { ...rest, style: { ...(rest.style || {}), flex: "1 1 auto" } }, opts));
}
function initContacts(teeth) {
  const c = {};
  for (let i = 0; i < teeth.length - 1; i++) c[`${teeth[i]}|${teeth[i + 1]}`] = "";
  return c;
}
function initBT(teeth) {
  const c = {};
  for (let i = 0; i < teeth.length - 1; i++) c[`${teeth[i]}|${teeth[i + 1]}`] = false;
  return c;
}
// Firebase RTDB does NOT preserve object key order — children come back sorted
// alphabetically. The arch renderers and quick-entry range logic assume the
// anatomical insertion order produced by initContacts()/initBT(), so every
// contact map loaded from the DB must be re-keyed into canonical order first.
// (Values are looked up by key, so no data changes — only ordering.)
function canonContacts(teeth, raw, blank) {
  const src = raw || {};
  const c = {};
  for (let i = 0; i < teeth.length - 1; i++) {
    const k = `${teeth[i]}|${teeth[i + 1]}`;
    c[k] = src[k] === undefined || src[k] === null ? blank : src[k];
  }
  return c;
}
function sumContacts(contacts) {
  return Object.values(contacts).reduce((s, v) => s + (parseFloat(v) || 0), 0);
}
// Parse a value that might be a JSON string or already an object
function jp(val, fallback) {
  if (!val) return fallback;
  if (typeof val === 'string') { try { return JSON.parse(val); } catch(e) { return fallback; } }
  return val;
}
// This tab's draft (what was on screen before the lock or a reload), sealed for the person signed in; lock.js opens it after
// sign-in and hands it over at mount. (IPR Tracker 3 kept it readable in the tab.) Also the NLO Cases link, read at start-up.
let APP_DRAFT = null, APP_DEEP = null;
// the app's own hooks for the lock (lock.js): put what's on screen in the draft, and save a change still waiting to autosave
let APP_HOOKS = { flush: null };
function load(key, fallback) {
  const d = APP_DRAFT;
  if (!d || !Object.prototype.hasOwnProperty.call(d, key) || d[key] === undefined) return fallback;
  try { return JSON.parse(JSON.stringify(d[key])); } catch (e) { return fallback; }
}
function addContacts(a, b) {
  const result = {};
  Object.keys(a).forEach(k => {
    result[k] = String((parseFloat(a[k]) || 0) + (parseFloat(b[k]) || 0));
  });
  return result;
}

// ─── Arch diagram geometry ────────────────────────────────────────────────────
// Teeth tile along a buccal arch curve (a cubic Bézier from the incisal midline back to the
// distal of the second molar). Each crown is drawn from an occlusal outline of its own tooth type
// (TOOTH_FORMS) warped onto that curve, so outlines follow the arch and every interproximal contact
// sits exactly on a tooth boundary; the faint lines inside are the crown's anatomy (incisal edges,
// cusp ridges, grooves), as on a dental-anatomy occlusal chart. The entry chips ride a ring just
// outside the arch. Everything is in px at the diagram's native size; the FitBox wrapper scales it
// to the available width.
//
// TOOTH_FORMS: per arch, teeth 1..7. Coordinates are relative to the tooth's slot on the arch:
// x runs mesial (−1) → distal (+1), y runs buccal/labial surface (0) → lingual (1), so one form
// serves all four quadrants. o = outline control points (closed, smoothed); l = anatomy lines.
const TOOTH_FORMS = {
  U: [
    { // central incisor: broad labial face tapering to a rounded cingulum; incisal edge + marginal ridges
      o: [-0.97, 0.2, -0.78, 0.05, -0.35, -0.01, 0.15, -0.01, 0.62, 0.04, 0.93, 0.16, 0.97, 0.3, 0.8, 0.57, 0.54, 0.82, 0.28, 0.96, -0.02, 1.0, -0.34, 0.93, -0.66, 0.68, -0.91, 0.41],
      l: [[-0.78, 0.22, -0.3, 0.16, 0.3, 0.16, 0.78, 0.24], [-0.66, 0.32, -0.42, 0.6, -0.1, 0.82], [0.68, 0.34, 0.42, 0.62, 0.1, 0.82]]
    },
    { // lateral incisor: smaller and rounder, prominent cingulum
      o: [-0.96, 0.24, -0.74, 0.07, -0.3, 0.0, 0.2, 0.0, 0.64, 0.06, 0.93, 0.22, 0.96, 0.38, 0.8, 0.65, 0.5, 0.88, 0.1, 1.0, -0.3, 0.93, -0.68, 0.69, -0.93, 0.43],
      l: [[-0.7, 0.24, 0, 0.18, 0.7, 0.26], [-0.55, 0.34, -0.3, 0.62, -0.04, 0.8], [0.58, 0.36, 0.32, 0.64, 0.06, 0.8]]
    },
    { // canine: diamond, prominent labial ridge and cingulum; cusp tip with mesial/distal cusp ridges + lingual ridge
      o: [-0.97, 0.3, -0.8, 0.12, -0.44, 0.01, -0.05, -0.07, 0.38, 0.02, 0.73, 0.14, 0.97, 0.33, 0.86, 0.58, 0.58, 0.81, 0.26, 0.97, -0.04, 1.0, -0.36, 0.94, -0.68, 0.75, -0.9, 0.52],
      l: [[-0.86, 0.36, -0.45, 0.27, -0.05, 0.19, 0.42, 0.28, 0.86, 0.38], [-0.05, 0.21, -0.03, 0.55, -0.04, 0.84]]
    },
    { // first premolar: buccal wider than lingual, mesial concavity; central groove with its fossae
      o: [-0.98, 0.33, -0.88, 0.12, -0.55, 0.02, -0.05, -0.04, 0.5, 0.02, 0.88, 0.13, 0.99, 0.34, 0.94, 0.58, 0.76, 0.82, 0.42, 0.97, -0.04, 1.0, -0.44, 0.96, -0.76, 0.82, -0.88, 0.63, -0.87, 0.48],
      l: [[-0.74, 0.35, -0.6, 0.47, -0.72, 0.6], [-0.6, 0.47, -0.2, 0.45, 0.2, 0.5, 0.6, 0.46], [0.74, 0.34, 0.6, 0.46, 0.73, 0.58]]
    },
    { // second premolar: rounder, cusps alike; shorter central groove
      o: [-0.98, 0.34, -0.86, 0.13, -0.5, 0.02, 0.0, -0.02, 0.5, 0.02, 0.86, 0.13, 0.98, 0.34, 0.96, 0.6, 0.8, 0.84, 0.42, 0.98, 0.0, 1.0, -0.42, 0.98, -0.8, 0.84, -0.96, 0.6],
      l: [[-0.55, 0.38, -0.4, 0.5, -0.54, 0.62], [-0.4, 0.5, 0.0, 0.47, 0.4, 0.5], [0.55, 0.38, 0.4, 0.5, 0.54, 0.62]]
    },
    { // first molar: rhomboid (lingual half sits distal), MB/DB cusps buccally, large ML and smaller DL lingually;
      // buccal groove into the central fossa, central groove to the mesial fossa, groove across the
      // oblique ridge to the distal fossa, and the distolingual groove
      o: [-1.0, 0.34, -0.94, 0.14, -0.74, 0.03, -0.38, 0.0, -0.06, 0.06, 0.26, 0.02, 0.6, 0.04, 0.82, 0.12, 0.98, 0.36, 1.0, 0.6, 0.9, 0.82, 0.64, 0.95, 0.3, 0.99, -0.1, 1.01, -0.56, 0.97, -0.84, 0.83, -0.96, 0.6],
      l: [[-0.06, 0.08, -0.08, 0.3, -0.1, 0.46], [-0.1, 0.46, -0.4, 0.43, -0.62, 0.4], [-0.78, 0.3, -0.62, 0.4, -0.76, 0.52], [-0.1, 0.46, 0.2, 0.52, 0.5, 0.54], [0.42, 0.94, 0.42, 0.7, 0.5, 0.54, 0.72, 0.42]]
    },
    { // second molar: smaller, heart-shaped, reduced distolingual cusp
      o: [-1.0, 0.36, -0.94, 0.14, -0.72, 0.03, -0.36, 0.0, -0.04, 0.06, 0.3, 0.02, 0.66, 0.06, 0.9, 0.18, 0.99, 0.4, 0.92, 0.64, 0.72, 0.84, 0.42, 0.96, 0.04, 1.0, -0.38, 0.98, -0.74, 0.86, -0.94, 0.64],
      l: [[-0.04, 0.08, -0.06, 0.28, -0.1, 0.46], [-0.1, 0.46, -0.4, 0.42, -0.6, 0.38], [-0.1, 0.46, 0.24, 0.58, 0.46, 0.76]]
    }
  ],
  L: [
    { // central incisor: narrow and symmetrical, labial a little wider than lingual; straight incisal edge
      o: [-0.96, 0.26, -0.8, 0.07, -0.36, 0.0, 0.36, 0.0, 0.8, 0.07, 0.96, 0.26, 0.9, 0.52, 0.68, 0.78, 0.36, 0.96, 0.0, 1.0, -0.36, 0.96, -0.68, 0.78, -0.9, 0.52],
      l: [[-0.66, 0.24, 0, 0.22, 0.66, 0.24], [-0.42, 0.38, -0.16, 0.68, 0.0, 0.8], [0.42, 0.38, 0.16, 0.68, 0.0, 0.8]]
    },
    { // lateral incisor: a little larger, edge turned slightly distolingually
      o: [-0.96, 0.26, -0.8, 0.07, -0.36, 0.0, 0.36, 0.01, 0.8, 0.09, 0.96, 0.29, 0.9, 0.55, 0.68, 0.8, 0.36, 0.97, 0.0, 1.0, -0.36, 0.95, -0.68, 0.77, -0.9, 0.51],
      l: [[-0.68, 0.22, 0, 0.23, 0.68, 0.3], [-0.42, 0.38, -0.16, 0.68, 0.0, 0.8], [0.44, 0.42, 0.18, 0.7, 0.02, 0.8]]
    },
    { // canine: narrower diamond than the upper
      o: [-0.97, 0.3, -0.78, 0.11, -0.4, 0.01, 0.0, -0.04, 0.4, 0.01, 0.78, 0.12, 0.97, 0.32, 0.86, 0.58, 0.58, 0.82, 0.24, 0.97, -0.06, 1.0, -0.38, 0.94, -0.68, 0.76, -0.9, 0.54],
      l: [[-0.84, 0.36, -0.42, 0.28, 0.0, 0.2, 0.42, 0.28, 0.86, 0.38], [0.0, 0.22, -0.02, 0.56, -0.04, 0.82]]
    },
    { // first premolar: dominant buccal cusp, small mesially placed lingual cusp, converging lingually
      o: [-0.98, 0.34, -0.88, 0.13, -0.52, 0.02, 0.0, -0.04, 0.52, 0.02, 0.88, 0.14, 0.98, 0.36, 0.88, 0.6, 0.62, 0.82, 0.26, 0.96, -0.08, 1.0, -0.42, 0.92, -0.56, 0.84, -0.74, 0.74, -0.92, 0.56],
      l: [[-0.56, 0.48, -0.22, 0.56, 0.18, 0.5, 0.52, 0.56]]
    },
    { // second premolar (three-cusp form): squarer, Y-shaped groove
      o: [-0.98, 0.36, -0.9, 0.14, -0.56, 0.02, 0.0, -0.02, 0.56, 0.02, 0.9, 0.14, 0.98, 0.36, 0.96, 0.62, 0.82, 0.86, 0.46, 0.98, 0.1, 0.95, -0.24, 0.99, -0.64, 0.94, -0.9, 0.78, -0.98, 0.58],
      l: [[-0.58, 0.42, -0.24, 0.5, 0.06, 0.58, 0.34, 0.5, 0.6, 0.42], [0.06, 0.58, 0.08, 0.76, 0.1, 0.92]]
    },
    { // first molar: five cusps (MB, DB, D buccally; ML, DL lingually); zigzag central groove,
      // mesiobuccal, distobuccal and lingual grooves
      o: [-1.0, 0.4, -0.96, 0.18, -0.78, 0.05, -0.46, 0.0, -0.2, 0.05, 0.06, 0.01, 0.3, 0.03, 0.46, 0.09, 0.68, 0.1, 0.9, 0.2, 0.99, 0.42, 0.96, 0.66, 0.82, 0.86, 0.52, 0.97, 0.24, 0.96, 0.08, 0.92, -0.12, 0.98, -0.48, 1.0, -0.8, 0.9, -0.96, 0.68],
      l: [[-0.7, 0.44, -0.42, 0.5, -0.16, 0.46, 0.12, 0.52, 0.44, 0.48, 0.72, 0.42], [-0.2, 0.07, -0.18, 0.28, -0.16, 0.46], [0.46, 0.11, 0.46, 0.3, 0.44, 0.48], [0.08, 0.9, 0.1, 0.7, 0.12, 0.52]]
    },
    { // second molar: rectangular, four cusps, cross-shaped groove
      o: [-1.0, 0.4, -0.95, 0.16, -0.74, 0.04, -0.36, 0.0, -0.04, 0.06, 0.3, 0.01, 0.66, 0.04, 0.9, 0.16, 0.99, 0.42, 0.95, 0.68, 0.82, 0.88, 0.46, 0.98, 0.12, 0.96, -0.02, 0.92, -0.2, 0.97, -0.58, 1.0, -0.86, 0.9, -0.98, 0.66],
      l: [[-0.7, 0.46, -0.32, 0.5, 0.0, 0.48, 0.36, 0.5, 0.72, 0.46], [-0.04, 0.08, -0.02, 0.3, 0.0, 0.48, -0.01, 0.7, -0.02, 0.9]]
    }
  ]
};
// Smooth curve through control points (centripetal Catmull-Rom), sampled `steps` per segment.
// flat = [x0, y0, x1, y1, …]; closed = outline, else an open line (ends extended by reflection).
function toothSpline(flat, closed, steps) {
  const P = [];
  for (let i = 0; i < flat.length; i += 2) P.push([flat[i], flat[i + 1]]);
  const n = P.length, out = [];
  const at = i => {
    if (closed) return P[(i % n + n) % n];
    if (i < 0) return [2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]];
    if (i > n - 1) return [2 * P[n - 1][0] - P[n - 2][0], 2 * P[n - 1][1] - P[n - 2][1]];
    return P[i];
  };
  const mix = (a, b, wa, wb) => [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const d = (a, b) => Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])) || 1e-6;
    const t1 = d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    for (let j = 0; j < steps; j++) {
      const t = t1 + (t2 - t1) * j / steps;
      const a1 = mix(p0, p1, (t1 - t) / t1, t / t1);
      const a2 = mix(p1, p2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1));
      const a3 = mix(p2, p3, (t3 - t) / (t3 - t2), (t - t2) / (t3 - t2));
      const b1 = mix(a1, a2, (t2 - t) / t2, t / t2);
      const b2 = mix(a2, a3, (t3 - t) / (t3 - t1), (t - t1) / (t3 - t1));
      out.push(mix(b1, b2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1)));
    }
  }
  if (!closed) out.push(P[n - 1]);
  return out;
}
const ARCH_CACHE = {};
function archBuildRaw(lower) {
  const X = 176, Y = 262, K1 = 0.55, K2 = 0.62;      // half-width, depth, Bézier handle lengths
  const CHIP = 34, PILL = 63, GAP = 2.4, MARGIN = 14; // chip / earlier-visit pill distance from the arch, gap between teeth
  // Mesiodistal width and buccolingual depth (mm) for teeth 1..7 — only their proportions matter.
  // (The widths also set where each contact, and so each entry chip, sits on the arch.)
  const WID = lower ? [6.0, 6.2, 7.0, 7.0, 7.0, 10.0, 9.5] : [8.0, 6.6, 7.6, 7.0, 6.6, 9.6, 9.0];
  const THK = lower ? [7.0, 7.2, 7.6, 7.8, 8.2, 9.8, 9.4] : [7.0, 6.2, 8.0, 9.2, 9.2, 11.2, 11.0];
  const f1 = v => (Math.round(v * 10) / 10);

  // Left half of the buccal curve (viewer's left = patient's right), sampled for arc length.
  const bez = t => {
    const u = 1 - t;
    return [u * u * u * 0 + 3 * u * u * t * (-K1 * X) + 3 * u * t * t * (-X) + t * t * t * (-X),
            u * u * u * 0 + 3 * u * u * t * 0 + 3 * u * t * t * (K2 * Y) + t * t * t * Y];
  };
  const N = 1200, pts = [], cum = [0];
  for (let i = 0; i <= N; i++) pts.push(bez(i / N));
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const LT = cum[N];
  const frame = s => {                        // point + outward normal at arc length s
    s = Math.max(0, Math.min(LT, s));
    let lo = 0, hi = N;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < s) lo = m + 1; else hi = m; }
    const i = Math.max(1, lo), f = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    const a = pts[i - 1], b = pts[i];
    const j0 = Math.max(0, i - 3), j1 = Math.min(N, i + 3);
    let tx = pts[j1][0] - pts[j0][0], ty = pts[j1][1] - pts[j0][1];
    const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
    return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, nx: -ty, ny: tx };
  };
  const cumW = [0]; WID.forEach(w => cumW.push(cumW[cumW.length - 1] + w));
  const k = LT / cumW[7];                     // px per mm, so the seven teeth exactly fill the half arch
  const S = m => cumW[m] * k;
  const place = (s, side) => {                // side -1 = left half, +1 = right half (mirrored); lower arch flips vertically
    let q = frame(s);
    if (side > 0) q = { x: -q.x, y: q.y, nx: -q.nx, ny: q.ny };
    if (lower) q = { x: q.x, y: -q.y, nx: q.nx, ny: -q.ny };
    return q;
  };

  const teeth = [], contacts = [];
  const toothShape = (n, side) => {
    const s0 = S(n - 1) + GAP / 2, s1 = S(n) - GAP / 2, th = THK[n - 1] * k;
    const form = TOOTH_FORMS[lower ? "L" : "U"][n - 1];
    const warp = p => {                       // slot coordinates → diagram px
      const F = place(s0 + (p[0] + 1) / 2 * (s1 - s0), side);
      return [F.x - F.nx * p[1] * th, F.y - F.ny * p[1] * th];
    };
    const mid = place((s0 + s1) / 2, side);
    return {
      pts: toothSpline(form.o, true, 8).map(warp),
      lines: form.l.map(l => toothSpline(l, false, 6).map(warp)),
      lx: mid.x - mid.nx * th * 0.5, ly: mid.y - mid.ny * th * 0.5
    };
  };
  for (let n = 7; n >= 1; n--) teeth.push(Object.assign({ n }, toothShape(n, -1)));   // 7..1 on the patient's right
  for (let n = 1; n <= 7; n++) teeth.push(Object.assign({ n }, toothShape(n, 1)));    // 1..7 on the patient's left

  // 13 contacts: 0–5 right side, 6 midline, 7–12 left side (same order as the contact keys)
  for (let i = 0; i < 13; i++) {
    let s, side;
    if (i <= 5) { side = -1; s = S(7 - i - 1); }
    else if (i === 6) { side = -1; s = 0; }
    else { side = 1; s = S(i - 6); }
    const F = place(s, side);
    const at = d => [F.x + F.nx * d, F.y + F.ny * d];
    contacts.push({
      i, chip: at(CHIP), pill: at(PILL), stem: [at(3), at(CHIP - 20)], bt: at(2),
      btRot: Math.round(Math.atan2(-F.ny, -F.nx) * 180 / Math.PI - 90) || 0
    });
  }
  const endL = place(LT, -1), endR = place(LT, 1), dirY = lower ? -1 : 1;
  const quad = { l: [endL.x + 22, endL.y + dirY * 30], r: [endR.x - 22, endR.y + dirY * 30] };
  const center = [0, (lower ? -1 : 1) * Y * 0.56];

  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const grow = (x, y, r) => { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); };
  teeth.forEach(t => t.pts.forEach(p => grow(p[0], p[1], 0)));
  contacts.forEach(c => { grow(c.chip[0], c.chip[1], 19); grow(c.pill[0], c.pill[1], 13); });
  grow(quad.l[0], quad.l[1], 12); grow(quad.r[0], quad.r[1], 12);
  return { teeth, contacts, quad, center, x0, y0, x1, y1, MARGIN, f1 };
}
// Both arches share one box size (so the two diagrams scale identically); content is centred in it.
// Each tooth carries d (its outline) and a (its anatomy lines, drawn faintly over it).
function archGeometry(lower) {
  if (!ARCH_CACHE.U) {
    const raws = [archBuildRaw(false), archBuildRaw(true)];
    const W = Math.round(Math.max(...raws.map(r => r.x1 - r.x0)) + 2 * raws[0].MARGIN);
    const H = Math.round(Math.max(...raws.map(r => r.y1 - r.y0)) + 2 * raws[0].MARGIN);
    [false, true].forEach((isLower, idx) => {
      const r = raws[idx], f1 = r.f1;
      const dx = (W - (r.x1 - r.x0)) / 2 - r.x0, dy = r.MARGIN - r.y0;
      const sh = p => [f1(p[0] + dx), f1(p[1] + dy)];
      const poly = list => list.map(sh).map(p => p[0] + " " + p[1]).join("L");
      ARCH_CACHE[isLower ? "L" : "U"] = {
        W, H,
        teeth: r.teeth.map(t => ({ n: t.n, d: "M" + poly(t.pts) + "Z", a: t.lines.map(l => "M" + poly(l)).join(""), lx: f1(t.lx + dx), ly: f1(t.ly + dy) })),
        contacts: r.contacts.map(c => ({ i: c.i, chip: sh(c.chip), pill: sh(c.pill), stem: c.stem.map(sh), bt: sh(c.bt), btRot: c.btRot })),
        quad: { l: sh(r.quad.l), r: sh(r.quad.r) },
        center: [W / 2, f1(r.center[1] + dy)]
      };
    });
  }
  return ARCH_CACHE[lower ? "L" : "U"];
}

// Faint anatomy lines inside each tooth — inline style, so the app's tooth CSS (and the bare print
// window) draw them identically and picking/hover states never restyle them.
const TOOTH_ANATOMY = { fill: "none", stroke: "#b8c2d0", strokeWidth: 1.1, strokeLinecap: "round", strokeLinejoin: "round", strokeDasharray: "none" };

// ─── UI helpers ───────────────────────────────────────────────────────────────
const el = React.createElement;
const cn = (...a) => a.filter(Boolean).join(" ");
// 24×24 stroke icons (drawn, not emoji, so they look the same on every device)
const ICON_PATHS = {
  plus: ["M12 5v14M5 12h14"],
  print: ["M6 9V3h12v6", "M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2", "M7 14h10v7H7z"],
  more: ["M5 12h.01M12 12h.01M19 12h.01"],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-4-4"],
  userPlus: ["M15 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1", "M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M19 8v6M16 11h6"],
  users: ["M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1", "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M22 20v-1a4 4 0 0 0-3-3.9", "M16 4.1a3.5 3.5 0 0 1 0 6.8"],
  eraser: ["m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21", "M22 21H7", "m5 11 9 9"],
  x: ["M18 6 6 18M6 6l12 12"],
  keyboard: ["M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M9 15.5h6"],
  lock: ["M7 11V8a5 5 0 0 1 10 0v3", "M5 11h14v9H5z"],
  check: ["M20 6 9 17l-5-5"],
  chart: ["M5 20V11M12 20V4M19 20v-6"],
  copy: ["M9 9h11v11H9z", "M5 15H4V4h11v1"],
  back: ["M19 12H5M12 19l-7-7 7-7"],
  download: ["M12 3v12M7 10l5 5 5-5M5 21h14"],
  file: ["M14 3H6v18h12V7z", "M14 3v4h4"],
  reset: ["M3 12a9 9 0 1 0 3-6.7", "M3 4v5h5"],
  trash: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13"],
  alert: ["M12 9v4M12 17h.01", "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"]
};
function Icon({ name, size }) {
  const s = size || 18;
  return el("svg", { width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: name === "more" ? 3.4 : 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false" },
    ICON_PATHS[name].map((d, i) => el("path", { key: i, d })));
}

// Small filled triangle used for "black triangle" markers in text
function TriMark({ size }) {
  return el("svg", { width: size || 11, height: size || 11, viewBox: "0 0 12 12", "aria-hidden": "true", focusable: "false" }, el("path", { d: "M1 2.5h10L6 10.5z", fill: "currentColor" }));
}

// Scales its content (drawn at a fixed native size w×h) to the width it is given, never beyond `max`.
// A zero-height sentinel is what we observe, so resizing our own height can't re-trigger the observer.
function FitBox({ w, h, max, children }) {
  const meas = React.useRef(null);
  const [fit, setFit] = React.useState({ s: 1, ox: 0 });
  React.useLayoutEffect(() => {
    const node = meas.current;
    if (!node) return;
    const measure = () => {
      const cw = node.clientWidth;
      if (!cw) return;
      const s = Math.min(max || 1, cw / w);
      const ox = Math.max(0, (cw - w * s) / 2);
      setFit(prev => (Math.abs(prev.s - s) < 0.002 && Math.abs(prev.ox - ox) < 0.5) ? prev : { s, ox });
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [w, h, max]);
  return el("div", { className: "ip-fit", style: { height: Math.ceil(h * fit.s) } },
    el("div", { ref: meas, style: { position: "absolute", left: 0, right: 0, top: 0, height: 0, visibility: "hidden", pointerEvents: "none" } }),
    el("div", { className: "ip-stage", style: { width: w, height: h, transform: `translate(${fit.ox}px,0) scale(${fit.s})` } }, children));
}

// ─── Arch diagram ─────────────────────────────────────────────────────────────
// One arch, occlusal view. mode "ipr" shows IPR amounts (and earlier-visit pills); mode "spaces"
// shows residual spacing plus a black-triangle toggle at every contact.
//   vals / bt         contact maps keyed "UR3|UR2" (canonical anatomical order)
//   chipAmt           palette selection: amount string | "erase" | "missing" | null (typing)
//   onVal(key, v)     amount changed          onBT(key, bool)   black triangle toggled
//   onToggleMissing   tooth marked/unmarked   cumRef            IPR from earlier visits (ipr mode)
function ArchDiagram(p) {
  const lower = !!p.lower, isSp = p.mode === "spaces", readOnly = !!p.readOnly;
  const g = archGeometry(lower);
  const arr = lower ? LOWER : UPPER;
  const vals = p.vals || {}, bt = p.bt || {}, missing = p.missing || {};
  const chipAmt = p.chipAmt;
  const missingMode = chipAmt === "missing" && !readOnly && !!p.onToggleMissing;
  const tapMode = !readOnly && chipAmt !== undefined && chipAmt !== null && chipAmt !== "missing";
  const adj = i => !!(missing[arr[i]] || missing[arr[i + 1]]);
  const keyOf = i => arr[i] + "|" + arr[i + 1];       // position-derived — never trust object key order
  const total = sumContacts(vals);
  const btCount = Object.values(bt).filter(Boolean).length;
  const prevTotal = p.cumRef ? sumContacts(p.cumRef) : 0;
  const title = p.title || (lower ? "Lower arch" : "Upper arch");
  const R = 19, cx = g.center[0], cy = g.center[1];
  const tidy = k => k.replace("|", " → ");
  // Palette tap on a contact box: fill with the chosen amount (tap again to clear), or erase.
  const paletteTap = (e, k, val) => {
    if (readOnly || chipAmt === undefined || chipAmt === null || chipAmt === "missing") return;
    e.preventDefault();                                   // keep focus off the box so no keyboard pops up
    if (chipAmt === "erase") { p.onVal(k, ""); return; }
    p.onVal(k, val === chipAmt ? "" : chipAmt);
  };

  const svg = el("svg", { key: "svg", className: "ip-svg", width: g.W, height: g.H, viewBox: `0 0 ${g.W} ${g.H}` },
    g.contacts.map((c, i) => el("line", {
      key: "s" + i, x1: c.stem[0][0], y1: c.stem[0][1], x2: c.stem[1][0], y2: c.stem[1][1],
      className: cn("ip-stem", parseFloat(vals[keyOf(i)]) > 0 && "on", adj(i) && "off")
    })),
    g.teeth.map((t, i) => {
      const name = arr[i], isMiss = !!missing[name];
      const props = { key: name, className: cn("ip-tooth", isMiss && "missing", missingMode && "pick") };
      if (missingMode) {
        props.role = "button"; props.tabIndex = 0;
        props["aria-label"] = name + (isMiss ? " is missing. Tap to restore." : ". Tap to mark missing.");
        props.onClick = () => p.onToggleMissing(name);
        props.onKeyDown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); p.onToggleMissing(name); } };
      }
      return el("g", props,
        el("title", null, isMiss ? name + " — missing" : name),
        el("path", { d: t.d }),
        !isMiss && t.a && el("path", { d: t.a, style: TOOTH_ANATOMY }),
        el("text", { x: t.lx, y: t.ly }, isMiss ? "×" : t.n));
    }),
    el("text", { key: "ql", className: "ip-quad", x: g.quad.l[0], y: g.quad.l[1] }, lower ? "LR" : "UR"),
    el("text", { key: "qr", className: "ip-quad", x: g.quad.r[0], y: g.quad.r[1] }, lower ? "LL" : "UL"),
    el("text", { key: "lab", className: "ip-sum-lab", x: cx, y: cy - 36 }, title),
    el("text", { key: "num", className: cn("ip-sum-num", total <= 0 && "zero"), x: cx, y: cy + 8 }, total.toFixed(1), el("tspan", { dx: 5 }, "mm")),
    isSp
      ? el("text", { key: "sub", className: cn("ip-sum-sub", btCount === 0 && "muted"), x: cx, y: cy + 36 }, btCount > 0 ? btCount + " black triangle" + (btCount > 1 ? "s" : "") : "No black triangles")
      : (prevTotal > 0 ? el("text", { key: "sub", className: "ip-sum-sub", x: cx, y: cy + 36 }, "Earlier visits: " + prevTotal.toFixed(1) + " mm") : null)
  );

  const layer = [];
  g.contacts.forEach((c, i) => {
    const k = keyOf(i), val = vals[k] === undefined || vals[k] === null ? "" : vals[k];
    const has = parseFloat(val) > 0, off = adj(i);
    const common = { "data-contact": k };
    if (isSp) {
      layer.push(el("input", Object.assign({}, common, {
        key: "c" + k, type: "number", min: "0", max: "9.9", step: "0.1", inputMode: "decimal", value: val,
        readOnly, disabled: off, placeholder: "·", title: "Space: " + tidy(k), "aria-label": "Space at " + tidy(k) + " (mm)",
        className: cn("ip-chip", has && "on", tapMode && "tap"),
        style: { left: c.chip[0] - R, top: c.chip[1] - R },
        onMouseDown: e => paletteTap(e, k, val),
        onChange: e => { if (readOnly) return; p.onVal(k, e.target.value); }
      })));
      const on = !!bt[k];
      layer.push(el("button", {
        key: "b" + k, type: "button", className: cn("ip-bt", on && "on"), "data-bt": k, "aria-pressed": on,
        disabled: readOnly || off, title: "Black triangle at " + tidy(k), "aria-label": "Black triangle at " + tidy(k),
        style: { left: c.bt[0] - 13, top: c.bt[1] - 13 },
        onClick: () => { if (readOnly) return; p.onBT(k, !on); }
      }, el("svg", { width: 18, height: 18, viewBox: "-9 -9 18 18", style: { transform: `rotate(${c.btRot}deg)` } }, el("path", { d: "M-6.5 -5.5 L6.5 -5.5 L0 6 Z" }))));
    } else {
      layer.push(el("input", Object.assign({}, common, {
        key: "c" + k, type: "number", min: "0", max: "0.8", step: "0.1", inputMode: "decimal", value: val,
        readOnly, disabled: off, placeholder: "·", title: tidy(k), "aria-label": "IPR at " + tidy(k) + " (mm)",
        className: cn("ip-chip", has && "on", tapMode && "tap"),
        style: { left: c.chip[0] - R, top: c.chip[1] - R },
        onMouseDown: e => paletteTap(e, k, val),
        onChange: e => { if (readOnly) return; p.onVal(k, e.target.value); },
        onBlur: e => {
          if (readOnly) return;
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) {
            if (v < 0) p.onVal(k, "0");
            else if (v > 0.8) p.onVal(k, String(Math.min(v, 0.8).toFixed(1)));
            else p.onVal(k, String(Math.round(v * 10) / 10));
          } else if (e.target.value.trim() === "") {
            p.onVal(k, "");
          }
        }
      })));
      const pv = p.cumRef ? p.cumRef[k] : null;
      if (pv && parseFloat(pv) > 0 && !off) {
        layer.push(el("div", { key: "p" + k, className: "ip-prev", title: "From earlier visits: " + (Math.round(parseFloat(pv) * 10) / 10) + " mm", style: { left: c.pill[0] - 15, top: c.pill[1] - 9 } },
          String(Math.round(parseFloat(pv) * 10) / 10)));
      }
    }
  });

  return el("section", { className: cn("ip-arch", isSp && "ip-sp", missingMode && "picking"), "data-arch": lower ? "lower" : "upper", "aria-label": title },
    el(FitBox, { w: g.W, h: g.H, max: p.max || 1.25 }, [svg].concat(layer)));
}

// ─── One-click amount palette ─────────────────────────────────────────────────
const CHIP_AMOUNTS = ["0.1", "0.2", "0.3", "0.4", "0.5"];
const SPACE_CHIP_AMOUNTS = ["0.1", "0.2", "0.3", "0.5", "1.0", "1.5", "2.0"];
function AmountPalette({ chipAmt, setChipAmt, compact, amounts, spaces }) {
  const hint = chipAmt === "missing" ? "Tap a tooth to mark it missing. Tap it again to restore."
    : chipAmt === "erase" ? "Eraser on: tap a contact to clear it."
    : chipAmt === null ? "Typing mode: tap a contact, then type the amount."
    : "Tap contacts to enter " + chipAmt + " mm. Tap a filled contact again to clear it.";
  return el("div", { className: cn("ip-palette", compact && "compact", spaces && "sp"), role: "toolbar", "aria-label": "Amount palette" },
    el("span", { className: "ip-pal-label" }, "Amount (mm)"),
    el("div", { className: "ip-amts" }, (amounts || CHIP_AMOUNTS).map(a =>
      el("button", { key: a, type: "button", className: cn("ip-amt", chipAmt === a && "active"), "aria-pressed": chipAmt === a, onClick: () => setChipAmt(a) }, a))),
    el("span", { className: "ip-pal-sep" }),
    el("button", { type: "button", className: cn("ip-tool erase", chipAmt === "erase" && "active"), "aria-pressed": chipAmt === "erase", onClick: () => setChipAmt("erase"), title: "Clear contacts by tapping them" }, el(Icon, { name: "eraser", size: 18 }), "Erase"),
    el("button", { type: "button", className: cn("ip-tool missing", chipAmt === "missing" && "active"), "aria-pressed": chipAmt === "missing", onClick: () => setChipAmt("missing"), title: "Mark or unmark missing teeth" }, el(Icon, { name: "x", size: 18 }), "Missing"),
    el("button", { type: "button", className: cn("ip-tool type", chipAmt === null && "active"), "aria-pressed": chipAmt === null, onClick: () => setChipAmt(null), title: "Turn tap-to-fill off and type values manually" }, el(Icon, { name: "keyboard", size: 18 }), "Type"),
    el("span", { className: "ip-pal-hint" }, hint));
}

// ─── Recent patients: their record ids on this computer — nothing that names anyone (IPR Tracker 3 kept chart #s and initials) ───
const RECENT_KEY = "ipr_recent_ids";
function recentIds() { try { const ids = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); return Array.isArray(ids) ? ids.filter(x => typeof x === "string") : []; } catch (e) { return []; } }
function getRecentPatients() { return recentIds().map(id => IP.patient(id)).filter(p => p && !p.locked).slice(0, 8); }
function pushRecentPatient(p) {
  if (!p || !p.id) return;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([p.id].concat(recentIds().filter(x => x !== p.id)).slice(0, 8))); } catch (e) {}
}

// ─── Natural language IPR parser (Palmer notation) ───────────────────────────
// Notation: a-b means Right side tooth a → Left side tooth b (across midline)
//   "U3-3" or "upper 3-3" = UR3→UL3 (canine to canine, 5 contacts incl. midline)
//   "UR4-2" = UR4→UR2 (quadrant-specific, stays on right side, 2 contacts)
//   "0.3 lower 3-3" = LR3→LL3 (lower canine to canine)
function parseIPRCommand(text, upperContacts, lowerContacts) {
  const t = text.toLowerCase().trim();
  const UP_T = ["UR7","UR6","UR5","UR4","UR3","UR2","UR1","UL1","UL2","UL3","UL4","UL5","UL6","UL7"];
  const LO_T = ["LR7","LR6","LR5","LR4","LR3","LR2","LR1","LL1","LL2","LL3","LL4","LL5","LL6","LL7"];

  // Extract amount (first decimal/integer)
  const amountMatch = t.match(/(\d*\.?\d+)/);
  if (!amountMatch) return { error: "No amount found — try: 0.3 upper 3-3" };
  const amount = parseFloat(amountMatch[1]);
  if (isNaN(amount) || amount < 0 || amount > 0.8) return { error: "Amount must be 0–0.8 mm" };

  // 1) Quadrant-specific: ur4-2, ul3-5, lr5-3, ll2-4
  const quadMatch = t.match(/\b(ur|ul|lr|ll)\s*(\d+)\s*[-–]\s*(\d+)/);
  // 2) Arch + range: upper 3-3, u3-3, lower 5-4, l3-3
  const archMatch = !quadMatch && t.match(/\b(upper|lower|up|low|u|l)\s*(\d+)\s*[-–]\s*(\d+)/);
  // 3) Plain range at end: just "3-3"
  const plainMatch = !quadMatch && !archMatch && t.match(/(\d+)\s*[-–]\s*(\d+)\s*$/);
  // 4) Single tooth
  const singleMatch = !quadMatch && !archMatch && !plainMatch && t.match(/(\d+)\s*$/);

  // Determine arches
  let wantsUpper = /\b(upper|up)\b/.test(t);
  let wantsLower = /\b(lower|low)\b/.test(t);
  if (quadMatch) {
    wantsUpper = quadMatch[1].startsWith("u");
    wantsLower = quadMatch[1].startsWith("l");
  } else if (archMatch) {
    if (archMatch[1].startsWith("u")) wantsUpper = true;
    if (archMatch[1].startsWith("l")) wantsLower = true;
  }
  const applyUpper = wantsUpper || (!wantsUpper && !wantsLower);
  const applyLower = wantsLower || (!wantsUpper && !wantsLower);

  // Position-based range: right-a → left-b across the midline
  function archRange(teeth, contacts, a, b) {
    const rPfx = teeth[0].replace(/\d+/, "");
    const lPfx = teeth[teeth.length - 1].replace(/\d+/, "");
    const fromIdx = teeth.indexOf(rPfx + a);
    const toIdx = teeth.indexOf(lPfx + b);
    if (fromIdx < 0 || toIdx < 0 || fromIdx >= toIdx) return [];
    return Object.keys(contacts).slice(fromIdx, toIdx);
  }

  // Quadrant range: stays on one side (e.g. UR4-2 = UR4|UR3, UR3|UR2)
  function quadRange(contacts, quad, a, b) {
    const pfx = quad.toUpperCase();
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return Object.keys(contacts).filter(k => {
      const parts = k.split("|");
      if (!parts.every(p => p.startsWith(pfx))) return false;
      const nums = k.match(/\d+/g).map(Number);
      return nums.every(n => n >= lo && n <= hi);
    });
  }

  const upperChanges = {}, lowerChanges = {};
  let affected = 0;

  if (quadMatch) {
    const quad = quadMatch[1], a = parseInt(quadMatch[2]), b = parseInt(quadMatch[3]);
    const isUp = quad.startsWith("u");
    const contacts = isUp ? upperContacts : lowerContacts;
    const changes = isUp ? upperChanges : lowerChanges;
    const ks = quadRange(contacts, quad, a, b);
    ks.forEach(k => { changes[k] = String(amount); });
    affected += ks.length;
  } else if (archMatch || plainMatch) {
    const m = archMatch || plainMatch;
    const a = parseInt(archMatch ? m[2] : m[1]);
    const b = parseInt(archMatch ? m[3] : m[2]);
    if (applyUpper) {
      const ks = archRange(UP_T, upperContacts, a, b);
      ks.forEach(k => { upperChanges[k] = String(amount); });
      affected += ks.length;
    }
    if (applyLower) {
      const ks = archRange(LO_T, lowerContacts, a, b);
      ks.forEach(k => { lowerChanges[k] = String(amount); });
      affected += ks.length;
    }
  } else if (singleMatch) {
    const n = parseInt(singleMatch[1]);
    function adjContacts(contacts) {
      return Object.keys(contacts).filter(k => k.match(/\d+/g).map(Number).includes(n));
    }
    if (applyUpper) {
      const ks = adjContacts(upperContacts);
      ks.forEach(k => { upperChanges[k] = String(amount); });
      affected += ks.length;
    }
    if (applyLower) {
      const ks = adjContacts(lowerContacts);
      ks.forEach(k => { lowerChanges[k] = String(amount); });
      affected += ks.length;
    }
  } else {
    // No range — apply to all contacts on specified arch(es)
    if (applyUpper) {
      Object.keys(upperContacts).forEach(k => { upperChanges[k] = String(amount); });
      affected += Object.keys(upperContacts).length;
    }
    if (applyLower) {
      Object.keys(lowerContacts).forEach(k => { lowerChanges[k] = String(amount); });
      affected += Object.keys(lowerContacts).length;
    }
  }

  if (affected === 0) return { error: "No matching contacts found — check tooth numbers (1–7)" };
  const archLabel = applyUpper && applyLower ? "upper & lower" : applyUpper ? "upper" : "lower";
  return {
    upperChanges,
    lowerChanges,
    message: `Set ${amount} mm at ${affected} contact${affected > 1 ? "s" : ""} (${archLabel})`
  };
}

// ─── Helpers for IPR colour thresholds (module-level so no closure issues) ────
function iprIsAnterior(key) {
  const nums = key.match(/\d+/g).map(Number);
  return Math.max(...nums) <= 3;
}
function iprBarColor(key, val) {
  if (!val || val <= 0) return "#e2e8f0";
  if (iprIsAnterior(key)) {
    if (val <= 0.5) return "#22c55e";
    if (val <= 0.8) return "#f97316";
    return "#ef4444";
  } else {
    if (val <= 0.8) return "#22c55e";
    if (val <= 1.0) return "#f97316";
    return "#ef4444";
  }
}
function iprContactLabel(key) {
  return key.split("|").map(t => t.replace(/[A-Z]/g, "")).join("-");
}

// ─── Cumulative IPR chart (modal) ─────────────────────────────────────────────
// Bars per contact across all visits, coloured against the safe-limit thresholds
// (anterior 0.5 / 0.8 mm, posterior 0.8 / 1.0 mm — see iprBarColor).
const CUM_LEVEL = { "#22c55e": "#2f9e6e", "#f97316": "#e08a1e", "#ef4444": "#d64545" };
function CumulativeChart({ cumUpper, cumLower, visitCount, onClose }) {
  const allVals = [...Object.values(cumUpper), ...Object.values(cumLower)].map(v => parseFloat(v) || 0);
  const maxVal = Math.max(...allVals, 0.5);
  const BAR_W = 34, GAP = 7, CHART_H = 136, LABEL_H = 38, PAD = 12, TOP = 18;
  const SVG_W = Object.keys(cumUpper).length * (BAR_W + GAP) - GAP + PAD * 2;
  React.useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const scale = v => v / maxVal * (CHART_H - TOP);
  const renderArch = (contacts, label) => {
    const keys = Object.keys(contacts);
    const total = sumContacts(contacts);
    const bars = keys.map((key, i) => {
      const val = parseFloat(contacts[key]) || 0;
      const x = PAD + i * (BAR_W + GAP), cxm = x + BAR_W / 2;
      const color = CUM_LEVEL[iprBarColor(key, val)] || "#cbd5e1";
      const barH = val > 0 ? Math.max(5, scale(val)) : 0, y = CHART_H - barH;
      const limitY = CHART_H - scale(iprIsAnterior(key) ? 0.5 : 0.8);
      const isMid = i === 6, r = Math.min(6, barH / 2);
      return el("g", { key },
        isMid && el("line", { x1: cxm, y1: 2, x2: cxm, y2: CHART_H, stroke: "#dde3ec", strokeWidth: 1, strokeDasharray: "3 3" }),
        el("line", { x1: x - 1, y1: limitY, x2: x + BAR_W + 1, y2: limitY, stroke: "#8d9bb0", strokeWidth: 1, strokeDasharray: "3 3", opacity: 0.8 }),
        val > 0 && el("path", { d: `M${x} ${CHART_H}V${y + r}a${r} ${r} 0 0 1 ${r} ${-r}h${BAR_W - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}V${CHART_H}Z`, fill: color }),
        val > 0 && el("text", { x: cxm, y: y - 5, textAnchor: "middle", fontSize: 11.5, fontWeight: 700, fill: color }, val.toFixed(1)),
        el("text", { x: cxm, y: CHART_H + 16, textAnchor: "middle", fontSize: 11, fontWeight: isMid ? 700 : 500, fill: isMid ? "#46566e" : "#74849b" }, iprContactLabel(key)),
        isMid && el("text", { x: cxm, y: CHART_H + 30, textAnchor: "middle", fontSize: 10, fill: "#a3afc0" }, "midline"));
    });
    return el("div", { className: "ip-cum-arch" },
      el("div", { className: "h" }, label, el("span", null, total.toFixed(1), " mm total")),
      el("div", { className: "ip-cum-scroll" },
        el("svg", { width: SVG_W, height: CHART_H + LABEL_H, style: { display: "block", minWidth: SVG_W, fontFamily: "var(--font)" } },
          el("line", { x1: 0, y1: CHART_H, x2: SVG_W, y2: CHART_H, stroke: "#c9d2df", strokeWidth: 1.5 }), bars)));
  };
  return el("div", { className: "ip-overlay", style: { zIndex: 1000 }, onClick: onClose, role: "dialog", "aria-modal": "true", "aria-label": "Cumulative IPR by site" },
    el("div", { className: "ip-dialog ip-cum-modal", onClick: e => e.stopPropagation() },
      el("div", { className: "ip-cum-head" },
        el("div", null,
          el("h2", { className: "ip-dlg-h", style: { marginBottom: 2 } }, "Cumulative IPR by site"),
          el("p", { className: "ip-hint", style: { fontSize: 13, color: "var(--ink-3)" } }, "IPR only · ", visitCount === 1 ? "this visit" : "all " + visitCount + " visits", " · Palmer notation · mm")),
        el("button", { type: "button", className: "ip-btn quiet icon", onClick: onClose, "aria-label": "Close" }, el(Icon, { name: "x", size: 20 }))),
      el("div", { className: "ip-cum-legend" },
        [["#2f9e6e", "Safe"], ["#e08a1e", "Caution"], ["#d64545", "Exceeds limit"]].map(([c, l]) => el("span", { key: l }, el("i", { style: { background: c } }), l)),
        el("small", null, "Front teeth (1–3): 0.5 / 0.8 mm · Back teeth (4–7): 0.8 / 1.0 mm · dashed line = safe limit")),
      renderArch(cumUpper, "Upper arch"),
      renderArch(cumLower, "Lower arch"),
      el("div", { className: "ip-cum-foot2" },
        el("span", null, "Upper ", el("b", null, sumContacts(cumUpper).toFixed(1), " mm")),
        el("span", null, "Lower ", el("b", null, sumContacts(cumLower).toFixed(1), " mm")),
        el("span", null, "Grand total ", el("b", null, (sumContacts(cumUpper) + sumContacts(cumLower)).toFixed(1), " mm")))));
}

// ─── Printed arch diagram ─────────────────────────────────────────────────────
// The printed form draws exactly the arch the app shows (ArchDiagram): the same geometry from
// archGeometry(), the same tooth outlines, contact circles, colours and type sizes, so a paper form
// filled in chairside reads just like the screen it gets typed into. Everything is plain SVG with its
// styling written inline, because the print preview copies this markup into a bare window that has
// none of the app's stylesheet.
//   mode "ipr" | "spaces"     vals / bt / missing / cumRef as in ArchDiagram (cumRef = earlier visits)
//   blank                     empty write-in form: no amounts, no missing teeth, no total in the middle
const PRINT_ARCH_FONT = '"Figtree",system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif';
// viewBox for a printed arch. Filled forms use the app's own box (it leaves room for the earlier-visit
// tags); a blank form never has tags, so it crops to the teeth and circles and both arches print larger.
// Upper and lower always share one box size, so they print at the same scale.
const PRINT_ARCH_BOX = {};
function printArchBox(lower, tight) {
  const g = archGeometry(lower);
  if (!tight) return "0 0 " + g.W + " " + g.H;
  if (!PRINT_ARCH_BOX.U) {
    const bounds = [false, true].map(isLower => {
      const a = archGeometry(isLower);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      const grow = (x, y, r) => { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); };
      a.contacts.forEach(c => grow(c.chip[0], c.chip[1], 20));
      a.teeth.forEach(t => t.d.slice(1, -1).split("L").forEach(pt => { const xy = pt.split(" "); grow(+xy[0], +xy[1], 1); }));
      [a.quad.l, a.quad.r].forEach(q => grow(q[0], q[1] - 5, 12));
      return { x0, y0, x1, y1 };
    });
    const w = Math.ceil(Math.max(...bounds.map(b => b.x1 - b.x0))) + 8;
    const h = Math.ceil(Math.max(...bounds.map(b => b.y1 - b.y0))) + 8;
    bounds.forEach((b, i) => {
      PRINT_ARCH_BOX[i ? "L" : "U"] = [Math.round((b.x0 + b.x1 - w) / 2), Math.round((b.y0 + b.y1 - h) / 2), w, h].join(" ");
    });
  }
  return PRINT_ARCH_BOX[lower ? "L" : "U"];
}
function PrintArch(p) {
  const lower = !!p.lower, isSp = p.mode === "spaces", blank = !!p.blank;
  const g = archGeometry(lower);
  const arr = lower ? LOWER : UPPER;
  const vals = blank ? {} : p.vals || {};
  const bt = blank ? {} : p.bt || {};
  const missing = blank ? {} : p.missing || {};
  const ref = blank || isSp ? null : p.cumRef;
  const adj = i => !!(missing[arr[i]] || missing[arr[i + 1]]);
  const keyOf = i => arr[i] + "|" + arr[i + 1];       // position-derived, as in ArchDiagram
  const fillOn = isSp ? "#0b7f8a" : "#2459d6";         // the app's teal / blue for a contact with an amount
  const total = sumContacts(vals);
  const btCount = Object.values(bt).filter(Boolean).length;
  const prevTotal = ref ? sumContacts(ref) : 0;
  const title = lower ? "Lower arch" : "Upper arch";
  const cx = g.center[0], cy = g.center[1];
  const tab = { fontVariantNumeric: "tabular-nums" };
  const shown = v => (v === undefined || v === null || v === "" || isNaN(parseFloat(v))) ? "" : String(v);
  const out = [];

  // stems from each contact out to its circle
  g.contacts.forEach((c, i) => {
    const has = parseFloat(vals[keyOf(i)]) > 0, off = adj(i);
    out.push(el("line", {
      key: "s" + i, x1: c.stem[0][0], y1: c.stem[0][1], x2: c.stem[1][0], y2: c.stem[1][1],
      stroke: has ? fillOn : "#d3dbe6", strokeWidth: 1.5, strokeLinecap: "round",
      opacity: off ? 0.35 : undefined, strokeDasharray: off ? "2 4" : undefined
    }));
  });
  // teeth; a missing tooth is dashed with an ×, as on screen
  g.teeth.forEach((t, i) => {
    const miss = !!missing[arr[i]];
    out.push(el("g", { key: "t" + i },
      el("path", { d: t.d, fill: miss ? "#f4f6f9" : "#fff", stroke: miss ? "#b9c3d1" : "#a7b4c6", strokeWidth: 1.4, strokeLinejoin: "round", strokeDasharray: miss ? "4 3.5" : undefined }),
      !miss && t.a && el("path", { d: t.a, style: TOOTH_ANATOMY }),
      el("text", { x: t.lx, y: t.ly, textAnchor: "middle", dominantBaseline: "central", fontSize: miss ? 19 : 13, fontWeight: miss ? 500 : 600, fill: miss ? "#97a4b7" : "#6b7b92",
        stroke: miss ? "#f4f6f9" : "#fff", strokeWidth: 3, strokeLinejoin: "round", paintOrder: "stroke" }, miss ? "×" : t.n)));
  });
  // quadrant labels
  out.push(el("text", { key: "ql", x: g.quad.l[0], y: g.quad.l[1], textAnchor: "middle", fontSize: 13, fontWeight: 700, fill: "#8d9bb0", letterSpacing: "0.04em" }, lower ? "LR" : "UR"));
  out.push(el("text", { key: "qr", x: g.quad.r[0], y: g.quad.r[1], textAnchor: "middle", fontSize: 13, fontWeight: 700, fill: "#8d9bb0", letterSpacing: "0.04em" }, lower ? "LL" : "UL"));
  // middle of the arch: its name, its total and the line under it (a blank form shows just the name)
  if (blank) {
    out.push(el("text", { key: "lab", x: cx, y: cy, textAnchor: "middle", dominantBaseline: "central", fontSize: 13.5, fontWeight: 600, fill: "#74849b" }, title));
  } else {
    out.push(el("text", { key: "lab", x: cx, y: cy - 36, textAnchor: "middle", fontSize: 13.5, fontWeight: 600, fill: "#74849b" }, title));
    out.push(el("text", { key: "num", x: cx, y: cy + 8, textAnchor: "middle", fontSize: 40, fontWeight: 700, fill: total > 0 ? "#16253b" : "#c3cdda", style: { letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" } },
      total.toFixed(1), el("tspan", { dx: 5, fontSize: 16, fontWeight: 600, fill: "#74849b", style: { letterSpacing: 0 } }, "mm")));
    const sub = isSp ? (btCount > 0 ? btCount + " black triangle" + (btCount > 1 ? "s" : "") : "No black triangles")
      : (prevTotal > 0 ? "Earlier visits: " + prevTotal.toFixed(1) + " mm" : "");
    if (sub) out.push(el("text", { key: "sub", x: cx, y: cy + 36, textAnchor: "middle", fontSize: 13, fontWeight: 600, fill: isSp && btCount === 0 ? "#74849b" : "#6a3fd0" }, sub));
  }
  // contact circles, then the black-triangle marker (spaces) or the earlier-visit tag (IPR) at each contact
  g.contacts.forEach((c, i) => {
    const k = keyOf(i), v = shown(vals[k]), has = parseFloat(v) > 0, off = adj(i);
    out.push(el("g", { key: "c" + i, opacity: off ? 0.28 : undefined },
      el("circle", { cx: c.chip[0], cy: c.chip[1], r: 18.25, fill: has ? fillOn : "#fff", stroke: has ? fillOn : "#cdd5e1", strokeWidth: 1.5 }),
      v && el("text", { x: c.chip[0], y: c.chip[1], textAnchor: "middle", dominantBaseline: "central", fontSize: 14, fontWeight: 700, fill: has ? "#fff" : "#16253b", style: tab }, v)));
    if (isSp) {
      const on = !!bt[k];
      out.push(el("path", {
        key: "b" + i, d: "M-6.5 -5.5 L6.5 -5.5 L0 6 Z", transform: `translate(${c.bt[0]} ${c.bt[1]}) rotate(${c.btRot})`,
        fill: on ? "#111827" : "none", stroke: on ? "#111827" : "#b9c4d3", strokeWidth: 1.5, strokeLinejoin: "round",
        opacity: off ? 0.35 : undefined
      }));
    } else if (ref) {
      const pv = parseFloat(ref[k]);
      if (pv > 0 && !off) out.push(el("g", { key: "p" + i },
        el("rect", { x: c.pill[0] - 14.5, y: c.pill[1] - 8.5, width: 29, height: 17, rx: 8.5, fill: "#f1ecfd", stroke: "#dacffa", strokeWidth: 1 }),
        el("text", { x: c.pill[0], y: c.pill[1], textAnchor: "middle", dominantBaseline: "central", fontSize: 11, fontWeight: 700, fill: "#6a3fd0", style: tab }, String(Math.round(pv * 10) / 10))));
    }
  });
  return el("svg", {
    viewBox: printArchBox(lower, blank), width: "100%", role: "img", "aria-label": title,
    style: { display: "block", width: "100%", height: "auto", overflow: "visible", fontFamily: PRINT_ARCH_FONT }
  }, out);
}
// The printed arches use the app's own font (Figtree, embedded at the top of this file) so their numbers
// look the same on paper as on screen. The preview window has no stylesheet, so the font face is copied in.
function printFontFace() {
  try {
    const styles = document.querySelectorAll("style");
    for (let i = 0; i < styles.length; i++) {
      const m = (styles[i].textContent || "").match(/@font-face\s*\{[^}]*Figtree[^}]*\}/);
      if (m) return m[0];
    }
  } catch (e) {}
  return "";
}

// ─── The print window (Print, Export as PDF, Print blank form) ───
// The printed form with Print and Cancel above it. The page's security rules (one script, by its fingerprint) don't let a
// window run code of its own, so the two buttons are wired from here.
function openPrintWindow(html, primaryLabel, hint) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) { alert("The browser blocked the print window. Allow pop-ups for this page and try again."); return null; }
  w.document.write('<!DOCTYPE html><html><head><title>IPR Tracker</title><style>' + printFontFace() + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0f172a;margin:0;padding:14px 18px;}@page{margin:12mm 10mm;}.print-toolbar{position:sticky;top:0;z-index:9999;background:#1e293b;padding:10px 20px;display:flex;gap:10px;align-items:center;margin:-14px -18px 16px -18px;}.print-toolbar span{color:#94a3b8;font-size:13px;margin-left:8px;}@media print{.print-toolbar{display:none !important;}}</style></head><body>');
  w.document.write('<div class="print-toolbar"><button type="button" id="ppGo" style="padding:8px 24px;border-radius:6px;border:none;background:#2563eb;color:white;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;">' + primaryLabel + '</button><button type="button" id="ppX" style="padding:8px 24px;border-radius:6px;border:1px solid #475569;background:transparent;color:#cbd5e1;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>' + (hint || "") + '</div>');
  w.document.write(html);
  w.document.write('</body></html>');
  w.document.close();
  const go = w.document.getElementById("ppGo"), x = w.document.getElementById("ppX");
  if (go) go.addEventListener("click", () => w.print());
  if (x) x.addEventListener("click", () => w.close());
  return w;
}

// ─── Print Chart ──────────────────────────────────────────────────────────────
// The printed form (Print, Export PDF and Print blank form). Its two sections show what the app's two
// tabs show, drawn with PrintArch: the IPR section has this visit's amounts in the circles and earlier
// visits in the small violet tags (IPR tab); the spaces section has residual spaces and black triangles
// (Spaces tab). Upper and lower sit side by side as they do on a computer screen.
const PRINT_ARCH_CARD = { flex: "1 1 0", minWidth: 0, border: "1px solid #e3e8ef", borderRadius: 12, padding: "4px 2px", background: "#fff" };
const PRINT_SECTION = { marginBottom: 14, breakInside: "avoid", pageBreakInside: "avoid" };
const PRINT_TOTALS = { display: "flex", gap: 20, marginTop: 5, fontSize: 10, color: "#334155" };
function PrintChart({
  upper,
  lower,
  patient,
  notes,
  gaugeVerified,
  upperSpaces,
  lowerSpaces,
  upperBT,
  lowerBT,
  blank,
  cumUpper,
  cumLower,
  visitCount,
  missing,
  prevUpper,
  prevLower
}) {
  // When blank mode, zero out all data so we get an empty chart
  if (blank) {
    upper = initContacts(UPPER);
    lower = initContacts(LOWER);
    upperSpaces = initContacts(UPPER);
    lowerSpaces = initContacts(LOWER);
    upperBT = initBT(UPPER);
    lowerBT = initBT(LOWER);
    cumUpper = null;
    cumLower = null;
    prevUpper = null;
    prevLower = null;
    missing = {};
    notes = "";
    gaugeVerified = false;
  }
  const upperTotal = sumContacts(upper);
  const lowerTotal = sumContacts(lower);
  const cumUpperTotal = cumUpper ? sumContacts(cumUpper) : 0;
  const cumLowerTotal = cumLower ? sumContacts(cumLower) : 0;
  const showCum = cumUpper && visitCount > 1;
  const upperSpacesTotal = sumContacts(upperSpaces);
  const lowerSpacesTotal = sumContacts(lowerSpaces);
  const upperBTCount = Object.values(upperBT).filter(Boolean).length;
  const lowerBTCount = Object.values(lowerBT).filter(Boolean).length;
  const hasAnySpaces = upperSpacesTotal > 0 || lowerSpacesTotal > 0 || upperBTCount > 0 || lowerBTCount > 0;
  const hasEarlier = !!((prevUpper && sumContacts(prevUpper) > 0) || (prevLower && sumContacts(prevLower) > 0));
  const archPair = (mode, vU, vL, btU, btL, refU, refL) => el("div", { style: { display: "flex", gap: 10 } },
    el("div", { style: PRINT_ARCH_CARD }, el(PrintArch, { mode, vals: vU, bt: btU, cumRef: refU, missing, blank })),
    el("div", { style: PRINT_ARCH_CARD }, el(PrintArch, { lower: true, mode, vals: vL, bt: btL, cumRef: refL, missing, blank })));
  // legend under each pair of arches, as under the app's arches
  const legend = items => el("div", { style: { display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginTop: 6, fontSize: 9, color: "#64748b" } }, items.filter(Boolean));
  const lgItem = (key, icon, label) => el("span", { key, style: { display: "inline-flex", alignItems: "center", gap: 5 } }, icon, label);
  const lgIcon = (w, h, vb, shape) => el("svg", { width: w, height: h, viewBox: vb, "aria-hidden": "true", style: { display: "block" } }, shape);
  const lgDot = color => lgIcon(9, 9, "0 0 10 10", el("circle", { cx: 5, cy: 5, r: 5, fill: color }));
  const lgRing = lgIcon(11, 11, "0 0 12 12", el("circle", { cx: 6, cy: 6, r: 5.2, fill: "#fff", stroke: "#94a3b8", strokeWidth: 1.2 }));
  const lgPill = lgIcon(16, 10, "0 0 16 10", el("rect", { x: 0.5, y: 0.5, width: 15, height: 9, rx: 4.5, fill: "#f1ecfd", stroke: "#dacffa", strokeWidth: 1 }));
  const lgTri = lgIcon(10, 10, "0 0 12 12", el("path", { d: "M1 2.5h10L6 10.5z", fill: "#111827" }));
  const blankLine = w => el("span", { style: { display: "inline-block", width: w, borderBottom: "1px solid #94a3b8" } }, " ");
  const sectionHeader = (title, subtitle, borderColor) => el("div", {
    style: { fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1, color: borderColor, marginBottom: 6, borderBottom: `1.5px solid ${borderColor}`, paddingBottom: 4, display: "flex", justifyContent: "space-between", alignItems: "baseline" }
  }, el("span", null, title), subtitle && el("span", { style: { fontSize: 9, fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "#64748b" } }, subtitle));
  return el("div", { className: "print-only", style: { fontFamily: "'Segoe UI',system-ui,sans-serif", color: "#0f172a", padding: "14px 18px" } },
    el("div", { style: { paddingBottom: 8, borderBottom: "2px solid #0f172a", marginBottom: 12 } },
      el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" } },
        el("div", null,
          el("div", { style: { fontSize: 16, fontWeight: 800, letterSpacing: -0.5 } }, "IPR Tracker — Dental Charting"),
          el("div", { style: { fontSize: 9, color: "#64748b", marginTop: 2, fontStyle: "italic" } }, blank ? "Blank form — write in IPR amounts" : "IPR completed at this visit — not prescribed amount")),
        el("span", { style: { border: `1.5px solid ${gaugeVerified ? "#22c55e" : "#94a3b8"}`, borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 700, color: gaugeVerified ? "#15803d" : "#94a3b8", whiteSpace: "nowrap" } },
          gaugeVerified ? "✓" : "☐", " Gauge Verified")),
      // the patient: a full name (Amir, 23 Oct 2026: "use the full name of the patients instead of … initials"), the chart #,
      // the date and who assisted — on the blank form, room to write them in
      el("div", { style: { display: "flex", gap: 22, fontSize: 11, alignItems: "baseline", flexWrap: "wrap", marginTop: blank ? 12 : 8 } },
        blank
          ? [["Patient name", 230], ["Chart #", 100], ["Date", 90], ["Asst", 70]].map(([l, w]) => el("span", { key: l }, el("b", null, l + ":"), " ", blankLine(w)))
          : [["Patient", patient.name || (patient.initials ? "Initials " + patient.initials : "—")], ["Chart #", patient.patientId || "—"], ["Date", patient.date || "—"], patient.assistantInitials ? ["Asst", patient.assistantInitials] : null]
              .filter(Boolean).map(([l, v]) => el("span", { key: l }, el("b", null, l + ":"), " ", v)))),
    el("div", { style: PRINT_SECTION },
      sectionHeader(blank ? "Interproximal Reduction" : "This Visit — Interproximal Reduction", null, "#1d4ed8"),
      archPair("ipr", upper, lower, null, null, prevUpper, prevLower),
      legend(blank
        ? [lgItem("w", lgRing, "Write the IPR amount in mm (0.1–0.8) in the circle at each contact")]
        : [lgItem("a", lgDot("#2459d6"), "IPR amount in mm (0.1–0.8)"), hasEarlier && lgItem("e", lgPill, "IPR from earlier visits")]),
      el("div", { style: PRINT_TOTALS },
        blank
          ? el(React.Fragment, null,
            el("span", null, el("b", null, "Upper:"), " ", blankLine(40), " mm"),
            el("span", null, el("b", null, "Lower:"), " ", blankLine(40), " mm"),
            el("span", null, el("b", null, "Total:"), " ", blankLine(40), " mm"))
          : el(React.Fragment, null,
            el("span", null, el("b", null, showCum ? "This visit — Upper:" : "Upper:"), " ", upperTotal.toFixed(1), " mm"),
            el("span", null, el("b", null, "Lower:"), " ", lowerTotal.toFixed(1), " mm"),
            el("span", null, el("b", null, "Total:"), " ", (upperTotal + lowerTotal).toFixed(1), " mm"))),
      showCum && el("div", { style: Object.assign({}, PRINT_TOTALS, { marginTop: 3, color: "#6a3fd0" }) },
        el("span", null, el("b", null, "All " + visitCount + " visits — Upper:"), " ", cumUpperTotal.toFixed(1), " mm"),
        el("span", null, el("b", null, "Lower:"), " ", cumLowerTotal.toFixed(1), " mm"),
        el("span", null, el("b", null, "Total:"), " ", (cumUpperTotal + cumLowerTotal).toFixed(1), " mm"))),
    hasAnySpaces && el("div", { style: PRINT_SECTION },
      sectionHeader("Residual Spaces & Black Triangles", null, "#0369a1"),
      archPair("spaces", upperSpaces, lowerSpaces, upperBT, lowerBT, null, null),
      legend([lgItem("s", lgDot("#0b7f8a"), "Residual space in mm"), lgItem("t", lgTri, "Black triangle")]),
      el("div", { style: PRINT_TOTALS },
        upperSpacesTotal > 0 && el("span", null, el("b", null, "Upper spaces:"), " ", upperSpacesTotal.toFixed(1), " mm"),
        lowerSpacesTotal > 0 && el("span", null, el("b", null, "Lower spaces:"), " ", lowerSpacesTotal.toFixed(1), " mm"),
        upperBTCount > 0 && el("span", null, el("b", null, "Upper BT:"), " ", upperBTCount),
        lowerBTCount > 0 && el("span", null, el("b", null, "Lower BT:"), " ", lowerBTCount))),
    blank
      ? el("div", { style: { marginTop: 10, fontSize: 10, color: "#475569", paddingTop: 8, borderTop: "1px solid #f1f5f9" } },
        el("b", null, "Notes: "),
        el("div", { style: { borderBottom: "1px solid #cbd5e1", height: 18 } }),
        el("div", { style: { borderBottom: "1px solid #cbd5e1", height: 18 } }),
        el("div", { style: { borderBottom: "1px solid #cbd5e1", height: 18 } }))
      : notes && el("div", { style: { marginTop: 10, fontSize: 10, color: "#475569", paddingTop: 8, borderTop: "1px solid #f1f5f9" } }, el("b", null, "Notes: "), notes),
    el("div", { style: { marginTop: 14, paddingTop: 8, borderTop: "1px dashed #cbd5e1", display: "flex", justifyContent: "space-between", alignItems: "center" } },
      el("span", { style: { fontSize: 9, color: "#94a3b8", fontStyle: "italic" } }, "⚠ This form should be scanned into the patient's chart."),
      el("span", { style: { fontSize: 9, color: "#cbd5e1" } }, "IPR Tracker \xB7 Palmer Notation")));
}

// ─── Chart note text ──────────────────────────────────────────────────────────
// Turns this visit's IPR / residual-spacing / black-triangle data into plain text
// that pastes straight into the patient's chart. Contacts are listed in arch
// order (UR7→UL7, LR7→LL7) in Palmer notation, matching the printed form.
const NOTE_DASH = "–"; // en dash — reads as a range and survives paste into chart software
function noteRowsOf(obj) {
  return Object.entries(obj).filter(([, v]) => parseFloat(v) > 0);
}
function noteBTsOf(obj) {
  return Object.entries(obj).filter(([, v]) => v).map(([k]) => k);
}
function mm1(v) {
  return (parseFloat(v) || 0).toFixed(1);
}
// "UR3|UR2" → "UR3–UR2". Compact format passes "-" so it stays ASCII.
function ckLabel(k, dash) {
  return k.split("|").join(dash || NOTE_DASH);
}
// terse drops the "mm" suffix and the leading zero: "0.3mm" → ".3"
function listRows(rows, dash, terse) {
  return rows.map(([k, v]) => terse
    ? `${ckLabel(k, dash)} ${mm1(v).replace(/^0/, "")}`
    : `${ckLabel(k, dash)} ${mm1(v)}mm`).join(", ");
}
function joinAnd(arr) {
  if (arr.length <= 1) return arr.join("");
  if (arr.length === 2) return arr.join(" and ");
  return arr.slice(0, -1).join(", ") + ", and " + arr[arr.length - 1];
}
function buildChartNote(o) {
  const uIPR = noteRowsOf(o.upper), lIPR = noteRowsOf(o.lower);
  const uSp = noteRowsOf(o.upperSpaces), lSp = noteRowsOf(o.lowerSpaces);
  const uBT = noteBTsOf(o.upperBT), lBT = noteBTsOf(o.lowerBT);
  const uIPRt = sumContacts(o.upper), lIPRt = sumContacts(o.lower);
  const uSpt = sumContacts(o.upperSpaces), lSpt = sumContacts(o.lowerSpaces);
  const hasIPR = uIPR.length > 0 || lIPR.length > 0;
  const hasSp = uSp.length > 0 || lSp.length > 0;
  const hasBT = uBT.length > 0 || lBT.length > 0;
  // Cumulative only means something once there is more than one visit on file.
  const showCum = !!(o.incCum && o.cumUpper && o.visitCount > 1);
  const cUt = o.cumUpper ? sumContacts(o.cumUpper) : 0;
  const cLt = o.cumLower ? sumContacts(o.cumLower) : 0;

  if (o.format === "narrative") {
    const parts = [];
    if (o.incIPR) {
      if (hasIPR) {
        const seg = [];
        if (uIPR.length) seg.push(`upper ${listRows(uIPR)} (${mm1(uIPRt)}mm)`);
        if (lIPR.length) seg.push(`lower ${listRows(lIPR)} (${mm1(lIPRt)}mm)`);
        parts.push(`IPR completed this visit: ${seg.join("; ")}; total ${mm1(uIPRt + lIPRt)}mm.`);
      } else {
        parts.push("No IPR performed this visit.");
      }
    }
    if (hasSp) {
      const seg = [];
      if (uSp.length) seg.push(`upper ${listRows(uSp)} (${mm1(uSpt)}mm)`);
      if (lSp.length) seg.push(`lower ${listRows(lSp)} (${mm1(lSpt)}mm)`);
      parts.push(`Residual spacing: ${seg.join("; ")}; total ${mm1(uSpt + lSpt)}mm.`);
    } else {
      parts.push("No residual spacing noted.");
    }
    parts.push(hasBT
      ? `Black triangle${uBT.length + lBT.length > 1 ? "s" : ""} present at ${joinAnd(uBT.concat(lBT).map(k => ckLabel(k)))}.`
      : "No black triangles noted.");
    if (showCum) parts.push(`Cumulative IPR to date (${o.visitCount} visits): upper ${mm1(cUt)}mm, lower ${mm1(cLt)}mm, total ${mm1(cUt + cLt)}mm.`);
    return parts.join(" ");
  }

  if (o.format === "lines") {
    const blocks = [];
    if (o.incIPR) {
      const s = ["IPR THIS VISIT"];
      if (hasIPR) {
        if (uIPR.length) s.push(`Upper: ${listRows(uIPR)} (${mm1(uIPRt)}mm)`);
        if (lIPR.length) s.push(`Lower: ${listRows(lIPR)} (${mm1(lIPRt)}mm)`);
        s.push(`Total: ${mm1(uIPRt + lIPRt)}mm`);
      } else s.push("None this visit");
      blocks.push(s.join("\n"));
    }
    const sp = ["SPACING"];
    if (hasSp) {
      if (uSp.length) sp.push(`Upper: ${listRows(uSp)} (${mm1(uSpt)}mm)`);
      if (lSp.length) sp.push(`Lower: ${listRows(lSp)} (${mm1(lSpt)}mm)`);
      sp.push(`Total: ${mm1(uSpt + lSpt)}mm`);
    } else sp.push("None noted");
    blocks.push(sp.join("\n"));
    const bt = ["BLACK TRIANGLES"];
    if (hasBT) {
      if (uBT.length) bt.push(`Upper: ${uBT.map(k => ckLabel(k)).join(", ")}`);
      if (lBT.length) bt.push(`Lower: ${lBT.map(k => ckLabel(k)).join(", ")}`);
      bt.push(`Total: ${uBT.length + lBT.length}`);
    } else bt.push("None noted");
    blocks.push(bt.join("\n"));
    if (showCum) blocks.push(`CUMULATIVE IPR (${o.visitCount} visits)\nUpper: ${mm1(cUt)}mm   Lower: ${mm1(cLt)}mm   Total: ${mm1(cUt + cLt)}mm`);
    return blocks.join("\n\n");
  }

  // compact
  const c = [];
  if (o.incIPR) {
    if (hasIPR) {
      const seg = [];
      if (uIPR.length) seg.push(`U: ${listRows(uIPR, "-", true)}`);
      if (lIPR.length) seg.push(`L: ${listRows(lIPR, "-", true)}`);
      c.push(`IPR ${seg.join(" | ")} | Tot ${mm1(uIPRt + lIPRt)}mm`);
    } else c.push("IPR: none");
  }
  if (hasSp) {
    const seg = [];
    if (uSp.length) seg.push(`U: ${listRows(uSp, "-", true)}`);
    if (lSp.length) seg.push(`L: ${listRows(lSp, "-", true)}`);
    c.push(`Sp ${seg.join(" | ")} | Tot ${mm1(uSpt + lSpt)}mm`);
  } else c.push("Sp: none");
  c.push(hasBT ? `BT: ${uBT.concat(lBT).map(k => ckLabel(k, "-")).join(", ")}` : "BT: none");
  if (showCum) c.push(`Cum IPR ${o.visitCount}v: U ${mm1(cUt)} / L ${mm1(cLt)} / T ${mm1(cUt + cLt)}mm`);
  return c.join("\n");
}
// UI preference (not patient data) — localStorage so it survives across sessions
function prefLoad(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch (e) { return fallback; }
}
function prefSave(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function App() {
  const today = localToday();

  // Form state
  // (name: the patient's full name; initials: what an older record kept, shown until someone adds the name)
  const [patient, setPatient] = React.useState(() => Object.assign({ name: "", initials: "", patientId: "", date: today, assistantInitials: "" }, load("ipr_patient", {})));
  const [upper, setUpper] = React.useState(() => canonContacts(UPPER, load("ipr_upper", null), ""));
  const [lower, setLower] = React.useState(() => canonContacts(LOWER, load("ipr_lower", null), ""));
  const [notes, setNotes] = React.useState(() => load("ipr_notes", ""));
  const [gaugeVerified, setGaugeVerified] = React.useState(() => load("ipr_gauge", false));
  const [upperSpaces, setUpperSpaces] = React.useState(() => canonContacts(UPPER, load("ipr_upper_spaces", null), ""));
  const [lowerSpaces, setLowerSpaces] = React.useState(() => canonContacts(LOWER, load("ipr_lower_spaces", null), ""));
  const [upperBT, setUpperBT] = React.useState(() => canonContacts(UPPER, load("ipr_upper_bt", null), false));
  const [lowerBT, setLowerBT] = React.useState(() => canonContacts(LOWER, load("ipr_lower_bt", null), false));
  const [missingTeeth, setMissingTeeth] = React.useState(() => load("ipr_missing", {}));

  // Toggle a tooth missing/present. Marking missing also clears its adjacent contacts
  // (IPR, spaces, BT) since those contacts no longer exist clinically.
  const toggleMissing = tooth => {
    setMissingTeeth(prev => {
      const nowMissing = !prev[tooth];
      if (nowMissing) {
        const isU = tooth[0] === "U";
        const arr = isU ? UPPER : LOWER;
        const i = arr.indexOf(tooth);
        const ck = Object.keys(initContacts(arr));
        const affected = [ck[i - 1], ck[i]].filter(Boolean);
        const clearVals = obj => { const o = { ...obj }; affected.forEach(k => { if (k in o) o[k] = ""; }); return o; };
        const clearBools = obj => { const o = { ...obj }; affected.forEach(k => { if (k in o) o[k] = false; }); return o; };
        if (isU) { setUpper(clearVals); setUpperSpaces(clearVals); setUpperBT(clearBools); setPrescribedUpper(clearVals); }
        else { setLower(clearVals); setLowerSpaces(clearVals); setLowerBT(clearBools); setPrescribedLower(clearVals); }
      }
      const next = { ...prev };
      if (nowMissing) next[tooth] = true; else delete next[tooth];
      return next;
    });
  };

  // Patient record state
  const [dbPatient, setDbPatient] = React.useState(null); // { id, name, ini, patient_id }
  const [visitHistory, setVisitHistory] = React.useState([]);
  const [currentVisitId, setCurrentVisitId] = React.useState(() => load("ipr_visit_id", null));
  const [showHistory, setShowHistory] = React.useState(false);
  const [readOnly, setReadOnly] = React.useState(() => load("ipr_read_only", false) === true); // true when viewing a saved past visit
  // after the lock or a reload: the patient whose visit was on screen, and their visits, opened again (so the next save goes to
  // the same visit, never a second copy of it)
  React.useEffect(() => {
    const pid = load("ipr_db_patient", null); if (!pid) return;
    let off = false;
    (async () => {
      try {
        await IP.whenReady(); const p = IP.patient(pid); if (off || !p) return;
        setDbPatient(p);
        const vs = await sbGet(`visits?patient_uuid=eq.${pid}&order=date.desc,created_at.desc`);
        if (!off) setVisitHistory(vs || []);
      } catch (e) { }
    })();
    return () => { off = true; };
  }, []);
  // another computer changed this patient (their name, say): the record on screen follows
  React.useEffect(() => {
    const f = () => setDbPatient(cur => { if (!cur) return cur; const n = IP.patient(cur.id); return n && (n.name !== cur.name || n.patient_id !== cur.patient_id) ? n : cur; });
    IP_SUBS.add(f); return () => { IP_SUBS.delete(f); };
  }, []);
  React.useEffect(() => {
    if (!dbPatient) return;
    setPatient(p => (p.name === dbPatient.name && p.patientId === dbPatient.patient_id) ? p : { ...p, name: dbPatient.name, initials: dbPatient.ini || "", patientId: dbPatient.patient_id });
  }, [dbPatient && dbPatient.name, dbPatient && dbPatient.patient_id]);

  // Search state
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState([]);
  const [isSearching, setIsSearching] = React.useState(false);
  const [showResults, setShowResults] = React.useState(false);

  // Sync state
  const [syncStatus, setSyncStatus] = React.useState("idle"); // idle|saving|saved|error
  const [syncMsg, setSyncMsg] = React.useState("");

  // UI state
  const [activeTab, setActiveTab] = React.useState(() => ["ipr", "spaces", "note"].indexOf(load("ipr_tab", "ipr")) !== -1 ? load("ipr_tab", "ipr") : "ipr");
  const [chipAmt, setChipAmt] = React.useState("0.3"); // one-click entry amount; null = type mode; "erase" = eraser
  const [spaceChipAmt, setSpaceChipAmt] = React.useState("0.5"); // same, for the Spaces tab
  const [lastSavedAt, setLastSavedAt] = React.useState(null); // Date of last successful auto/manual save
  const [showMenu, setShowMenu] = React.useState(false); // header ⋯ overflow menu
  const [saved, setSaved] = React.useState(false);
  const [quickText, setQuickText] = React.useState("");
  const [quickMsg, setQuickMsg] = React.useState(null);
  const [showCumChart, setShowCumChart] = React.useState(false);
  const [printBlank, setPrintBlank] = React.useState(false);

  // Chart-note tab
  const [noteFormat, setNoteFormat] = React.useState(() => prefLoad("ipr_note_format", "lines"));
  const [noteIncIPR, setNoteIncIPR] = React.useState(() => prefLoad("ipr_note_inc_ipr", true));
  const [noteIncCum, setNoteIncCum] = React.useState(() => prefLoad("ipr_note_inc_cum", true));
  const [noteText, setNoteText] = React.useState("");   // what's in the box (may be hand-edited)
  const [noteCopied, setNoteCopied] = React.useState(false);

    // Wizard flow state
  const [flowStep, setFlowStep] = React.useState(null); // null | "choose" | "search" | "newPatient" | "visitSetup" | "prescribed"
  // A link from NLO Cases opens one patient's new visit (Amir, 6 Oct 2026: enter the IPR here once, instead of here and again in
  // the case): IPR_Tracker.html#chart=<chart #>, read once at start-up (lock.js takes it out of the address). The patient's
  // visits (Start new visit), or New patient with the chart # and the name NLO Cases has for it filled in.
  const [deepPick, setDeepPick] = React.useState(null);
  React.useEffect(() => {
    const d = APP_DEEP; APP_DEEP = null;
    if (!d || !d.chart) return;
    (async () => {
      let hit = [];
      try { hit = await IP.byChart(d.chart); } catch (e) { hit = []; }
      setDeepPick(hit.length === 1 ? { patient: hit[0] } : { chart: d.chart, many: hit.length > 1 });
      setFlowStep(hit.length ? "search" : "newPatient");
    })();
  }, []);
  const [prescribedUpper, setPrescribedUpper] = React.useState(() => canonContacts(UPPER, load("ipr_presc_upper", null), ""));
  const [prescribedLower, setPrescribedLower] = React.useState(() => canonContacts(LOWER, load("ipr_presc_lower", null), ""));
  const [pendingSave, setPendingSave] = React.useState(false); // true = auto-save after patient selected

  // DB connection state
const [dbConnected, setDbConnected] = React.useState(null); // null=checking, true/false
  const [dbPatientCount, setDbPatientCount] = React.useState(null);
  React.useEffect(() => {
    sbGet("patients?select=id").then(r => {
      setDbConnected(true);
      setDbPatientCount(r.length);
    }).catch(() => { setDbConnected(false); });
  }, []);

  // Auto-save after patient is selected/created via wizard when pendingSave is true
  React.useEffect(() => {
    if (pendingSave && flowStep === null && (dbPatient || (patient.patientId || "").trim())) {
      setPendingSave(false);
      // Small delay so UI updates first
      setTimeout(() => handleSaveToRecord(), 300);
    }
  }, [pendingSave, flowStep, dbPatient, patient.patientId]);

  // Visits on file that count as "earlier" than the one on screen: everything dated on or before it,
  // never the visit itself (so a saved visit isn't counted twice, and an old visit opened read-only
  // doesn't pick up visits that came after it).
  const earlierVisits = React.useMemo(() => visitHistory.filter(v =>
    v.id !== currentVisitId && (!v.date || !patient.date || v.date <= patient.date)
  ), [visitHistory, currentVisitId, patient.date]);
  // Visits behind the cumulative figures: the earlier ones plus the one on screen.
  const visitCount = earlierVisits.length + 1;

  // IPR from earlier visits only (null until a patient with history is loaded)
  const sumEarlier = (teeth, field) => {
    const acc = initContacts(teeth);
    earlierVisits.forEach(v => {
      const src = jp(v[field], {});
      Object.keys(acc).forEach(k => {
        acc[k] = String((parseFloat(acc[k]) || 0) + (parseFloat(src[k]) || 0));
      });
    });
    return acc;
  };
  const prevUpper = React.useMemo(() => visitHistory.length ? sumEarlier(UPPER, "upper_ipr") : null, [visitHistory, earlierVisits]);
  const prevLower = React.useMemo(() => visitHistory.length ? sumEarlier(LOWER, "lower_ipr") : null, [visitHistory, earlierVisits]);

  // Cumulative IPR = earlier visits + the visit on screen
  const addCurrent = (prev, cur) => {
    const acc = { ...prev };
    Object.keys(acc).forEach(k => {
      acc[k] = String((parseFloat(acc[k]) || 0) + (parseFloat(cur[k]) || 0));
    });
    return acc;
  };
  const cumUpper = React.useMemo(() => prevUpper ? addCurrent(prevUpper, upper) : null, [prevUpper, upper]);
  const cumLower = React.useMemo(() => prevLower ? addCurrent(prevLower, lower) : null, [prevLower, lower]);
  const cumUpperTotal = cumUpper ? sumContacts(cumUpper) : 0;
  const cumLowerTotal = cumLower ? sumContacts(cumLower) : 0;

  // Quick entry
  const applyQuickEntry = () => {
    const result = parseIPRCommand(quickText, upper, lower);
    if (result.error) {
      setQuickMsg({
        type: "error",
        text: result.error
      });
    } else {
      if (Object.keys(result.upperChanges).length) setUpper(prev => ({
        ...prev,
        ...result.upperChanges
      }));
      if (Object.keys(result.lowerChanges).length) setLower(prev => ({
        ...prev,
        ...result.lowerChanges
      }));
      setQuickMsg({
        type: "ok",
        text: result.message
      });
      setQuickText("");
    }
    setTimeout(() => setQuickMsg(null), 3000);
  };

  // This tab's draft — what's on screen — sealed with the office key for the person signed in (lock.js), debounced. It's opened
  // again after the lock or a reload, only by the same person; Cancel and a finished save clear it.
  const draftObj = () => ({
    ipr_patient: patient, ipr_upper: upper, ipr_lower: lower, ipr_notes: notes, ipr_gauge: gaugeVerified,
    ipr_upper_spaces: upperSpaces, ipr_lower_spaces: lowerSpaces, ipr_upper_bt: upperBT, ipr_lower_bt: lowerBT, ipr_missing: missingTeeth,
    ipr_presc_upper: prescribedUpper, ipr_presc_lower: prescribedLower, ipr_db_patient: dbPatient ? dbPatient.id : null,
    ipr_visit_id: currentVisitId, ipr_read_only: readOnly, ipr_tab: activeTab
  });
  React.useEffect(() => {
    const saveTimer = setTimeout(() => {
      draftSave(draftObj()).then(ok => { if (ok) { setSaved(true); setTimeout(() => setSaved(false), 1500); } });
    }, 500);
    return () => clearTimeout(saveTimer);
  }, [patient, upper, lower, notes, gaugeVerified, upperSpaces, lowerSpaces, upperBT, lowerBT, missingTeeth, prescribedUpper, prescribedLower, dbPatient, currentVisitId, readOnly, activeTab]);

  const handleSaveToRecord = async (opts = {}) => {
    const keepOpen = opts.keepOpen === true;
    const silent = opts.silent === true; // autosave: no wizard, no reset, quiet status
    setSyncStatus("saving");
    setSyncMsg("");
    try {
      let patientId = dbPatient?.id;

      // Create patient if needed
      if (!patientId) {
        if (!(patient.patientId || "").trim()) {
          if (silent) { setSyncStatus("idle"); return false; }
          // No patient loaded — open wizard so they can select/create one, then auto-save
          setSyncStatus("idle");
          setPendingSave(true);
          setFlowStep("choose");
          return false;
        }
        // a record with this chart # already (letters and digits compared) is the patient — it gets the name typed, if it had none
        const existing = await IP.byChart(patient.patientId);
        if (existing && existing.length > 0) {
          let ex = existing[0];
          if (!ex.name && cleanName(patient.name)) { try { ex = await IP.savePatient(ex.id, { name: patient.name }, { a: "name" }); } catch (e) { } }
          setDbPatient(ex);
          pushRecentPatient(ex);
          patientId = ex.id;
        } else {
          const created = await sbPost("patients", {
            name: cleanName(patient.name),
            patient_id: patient.patientId.trim()
          });
          const newPat = created[0];
          setDbPatient(newPat);
          pushRecentPatient(newPat);
          patientId = newPat.id;
        }
      }
      const visitData = {
        patient_uuid: patientId,
        date: patient.date,
        assistant_initials: patient.assistantInitials,
        gauge_verified: gaugeVerified,
        upper_ipr: upper,
        lower_ipr: lower,
        upper_spaces: upperSpaces,
        lower_spaces: lowerSpaces,
        upper_bt: upperBT,
        lower_bt: lowerBT,
        notes: notes
      };
      // Try saving with prescribed columns; if DB doesn't have them, retry without
      // To add them: ALTER TABLE visits ADD COLUMN prescribed_upper jsonb;
      //              ALTER TABLE visits ADD COLUMN prescribed_lower jsonb;
      const hasPrescribedCols = window.__prescribedColumnsExist !== false;
      if (hasPrescribedCols) {
        visitData.prescribed_upper = prescribedUpper;
        visitData.prescribed_lower = prescribedLower;
      }
      // To add: ALTER TABLE visits ADD COLUMN missing_teeth jsonb;
      if (window.__missingTeethColumnExists !== false) {
        visitData.missing_teeth = missingTeeth;
      }
      const doSave = async (data) => {
        if (currentVisitId) {
          await sbPatch(`visits?id=eq.${currentVisitId}`, data);
          setVisitHistory(prev => prev.map(v => v.id === currentVisitId ? { ...v, ...data } : v));
          setSyncMsg("Visit updated ✓");
        } else {
          const created = await sbPost("visits", data);
          const newVisit = created[0];
          setCurrentVisitId(newVisit.id);
          setVisitHistory(prev => [newVisit, ...prev]);
          setSyncMsg("Saved to patient record ✓");
        }
      };
      // Save, progressively stripping optional columns the DB may not have yet
      for (let attempt = 0; ; attempt++) {
        try {
          await doSave(visitData);
          break;
        } catch (retryErr) {
          const msg = String(retryErr);
          if (attempt < 3 && msg.includes("prescribed_") && ("prescribed_upper" in visitData)) {
            window.__prescribedColumnsExist = false;
            delete visitData.prescribed_upper;
            delete visitData.prescribed_lower;
          } else if (attempt < 3 && msg.includes("missing_teeth") && ("missing_teeth" in visitData)) {
            window.__missingTeethColumnExists = false;
            delete visitData.missing_teeth;
          } else {
            throw retryErr;
          }
        }
      }
      setSyncStatus("saved");
      setLastSavedAt(new Date());
      if (silent) {
        setSyncMsg("Auto-saved ✓");
        setTimeout(() => {
          setSyncStatus("idle");
          setSyncMsg("");
        }, 2000);
        return true;
      }
      if (keepOpen) {
        setSyncMsg("Saved to patient record ✓");
        setTimeout(() => {
          setSyncStatus("idle");
          setSyncMsg("");
        }, 3000);
        return true;
      }
      setSyncMsg("Saved ✓ — Resetting for next patient...");
      // After a brief delay so user sees the success message, reset everything
      setTimeout(() => {
        clearAllState();
        setFlowStep("choose");
      }, 1500);
      return true;
    } catch (e) {
      setSyncStatus("error");
      setSyncMsg("Save failed: " + (e.message || String(e)));
      setTimeout(() => {
        setSyncStatus("idle");
        setSyncMsg("");
      }, 8000);
      return false;
    }
  };

  // ─── Autosave: debounced save 2.5s after the last edit, once a patient is loaded ───
  const autosaveSkipRef = React.useRef(true);
  const autosaveWaiting = React.useRef(false);
  React.useEffect(() => {
    // skip the very first run (initial mount / draft restore)
    if (autosaveSkipRef.current) { autosaveSkipRef.current = false; return; }
    if (!dbPatient || readOnly || flowStep !== null) return;
    autosaveWaiting.current = true;
    const t = setTimeout(() => {
      autosaveWaiting.current = false;
      if (syncStatus === "saving") return;
      handleSaveToRecord({ silent: true });
    }, 2500);
    return () => clearTimeout(t);
  }, [upper, lower, notes, gaugeVerified, upperSpaces, lowerSpaces, upperBT, lowerBT, missingTeeth, patient.date, patient.assistantInitials]);

  // the lock (lock.js) asks the app to put what's on screen in the draft, and to save a change still waiting to autosave
  APP_HOOKS.flush = async () => {
    const waiting = autosaveWaiting.current && dbPatient && !readOnly;
    autosaveWaiting.current = false;
    await draftSave(draftObj());
    if (waiting) await handleSaveToRecord({ silent: true });
  };

  const handleChange = setter => (key, val) => setter(prev => ({
    ...prev,
    [key]: val
  }));

  const upperTotal = sumContacts(upper);
  const lowerTotal = sumContacts(lower);
  const grandTotal = upperTotal + lowerTotal;
  const upperRows = Object.entries(upper).filter(([, v]) => parseFloat(v) > 0);
  const lowerRows = Object.entries(lower).filter(([, v]) => parseFloat(v) > 0);
  const upperSpacesTotal = sumContacts(upperSpaces);
  const lowerSpacesTotal = sumContacts(lowerSpaces);
  const upperBTCount = Object.values(upperBT).filter(Boolean).length;
  const lowerBTCount = Object.values(lowerBT).filter(Boolean).length;
  const upperSpacesRows = Object.entries(upperSpaces).filter(([, v]) => parseFloat(v) > 0);
  const lowerSpacesRows = Object.entries(lowerSpaces).filter(([, v]) => parseFloat(v) > 0);
  const upperBTRows = Object.entries(upperBT).filter(([, v]) => v);
  const lowerBTRows = Object.entries(lowerBT).filter(([, v]) => v);

  // ── Chart note ──────────────────────────────────────────────────────────────
  // Regenerated whenever the clinical data or the format options change. Hand
  // edits to the box survive until the underlying data changes, so a stale note
  // can never be copied into a chart after a value was corrected.
  const generatedNote = React.useMemo(() => buildChartNote({
    format: noteFormat,
    incIPR: noteIncIPR,
    incCum: noteIncCum,
    upper, lower, upperSpaces, lowerSpaces, upperBT, lowerBT,
    cumUpper, cumLower,
    visitCount: visitCount
  }), [noteFormat, noteIncIPR, noteIncCum, upper, lower, upperSpaces, lowerSpaces, upperBT, lowerBT, cumUpper, cumLower, visitCount]);
  React.useLayoutEffect(() => {
    setNoteText(generatedNote);
    setNoteCopied(false);
  }, [generatedNote]);
  const noteEdited = noteText !== generatedNote;
  const copyChartNote = async () => {
    const text = noteText;
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      // clipboard API blocked (insecure context / permissions) — fall back
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (e2) {}
      document.body.removeChild(ta);
    }
    setNoteCopied(true);
    setTimeout(() => setNoteCopied(false), 2000);
  };
  const setFmt = f => { setNoteFormat(f); prefSave("ipr_note_format", f); };

  // ── view helpers for the redesigned screen (plain functions that return elements) ──
  const initialsOf = s => ((s || "").toString().trim().slice(0, 3).toUpperCase()) || "•";
  const avatarOf = p => nameInitials(p.name) || initialsOf(p.initials) ;
  const saveLabel = { idle: "Save to patient record", saving: "Saving…", saved: "Saved", error: "Save failed" }[syncStatus] || "Save to patient record";
  const saveTone = { idle: "primary", saving: "primary", saved: "ok", error: "danger" }[syncStatus] || "primary";
  const stat = (label, v, cls) => el("div", { key: label, className: cn("ip-stat", cls) },
    el("div", { className: "lab" }, label),
    el("div", { className: "val" }, v.toFixed(1), el("small", null, "mm")));
  const countStat = (label, n) => el("div", { key: label, className: "ip-stat" },
    el("div", { className: "lab" }, label),
    el("div", { className: "val" }, String(n)));
  // list of contacts with amounts (IPR or spaces)
  const detailCard = (title, rows, total, cls, emptyText) => el("div", { key: title, className: "ip-card" },
    el("div", { className: "ip-list-h" }, title, rows.length > 0 && el("span", null, rows.length + (rows.length === 1 ? " contact" : " contacts"))),
    rows.length === 0 ? el("p", { className: "ip-none" }, emptyText) : el(React.Fragment, null,
      rows.map(([k, v]) => {
        const [a, b] = k.split("|");
        return el("div", { key: k, className: cn("ip-li", cls) }, el("span", null, a, " – ", b), el("b", null, parseFloat(v).toFixed(1), " mm"));
      }),
      el("div", { className: "ip-tot" }, "Total", el("b", null, total.toFixed(1), " mm"))));
  const btCard = (title, rows) => el("div", { key: title, className: "ip-card" },
    el("div", { className: "ip-list-h" }, title, el("span", null, rows.length + (rows.length === 1 ? " contact" : " contacts"))),
    rows.map(([k]) => {
      const [a, b] = k.split("|");
      return el("div", { key: k, className: "ip-li" }, el("span", { className: "bt" }, el(TriMark, { size: 11 }), a, " – ", b));
    }));

  // Print the blank form (reached from the ⋯ menu)
  const printBlankForm = () => {
    setShowMenu(false);
    setPrintBlank(true);
    setTimeout(() => {
      const printEl = document.querySelector('.print-only');
      if (!printEl) { setPrintBlank(false); return; }
      openPrintWindow(printEl.innerHTML, "Print");
      setPrintBlank(false);
    }, 150);
  };

  // Wizard Flow Overlay Component
  // WizardImpl is rebuilt on every App render so it always sees fresh state; it is *called* from a
  // stable wrapper (see the end of this block), so its own state survives those re-renders. Previously
  // every App render (autosave, the "Draft saved" flicker…) rebuilt the dialog and wiped half-typed
  // searches, and the one-tap "Recent patients" chip landed on an empty search box.
  const WizardImpl = () => {
    const [searchInputVal, setSearchInputVal] = React.useState('');
    const [searchRes, setSearchRes] = React.useState([]);
    const [isSearching2, setIsSearching2] = React.useState(false);
    const [searched, setSearched] = React.useState(false);
    const [wizMsg, setWizMsg] = React.useState('');
    const [tempPatientId, setTempPatientId] = React.useState('');
    const [tempName, setTempName] = React.useState('');
    const tempNameRef = React.useRef(''); tempNameRef.current = tempName;
    const nameAuto = React.useRef('');                 // the name put in from NLO Cases (a new chart # replaces it; a typed one stays)
    const [chartInfo, setChartInfo] = React.useState(null); // for the chart # typed: { name NLO Cases has, IPR records with it }
    const [tempDate, setTempDate] = React.useState(patient.date);
    const [tempAssistantInitials, setTempAssistantInitials] = React.useState('');
    const [selectedPatient, setSelectedPatient] = React.useState(null);
    const [selectedVisit, setSelectedVisit] = React.useState(null);
    const [visitHistoryForSelected, setVisitHistoryForSelected] = React.useState([]);
    const [opening, setOpening] = React.useState(false);        // a patient's record is being fetched
    const openSeq = React.useRef(0);                              // lets a newer tap win over a slower older one
    // Patient-records dialog state (hoisted so hooks always run in the same order)
    const [recSearch, setRecSearch] = React.useState('');
    const [recResults, setRecResults] = React.useState([]);
    const [recLoading, setRecLoading] = React.useState(false);
    const [recSearched, setRecSearched] = React.useState(false);
    const [recPatient, setRecPatient] = React.useState(null);
    const [recVisits, setRecVisits] = React.useState([]);
    const [recVisitsLoading, setRecVisitsLoading] = React.useState(false);
    const go = step => { setWizMsg(''); setFlowStep(step); };
    // opened from an NLO Cases link (deepPick, above): straight to that patient's visits, or New patient with the chart # in
    React.useEffect(() => {
      const d = deepPick; if (!d) return; setDeepPick(null);
      if (d.patient) selectPatientForVisit(d.patient);
      else if (d.many) setSearchInputVal(d.chart); // (two records with that chart #: the search shows both)
      else setTempPatientId(d.chart);
    }, []);
    // New patient: the chart # typed → the name NLO Cases has for it goes in the name box (unless one was typed), and a record
    // here with that chart # already is offered instead of a second one
    React.useEffect(() => {
      if (flowStep !== 'newPatient') return;
      const ch = tempPatientId.trim(); setChartInfo(null);
      if (iprNorm(ch).length < 3) return;
      let off = false;
      const t = setTimeout(async () => {
        let ex = [], name = '';
        try { [ex, name] = await Promise.all([IP.byChart(ch), iprCaseName(ch)]); } catch (e) { }
        if (off) return;
        setChartInfo({ chart: ch, name, existing: ex || [] });
        if (name && (!tempNameRef.current.trim() || tempNameRef.current === nameAuto.current)) { nameAuto.current = name; setTempName(name); }
      }, 350);
      return () => { off = true; clearTimeout(t); };
    }, [tempPatientId, flowStep]);

    const doSearch = async () => {
      const q = searchInputVal.trim();
      if (!q) return;
      setIsSearching2(true);
      setWizMsg('');
      try {
        setSearchRes(await iprSearch(q));
      } catch (e) {
        setSearchRes([]);
        setWizMsg('Could not reach patient records. Check the internet connection.');
      } finally {
        setSearched(true);
        setIsSearching2(false);
      }
    };

    // List every patient (first 50). Works on this dialog's own state — the older App-level
    // list helper wrote to state this dialog never shows.
    const listAllPatients = async () => {
      setIsSearching2(true);
      setWizMsg('');
      try {
        setSearchRes(await iprAllPatients());
      } catch (e) {
        setSearchRes([]);
        setWizMsg('Could not reach patient records. Check the internet connection.');
      } finally {
        setSearched(true);
        setIsSearching2(false);
      }
    };

    // Load a patient's visits, then show the patient and the visits together (never one patient with
    // another's visits). A newer tap supersedes an older one that is still loading.
    const selectPatientForVisit = async (p) => {
      const seq = ++openSeq.current;
      setOpening(true);
      pushRecentPatient(p);
      let visits = [];
      try { visits = (await sbGet(`visits?patient_uuid=eq.${p.id}&order=date.desc&limit=50`)) || []; }
      catch (e) { visits = []; }
      if (seq !== openSeq.current) return;
      setVisitHistoryForSelected(visits);
      setSelectedPatient(p);
      setOpening(false);
      // initials only: the name NLO Cases has for the chart # goes on the record (when it fits the initials)
      if (!p.name) iprFillName(p).then(n => { if (n && seq === openSeq.current) setSelectedPatient(n); });
    };

    // Search-as-you-type (300ms debounce, min 2 chars)
    React.useEffect(() => {
      const q = searchInputVal.trim();
      if (q.length < 2) return;
      const t = setTimeout(() => { doSearch(); }, 300);
      return () => clearTimeout(t);
    }, [searchInputVal]);

    // One-tap recent patient: load and jump straight to visit selection
    const openRecent = async (rp) => {
      const seq = ++openSeq.current;
      setOpening(true);
      go('search');
      let row = null;
      try { await IP.whenReady(); row = IP.patient(rp.id); } catch (e) { row = null; }
      if (seq !== openSeq.current) return;
      if (row) { selectPatientForVisit(row); }
      else { setOpening(false); setSearchInputVal(rp.patient_id || ''); }
    };

    const startNewVisitForSelected = () => {
      if (!selectedPatient) return;
      setPatient({
        patientId: selectedPatient.patient_id,
        name: selectedPatient.name,
        initials: selectedPatient.ini || '',
        date: localToday(),
        assistantInitials: iprDefaultAssistant()
      });
      setDbPatient(selectedPatient);
      setVisitHistory(visitHistoryForSelected);   // earlier visits feed the "earlier visits" tags and cumulative totals
      setCurrentVisitId(null);
      setUpper(initContacts(UPPER));
      setLower(initContacts(LOWER));
      setNotes('');
      setGaugeVerified(false);
      setUpperSpaces(initContacts(UPPER));
      setLowerSpaces(initContacts(LOWER));
      setUpperBT(initBT(UPPER));
      setLowerBT(initBT(LOWER));
      setPrescribedUpper(initContacts(UPPER));
      setPrescribedLower(initContacts(LOWER));
      // carry missing teeth forward from the most recent visit (anatomy doesn't change between visits)
      (async () => {
        try {
          const last = await sbGet(`visits?patient_uuid=eq.${selectedPatient.id}&order=date.desc&limit=1&select=missing_teeth`);
          setMissingTeeth(last && last[0] && last[0].missing_teeth ? jp(last[0].missing_teeth, {}) : {});
        } catch (e) { setMissingTeeth({}); }
      })();
      setReadOnly(false);
      setFlowStep(null);
    };

    const loadVisit = async (v) => {
      if (!selectedPatient) return;
      setPatient({
        patientId: selectedPatient.patient_id,
        name: selectedPatient.name,
        initials: selectedPatient.ini || '',
        date: v.date || v.visit_date || '',
        assistantInitials: v.assistant_initials || ''
      });
      setDbPatient(selectedPatient);
      setVisitHistory(visitHistoryForSelected);
      setCurrentVisitId(v.id);
      setUpper(canonContacts(UPPER, jp(v.upper_ipr, null), ""));
      setLower(canonContacts(LOWER, jp(v.lower_ipr, null), ""));
      setNotes(v.notes || '');
      setGaugeVerified(v.gauge_verified || false);
      setUpperSpaces(canonContacts(UPPER, jp(v.upper_spaces, null), ""));
      setLowerSpaces(canonContacts(LOWER, jp(v.lower_spaces, null), ""));
      setUpperBT(canonContacts(UPPER, jp(v.upper_bt, null), false));
      setLowerBT(canonContacts(LOWER, jp(v.lower_bt, null), false));
      setPrescribedUpper(canonContacts(UPPER, jp(v.prescribed_upper, null), ""));
      setPrescribedLower(canonContacts(LOWER, jp(v.prescribed_lower, null), ""));
      setMissingTeeth(jp(v.missing_teeth, {}));
      setReadOnly(true); // viewing a saved past visit — read-only
      setFlowStep(null);
    };

    const createNewPatient = () => {
      if (!tempPatientId.trim() || !cleanName(tempName)) {
        setWizMsg('Enter the chart # and the patient’s full name.');
        return;
      }
      setPatient({
        patientId: tempPatientId.trim(),
        name: cleanName(tempName),
        initials: '',
        date: tempDate,
        assistantInitials: tempAssistantInitials || iprDefaultAssistant()
      });
      // a new patient: nothing of the one on screen before stays behind (IPR Tracker 3 kept that patient's record here, so a
      // visit charted next could be saved to them)
      setDbPatient(null);
      setVisitHistory([]);
      setCurrentVisitId(null);
      setUpper(initContacts(UPPER));
      setLower(initContacts(LOWER));
      setNotes('');
      setGaugeVerified(false);
      setUpperSpaces(initContacts(UPPER));
      setLowerSpaces(initContacts(LOWER));
      setUpperBT(initBT(UPPER));
      setLowerBT(initBT(LOWER));
      setPrescribedUpper(initContacts(UPPER));
      setPrescribedLower(initContacts(LOWER));
      setMissingTeeth({});
      setReadOnly(false);
      setFlowStep('visitSetup');
    };

    const handleVisitSetupContinue = (enterPrescribed) => {
      if (enterPrescribed) {
        setFlowStep('prescribed');
      } else {
        setPrescribedUpper(initContacts(UPPER));
        setPrescribedLower(initContacts(LOWER));
        setFlowStep(null);
      }
    };

    const handlePrescribedDone = () => {
      setFlowStep(null);
    };

    // Wizard UI rendering
    if (flowStep === null) return null;

    // shared dialog shell + small pieces
    const shell = (size, ...kids) => el("div", { className: "ip-overlay", role: "dialog", "aria-modal": "true" },
      el("div", { className: cn("ip-dialog", size) }, ...kids));
    const closeBtn = el("button", { type: "button", className: "ip-btn block", onClick: () => setFlowStep(null) }, "Close");
    const backBtn = fn => el("button", { type: "button", className: "ip-btn quiet block", onClick: fn }, "Back");
    const noteLine = () => wizMsg ? el("p", { className: "ip-msg err", role: "alert" }, wizMsg) : null;
    const upTotal = v => sumContacts(jp(v.upper_ipr, {}));
    const loTotal = v => sumContacts(jp(v.lower_ipr, {}));

    if (flowStep === 'choose') {
      const recents = getRecentPatients();
      return shell("",
        el("h2", { className: "ip-dlg-h" }, "New visit"),
        el("p", { className: "ip-dlg-s" }, "Pick a patient to chart."),
        recents.length > 0 && el("div", { className: "ip-recents" },
          el("div", { className: "lab" }, "Recent patients"),
          el("div", { className: "ip-recent-grid" }, recents.map(rp =>
            el("button", { key: rp.id, type: "button", className: "ip-recent", disabled: opening, onClick: () => openRecent(rp) }, ptLabel(rp) || rp.patient_id, ptLabel(rp) && el("span", null, rp.patient_id))))),
        el("div", { className: "ip-opts" },
          el("button", { type: "button", className: "ip-opt", onClick: () => go('search') },
            el("span", { className: "ico" }, el(Icon, { name: "search", size: 22 })),
            el("span", null, el("b", null, "Search existing patient"), el("span", { className: "d" }, "Find a patient and start a new visit"))),
          el("button", { type: "button", className: "ip-opt new", onClick: () => go('newPatient') },
            el("span", { className: "ico" }, el(Icon, { name: "userPlus", size: 22 })),
            el("span", null, el("b", null, "New patient"), el("span", { className: "d" }, "Create a record from the chart # and full name")))),
        el("div", { className: "ip-dlg-foot" }, closeBtn));
    }

    if (flowStep === 'search') {
      const cumUpperTotal = visitHistoryForSelected.reduce((sum, v) => sum + upTotal(v), 0);
      const cumLowerTotal = visitHistoryForSelected.reduce((sum, v) => sum + loTotal(v), 0);
      const cumGrandTotal = cumUpperTotal + cumLowerTotal;
      if (opening) {
        return shell("",
          el("h2", { className: "ip-dlg-h" }, "Opening patient…"),
          el("p", { className: "ip-dlg-s" }, "Loading saved visits."),
          el("div", { className: "ip-dlg-foot" }, closeBtn));
      }
      if (selectedPatient && !selectedVisit) {
        return shell("",
          el("h2", { className: "ip-dlg-h" }, "Select visit"),
          el("p", { className: "ip-dlg-s" }, el("b", { style: { color: "var(--ink)" } }, ptLabel(selectedPatient) || "Patient"), "  ·  Chart # ", selectedPatient.patient_id),
          visitHistoryForSelected.length > 0 && el("div", { className: "ip-sumgrid" },
            [["Total visits", String(visitHistoryForSelected.length)], ["Cumulative upper", cumUpperTotal.toFixed(1) + " mm"], ["Cumulative lower", cumLowerTotal.toFixed(1) + " mm"], ["Combined total", cumGrandTotal.toFixed(1) + " mm"]].map(([l, v]) =>
              el("div", { key: l }, el("div", { className: "lab" }, l), el("div", { className: "val" }, v)))),
          el("button", { type: "button", className: "ip-btn primary block", style: { minHeight: 48 }, onClick: startNewVisitForSelected }, el(Icon, { name: "plus", size: 18 }), "Start new visit"),
          visitHistoryForSelected.length > 0 && el("div", null,
            el("div", { className: "ip-sec-h" }, "Recent visits"),
            el("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, visitHistoryForSelected.map(v =>
              el("button", { key: v.id, type: "button", className: "ip-visit", onClick: () => { loadVisit(v); setSelectedVisit(v); } },
                el("div", { className: "top" }, el("b", null, v.date || v.visit_date || 'No date'), v.assistant_initials && el("span", { className: "ip-tag" }, v.assistant_initials)),
                el("div", { className: "meta" }, el("span", null, "Upper ", upTotal(v).toFixed(1), " mm"), el("span", null, "Lower ", loTotal(v).toFixed(1), " mm")))))),
          el("div", { className: "ip-dlg-foot" }, backBtn(() => { setSelectedPatient(null); setVisitHistoryForSelected([]); }), closeBtn));
      }
      return shell("",
        el("h2", { className: "ip-dlg-h" }, "Search patient"),
        el("p", { className: "ip-dlg-s" }, "Type a name, chart #, or initials."),
        el("div", { className: "ip-search" },
          el("input", { type: "text", className: "ip-text", autoFocus: true, placeholder: "Name, chart #, or initials…", "aria-label": "Patient name, chart #, or initials", value: searchInputVal, onChange: e => setSearchInputVal(e.target.value), onKeyDown: e => { if (e.key === 'Enter') doSearch(); } }),
          el("button", { type: "button", className: "ip-btn soft", onClick: doSearch, disabled: isSearching2 }, isSearching2 ? 'Searching…' : 'Search')),
        el("button", { type: "button", className: "ip-btn quiet sm", onClick: listAllPatients, disabled: isSearching2 }, "List all patients"),
        noteLine(),
        searchRes.length > 0 && el("div", { className: "ip-results" }, searchRes.map(p =>
          el("button", { key: p.id, type: "button", className: "ip-result", onClick: () => selectPatientForVisit(p) }, el("b", null, ptLabel(p) || p.patient_id), el("span", null, (ptLabel(p) ? "Chart # " + p.patient_id : "") + (!p.name ? (ptLabel(p) ? " · " : "") + "no full name yet" : ""))))),
        searched && !isSearching2 && searchRes.length === 0 && !wizMsg && el("p", { className: "ip-empty" }, "No patients found."),
        el("div", { className: "ip-dlg-foot" }, backBtn(() => go('choose')), closeBtn));
    }

    if (flowStep === 'newPatient') {
      const submitOnEnter = e => { if (e.key === 'Enter') createNewPatient(); };
      return shell("",
        el("h2", { className: "ip-dlg-h" }, "New patient"),
        el("p", { className: "ip-dlg-s" }, "Add the chart # and the patient’s full name."),
        el("div", { className: "ip-form" },
          el("div", null,
            el("label", { className: "ip-label", htmlFor: "ip-np-id" }, "Chart #"),
            el("input", { id: "ip-np-id", type: "text", className: "ip-input", autoFocus: true, autoComplete: "off", value: tempPatientId, onChange: e => setTempPatientId(e.target.value), onKeyDown: submitOnEnter, placeholder: "e.g., 123-4567" })),
          el("div", null,
            el("label", { className: "ip-label", htmlFor: "ip-np-name" }, "Full name"),
            el("input", { id: "ip-np-name", type: "text", className: "ip-input", autoComplete: "off", spellCheck: false, value: tempName, onChange: e => setTempName(e.target.value), onKeyDown: submitOnEnter, placeholder: "First and last name" }),
            chartInfo && chartInfo.name && cleanName(tempName) === chartInfo.name && el("div", { className: "ip-hint", style: { marginTop: 6 } }, "From NLO Cases (chart # " + chartInfo.chart + ")"))),
        chartInfo && chartInfo.existing.length > 0 && el("div", { className: "ip-exists", role: "status" },
          el("span", null, "Chart # ", el("b", null, chartInfo.chart), " is on file already" + (ptLabel(chartInfo.existing[0]) ? ": " : "."), ptLabel(chartInfo.existing[0]) && el("b", null, ptLabel(chartInfo.existing[0]))),
          el("button", { type: "button", className: "ip-btn soft sm", onClick: () => { go('search'); selectPatientForVisit(chartInfo.existing[0]); } }, "Open their visits")),
        noteLine(),
        el("div", { className: "ip-dlg-foot" },
          el("button", { type: "button", className: "ip-btn ok block", style: { minHeight: 48 }, onClick: createNewPatient }, "Create & continue"),
          backBtn(() => go('choose'))));
    }

    if (flowStep === 'visitSetup') {
      return shell("",
        el("h2", { className: "ip-dlg-h" }, "Visit setup"),
        el("p", { className: "ip-dlg-s" }, "Confirm the date and who is assisting."),
        el("div", { className: "ip-form", style: { marginBottom: 22 } },
          el("div", null,
            el("label", { className: "ip-label", htmlFor: "ip-vs-date" }, "Visit date"),
            el("input", { id: "ip-vs-date", type: "date", className: "ip-input", value: patient.date, onChange: e => setPatient(p => ({ ...p, date: e.target.value })) })),
          el("div", null,
            el("label", { className: "ip-label", htmlFor: "ip-vs-asst" }, "Assistant"),
            el(IprAsstSelect, { id: "ip-vs-asst", className: "ip-select", blank: "Select...", value: patient.assistantInitials, onChange: e => setPatient(p => ({ ...p, assistantInitials: e.target.value })) }))),
        el("div", { className: "ip-q" }, "Enter prescribed IPR first?"),
        el("div", { className: "ip-split" },
          el("button", { type: "button", className: "ip-btn violet-solid", style: { minHeight: 48 }, onClick: () => handleVisitSetupContinue(true) }, "Yes"),
          el("button", { type: "button", className: "ip-btn", style: { minHeight: 48 }, onClick: () => handleVisitSetupContinue(false) }, "Skip")));
    }

    if (flowStep === 'prescribed') {
      return shell("wide",
        el("h2", { className: "ip-dlg-h" }, "Prescribed IPR"),
        el("p", { className: "ip-dlg-s" }, "Enter the planned (prescribed) IPR amounts."),
        el(AmountPalette, { chipAmt: chipAmt, setChipAmt: setChipAmt, compact: true }),
        el("div", { className: "ip-presc-arches" },
          el(ArchDiagram, { lower: false, mode: "ipr", title: "Upper (prescribed)", vals: prescribedUpper, onVal: handleChange(setPrescribedUpper), chipAmt: chipAmt, missing: missingTeeth, onToggleMissing: toggleMissing }),
          el(ArchDiagram, { lower: true, mode: "ipr", title: "Lower (prescribed)", vals: prescribedLower, onVal: handleChange(setPrescribedLower), chipAmt: chipAmt, missing: missingTeeth, onToggleMissing: toggleMissing })),
        el("div", { className: "ip-dlg-foot" },
          el("button", { type: "button", className: "ip-btn ok block", style: { minHeight: 48 }, onClick: handlePrescribedDone }, "Done — start charting"),
          backBtn(() => setFlowStep('visitSetup'))));
    }

    if (flowStep === 'details') return el(PatientDetails, { key: 'pd' });

    if (flowStep === 'records') {
      // q is passed in explicitly so "List all" doesn't depend on the (not yet cleared) search box
      const searchRecords = async (q) => {
        setRecLoading(true);
        try {
          let results;
          if (q) {
            results = await iprSearch(q);
          } else {
            results = await iprAllPatients();
          }
          setRecResults(results || []);
        } catch (e) {
          setRecResults([]);
        }
        setRecSearched(true);
        setRecLoading(false);
      };

      const selectRecPatient = async (p) => {
        setRecPatient(p);
        setRecVisitsLoading(true);
        try {
          const visits = await sbGet(`visits?patient_uuid=eq.${p.id}&order=date.desc`);
          setRecVisits(visits || []);
        } catch (e) {
          setRecVisits([]);
        }
        setRecVisitsLoading(false);
      };

      const openRecordReadOnly = (p, v) => {
        setPatient({
          patientId: p.patient_id,
          name: p.name,
          initials: p.ini || '',
          date: v.date || v.visit_date || '',
          assistantInitials: v.assistant_initials || ''
        });
        setDbPatient(p);
        setCurrentVisitId(v.id);
        setUpper(canonContacts(UPPER, jp(v.upper_ipr, null), ""));
        setLower(canonContacts(LOWER, jp(v.lower_ipr, null), ""));
        setNotes(v.notes || '');
        setGaugeVerified(v.gauge_verified || false);
        setUpperSpaces(canonContacts(UPPER, jp(v.upper_spaces, null), ""));
        setLowerSpaces(canonContacts(LOWER, jp(v.lower_spaces, null), ""));
        setUpperBT(canonContacts(UPPER, jp(v.upper_bt, null), false));
        setLowerBT(canonContacts(LOWER, jp(v.lower_bt, null), false));
        setPrescribedUpper(canonContacts(UPPER, jp(v.prescribed_upper, null), ""));
        setPrescribedLower(canonContacts(LOWER, jp(v.prescribed_lower, null), ""));
        setMissingTeeth(jp(v.missing_teeth, {}));   // the visit's own missing teeth, not whatever was on screen before
        // Load full visit history for this patient
        sbGet(`visits?patient_uuid=eq.${p.id}&order=date.desc`).then(h => setVisitHistory(h || [])).catch(() => {});
        setReadOnly(true);
        setFlowStep(null);
      };

      return shell("mid",
        !recPatient ?
          el(React.Fragment, null,
            el("h2", { className: "ip-dlg-h" }, "Patient records"),
            el("p", { className: "ip-dlg-s" }, "Open any saved visit to review it."),
            el("div", { className: "ip-search" },
              el("input", { type: "text", className: "ip-text", autoFocus: true, placeholder: "Search by name or chart #…", "aria-label": "Search by name or chart #", value: recSearch, onChange: e => setRecSearch(e.target.value), onKeyDown: e => { if (e.key === 'Enter') searchRecords(recSearch.trim()); } }),
              el("button", { type: "button", className: "ip-btn soft", onClick: () => searchRecords(recSearch.trim()), disabled: recLoading }, recLoading ? 'Searching…' : 'Search')),
            el("button", { type: "button", className: "ip-btn quiet sm", onClick: () => { setRecSearch(''); searchRecords(''); } }, "List all patients"),
            recResults.length > 0 && el("div", { className: "ip-results", style: { maxHeight: 320 } }, recResults.map(p =>
              el("button", { key: p.id, type: "button", className: "ip-result", onClick: () => selectRecPatient(p) }, el("b", null, ptLabel(p) || p.patient_id), el("span", null, (ptLabel(p) ? "Chart # " + p.patient_id : "") + (!p.name ? (ptLabel(p) ? " · " : "") + "no full name yet" : ""))))),
            recResults.length === 0 && !recLoading && el("p", { className: "ip-empty" }, recSearched ? "No patients found." : "Search, or list all, to find patient records."),
            el("div", { className: "ip-dlg-foot" }, closeBtn))
        :
          el(React.Fragment, null,
            el("h2", { className: "ip-dlg-h" }, "Visit history"),
            el("p", { className: "ip-dlg-s" }, el("b", { style: { color: "var(--ink)" } }, ptLabel(recPatient) || "Patient"), "  ·  Chart # ", el("b", { style: { color: "var(--ink)" } }, recPatient.patient_id)),
            recVisitsLoading && el("p", { className: "ip-empty" }, "Loading visits…"),
            !recVisitsLoading && recVisits.length === 0 && el("p", { className: "ip-empty" }, "No visits recorded for this patient."),
            !recVisitsLoading && recVisits.length > 0 && el("div", { style: { display: "flex", flexDirection: "column", gap: 8, maxHeight: 380, overflow: "auto" } }, recVisits.map(v => {
              const uTotal = v.upper_ipr ? sumContacts(jp(v.upper_ipr, {})) : 0;
              const lTotal = v.lower_ipr ? sumContacts(jp(v.lower_ipr, {})) : 0;
              return el("button", { key: v.id, type: "button", className: "ip-visit", onClick: () => openRecordReadOnly(recPatient, v) },
                el("div", { className: "top" }, el("b", null, v.date || v.visit_date || 'No date'), v.assistant_initials && el("span", { className: "ip-tag" }, v.assistant_initials)),
                el("div", { className: "meta" },
                  el("span", null, "Upper ", uTotal > 0 ? uTotal.toFixed(1) + " mm" : "—"),
                  el("span", null, "Lower ", lTotal > 0 ? lTotal.toFixed(1) + " mm" : "—"),
                  el("span", null, "Total ", (uTotal + lTotal) > 0 ? (uTotal + lTotal).toFixed(1) + " mm" : "—")));
            })),
            el("div", { className: "ip-dlg-foot" }, backBtn(() => setRecPatient(null)), closeBtn)));
    }

    return null;
  };

  // Patient details: the chart # and the full name of the patient on screen (the strip's Edit / Add full name). A saved patient
  // is saved here at once (with its history); a new one's details just change on screen until the first Save.
  const detailsImplRef = React.useRef(null);
  detailsImplRef.current = () => {
    const [ch, setCh] = React.useState(patient.patientId || '');
    const [nm, setNm] = React.useState(patient.name || '');
    const [busy, setBusy] = React.useState(false);
    const [msg, setMsg] = React.useState('');
    const [hint, setHint] = React.useState('');
    React.useEffect(() => {
      let off = false; setHint('');
      const t = setTimeout(async () => { const n = await iprCaseName(ch); if (!off) setHint(n); }, 300);
      return () => { off = true; clearTimeout(t); };
    }, [ch]);
    const save = async () => {
      if (!ch.trim() || !cleanName(nm)) { setMsg('Enter the chart # and the patient’s full name.'); return; }
      const others = (await IP.byChart(ch)).filter(x => !dbPatient || x.id !== dbPatient.id);
      if (others.length) { setMsg('Chart # ' + ch.trim() + ' belongs to another record here' + (ptLabel(others[0]) ? ' (' + ptLabel(others[0]) + ')' : '') + '.'); return; }
      if (!dbPatient) { setPatient(p => ({ ...p, patientId: ch.trim(), name: cleanName(nm) })); setFlowStep(null); return; }
      setBusy(true); setMsg('');
      try { const row = await IP.savePatient(dbPatient.id, { chart: ch.trim(), name: cleanName(nm) }, { a: 'details' }); setDbPatient(row); setFlowStep(null); }
      catch (e) { setMsg('Couldn’t save: ' + errText(e)); setBusy(false); }
    };
    const enter = e => { if (e.key === 'Enter') save(); };
    return el("div", { className: "ip-overlay", role: "dialog", "aria-modal": "true" },
      el("div", { className: "ip-dialog" },
        el("h2", { className: "ip-dlg-h" }, "Patient details"),
        el("p", { className: "ip-dlg-s" }, dbPatient ? "Saved to this patient’s record (every change is kept in its history)." : "This patient is saved with the first Save."),
        el("div", { className: "ip-form" },
          el("div", null,
            el("label", { className: "ip-label", htmlFor: "ip-pd-id" }, "Chart #"),
            el("input", { id: "ip-pd-id", type: "text", className: "ip-input", autoComplete: "off", value: ch, onChange: e => setCh(e.target.value), onKeyDown: enter })),
          el("div", null,
            el("label", { className: "ip-label", htmlFor: "ip-pd-name" }, "Full name"),
            el("input", { id: "ip-pd-name", type: "text", className: "ip-input", autoFocus: true, autoComplete: "off", spellCheck: false, value: nm, onChange: e => setNm(e.target.value), onKeyDown: enter, placeholder: "First and last name" }),
            hint && normName(hint) !== normName(nm) && el("div", { className: "ip-hint", style: { marginTop: 6 } }, "NLO Cases has ", el("b", null, hint), " for this chart # — ",
              el("button", { type: "button", className: "ip-link", onClick: () => setNm(hint) }, "use it")))),
        msg && el("p", { className: "ip-msg err", role: "alert" }, msg),
        el("div", { className: "ip-dlg-foot" },
          el("button", { type: "button", className: "ip-btn ok block", style: { minHeight: 48 }, disabled: busy, onClick: save }, busy ? "Saving…" : "Save"),
          el("button", { type: "button", className: "ip-btn quiet block", disabled: busy, onClick: () => setFlowStep(null) }, "Cancel"))));
  };
  const PatientDetails = React.useCallback(function IprPatientDetails() { return detailsImplRef.current(); }, []);

  // Stable wrapper: its identity never changes, so React keeps the wizard's state while App re-renders.
  // It simply runs the latest WizardImpl (which closes over the current App state).
  const wizardImplRef = React.useRef(null);
  wizardImplRef.current = WizardImpl;
  const WizardOverlay = React.useCallback(function IprWizard() { return wizardImplRef.current(); }, []);

  // Clear the whole working state and return to the "choose patient" wizard.
  // Used by the Cancel button and by handleSaveToRecord's post-save flow.
  const clearAllState = () => {
    draftClear();
    setMissingTeeth({});
    setPatient({ name: "", initials: "", patientId: "", date: localToday(), assistantInitials: "" });
    setUpper(initContacts(UPPER));
    setLower(initContacts(LOWER));
    setNotes("");
    setGaugeVerified(false);
    setUpperSpaces(initContacts(UPPER));
    setLowerSpaces(initContacts(LOWER));
    setUpperBT(initBT(UPPER));
    setLowerBT(initBT(LOWER));
    setPrescribedUpper(initContacts(UPPER));
    setPrescribedLower(initContacts(LOWER));
    setDbPatient(null);
    setVisitHistory([]);
    setCurrentVisitId(null);
    setShowHistory(false);
    setActiveTab("ipr");
    setSyncStatus("idle");
    setSyncMsg("");
    setReadOnly(false);
  };

  const handleCancel = () => {
    const hasWork = !!patient.patientId || !!dbPatient || sumContacts(upper) > 0 || sumContacts(lower) > 0 || notes.trim().length > 0;
    if (hasWork && !readOnly && !window.confirm("Cancel and discard this entry?\n\nThis will clear the current charting data and return to the patient picker. Any unsaved changes will be lost.")) return;
    clearAllState();
    setFlowStep("choose");
  };

  // Open the print preview popup window (shared by Print and Export buttons)
  const openPrintPreview = (mode) => {
    const printEl = document.querySelector('.print-only');
    if (!printEl) {
      alert('Unable to open preview — print view not found.');
      return;
    }
    const isExport = mode === 'export';
    openPrintWindow(printEl.innerHTML, isExport ? 'Save as PDF / Print' : 'Print', isExport ? '<span>Select "Save as PDF" as the printer to download</span>' : '');
  };

  // Save to patient record first, then open preview. Patient stays loaded.
  // In read-only mode (viewing an existing saved visit), skip the save step.
  const handleSaveAndPreview = async (mode) => {
    if (!patient.patientId && !dbPatient) {
      alert('No patient loaded — use the + button to start.');
      return;
    }
    if (readOnly) {
      openPrintPreview(mode);
      return;
    }
    const ok = await handleSaveToRecord({ keepOpen: true });
    if (ok === false) return; // save errored or deferred to wizard; don't open preview
    // Small delay so the "Saved ✓" status has a moment to paint, and DOM updates finish
    setTimeout(() => openPrintPreview(mode), 200);
  };

  // Export as PDF — saves to record first, then opens print preview with a "Save as PDF" button
  const handleExport = () => handleSaveAndPreview('export');
  // One wizard instance per "open": it keeps its own state while App re-renders underneath it,
  // and starts clean the next time it opens.
  const wizSeq = React.useRef({ open: false, n: 0 });
  if (flowStep !== null && !wizSeq.current.open) { wizSeq.current.open = true; wizSeq.current.n += 1; }
  else if (flowStep === null && wizSeq.current.open) { wizSeq.current.open = false; }

  const hasEarlier = !!((prevUpper && sumContacts(prevUpper) > 0) || (prevLower && sumContacts(prevLower) > 0));
  const whereOf = p => ptLabel(p) ? ptLabel(p) + " (chart # " + p.patient_id + ")" : "chart # " + p.patient_id;
  const spacesFlag = upperSpacesTotal > 0 || lowerSpacesTotal > 0 || upperBTCount > 0 || lowerBTCount > 0;
  const btAll = upperBTCount + lowerBTCount;
  const online = dbConnected === null ? null : dbConnected;

  // ── IPR tab ──
  const iprTab = () => el(React.Fragment, null,
    !readOnly && el(AmountPalette, { chipAmt: chipAmt, setChipAmt: setChipAmt }),
    el("div", { className: "ip-arches" },
      el(ArchDiagram, { lower: false, mode: "ipr", vals: upper, onVal: handleChange(setUpper), cumRef: prevUpper, readOnly: readOnly, chipAmt: chipAmt, missing: missingTeeth, onToggleMissing: toggleMissing }),
      el(ArchDiagram, { lower: true, mode: "ipr", vals: lower, onVal: handleChange(setLower), cumRef: prevLower, readOnly: readOnly, chipAmt: chipAmt, missing: missingTeeth, onToggleMissing: toggleMissing })),
    el("div", { className: "ip-metabar" },
      el("div", { className: "ip-legend" },
        el("span", null, el("i", { className: "ip-lg-chip" }), "IPR amount in mm (0.1–0.8)"),
        hasEarlier && el("span", null, el("i", { className: "ip-lg-pill" }), "IPR from earlier visits")),
      el("label", { className: cn("ip-gauge", gaugeVerified && "on", readOnly && "ro") },
        el("input", { type: "checkbox", checked: gaugeVerified, disabled: readOnly, onChange: e => { if (readOnly) return; setGaugeVerified(e.target.checked); } }),
        "Gauge verified")),
    !readOnly && el("div", { className: "ip-card" },
      el("div", { className: "ip-quick" },
        el("input", {
          type: "text", className: "ip-text", value: quickText, "aria-label": "Quick entry",
          onChange: e => setQuickText(e.target.value),
          onKeyDown: e => e.key === "Enter" && quickText.trim() && applyQuickEntry(),
          placeholder: "Quick entry — e.g. \"0.3 U3-3\" (canine to canine) or \"0.2 UR4-2\" (right side only)"
        }),
        el("button", { type: "button", className: "ip-btn primary", onClick: applyQuickEntry, disabled: !quickText.trim() }, "Apply")),
      quickMsg && el("div", { className: cn("ip-msg", quickMsg.type === "ok" ? "ok" : "err"), role: "status" }, quickMsg.text)),
    el("div", { className: "ip-card" },
      el("div", { className: "ip-stats" }, stat("Upper arch", upperTotal), stat("Lower arch", lowerTotal), stat("Total this visit", grandTotal, "hero")),
      dbPatient && visitHistory.length > 0 && el(React.Fragment, null,
        visitCount > 1 && el(React.Fragment, null,
          el("div", { className: "ip-stats-title cum" }, "Across all " + visitCount + " visits"),
          el("div", { className: "ip-stats" }, stat("Upper", cumUpperTotal, "cum"), stat("Lower", cumLowerTotal, "cum"), stat("Total", cumUpperTotal + cumLowerTotal, "cum"))),
        el("div", { className: "ip-cum-foot" },
          el("button", { type: "button", className: "ip-btn violet sm", onClick: () => setShowCumChart(true) }, el(Icon, { name: "chart", size: 16 }), "View cumulative chart by contact")))),
    (upperRows.length > 0 || lowerRows.length > 0) && el("div", { className: "ip-lists" },
      detailCard("Upper arch", upperRows, upperTotal, "upper", "No IPR recorded"),
      detailCard("Lower arch", lowerRows, lowerTotal, "lower", "No IPR recorded")),
    el("div", { className: "ip-card" },
      el("label", { className: "ip-label", htmlFor: "ip-notes" }, "Clinical notes"),
      el("textarea", {
        id: "ip-notes", className: "ip-text", value: notes, readOnly: readOnly, rows: 3,
        onChange: e => { if (readOnly) return; setNotes(e.target.value); },
        placeholder: "Add clinical notes, observations, or next appointment instructions…"
      })));

  // ── Spaces & black triangles tab ──
  const spacesTab = () => el(React.Fragment, null,
    !readOnly && el(AmountPalette, { chipAmt: spaceChipAmt, setChipAmt: setSpaceChipAmt, amounts: SPACE_CHIP_AMOUNTS, spaces: true }),
    el("div", { className: "ip-arches" },
      el(ArchDiagram, { lower: false, mode: "spaces", vals: upperSpaces, bt: upperBT, onVal: handleChange(setUpperSpaces), onBT: handleChange(setUpperBT), readOnly: readOnly, chipAmt: spaceChipAmt, missing: missingTeeth, onToggleMissing: toggleMissing }),
      el(ArchDiagram, { lower: true, mode: "spaces", vals: lowerSpaces, bt: lowerBT, onVal: handleChange(setLowerSpaces), onBT: handleChange(setLowerBT), readOnly: readOnly, chipAmt: spaceChipAmt, missing: missingTeeth, onToggleMissing: toggleMissing })),
    el("div", { className: "ip-metabar" },
      el("div", { className: "ip-legend" },
        el("span", null, el("i", { className: "ip-lg-chip", style: { background: "var(--teal)" } }), "Residual space in mm"),
        el("span", null, el("span", { style: { display: "inline-block", verticalAlign: "-1px", marginRight: 6, color: "#111827" } }, el(TriMark, { size: 12 })), "Black triangle: tap the triangle at a contact"))),
    el("div", { className: "ip-card" },
      el("div", { className: "ip-stats four" },
        stat("Upper spaces", upperSpacesTotal, "sp"), stat("Lower spaces", lowerSpacesTotal, "sp"),
        countStat("Upper black triangles", upperBTCount), countStat("Lower black triangles", lowerBTCount))),
    (upperSpacesRows.length > 0 || lowerSpacesRows.length > 0 || upperBTRows.length > 0 || lowerBTRows.length > 0) && el("div", { className: "ip-lists" },
      upperSpacesRows.length > 0 && detailCard("Upper spaces", upperSpacesRows, upperSpacesTotal, "sp", ""),
      lowerSpacesRows.length > 0 && detailCard("Lower spaces", lowerSpacesRows, lowerSpacesTotal, "sp", ""),
      upperBTRows.length > 0 && btCard("Upper black triangles", upperBTRows),
      lowerBTRows.length > 0 && btCard("Lower black triangles", lowerBTRows)));

  // ── Chart note tab ──
  const noteTab = () => el("div", { className: "ip-card" },
    el("div", { className: "ip-row", style: { justifyContent: "space-between", alignItems: "flex-start" } },
      el("div", null,
        el("h3", null, "Chart note"),
        el("div", { className: "ip-hint" }, "Plain text for the patient's chart — Palmer notation, arch order.")),
      el("div", { className: "ip-seg", role: "group", "aria-label": "Note format" },
        [["narrative", "Narrative"], ["lines", "Labeled lines"], ["compact", "Compact"]].map(([v, lab]) =>
          el("button", { key: v, type: "button", className: cn(noteFormat === v && "active"), "aria-pressed": noteFormat === v, onClick: () => setFmt(v) }, lab)))),
    el("div", { className: "ip-checks" },
      el("label", null,
        el("input", { type: "checkbox", checked: noteIncIPR, onChange: e => { setNoteIncIPR(e.target.checked); prefSave("ipr_note_inc_ipr", e.target.checked); } }),
        "IPR this visit"),
      el("label", { className: cn(visitCount <= 1 && "dis"), title: visitCount > 1 ? "" : "Needs more than one visit on file" },
        el("input", { type: "checkbox", checked: noteIncCum, disabled: visitCount <= 1, onChange: e => { setNoteIncCum(e.target.checked); prefSave("ipr_note_inc_cum", e.target.checked); } }),
        "Cumulative IPR" + (visitCount > 1 ? " (" + visitCount + " visits)" : "")),
      el("span", { className: "ip-hint", style: { marginLeft: "auto" } }, "Spacing & black triangles always included")),
    el("textarea", {
      className: "ip-text ip-mono", value: noteText, onChange: e => setNoteText(e.target.value), spellCheck: false, "aria-label": "Chart note text",
      style: { minHeight: noteFormat === "lines" ? 220 : 140 },
      // grow to fit the whole note so nothing is hidden below the fold of the box
      ref: node => { if (node) { node.style.height = "auto"; node.style.height = Math.max(node.scrollHeight + 2, noteFormat === "lines" ? 220 : 140) + "px"; } }
    }),
    el("div", { className: "ip-row", style: { marginTop: 12 } },
      el("button", { type: "button", className: cn("ip-btn", noteCopied ? "ok" : "primary"), onClick: copyChartNote },
        el(Icon, { name: noteCopied ? "check" : "copy", size: 17 }), noteCopied ? "Copied" : "Copy to clipboard"),
      noteEdited && el("button", { key: "reset", type: "button", className: "ip-btn", onClick: () => setNoteText(generatedNote), title: "Discard your edits and rebuild from the charted values" },
        el(Icon, { name: "reset", size: 16 }), "Reset"),
      noteEdited && el("span", { key: "ed", className: "ip-edited" }, "Edited by hand"),
      el("span", { className: "ip-hint", style: { marginLeft: "auto" } }, "Rebuilds automatically when you change a value")));

  const tabBtn = (id, label, extra) => el("button", {
    key: id, type: "button", role: "tab", id: "ip-tab-" + id, "aria-selected": activeTab === id, "aria-controls": "ip-panel",
    className: cn("ip-tab", activeTab === id && "active"), onClick: () => setActiveTab(id),
    title: id === "note" ? "Plain-text summary to paste into the patient's chart" : undefined
  }, label, extra);

  return el(React.Fragment, null,
    flowStep !== null && el(WizardOverlay, { key: "wiz" + wizSeq.current.n }),
    el("div", { className: "ip-app no-print" },
      el("div", { className: "ip-shell" },

        // ── header ──
        el("div", { className: "ip-top" },
          el("div", null,
            el("h1", { className: "ip-title" }, "IPR tracker", el("small", null, "v4.0 · chairside")),
            el("div", { className: "ip-sub" },
              el("span", null, "Interproximal reduction · Palmer notation · IPR completed at this visit"),
              saved && el("span", { style: { color: "var(--ok)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 } }, el(Icon, { name: "check", size: 14 }), "Draft saved"))),
          el("div", { className: "ip-actions" },
            el("button", { type: "button", className: "ip-btn primary", onClick: () => setFlowStep('choose'), title: "Start a new visit or load a patient" }, el(Icon, { name: "plus", size: 18 }), "New visit"),
            el("button", { type: "button", className: "ip-btn", onClick: () => handleSaveAndPreview('print') }, el(Icon, { name: "print", size: 17 }), "Print"),
            el("div", { className: "ip-menu-wrap" },
              el("button", { type: "button", className: "ip-btn icon", onClick: () => setShowMenu(m => !m), "aria-haspopup": "menu", "aria-expanded": showMenu, "aria-label": "More actions", title: "More: Records, Export PDF, Blank form, Lock" }, el(Icon, { name: "more", size: 20 })),
              showMenu && el(React.Fragment, null,
                el("div", { className: "ip-menu-scrim", onClick: () => setShowMenu(false) }),
                el("div", { className: "ip-menu", role: "menu" },
                  el("button", { type: "button", role: "menuitem", onClick: () => { setShowMenu(false); setFlowStep('records'); } }, el(Icon, { name: "users", size: 18 }), "Patient records"),
                  el("button", { type: "button", role: "menuitem", onClick: () => { setShowMenu(false); handleExport(); } }, el(Icon, { name: "download", size: 18 }), "Export as PDF"),
                  el("button", { type: "button", role: "menuitem", onClick: printBlankForm }, el(Icon, { name: "file", size: 18 }), "Print blank form"),
                  FB.isOwner() && el("button", { type: "button", role: "menuitem", className: "ip-mi-old", onClick: () => { setShowMenu(false); rmOpen(); } }, el(Icon, { name: "trash", size: 18 }), S.removed ? "Old copy: check again" : "Remove the old copy"),
                  el("div", { className: "ip-menu-sep", role: "separator" }),
                  el("div", { className: "ip-menu-who" }, "Signed in as ", el("b", null, firstName(FB.me && FB.me.name) || (FB.me && FB.me.staffId) || "")),
                  el("button", { type: "button", role: "menuitem", id: "ip-lock", onClick: () => { setShowMenu(false); appLock(); } }, el(Icon, { name: "lock", size: 18 }), "Lock")))))),

        readOnly && el("div", { className: "ip-banner", role: "status" }, el(Icon, { name: "lock", size: 18 }), el("span", null, "Viewing a saved visit (read-only). Start a new visit to make changes.")),

        // ── patient strip ──
        patient.patientId ? el("div", { className: "ip-strip" },
          el("div", { className: "ip-who" },
            el("div", { className: "ip-avatar", "aria-hidden": "true" }, avatarOf(patient)),
            el("div", { className: "ip-who-t" },
              el("b", null, patient.name || (patient.initials ? "Initials " + patient.initials : "Chart # " + patient.patientId)),
              el("span", null, (patient.name || patient.initials) ? "Chart # " + patient.patientId : "No name yet",
                !readOnly && el("button", { type: "button", className: "ip-link", onClick: () => setFlowStep('details'), title: "Change the chart # or the patient’s name" }, patient.name ? "Edit" : "Add full name")))),
          el("div", { className: "ip-field" },
            el("label", { htmlFor: "ip-date" }, "Visit date"),
            el("input", { id: "ip-date", className: "ip-input", type: "date", value: patient.date || "", disabled: readOnly, onChange: e => setPatient(p => ({ ...p, date: e.target.value })) })),
          el("div", { className: "ip-field" },
            el("label", { htmlFor: "ip-asst" }, "Assistant"),
            el(IprAsstSelect, {          // list comes from the shared staff roster (Staff Hub); see IprAsstSelect
              id: "ip-asst", className: "ip-select", blank: "—", value: patient.assistantInitials || "", disabled: readOnly,
              onChange: e => { try { localStorage.setItem('ipr_last_asst', e.target.value); } catch (err) {} setPatient(p => ({ ...p, assistantInitials: e.target.value })); }
            })),
          el("div", { className: "ip-status" },
            !readOnly && el("span", { className: "ip-sv", title: "Changes save automatically a moment after you stop editing" },
              el("i", { className: cn("ip-dot", syncStatus === "error" ? "bad" : syncStatus === "saving" ? "busy" : lastSavedAt ? "ok" : "") }),
              syncStatus === "saving" ? "Saving…" : syncStatus === "error" ? "Save failed" : lastSavedAt ? "Saved " + lastSavedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Autosave on"),
            visitHistory.length > 0 && el("span", { className: "ip-sv" }, visitHistory.length + " visit" + (visitHistory.length > 1 ? "s" : "") + " on file"),
            online !== null && el("span", {
              className: "ip-sv",
              title: online ? "Database connected" + (dbPatientCount !== null ? " · " + dbPatientCount + " patient" + (dbPatientCount !== 1 ? "s" : "") : "") : "Database not reachable — check internet connection"
            }, el("i", { className: cn("ip-dot", online ? "ok" : "bad") }), online ? "Connected" : "Offline")))
        : el("div", { className: "ip-empty-strip" },
            el("div", null, el("b", null, "No patient loaded."), " Choose a patient to start charting."),
            el("button", { type: "button", className: "ip-btn primary", onClick: () => setFlowStep('choose') }, el(Icon, { name: "plus", size: 18 }), "Start a visit")),

        // ── tabs ──
        el("div", { className: "ip-tabs", role: "tablist", "aria-label": "Chart sections" },
          tabBtn("ipr", "IPR"),
          tabBtn("spaces", "Spaces & black triangles", spacesFlag && el("span", { className: "ip-badge" },
            btAll > 0 && el("span", { className: "bt", title: btAll + " black triangle" + (btAll > 1 ? "s" : "") }, el(TriMark, { size: 9 }), btAll),
            upperSpacesTotal + lowerSpacesTotal > 0 && el("span", { className: "sp", title: "Residual space" }, (upperSpacesTotal + lowerSpacesTotal).toFixed(1) + " mm"))),
          tabBtn("note", "Chart note")),

        el("div", { id: "ip-panel", role: "tabpanel", "aria-labelledby": "ip-tab-" + activeTab },
          activeTab === "ipr" && iprTab(),
          activeTab === "spaces" && spacesTab(),
          activeTab === "note" && noteTab()),

        // ── save bar ──
        el("div", { className: "ip-foot" },
          el("button", {
            type: "button", className: cn("ip-btn", readOnly ? "" : saveTone), onClick: handleSaveToRecord,
            disabled: syncStatus === "saving" || readOnly,
            title: readOnly ? "Viewing a saved visit — start a new visit to make changes" : "Save to patient record"
          }, readOnly ? "Saved (read-only)" : saveLabel),
          el("button", { type: "button", className: "ip-btn", onClick: handleCancel, title: "Discard this entry and return to the patient picker" }, "Cancel"),
          syncMsg && el("span", { className: cn("msg", syncStatus === "error" && "err"), role: "status" }, syncMsg),
          el("span", { className: "where" }, readOnly && dbPatient ? "Viewing saved visit — " + whereOf(dbPatient) : dbPatient ? "Saving to: " + whereOf(dbPatient) : patient.patientId ? "New patient — saved with the first Save" : "No patient selected — Save will prompt you to pick one")))),

    el(PrintChart, {
      upper: upper,
      lower: lower,
      patient: patient,
      notes: notes,
      gaugeVerified: gaugeVerified,
      upperSpaces: upperSpaces,
      lowerSpaces: lowerSpaces,
      upperBT: upperBT,
      lowerBT: lowerBT,
      blank: printBlank,
      cumUpper: cumUpper,
      cumLower: cumLower,
      visitCount: visitCount,
      missing: missingTeeth,
      prevUpper: prevUpper,
      prevLower: prevLower
    }),
    showCumChart && cumUpper && el(CumulativeChart, {
      cumUpper: cumUpper,
      cumLower: cumLower || initContacts(LOWER),
      visitCount: visitCount,
      onClose: () => setShowCumChart(false)
    }));
}
// ─── Mounting: lock.js opens the app once the office key is open and the records have moved (the lock reloads the page) ───
function mountApp(draft, deep) {
  APP_DRAFT = draft || null; APP_DEEP = deep || null;
  const rootEl = document.getElementById("root");
  rootEl.classList.remove("hidden");
  ReactDOM.createRoot(rootEl).render(React.createElement(App, null));
}
