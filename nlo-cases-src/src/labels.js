/* =====================================================================
   Aligner labels for in-house cases — the same labels the Label Maker
   (aligner-label-maker.html) prints, filled in from the case: a box
   label, an optional attachment-template label, then one label per
   stage. One 2×4 in label per page for the Zebra ZD410 (rotated onto a
   2 in wide page, so no driver settings are needed), or a CSV for
   Label Live. Available once the upper/lower aligner counts are known.
   ===================================================================== */
const LABEL_LOGO_IMG = '<img class="p-logo" src="nlo-label-logo.png" alt="">'; // the Label Maker's black NLO logo, a file next to the page
const WEAR_TEXT = 'Wear aligners 22 hours per day';

/* Label Maker wording for the set: Initial Set / Refinement #N / … */
function labelSetType(c) {
  const me = alignerSets(c, casePool()).find(s => s.me);
  const l = me ? me.l : '';
  if (/^Refinement (\d+)/.test(l)) return 'Refinement #' + l.match(/(\d+)/)[1];
  return l === 'Initial' ? 'Initial Set' : l === 'Mid-course' ? 'Mid-course Correction' : l === 'Finishing' ? 'Finishing Aligners' : 'Initial Set';
}
function fmtLabelDate(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

/* the labels, in print order (same rules as the Label Maker's generateLabels) */
function genLabels(o) {
  const uOn = o.uOn && o.uTotal > 0, lOn = o.lOn && o.lTotal > 0;
  const uStart = Math.max(1, o.uStart || 1), lStart = Math.max(1, o.lStart || 1);
  const uCount = uOn ? Math.max(0, o.uTotal - uStart + 1) : 0, lCount = lOn ? Math.max(0, o.lTotal - lStart + 1) : 0;
  const base = { patient: o.patient || 'Patient', setType: o.setType || 'Initial Set', upperEnabled: uOn, lowerEnabled: lOn, upperTotal: o.uTotal, lowerTotal: o.lTotal };
  const out = [Object.assign({ type: 'Box', upperStart: uStart, lowerStart: lStart, upperCount: uCount, lowerCount: lCount, hasAT: !!o.at, totalAlgn: uCount + lCount + (o.at ? 1 : 0), switchDate: '' }, base)];
  if (o.at) out.push(Object.assign({ type: 'AT', upperStage: null, lowerStage: null, switchDate: o.start ? fmtLabelDate(o.start) : '' }, base));
  const n = Math.max(uCount, lCount);
  for (let i = 0; i < n; i++) {
    const u = uStart + i, l = lStart + i;
    out.push(Object.assign({ type: 'Stage', stageIndex: i, upperStage: uOn && u <= o.uTotal ? u : null, lowerStage: lOn && l <= o.lTotal ? l : null,
      switchDate: o.start ? fmtLabelDate(addDays(o.start, i * (o.days || 7))) : '' }, base));
  }
  return out;
}

/* one label's markup (mirrors the Label Maker's buildPrintLabel; every value escaped) */
function labelHTML(lbl, idx) {
  const top = '<div class="p-top"><div><div class="p-patient">' + esc(lbl.patient) + '</div><div class="p-set-type">' + esc(lbl.setType) + '</div></div>' + LABEL_LOGO_IMG + '</div>';
  const s = n => n !== 1 ? 's' : '';
  if (lbl.type === 'Box') {
    const range = (a, b) => a === b ? 'Stage ' + b : 'Stages ' + a + '–' + b;
    return '<div class="print-label print-box">' + top + '<div class="p-box-body">' +
      (lbl.upperEnabled ? '<div class="p-box-row"><span class="p-box-lbl">Upper</span><span class="p-box-val">' + lbl.upperCount + ' aligner' + s(lbl.upperCount) + '</span><span class="p-box-sub">' + range(lbl.upperStart, lbl.upperTotal) + '</span></div>' : '') +
      (lbl.lowerEnabled ? '<div class="p-box-row"><span class="p-box-lbl">Lower</span><span class="p-box-val">' + lbl.lowerCount + ' aligner' + s(lbl.lowerCount) + '</span><span class="p-box-sub">' + range(lbl.lowerStart, lbl.lowerTotal) + '</span></div>' : '') +
      (lbl.hasAT ? '<div class="p-box-row"><span class="p-box-lbl">AT</span><span class="p-box-val">1 template</span><span class="p-box-sub">Before Stage 1</span></div>' : '') +
      '<div class="p-box-div"></div><div class="p-box-row"><span class="p-box-lbl">Total</span><span class="p-box-val">' + lbl.totalAlgn + ' aligners</span></div></div>' +
      '<div class="p-bot"><span class="p-wear">' + WEAR_TEXT + '</span></div></div>';
  }
  if (lbl.type === 'AT') {
    return '<div class="print-label print-at">' + top + '<div class="p-at-center">⬢ Attachment Template</div>' +
      '<div class="p-bot"><span class="p-wear">' + WEAR_TEXT + '</span>' + (lbl.switchDate ? '<span class="p-switch">Start: ' + esc(lbl.switchDate) + '</span>' : '<span class="p-num">Label 1</span>') + '</div></div>';
  }
  const arch = (on, stage, total, title) => !on ? '' : '<div class="p-arch"><div class="p-arch-title">' + title + '</div>' +
    (stage !== null ? '<div class="p-arch-stage">Stage ' + stage + ' <span>of ' + total + '</span></div>' : '<div class="p-arch-done">Complete ✓<br><span class="p-arch-night">Wear nightly</span></div>') + '</div>';
  const mid = lbl.upperEnabled && lbl.lowerEnabled
    ? arch(true, lbl.upperStage, lbl.upperTotal, '⬆ Upper') + '<div class="p-divider"></div>' + arch(true, lbl.lowerStage, lbl.lowerTotal, '⬇ Lower')
    : arch(lbl.upperEnabled, lbl.upperStage, lbl.upperTotal, '⬆ Upper') + arch(lbl.lowerEnabled, lbl.lowerStage, lbl.lowerTotal, '⬇ Lower');
  return '<div class="print-label">' + top + '<div class="p-mid">' + mid + '</div>' +
    '<div class="p-bot"><span class="p-wear">' + WEAR_TEXT + '</span>' + (lbl.switchDate ? '<span class="p-switch">Switch: ' + esc(lbl.switchDate) + '</span>' : '<span class="p-num">Label ' + (idx + 1) + '</span>') + '</div></div>';
}
function labelLine(lbl) {
  if (lbl.type === 'Box') return 'Box label · ' + (lbl.upperEnabled ? 'Upper ' + lbl.upperCount : '') + (lbl.upperEnabled && lbl.lowerEnabled ? ' · ' : '') + (lbl.lowerEnabled ? 'Lower ' + lbl.lowerCount : '') + ' · Total ' + lbl.totalAlgn;
  if (lbl.type === 'AT') return 'Attachment template' + (lbl.switchDate ? ' · start ' + lbl.switchDate : '');
  const a = (on, st, tot, l) => !on ? '' : l + ' ' + (st !== null ? st + '/' + tot : 'complete');
  return 'Stage ' + (lbl.stageIndex + 1) + ' · ' + [a(lbl.upperEnabled, lbl.upperStage, lbl.upperTotal, 'U'), a(lbl.lowerEnabled, lbl.lowerStage, lbl.lowerTotal, 'L')].filter(Boolean).join(' · ') + (lbl.switchDate ? ' · switch ' + lbl.switchDate : '');
}
/* CSV for Label Live — same columns as the Label Maker */
function labelsCSV(list) {
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = list.map(lbl => {
    let l1 = '', r1 = '', l2 = '', r2 = '';
    if (lbl.type === 'Box') {
      const range = (a, b) => a === b ? 'Stage ' + b : 'Stages ' + a + '-' + b;
      l1 = 'UPPER: ' + lbl.upperCount + ' aligners (' + range(lbl.upperStart, lbl.upperTotal) + ')'; r1 = 'LOWER: ' + lbl.lowerCount + ' aligners (' + range(lbl.lowerStart, lbl.lowerTotal) + ')';
      if (lbl.hasAT) l2 = 'AT: 1 template (Before Stage 1)'; r2 = 'TOTAL: ' + lbl.totalAlgn + ' aligners';
    } else if (lbl.type === 'AT') l1 = 'Attachment Template';
    else {
      if (lbl.upperEnabled) l1 = lbl.upperStage !== null ? 'UPPER: Stage ' + lbl.upperStage + ' of ' + lbl.upperTotal : 'UPPER: Complete';
      if (lbl.lowerEnabled) r1 = lbl.lowerStage !== null ? 'LOWER: Stage ' + lbl.lowerStage + ' of ' + lbl.lowerTotal : 'LOWER: Complete';
    }
    return [lbl.patient, lbl.setType || 'Initial Set', l1, r1, l2, r2, WEAR_TEXT, lbl.switchDate || ''].map(cell).join(',');
  });
  return ['PATIENT,SETTYPE,LINE1LEFT,LINE1RIGHT,LINE2LEFT,LINE2RIGHT,WEAR,SWITCHDATE'].concat(rows).join('\n');
}

/* print: one label per 2×4 in page; only the labels are shown while printing */
function printLabelList(list, onDone) { printLabelPages(list.map(x => labelHTML(x.lbl, x.idx)), onDone); }
function printLabelPages(pages, onDone) {
  const box = $('#print-container'); if (!box || !pages.length) return;
  box.innerHTML = pages.map(h => '<div class="print-page">' + h + '</div>').join('');
  document.body.classList.add('printLabels');
  // 2×4 in pages only while labels print (normal printing keeps the default page)
  const pg = document.createElement('style'); pg.id = 'lbPage'; pg.textContent = '@page{size:2in 4in;margin:0}'; document.head.appendChild(pg);
  const done = () => { document.body.classList.remove('printLabels'); box.innerHTML = ''; pg.remove(); window.removeEventListener('afterprint', done); if (onDone) setTimeout(onDone, 60); };
  window.addEventListener('afterprint', done);
  const imgs = $$('img', box);
  Promise.all(imgs.map(i => i.complete ? Promise.resolve() : new Promise(r => { i.onload = i.onerror = r; }))).then(() => setTimeout(() => window.print(), 50));
}

function labelsModal(c) {
  const uT = Number(c.alU) || 0, lT = Number(c.alL) || 0;
  const st = { patient: c.patient || '', setType: labelSetType(c), uOn: uT > 0, lOn: lT > 0, uTotal: uT, lTotal: lT, uStart: 1, lStart: 1, at: hasAT(c), days: 7, start: c.deliveryDate || '' };
  let labels = [], off = new Set();
  const num = (id, v, lbl) => '<div class="field"><label for="' + id + '">' + lbl + '</label><input id="' + id + '" type="number" inputmode="numeric" min="1" max="99" value="' + v + '"></div>';
  openModal('<h3>Aligner labels</h3><div class="lsub">The Label Maker’s labels, filled in from this case. One 2×4 in label per page on the Zebra; check each value before printing.</div>' +
    '<div class="lbForm"><div class="grid2"><div class="field"><label for="lb-patient">Patient</label><input id="lb-patient" value="' + esc(st.patient) + '"></div>' +
    '<div class="field"><label for="lb-set">Set</label><input id="lb-set" value="' + esc(st.setType) + '"></div></div>' +
    '<div class="lbArch"><label class="lbOn"><input type="checkbox" id="lb-uOn"' + (st.uOn ? ' checked' : '') + '> Upper</label>' + num('lb-uTotal', st.uTotal || '', 'Stages') + num('lb-uStart', 1, 'Starting at') + '</div>' +
    '<div class="lbArch"><label class="lbOn"><input type="checkbox" id="lb-lOn"' + (st.lOn ? ' checked' : '') + '> Lower</label>' + num('lb-lTotal', st.lTotal || '', 'Stages') + num('lb-lStart', 1, 'Starting at') + '</div>' +
    '<label class="lbAt"><input type="checkbox" id="lb-at"' + (st.at ? ' checked' : '') + '> Attachment template label (prints before stage 1)</label>' +
    '<div class="grid2"><div class="field"><label>Days per stage</label><div class="pickRow" id="lb-days">' + [7, 10, 14].map(d => '<button type="button" class="pick sm" data-days="' + d + '" aria-pressed="' + (d === 7) + '">' + d + ' days</button>').join('') + '</div></div>' +
    '<div class="field"><label for="lb-start">Start date <span class="h5n">for switch dates (optional)</span></label><input id="lb-start" type="date" value="' + esc(st.start) + '"></div></div>' +
    '<div class="lbHead"><b id="lb-count"></b><span style="flex:1"></span><label class="small"><input type="checkbox" id="lb-all" checked> Select all</label></div>' +
    '<div class="lbList" id="lb-list"></div><div class="lbPrev" id="lb-prev"></div></div>' +
    '<div class="mFt"><button class="btn btn-sec" type="button" data-act="closeModal">Close</button><span style="flex:1"></span><button class="btn btn-sec" type="button" id="lb-csv">' + ic('download', 16) + 'CSV for Label Live</button><button class="btn btn-teal" type="button" id="lb-print">Print labels</button></div>', w => {
    w.querySelector('.modal').classList.add('wide');
    const $w = s => $(s, w);
    const read = () => {
      st.patient = $w('#lb-patient').value.trim(); st.setType = $w('#lb-set').value.trim();
      st.uOn = $w('#lb-uOn').checked; st.lOn = $w('#lb-lOn').checked; st.at = $w('#lb-at').checked; st.start = $w('#lb-start').value;
      ['uTotal', 'uStart', 'lTotal', 'lStart'].forEach(k => { st[k] = Math.min(99, Math.max(0, parseInt($w('#lb-' + k).value, 10) || 0)); });
    };
    const chosen = () => labels.map((lbl, idx) => ({ lbl, idx })).filter(x => !off.has(x.idx));
    const draw = () => {
      read(); labels = genLabels(st); off = new Set(Array.from(off).filter(i => i < labels.length));
      const ok = (st.uOn && st.uTotal > 0) || (st.lOn && st.lTotal > 0);
      $w('#lb-list').innerHTML = ok ? labels.map((l, i) => '<label class="lbRow"><input type="checkbox" data-lb="' + i + '"' + (off.has(i) ? '' : ' checked') + '><span>' + esc(labelLine(l)) + '</span></label>').join('') : '<div class="small muted" style="padding:10px">Turn on an arch with at least one stage.</div>';
      $w('#lb-prev').innerHTML = ok ? labels.slice(0, 2).map((l, i) => '<div class="lbPrevBox">' + labelHTML(l, i) + '</div>').join('') : '';
      sync();
    };
    const sync = () => {
      const n = chosen().length, ok = labels.length && ((st.uOn && st.uTotal > 0) || (st.lOn && st.lTotal > 0));
      $w('#lb-count').textContent = (ok ? labels.length : 0) + ' labels' + (ok && n !== labels.length ? ' · ' + n + ' selected' : '');
      $w('#lb-print').disabled = !ok || !n; $w('#lb-print').textContent = 'Print ' + (ok ? n : 0) + ' label' + (n === 1 ? '' : 's');
      $w('#lb-csv').disabled = !ok || !n; $w('#lb-all').checked = ok && n === labels.length;
    };
    w.addEventListener('input', e => { if (e.target.closest('.lbForm') && !e.target.dataset.lb && e.target.id !== 'lb-all') draw(); });
    w.addEventListener('change', e => {
      if (e.target.dataset.lb) { const i = Number(e.target.dataset.lb); if (e.target.checked) off.delete(i); else off.add(i); sync(); }
      else if (e.target.id === 'lb-all') { off = e.target.checked ? new Set() : new Set(labels.map((_, i) => i)); $$('[data-lb]', w).forEach(b => { b.checked = e.target.checked; }); sync(); }
      else if (e.target.type === 'checkbox' || e.target.type === 'date') draw();
    });
    w.addEventListener('click', e => {
      const d = e.target.closest('#lb-days [data-days]'); if (d) { st.days = Number(d.dataset.days); $$('#lb-days .pick', w).forEach(b => b.setAttribute('aria-pressed', String(b === d))); draw(); }
    });
    $w('#lb-print').onclick = () => printLabelList(chosen());
    $w('#lb-csv').onclick = () => {
      const blob = new Blob([labelsCSV(chosen().map(x => x.lbl))], { type: 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (st.patient || 'Patient').replace(/\s+/g, '_') + '_aligner_labels.csv';
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    };
    draw();
  });
}

/* ---------- Retainer and whitening tray labels (Amir, 2 Oct 2026) ----------
   One 2×4 in label per bag in the Label Maker's style: patient, upper/lower, what's inside, a bottom line and a
   date. After printing, it offers to mark the case complete. TT's are the retainers, WT's the whitening trays. */
const RET_LABELS = [
  { k: 'TT’s', one: 'Retainer', many: 'Retainers', note: 'Wear retainers as directed' },
  { k: 'WT’s', one: 'Whitening tray', many: 'Whitening trays', note: 'Use whitening trays as directed' }
];
function retLabelHTML(l) {
  const both = l.u && l.l, arch = both ? 'Upper & Lower' : l.u ? 'Upper' : 'Lower';
  return '<div class="print-label print-ret"><div class="p-top"><div><div class="p-patient">' + esc(l.patient || 'Patient') + '</div><div class="p-set-type">' + esc(arch) + '</div></div>' + LABEL_LOGO_IMG + '</div>' +
    '<div class="p-at-center">' + esc(both ? l.kind.many : l.kind.one) + '</div>' +
    '<div class="p-bot"><span class="p-wear">' + esc(l.note) + '</span>' + (l.date ? '<span class="p-switch">' + esc(fmtLabelDate(l.date)) + '</span>' : '') + '</div></div>';
}
function retLabelsModal(c) {
  const kinds = (c.retKinds || []).length ? c.retKinds : [RET_LABELS[0].k], arches = (c.arches || []).length ? c.arches : ['Upper', 'Lower'];
  openModal('<h3>Retainer labels</h3><div class="lsub">One 2×4 in label per bag on the Zebra, filled in from this case. Check each value before printing.</div>' +
    '<div class="lbForm"><div class="grid2"><div class="field"><label for="rl-patient">Patient</label><input id="rl-patient" value="' + esc(c.patient || '') + '"></div>' +
    '<div class="field"><label for="rl-date">Date on the label <span class="h5n">(optional)</span></label><input id="rl-date" type="date" value="' + esc(c.deliveryDate || todayISO()) + '"></div></div>' +
    '<div class="rlArch"><span class="flabel">Arch</span>' + ['Upper', 'Lower'].map(a => '<label class="lbAt"><input type="checkbox" data-rl-arch="' + a + '"' + (arches.includes(a) ? ' checked' : '') + '> ' + a + '</label>').join('') + '</div>' +
    RET_LABELS.map((k, i) => '<div class="rlKind"><label class="lbAt"><input type="checkbox" data-rl-kind="' + i + '"' + (kinds.includes(k.k) ? ' checked' : '') + '> ' + esc(k.many) + '</label>' +
      '<div class="field"><label for="rl-note' + i + '">Bottom line</label><input id="rl-note' + i + '" value="' + esc(k.note) + '"></div></div>').join('') +
    '<div class="lbPrev" id="rl-prev"></div></div>' +
    '<div class="mFt"><button class="btn btn-sec" type="button" data-act="closeModal">Close</button><span style="flex:1"></span><button class="btn btn-teal" type="button" id="rl-print">Print label</button></div>', w => {
    w.querySelector('.modal').classList.add('wide');
    const $w = s => $(s, w);
    let labels = [];
    const draw = () => {
      const u = $w('[data-rl-arch=Upper]').checked, l = $w('[data-rl-arch=Lower]').checked;
      labels = (u || l) ? RET_LABELS.map((kind, i) => $w('[data-rl-kind="' + i + '"]').checked ? { patient: $w('#rl-patient').value.trim(), u, l, kind, note: $w('#rl-note' + i).value.trim(), date: $w('#rl-date').value } : null).filter(Boolean) : [];
      $w('#rl-prev').innerHTML = labels.length ? labels.map(x => '<div class="lbPrevBox">' + retLabelHTML(x) + '</div>').join('') : '<div class="small muted">Pick an arch and at least one label.</div>';
      const b = $w('#rl-print'); b.disabled = !labels.length; b.textContent = 'Print ' + (labels.length === 2 ? '2 labels' : 'label');
    };
    w.addEventListener('input', draw); w.addEventListener('change', draw);
    $w('#rl-print').onclick = () => printLabelPages(labels.map(retLabelHTML), () => {
      closeModal();
      // printed: offer to finish the case (it can be reopened later)
      const cur = findCase(c.id); if (!cur || cur.status === 'done') return;
      confirmBox('Mark this case complete?', 'The label for ' + (cur.patient || 'this patient') + ' went to the printer. Move the case to Completed now? You can undo right after, or reopen it later.', 'Mark complete', false, 'Not yet')
        .then(ok => { if (ok) completeCase(c.id); });
    });
    draw();
  });
}
