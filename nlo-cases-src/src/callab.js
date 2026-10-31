/* =====================================================================
   The Office Calendar's lab dates (Amir, 31 Oct 2026: lab case due dates on the office calendar).
   Counts only: how many open cases are due each day, by kind (Aligners, Appliances, Retainers, Models), split into
   "from the lab" (the lab or Zoom date while that step is ahead) and "delivery" (the delivery appointment) — never a
   patient's name or anything else from a case. Kept in calLab/live (rules: any member writes it, members read it),
   written by any screen with the cases open, at most every 20 seconds and only when the counts changed.
   ===================================================================== */
const CALLAB = { soon: null, last: '', busy: false };
const CALLAB_KIND = { oliv: 'Aligners', angel: 'Aligners', invisalign: 'Aligners', ulab: 'Aligners', insmile: 'Aligners', inbrace: 'Aligners', nla: 'Aligners',
  appliance: 'Appliances', marpe: 'Appliances', retainer: 'Retainers', mouthguard: 'Retainers', models: 'Models' };
function calLabIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
/* { 'YYYY-MM-DD': { 'lab|Aligners': 2, 'appt|Retainers': 1 } } for the open cases due from two weeks ago to 6 months ahead */
function calLabDays() {
  const now = new Date(), from = calLabIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14)),
    to = calLabIso(new Date(now.getFullYear(), now.getMonth() + 6, now.getDate()));
  const days = {};
  S.cases.forEach(c => {
    if (!c || c.status === 'done') return;
    const x = dueOf(c); if (!x || !/^\d{4}-\d{2}-\d{2}$/.test(String(x.d || ''))) return;
    if (x.d < from || x.d > to) return;
    const k = (x.k === 'lab' || x.k === 'zoom' ? 'lab|' : 'appt|') + (CALLAB_KIND[c.type] || 'Other');
    const d = days[x.d] || (days[x.d] = {}); d[k] = (d[k] || 0) + 1;
  });
  /* keys in order, so the same counts always read the same */
  const out = {}; Object.keys(days).sort().forEach(d => { const o = {}; Object.keys(days[d]).sort().forEach(k => { o[k] = days[d][k]; }); out[d] = o; });
  return out;
}
function calLabSoon() { if (S.demo) return; clearTimeout(CALLAB.soon); CALLAB.soon = setTimeout(calLabSync, 20000); }
async function calLabSync() {
  if (S.demo || !S.inApp || CALLAB.busy || !B || !B.calLabGet) return;
  const days = calLabDays(), j = JSON.stringify(days);
  if (j === CALLAB.last) return;
  CALLAB.busy = true;
  try {
    const cur = await B.calLabGet();
    if (cur === null || JSON.stringify(cur) !== j) await B.calLabPut(days);
    CALLAB.last = j;
  } catch (x) { /* older rules (not published yet) or offline: try again with the next change */ }
  finally { CALLAB.busy = false; }
}
