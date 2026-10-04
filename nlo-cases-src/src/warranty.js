/* =====================================================================
   Lab warranty — Specialty Appliances' remake terms on each of their cases
   Amir, 4 Oct 2026: sent Specialty's "Warranty, Replacement, Refinement and Returns Policy" (traditional orthodontic
   appliances) and picked "each Specialty case shows its remake deadlines and how to file a claim".
   - On a case going to Specialty (an appliance or MARPE) once it has reached Shipped (a MARPE: Delivered) — or, moved back
     for a remake, when its history shows it shipped — the dates Specialty's terms give. They count from the invoice date:
     the date entered from Specialty's invoice; until then, about the day the case moved to Shipped (else the day it came
     in, or was completed) — those show as "about":
       fit: a free remake within 30 days, half the price 31–60 days, full price after;
       manufacturing defect: free within 9 months for a Herbst, 6 months for any other appliance or retainer;
       anything wrong seen when it arrives: claim within 10 days of receiving it;
       after 6 months, anything else is full price; a case Specialty made as "No Guarantee" has no warranty.
   - Today's standing is on the folded heading ("Fit remake free until Nov 3 · defects until Apr 4, 2027").
   - The invoice date (invDate) and a "No Guarantee" mark (noGuarantee) are saved on the case, encrypted like the rest of it.
   - How to claim: send it back so it reaches Specialty inside the window (their prepaid USPS label, a label from
     customer service, or FedEx/UPS to their address) with an updated scan; Specialty remakes or replaces, never repairs.
   - Moves come from the case history (the stepper, a lab email, or Edit): the last move forward to Shipped, and the first
     move forward to a received step after it (a step clicked back and forward again doesn't restart anything).
   ===================================================================== */
const WTY = {
  src: 'Specialty Appliances’ Warranty, Replacement, Refinement and Returns Policy (traditional orthodontic appliances)',
  fitFree: 30, fitHalf: 60, herbstMonths: 9, otherMonths: 6, arrivalDays: 10,
  phone: '(800) 522-4636', label: 'https://specialtyappliances.com/shipping-information/', address: '4905 Hammond Industrial Dr., Suite J, Cumming, GA 30041'
};
const WTY_RECV = ['milestones', 'arrived', 'delivered']; // steps that mean it came in
function wtyApplies(c) { return !!c && (c.type === 'appliance' || c.type === 'marpe') && labName(c.lab) === LAB_SPEC; }
/* at Shipped or later (a MARPE: Delivered) — a case completed before it shipped (cancelled) isn't */
function wtyReached(c) { const ks = flowOf(c).stages.map(s => s[0]), at = ks.indexOf(c.type === 'marpe' ? 'delivered' : 'shipped'); return at >= 0 && stageIndex(c) >= at; }
function wtyShows(c) { return wtyApplies(c) && (!!c.invDate || wtyReached(c)); }
/* … or its history shows it shipped or came in (moved back to be remade) */
function wtyShowsH(c, hist) { return wtyShows(c) || (wtyApplies(c) && !!hist && !!(wtyMove(c, hist, ['shipped'], 'last') || wtyMove(c, hist, WTY_RECV, 'first'))); }
/* the same day n months later (the month's last day when it hasn't that many days: Aug 31 + 6 months = Feb 28) */
function wtyAddMonths(iso, n) { const [y, m, d] = iso.split('-').map(Number), last = new Date(y, m - 1 + n + 1, 0).getDate(); return isoOf(new Date(y, m - 1 + n, Math.min(d, last))); }
const wtyDaysTo = iso => Math.round((new Date(iso + 'T12:00:00') - new Date(todayISO() + 'T12:00:00')) / 864e5);
/* "Nov 3", or "Apr 4, 2027" when it isn't this year */
function wtyDay(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, Object.assign({ month: 'short', day: 'numeric' }, y !== new Date().getFullYear() ? { year: 'numeric' } : {})); }
/* a move forward to one of these steps in the case's history (the stepper, a lab email, or Edit): the first or the last,
   from `after` (ms) on; a move back (Checked in → Shipped, a misclick) doesn't count */
function wtyMove(c, hist, keys, which, after) {
  const ks = flowOf(c).stages.map(s => s[0]), fwd = h => { const a = ks.indexOf(h.from), b = ks.indexOf(h.to); return a < 0 || b < 0 || a < b; };
  const xs = (hist || []).filter(h => (h.a === 'stage' || h.a === 'email' || h.a === 'edit') && keys.includes(h.to) && h.at && h.at >= (after || 0) && fwd(h));
  return which === 'first' ? xs[0] : xs[xs.length - 1];
}
/* when the case last moved to a step before Shipped (a MARPE: before Delivered) — where a remake starts (0: never) */
function wtyBackAt(c, hist) {
  const ks = flowOf(c).stages.map(s => s[0]), at = ks.indexOf(c.type === 'marpe' ? 'delivered' : 'shipped');
  const xs = (hist || []).filter(h => (h.a === 'stage' || h.a === 'email' || h.a === 'edit') && h.at && ks.indexOf(h.to) >= 0 && ks.indexOf(h.to) < at);
  return xs.length ? xs[xs.length - 1].at : 0;
}
/* what the windows count from: the invoice date (entered, else about the day it shipped, else the day it came in or was
   completed) and the day it came in (recvFrom: 'step' = moved to a received step, 'completed' = the day it was completed)
   (loading: the history isn't in yet, so nothing is counted rather than a guess that changes a moment later) */
function wtyDates(c, hist) {
  if (!hist && !c.invDate) return { inv: '', from: '', shipped: '', recv: '', recvFrom: '', loading: true };
  // (came in: the first time after it last shipped — or after it was last moved back before Shipped, for a remake)
  const sh = wtyMove(c, hist, ['shipped'], 'last'), rv = wtyMove(c, hist, WTY_RECV, 'first', Math.max(sh ? sh.at : 0, wtyBackAt(c, hist))), day = ms => isoOf(new Date(ms));
  const shipped = sh ? day(sh.at) : '';
  let recv = rv ? day(rv.at) : '', recvFrom = recv ? 'step' : '';
  if (!recv && c.status === 'done' && c.closedAt && wtyReached(c)) { recv = day(c.closedAt); recvFrom = 'completed'; }
  const inv = c.invDate || shipped || recv;
  return { inv, from: c.invDate ? 'invoice' : shipped ? 'shipped' : recv ? 'received' : '', shipped, recv, recvFrom };
}
/* the deadlines (a case with a Herbst and something else has both defect windows) */
function wtyWindows(c, d) {
  const ap = c.appliances || [], herb = ap.some(a => RX_HERBST.includes(a)), other = !herb || ap.some(a => !RX_HERBST.includes(a));
  if (!d.inv) return { arrive: d.recv ? addDays(d.recv, WTY.arrivalDays) : '' };
  return { fitFree: addDays(d.inv, WTY.fitFree), fitHalf: addDays(d.inv, WTY.fitHalf), defHerbst: herb ? wtyAddMonths(d.inv, WTY.herbstMonths) : '',
    defOther: other ? wtyAddMonths(d.inv, WTY.otherMonths) : '', arrive: d.recv ? addDays(d.recv, WTY.arrivalDays) : '' };
}
/* half the price for a remake 31–60 days in: half of the case's Rx estimate (without the expedite fee), when it has one */
function wtyHalf(c) {
  let t = 0; rxKinds().forEach(K => { const rx = rxOfK(c, K); if (rx) t += rxEstimate(Object.assign({}, rx, { form: K.form, rush: '' }), c).total; });
  return t > 0 ? t / 2 : null;
}
/* today's standing in one line: the folded heading ("about" until the invoice date is entered) */
function wtySummary(c, d, w) {
  if (c.noGuarantee) return 'No Guarantee case: no warranty';
  if (d.loading) return 'Loading…';
  if (!w.fitFree) return 'Counts from the invoice date — add it';
  const t = todayISO(), ab = d.from === 'invoice' ? '' : 'about ';
  const fit = t <= w.fitFree ? 'Fit remake free until ' + ab + wtyDay(w.fitFree) : t <= w.fitHalf ? 'Fit remake half price until ' + ab + wtyDay(w.fitHalf) : '';
  // a Herbst and something else: the sooner defect deadline while both run, then the Herbst's (named)
  const def = [w.defHerbst, w.defOther].filter(x => x && x >= t).sort()[0], herbOnly = !!(def && w.defHerbst && w.defOther && def === w.defHerbst && w.defOther < t);
  const defTxt = def ? (fit ? '' : 'Free remake for ') + (herbOnly ? 'Herbst defects' : 'defects') + ' until ' + ab + wtyDay(def) : '';
  const txt = [fit, defTxt].filter(Boolean).join(' · ');
  return txt ? txt[0].toUpperCase() + txt.slice(1) : 'Past Specialty’s warranty: full price';
}
/* a deadline's chip: free / half price / claim by … with the days left, or past (est: "about", the date is an estimate) */
function wtyChip(end, kind, est) {
  if (!end) return '';
  const n = wtyDaysTo(end), cls = n < 0 ? 'past' : kind, ab = est ? 'about ' : '';
  return '<span class="wtyChip ' + cls + '">' + (n < 0 ? 'past' : { free: 'free', half: 'half price', claim: 'claim' }[kind] + ' · ' + (n === 0 ? ab + 'the last day' : ab + n + ' day' + (n > 1 ? 's' : '') + ' left')) + '</span>';
}
/* what the dates count from, in words (under the invoice date) */
function wtyFromTxt(c, d) {
  if (d.loading) return 'Specialty counts from its invoice date.';
  if (!d.inv) return 'Specialty counts from its invoice date — enter the date on Specialty’s invoice to see the deadlines.';
  if (c.invDate) return 'Specialty counts from its invoice date. Counting from the date entered.' +
    // shipped weeks after the invoice date (a remake shipped again, or a date mistyped): its own invoice may have a new date
    (d.shipped && d.shipped > addDays(c.invDate, 14) ? ' It moved to Shipped on ' + wtyDay(d.shipped) + ', weeks after this invoice date — if Specialty sent a new invoice, enter its date.' : '');
  return 'Specialty counts from its invoice date. Until it’s entered, the dates are estimates, counted from ' +
    (d.from === 'shipped' ? 'the day it moved to Shipped (' + wtyDay(d.shipped) + ')' : d.recvFrom === 'completed' ? 'the day the case was completed (' + wtyDay(d.recv) + ')' : 'the day it came in (' + wtyDay(d.recv) + ')') + '.';
}
/* the No Guarantee notice and the deadlines (a No Guarantee case: no "free" chips) */
function wtyTableHTML(c, d, w) {
  const t = todayISO(), half = wtyHalf(c), herb = (c.appliances || []).some(a => RX_HERBST.includes(a)), ab = d.from === 'invoice' ? '' : 'about ';
  const row = (k, v, chip) => '<tr><th>' + k + '</th><td>' + v + '</td><td>' + (chip || '') + '</td></tr>';
  const est = d.from !== 'invoice', chip = (end, kind, x) => c.noGuarantee ? '' : wtyChip(end, kind, x === undefined ? est : x), day = x => esc(wtyDay(x));
  const arrive = !w.arrive ? 'Claim within 10 days of receiving it' : d.recvFrom === 'completed' ? 'Claim by about <b>' + day(w.arrive) + '</b> — 10 days after it came in (counted from ' + day(d.recv) + ', the day the case was completed)' : 'Claim by <b>' + day(w.arrive) + '</b> — 10 days after it came in (' + day(d.recv) + ')';
  return (c.noGuarantee ? '<div class="notice bad wtyNg"><span><b>No Guarantee:</b> Specialty made this one as a “No Guarantee” case, so it has no warranty or remake terms.</span></div>' : '') +
    '<table class="wtyTbl">' +
    row('Something wrong when it arrives', arrive, w.arrive ? chip(w.arrive, 'claim', d.recvFrom === 'completed') : '') +
    row('Doesn’t fit', w.fitFree ? 'Free remake until ' + ab + '<b>' + day(w.fitFree) + '</b>; half the price until ' + ab + '<b>' + day(w.fitHalf) + '</b>' + (half ? ' (about ' + money(half) + ' — half the Rx estimate)' : '') + '; full price after' : 'Free within 30 days of the invoice; half the price to 60 days; full price after',
      w.fitFree ? (t <= w.fitFree ? chip(w.fitFree, 'free') : chip(w.fitHalf, 'half')) : '') +
    (w.defHerbst ? row('Defect' + (w.defOther ? ' (the Herbst)' : ''), 'Free remake until ' + ab + '<b>' + day(w.defHerbst) + '</b> — 9 months for a Herbst; full price after', chip(w.defHerbst, 'free')) : '') +
    (w.defOther ? row('Defect' + (w.defHerbst ? ' (the rest)' : ''), 'Free remake until ' + ab + '<b>' + day(w.defOther) + '</b> — 6 months' + (herb ? '' : ' for any appliance or retainer') + '; full price after', chip(w.defOther, 'free')) : '') +
    (!w.fitFree ? row('Defect', 'Free within ' + (herb ? '9 months (a Herbst; 6 for anything else)' : '6 months') + ' of the invoice') : '') +
    row('Anything else', 'After 6 months, full price' + (herb ? ' (except a Herbst’s defect, to 9 months)' : '')) +
    '</table>';
}
function wtyBodyHTML(c, hist) {
  const d = wtyDates(c, hist), w = wtyWindows(c, d);
  return '<div class="wty' + (c.noGuarantee ? ' ng' : '') + '">' +
    '<div class="wtyInv"><label class="rxF"><span>Invoice date</span><input type="date" data-wty="inv" data-id="' + esc(c.id) + '" value="' + esc(c.invDate || '') + '" max="' + addDays(todayISO(), 1) + '" aria-label="Specialty’s invoice date"></label>' +
    '<span class="small muted" id="wtyFrom">' + esc(wtyFromTxt(c, d)) + '</span></div>' +
    '<div id="wtyTbl">' + wtyTableHTML(c, d, w) + '</div>' +
    '<label class="rxAuto wtyNgTg"><input type="checkbox" data-wty="ng" data-id="' + esc(c.id) + '"' + (c.noGuarantee ? ' checked' : '') + '> Specialty said this case is “No Guarantee” (e.g. an incomplete scan or unerupted molars): no warranty</label>' +
    '<h5 class="wtyH">To claim a remake</h5><ol class="wtySteps">' +
      '<li>Send the appliance (and any parts) back for Specialty to look at — <b>it has to reach them inside the window</b>, so send it a few days ahead: print their <a href="' + WTY.label + '" target="_blank" rel="noopener noreferrer">prepaid USPS label</a>, ask customer service for one at ' + WTY.phone + ', or send it FedEx or UPS to Specialty Appliances, ' + esc(WTY.address) + '.</li>' +
      '<li>Send an updated scan of the patient’s teeth (Specialty’s portal or the scanner). Without one, Specialty remakes from the scan on file and isn’t responsible if it no longer fits.</li>' +
      '<li>Specialty doesn’t repair broken appliances — it remakes or replaces them — and can turn a claim down.</li></ol>' +
    '<div class="small muted">From ' + esc(WTY.src) + '.</div></div>';
}
function wtySecHTML(c) {
  const hist = S.openId === c.id ? S.history : null;
  if (!wtyShowsH(c, hist)) return '';
  const d = wtyDates(c, hist), w = wtyWindows(c, d);
  return dsec('wty', 'Specialty warranty', esc(wtySummary(c, d, w)), '<div id="wtyBox">' + wtyBodyHTML(c, hist) + '</div>');
}
/* the history loads after the panel: the dates that count from it follow (around the invoice date while it's being typed);
   a case moved back from Shipped gets the section once its history shows it shipped */
function wtyRefresh(id) {
  const c = findCase(id); if (!c || S.editing || S.openId !== id) return;
  const sec = $('#drawer [data-ds=wty]'), hist = S.history;
  if (!sec) { if (wtyShowsH(c, hist) && !wtyKeep()) renderDrawer(); return; }
  const d = wtyDates(c, hist), w = wtyWindows(c, d), box = $('#wtyBox', sec), sum = $('#dsS-wty', sec), inv = box && $('[data-wty=inv]', box);
  if (inv && document.activeElement === inv) { $('#wtyFrom', box).textContent = wtyFromTxt(c, d); $('#wtyTbl', box).innerHTML = wtyTableHTML(c, d, w); $('.wty', box).classList.toggle('ng', !!c.noGuarantee); }
  else if (box) box.innerHTML = wtyBodyHTML(c, hist);
  if (sum) sum.textContent = wtySummary(c, d, w);
}
/* while the invoice date is being typed, a live update waits: the panel redraws once the box is left (ui.js refreshDrawer);
   any other redraw keeps what was typed, and the focus (ui.js renderDrawer) */
function wtyKeep() { const a = document.activeElement; return a && a.dataset && a.dataset.wty === 'inv' && a.closest('#drawer') ? { id: a.dataset.id, v: a.value } : null; }
function wtyRestore(k) { if (!k) return; const i = $('#drawer [data-wty=inv][data-id="' + CSS.escape(k.id) + '"]'); if (i) { i.value = k.v; i.focus(); } }
function wtyHold() { if (!wtyKeep()) return false; S.wtyRedraw = true; return true; }
/* the panel closing with the box focused saves a whole date (ui.js closeDrawer; not while the app locks) */
function wtyFlush() { const a = document.activeElement; if (S.inApp && a && a.dataset && a.dataset.wty === 'inv') wtyInvCommit(a, true); }
/* the invoice date saves when the box is left or Enter is pressed — Chrome reports each keystroke as a change (0002-…, 0020-…,
   0202-… while the year is typed, and each part as it's finished, for a moment with nothing focused) — or on a change while
   the box isn't focused (a phone's date picker). It saves on the case right away, open or done. Not saved: a part still being
   typed when the box is left (Chrome fills it in as it goes: "1" in the month → January; noted after each key as data-part),
   a part rubbed out, a partial year, a date after today; Esc leaves it as saved. quiet: the panel closed with the box focused
   (also when the case was just completed by someone else and isn't in the lists for a moment: saved by its id).
   true = a save started */
const WTY_SAVING = {};
function wtyInvCommit(t, quiet) {
  if (!S.inApp || t.dataset.cancel) return false;
  const id = t.dataset.id, c = findCase(id), saved = c ? (c.invDate || '') : (t.defaultValue || '');
  const raw = t.value || '', whole = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const part = t.dataset.part === '1' || !!(t.validity && t.validity.badInput) || (!!raw && (!whole || raw < '2000-01-01'));
  const future = !part && !!raw && raw > addDays(todayISO(), 1);
  if (part || future) { if (!quiet) { toast(future ? 'The invoice date can’t be after today' : 'Enter the whole date from Specialty’s invoice', { bad: true }); t.value = saved; delete t.dataset.part; } return false; }
  const v = raw; if (v === saved || WTY_SAVING[id] === v) return false;
  WTY_SAVING[id] = v;
  act(async () => {
    try { await B.mutateCase(id, d => { d.invDate = v; }, { a: 'edit', fields: ['invDate'] }); } finally { delete WTY_SAVING[id]; }
    const c2 = findCase(id); if (c2) c2.invDate = v;
    // redraw once a click that left the box is through (see PRESS in ui.js) — or, back in the box, once it's left again
    const rd = () => { if (S.openId !== id || S.editing || wtyHold()) return; S.wtyRedraw = false; renderDrawer(); loadHistory(id); };
    if (!afterPress(rd)) rd();
  }, v ? 'Invoice date saved — the warranty counts from it' : 'Invoice date cleared');
  return true;
}
document.addEventListener('focusout', e => {
  const t = e.target; if (!t || !t.dataset || t.dataset.wty !== 'inv') return;
  // a redraw or the panel closing takes the box away while it's focused: a moment later, which it was shows
  setTimeout(() => {
    const id = t.dataset.id; let saving;
    if (t.isConnected) saving = wtyInvCommit(t);
    else if ($('#drawer [data-wty=inv][data-id="' + CSS.escape(id) + '"]')) return; // redrawn: the new box has what was typed
    else saving = wtyInvCommit(t, true);
    // a live update that waited while the box was focused (a save on its way redraws anyway)
    if (S.wtyRedraw && !saving && WTY_SAVING[id] === undefined) { const rd = () => { if (S.openId === id && !S.editing) { S.wtyRedraw = false; refreshDrawer(); } }; if (!afterPress(rd)) rd(); }
  }, 0);
});
/* Enter saves (leaves the box); Esc puts the saved date back before the panel closes — Chrome would otherwise turn a part
   being typed into a date ("0" in the month → January) as the box goes */
document.addEventListener('keydown', e => {
  const t = e.target; if (!t || !t.dataset || t.dataset.wty !== 'inv') return;
  if (e.key === 'Enter') { e.preventDefault(); t.blur(); }
  if (e.key === 'Escape') { t.dataset.cancel = '1'; t.value = (findCase(t.dataset.id) || {}).invDate || ''; }
}, true);
/* after each key: is a part still being typed? (a click — the date picker — starts over) */
document.addEventListener('keyup', e => { const t = e.target; if (t && t.dataset && t.dataset.wty === 'inv' && document.activeElement === t) t.dataset.part = t.validity && t.validity.badInput ? '1' : ''; }, true);
document.addEventListener('pointerdown', e => { const t = e.target; if (t && t.dataset && t.dataset.wty === 'inv') delete t.dataset.part; }, true);
document.addEventListener('focusin', e => { const t = e.target; if (t && t.dataset && t.dataset.wty === 'inv') { delete t.dataset.cancel; delete t.dataset.part; } });
document.addEventListener('change', e => {
  const t = e.target; if (!t || !t.dataset || !t.dataset.wty || !t.closest('#drawer')) return;
  // (a change while the box is focused waits for it to be left; a part just finished reports nothing focused for a moment)
  if (t.dataset.wty === 'inv') { setTimeout(() => { if (t.isConnected && document.activeElement !== t) wtyInvCommit(t); }, 0); return; }
  // the No Guarantee box saves when it's ticked
  if (t.dataset.wty !== 'ng') return;
  const id = t.dataset.id, on = !!t.checked; if (!findCase(id)) return;
  act(async () => {
    await B.mutateCase(id, d => { d.noGuarantee = on ? true : ''; }, { a: 'edit', fields: ['noGuarantee'] });
    const c2 = findCase(id); if (c2) c2.noGuarantee = on ? true : '';
    if (S.openId === id && !S.editing && !wtyHold()) { renderDrawer(); loadHistory(id); }
  }, on ? 'Marked No Guarantee' : 'No Guarantee taken off');
});
