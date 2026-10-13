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

/* ---------- Messages: the notes that tag you and the stickers sent to you (stickers.js), newest first ----------
   New / Read / Archive (Amir, 9 Oct 2026: "the messages should be removed once marked as read and then move to archive after
   30 days. or they need to be grayed out or stamped or something because right now its not clear except for the fact that the
   badge is gone"): a message leaves New once it's read — opened, shown in its case, its ✓ tapped, or Mark all as read — and
   sits under Read, greyed out with a "Read <when>" stamp, for 30 days; then it's under Archive. One not opened within 30 days
   of being sent stops counting as new (as before) and goes to Archive too. */
/* what's been read: "<case>/<note>" or "<case>/s/<sticker>" → when it was read (ms; 0 = read before 9 Oct 2026, when only
   *that* it was read was kept, in nloCases.msgRead.<sid>). Kept in this browser (nloCases.msgSeen.<sid>) and — once the
   12 Oct 2026 security rules are live — in the person's own sealed copy in the office database, so it follows them to every
   computer and phone (see "read marks on every device" below). Amir, 12 Oct 2026: "the messages on nlo case tracker keeps
   coming back as unread. i have marked the same message as read 3 times and it still showed as unread" — each computer, phone
   and web address (amooloo.github.io, apps.thenextlevelorthodontics.com) kept its own marks, and a ✓ on a message another tab
   had already marked did nothing (no redraw), so it looked stuck. A Mark unread is kept too (nloCases.msgUnseen.<sid>: key →
   when), so a device that still has the old mark doesn't bring it back. */
const MSG_OLD = 30 * 864e5;  // a message not read within this long of being sent isn't new any more (it's in Archive)
const MSG_KEEP = 30 * 864e5; // a read one stays under Read this long after it was read, then it's in Archive
const MSG_MAX = 2000;        // read marks kept per person (the longest-read go first)
const MSG_UNSEEN_KEEP = 60 * 864e5; // a Mark unread is remembered this long (by then the message is in Archive either way)
/* what this tab couldn't write to the browser's storage (full, or blocked): kept here instead, so a ✓ still takes */
const MSGL = { mem: {}, warned: false };
function msgKey() { return 'nloCases.msgSeen.' + (meSid() || ''); }
function msgUKey() { return 'nloCases.msgUnseen.' + (meSid() || ''); }
function msgLsGet(k) { if (Object.prototype.hasOwnProperty.call(MSGL.mem, k)) return MSGL.mem[k]; try { return localStorage.getItem(k); } catch (e) { return null; } }
function msgLsSet(k, v) {
  try { localStorage.setItem(k, v); delete MSGL.mem[k]; return true; }
  catch (e) {
    MSGL.mem[k] = v;
    // (said once: with the office copy on, the marks are kept there anyway)
    if (!MSGL.warned && !MSYNC.on && S.inApp) { MSGL.warned = true; toast('This browser couldn’t save your read marks (its storage is full or blocked). They’ll show as new again after you sign in.', { bad: true, ms: 9000 }); }
    return false;
  }
}
function msgMapOf(raw) {
  const m = new Map();
  try { const o = JSON.parse(raw); if (o && typeof o === 'object' && !Array.isArray(o)) Object.keys(o).forEach(k => { const t = o[k]; if (typeof t === 'number' && isFinite(t) && t >= 0) m.set(k, t); }); } catch (e) { }
  return m;
}
function msgRead() {
  const raw = msgLsGet(msgKey());
  if (raw) return msgMapOf(raw);
  const m = new Map(); // (the marks kept before 9 Oct 2026: read, when unknown)
  try { const old = JSON.parse(msgLsGet('nloCases.msgRead.' + (meSid() || '')) || '[]'); if (Array.isArray(old)) old.forEach(k => { if (typeof k === 'string') m.set(k, 0); }); } catch (e) { }
  if (m.size) msgSave(m);
  return m;
}
/* the Mark unreads (key → when), for the other devices */
function msgUnseen() { return msgMapOf(msgLsGet(msgUKey()) || '{}'); }
function msgTrim(m, max) { const e = Array.from(m.entries()); return e.length > max ? e.sort((a, b) => b[1] - a[1]).slice(0, max) : e; }
function msgSave(m) { msgLsSet(msgKey(), JSON.stringify(Object.fromEntries(msgTrim(m, MSG_MAX)))); msgSyncSoon(); }
function msgUSave(u) { const now = Date.now(); msgLsSet(msgUKey(), JSON.stringify(Object.fromEntries(msgTrim(new Map(Array.from(u).filter(([, t]) => now - t < MSG_UNSEEN_KEEP)), MSG_MAX)))); }
/* (a message already read keeps the time it was first read here. A mark is stamped just after the opposite one this browser
   knows of, so it wins on every device even when this computer's clock is behind the one that made that) */
function msgMarkRead(keys) {
  const m = msgRead(), u = msgUnseen(), now = Date.now(); let ch = false, uch = false;
  keys.forEach(k => { if (!m.has(k)) { m.set(k, Math.max(now, (u.get(k) || 0) + 1)); ch = true; } if (u.delete(k)) uch = true; });
  if (uch) msgUSave(u);
  if (ch) msgSave(m); else if (uch) msgSyncSoon();
  return ch;
}
function msgMarkUnread(keys) {
  const m = msgRead(), u = msgUnseen(), now = Date.now(); let ch = false;
  keys.forEach(k => { if (m.has(k)) { u.set(k, Math.max(now, (m.get(k) || 0) + 1)); m.delete(k); ch = true; } });
  if (ch) { msgUSave(u); msgSave(m); }
  return ch;
}
/* only the ones still new: one already in Archive (never opened within 30 days) stays there when its case is opened */
function msgReadIfNew(keys) { const r = msgRead(); return msgMarkRead(msgList().filter(m => keys.includes(m.k) && msgIsNew(m, r)).map(m => m.k)); }
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
/* where a message sits: 'new', 'read' (read in the last 30 days) or 'arch' */
function msgBox(m, read, now) {
  now = now || Date.now();
  if (!read.has(m.k)) return now - (m.n.at || 0) < MSG_OLD ? 'new' : 'arch';
  return now - Math.max(read.get(m.k) || 0, m.n.at || 0) < MSG_KEEP ? 'read' : 'arch'; // (one read before its time was kept counts from when it was sent)
}
function msgIsNew(m, read) { return msgBox(m, read) === 'new'; }
function msgUnread() { if (!S.inApp) return 0; const r = msgRead(); return msgList().filter(m => msgIsNew(m, r)).length; }
const MSG_TABS = [['new', 'New'], ['read', 'Read'], ['arch', 'Archive']];
const MSG_FOOT = { read: 'Each one moves to Archive 30 days after it was read.', arch: 'Read more than 30 days ago, or not opened within 30 days of being sent.' };
function viewMsgs() {
  if (!S.closedLoaded) loadClosed(); // (and the completed cases': a case can be finished after someone tagged you on it)
  const L = msgList(), r = msgRead(), now = Date.now(), by = { new: [], read: [], arch: [] };
  L.forEach(m => by[msgBox(m, r, now)].push(m));
  if (!L.length) return '<div class="card"><div class="cardBd"><div class="msgEmpty">' + ic('chat', 28) + '<p><b>No messages yet</b></p><p class="small muted">When someone tags you in a case’s notes with @, or sends you a sticker, it shows up here. Tag someone yourself in any case’s Notes, or tap the smiley beside a note, a step or a section to send a sticker.</p></div></div></div>';
  const tab = by[S.msgTab] ? S.msgTab : 'new', nNew = by.new.length, rows = by[tab];
  return '<div class="card msgCard"><div class="cardHd"><h3>Notes and stickers for you</h3><span class="sub">' + (nNew ? nNew + ' new' : 'All read') + '</span><span style="flex:1"></span>' +
    (tab === 'new' && nNew ? '<button class="btn btn-ghost btn-sm" data-act="msgAllRead">Mark all as read</button>' : '') + '</div>' +
    '<div class="msgTabs" role="tablist" aria-label="Messages">' + MSG_TABS.map(([k, l]) => '<button type="button" class="chip' + (k === tab ? ' on' : '') + (k === 'new' && by.new.length ? ' hasNew' : '') +
      '" role="tab" id="msgTab-' + k + '" aria-selected="' + (k === tab) + '" data-act="msgTab" data-k="' + k + '">' + l + '<span class="c">' + by[k].length + '</span></button>').join('') + '</div>' +
    '<div class="cardBd msgList" role="tabpanel" aria-labelledby="msgTab-' + tab + '">' + (rows.length ? rows.map(m => msgItemHTML(m, tab, r)).join('') : msgNoneHTML(tab, by)) + '</div>' +
    (MSG_FOOT[tab] && rows.length ? '<div class="msgFoot">' + MSG_FOOT[tab] + '</div>' : '') + '</div>';
}
function msgNoneHTML(tab, by) {
  const t = tab === 'new' ? ['You’re all caught up', 'Nothing new. ' + (by.read.length ? 'What you’ve read is under Read.' : 'What you read goes under Read.')]
    : tab === 'read' ? ['Nothing read in the last 30 days', 'A message moves here once you’ve read it.'] : ['Nothing in the archive yet', 'Read messages move here 30 days after they were read.'];
  return '<div class="msgNone">' + ic(tab === 'new' ? 'done' : 'chat', 26) + '<p><b>' + t[0] + '</b></p><p class="small muted">' + t[1] + '</p></div>';
}
/* one row: the message (opens its case) — New ones with a ✓ to mark them read; read ones greyed out, stamped when they were read */
function msgItemHTML(m, tab, r) {
  const nw = tab === 'new', row = m.st ? stkMsgRowHTML(m, nw, msgStampHTML(m, r)) : noteMsgRowHTML(m, nw, msgStampHTML(m, r));
  const what = (m.st ? stkName(m.st.by) + '’s sticker' : (noteWhoOf(m.n) || 'Someone') + '’s note') + ' on ' + (m.c.patient || 'a case');
  const side = nw ? '<button type="button" class="msgChk" data-act="msgMark" data-k="' + esc(m.k) + '" title="Mark as read" aria-label="Mark as read: ' + esc(what) + '">' + ic('check', 18) + '</button>'
    : tab === 'read' && Date.now() - (m.n.at || 0) < MSG_OLD ? '<button type="button" class="btn btn-ghost btn-sm msgUn" data-act="msgUnmark" data-k="' + esc(m.k) + '" aria-label="Mark as unread: ' + esc(what) + '">Mark unread</button>' : '';
  return '<div class="msgItem ' + (nw ? 'new' : 'seen') + '" data-k="' + esc(m.k) + '">' + row + side + '</div>';
}
function noteMsgRowHTML(m, nw, stamp) {
  return '<button type="button" class="msgRow ' + (nw ? 'new' : 'seen') + '" data-act="msgOpen" data-id="' + esc(m.c.id) + '" data-n="' + esc(m.n.id) + '">' + ptAv(m.c, 40) +
    '<span class="msgMain"><span class="msgTop"><b class="msgPt">' + esc(m.c.patient || '(no name)') + '</b>' + typeBadge(m.c) + '<span class="msgWhen">' + esc(fmtWhen(m.n.at)) + '</span></span>' +
    '<span class="msgTx"><b>' + esc(noteWhoOf(m.n) || 'Someone') + ':</b> ' + noteTextHTML(m.n) + '</span>' + (nw ? '' : stamp) + '</span>' + (nw ? '<span class="msgDot" title="New"></span>' : '') + '</button>';
}
/* "✓ Read today, 2:14 PM" / "✓ Read yesterday" / "✓ Read Oct 3" (just "✓ Read" for one read before the time was kept) */
function msgStampHTML(m, r) {
  if (!r.has(m.k)) return ''; const t = r.get(m.k) || 0;
  return '<span class="msgStamp">' + ic('check', 12) + 'Read' + (t ? ' ' + esc(msgWhenWord(t)) : '') + '</span>';
}
function msgWhenWord(t) {
  const d = new Date(t), now = new Date(), day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ago = Math.round((day(now) - day(d)) / 864e5), tm = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (ago === 0) return 'today, ' + tm;
  if (ago === 1) return 'yesterday, ' + tm;
  const o = { month: 'short', day: 'numeric' }; if (d.getFullYear() !== now.getFullYear()) o.year = 'numeric';
  return d.toLocaleDateString(undefined, o);
}
/* the ✓ on one, Mark all as read — each with Undo — and Mark unread (it goes back under New) */
function msgAfter(was) {
  renderNav(); if (S.view !== 'msgs') return; renderView();
  // (the keyboard stays in the list: on the row that took its place, else the one before, else the tab)
  if (was == null) return; const L = $$('#view .msgItem'), it = L[Math.min(was, L.length - 1)];
  const el = (it && ($('.msgChk, .msgUn', it) || $('.msgRow', it))) || $('#msgTab-' + (S.msgTab || 'new')); if (el) el.focus({ preventScroll: true });
}
function msgSpot(k) { const L = $$('#view .msgItem'); const i = L.findIndex(x => x.dataset.k === k); return i < 0 ? null : i; }
/* (each one redraws even when there was nothing to change: another tab, or another device, may have marked it already — the
   list on screen was just behind, and a ✓ that did nothing looked like it hadn't taken) */
function msgMarkOne(k) {
  if (!k) return; const was = msgSpot(k); msgMarkRead([k]); msgAfter(was);
  toast('Marked as read — it’s under Read now', { action: 'Undo', onAction: () => { msgMarkUnread([k]); msgAfter(); } });
}
function msgUnmarkOne(k) { if (!k) return; const was = msgSpot(k); msgMarkUnread([k]); msgAfter(was); toast('Marked as unread — it’s back under New'); }
function msgAllRead() {
  const shown = $$('#view .msgItem.new').map(x => x.dataset.k), r = msgRead(), ks = Array.from(new Set(shown.concat(msgList().filter(m => msgIsNew(m, r)).map(m => m.k))));
  msgMarkRead(ks); msgAfter(); if (!ks.length) return;
  toast((ks.length === 1 ? '1 message' : ks.length + ' messages') + ' marked as read', { action: 'Undo', onAction: () => { msgMarkUnread(ks); msgAfter(); } });
}
/* open the case at the note (opening Show earlier if it's further up) and flash it */
function noteFlash(nid) {
  setTimeout(() => {
    const c = findCase(S.openId); if (!c) return; const sel = '#notesList [data-note="' + (window.CSS && CSS.escape ? CSS.escape(nid) : nid) + '"]';
    let el = $(sel); if (!el) { (S.notesAll = S.notesAll || {})[c.id] = true; notesPaint(c); el = $(sel); }
    if (!el) return; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2600);
  }, 80);
}
function msgOpen(caseId, nid) { msgReadIfNew([caseId + '/' + nid]); renderNav(); openDrawer(caseId); noteFlash(nid); if (S.view === 'msgs') renderView(); }
/* the case panel shows a note that tags you: it's read — and so are the stickers sent to you on the case (the ones still new:
   one already in Archive stays there) */
function notesSeen(c) {
  const me = meSid(); if (!me || !c) return;
  const all = !!(S.notesAll && S.notesAll[c.id]), L = noteList(c), shown = all ? L : L.slice(Math.max(0, L.length - NOTES_SHOWN)), fresh = x => Date.now() - (x.at || 0) < MSG_OLD;
  const st = stkList(c).filter(s => s.to === me && s.by !== me && fresh(s)).map(s => c.id + '/s/' + s.id);
  if (msgMarkRead(shown.filter(n => n.to.includes(me) && n.by !== me && n.id !== 'field' && fresh(n)).map(n => c.id + '/' + n.id).concat(st))) { renderNav(); if (S.view === 'msgs') queueRender(); }
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
    toast(fresh.length + (nS === fresh.length ? ' new stickers for you' : nS ? ' new in Messages' : ' new notes tag you'), { action: 'Messages', onAction: () => { S.view = 'msgs'; S.msgTab = 'new'; renderNav(); renderView(); }, ms: 9000 }); }
}

/* ---------- read marks on every device (12 Oct 2026) ----------
   With the 12 Oct rules live (rules level 4, backend.js), each person's marks are also kept in msgSeen/<their staff id>,
   sealed with the office key like a case; only they can read or write it (firestore.rules). This browser's marks and that
   copy are merged both ways — a message is read if its latest mark is newer than its latest Mark unread — and the copy is
   watched live, so reading a message on the phone clears it on the front-desk PC as well. Until the rules are published,
   marks stay with each browser, as before. */
const MSYNC = { on: false, timer: 0, busy: false, again: false, fails: 0, retry: 0, gen: 0 }; // (gen: one per sign-in's syncing)
function msgCopy() { return { r: msgRead(), u: msgUnseen() }; }
const MSG_NONE = () => ({ r: new Map(), u: new Map() });
/* the office copy as it comes — { r: { key: when read }, u: { key: when marked unread } } — or null (none yet) */
function msgCopyOf(o) {
  const f = x => { const m = new Map(); if (x && typeof x === 'object' && !Array.isArray(x)) Object.keys(x).forEach(k => { const t = x[k]; if (typeof t === 'number' && isFinite(t) && t >= 0) m.set(k, t); }); return m; };
  return { r: f(o && o.r), u: f(o && o.u) };
}
function msgMerge(a, b) {
  const r = new Map(), u = new Map(), now = Date.now(), at = (m, k) => m.has(k) ? m.get(k) : -1;
  new Set([...a.r.keys(), ...a.u.keys(), ...b.r.keys(), ...b.u.keys()]).forEach(k => {
    const rt = Math.max(at(a.r, k), at(b.r, k)), ut = Math.max(at(a.u, k), at(b.u, k));
    if (ut > rt) { if (now - ut < MSG_UNSEEN_KEEP) u.set(k, ut); } else r.set(k, rt);
  });
  return { r: new Map(msgTrim(r, MSG_MAX)), u: new Map(msgTrim(u, MSG_MAX)) };
}
function msgSame(a, b) { const eq = (x, y) => x.size === y.size && Array.from(x).every(([k, t]) => y.get(k) === t); return eq(a.r, b.r) && eq(a.u, b.u); }
function msgPlain(c) { return { r: Object.fromEntries(c.r), u: Object.fromEntries(c.u) }; }
/* keep a merged copy in this browser; redraw when it changes what's shown */
function msgKeep(c) {
  if (msgSame(msgCopy(), c)) return;
  msgLsSet(msgUKey(), JSON.stringify(Object.fromEntries(c.u))); msgLsSet(msgKey(), JSON.stringify(Object.fromEntries(c.r)));
  msgRepaint();
}
function msgRepaint() { if (!S.inApp) return; renderNav(); if (S.view === 'msgs') queueRender(); }
/* on once the rules check (ui.js) finds the 12 Oct rules live; Lock ends it (msgSyncStop, and FB.stop drops the watch) */
function msgSyncStart() {
  if (!S.inApp || !B || !B.msgSeenWatch || !meSid()) return;
  if (!MSYNC.on) { MSYNC.on = true; MSYNC.gen++; }
  clearTimeout(MSYNC.retry); const gen = MSYNC.gen, sid = meSid();
  B.msgSeenWatch(o => { if (MSYNC.gen === gen && meSid() === sid) msgFromOffice(o); }, e => { if (MSYNC.gen === gen) msgWatchErr(e); });
}
function msgSyncStop() { clearTimeout(MSYNC.timer); clearTimeout(MSYNC.retry); MSYNC.gen++; Object.assign(MSYNC, { on: false, timer: 0, retry: 0, again: false, fails: 0 }); }
/* the office copy, as it is now */
function msgFromOffice(o) {
  if (!S.inApp || !MSYNC.on) return;
  const off = msgCopyOf(o), m = msgMerge(off, msgCopy());
  msgKeep(m);
  if (!msgSame(m, msgMerge(off, MSG_NONE()))) msgSyncSoon(); // (this browser knows marks the copy doesn't yet)
}
function msgSyncSoon(ms) { if (!MSYNC.on) return; clearTimeout(MSYNC.timer); MSYNC.timer = setTimeout(msgPush, ms == null ? 600 : ms); }
async function msgPush() {
  if (!MSYNC.on || !S.inApp) return;
  if (MSYNC.busy) { MSYNC.again = true; return; }
  MSYNC.busy = true; const gen = MSYNC.gen, sid = meSid(), mine = msgCopy(); // (this person's marks, as they are now)
  try {
    // (inside a transaction: what another device wrote a moment ago is merged in, not written over)
    const kept = await B.msgSeenSave(o => {
      const off = msgCopyOf(o), m = msgMerge(off, mine);
      return msgSame(m, msgMerge(off, MSG_NONE())) ? null : msgPlain(m);
    });
    if (MSYNC.gen !== gen || meSid() !== sid) return; // (locked meanwhile)
    MSYNC.fails = 0;
    if (S.inApp && MSYNC.on) msgKeep(msgMerge(msgCopyOf(kept), msgCopy()));
  } catch (e) { if (MSYNC.gen === gen) msgSyncErr(e); }
  finally { MSYNC.busy = false; if (MSYNC.again) { MSYNC.again = false; msgSyncSoon(); } } // (also one asked for by the next sign-in meanwhile)
}
const msgRefused = e => /permission/i.test(String((e && (e.code || e.message)) || ''));
/* refused because an older set of rules was published again: back to this browser only, for this session. (A save sealed
   with the office key a key change has just replaced is refused too: the rules are still the newest, so it tries again.) */
async function msgStillAllowed(e) {
  if (!msgRefused(e)) return true;
  let lv = 0; try { lv = await B.rulesLevel(); } catch (x) { }
  if (lv >= 4) return true;
  msgSyncStop(); if (B.msgSeenUnwatch) B.msgSeenUnwatch();
  rulesCheck(); // (so Dr. A's Team & security offers the newer rules again — ui.js)
  return false;
}
/* a save didn't go through (offline, a key change still reaching this computer…): again a little later */
async function msgSyncErr(e) {
  if (!MSYNC.on || !(await msgStillAllowed(e)) || !MSYNC.on) return;
  MSYNC.fails++; msgSyncSoon(Math.min(300000, 10000 * MSYNC.fails));
}
/* the watch ended with an error: watched again in a little while */
async function msgWatchErr(e) {
  if (B && B.msgSeenUnwatch) B.msgSeenUnwatch();
  if (!MSYNC.on || !(await msgStillAllowed(e)) || !MSYNC.on) return;
  clearTimeout(MSYNC.retry); MSYNC.retry = setTimeout(() => { if (MSYNC.on) msgSyncStart(); }, 30000);
}
/* another tab on this computer changed the marks: show it here too (practice mode's keys carry its own prefix — tour.js) */
window.addEventListener('storage', e => { if (S.inApp && (e.key === null || e.key.endsWith(msgKey()) || e.key.endsWith(msgUKey()))) { msgRepaint(); msgSyncSoon(); } });
