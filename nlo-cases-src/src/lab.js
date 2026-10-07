/* =====================================================================
   The lab PC → NLO Cases (Amir, 6 Oct 2026): where each in-house set is in the lab
   A small script on the lab PC (lab/nlo-lab-bridge.ps1, set up from Team & security → Lab PC) reads the trimmer software's
   order files (Ortho Factory, C:\ProgramData\TrimLignAI\InputFolder, and its Finished folder) and sends each order's trimming
   progress — which aligners are at the trimmer and trimmed — sealed to the office inbox key with its own robot login (like the
   lab-email script: it can add sealed items to the inbox and note its check-ins, nothing else). Names travel only inside the seal.
   (Ortho Factory records trimming only; 3D printing comes from the Formlabs feed, thermoforming is a manual tap.)
   Whenever someone has NLO Cases open, the app opens them here (mailSync hands them over), finds the patient's in-house case —
   the order it was linked to before, else the name — keeps the progress on the case (sealed with the rest), fills in the set's
   aligner counts from the export when nobody typed them, and offers the matching step with one tap: Dr. A's "suggest, one tap
   to confirm" — nothing moves by itself. An order it can't place waits on Today for someone to pick the case.
   ===================================================================== */
const LAB_BOT = 'labbot.'; // the lab PC's robot login (its email starts with this; the email robot's with "mailbot.")
const LAB_V = 2; // the lab PC's message format this app reads (trim-centric; a newer script's messages wait, a month, for a newer app)
const LAB_SHOW_DAYS = 45; // an order nobody can place is asked about on Today while it's this recent and not all trimmed
/* what Ortho Factory can see, and the in-house step it leads to. Ortho Factory records TRIMMING only — sent to the trimmer, then
   trimmed — not 3D printing or thermoforming (those don't run through it here; printing comes from the Formlabs feed, thermoforming
   is a manual tap). Each aligner is at the trimmer (SentToTrimmer/Barcode) or trimmed. The step follows the work: the first aligners
   at the trimmer → Trimming; the set leaves fabrication (→ Polish, wash & dry) once every aligner is trimmed. */
const LAB_STEPS = [
  { k: 'atTrimmer', l: 'At the trimmer', to: 'trim', first: true, why: 'the first aligners are at the trimmer' },
  { k: 'trimmed', l: 'Trimmed', to: 'polish', why: 'every aligner is trimmed' }
];
const LAB_ORDER_STEP = { to: 'send', why: 'the order is in Ortho Factory' }; // the export arrived: Ready to print
function labBeat(b) { return /^lab pc/i.test(String((b && b.box) || '')); }
function labBot(x) { return String((x && x.email) || '').indexOf(LAB_BOT) === 0; }

/* ---------- one order as the lab PC sent it, checked and trimmed to size ---------- */
/* `srv`: when the message reached the inbox (the server's time, which the rules make it give): that's the reading's time — the
   time the message says can't put it ahead of later readings (security review, 6 Oct 2026). Only plain strings and numbers are
   read: a robot could send anything (an object where a string should be would stop the sync) */
function labOrderOf(x, srv, pc) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const str = (v, n) => plainStr(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
  const int = v => { const n = Math.floor(typeof v === 'number' ? v : Number(plainStr(v))); return isFinite(n) && n > 0 ? n : 0; };
  const num = (v, max) => Math.min(int(v), max);
  const ms = v => { const n = int(v); return n > 1577836800000 && n < Date.now() + 864e5 ? n : 0; }; // (2020 on, not the future)
  const cnt = o => { o = o && typeof o === 'object' && !Array.isArray(o) ? o : {}; const n = num(o.n, 999); return { n, atTrimmer: Math.min(num(o.atTrimmer, 999), n), trimmed: Math.min(num(o.trimmed, 999), n) }; };
  const lvs = o => { const r = {}; if (o && typeof o === 'object' && !Array.isArray(o)) ['au', 'al', 'tu', 'tl'].forEach(k => { const v = plainStr(o[k]); if (/^[0-2-]{1,100}$/.test(v)) r[k] = v; }); return r; };
  const key = str(x.key, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, ''); if (!key) return null;
  const ordered = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(str(x.ordered, 19)) ? str(x.ordered, 19) : '', due = /^\d{4}-\d{2}-\d{2}$/.test(str(x.due, 10)) ? str(x.due, 10) : '';
  const s0 = ms(srv), at = s0 ? Math.min(ms(x.at) || s0, s0) : (ms(x.at) || Date.now()), act = ms(x.act);
  return { key, pid: str(x.pid, 30), rev: str(x.rev, 4), first: str(x.first, 60), last: str(x.last, 60), ordered, due,
    au: num(x.au, 99), al: num(x.al, 99), tu: num(x.tu, 99), tl: num(x.tl, 99), a: cnt(x.a), t: cnt(x.t), lv: lvs(x.lv), act: act && s0 ? Math.min(act, s0) : act, at, pc: str(x.pc || pc, 40) };
}
function labPtName(o) { return (o.first + ' ' + o.last).trim(); }
function labDone(o) { const a = (o && o.a) || {}; return a.n > 0 && (a.trimmed || 0) >= a.n; } // every aligner trimmed: the lab PC's part is over
function labOrderedMs(o) { const t = o && o.ordered ? Date.parse(o.ordered) : NaN; return isNaN(t) ? 0 : t; } // (the lab PC's local time, like the office's)
/* what's kept on the case (no names: the case has them) */
function labKeep(o) { return { key: o.key, pid: o.pid, rev: o.rev, ordered: o.ordered, due: o.due, au: o.au, al: o.al, tu: o.tu, tl: o.tl, a: o.a, t: o.t, lv: o.lv || {}, act: o.act, at: o.at, pc: o.pc }; }

/* ---------- finding the case: the order it was linked to, else the patient's name among the open in-house sets ---------- */
/* an order is exported after its set is scanned: one exported before the case's scan date is an earlier set of the patient's
   (their first set's order, still in Ortho Factory, isn't their refinement's) */
function labDateOk(c, o) {
  const day = String(o.ordered || '').slice(0, 10); if (!day) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(c.scanDate || '')) return day >= c.scanDate;
  const t = labOrderedMs(o); return !c.createdAt || !t || t >= c.createdAt - 14 * 864e5;
}
function labMatch(o, open, closed) {
  const mine = c => c && !c.locked && !c.dup && c.type === 'nla' && c.status !== 'done';
  const byKey = open.filter(c => mine(c) && c.labOrd && c.labOrd.key === o.key);
  if (byKey.length === 1) return { c: byKey[0] };
  if (byKey.length > 1) return { many: byKey };
  if ((closed || []).some(c => c && c.type === 'nla' && c.labOrd && c.labOrd.key === o.key)) return { done: true }; // its case is completed
  const name = labPtName(o); if (nameTokens(name).length < 2) return { none: true };
  // the patient's open sets (not ones told "not this order", nor ones scanned after this order was exported)
  const cands = open.filter(c => mine(c) && nameMatches(name, 'full', c.patient) && labDateOk(c, o) && !(Array.isArray(c.labNot) && c.labNot.includes(o.key)));
  const free = cands.filter(c => !(c.labOrd && c.labOrd.key)); // (a set following another order is that order's)
  if (free.length === 1) return { c: free[0] };
  if (free.length > 1) { // two open sets for the patient: the one not checked in yet
    const keys = FLOWS.inhouse.stages.map(s => s[0]), live = free.filter(c => keys.indexOf(liveStage(c)) < keys.indexOf('checkedin'));
    return live.length === 1 ? { c: live[0] } : { many: free };
  }
  return cands.length ? { many: cands } : { none: true };
}
/* worth asking about on Today when it can't be placed: still being made, and exported lately (an old or finished order with no
   open case — a set completed long ago, still in Ortho Factory's folder — is nothing to do) */
function labWorthAsking(o) { const t = labOrderedMs(o); return !labDone(o) && !!t && Date.now() - t < LAB_SHOW_DAYS * 864e5; }

/* what an order does to its case: the progress kept on it (only when it's newer and something changed) and, when nobody typed the
   set's aligner counts, the counts from the export (Amir, 6 Oct 2026: "automatically pick number of aligners based on what gets
   exported") — typed counts are never overwritten (the case offers the lab's instead, see labCountsNote) — and the attachment
   templates when that's not answered yet (the export has the template models, or none) */
function labEffect(c, o) {
  const prev = c.labOrd && c.labOrd.key === o.key ? c.labOrd : null, set = {};
  if (prev && (prev.at || 0) > (o.at || 0)) return { set, prev }; // an older reading than the one kept
  const keep = labKeep(o), core = x => JSON.stringify([x.key, x.ordered, x.au, x.al, x.tu, x.tl, x.a, x.t, x.lv || {}]);
  if (!prev || core(prev) !== core(keep)) set.labOrd = keep;
  const one = typeof oneArch === 'function' ? oneArch(c) : '';
  if (!(Number(c.alU) || 0) && !(Number(c.alL) || 0) && !(Number(c.aligners) || 0)) {
    const u = one === 'L' ? 0 : o.au, l = one === 'U' ? 0 : o.al;
    if (u + l > 0) { set.alU = u || ''; set.alL = l || ''; set.aligners = u + l; }
  }
  if (!c.atTemplates && o.au + o.al > 0) { const at = atFor(o.tu && o.tl ? 'UL' : o.tu ? 'U' : o.tl ? 'L' : 'none', one); if (at) set.atTemplates = at; }
  // what the lab filled in is noted with the order, so "Not this order" can take it back off (security review, 6 Oct 2026)
  const filled = Object.assign({}, prev && prev.filled); ['alU', 'alL', 'aligners', 'atTemplates'].forEach(k => { if (k in set) filled[k] = set[k]; });
  if (Object.keys(filled).length) keep.filled = filled;
  if (!set.labOrd && Object.keys(set).length) set.labOrd = keep; // (the counts came with this reading: keep it too)
  return { set, prev };
}
/* the furthest step every aligner got past with this reading (for the case's history) */
function labStepNew(prev, o) {
  const n = (o.a || {}).n || 0; if (!n) return '';
  const was = k => !!(prev && prev.a && prev.a.n === n && (prev.a[k] || 0) >= n);
  let k = ''; LAB_STEPS.forEach(s => { if ((o.a[s.k] || 0) >= n && !was(s.k)) k = s.k; });
  return k;
}
function labAction(o, eff, extra) {
  const x = Object.assign({ a: 'lab', key: o.key, fields: Object.keys(eff.set).filter(k => k !== 'labOrd'), now: labNowText(o) }, extra || {});
  if (!eff.prev) x.first = 1; const st = labStepNew(eff.prev, o); if (st) x.step = st;
  if (x.fields.length) { x.au = o.au; x.al = o.al; }
  return x;
}
/* one order onto its case, in a transaction (a reading already there, or older, changes nothing) */
async function labApply(o, c) {
  const cur = findCase(c.id); if (!cur || cur.status === 'done' || cur.locked || cur.dup || cur.type !== 'nla') return 'skip'; // (completed or changed since the sync began)
  const eff = labEffect(cur, o); if (!Object.keys(eff.set).length) return 'same';
  await B.mutateCase(c.id, d => { if (d.type !== 'nla' || d.dup) return 'skip'; const e2 = labEffect(Object.assign({}, d, { id: c.id }), o); if (!Object.keys(e2.set).length) return 'skip'; Object.assign(d, e2.set); }, labAction(o, eff));
  return 'ok';
}
/* someone picked the case for an order on Today: it follows this order from now on (an earlier order it followed is let go,
   and so is "not this order" if someone said that about it before) */
async function labLink(o, c) {
  const base = Object.assign({}, c, { labOrd: c.labOrd && c.labOrd.key === o.key ? c.labOrd : '' }), eff = labEffect(base, o);
  if (!eff.set.labOrd) eff.set.labOrd = labKeep(o);
  await B.mutateCase(c.id, d => {
    if (d.labOrd && d.labOrd.key !== o.key) d.labOrd = '';
    if (Array.isArray(d.labNot) && d.labNot.includes(o.key)) d.labNot = d.labNot.filter(k => k !== o.key);
    const e2 = labEffect(Object.assign({}, d, { id: c.id }), o); Object.assign(d, e2.set); if (!d.labOrd) d.labOrd = labKeep(o);
  }, labAction(o, eff, { hand: 1 }));
}
/* "Not this order": taken off the case, and this case is never matched to it again (Undo puts it back) */
async function labUnlink(c) {
  const o = c && c.labOrd; if (!o || !o.key) return;
  const id = c.id, k = o.key, was = JSON.parse(JSON.stringify(o)), fill = o.filled || {};
  // the aligner counts and template answer this order filled in, while they're still what it filled in
  const back = Object.keys(fill).filter(f => String(c[f] == null ? '' : c[f]) === String(fill[f]));
  try {
    await B.mutateCase(id, d => { if (!d.labOrd || d.labOrd.key !== k) return 'skip'; d.labOrd = ''; d.labNot = (Array.isArray(d.labNot) ? d.labNot.filter(x => x !== k) : []).concat(k).slice(-10);
      back.forEach(f => { if (String(d[f] == null ? '' : d[f]) === String(fill[f])) d[f] = ''; }); }, { a: 'lab', key: k, unlink: 1, fields: back });
    toast('Ortho Factory order ' + k + ' taken off this case' + (back.length ? ', with the counts it filled in' : ''), { action: 'Undo', onAction: () => act(() => B.mutateCase(id, d => {
      if (d.labOrd && d.labOrd.key) return 'skip'; d.labOrd = was; if (Array.isArray(d.labNot)) d.labNot = d.labNot.filter(x => x !== k); back.forEach(f => { if (d[f] === '' || d[f] == null) d[f] = fill[f]; }); }, { a: 'lab', key: k, relink: 1, fields: back }), 'Put back') });
  } catch (e) { if (!(e && e.code === 'skip')) toast(errText(e), { bad: true }); }
}
/* the Aligners section's "Use these": the counts from the lab order instead of the typed ones */
async function labUseCounts(c) {
  const o = c && c.labOrd; if (!o) return; const one = oneArch(c), u = one === 'L' ? 0 : o.au, l = one === 'U' ? 0 : o.al; if (u + l <= 0) return;
  await act(() => B.mutateCase(c.id, d => { d.alU = u || ''; d.alL = l || ''; d.aligners = u + l; }, { a: 'edit', fields: ['alU', 'alL', 'aligners'] }), 'Aligner counts set from the lab order');
}

/* ---------- keeping up: the lab PC's messages in the inbox (handed over by mailSync) ---------- */
const LABS = { list: [], pick: {}, more: 0 };
const LAB_PER_SYNC = 400; // orders looked at in one go (more wait for the next look) — a flood can't freeze the page
async function labSync(docs, open, closed, mem) {
  const entries = [], counts = new Map();
  for (const d of docs) {
    try {
      const m = d.mail, list = Array.isArray(m.orders) ? m.orders.slice(0, 200) : [], done = new Set(Array.isArray(d.done) ? d.done : []);
      if ((typeof m.v === 'number' ? m.v : 1) > LAB_V) { if (Date.now() - (d.at || Date.now()) > 30 * 864e5) await B.inboxDelete(d.id).catch(() => { }); continue; } // (a newer script's: kept a month for a newer app)
      if (list.every((x, i) => done.has(i))) { await B.inboxDelete(d.id).catch(() => { }); continue; } // (all dealt with: someone else's last step)
      counts.set(d.id, list.length);
      list.forEach((x, i) => { if (done.has(i) || entries.length >= LAB_PER_SYNC) return; const o = labOrderOf(x, d.at, m.pc); entries.push(o ? { d, i, o } : { d, i, bad: true }); });
    } catch (e) { if (window.console) console.warn('lab progress:', e && e.message); if (Date.now() - (d.at || Date.now()) > 7 * 864e5) await B.inboxDelete(d.id).catch(() => { }); }
  }
  // the newest reading of each order is the one that counts; older ones are done without a save
  const byKey = new Map();
  entries.forEach(e => { if (e.bad) return; if (!byKey.has(e.o.key)) byKey.set(e.o.key, []); byKey.get(e.o.key).push(e); });
  const newest = new Map();
  byKey.forEach((list, k) => newest.set(k, list.reduce((n, e) => !n || e.o.at > n.o.at || (e.o.at === n.o.at && (e.d.at || 0) >= (n.d.at || 0)) ? e : n, null)));
  const marks = new Map(), mark = e => { if (!marks.has(e.d.id)) marks.set(e.d.id, { d: e.d, idx: [] }); marks.get(e.d.id).idx.push(e.i); };
  const todo = new Map(), wait = [];
  for (const e of entries) {
    if (e.bad || newest.get(e.o.key) !== e) { mark(e); continue; }
    const m = labMatch(e.o, open, closed);
    // a case follows this order (or its name says so): applied — even if this computer dismissed the order on Today once
    if (m.c) { if (!todo.has(e.d.id)) todo.set(e.d.id, []); todo.get(e.d.id).push({ e, c: m.c }); continue; }
    const fp = 'lab|' + e.o.key;
    if (m.done || !labWorthAsking(e.o) || MAILS.goneFp.has(fp) || mem.has(await mailHash(fp))) { mark(e); continue; } // nothing to ask (or dismissed here before)
    wait.push({ id: 'lab:' + e.o.key, fp, o: e.o, cands: m.many || [], items: byKey.get(e.o.key).map(y => ({ d: y.d, i: y.i })) });
  }
  // what can be placed is applied by one open app (the one that claims the message); the others leave it to that one
  for (const [id, list] of todo) {
    if (!(await B.inboxClaim(id))) continue;
    for (const { e, c } of list) {
      try { await labApply(e.o, c); mark(e); }
      catch (x) { if (x && (x.code === 'skip' || x.code === 'gone')) mark(e); else if (window.console) console.warn('lab progress:', x && x.message); }
    }
  }
  for (const { d, idx } of marks.values()) {
    const all = new Set((Array.isArray(d.done) ? d.done : []).concat(idx));
    if (all.size >= (counts.get(d.id) || 0)) await B.inboxDelete(d.id).catch(() => { }); else await B.inboxDone(d.id, idx).catch(() => { });
  }
  LABS.list = wait.sort((a, b) => (b.o.at || 0) - (a.o.at || 0));
  LABS.counts = counts;
  return LABS.list.map(x => x.id + '#' + x.o.at + '#' + x.cands.length).join();
}
/* signing out: nothing of this office's stays in the page */
function labReset() { clearTimeout(LABS.soon); Object.assign(LABS, { list: [], pick: {}, counts: null, code: '', cmd: '', soon: 0 }); }
/* a case added or changed while orders wait on Today: look again in a moment (once for a burst of changes) */
function labSoon() { clearTimeout(LABS.soon); LABS.soon = setTimeout(mailSync, 1500); }
/* someone picked the case for an order (or dismissed it): applied, and its messages are done for everyone */
async function labResolve(gid, how, btn) {
  const x = LABS.list.find(g => g.id === gid); if (!x) return;
  if (how === 'apply') {
    const c = findCase(LABS.pick[x.id] || (x.cands.length === 1 ? x.cands[0].id : '')); if (!c) return;
    if (btn) busyBtn(btn, true, 'Linking…');
    try {
      // (an order follows one case: another case following it lets it go)
      for (const y of openCases().filter(y => y.id !== c.id && y.labOrd && y.labOrd.key === x.o.key))
        await B.mutateCase(y.id, d => { if (!d.labOrd || d.labOrd.key !== x.o.key) return 'skip'; d.labOrd = ''; }, { a: 'lab', key: x.o.key, unlink: 1, fields: [] }).catch(() => { });
      await labLink(x.o, c); toast('Lab order linked to ' + (ptNameText(c.patient) || 'the case'));
      MAILS.goneFp.delete(x.fp); try { await mailMemDel(x.fp); } catch (e) { } // (dismissed here once: linked now, so it isn't)
    } catch (e) { if (btn) busyBtn(btn, false); if (!(e && e.code === 'skip')) { toast(errText(e), { bad: true }); return; } }
  } else { MAILS.goneFp.add(x.fp); try { await mailMemAdd(x.fp); } catch (e) { } }
  const byDoc = new Map(); x.items.forEach(it => { if (!byDoc.has(it.d.id)) byDoc.set(it.d.id, { d: it.d, idx: [] }); byDoc.get(it.d.id).idx.push(it.i); });
  for (const { d, idx } of byDoc.values()) {
    const all = new Set((d.done || []).concat(idx)), total = (LABS.counts && LABS.counts.get(d.id)) || (Array.isArray(d.mail.orders) ? d.mail.orders.length : 0);
    if (all.size >= total) await B.inboxDelete(d.id).catch(() => { }); else await B.inboxDone(d.id, idx).catch(() => { });
  }
  LABS.list = LABS.list.filter(g => g !== x); MAILS.sig = ''; queueRender('team'); if (!LABS.quiet) mailSync();
}

/* the case's history line (who: "Lab PC" — or whoever linked it on Today, or took it off the case) */
function labHistText(x) {
  const k = x.key ? ' ' + x.key : '', f = x.fields || [], out = [];
  if (x.unlink) return 'took Ortho Factory order' + k + ' off this case' + (f.length ? ' (and the aligner counts it had filled in)' : '');
  if (x.relink) return 'put Ortho Factory order' + k + ' back on this case';
  if (x.hand) out.push('linked Ortho Factory order' + k); else if (x.first) out.push('found Ortho Factory order' + k);
  if (f.some(n => n === 'alU' || n === 'alL' || n === 'aligners')) out.push('filled in the aligner counts from the export' + (x.au || x.al ? ' (U ' + (x.au || 0) + ' · L ' + (x.al || 0) + ')' : ''));
  if (f.includes('atTemplates')) out.push('answered attachment templates from the export');
  const st = { atTrimmer: 'every aligner sent to the trimmer', trimmed: 'every aligner trimmed' }[x.step];
  if (st) out.push('reported ' + st);
  return out.length ? out.join(', ') : 'updated the lab progress' + (x.now ? ': ' + x.now : '');
}

/* ---------- what the case shows ---------- */
/* "trimmed 5 of 18 · 13 at the trimmer", "all 18 trimmed", "in Ortho Factory, 18 aligners" — where the set is in the lab */
function labNowText(o) {
  const a = (o && o.a) || {}, n = a.n || 0; if (!n) return 'in Ortho Factory';
  const tr = a.trimmed || 0, at = a.atTrimmer || 0;
  if (tr >= n) return 'all ' + n + ' trimmed';
  if (!at) return 'in Ortho Factory, ' + n + ' aligner' + (n === 1 ? '' : 's');
  return 'trimmed ' + tr + ' of ' + n + (at > tr ? ' · ' + (at - tr) + ' at the trimmer' : '');
}
function labWhen(o) { return o && (o.act || o.at) ? fmtWhen(o.act || o.at) : ''; } // (when Ortho Factory last changed the order)
/* the step the lab says the case is ready for, when the case is behind it (the furthest one the work has reached): { to, why } */
function labSuggest(c) {
  const o = c && c.labOrd; if (!o || !o.key || c.type !== 'nla' || c.status === 'done' || c.locked || c.dup) return null;
  const keys = caseStages(c).map(s => s[0]), si = keys.indexOf(liveStage(c)), a = o.a || {}, n = a.n || 0;
  let best = keys.indexOf(LAB_ORDER_STEP.to) > si ? LAB_ORDER_STEP : null;
  if (n) LAB_STEPS.forEach(s => { const v = a[s.k] || 0; if ((s.first ? v > 0 : v >= n) && keys.indexOf(s.to) > si) best = s; });
  return best && keys.includes(best.to) ? { to: best.to, why: best.why } : null;
}
function labStageName(c, k) { const s = caseStages(c).find(x => x[0] === k); return s ? s[1] : k; }
/* the one-tap button: "→ Polish, wash & dry" */
function labGoHTML(c, small) {
  const sg = labSuggest(c); if (!sg) return '';
  const l = labStageName(c, sg.to), tip = 'The lab PC says ' + sg.why + ' — move ' + (c.patient ? ptNameText(c.patient) + ' ' : '') + 'to ' + l;
  return '<button type="button" class="labGo' + (small ? ' sm' : '') + '" data-act="labMove" data-id="' + esc(c.id) + '" data-to="' + esc(sg.to) + '" title="' + esc(tip) + '" aria-label="' + esc(tip) + '">' + ic('next', small ? 13 : 15) + esc(l) + '</button>';
}
/* ---------- the stations' icons (Amir, 6 Oct 2026: "clean animated icons … printing could be a simple 3d printing and trimming
   could be a scissor cutting"). Redrawn 7 Oct with solid parts; Amir's picks of the options: printing "B, Printer", thermoforming
   "A, Sheet drapes", trimming "A, Sharp". A printer whose head slides while solid layers stack into a tooth crown, a heater that
   softens the sheet until it sags and drapes over a tooth, scissors that snip. They move only while that step is going on for the
   set (and never for someone who turned motion down) ---------- */
function labIcon(k, live, s) {
  s = s || 16;
  const F = ' fill="currentColor" stroke="none"',
    tooth = 'M12 11.8C11.2 11.1 10.5 10.8 9.6 10.8C8.1 10.8 7.3 11.9 7.3 13.4C7.3 14.9 8 15.7 8.3 17.2L8.8 20.5H11L11.5 18.6C11.6 18.1 12.4 18.1 12.5 18.6' +
      'L13 20.5H15.2L15.7 17.2C16 15.7 16.7 14.9 16.7 13.4C16.7 11.9 15.9 10.8 14.4 10.8C13.5 10.8 12.8 11.1 12 11.8Z';
  const body = {
    print: '<path d="M4.5 20.5V4h15v16.5"/><path d="M2.5 20.5h19"/><path d="M4.5 8h15"/>' +
      '<g class="ph"><rect x="9.7" y="5.8" width="4.6" height="3.5" rx=".7"' + F + '/><path d="M10.7 9.1h2.6l-.75 1.75h-1.1z"' + F + '/></g>' +
      '<rect class="l1" x="7.4" y="17.6" width="9.2" height="1.9" rx=".6"' + F + '/><rect class="l2" x="8.2" y="15.2" width="7.6" height="1.85" rx=".6"' + F + '/>' +
      '<path class="l3" d="M8.6 14.5v-.55c0-.9.65-1.4 1.75-1.4s1.75.5 1.75 1.4v.55zM11.9 14.5v-.55c0-.9.65-1.4 1.75-1.4s1.75.5 1.75 1.4v.55z"' + F + '/>',
    /* heater (thH) on top, the softened sheet (thS) sags then drops, and the formed tray (thT) shows over the tooth (style.css licSag/licDrape) */
    thermo: '<rect class="thH" x="4" y="2.6" width="16" height="2.1" rx="1.05"' + F + '/><path d="M3.5 20.5h17"/><path d="' + tooth + '"' + F + '/>' +
      '<path class="thS" d="M4 7.4Q12 9.8 20 7.4"/>' +
      '<path class="thT" stroke-width="1.5" d="M3.8 20.5C5.5 20.5 5.9 19.3 6.1 17.4C6.25 15.9 5.75 15 5.75 13.4C5.75 10.9 7.3 9.2 9.6 9.2C10.7 9.2 11.4 9.6 12 10.1' +
      'C12.6 9.6 13.3 9.2 14.4 9.2C16.7 9.2 18.25 10.9 18.25 13.4C18.25 15 17.75 15.9 17.9 17.4C18.1 19.3 18.5 20.5 20.2 20.5"/>',
    /* solid blades that taper to a point, finger rings angled out a little more than the blades so they stay apart mid-snip.
       Both halves turn about the pivot at 12.6,12 (style.css licSnipA/B). */
    trim: '<g class="sa"><circle cx="6.24" cy="6.66" r="2.3"/><path d="M7.92 8.07L12.22 11.68"/><path d="M12.49 11.44L20.98 16.27C17.3 16.86 14.11 15.24 11.6 13.96C10.67 13.48 11.69 11.03 12.49 11.44Z"' + F + '/></g>' +
      '<g class="sb"><circle cx="6.24" cy="17.34" r="2.3"/><path d="M7.92 15.93L12.22 12.32"/><path d="M12.49 12.56L20.98 7.73C17.3 7.14 14.11 8.76 11.6 10.04C10.67 10.52 11.69 12.97 12.49 12.56Z"' + F + '/></g>'
  }[k] || '';
  return '<svg class="lic lic-' + k + (live ? ' live' : '') + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
}
/* what's going on right now: trimming under way — aligners at the trimmer not yet cut, in the last 3 hours (Ortho Factory's last
   change to the order). Printing's "live" will come from the Formlabs feed, not from here. */
function labLive(o) {
  const a = (o && o.a) || {}, n = a.n || 0, age = Date.now() - ((o && (o.act || o.at)) || 0);
  return { trim: n > 0 && (a.atTrimmer || 0) > (a.trimmed || 0) && age < 3 * 3600e3 };
}
/* the station's bar: done (trimmed), then (lighter) the ones on their way — at the trimmer, waiting to be cut */
function labBar(v, q, n) {
  const pct = x => n ? Math.max(0, Math.min(100, Math.round(x / n * 100))) : 0, w = Math.max(0, q - v);
  return '<span class="bar" aria-hidden="true"><i style="width:' + pct(v) + '%"></i>' + (w ? '<i class="q" style="width:' + pct(w) + '%"></i>' : '') + '</span>';
}
const LAB_SAY = {
  trim: (a, n) => 'Trimmed ' + (a.trimmed || 0) + ' of ' + n + ((a.atTrimmer || 0) > (a.trimmed || 0) ? ' · ' + ((a.atTrimmer || 0) - (a.trimmed || 0)) + ' at the trimmer' : '')
};
const LAB_ROWS = [{ k: 'trim', l: 'Trimmed', v: 'trimmed', q: 'atTrimmer' }];
/* ---------- each aligner: Ortho Factory follows them one by one (Amir, 6 Oct 2026: "so it can tell you which aligners have been
   trimmed and which ones haven't"). The lab PC sends a character per aligner number: 0 not at the trimmer yet, 1 at the trimmer,
   2 trimmed, '-' a number the set doesn't have ---------- */
const LAB_LV = ['Not at the trimmer', 'At the trimmer', 'Trimmed'];
/* "1–8, 10, 12–14": the aligner numbers whose step passes the test */
function labRanges(str, test) {
  const out = []; let a = -1;
  for (let i = 0; i <= String(str || '').length; i++) {
    const ch = str[i], ok = ch != null && ch !== '-' && test(Math.min(2, +ch));
    if (ok && a < 0) a = i;
    if (!ok && a >= 0) { out.push(a === i - 1 ? String(a) : a + '–' + (i - 1)); a = -1; }
  }
  return out.join(', ');
}
/* "U1–8 · L1–6": the aligners at a step or past it, both arches (or '' when the lab PC didn't say which) */
function labWhich(o, min) {
  const lv = (o && o.lv) || {}, u = lv.au ? labRanges(lv.au, v => v >= min) : '', l = lv.al ? labRanges(lv.al, v => v >= min) : '';
  return [u ? 'U' + u.replace(/, /g, ', U') : '', l ? 'L' + l.replace(/, /g, ', L') : ''].filter(Boolean).join(' · ');
}
/* the case panel's grid: every aligner of the set by its number, upper and lower, coloured by its step */
function labGridHTML(o) {
  const lv = (o && o.lv) || {}; if (!lv.au && !lv.al) return '';
  const seen = new Set();
  const row = (l, str, a) => {
    if (!str) return ''; const cells = [];
    for (let i = 0; i < str.length; i++) { if (str[i] === '-') continue; const v = Math.min(2, +str[i]); seen.add(v);
      cells.push('<span class="lac l' + v + '" title="' + esc(a + i + ': ' + LAB_LV[v].toLowerCase()) + '">' + i + '</span>'); }
    const say = [2, 1, 0].map(v => { const r = labRanges(str, x => x === v); return r ? LAB_LV[v].toLowerCase() + ' ' + r : ''; }).filter(Boolean).join('; ');
    return '<div class="labGr" role="img" aria-label="' + esc(l + ' aligners: ' + say) + '"><span class="lagL" aria-hidden="true">' + esc(l) + '</span><span class="lagC" aria-hidden="true">' + cells.join('') + '</span></div>';
  };
  const rows = row('Upper', lv.au, 'U') + row('Lower', lv.al, 'L');
  return '<div class="labGrid">' + rows + '<div class="lagKey" aria-hidden="true">' + [2, 1, 0].filter(v => seen.has(v)).map(v => '<span><i class="lac l' + v + '"></i>' + esc(LAB_LV[v]) + '</span>').join('') + '</div></div>';
}
/* a board card's small bar: the station's icon, the bar, "16/24" */
function labMeter(r, o, live) {
  const a = o.a || {}, n = a.n || 0, v = a[r.v] || 0, done = n && v >= n, which = done ? '' : labWhich(o, 2);
  const say = LAB_SAY[r.k](a, n) + (which ? ' (' + which + ')' : '');
  return '<span class="labM' + (done ? ' done' : v ? ' on' : '') + '" role="img" aria-label="' + esc(say) + '" title="' + esc(say) + '">' + labIcon(r.k, live && !done, 16) + labBar(v, a[r.q] || 0, n) + '<span class="v">' + v + '/' + n + '</span></span>';
}
function labMetersHTML(o) { return labMeter(LAB_ROWS[0], o, labLive(o).trim); }
/* the board card's lines: the set's trimming, and the step it's ready for when the case is behind */
function labCardHTML(c) {
  const o = c.labOrd; if (!o || !o.key || c.type !== 'nla' || c.status === 'done') return '';
  const a = o.a || {}, n = a.n || 0, any = n && ((a.atTrimmer || 0) > 0 || (a.trimmed || 0) > 0);
  return '<div class="labLn" title="' + esc('Ortho Factory order ' + o.key + ' · ' + labNowText(o) + (labWhen(o) ? ' · ' + labWhen(o) : '')) + '">' +
    (any ? '' : ic('lab', 13)) + '<div class="labB">' + (any ? labMetersHTML(o) : '<span class="t">In Ortho Factory</span>') + labGoHTML(c, true) + '</div></div>';
}
/* "upper trimmed · lower thermoformed" (each arch's templates as far as the furthest behind of them), else from the counts */
function labTemplText(o) {
  const t = o.t || {}, lv = o.lv || {}, low = str => { const v = Array.from(str || '').filter(c => c !== '-').map(c => Math.min(2, +c)); return v.length ? Math.min.apply(null, v) : -1; };
  const nm = x => { const v = low(x); return v < 0 ? '' : LAB_LV[v].toLowerCase(); };
  if (nm(lv.tu) || nm(lv.tl)) return [nm(lv.tu) ? 'upper ' + nm(lv.tu) : '', nm(lv.tl) ? 'lower ' + nm(lv.tl) : ''].filter(Boolean).join(' · ');
  return (t.trimmed || 0) >= t.n ? (t.n === 1 ? 'trimmed' : t.n === 2 ? 'both trimmed' : 'all ' + t.n + ' trimmed') : !t.atTrimmer ? 'not at the trimmer yet' : 'trimmed ' + (t.trimmed || 0) + ' of ' + t.n;
}
/* the case panel's Lab section: its folded line, and the counts */
function labSumHTML(c) { const o = c.labOrd; return o && o.key ? '<b>' + esc(labNowText(o)) + '</b>' + (labWhen(o) ? ' · <span class="muted">' + esc(labWhen(o)) + '</span>' : '') : ''; }
function labBoxHTML(c) {
  const o = c.labOrd; if (!o || !o.key) return '';
  const a = o.a || {}, n = a.n || 0, any = n && ((a.atTrimmer || 0) > 0 || (a.trimmed || 0) > 0), lv = labLive(o);
  const row = r => { const v = a[r.v] || 0, done = n && v >= n, more = LAB_SAY[r.k](a, n).split(' · ')[1] || '';
    return '<div class="labRow' + (done ? ' done' : v ? ' on' : '') + '">' + labIcon(r.k, !done && lv[r.k], 18) + '<span class="l">' + esc(r.l) + (more ? '<small>' + esc(more) + '</small>' : '') + '</span>' +
      labBar(v, a[r.q] || 0, n) + '<span class="v"><b>' + v + '</b> of ' + n + '</span></div>'; };
  const t = o.t || {}, ord = labOrderedMs(o), done = c.status === 'done';
  return '<div class="labBox">' + (any ? LAB_ROWS.map(row).join('') + labGridHTML(o) : '<div class="small">In Ortho Factory, not at the trimmer yet' + (n ? ' (' + n + ' aligner' + (n === 1 ? '' : 's') + ')' : '') + '.</div>') +
    '<div class="small muted labT">Printing shows here once the Formlabs print feed is connected.</div>' +
    (t.n ? '<div class="small muted labT">Attachment templates: ' + esc(labTemplText(o)) + '</div>' : '') +
    '<div class="small muted labMeta">Ortho Factory order <b>' + esc(o.key) + '</b>' + (ord ? ' · exported ' + esc(fmtWhen(ord)) : '') + (o.au ? ' · U ' + o.au : '') + (o.al ? ' · L ' + o.al : '') +
      (o.tu || o.tl ? ' · templates ' + (o.tu && o.tl ? 'U & L' : o.tu ? 'U' : 'L') : '') + (labWhen(o) ? ' · last change ' + esc(labWhen(o)) : '') + '</div>' +
    (done ? '' : '<div class="labBtns">' + labGoHTML(c, false) + '<button type="button" class="btn btn-ghost btn-sm" data-act="labUnlink" title="Not this patient’s order? Take it off this case">Not this order</button></div>') + '</div>';
}
/* the Aligners section: typed counts that differ from the export — one tap to use the lab's */
function labCountsNote(c) {
  const o = c.labOrd; if (!o || !o.key || !(o.au || o.al) || !(Number(c.alU) || Number(c.alL)) || c.status === 'done') return '';
  const one = oneArch(c), U = one === 'L' ? 0 : o.au, L = one === 'U' ? 0 : o.al;
  if ((Number(c.alU) || 0) === U && (Number(c.alL) || 0) === L) return '';
  const say = (u, l) => one === 'U' ? 'U ' + u : one === 'L' ? 'L ' + l : 'U ' + u + ' · L ' + l;
  return '<div class="notice labCnt">' + ic('lab', 15) + '<span>The Ortho Factory order has <b>' + say(U, L) + '</b> — this case says ' + say(Number(c.alU) || 0, Number(c.alL) || 0) + '.</span>' +
    '<button type="button" class="btn btn-sec btn-sm" data-act="labUseCounts">Use these</button></div>';
}

/* ---------- Today: lab orders waiting for a case ---------- */
function labWaitHTML() {
  const L0 = LABS.list; if (!L0.length) return '';
  const L = L0.slice(0, 25); // (25 at a time: a flood of orders can't bury Today)
  const open = openCases().filter(c => !c.locked && !c.dup && c.type === 'nla').sort((a, b) => String(a.patient || '').localeCompare(String(b.patient || '')));
  return '<div class="card mailCard labCard" id="labCard"><div class="cardHd"><h3>Lab orders</h3><span class="sub">' + (L0.length === 1 ? 'An order' : L0.length + ' orders') + ' in Ortho Factory didn’t match an open in-house case — pick the case, or dismiss</span><span style="flex:1"></span>' +
    (L0.length > 1 ? '<button class="btn btn-ghost btn-sm" data-act="labSkipAll" title="None of these is a case in NLO Cases">Dismiss all</button>' : '') + '</div><div class="cardBd">' +
    L.map(x => {
      const o = x.o, pick = LABS.pick[x.id] || (x.cands.length === 1 ? x.cands[0].id : ''), gid = esc(x.id), ord = labOrderedMs(o);
      const opt = c => '<option value="' + esc(c.id) + '"' + (pick === c.id ? ' selected' : '') + '>' + esc((ptNameText(c.patient) || '(no name)') + ' · ' + stageLabel(c)) + '</option>';
      const rest = open.filter(c => !x.cands.includes(c));
      return '<div class="mlRow"><div class="mlWhat"><span class="badge t-lab">Ortho Factory</span><span class="mlName">' + ptName(labPtName(o) || 'No name on the order') + '</span>' +
        '<span class="small muted">' + esc(labNowText(o)) + (ord ? ' · exported ' + esc(fmtWhen(ord)) : '') + ' · order ' + esc(o.key) + '</span>' +
        (x.cands.length > 1 ? '<span class="small" style="color:var(--amber-700)">' + x.cands.length + ' possible cases</span>' : x.cands.length === 1 ? '<span class="small" style="color:var(--amber-700)">its case follows another order</span>' : '') + '</div>' +
        '<div class="mlDo"><select class="inp labSel" data-g="' + gid + '" aria-label="Case for this lab order"><option value="">Pick the case…</option>' +
        (x.cands.length ? '<optgroup label="Possible matches">' + x.cands.map(opt).join('') + '</optgroup>' : '') +
        (rest.length ? '<optgroup label="Open in-house cases">' + rest.map(opt).join('') + '</optgroup>' : '') + '</select>' +
        '<button class="btn btn-mint btn-sm" data-act="labLink" data-g="' + gid + '"' + (pick ? '' : ' disabled') + '>Link</button>' +
        '<button class="btn btn-ghost btn-sm" data-act="labSkip" data-g="' + gid + '" title="Not a case in NLO Cases">Dismiss</button></div></div>';
    }).join('') + (L0.length > L.length ? '<div class="small muted" style="padding-top:8px">' + (L0.length - L.length) + ' more — they show as these are linked or dismissed.</div>' : '') + '</div></div>';
}

/* ---------- Team & security: set up the lab PC, see when it last checked in ---------- */
function labAdminHTML() {
  const st = MAILS.state;
  if (!st || Date.now() - MAILS.stateAt > 60000) loadMailState();
  const head = '<div class="card" style="margin-top:18px" id="labAdmin"><div class="cardHd"><h3>Lab PC</h3><span class="sub">Ortho Factory’s progress on each in-house set</span></div><div class="cardBd">';
  if (!st) return head + '<div class="small muted">Loading…</div></div></div>';
  const how = '<p class="small" style="margin-bottom:10px">A small script on the lab PC reads Ortho Factory’s orders — which aligners are at the trimmer and trimmed — and sends them here, locked so only this app can read them. Each in-house case shows its trimming, fills in its aligner counts from the export, and offers the next step with one tap. Nothing moves by itself. (3D printing comes from the Formlabs feed, not Ortho Factory.) Orders it can’t place show on Today.</p>';
  const bots = (st.bots || []).filter(labBot), beats = (st.beats || []).filter(labBeat).sort((a, b) => (b.at || 0) - (a.at || 0));
  if (!bots.length) return head + how + '<button class="btn btn-act btn-sm" data-act="labSetup">' + ic('plus', 15) + 'Set up the lab PC</button></div></div>';
  const box = b => { const late = !b.at || Date.now() - b.at > 20 * 60000;
    return '<div class="mlBeat"><span class="dot ' + (b.err ? 'bad' : late ? 'busy' : 'ok') + '"></span><b>' + esc(b.box) + '</b><span class="small muted">checked in ' + esc(b.at ? fmtWhen(b.at) : '—') +
      ' · ' + (b.seen || 0) + ' order' + (b.seen === 1 ? '' : 's') + ' in Ortho Factory · ' + (b.sent || 0) + ' update' + (b.sent === 1 ? '' : 's') + ' sent today' + (b.ver ? ' · ' + esc(b.ver) : '') + '</span>' +
      (b.err ? '<div class="small" style="color:var(--coral-700);flex-basis:100%">Last problem: ' + esc(b.err) + '</div>' : late ? '<div class="small" style="color:var(--amber-700);flex-basis:100%">No check-in for 20 minutes. Is the lab PC on, with its “NLO Lab Bridge” window open?</div>' : '') + '</div>'; };
  return head + how + (beats.length ? beats.map(box).join('') : '<div class="notice">Set up, but the lab PC hasn’t checked in yet. Run the script on the lab PC with the setup code (New setup code shows the steps again).</div>') +
    '<div class="mlBtns"><button class="btn btn-sec btn-sm" data-act="labSetup">' + ic('key', 15) + 'New setup code</button><a class="btn btn-ghost btn-sm" href="nlo-lab-bridge.ps1" download>' + ic('download', 15) + 'The script</a>' +
    '<button class="btn btn-ghost btn-sm" data-act="labOff" style="color:var(--coral-700)">Turn off</button></div></div></div>';
}
/* the code the lab PC's script asks for: this office's project and the lab PC's login */
function labCode(creds) {
  const cfg = B === DEMO ? { apiKey: 'demo', projectId: 'demo' } : FB.cfg, c = { p: cfg.projectId || 'demo', k: cfg.apiKey || 'demo', e: creds.email, w: creds.password };
  if (B === FB && FB.emu) { c.ab = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'; c.tb = 'http://127.0.0.1:9099/securetoken.googleapis.com/v1'; c.fb = 'http://127.0.0.1:8080/v1'; }
  return 'NLOLAB1.' + b64(TE.encode(JSON.stringify(c))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function labSetupModal(creds) {
  const code = labCode(creds), cmd = 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\\Downloads\\nlo-lab-bridge.ps1" -Install';
  LABS.code = code; LABS.cmd = cmd;
  openModal('<h3>Set up the lab PC</h3><div class="lsub">On the lab PC, signed in as the Laboratory user. About 3 minutes. Nothing needs an administrator.</div>' +
    '<ol class="mlSteps"><li>Download the script on the lab PC: <a href="nlo-lab-bridge.ps1" download><b>nlo-lab-bridge.ps1</b></a> (it lands in Downloads).</li>' +
    '<li>Open <b>Windows PowerShell</b> (Start → type PowerShell), paste this line and press Enter:<div class="labCmd"><code id="labCmd">' + esc(cmd) + '</code><button type="button" class="btn btn-sec btn-sm" data-act="labCopyCmd">Copy</button></div></li>' +
    '<li>When it asks for the setup code, paste this one and press Enter:<div class="labCmd"><code id="labCode">' + esc(code) + '</code><button type="button" class="btn btn-pri btn-sm" data-act="labCopyCode">Copy the setup code</button></div></li>' +
    '<li>It checks itself, signs in and starts with Windows (a small minimised “NLO Lab Bridge” window). Back here, the lab PC appears under Lab PC with its first check-in.</li></ol>' +
    '<p class="small muted">The setup code is the lab PC’s own login: it can only add sealed lab progress to this app, and it’s shown this once. Don’t share it. Need it again? Make a new one (the old one stops working).</p>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeModal">Done</button></div>', w => w.querySelector('.modal').classList.add('wide'));
}
Object.assign(ADMIN_ACTS, {
  async labSetup(t) {
    const again = ((MAILS.state && MAILS.state.bots) || []).some(labBot);
    if (!await confirmBox(again ? 'Make a new setup code?' : 'Set up the lab PC?', (again ? 'The lab PC’s current login stops working, so its script needs the new code. ' : '') + 'This makes a login for the lab PC that can only add sealed lab progress to this app. Then you run a small script on the lab PC.', again ? 'New setup code' : 'Set up')) return;
    busyBtn(t, true, 'Setting up…');
    try { const creds = await B.labSetup(); MAILS.state = null; loadMailState(); labSetupModal(creds); }
    catch (e) { busyBtn(t, false); toast(errText(e), { bad: true }); }
  },
  async labOff() {
    if (!await confirmBox('Turn off the lab PC?', 'Its login stops working right away, so nothing more comes in from Ortho Factory. On the lab PC, run the script with -Uninstall to stop it trying. You can set it up again any time.', 'Turn off', true)) return;
    try { await B.labOff(); MAILS.state = null; loadMailState(); toast('Lab PC turned off'); } catch (e) { toast(errText(e), { bad: true }); }
  },
  async labCopyCode() { const ok = await copyText(LABS.code || ''); toast(ok ? 'Setup code copied — paste it on the lab PC' : 'Couldn’t copy — select the code and copy it', ok ? {} : { bad: true }); },
  async labCopyCmd() { const ok = await copyText(LABS.cmd || ''); toast(ok ? 'Copied — paste it into PowerShell on the lab PC' : 'Couldn’t copy — select the line and copy it', ok ? {} : { bad: true }); },
  labLink(t) { labResolve(t.dataset.g, 'apply', t); },
  labSkip(t) { labResolve(t.dataset.g, 'skip'); },
  async labSkipAll(t) {
    const L = LABS.list.slice(); if (!L.length) return;
    if (!await confirmBox('Dismiss all ' + L.length + ' lab orders?', 'They’re cleared from Today. Nothing changes on any case. An order that later matches a case still updates it.', 'Dismiss all')) return;
    busyBtn(t, true, 'Dismissing…'); LABS.quiet = true;
    try { for (const x of L) await labResolve(x.id, 'skip'); } finally { LABS.quiet = false; }
    toast(L.length + ' lab order' + (L.length > 1 ? 's' : '') + ' dismissed'); mailSync();
  },
  labMove(t, e) { if (e) e.stopPropagation(); const c = findCase(t.dataset.id); if (c && labSuggest(c) && labSuggest(c).to === t.dataset.to) moveStage(c.id, t.dataset.to, null, null, 'lab'); },
  labUnlink() { const c = findCase(S.openId); if (c) labUnlink(c); },
  labUseCounts() { const c = findCase(S.openId); if (c) labUseCounts(c); }
});
