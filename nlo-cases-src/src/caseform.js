/* =====================================================================
   New case / edit form — tap first, type only the patient's name.
   Choices mirror the office's Tally "Appliance submission form" so
   nothing is lost moving off Tally (assistant, scanner, appliance and
   aligner type, lab, initial submission, Dr. A's instructions, extras).
   ===================================================================== */
const PICK = {
  appliances: ['Herbst with Rollo Band', 'Space Closing Herbst', 'Rapid Palatal Expander (RPE)', 'Finger spring with no labial bow', 'Hawley retainers', 'MARPE', 'Schwartz'],
  labs: ['Specialty Lab', 'Partner Dental Studio', 'In-house (NL Lab)'],
  scanners: ['Allied Star', 'iTero'],
  instr: ['Close all remaining residual spaces/gaps', 'Needs settling of posterior occlusion', 'Resolve black triangles', 'Anterior bite opening mechanics', 'Anterior open bite mechanics',
    'Aligners are not tracking well', 'Need to change attachment/hooks on one or more teeth', 'Class II correction is needed', 'Class III correction is needed',
    'Midline needs to be corrected', 'No posterior teeth movement', 'Active retention', 'Accepting current OJ/OB'],
  extras: ['No IPR', 'No elastics', 'Mid-course correction', 'Next Level Express (5 aligners or less)'],
  arches: ['Upper', 'Lower'], retKinds: ['TT’s', 'WT’s']
};
/* lab routing from the office KB: Partners = RPE, Schwartz, Hawley, finger spring, MARPE; Specialty = Herbst */
const LAB_FOR = { 'Herbst with Rollo Band': 'Specialty Lab', 'Space Closing Herbst': 'Specialty Lab', 'Rapid Palatal Expander (RPE)': 'Partner Dental Studio', 'Finger spring with no labial bow': 'Partner Dental Studio', 'Hawley retainers': 'Partner Dental Studio', 'MARPE': 'Partner Dental Studio', 'Schwartz': 'Partner Dental Studio' };
const TILES = [
  { v: 'oliv', l: 'Oliv', s: 'Aligners' }, { v: 'nla', l: 'In-house', s: 'Aligners · NL Lab' }, { v: 'finishing', l: 'Finishing aligners', s: 'In-house · NL Lab' },
  { v: 'retainer', l: 'Retainers', s: 'TT’s / WT’s' }, { v: 'appliance', l: 'Appliance', s: 'Herbst, RPE, MARPE…' },
  { v: 'angel', l: 'Angel', s: 'Aligners' }, { v: 'ulab', l: 'uLab', s: 'Aligners' }, { v: 'invisalign', l: 'Invisalign', s: 'Aligners' },
  { v: 'inbrace', l: 'InBrace / Brava', s: 'Lingual' }, { v: 'retreat', l: 'Retreatment', s: 'Review & proposal' }, { v: 'misc', l: 'Dr. A (misc.)', s: 'Study models, TxP…' }
];
const ALIGNERISH = ['oliv', 'angel', 'invisalign', 'ulab', 'nla', 'finishing', 'inbrace'];
/* tiles that are in-house (NL Lab) aligner cases */
const INHOUSE_TILES = ['nla', 'finishing'];
function groupOfTile(v) { return ALIGNERISH.includes(v) ? 'aligner' : v === 'appliance' ? 'appliance' : v === 'retainer' ? 'retainer' : 'other'; }
const FORM_KEYS = ['type', 'patient', 'chart', 'detail', 'stage', 'assignee', 'assistant', 'scanner', 'scanDate', 'dueDate', 'labDate', 'deliveryDate',
  'initial', 'appliances', 'lab', 'arches', 'retKinds', 'instrPicks', 'instrOther', 'instructions', 'extras', 'teeth', 'cc', 'ipr', 'notes', 'titanUrl'];

/* ---------- tooth chart (Palmer, 7s to 7s, same teeth as the IPR Tracker) ---------- */
const TEETH_U = ['UR7', 'UR6', 'UR5', 'UR4', 'UR3', 'UR2', 'UR1', 'UL1', 'UL2', 'UL3', 'UL4', 'UL5', 'UL6', 'UL7'];
const TEETH_L = ['LR7', 'LR6', 'LR5', 'LR4', 'LR3', 'LR2', 'LR1', 'LL1', 'LL2', 'LL3', 'LL4', 'LL5', 'LL6', 'LL7'];
const ANTERIORS = ['UR3', 'UR2', 'UR1', 'UL1', 'UL2', 'UL3', 'LR3', 'LR2', 'LR1', 'LL1', 'LL2', 'LL3'];
const POSTERIORS = TEETH_U.concat(TEETH_L).filter(k => !ANTERIORS.includes(k));
const MARKS = [
  { k: 'noatt', l: 'No attachment', s: 'NA' }, { k: 'implant', l: 'Implant', s: 'Im' }, { k: 'pontic', l: 'Pontic', s: 'P' },
  { k: 'missing', l: 'Missing', s: '×' }, { k: 'nomove', l: 'Don’t move', s: 'DM' }
];
/* teeth object in a fixed order so saved copies compare equal */
function canonTeeth(t) {
  const out = {}; t = t || {};
  TEETH_U.concat(TEETH_L).forEach(k => { const m = MARKS.map(x => x.k).filter(x => (t[k] || []).includes(x)); if (m.length) out[k] = m; });
  return out;
}
/* "No attachment: UR3 to UL3, LR3 to LL3" — runs of 3+ neighbours become "to" ranges
   (a dash would read like an IPR contact) */
function teethSummary(t) {
  t = canonTeeth(t); const lines = [];
  const all = TEETH_U.concat(TEETH_L);
  const same = (a, b) => a.length === b.length && a.every(k => b.includes(k));
  MARKS.forEach(m => {
    const on = all.filter(k => (t[k] || []).includes(m.k));
    if (on.length && same(on, all)) { lines.push(m.l + ': all teeth'); return; }
    if (on.length && same(on, ANTERIORS)) { lines.push(m.l + ': all anteriors (3–3)'); return; }
    if (on.length && same(on, POSTERIORS)) { lines.push(m.l + ': all posteriors (4–7)'); return; }
    const parts = [];
    [TEETH_U, TEETH_L].forEach(arch => {
      let run = [];
      const flush = () => { if (run.length >= 3) parts.push(run[0] + ' to ' + run[run.length - 1]); else parts.push.apply(parts, run); run = []; };
      arch.forEach(k => { if ((t[k] || []).includes(m.k)) run.push(k); else flush(); }); flush();
    });
    if (parts.length) lines.push(m.l + ': ' + parts.join(', '));
  });
  return lines.join('\n');
}
function toothBtn(k, marks, ro) {
  const num = k.slice(2), m = MARKS.filter(x => (marks || []).includes(x.k));
  const label = k + (m.length ? ': ' + m.map(x => x.l).join(', ') : '');
  return '<button type="button" class="tooth' + m.map(x => ' m-' + x.k).join('') + '" data-t="' + k + '" aria-label="' + esc(label) + '" title="' + esc(label) + '"' + (ro ? ' disabled' : '') + '><b>' + num + '</b><small>' + esc(m.map(x => x.s).join(' ')) + '</small></button>';
}
function toothChartHTML(t, ro) {
  t = canonTeeth(t);
  const arch = (teeth, lbl) => '<div class="tcArch"><span class="tcLbl">' + lbl + '</span>' + teeth.slice(0, 7).map(k => toothBtn(k, t[k], ro)).join('') + '<i class="tcMid" aria-hidden="true"></i>' + teeth.slice(7).map(k => toothBtn(k, t[k], ro)).join('') + '</div>';
  return '<div class="tcGrid">' + arch(TEETH_U, 'U') + arch(TEETH_L, 'L') + '</div>';
}
function safeUrl(u) { return /^https:\/\/[^\s<>"']+$/i.test(String(u || '').trim()) ? String(u).trim() : ''; }
function sameVal(a, b) { return JSON.stringify(a == null ? '' : a) === JSON.stringify(b == null ? '' : b); }
/* the next n clinic days (the office is open Monday–Thursday) */
function addClinicDays(iso, n) {
  let d = iso; let left = n;
  while (left > 0) { d = addDays(d, 1); const [y, m, dd] = d.split('-').map(Number); const wd = new Date(y, m - 1, dd).getDay(); if (wd >= 1 && wd <= 4) left--; }
  return d;
}
function defaultAssignee(type) {
  const d = (S.settings.defaults || {})[type]; if (d && staff(d) && staff(d).active) return d;
  const byFirst = n => (activeRoster().find(r => firstName(r.name).toLowerCase() === n) || {}).sid || '';
  const owner = (activeRoster().find(r => r.role === 'owner') || {}).sid || '';
  if (['oliv', 'angel', 'invisalign', 'appliance'].includes(type)) return byFirst('sarah') || '';
  if (['ulab', 'inbrace', 'retainer'].includes(type)) return meSid();
  return owner;
}
/* the patient's CC phrases this office uses most (learned from decrypted cases, in this browser only) */
function learnedCCs() {
  const n = {};
  Array.from(S.cases.values()).concat(S.closed || []).forEach(c => {
    const t = String(c.cc || '').trim(); if (t.length < 3 || t.length > 90 || /^(-|na|n\/a|none)$/i.test(t)) return;
    const k = t.toLowerCase(); n[k] = n[k] || { t, c: 0 }; n[k].c++;
  });
  return Object.values(n).filter(x => x.c >= 2).sort((a, b) => b.c - a.c).slice(0, 6).map(x => x.t);
}
function pickRow(group, options, chosen, multi, extraCls) {
  const on = v => multi ? (chosen || []).includes(v) : chosen === v;
  return '<div class="pickRow" role="group" data-g="' + group + '" data-multi="' + (multi ? 1 : 0) + '">' + options.map(o => {
    const v = typeof o === 'string' ? o : o.v; const l = typeof o === 'string' ? o : o.l;
    return '<button type="button" class="pick' + (extraCls ? ' ' + extraCls : '') + '" data-v="' + esc(v) + '" aria-pressed="' + on(v) + '">' + esc(l) + '</button>';
  }).join('') + '</div>';
}
function caseFormHTML(c, isNew) {
  c = c || {};
  const tile = c.type === 'nla' && c.variant === 'finishing' ? 'finishing' : (c.type || '');
  const g = groupOfTile(tile);
  const show = (groups) => ' data-show="' + groups + '"' + (groups.split(' ').includes(g) ? '' : ' style="display:none"');
  const roster = activeRoster().filter(r => r.role !== 'owner');
  const stages = c.type ? FLOWS[TYPE[c.type].flow].stages : [];
  const opt = (v, l, sel) => '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(l) + '</option>';
  const people = (sel, none) => opt('', none) + activeRoster().map(r => opt(r.sid, r.name, sel === r.sid)).join('');
  const date = (id, l, v) => '<div class="field"><label for="' + id + '">' + l + '</label><input type="date" id="' + id + '" value="' + esc(v || '') + '"></div>';
  const instrOther = c.instrOther != null ? c.instrOther : ((c.instrPicks || []).length ? '' : (c.instructions || ''));
  const ccs = learnedCCs();
  return '<div class="cf" data-new="' + (isNew ? 1 : 0) + '">' +
    '<div class="cfSec"><h5>Case type</h5><div class="tileGrid" role="radiogroup" aria-label="Case type">' + TILES.map(t =>
      '<button type="button" class="tt" role="radio" data-tile="' + t.v + '" aria-checked="' + (tile === t.v) + '"><b>' + esc(t.l) + '</b><span>' + esc(t.s) + '</span></button>').join('') + '</div></div>' +
    '<div class="cfSec"><div class="grid2"><div class="field"><label for="cf-patient">Patient name *</label><input id="cf-patient" autocomplete="off" value="' + esc(c.patient || '') + '" required></div>' +
    '<div class="field"><label for="cf-chart">Chart #</label><input id="cf-chart" autocomplete="off" spellcheck="false" inputmode="text" placeholder="For the IPR Tracker link" value="' + esc(c.chart || '') + '"></div></div></div>' +
    '<div class="cfSec"' + show('appliance') + '><h5>Appliance</h5>' + pickRow('appliances', PICK.appliances, c.appliances || [], true) +
    '<h5>Lab</h5>' + pickRow('lab', PICK.labs, c.lab || '', false) + '</div>' +
    '<div class="cfSec"' + show('retainer') + '><h5>Arch</h5>' + pickRow('arches', PICK.arches, c.arches || [], true) + '<h5>Making</h5>' + pickRow('retKinds', PICK.retKinds, c.retKinds || [], true) + '</div>' +
    '<div class="cfSec"' + show('aligner appliance') + '><h5>Initial submission?</h5>' + pickRow('initial', [{ v: 'yes', l: 'Yes — first set' }, { v: 'no', l: 'No — refinement' }], c.initial || '', false) + '</div>' +
    '<div class="cfSec"><h5>Assistant</h5>' + pickRow('assistant', roster.map(r => ({ v: r.sid, l: firstName(r.name) })), c.assistant || '', false) +
    '<div' + show('aligner appliance retainer') + '><h5>Scanner</h5>' + pickRow('scanner', PICK.scanners, c.scanner || '', false) + '</div></div>' +
    '<div class="cfSec"><h5>Dates</h5><div class="pickRow" style="margin-bottom:8px"><button type="button" class="pick sm" data-scan="0">Scanned today</button><button type="button" class="pick sm" data-scan="-1">Yesterday</button></div>' +
    '<div class="grid4">' + date('cf-scanDate', 'Scan date', c.scanDate) + date('cf-dueDate', g === 'aligner' ? 'Due for Dr. A' : 'Due date', c.dueDate) + date('cf-labDate', 'Lab completion', c.labDate) + date('cf-deliveryDate', 'Delivery', c.deliveryDate) + '</div>' +
    '<div class="hint small muted" id="cf-autoHint" style="margin:-4px 0 0">Filled in from the scan date — change any of them.</div></div>' +
    '<div class="cfSec"' + show('aligner') + '><h5>Dr. A’s instructions from last visit</h5>' + pickRow('instrPicks', PICK.instr, c.instrPicks || [], true) +
    '<div class="field" style="margin-top:8px"><label for="cf-instrOther">Other instructions</label><textarea id="cf-instrOther" rows="2" placeholder="Only if it isn’t one of the buttons">' + esc(instrOther) + '</textarea></div>' +
    '<h5>Tooth chart</h5><div class="tc" id="cf-tc"><div class="pickRow tcTools" role="radiogroup" aria-label="Marker">' +
    MARKS.map((m, i) => '<button type="button" class="pick sm tool m-' + m.k + '" data-tool="' + m.k + '" role="radio" aria-checked="' + (i === 0) + '">' + esc(m.l) + '</button>').join('') +
    '<span class="tcSep"></span><button type="button" class="pick sm" data-tq="ant">Anteriors 3–3</button><button type="button" class="pick sm" data-tq="post">Posteriors 4–7</button><button type="button" class="pick sm" data-tq="all">All teeth</button><button type="button" class="pick sm" data-tq="clear">Clear</button></div>' +
    '<div id="cf-tcChart">' + toothChartHTML(c.teeth, false) + '</div><div class="tcSum" id="cf-teethSum">' + esc(teethSummary(c.teeth) || 'Tap a marker, then tap teeth.') + '</div>' +
    '<input type="hidden" id="cf-teeth" value="' + esc(JSON.stringify(canonTeeth(c.teeth))) + '"></div>' +
    '<h5>Also</h5>' + pickRow('extras', PICK.extras, c.extras || [], true) + '</div>' +
    '<div class="cfSec"' + show('aligner appliance') + '><h5>Patient’s CC from last visit</h5>' +
    '<div class="pickRow" data-cc="1">' + ['None'].concat(ccs).map(t => '<button type="button" class="pick sm" data-cc="' + esc(t) + '">' + esc(t) + '</button>').join('') + '</div>' +
    '<div class="field" style="margin-top:8px"><label for="cf-cc" class="hidden">Patient’s CC</label><input id="cf-cc" autocomplete="off" placeholder="Tap above or type" value="' + esc(c.cc || '') + '"></div></div>' +
    '<div class="cfSec"' + show('aligner') + '><div class="field"><label for="cf-ipr" style="display:flex;align-items:center;gap:8px">IPR, spacing &amp; black triangles<span style="flex:1"></span><button type="button" class="btn btn-ghost" data-act="iprPull" style="min-height:30px;padding:2px 10px;font-size:12px">' + ic('download', 14) + 'Get from IPR Tracker</button></label>' +
    '<textarea id="cf-ipr" rows="3" placeholder="Tap “Get from IPR Tracker” (uses the chart #)">' + esc(c.ipr || '') + '</textarea><div class="hint" id="cf-iprMsg"></div></div></div>' +
    '<div class="cfSec" id="cf-titanWrap"' + show(INHOUSE_TILES.includes(tile) ? g : '__never') + '><div class="field"><label for="cf-titanUrl">Titan link</label><input id="cf-titanUrl" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://… (Titan’s shared web-viewer link)" value="' + esc(c.titanUrl || '') + '"></div></div>' +
    '<details class="cfMore"' + (isNew ? '' : ' open') + '><summary>More: what’s being made, stage, who it’s assigned to, notes</summary>' +
    '<div class="grid2" style="margin-top:12px"><div class="field"><label for="cf-detail">What’s being made</label><input id="cf-detail" value="' + esc(c.detail || '') + '" data-auto="' + (isNew || !c.detail ? 1 : 0) + '"></div>' +
    '<div class="field"><label for="cf-stage">Stage</label><select id="cf-stage">' + stages.map(([k, l]) => opt(k, l, (c.stage || (stages[0] || [])[0]) === k)).join('') + '</select></div></div>' +
    '<div class="grid2"><div class="field"><label for="cf-assignee">Assigned to</label><select id="cf-assignee">' + people(c.assignee, 'Unassigned') + '</select></div><div></div></div>' +
    '<div class="field"><label for="cf-notes">Notes</label><textarea id="cf-notes" rows="2">' + esc(c.notes || '') + '</textarea></div></details>' +
    '<input type="hidden" id="cf-tile" value="' + esc(tile) + '"></div>';
}
function pressed(root, g) { return $$('.pickRow[data-g="' + g + '"] .pick[aria-pressed="true"]', root).map(b => b.dataset.v); }
function readCaseForm(root) {
  const tile = $('#cf-tile', root).value;
  const o = { type: INHOUSE_TILES.includes(tile) ? 'nla' : tile, variant: tile === 'finishing' ? 'finishing' : '' };
  ['patient', 'chart', 'detail', 'stage', 'assignee', 'scanDate', 'dueDate', 'labDate', 'deliveryDate', 'instrOther', 'cc', 'ipr', 'notes', 'titanUrl'].forEach(k => { const el = $('#cf-' + k, root); o[k] = el ? String(el.value || '').trim() : ''; });
  o.assistant = pressed(root, 'assistant')[0] || '';
  o.scanner = pressed(root, 'scanner')[0] || '';
  o.initial = pressed(root, 'initial')[0] || '';
  o.lab = pressed(root, 'lab')[0] || '';
  o.appliances = pressed(root, 'appliances'); o.arches = pressed(root, 'arches'); o.retKinds = pressed(root, 'retKinds');
  o.instrPicks = pressed(root, 'instrPicks'); o.extras = pressed(root, 'extras');
  try { o.teeth = canonTeeth(JSON.parse($('#cf-teeth', root).value || '{}')); } catch (e) { o.teeth = {}; }
  o.teethNote = teethSummary(o.teeth);
  const g = groupOfTile(tile);
  if (g !== 'aligner') { o.instrPicks = []; o.extras = []; o.teeth = {}; o.teethNote = ''; }
  if (g !== 'appliance') { o.appliances = []; o.lab = ''; }
  if (g !== 'retainer') { o.arches = []; o.retKinds = []; }
  if (!(o.type === 'nla')) o.titanUrl = '';
  o.instructions = o.instrPicks.concat(o.instrOther ? [o.instrOther] : []).join('; ');
  return o;
}
/* what's being made, from the taps */
function autoDetail(o, tile) {
  const t = TILES.find(x => x.v === tile);
  if (tile === 'finishing') return 'Finishing aligners' + (o.initial === 'no' ? ' – refinement' : '');
  if (['oliv', 'angel', 'invisalign', 'ulab', 'nla'].includes(tile)) return 'Aligners (' + (tile === 'nla' ? 'In-House' : t.l) + ')' + (o.initial === 'no' ? ' – refinement' : '');
  if (tile === 'inbrace') return 'InBrace/Brava' + (o.initial === 'no' ? ' – refinement' : '');
  if (tile === 'appliance') return o.appliances.join(', ');
  if (tile === 'retainer') {
    const arch = o.arches.length === 2 ? 'U/L' : o.arches[0] === 'Upper' ? 'U' : o.arches[0] === 'Lower' ? 'L' : '';
    const kinds = o.retKinds.join(' and ');
    return [arch, kinds].filter(Boolean).join(' ');
  }
  return '';
}
function wireCaseForm(root, isNew) {
  const $r = s => $(s, root);
  const autoIds = ['cf-dueDate', 'cf-labDate', 'cf-deliveryDate'];
  autoIds.forEach(id => { const el = $r('#' + id); el.dataset.auto = (isNew && !el.value) ? '1' : '0'; el.addEventListener('input', () => { el.dataset.auto = '0'; }); });
  const det = $r('#cf-detail'); det.addEventListener('input', () => { det.dataset.auto = '0'; });
  const refresh = (typeChanged) => {
    const tile = $r('#cf-tile').value; const g = groupOfTile(tile); const o = readCaseForm(root);
    $$('[data-show]', root).forEach(el => { el.style.display = el.dataset.show.split(' ').includes(g) ? '' : 'none'; });
    const tw = $r('#cf-titanWrap'); if (tw) tw.style.display = INHOUSE_TILES.includes(tile) ? '' : 'none';
    const dueLbl = $('label[for="cf-dueDate"]', root); if (dueLbl) dueLbl.textContent = g === 'aligner' ? 'Due for Dr. A' : 'Due date';
    if (typeChanged) {
      const type = o.type, stage = $r('#cf-stage');
      stage.innerHTML = type ? FLOWS[TYPE[type].flow].stages.map(([k, l]) => '<option value="' + k + '">' + esc(l) + '</option>').join('') : '';
      if (isNew && type) $r('#cf-assignee').value = defaultAssignee(type);
      if (isNew && ['aligner', 'appliance', 'retainer'].includes(g) && !pressed(root, 'scanner').length) setPick(root, 'scanner', 'Allied Star', true);
    }
    // dates from the scan date (only fields nobody has typed into)
    const scan = $r('#cf-scanDate').value;
    if (isNew && scan) {
      const plan = tile === 'retainer' ? { 'cf-dueDate': addClinicDays(scan, 2), 'cf-labDate': '', 'cf-deliveryDate': '' }
        : g === 'aligner' ? { 'cf-dueDate': addDays(scan, 14), 'cf-labDate': addDays(scan, 21), 'cf-deliveryDate': addDays(scan, 28) }
          : { 'cf-dueDate': '', 'cf-labDate': '', 'cf-deliveryDate': '' };
      autoIds.forEach(id => { const el = $r('#' + id); if (el.dataset.auto === '1') el.value = plan[id]; });
    }
    if (det.dataset.auto === '1') det.value = autoDetail(o, tile);
  };
  root.addEventListener('click', e => {
    const tt = e.target.closest('.tt[data-tile]');
    if (tt && root.contains(tt)) { $$('.tt', root).forEach(b => b.setAttribute('aria-checked', String(b === tt))); $r('#cf-tile').value = tt.dataset.tile; refresh(true); return; }
    const pk = e.target.closest('.pickRow[data-g] .pick');
    if (pk && root.contains(pk)) {
      const row = pk.closest('.pickRow'); const multi = row.dataset.multi === '1'; const was = pk.getAttribute('aria-pressed') === 'true';
      if (multi) pk.setAttribute('aria-pressed', String(!was));
      else { $$('.pick', row).forEach(b => b.setAttribute('aria-pressed', 'false')); if (!was) pk.setAttribute('aria-pressed', 'true'); }
      if (row.dataset.g === 'appliances') { const ap = pressed(root, 'appliances'); const lab = ap.map(a => LAB_FOR[a]).find(Boolean); if (lab && !pressed(root, 'lab').length) setPick(root, 'lab', lab, true); }
      refresh(false); return;
    }
    const tool = e.target.closest('.tcTools [data-tool]');
    if (tool && root.contains(tool)) { $$('.tcTools [data-tool]', root).forEach(b => b.setAttribute('aria-checked', String(b === tool))); return; }
    const tq = e.target.closest('.tcTools [data-tq]'), tooth = e.target.closest('#cf-tc .tooth');
    if ((tq || tooth) && root.contains(tq || tooth)) {
      const cur = ($('.tcTools [data-tool][aria-checked="true"]', root) || {}).dataset; const mk = (cur && cur.tool) || 'noatt';
      let t = {}; try { t = JSON.parse($r('#cf-teeth').value || '{}'); } catch (x) { }
      const has = k => (t[k] || []).includes(mk);
      const set = (k, on) => { const a = (t[k] || []).filter(x => x !== mk); if (on) a.push(mk); t[k] = a; };
      if (tooth) set(tooth.dataset.t, !has(tooth.dataset.t));
      else if (tq.dataset.tq === 'clear') t = {};
      else { const list = tq.dataset.tq === 'ant' ? ANTERIORS : tq.dataset.tq === 'post' ? POSTERIORS : TEETH_U.concat(TEETH_L); const allOn = list.every(has); list.forEach(k => set(k, !allOn)); }
      t = canonTeeth(t); $r('#cf-teeth').value = JSON.stringify(t);
      $r('#cf-tcChart').innerHTML = toothChartHTML(t, false);
      $r('#cf-teethSum').textContent = teethSummary(t) || 'Tap a marker, then tap teeth.';
      return;
    }
    const sc = e.target.closest('[data-scan]');
    if (sc && root.contains(sc)) { $r('#cf-scanDate').value = addDays(todayISO(), Number(sc.dataset.scan)); refresh(false); return; }
    const cc = e.target.closest('.pick[data-cc]');
    if (cc && root.contains(cc)) { $r('#cf-cc').value = cc.dataset.cc === 'None' ? 'None' : cc.dataset.cc; return; }
  });
  $r('#cf-scanDate').addEventListener('change', () => refresh(false));
  $r('#cf-scanDate').addEventListener('input', () => refresh(false));
  refresh(false);
}
function setPick(root, g, v, on) { const b = $('.pickRow[data-g="' + g + '"] .pick[data-v="' + CSS.escape(v) + '"]', root); if (b) b.setAttribute('aria-pressed', String(!!on)); }
function editDirty() {
  const d = $('#drawer'); if (!d || !S.editing || !S.editBase) return false;
  const now = readCaseForm(d); return FORM_KEYS.some(k => !sameVal(now[k], S.editBase[k]));
}
function newCaseModal() {
  const roster = activeRoster().filter(r => r.role !== 'owner');
  const base = { scanDate: todayISO(), assistant: roster.some(r => r.sid === meSid()) ? meSid() : '' };
  openModal('<h3>New case</h3><div class="lsub">Tap through it after the scan. Only the patient’s name needs typing. Encrypted before it leaves this computer.</div><div id="ncErr"></div><form id="ncForm" novalidate>' + caseFormHTML(base, true) +
    '<div class="mFt"><button class="btn btn-sec" type="button" data-act="closeModal">Cancel</button><button class="btn btn-teal" type="submit" id="ncSave">' + ic('plus', 16) + 'Create case</button></div></form>', w => {
      w.querySelector('.modal').classList.add('wide');
      wireCaseForm(w, true);
      $('#ncForm', w).onsubmit = async e => {
        e.preventDefault(); const data = readCaseForm(w);
        const err = m => { $('#ncErr', w).innerHTML = '<div class="lockErr" role="alert">' + esc(m) + '</div>'; $('#ncErr', w).scrollIntoView({ block: 'nearest' }); };
        if (!data.type) return err('Tap a case type.');
        if (!data.patient) return err('Enter the patient’s name.');
        if (data.titanUrl && !safeUrl(data.titanUrl)) return err('The Titan link must start with https://');
        data.stage = data.stage || firstStage(data.type);
        Object.assign(data, { comments: [], createdAt: Date.now(), createdBy: meSid() });
        busyBtn($('#ncSave', w), true, 'Saving…');
        try { await B.createCase(data); closeModal(); toast('Case created for ' + data.patient); }
        catch (x) { busyBtn($('#ncSave', w), false); err(errText(x)); }
      };
    });
}
