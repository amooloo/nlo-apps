/* ---------- Notes on a case, @ tags and Messages (Amir, 7 Oct 2026) ----------
   "I don't think notes section should only appear in the edit mode. It should be available even when all the sections are
   collapsed. and when you add a new note it should stay there. Also any chance … you can use the @ sign and add another person
   to that message and it would go into their message center?" He picked: one Notes list (the Notes typed in Edit and the
   Comments, together), a Messages page, and read marks kept on each computer.
   A note is an entry of the case's comments (encrypted with the rest of the case): { id, at, by, text, to?: [sid…] } — `to`
   being the people tagged with @ in it. The case's Notes text from the case form shows as its first note. */

const NOTES_SHOWN = 4; // the newest few; "Show N earlier notes" opens the rest (S.notesAll, while the app is open)

/* every note on the case, oldest first; the Notes text from the case form is the first one (in its place, where its time is known) */
function noteList(c) {
  const out = (c.comments || []).filter(x => x && String(x.text || '').trim()).map(x => ({ id: String(x.id || ''), at: x.at || 0, by: x.by || '',
    text: String(x.text).trim(), to: Array.isArray(x.to) ? x.to.filter(s => typeof s === 'string') : [] }));
  const t = String(c.notes || '').trim();
  if (t) { const au = notesAuthor(c); out.push({ id: 'field', at: au ? au.at || 0 : 0, by: au ? au.by || '' : '', text: t, to: [], field: true }); }
  return out.sort((a, b) => (a.at || 0) - (b.at || 0));
}

/* ---------- who can be tagged, and how ---------- */
/* everyone with an NLO Cases login, by the name they go by ("Dr. A" for the doctor); two with the same first name get their last
   initial. `pick`: only the ones who can be tagged now (still active, not you) */
function mtPeople(pick) {
  const me = meSid(), all = (S.roster || []).filter(r => r && r.sid);
  const first = r => r.role === 'owner' ? 'Dr. A' : firstName(r.name) || String(r.name || '');
  const seen = {}; all.filter(r => r.active).forEach(r => { const f = first(r).toLowerCase(); seen[f] = (seen[f] || 0) + 1; });
  return all.filter(r => !pick || (r.active && r.sid !== me)).map(r => {
    let l = first(r); const p = String(r.name || '').trim().split(/\s+/);
    if (r.role !== 'owner' && seen[l.toLowerCase()] > 1 && p.length > 1) l += ' ' + p[p.length - 1][0].toUpperCase();
    return { sid: r.sid, l, name: String(r.name || l), role: r.role };
  });
}
const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function mtRe(label, flags) { return new RegExp('@' + reEsc(label) + '(?![\\p{L}\\p{N}])', flags || 'iu'); }
/* the people a note tags: whoever's "@name" is in it (picked from the list or typed out) */
function noteTagsOf(text) { return Array.from(new Set(mtPeople(true).filter(p => mtRe(p.l).test(text)).map(p => p.sid))); }
/* a note's text with its tags picked out */
function noteTextHTML(n) {
  let h = esc(n.text); const P = mtPeople(false);
  (n.to || []).forEach(sid => {
    const p = P.find(x => x.sid === sid); if (!p) return;
    const labs = Array.from(new Set([p.l, p.role === 'owner' ? 'Dr. A' : firstName(p.name)])).filter(Boolean).sort((a, b) => b.length - a.length);
    for (const l of labs) { const re = mtRe(esc(l), 'giu'); if (re.test(h)) { h = h.replace(mtRe(esc(l), 'giu'), m => '<span class="mt">' + m + '</span>'); return; } }
  });
  return h;
}
function noteWhoOf(n) { return n.by ? noteWho(n) || firstName(staffName(n.by, n.by)) : ''; }

/* ---------- the Notes section of the case panel: pinned open, the list and the box to add one ---------- */
function notesSumHTML(c) {
  const L = noteList(c), last = L[L.length - 1]; if (!last) return '<span class="muted">None yet</span>';
  return (L.length > 1 ? L.length + ' · ' : '') + (noteWhoOf(last) ? '<b>' + esc(noteWhoOf(last)) + ':</b> ' : '') + esc(last.text.replace(/\s+/g, ' '));
}
function notesListHTML(c) {
  const L = noteList(c), me = meSid(), all = !!(S.notesAll && S.notesAll[c.id]), hid = all ? 0 : Math.max(0, L.length - NOTES_SHOWN);
  if (!L.length) return '<div class="small muted notesNone">No notes yet.</div>';
  // (each note takes stickers: the smiley at its top right sends one to whoever wrote it, and they sit under the text — stickers.js)
  const one = n => { const w = noteWhoOf(n);
    return '<div class="cmt' + (n.to.includes(me) ? ' toMe' : '') + '" data-note="' + esc(n.id) + '"><span class="av" data-sav="' + esc(n.by || '') + '">' + esc(n.by ? initials(staffName(n.by, n.by)) : 'N') + '</span><div class="cmtB"><div class="w">' +
      (w ? '<b>' + esc(w) + '</b>' : '<b>Notes</b>') + (n.at ? ' · ' + esc(fmtWhen(n.at)) : '') + '</div><div class="nTx">' + noteTextHTML(n) + '</div>' + stkNoteRowHTML(c, n) + '</div>' + stkNoteAddHTML(c, n) + '</div>'; };
  return (hid ? '<button type="button" class="linkBtn notesMore" data-act="notesAll">Show ' + hid + ' earlier note' + (hid === 1 ? '' : 's') + '</button>' : '') + L.slice(hid).map(one).join('');
}
function notesBodyHTML(c, done) {
  return '<div id="notesList">' + notesListHTML(c) + '</div>' + (done ? '' :
    '<div class="field noteNew"><label for="cmtText" class="hidden">Add a note</label><textarea id="cmtText" rows="2" placeholder="Add a note… type @ to tag someone" autocomplete="off" aria-autocomplete="list" aria-controls="mtList" aria-expanded="false"></textarea>' +
    '<div class="mtList" id="mtList" role="listbox" aria-label="Tag someone" hidden></div></div>' +
    '<div class="noteBtns"><button class="btn btn-sec btn-sm" data-act="addCmt">Add note</button><span class="small muted">Anyone you tag with @ gets it in their Messages.</span></div>');
}
/* the list again (a new note, Show earlier, or who wrote the case form's Notes once the history says) — not the box being typed in */
function notesPaint(c) { const el = $('#notesList'); if (el && c) { const keep = stkHold(); el.innerHTML = notesListHTML(c); savPaint(el); stkPop(el); stkReanchor(keep); } const s = $('#dsS-notes'); if (s && c) s.innerHTML = notesSumHTML(c); }

/* ---------- the @ list while typing a note ---------- */
const MT = { sel: 0, list: [], start: -1 };
function mtBox() { return $('#mtList'); }
function mtClose() { const b = mtBox(), t = $('#cmtText'); if (b) { b.hidden = true; b.innerHTML = ''; } if (t) t.setAttribute('aria-expanded', 'false'); MT.list = []; MT.start = -1; }
/* the "@na" being typed just before the cursor, if any */
function mtToken(t) {
  const pos = t.selectionStart, before = t.value.slice(0, pos), m = before.match(/(^|[\s(])@([^\s@]{0,24})$/u);
  return m ? { q: m[2], start: pos - m[2].length - 1 } : null;
}
function mtUpdate(t) {
  const k = mtToken(t); if (!k) { mtClose(); return; }
  const q = k.q.toLowerCase(), L = mtPeople(true).filter(p => !q || p.l.toLowerCase().startsWith(q) || p.name.toLowerCase().split(/\s+/).some(w => w.replace(/^dr\.?$/, '').startsWith(q))).slice(0, 6);
  const b = mtBox(); if (!b || !L.length) { mtClose(); return; }
  MT.list = L; MT.start = k.start; MT.sel = Math.min(MT.sel, L.length - 1);
  b.innerHTML = L.map((p, i) => '<button type="button" class="mtOpt" role="option" id="mtO' + i + '" data-i="' + i + '" aria-selected="' + (i === MT.sel) + '"><span class="av" data-sav="' + esc(p.sid) + '">' + esc(initials(p.name)) + '</span><b>@' + esc(p.l) + '</b>' +
    (p.name !== p.l && !(p.role === 'owner') ? '<small>' + esc(p.name) + '</small>' : '') + '</button>').join('');
  b.hidden = false; t.setAttribute('aria-expanded', 'true'); t.setAttribute('aria-activedescendant', 'mtO' + MT.sel); savPaint(b);
}
function mtPick(i) {
  const t = $('#cmtText'), p = MT.list[i]; if (!t || !p || MT.start < 0) return;
  const pos = t.selectionStart, ins = '@' + p.l + ' ';
  t.value = t.value.slice(0, MT.start) + ins + t.value.slice(pos);
  const at = MT.start + ins.length; mtClose(); t.focus(); try { t.setSelectionRange(at, at); } catch (e) { }
}
function mtMove(d) {
  if (!MT.list.length) return; MT.sel = (MT.sel + d + MT.list.length) % MT.list.length;
  $$('#mtList .mtOpt').forEach((o, i) => o.setAttribute('aria-selected', String(i === MT.sel)));
  const t = $('#cmtText'); if (t) t.setAttribute('aria-activedescendant', 'mtO' + MT.sel);
}
document.addEventListener('input', e => { if (e.target && e.target.id === 'cmtText') { MT.sel = 0; mtUpdate(e.target); } });
document.addEventListener('click', e => { if (e.target && e.target.id === 'cmtText') mtUpdate(e.target); else if (!(e.target.closest && e.target.closest('#mtList'))) mtClose(); });
// (on the way down, so the list's keys don't also close the case panel: Escape there closes it)
document.addEventListener('keydown', e => {
  if (!(e.target && e.target.id === 'cmtText')) return;
  if (MT.list.length && !mtBox().hidden) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); mtMove(e.key === 'ArrowDown' ? 1 : -1); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); mtPick(MT.sel); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); mtClose(); return; }
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); const b = $('#drawer [data-act=addCmt]'); if (b) b.click(); } // Ctrl+Enter adds it
}, true);
document.addEventListener('mousedown', e => { const o = e.target.closest && e.target.closest('#mtList .mtOpt'); if (o) { e.preventDefault(); mtPick(+o.dataset.i); } }); // (before the box loses focus)

/* ---------- Messages: the notes that tag you and the stickers sent to you (stickers.js), newest first ---------- */
/* what's been read, on this computer (Amir chose that over syncing it) — "<case>/<note>" for each */
function msgKey() { return 'nloCases.msgRead.' + (meSid() || ''); }
function msgRead() { try { return new Set(JSON.parse(localStorage.getItem(msgKey()) || '[]')); } catch (e) { return new Set(); } }
function msgMarkRead(keys) {
  const s = msgRead(), n = s.size; keys.forEach(k => s.add(k)); if (s.size === n) return false;
  try { localStorage.setItem(msgKey(), JSON.stringify(Array.from(s).slice(-800))); } catch (e) { } return true;
}
const MSG_OLD = 30 * 864e5; // a tag older than this isn't new on a computer that never showed it
function msgList() {
  const me = meSid(); if (!me) return [];
  const out = [], seen = new Set();
  const scan = c => (c.comments || []).forEach(x => {
    if (!x || !Array.isArray(x.to) || !x.to.includes(me) || x.by === me || !String(x.text || '').trim()) return;
    const k = c.id + '/' + x.id; if (seen.has(k)) return; seen.add(k);
    out.push({ c, k, n: { id: String(x.id || ''), at: x.at || 0, by: x.by || '', text: String(x.text).trim(), to: x.to.filter(s => typeof s === 'string') } });
  });
  openCases().forEach(scan); (S.closed || []).forEach(scan);
  return out.concat(stkMsgs(me, seen)).sort((a, b) => (b.n.at || 0) - (a.n.at || 0));
}
function msgIsNew(m, read) { return !read.has(m.k) && Date.now() - (m.n.at || 0) < MSG_OLD; }
function msgUnread() { if (!S.inApp) return 0; const r = msgRead(); return msgList().filter(m => msgIsNew(m, r)).length; }
function viewMsgs() {
  const L = msgList(), r = msgRead(), nNew = L.filter(m => msgIsNew(m, r)).length;
  if (!L.length) return '<div class="card"><div class="cardBd"><div class="msgEmpty">' + ic('chat', 28) + '<p><b>No messages yet</b></p><p class="small muted">When someone tags you in a case’s notes with @, or sends you a sticker, it shows up here. Tag someone yourself in any case’s Notes, or tap the smiley beside a note, a step or a section to send a sticker.</p></div></div></div>';
  return '<div class="card msgCard"><div class="cardHd"><h3>Notes and stickers for you</h3><span class="sub">' + (nNew ? nNew + ' new' : 'All read') + '</span><span style="flex:1"></span>' +
    (nNew ? '<button class="btn btn-ghost btn-sm" data-act="msgAllRead">Mark all as read</button>' : '') + '</div><div class="cardBd msgList">' +
    L.map(m => { const nw = msgIsNew(m, r); if (m.st) return stkMsgRowHTML(m, nw);
      return '<button type="button" class="msgRow' + (nw ? ' new' : '') + '" data-act="msgOpen" data-id="' + esc(m.c.id) + '" data-n="' + esc(m.n.id) + '">' + ptAv(m.c, 40) +
        '<span class="msgMain"><span class="msgTop"><b class="msgPt">' + esc(m.c.patient || '(no name)') + '</b>' + typeBadge(m.c) + '<span class="msgWhen">' + esc(fmtWhen(m.n.at)) + '</span></span>' +
        '<span class="msgTx"><b>' + esc(noteWhoOf(m.n) || 'Someone') + ':</b> ' + noteTextHTML(m.n) + '</span></span>' + (nw ? '<span class="msgDot" title="New"></span>' : '') + '</button>'; }).join('') + '</div></div>';
}
/* open the case at the note (opening Show earlier if it's further up) and flash it */
function noteFlash(nid) {
  setTimeout(() => {
    const c = findCase(S.openId); if (!c) return; const sel = '#notesList [data-note="' + (window.CSS && CSS.escape ? CSS.escape(nid) : nid) + '"]';
    let el = $(sel); if (!el) { (S.notesAll = S.notesAll || {})[c.id] = true; notesPaint(c); el = $(sel); }
    if (!el) return; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2600);
  }, 80);
}
function msgOpen(caseId, nid) { msgMarkRead([caseId + '/' + nid]); renderNav(); openDrawer(caseId); noteFlash(nid); if (S.view === 'msgs') renderView(); }
/* the case panel shows a note that tags you: it's read — and so are the stickers sent to you on the case */
function notesSeen(c) {
  const me = meSid(); if (!me || !c) return;
  const all = !!(S.notesAll && S.notesAll[c.id]), L = noteList(c), shown = all ? L : L.slice(Math.max(0, L.length - NOTES_SHOWN));
  const st = stkList(c).filter(s => s.to === me && s.by !== me).map(s => c.id + '/s/' + s.id);
  if (msgMarkRead(shown.filter(n => n.to.includes(me) && n.by !== me && n.id !== 'field').map(n => c.id + '/' + n.id).concat(st))) { renderNav(); if (S.view === 'msgs') queueRender(); }
}
/* a note tagging you arrives while the app is open: say so, with Open */
function msgWatch() {
  if (!S.inApp) return; const r = msgRead(); S.msgToasted = S.msgToasted || new Set();
  const fresh = msgList().filter(m => msgIsNew(m, r) && !S.msgToasted.has(m.k) && (m.n.at || 0) > (S.msgSince || 0) && m.c.id !== S.openId);
  fresh.forEach(m => S.msgToasted.add(m.k));
  if (fresh.length === 1) { const m = fresh[0];
    if (m.st) toast(stkName(m.st.by) + ' sent you ' + m.st.e + ' on ' + (m.c.patient || 'a case'), { action: 'Open', onAction: () => stkMsgOpen(m.c.id, m.st.id), ms: 9000 });
    else toast((noteWhoOf(m.n) || 'Someone') + ' tagged you on ' + (m.c.patient || 'a case'), { action: 'Open', onAction: () => msgOpen(m.c.id, m.n.id), ms: 9000 }); }
  else if (fresh.length > 1) { const nS = fresh.filter(m => m.st).length;
    toast(fresh.length + (nS === fresh.length ? ' new stickers for you' : nS ? ' new in Messages' : ' new notes tag you'), { action: 'Messages', onAction: () => { S.view = 'msgs'; renderNav(); renderView(); }, ms: 9000 }); }
}
