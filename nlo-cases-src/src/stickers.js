/* ---------- Stickers on a case (Amir, 7 Oct 2026) ----------
   "it would be cool to be able to add stickers in the form of emoji's to each other in different sections". He picked: on a note,
   and "also to steps that someone does. like moving something from Polishing to packaging etc.", on any section of a case, and the
   person it's for gets it in their Messages.
   A sticker is an entry of the case's stickers (sealed with the rest of the case):
     { id, at, by, e: '🎉', on, to?: sid, k?: step key, l?: what it's on, in words (for Messages) }
   on: 'n:<note id>' a note ('n:field' = the case form's Notes) · 'h:<rev>' a step someone did — an entry of the case's history
   ('h:t<ms>' for an entry without a rev) · 's:<section>' a section of the case panel.
   Who it's for: the note's writer, whoever did the step, or — on a section — whoever last worked on it (else the case's assignee),
   which the sender can change. A tap on a sticker that's already there sends yours too, or takes yours back. */

const STK_SET = ['👍', '🎉', '❤️', '✅', '😂', '🙏', '💪', '🦷'];
const STK_SAY = { '👍': 'Thumbs up', '🎉': 'Party popper', '❤️': 'Heart', '✅': 'Check mark', '😂': 'Laughing', '🙏': 'Thank you', '💪': 'Flexed arm', '🦷': 'Tooth' };
const STK_MAX = 200; // kept on a case (the oldest go first)
/* the sections whose heading takes stickers — all but Stage, Notes and History, whose steps and notes take them one by one —
   and what each is made of, to tell who last worked on it */
const STK_NO_SEC = ['stage', 'notes', 'history'];
const STK_SEC_F = {
  lab: ['labOrd', 'labNot', 'labRef', 'labHold'], marpe: ['records', 'zoomDate', 'zoomTime'],
  details: ['assignee', 'assistant', 'scanner', 'scanDate', 'dueDate', 'labDate', 'deliveryDate', 'deliveryTime', 'tracking', 'carrier', 'labRef', 'chart', 'shipToPatient'],
  tx: ['txStart', 'txEnd'], aligners: ['alU', 'alL', 'aligners', 'atTemplates', 'treatArch'], instr: ['instructions', 'goals', 'instrPicks', 'instrOther'],
  teeth: ['teeth', 'teethNote'], ipr: ['ipr', 'iprSnap'], wty: ['invDate', 'noGuarantee'], rx: ['rx'], rxRet: ['rxRet'], rxMet: ['rxMet'], rxFun: ['rxFun']
};

function stkOk(s) { return !!s && typeof s === 'object' && typeof s.id === 'string' && typeof s.e === 'string' && s.e.length <= 16 && typeof s.on === 'string' && s.on.length <= 80 && typeof s.by === 'string'; }
function stkList(c) { return c && Array.isArray(c.stickers) ? c.stickers.filter(stkOk) : []; }
function stkOn(c, on) { return on ? stkList(c).filter(s => s.on === on) : []; }
/* "Dr. A", a first name — or "You" */
function stkName(sid) { const r = staff(sid); return r && r.role === 'owner' ? 'Dr. A' : firstName(staffName(sid, '')) || 'Someone'; }
function stkWho(sid) { return sid && sid === meSid() ? 'You' : stkName(sid); }
/* each sticker sits at its own slight angle, the same every time */
function stkTilt(id) { let h = 7; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 997; return (h % 13) - 6; }
/* the entry of the case's history a step's sticker is on */
function stkHKey(x) { return x && x.rev ? 'h:' + x.rev : x && x.at ? 'h:t' + x.at : ''; }
/* who did it, when it was a person (not a lab email, the lab PC's readings or the Asana import) */
function stkDoer(x) {
  if (!x || !x.sid || ['email', 'import', 'rekey', 'save', 'sticker', 'restore'].includes(x.a)) return '';
  if (x.a === 'lab' && !x.hand && !x.unlink && !x.relink) return '';
  return staff(x.sid) ? x.sid : '';
}
function stkStepName(c, k) { const s = caseStages(c).find(x => x[0] === k) || flowOf(c).stages.find(x => x[0] === k); return s ? s[1] : (retiredStageLabel(c, k) || k); }

/* ---------- on the case panel ---------- */
function stkAttrs(x) {
  return ' data-on="' + esc(x.on || '') + '"' + (x.to ? ' data-to="' + esc(x.to) + '"' : '') + (x.k ? ' data-k="' + esc(x.k) + '"' : '') + (x.l ? ' data-l="' + esc(x.l) + '"' : '') + (x.sec ? ' data-sec="1"' : '') + (x.w ? ' data-w="' + esc(x.w) + '"' : '');
}
/* the stickers on one thing, one chip per sticker: "🎉 You, Gwen" — yours marked; `x.ro`: a completed case, nothing to tap */
function stkChipsHTML(L, x) {
  if (!L.length) return '';
  const me = meSid(), G = [];
  L.slice().sort((a, b) => (a.at || 0) - (b.at || 0)).forEach(s => { let g = G.find(y => y.e === s.e); if (!g) G.push(g = { e: s.e, L: [] }); g.L.push(s); });
  return G.map(g => {
    const mine = g.L.some(s => s.by === me), ppl = Array.from(new Set(g.L.map(s => s.by))).sort((a, b) => (b === me) - (a === me)), who = ppl.map(stkWho);
    const lab = who.length > 2 ? who.slice(0, 2).join(', ') + ' +' + (who.length - 2) : who.join(', ');
    const tip = g.L.map(s => stkWho(s.by) + (s.to && s.to !== s.by ? ' → ' + stkWho(s.to) : '') + ' · ' + fmtWhen(s.at)).join('\n');
    const say = (STK_SAY[g.e] || 'Sticker') + ' from ' + who.join(', '), ids = ' data-ids="' + esc(g.L.map(s => s.id).join(' ')) + '"';
    const inner = '<span class="stkE" style="--r:' + stkTilt(g.L[0].id) + 'deg" aria-hidden="true">' + esc(g.e) + '</span><span class="stkW">' + esc(lab) + '</span>';
    if (x.ro) return '<span class="stk ro" role="img"' + ids + ' title="' + esc(tip) + '" aria-label="' + esc(say) + '">' + inner + '</span>';
    return '<button type="button" class="stk' + (mine ? ' mine' : '') + '" data-act="stkTog" data-e="' + esc(g.e) + '"' + stkAttrs(x) + ids + ' aria-pressed="' + mine + '"' +
      ' title="' + esc(tip + '\n' + (mine ? 'Tap to take yours back' : 'Tap to send one too')) + '" aria-label="' + esc(say) + '">' + inner + '</button>';
  }).join('');
}
/* the smiley that opens the stickers (`w`: where it is, to find it again after the panel redraws) */
function stkAddHTML(x, w) {
  return '<button type="button" class="stkAdd" data-act="stkAdd"' + stkAttrs(Object.assign({}, x, { w })) + ' aria-haspopup="dialog" aria-expanded="false" title="Send a sticker" aria-label="Send a sticker' + (x.what ? ' on ' + esc(x.what) : '') + '">' + ic('stk', 17) + '</button>';
}
/* a note: the smiley at the top right, its stickers under the text */
function stkNoteAddHTML(c, n) {
  if (c.status === 'done') return '';
  return stkAddHTML({ on: 'n:' + n.id, to: n.by && staff(n.by) ? n.by : '', what: 'this note' }, 'n:' + n.id);
}
function stkNoteRowHTML(c, n) {
  const L = stkOn(c, 'n:' + n.id); if (!L.length) return '';
  return '<div class="stkRow">' + stkChipsHTML(L, { on: 'n:' + n.id, to: n.by && staff(n.by) ? n.by : '', w: 'n:' + n.id, ro: c.status === 'done' }) + '</div>';
}
/* a step of the Stage section: the smiley beside the step someone moved the case to (once the history says who), the step's
   stickers on a line under it */
function stkStepCtx(c, k, m) {
  if (!m || !m.h || !m.by || !staff(m.by)) return null;
  const nm = stkStepName(c, k);
  return { on: m.h, to: m.by, k, l: m.born ? 'created the case' : 'moved it to ' + nm, what: m.born ? 'the step the case started at' : 'the move to ' + nm };
}
function stkSlotHTML(c, k, m) { const x = c.status === 'done' ? null : stkStepCtx(c, k, m); return x ? stkAddHTML(x, 'st:' + k) : ''; }
function stkStepHTML(c, k, m) {
  const L = stkList(c).filter(s => s.k === k), x = Object.assign(stkStepCtx(c, k, m) || { on: '', k }, { w: 'st:' + k });
  return '<span class="stkSlot" data-k="' + esc(k) + '">' + stkSlotHTML(c, k, m) + '</span>' +
    (L.length ? '<div class="stepStk" data-k="' + esc(k) + '">' + stkChipsHTML(L, Object.assign({}, x, { ro: c.status === 'done' })) + '</div>' : '');
}
/* a history entry someone made: its stickers after the words, the smiley at the end of the row */
function stkHistHTML(c, x, t) {
  const h = stkHKey(x), who = x.a === 'comment' ? '' : stkDoer(x); if (!c || !h) return { chips: '', add: '' };
  const k = x.to && (x.a === 'stage' || (x.a === 'edit' && (x.fields || []).includes('stage'))) ? x.to : '';
  const ctx = { on: h, to: who, k, l: String(t || '').slice(0, 140), w: 'hi:' + h }, L = stkOn(c, h), done = c.status === 'done';
  return { chips: L.length ? ' <span class="stkIn">' + stkChipsHTML(L, Object.assign({ ro: done }, ctx)) + '</span>' : '',
    add: who && !done ? stkAddHTML(Object.assign({ what: 'this step' }, ctx), 'hi:' + h) : '' };
}
/* a section's heading (every one but Stage, Notes and History) */
function stkHdHTML(k, title) {
  if (STK_NO_SEC.includes(k) || S.editing) return '';
  const c = S.openId && findCase(S.openId); if (!c) return '';
  const on = 's:' + k, L = stkOn(c, on), done = c.status === 'done'; if (done && !L.length) return '';
  const x = { on, l: String(title || '').slice(0, 80), sec: true, w: 's:' + k };
  return '<span class="stkHd">' + stkChipsHTML(L, Object.assign({ ro: done }, x)) + (done ? '' : stkAddHTML(Object.assign({ what: title }, x), 's:' + k)) + '</span>';
}
/* who a sticker on a section is for, to start with: the last one (not you) whose change touched it — the history says — or who
   made the case; else the case's assignee */
function stkSecTo(c, k) {
  const me = meSid(), F = STK_SEC_F[k] || [], h = S.history && S.openId === c.id ? S.history : [];
  for (let i = h.length - 1; i >= 0; i--) {
    const x = h[i] || {}, who = stkDoer(x), fs = x.fields || []; if (!who || who === me) continue;
    if (x.a === 'create' || (['edit', 'stage'].includes(x.a) && fs.some(f => F.includes(f))) || (k === 'details' && x.a === 'assign') || (k === 'lab' && x.a === 'lab')) return who;
  }
  const a = c.assignee, r = a && staff(a); return r && r.active && a !== me ? a : '';
}

/* ---------- sending (and taking back) ---------- */
/* what's been sent from here and not saved yet: it shows at once, and a copy of the case arriving before it's saved keeps it */
function stkPendApply(c) {
  const P = S.stkPend && S.stkPend[c.id]; if (!P || !P.length) return;
  let L = Array.isArray(c.stickers) ? c.stickers.slice() : [];
  P.forEach(p => { if (p.op === 'add') { if (!L.some(s => s && s.id === p.s.id)) L.push(p.s); } else L = L.filter(s => !(s && p.ids.includes(s.id))); });
  c.stickers = L;
}
function stkPendDrop(id, op) { const P = S.stkPend && S.stkPend[id]; if (P) { S.stkPend[id] = P.filter(p => p !== op); if (!S.stkPend[id].length) delete S.stkPend[id]; } }
function stkNew(e, x, to) {
  const me = meSid();
  return Object.assign({ id: uid8(), at: Date.now(), by: me, e, on: x.on }, to && to !== me ? { to } : {}, x.k ? { k: x.k } : {}, x.l ? { l: String(x.l).slice(0, 140) } : {});
}
async function stkApply(id, op) {
  const c = findCase(id); if (!c) return;
  S.stkPend = S.stkPend || {}; (S.stkPend[id] = S.stkPend[id] || []).push(op);
  stkPendApply(c); if (S.openId === id && !S.editing) renderDrawer();
  const meta = op.op === 'add' ? Object.assign({ a: 'sticker', e: op.s.e, on: op.s.on }, op.s.to ? { who: op.s.to } : {}) : { a: 'sticker', del: true, e: op.e || '', on: op.on || '' };
  try {
    await B.mutateCase(id, d => {
      let L = Array.isArray(d.stickers) ? d.stickers.filter(stkOk) : [];
      if (op.op === 'add') { if (L.some(s => s.id === op.s.id)) return 'skip'; L = L.concat([op.s]); if (L.length > STK_MAX) L = L.slice(L.length - STK_MAX); }
      else { const n = L.length; L = L.filter(s => !op.ids.includes(s.id)); if (L.length === n) return 'skip'; }
      d.stickers = L;
    }, meta);
  } catch (e) {
    if (!(e && e.code === 'skip')) { // not saved: it comes off again (or back)
      stkPendDrop(id, op); const cur = findCase(id);
      if (cur) { let L = stkList(cur); if (op.op === 'add') L = L.filter(s => s.id !== op.s.id); else op.removed.forEach(s => { if (!L.some(y => y.id === s.id)) L.push(s); }); cur.stickers = L; }
      if (S.openId === id && !S.editing) renderDrawer();
      toast(errText(e), { bad: true });
    }
  } finally { stkPendDrop(id, op); }
}
/* a tap on a sticker that's there: yours comes off, or one like it goes on from you */
function stkTog(t) {
  const c = findCase(S.openId); if (!c || c.status === 'done') return;
  const me = meSid(), ids = String(t.dataset.ids || '').split(' '), L = stkList(c).filter(s => ids.includes(s.id)); if (!L.length) return;
  const mine = L.filter(s => s.by === me);
  if (mine.length) { stkApply(c.id, { op: 'del', ids: mine.map(s => s.id), removed: mine, e: mine[0].e, on: mine[0].on }); return; }
  const f = L[L.length - 1], x = { on: t.dataset.on || f.on, k: t.dataset.k || f.k || '', l: t.dataset.l || f.l || '' };
  stkApply(c.id, { op: 'add', s: stkNew(f.e, x, t.dataset.sec === '1' ? (f.to || '') : (t.dataset.to || f.to || '')) });
}

/* ---------- the stickers to pick from ---------- */
function stkTargetMine(c, x) { const me = meSid(); return stkList(c).filter(s => s.by === me && (x.k ? s.k === x.k : s.on === x.on)); }
function stkOpen(btn) {
  const c = findCase(S.openId); if (!c || c.status === 'done') return;
  if (S.stk && S.stk.w === btn.dataset.w) { stkClose(true); return; } // (its smiley again: closes it)
  stkClose();
  const d = btn.dataset, x = { on: d.on || '', to: d.to || '', k: d.k || '', l: d.l || '', sec: d.sec === '1' };
  if (!x.on) return;
  if (x.sec) x.to = stkSecTo(c, x.on.slice(2));
  const have = new Set(stkTargetMine(c, x).map(s => s.e));
  const m = document.createElement('div'); m.className = 'stkPick'; m.id = 'stkPick'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', 'Send a sticker');
  m.innerHTML = '<div class="stkGrid" role="group" aria-label="Stickers">' + STK_SET.map(e => '<button type="button" class="stkOpt" data-act="stkPut" data-e="' + esc(e) + '" aria-pressed="' + have.has(e) + '"' +
      ' title="' + esc(STK_SAY[e] + (have.has(e) ? ' — yours is on it: tap to take it back' : '')) + '" aria-label="' + esc(STK_SAY[e]) + '"><span aria-hidden="true">' + esc(e) + '</span></button>').join('') + '</div>' + stkToHTML(x);
  const host = $('#drawer') || document.body; host.appendChild(m);
  S.stk = { id: c.id, x, w: d.w, btn, el: m }; btn.setAttribute('aria-expanded', 'true'); btn.classList.add('on');
  stkPlace();
  const f = $('.stkOpt', m); if (f) f.focus({ preventScroll: true });
}
/* who gets it: fixed on a note or a step (the one who wrote or did it); picked on a section */
function stkToHTML(x) {
  const me = meSid();
  if (x.sec) {
    const P = mtPeople(true), opts = [['', 'No one — it just stays here']].concat(P.map(p => [p.sid, p.l]));
    if (x.to && !P.some(p => p.sid === x.to)) opts.push([x.to, stkName(x.to)]);
    return '<div class="stkTo"><label for="stkToSel">For</label><select id="stkToSel">' + opts.map(([v, l]) => '<option value="' + esc(v) + '"' + (v === x.to ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select><span class="stkToNote" id="stkToNote">' + stkToNote(x.to) + '</span></div>';
  }
  if (!x.to || x.to === me) return '<div class="stkTo">' + (x.to === me ? 'It’s your own — it just stays here' : 'It just stays here') + '</div>';
  return '<div class="stkTo"><b>' + esc(stkName(x.to)) + '</b>&nbsp;gets it in Messages</div>';
}
function stkToNote(to) { return to ? 'gets it in Messages' : ''; }
/* under its smiley, right edges lined up (above it when there's no room below), kept on screen */
function stkPlace() {
  const P = S.stk, m = P && P.el, b = P && P.btn; if (!m || !b || !b.isConnected) return;
  const r = b.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight, vw = document.documentElement.clientWidth, vh = innerHeight;
  let top = r.bottom + 6; if (top + mh > vh - 8 && r.top - mh - 6 >= 8) top = r.top - mh - 6;
  m.style.left = Math.round(Math.max(8, Math.min(r.right - mw, vw - mw - 8))) + 'px';
  m.style.top = Math.round(Math.max(8, Math.min(top, vh - mh - 8))) + 'px';
}
function stkFollow() {
  const b = S.stk && S.stk.btn; if (!b) return;
  const r = b.getBoundingClientRect(), bd = b.closest('.dBd'), v = bd ? bd.getBoundingClientRect() : { top: 0, bottom: innerHeight };
  if (!b.isConnected || r.bottom < v.top || r.top > v.bottom) stkClose(); else stkPlace();
}
function stkClose(back) {
  const P = S.stk; S.stk = null; if (!P) return;
  if (P.el) P.el.remove();
  if (P.btn && P.btn.isConnected) { P.btn.setAttribute('aria-expanded', 'false'); P.btn.classList.remove('on'); if (back) P.btn.focus({ preventScroll: true }); }
}
function stkPut(e) {
  const P = S.stk; if (!P) return; const sel = $('#stkToSel'), to = P.x.sec ? (sel ? sel.value : P.x.to) : P.x.to;
  stkClose(true);
  const c = findCase(P.id); if (!c || c.status === 'done') return;
  const mine = stkTargetMine(c, P.x).filter(s => s.e === e);
  if (mine.length) stkApply(c.id, { op: 'del', ids: mine.map(s => s.id), removed: mine, e, on: P.x.on });
  else stkApply(c.id, { op: 'add', s: stkNew(e, P.x, to) });
}
/* a redraw of the panel (or part of it) is coming: where the focus is, among the stickers */
function stkHold() {
  const P = S.stk, a = document.activeElement; if (!a || !a.dataset) return null;
  if (P && P.el && P.el.contains(a)) return { pick: a.dataset.e || (a.id === 'stkToSel' ? 'sel' : '') };
  if (a.dataset.w && (a.dataset.act === 'stkAdd' || a.dataset.act === 'stkTog') && a.closest('#drawer')) return { w: a.dataset.w, e: a.dataset.act === 'stkTog' ? a.dataset.e || '' : '' };
  return null;
}
const cssq = v => (window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&'));
/* … and it's done: the stickers to pick from go back in it, at the new copy of their smiley (closed if it's gone); the focus goes
   back to the sticker (or the smiley) it was on */
function stkReanchor(keep) {
  const P = S.stk, d = $('#drawer');
  if (P) {
    const b = d && P.id === S.openId && !S.editing ? $('[data-act=stkAdd][data-w="' + cssq(P.w) + '"]', d) : null;
    if (!b) stkClose();
    else {
      P.btn = b; b.setAttribute('aria-expanded', 'true'); b.classList.add('on');
      if (!P.el.isConnected) d.appendChild(P.el);
      stkPlace();
      if (keep && keep.pick) { const f = keep.pick === 'sel' ? $('#stkToSel', P.el) : $$('.stkOpt', P.el).find(o => o.dataset.e === keep.pick); if (f && document.activeElement !== f) f.focus({ preventScroll: true }); }
      return;
    }
  }
  if (!keep || !keep.w || !d || (document.activeElement && document.activeElement !== document.body && d.contains(document.activeElement))) return;
  const q = '[data-w="' + cssq(keep.w) + '"]', el = (keep.e && $$('[data-act=stkTog]' + q, d).find(x => x.dataset.e === keep.e)) || $('[data-act=stkAdd]' + q, d);
  if (el) el.focus({ preventScroll: true });
}
/* a sticker that wasn't on screen before pops on (the first look at a case shows what's there as it is) */
function stkPop(root) {
  const id = S.openId; if (!root || !id) return;
  S.stkSeen = S.stkSeen || new Map(); let seen = S.stkSeen.get(id);
  const c = findCase(id), all = stkList(c).map(s => s.id);
  if (!seen) { S.stkSeen.set(id, new Set(all)); return; }
  $$('.stk[data-ids]', root).forEach(el => { if (el.dataset.ids.split(' ').some(x => !seen.has(x))) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); } });
  all.forEach(x => seen.add(x));
}
/* after the case panel is drawn (renderDrawer) */
function stkAfterDraw(c, keep) { stkPop($('#drawer')); stkReanchor(keep); }

document.addEventListener('keydown', e => {
  const P = S.stk; if (!P || !P.el) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stkClose(true); return; }
  if (!P.el.contains(document.activeElement)) return;
  const items = $$('.stkOpt', P.el), i = items.indexOf(document.activeElement); if (i < 0) return;
  const go = j => { e.preventDefault(); e.stopPropagation(); items[(j + items.length) % items.length].focus(); };
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(i + 1); else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(i - 1);
  else if (e.key === 'Home') go(0); else if (e.key === 'End') go(items.length - 1);
}, true);
document.addEventListener('mousedown', e => { const P = S.stk; if (P && !(P.el && P.el.contains(e.target)) && !(e.target.closest && e.target.closest('[data-act=stkAdd]'))) stkClose(); }, true);
document.addEventListener('focusin', e => { const P = S.stk; if (P && P.el && !P.el.contains(e.target) && !(e.target.closest && e.target.closest('[data-act=stkAdd]'))) stkClose(); });
document.addEventListener('scroll', e => { if (S.stk && !(e.target && e.target.closest && e.target.closest('#stkPick'))) stkFollow(); }, true);
window.addEventListener('resize', () => { if (S.stk) stkClose(); });
document.addEventListener('change', e => { if (e.target && e.target.id === 'stkToSel') { const n = $('#stkToNote'); if (n) n.textContent = stkToNote(e.target.value); } });

/* ---------- in Messages ---------- */
/* the stickers sent to you, on the cases at hand (open, and the completed ones loaded) — Messages lists them with the notes */
function stkMsgs(me, seen) {
  const out = [];
  const scan = c => stkList(c).forEach(s => {
    if (s.to !== me || s.by === me) return; const k = c.id + '/s/' + s.id; if (seen.has(k)) return; seen.add(k);
    out.push({ c, k, st: s, n: { id: s.id, at: s.at || 0, by: s.by } });
  });
  openCases().forEach(scan); (S.closed || []).forEach(scan);
  return out;
}
/* what it's on, for Messages */
function stkWhat(c, s) {
  if (s.on.startsWith('n:')) { const n = noteList(c).find(x => x.id === s.on.slice(2)), t = n ? n.text.replace(/\s+/g, ' ') : '';
    return t ? 'On your note: “' + (t.length > 90 ? t.slice(0, 88).trim() + '…' : t) + '”' : 'On your note'; }
  if (s.on.startsWith('h:')) { const l = String(s.l || ''); return /^moved it to /.test(l) ? 'On your move to ' + l.slice(12) : l ? 'On what you did: ' + l : 'On a step you did'; }
  return 'In ' + (s.l || 'the case');
}
function stkMsgRowHTML(m, nw) {
  const s = m.st, c = m.c;
  return '<button type="button" class="msgRow stkMsg' + (nw ? ' new' : '') + '" data-act="stkMsgOpen" data-id="' + esc(c.id) + '" data-s="' + esc(s.id) + '">' + ptAv(c, 40) +
    '<span class="msgMain"><span class="msgTop"><b class="msgPt">' + esc(c.patient || '(no name)') + '</b>' + typeBadge(c) + '<span class="msgWhen">' + esc(fmtWhen(s.at)) + '</span></span>' +
    '<span class="msgTx stkTx"><span class="stkE big" style="--r:' + stkTilt(s.id) + 'deg" role="img" aria-label="' + esc(STK_SAY[s.e] || 'Sticker') + '">' + esc(s.e) + '</span><span><b>' + esc(stkName(s.by)) + '</b> sent you a sticker</span></span>' +
    '<span class="msgOn">' + esc(stkWhat(c, s)) + '</span></span>' + (nw ? '<span class="msgDot" title="New"></span>' : '') + '</button>';
}
/* open the case at the sticker and flash what it's on */
function stkMsgOpen(caseId, sid) {
  msgMarkRead([caseId + '/s/' + sid]); renderNav(); openDrawer(caseId); if (S.view === 'msgs') renderView();
  const s = stkList(findCase(caseId)).find(x => x.id === sid); if (s) stkFlash(s);
}
function stkFlash(s) {
  const flash = el => { if (!el) return; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2600); };
  const open = k => { const sec = $('#drawer .ds[data-ds=' + k + ']'); if (sec && !sec.classList.contains('open')) { dsShow(sec, true); (S.dsTog = S.dsTog || new Map()).set(k, true); dsAllSync(); } return sec; };
  if (s.on.startsWith('n:')) { noteFlash(s.on.slice(2)); return; }
  setTimeout(() => {
    if (s.on.startsWith('s:')) { const sec = open(s.on.slice(2)); flash(sec && $('.dsHd', sec)); return; }
    if (s.k && $('#drawer .stepStk[data-k="' + s.k + '"]')) { open('stage'); flash($('#drawer .stepStk[data-k="' + s.k + '"]')); return; }
    open('history'); let n = 0; const sel = '#histBox .hist[data-w="' + s.on + '"]';
    const look = () => { const el = $(sel); if (el) flash(el); else if (++n < 30 && S.openId) setTimeout(look, 150); }; look();
  }, 80);
}
