/* =====================================================================
   Forms (the forms themselves are in forms.js): the Forms screen, filling
   one out, the review (the office part, signing and filing, sending it
   back), and the printout.
   ===================================================================== */

/* ---------- the data ---------- */
function allForms() { return allPerks().filter(x => x.kind === 'form' && formDef(x.form)); }
function formsOf(sid) { return allForms().filter(x => x.sid === sid); }
/* sent in and waiting for the office (not sent back, not my own unless I'm Dr. A) */
function formsWaitingForMe() { return isHR() ? allForms().filter(x => x.status === 'pending' && !x.back && (isOwner() || x.sid !== meSid())) : []; }
/* my own, sent back to me for a change */
function formsBackToMe() { return allForms().filter(x => x.sid === meSid() && x.status === 'pending' && x.back); }
/* a hazard report sent without a name: whose it is shows to no one but its sender */
function formAnon(x) { return !!(x && x.f && x.f.anon === true && x.sid !== meSid()); }
function formWho(x) { return formAnon(x) ? 'Name left off' : staffName(x.sid); }
function formAvatar(x, lg) { return formAnon(x) ? '<span class="av none' + (lg ? ' lg' : '') + '" title="Name left off">?</span>' : avatarHTML(x.sid, '', lg); }
function fullName(sid) { const r = staff(sid); return r ? String(r.name || '') : (sid || ''); }
/* the people who approve time off, besides Dr. A (they read forms sealed to the HR key) */
function approverNames() { return S.team.filter(s => { const r = staff(s); return r && r.role !== 'owner' && r.active; }).map(shortName).filter(Boolean); }
/* full names, for the printout: "Dr. Amir Akhavan and Sarah Betz" */
function audFull(a) {
  const owner = S.roster.find(r => r.role === 'owner'), names = a === 'owner' ? [] : S.team.filter(s => { const r = staff(s); return r && r.role !== 'owner' && r.active; }).map(fullName);
  return [owner ? fullName(owner.sid) : 'Dr. Akhavan'].concat(names).join(' and ');
}
function audWords(a) { const n = approverNames(); return a === 'owner' ? 'Only Dr. A' : 'Dr. A' + (n.length ? ' and ' + n.join(' and ') : ' and the people who approve time off'); }
/* can I work on the office part (sign, file, approve, send back)? Never my own unless I'm Dr. A */
function canReview(x) { return isHR() && (x.status === 'pending' || x.status === 'approved') && (isOwner() || x.sid !== meSid()); }
function fmWhen(ms) { if (!ms) return ''; const d = new Date(ms); return fmtDateLong(isoOfMs(ms)) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }

/* ---------- the Forms screen ---------- */
function viewForms() {
  const me = meSid(), mine = formsOf(me).sort((a, b) => (b.at || 0) - (a.at || 0)), back = formsBackToMe();
  let h = '';
  if (back.length) h += back.map(x => '<button class="callout amber" data-act="fmOpen" data-id="' + esc(x.id) + '">' + ic('undo', 20) + '<span><b>' + esc(shortName(x.back.by)) + ' sent your ' + esc(formShort(x.form).toLowerCase()) + ' back for a change</b>' + esc(x.back.note ? '“' + clip(x.back.note, 120) + '”' : 'Open it to see what to change.') + '</span>' + ic('next') + '</button>').join('');
  // Dr. A's login got a new key (a password reset) and his forms key wasn't opened again with the recovery code at sign-in
  if (isOwner() && B.drState === 'stale') h += '<div class="card" style="margin-bottom:18px"><div class="cardBd" style="padding-top:16px"><p class="small"><b>Forms only you read can’t be opened on this login.</b> Your login has a new key since your password was reset, so the key for those forms needs your <b>recovery code</b> once (the one from NLO Cases). Until then they’re kept, sealed, and staff can still send them.</p>' +
    '<form id="drRestoreForm" style="margin-top:12px;max-width:420px"><div class="field"><label for="drCode">Recovery code</label><input id="drCode" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" required></div><button class="btn btn-pri" type="submit">' + ic('key', 16) + 'Open them again</button></form></div></div>';
  h += '<div class="twoCol"><div>';
  if (isHR()) h += formsInCardHTML();
  h += '<div class="card"' + (isHR() ? ' style="margin-top:18px"' : '') + '><div class="cardHd"><h3>Fill out a form</h3><span class="sub">Sealed like your time-off requests</span></div><div class="cardBd">' +
    FORM_GROUPS.map(([g, ids]) => '<div class="subH">' + esc(g) + '</div><div class="fmTiles">' + ids.map(id => {
      const D = FORMS[id];
      return '<button type="button" class="fmTile" data-act="fmNew" data-f="' + id + '">' + ic(D.icon || 'note', 20) + '<span class="grow"><b>' + esc(D.title) + '</b><small>' + esc(D.blurb) + '</small></span>' +
        (D.kind === 'print' ? '<span class="sug">' + ic('download', 12) + 'Print</span>' : audDefault(D) === 'owner' && !audPick(D) ? '<span class="sug navy" title="Only Dr. A can read it">' + ic('lock', 12) + 'Dr. A</span>' : '') + '</button>';
    }).join('') + '</div>').join('') + '</div></div>';
  h += '</div><div>';
  h += '<div class="card"><div class="cardHd"><h3>My forms</h3><span class="sub">What you sent, and the answers</span></div><div class="cardBd">' +
    (mine.length ? mine.slice(0, 60).map(x => fmRow(x, false)).join('') : '<div class="empty">None yet.</div>') + '</div></div>';
  h += '<div class="card" style="margin-top:18px"><div class="cardBd small muted" style="padding-top:14px">' + ic('shield', 15) + ' A form is sealed on this device before it’s saved. You can always open your own; the office part is added by Dr. A' + (approverNames().length ? ' or ' + esc(approverNames().join(' or ')) : '') + '. Forms marked ' + ic('lock', 12) + ' Dr. A are read by him alone.</div></div>';
  return h + '</div></div>';
}
/* the people who approve: what's been sent in */
function formsInCardHTML() {
  const tab = S.tab.fmIn || 'wait', all = allForms().filter(x => isOwner() || x.sid !== meSid() || x.status !== 'pending');
  const wait = formsWaitingForMe().sort((a, b) => (a.at || 0) - (b.at || 0)), backs = all.filter(x => x.status === 'pending' && x.back && x.sid !== meSid());
  const done = all.filter(x => x.status !== 'pending').sort((a, b) => (b.updatedAt || b.at || 0) - (a.updatedAt || a.at || 0));
  const list = tab === 'wait' ? wait.concat(backs) : done;
  return '<div class="card"><div class="cardHd"><h3>Sent in</h3><span style="flex:1"></span><div class="seg" role="tablist">' +
    [['wait', 'Waiting', wait.length], ['done', 'Done', 0]].map(([k, l, n]) => '<button role="tab" data-act="fmTab" data-t="' + k + '" aria-pressed="' + (tab === k) + '">' + l + (n ? ' <span class="cntPill">' + n + '</span>' : '') + '</button>').join('') + '</div></div><div class="cardBd">' +
    (list.length ? list.slice(0, 80).map(x => fmRow(x, true)).join('') : '<div class="empty">' + (tab === 'wait' ? ic('done', 22) + '<br>Nothing waiting.' : 'Nothing yet.') + '</div>') +
    (tab === 'done' && done.length > 80 ? '<p class="small muted">The 80 most recent.</p>' : '') + '</div></div>';
}
ACT.fmTab = t => { S.tab.fmIn = t.dataset.t; renderView(); };
document.addEventListener('submit', async e => {
  if (e.target.id !== 'drRestoreForm') return; e.preventDefault();
  const btn = $('button[type=submit]', e.target); busyBtn(btn, true, 'Opening…');
  try { await B.drRestore($('#drCode').value); toast('Forms only you read open again'); renderNav(); renderView(); }
  catch (x) { busyBtn(btn, false); toast(errText(x), { bad: true }); }
});
function fmRow(x, who) {
  const st = formStatus(x), D = formDef(x.form), s = D && D.sum ? clip(D.sum(x.f || {}), 90) : '';
  return '<div class="reqRow" role="button" tabindex="0" data-act="fmOpen" data-id="' + esc(x.id) + '">' + (who ? '<span class="nameCell">' + formAvatar(x) + '<b>' + esc(formAnon(x) ? 'Name left off' : shortName(x.sid)) + '</b></span>' : '') +
    '<div class="rrMain"><div class="rrDates">' + esc(formShort(x.form)) + (x.aud === 'owner' ? ' <span title="Only Dr. A can read it">' + ic('lock', 12) + '</span>' : '') + '</div><div class="small muted">' + esc((x.at ? 'Sent ' + fmtAgo(x.at) : '') + (s ? ' · ' + s : '')) + '</div></div>' +
    '<span class="stat ' + st[1] + '">' + esc(st[0]) + '</span></div>';
}
/* a form waiting on Approvals */
function fmCard(x) {
  const own = x.sid === meSid() && !isOwner(), D = formDef(x.form), s = D && D.sum ? D.sum(x.f || {}) : '';
  return '<div class="card apCard"><div class="apHd">' + formAvatar(x, true) + '<div class="grow"><b>' + esc(formWho(x)) + '</b><div class="small muted"><span class="badge">' + esc(formShort(x.form)) + '</span> · sent ' + esc(x.at ? fmtAgo(x.at) : '') + (x.aud === 'owner' ? ' · ' + ic('lock', 12) + ' only you can read it' : '') + '</div></div></div>' +
    (s ? '<div class="apBd"><div class="small">' + esc(s) + '</div></div>' : '') +
    '<div class="apFt">' + (own ? '<span class="small muted">Your own — Dr. A reviews it.</span>' : '<button class="btn btn-teal btn-sm" data-act="fmOpen" data-id="' + esc(x.id) + '">' + ic('next', 15) + 'Open</button>') + '</div></div>';
}

/* ---------- filling out a form, and looking at one ---------- */
/* S.fm = { form, id ('' while new), sid, f (the answers being edited), aud, agree, rev, dirty } */
function fmDefaults(D) {
  const f = {}, me = meSid(), p = personOf(me), owner = S.roster.find(r => r.role === 'owner');
  formFields(D).forEach(fd => {
    if (fd.def === 'employer') f[fd.k] = OFFICE_NAME;
    else if (fd.def === 'contact') f[fd.k] = (owner ? fullName(owner.sid) : 'Dr. Akhavan') + ', ' + OFFICE_PHONE;
    else if (fd.def === 'sched') f[fd.k] = 'Monday to Thursday, ' + hrs(S.pol.day) + '-hour days' + (p && p.type === 'PT' ? ' (part-time)' : '');
    else if (fd.def === 'name') f[fd.k] = fullName(me);
    else if (fd.def === 'today') f[fd.k] = todayISO();
  });
  return f;
}
ACT.fmNew = t => {
  const D = formDef(t.dataset.f); if (!D) return;
  S.fm = { form: D.id, id: '', sid: meSid(), f: fmDefaults(D), aud: audDefault(D), agree: false, rev: 0, dirty: false };
  S.view = 'fm'; closeDrawer(); renderNav(); renderView(); window.scrollTo(0, 0);
};
ACT.fmOpen = t => {
  const x = S.perks.get(t.dataset.id); if (!x || x.kind !== 'form') return;
  fmLoad(x); S.view = 'fm'; closeDrawer(); renderNav(); renderView(); window.scrollTo(0, 0);
};
function fmLoad(x) {
  const D = formDef(x.form), f = JSON.parse(JSON.stringify(x.f || {}));
  // the office part starts from what was asked for (CE: the costs the office will pay back)
  if (canReview(x) && x.status === 'pending') formFields(D).forEach(fd => { if (fd.by === 'hr' && fd.from && f[fd.k] == null && Array.isArray(f[fd.from])) f[fd.k] = f[fd.from].slice(); });
  S.fm = { form: x.form, id: x.id, sid: x.sid, f, aud: x.aud || audDefault(D), agree: false, rev: x.rev, dirty: false };
}
function fmDirty() { return !!(S.fm && S.fm.dirty); }
function fmCur() { return S.fm && S.fm.id ? S.perks.get(S.fm.id) || null : null; }
/* what this person can do with the form open now */
function fmMode() {
  const fm = S.fm, x = fmCur(), D = formDef(fm.form);
  if (D.kind === 'print') return { staff: true, hr: false, print: true };
  if (!x) return { staff: true, hr: false, isNew: true };
  return { staff: x.sid === meSid() && x.status === 'pending', hr: canReview(x), x };
}
function viewFm() {
  const fm = S.fm; if (!fm) return viewForms();
  const D = formDef(fm.form), x = fmCur(), m = fmMode();
  if (fm.id && !x) return '<div class="card" style="max-width:720px"><div class="cardBd"><div class="empty">This form isn’t here any more.<br><button class="btn btn-sec btn-sm" style="margin-top:12px" data-act="nav" data-v="forms">Back to Forms</button></div></div></div>';
  // someone else saved it meanwhile: take theirs if nothing's been changed here, else say so
  if (x && x.rev !== fm.rev) { if (!fm.dirty) { const keep = fm.agree; fmLoad(x); S.fm.agree = keep; } }
  const stale = x && x.rev !== S.fm.rev;
  let h = '<div class="fmWrap"><div class="card"><div class="fmHd">' + ic(D.icon || 'note', 22) + '<div class="grow"><h3>' + esc(D.title) + '</h3><div class="small muted">' +
    (x ? esc(formWho(x)) + ' · sent ' + esc(fmWhen(x.at)) : D.kind === 'print' ? 'Fill in what you can, then print it. Nothing here is saved.' : esc(audLine(D, fm.aud))) + '</div></div>' +
    (x ? '<span class="stat ' + formStatus(x)[1] + '">' + esc(formStatus(x)[0]) + '</span>' : '') + '</div>';
  if (stale) h += '<div class="notice" style="margin:0 20px 12px">Someone changed this form since you opened it. <button class="linkBtn" data-act="fmReload">Load their changes</button> (what you changed here is dropped).</div>';
  if (x && x.back && x.status === 'pending') h += '<div class="notice" style="margin:0 20px 12px">' + esc(shortName(x.back.by)) + ' sent it back for a change' + (x.back.note ? ': “' + esc(x.back.note) + '”' : '.') + (m.staff ? ' Change it below and send it again.' : '') + '</div>';
  if (x && x.decision && x.decision.note && (x.status === 'denied' || x.status === 'approved' || x.status === 'cancelled')) h += '<div class="notice ' + (x.status === 'denied' ? 'bad' : 'info') + '" style="margin:0 20px 12px">' + esc(shortName(x.decision.by)) + ': “' + esc(x.decision.note) + '”</div>';
  h += '<div class="cardBd" id="fmBody">' + fmBodyHTML(D, m) + '</div>' + fmFootHTML(D, m, x) + '</div>';
  if (x) h += fmHistHTML(x);
  return h + '</div>';
}
function audLine(D, a) { return audWords(a) + (a === 'owner' ? ' reads it.' : ' read it.'); }
function fmBodyHTML(D, m) {
  const fm = S.fm, f = fm.f, x = m.x;
  const ctx = { name: fullName(fm.sid), employer: OFFICE_NAME };
  let h = '';
  (D.parts || []).forEach(p => {
    const office = p.by === 'hr';
    const edit = office ? m.hr : p.by === 'staff' || p.by === 'emp' ? m.staff : false;
    // the office part: shown to the people who review it; to the sender once it's decided
    if (office && !m.hr && !(x && (x.status === 'approved' || x.status === 'denied') && formFields(D).some(fd => fd.by === 'hr' && filled(fd, f[fd.k])))) return;
    if (p.h) h += '<div class="fmPart' + (office ? ' office' : '') + '">' + esc(p.h) + (office && m.hr ? ' <span class="opt">— you fill this in</span>' : '') + '</div>';
    h += fmFieldsHTML(p.fields, f, edit, ctx, D);
  });
  // the signatures
  if (D.kind === 'send') {
    if (D.sign.staff) {
      const sg = x && x.sign && x.sign.staff;
      if (m.staff) h += '<label class="chk fmAgree"><input type="checkbox" data-chg="fmAgree"' + (fm.agree ? ' checked' : '') + '> I’ve read this, it’s true and correct, and I sign it with my NLO login</label>' +
        (sg ? '<div class="small muted">Signed ' + esc(fmWhen(sg.at)) + '. Sending it again signs it again.</div>' : '');
      else if (sg) h += sigHTML('Employee’s signature', sg);
    }
    if (D.sign.hr && x && x.sign && x.sign.hr) h += sigHTML('Employer’s signature', x.sign.hr);
  }
  return h;
}
function sigHTML(label, sg) { return '<div class="fmSig">' + ic('tick', 15) + '<span><b>' + esc(label) + ':</b> signed electronically by ' + esc(sg.n || fullName(sg.by)) + ' · ' + esc(fmWhen(sg.at)) + '</span></div>'; }
/* the fields of one part, two or three to a row where they're marked so */
function fmFieldsHTML(fields, f, edit, ctx, D) {
  let h = '', row = [];
  const flush = () => { if (row.length) { h += '<div class="grid' + (row.some(r => r.fd.third) ? '3' : '2') + '">' + row.map(r => r.h).join('') + '</div>'; row = []; } };
  fields.forEach(fd => {
    if (!fieldShown(fd, f)) return;
    if (fd.t === 'say') { flush(); h += '<p class="fmSay">' + esc(formSay(fd.s, ctx)) + '</p>'; return; }
    if (fd.t === 'aud') { flush(); h += audFieldHTML(D, edit); return; }
    if (!edit && !filled(fd, f[fd.k]) && fd.t !== 'yesno') return; // a blank optional answer isn't shown when reading
    const one = edit ? fmInputHTML(fd, f) : fmValueHTML(fd, f);
    if (fd.half || fd.third) { row.push({ fd, h: one }); if (row.length === (fd.third ? 3 : 2)) flush(); } else { flush(); h += one; }
  });
  flush();
  return h;
}
function audFieldHTML(D, edit) {
  const a = S.fm.aud, pick = audPick(D), names = approverNames();
  if (!edit || !pick) return '<div class="field"><span class="flabel">' + esc(pick ? D.aud.l : 'Who reads it') + '</span><div class="small">' + ic(a === 'owner' ? 'lock' : 'people', 14) + ' ' + esc(audLine(D, a)) + '</div></div>';
  const lab = k => k === 'owner' ? (D.aud.owner || 'Only Dr. A') : (D.aud.hr ? D.aud.hr + ' — ' : '') + 'Dr. A' + (names.length ? ' and ' + names.join(' and ') : ' and the people who approve time off');
  return '<div class="field"><span class="flabel">' + esc(D.aud.l) + '</span><div class="seg wrap" role="group" aria-label="' + esc(D.aud.l) + '">' +
    ['owner', 'hr'].map(k => '<button type="button" data-act="fmAud" data-v="' + k + '" aria-pressed="' + (a === k) + '">' + ic(k === 'owner' ? 'lock' : 'people', 14) + esc(lab(k)) + '</button>').join('') + '</div>' +
    '<div class="hint">' + (a === 'owner' ? 'Sealed so that only Dr. A can open it.' : 'Anyone Dr. A later asks to approve time off can read it too.') + '</div></div>';
}
function fmLabel(fd, office) { return esc(fd.l) + (fd.need ? '' : ' <span class="opt">(optional)</span>'); }
function fmInputHTML(fd, f) {
  const k = fd.k, v = f[k], id = 'fm_' + k, lab = fmLabel(fd), hint = fd.hint ? '<div class="hint">' + esc(fd.hint) + '</div>' : '';
  const box = inner => '<div class="field" data-fbox="' + k + '"><label for="' + id + '">' + lab + '</label>' + inner + hint + '</div>';
  const span = inner => '<div class="field" data-fbox="' + k + '"><span class="flabel">' + lab + '</span>' + inner + hint + '</div>';
  switch (fd.t) {
    case 'text': return box('<input id="' + id + '" data-inp="fm" data-fk="' + k + '" maxlength="' + (fd.max || 200) + '" value="' + esc(v || '') + '"' + (fd.ph ? ' placeholder="' + esc(fd.ph) + '"' : '') + '>');
    case 'area': return box('<textarea id="' + id + '" data-inp="fm" data-fk="' + k + '" maxlength="' + (fd.max || 1000) + '" rows="' + (fd.rows || 4) + '"' + (fd.ph ? ' placeholder="' + esc(fd.ph) + '"' : '') + '>' + esc(v || '') + '</textarea>');
    case 'date': return box('<input type="date" id="' + id + '" data-inp="fm" data-fk="' + k + '" value="' + esc(v || '') + '"' + (fd.past ? ' max="' + todayISO() + '"' : '') + '>');
    case 'time': return box('<input type="time" id="' + id + '" data-inp="fm" data-fk="' + k + '" value="' + esc(v || '') + '" step="300">');
    case 'num': return box('<input type="number" inputmode="decimal" id="' + id + '" data-inp="fm" data-fk="' + k + '" value="' + (v == null ? '' : esc(String(v))) + '" min="' + (fd.min != null ? fd.min : 0) + '" max="' + (fd.max != null ? fd.max : 1000) + '" step="' + (fd.step || 1) + '">');
    case 'money': return box('<div class="inMoney"><span>$</span><input type="number" inputmode="decimal" id="' + id + '" data-inp="fm" data-fk="' + k + '" value="' + (v == null ? '' : esc(String(v))) + '" min="0" max="' + (fd.max || 1000000) + '" step="0.01"></div>');
    case 'yesno': return span('<div class="seg" role="group">' + [[true, 'Yes'], [false, 'No']].map(([b, l]) => '<button type="button" data-act="fmSet" data-k="' + k + '" data-v="' + b + '" aria-pressed="' + (v === b) + '">' + l + '</button>').join('') + '</div>');
    case 'pick': return span('<div class="seg wrap" role="group">' + fd.opts.map(([o, l]) => '<button type="button" data-act="fmSet" data-k="' + k + '" data-v="' + esc(o) + '" aria-pressed="' + (v === o) + '">' + esc(l) + '</button>').join('') + '</div>');
    case 'checks': return span('<div class="chkList">' + fd.opts.map(([o, l]) => '<label><input type="checkbox" data-chg="fmChecks" data-fk="' + k + '" value="' + esc(o) + '"' + (Array.isArray(v) && v.includes(o) ? ' checked' : '') + '><span>' + esc(l) + '</span></label>').join('') + '</div>');
    case 'check': return '<div class="field" data-fbox="' + k + '"><label class="chk"><input type="checkbox" data-chg="fmCheck" data-fk="' + k + '"' + (v === true ? ' checked' : '') + '> ' + esc(fd.l) + '</label>' + hint + '</div>';
    case 'dates': {
      const L = Array.isArray(v) && v.length ? v : [''];
      return span('<div class="fmDates">' + L.map((d, i) => '<div class="inRow"><input type="date" data-inp="fmDate" data-fk="' + k + '" data-i="' + i + '" value="' + esc(d || '') + '" aria-label="Date ' + (i + 1) + '">' +
        (L.length > 1 ? '<button type="button" class="iconBtn" data-act="fmDateDel" data-k="' + k + '" data-i="' + i + '" aria-label="Remove this date">' + ic('x', 16) + '</button>' : '') + '</div>').join('') +
        (L.length < (fd.max || 3) ? '<button type="button" class="linkBtn small" data-act="fmDateAdd" data-k="' + k + '">Add a date</button>' : '') + '</div>');
    }
    case 'pay': return span(payTableHTML(fd, f, true));
    default: return '';
  }
}
/* the repayment table: date, payment, and what's still owed after it */
function payTableHTML(fd, f, edit) {
  const L = Array.isArray(f[fd.k]) && f[fd.k].length ? f[fd.k] : (edit ? [{ d: '', a: null }] : []), owed = Number(f[fd.of]) || 0;
  let left = owed;
  const rows = L.map((r, i) => {
    left = round2(left - (Number(r.a) || 0));
    return '<tr><td class="num">' + (i + 1) + '.</td><td>' + (edit ? '<input type="date" data-inp="fmPay" data-fk="' + fd.k + '" data-i="' + i + '" data-p="d" value="' + esc(r.d || '') + '" aria-label="Payment ' + (i + 1) + ' date">' : esc(r.d ? fmtDate(r.d) : '')) + '</td>' +
      '<td>' + (edit ? '<div class="inMoney"><span>$</span><input type="number" inputmode="decimal" min="0" step="0.01" data-inp="fmPay" data-fk="' + fd.k + '" data-i="' + i + '" data-p="a" value="' + (r.a == null ? '' : esc(String(r.a))) + '" aria-label="Payment ' + (i + 1) + ' amount"></div>' : esc(money(r.a || 0))) + '</td>' +
      '<td class="num" data-left="' + i + '">' + esc(money(Math.max(0, left))) + '</td>' + (edit ? '<td>' + (L.length > 1 ? '<button type="button" class="iconBtn" data-act="fmPayDel" data-k="' + fd.k + '" data-i="' + i + '" aria-label="Remove this payment">' + ic('x', 16) + '</button>' : '') + '</td>' : '') + '</tr>';
  }).join('');
  return '<div class="tblWrap"><table class="tbl fmPay"><thead><tr><th class="num">#</th><th>Date</th><th>Payment</th><th class="num">Still owed</th>' + (edit ? '<th></th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
    (edit && L.length < (fd.max || 6) ? '<button type="button" class="linkBtn small" data-act="fmPayAdd" data-k="' + fd.k + '">Add a payment</button>' : '');
}
/* an answer, for reading */
function fmValueText(fd, v) {
  switch (fd.t) {
    case 'date': return v ? fmtDateLong(v) : '';
    case 'time': return v ? fmtClock(v) : '';
    case 'money': return v == null ? '' : money(v);
    case 'num': return v == null ? '' : hrs(v);
    case 'yesno': return v === true ? 'Yes' : v === false ? 'No' : '—';
    case 'pick': return optLabel(fd.opts, v);
    case 'checks': return (v || []).map(o => optLabel(fd.opts, o)).join(', ');
    case 'check': return v ? 'Yes' : '';
    case 'dates': return (v || []).map(d => fmtDateLong(d)).join(', ');
    default: return v == null ? '' : String(v);
  }
}
function fmValueHTML(fd, f) {
  const v = f[fd.k];
  if (fd.t === 'pay') return '<div class="fmVal"><span class="flabel">' + esc(fd.l) + '</span>' + payTableHTML(fd, f, false) + '</div>';
  if (fd.t === 'check') return '<div class="fmVal"><div class="small">' + ic('tick', 14) + ' ' + esc(fd.l) + '</div></div>';
  const txt = fmValueText(fd, v);
  return '<div class="fmVal"><span class="flabel">' + esc(fd.l) + '</span><div class="' + (fd.t === 'area' ? 'txt' : 'fmV') + '">' + esc(txt || '—') + '</div></div>';
}
/* who did what, when */
function fmHistHTML(x) {
  const ev = (x.events || []).filter(e => FORM_EVT[e.a] && e.a !== 'reseal' && e.a !== 'rekey');
  if (!ev.length) return '';
  const who = e => formAnon(x) && e.by === x.sid ? 'The sender' : shortName(e.by);
  return '<div class="card" style="margin-top:14px"><div class="cardHd"><h3>History</h3></div><div class="cardBd">' + ev.map(e => '<div class="hist"><time>' + esc(fmtWhen(e.at)) + '</time><span><b>' + esc(who(e)) + '</b> ' + esc(FORM_EVT[e.a]) + (e.note ? ': “' + esc(e.note) + '”' : '') + '</span></div>').join('') + '</div></div>';
}
/* the buttons under the form */
function fmFootHTML(D, m, x) {
  const fm = S.fm, b = [];
  if (m.print) b.push('<button class="btn btn-teal" data-act="fmPrint">' + ic('download', 16) + 'Print</button>', '<button class="btn btn-ghost" data-act="nav" data-v="forms">Back to Forms</button>');
  else if (m.isNew) {
    const noKey = fm.aud === 'owner' && !B.drReady();
    b.push('<button class="btn btn-teal" data-act="fmSend"' + (noKey ? ' disabled' : '') + '>' + ic('tick', 16) + (D.sign.staff ? 'Sign and send' : 'Send') + '</button>', '<button class="btn btn-ghost" data-act="nav" data-v="forms">Cancel</button>');
    if (noKey) b.push('<div class="small coral" style="flex-basis:100%">Dr. A needs to open Time Off once before forms only he reads can be sent' + (audPick(D) ? ' — or choose to include ' + esc(approverNames().join(' and ') || 'the people who approve') + ' above.' : '. Ask him, then try again.') + '</div>');
  } else {
    if (m.staff) {
      b.push('<button class="btn btn-teal" data-act="fmSaveOwn"' + (fm.aud === 'owner' && !B.drReady() ? ' disabled' : '') + '>' + ic('tick', 16) + (x.back ? (D.sign.staff ? 'Sign and send again' : 'Send again') : 'Save the change') + '</button>');
      b.push('<button class="btn btn-sec btn-sm" data-act="fmWithdraw">Take it back…</button>');
    }
    if (m.hr) {
      if (x.status === 'pending') {
        b.push('<button class="btn btn-teal" data-act="fmDecide">' + ic('tick', 16) + esc(D.act) + '</button>');
        if (formFields(D).some(fd => fd.by === 'hr')) b.push('<button class="btn btn-sec btn-sm" data-act="fmSaveHR">Save for now</button>');
        if (D.decide === 'approve') b.push('<button class="btn btn-sec btn-sm" data-act="fmDeny">Not approved…</button>');
        b.push('<button class="btn btn-ghost" data-act="fmBack">Send back for a change…</button>');
      } else if (formFields(D).some(fd => fd.by === 'hr')) b.push('<button class="btn btn-sec btn-sm" data-act="fmSaveHR">Save changes</button>');
    }
    b.push('<button class="btn btn-ghost" data-act="fmPrint">' + ic('download', 15) + 'Print or save as PDF</button>');
    if (isOwner() && x.status !== 'cancelled' && x.sid !== meSid()) b.push('<button class="btn btn-ghost" data-act="fmCancel">Cancel it…</button>');
    if (D.id === 'advance' && m.hr && x.f && x.f.repay === 'pto') b.push('<div class="small muted" style="flex-basis:100%">Paid time off goes toward this advance: once it’s approved, take it off as it’s earned with an adjustment (Team → the person → Add an adjustment).</div>');
  }
  return '<div class="fmFt">' + b.join('') + '</div>';
}

/* ---------- typing and ticking ---------- */
/* a change that shows or hides other fields redraws the form; typing never does */
function fmDeps(D) { const s = new Set(); formFields(D).forEach(fd => { if (fd.if) s.add(typeof fd.if === 'string' ? fd.if : fd.if[0]); if (fd.of) s.add(fd.of); }); return s; }
function fmRedraw() { const el = $('#fmBody'); if (!el || !S.fm) return; const D = formDef(S.fm.form); el.innerHTML = fmBodyHTML(D, fmMode()); paintPhotos(el); const ft = $('.fmFt'); if (ft) ft.outerHTML = fmFootHTML(D, fmMode(), fmCur()); }
function fmTouch(k) { S.fm.dirty = true; const D = formDef(S.fm.form); if (k && fmDeps(D).has(k)) fmRedraw(); }
Object.assign(CHG, {
  fm(t) {
    const k = t.dataset.fk, D = formDef(S.fm.form), fd = formField(D, k); if (!fd) return;
    let v = t.value;
    if (fd.t === 'num' || fd.t === 'money') v = v === '' ? null : Number(v);
    else if (fd.t === 'date' || fd.t === 'time') v = v || null;
    if (v == null || (typeof v === 'number' && !isFinite(v))) delete S.fm.f[k]; else S.fm.f[k] = v;
    S.fm.dirty = true;
    if (fd.t === 'money' && fmDeps(D).has(k)) payLeftRefresh(D); // the repayment table's "still owed"
  },
  fmChecks(t) {
    const k = t.dataset.fk, D = formDef(S.fm.form), fd = formField(D, k), cur = Array.isArray(S.fm.f[k]) ? S.fm.f[k] : [];
    const next = fd.opts.map(o => o[0]).filter(o => o === t.value ? t.checked : cur.includes(o));
    if (next.length) S.fm.f[k] = next; else delete S.fm.f[k];
    fmTouch(k);
  },
  fmCheck(t) { const k = t.dataset.fk; if (t.checked) S.fm.f[k] = true; else delete S.fm.f[k]; fmTouch(k); },
  fmDate(t) { const k = t.dataset.fk, i = Number(t.dataset.i), L = Array.isArray(S.fm.f[k]) ? S.fm.f[k].slice() : []; while (L.length <= i) L.push(''); L[i] = t.value; S.fm.f[k] = L; S.fm.dirty = true; },
  fmPay(t) {
    const k = t.dataset.fk, i = Number(t.dataset.i), L = Array.isArray(S.fm.f[k]) ? S.fm.f[k].map(r => Object.assign({}, r)) : [];
    while (L.length <= i) L.push({ d: '', a: null });
    L[i][t.dataset.p] = t.dataset.p === 'a' ? (t.value === '' ? null : Number(t.value)) : t.value;
    S.fm.f[k] = L; S.fm.dirty = true; payLeftRefresh(formDef(S.fm.form));
  },
  fmAgree(t) { S.fm.agree = t.checked; }
});
/* "still owed" after each payment, updated as amounts are typed */
function payLeftRefresh(D) {
  formFields(D).filter(fd => fd.t === 'pay').forEach(fd => {
    let left = Number(S.fm.f[fd.of]) || 0;
    (S.fm.f[fd.k] || []).forEach((r, i) => { left = round2(left - (Number(r.a) || 0)); const el = $('[data-left="' + i + '"]'); if (el) el.textContent = money(Math.max(0, left)); });
  });
}
Object.assign(ACT, {
  fmSet(t) {
    const k = t.dataset.k, D = formDef(S.fm.form), fd = formField(D, k); if (!fd) return;
    S.fm.f[k] = fd.t === 'yesno' ? t.dataset.v === 'true' : t.dataset.v;
    $$('[data-act=fmSet][data-k="' + k + '"]').forEach(b => b.setAttribute('aria-pressed', String(b === t)));
    fmTouch(k);
  },
  fmAud(t) { S.fm.aud = t.dataset.v === 'owner' ? 'owner' : 'hr'; S.fm.dirty = true; renderView(); },
  fmDateAdd(t) { const k = t.dataset.k, L = Array.isArray(S.fm.f[k]) && S.fm.f[k].length ? S.fm.f[k].slice() : ['']; L.push(''); S.fm.f[k] = L; S.fm.dirty = true; fmRedraw(); },
  fmDateDel(t) { const k = t.dataset.k, L = (S.fm.f[k] || []).slice(); L.splice(Number(t.dataset.i), 1); S.fm.f[k] = L; S.fm.dirty = true; fmRedraw(); },
  fmPayAdd(t) { const k = t.dataset.k, L = Array.isArray(S.fm.f[k]) && S.fm.f[k].length ? S.fm.f[k].slice() : [{ d: '', a: null }]; L.push({ d: '', a: null }); S.fm.f[k] = L; S.fm.dirty = true; fmRedraw(); },
  fmPayDel(t) { const k = t.dataset.k, L = (S.fm.f[k] || []).slice(); L.splice(Number(t.dataset.i), 1); S.fm.f[k] = L; S.fm.dirty = true; fmRedraw(); },
  fmReload() { const x = fmCur(); if (x) fmLoad(x); renderView(); }
});

/* ---------- saving ---------- */
/* the answers of one part, tidied: blanks and hidden answers dropped */
function fmPart(D, f, by) {
  const out = {};
  formFields(D).filter(fd => fd.by === by).forEach(fd => {
    if (!fieldShown(fd, f)) return;
    let v = f[fd.k];
    if (typeof v === 'string') v = fd.t === 'area' ? v.replace(/\s+$/, '') : v.trim();
    if (fd.t === 'dates' && Array.isArray(v)) v = Array.from(new Set(v.filter(isISO))).sort();
    if (fd.t === 'pay' && Array.isArray(v)) v = v.filter(r => r && (r.d || r.a != null)).map(r => ({ d: r.d, a: Number(r.a) }));
    if (filled(fd, v)) out[fd.k] = v;
  });
  return out;
}
function fmProblem(D, f, by) {
  const miss = formMissing(D, f, by); if (!miss.length) return '';
  const m = miss[0], el = m.k && $('[data-fbox="' + m.k + '"]');
  if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); const i = $('input,textarea,select,button', el); if (i) setTimeout(() => i.focus({ preventScroll: true }), 300); }
  return m.msg || (miss.length > 1 ? 'Fill in “' + m.l + '” and ' + (miss.length - 1) + ' more.' : 'Fill in “' + m.l + '”.');
}
function sigNow() { return { by: meSid(), at: Date.now(), n: fullName(meSid()).slice(0, 80) }; }
async function fmSave(t, fn, opts, okMsg) {
  busyBtn(t, true, 'Saving…');
  try { await fn(); S.fm.dirty = false; if (okMsg) toast(okMsg, { ms: 6000 }); return true; }
  catch (e) {
    busyBtn(t, false);
    if (e && e.code === 'changed') { toast('This form was just changed — look at it again.', { bad: true }); fmRedraw(); }
    else toast(errText(e), { bad: true, ms: 8000 });
    return false;
  }
}
Object.assign(ACT, {
  async fmSend(t) {
    const fm = S.fm, D = formDef(fm.form), staffF = fmPart(D, fm.f, 'staff'), p = fmProblem(D, staffF, 'staff');
    if (p) return toast(p, { bad: true });
    if (D.sign.staff && !fm.agree) { const a = $('.fmAgree'); if (a) a.scrollIntoView({ block: 'center' }); return toast('Tick the box to sign it first.', { bad: true }); }
    const me = meSid(), now = Date.now(), y = Number(todayISO().slice(0, 4));
    const c0 = { sid: me, kind: 'form', form: D.id, fv: 1, aud: fm.aud, f: staffF, at: now, sign: D.sign.staff ? { staff: sigNow() } : {}, events: [{ a: 'send', by: me, at: now }] };
    const big = formTooBig(c0); if (big) return toast(big, { bad: true, ms: 9000 });
    const ok = await fmSave(t, () => B.savePerk(B.newPerkId(), c => { Object.assign(c, c0); return { status: 'pending' }; }, { create: { sid: me, year: y }, a: 'send' }));
    if (ok) { toast('Sent — ' + (fm.aud === 'owner' ? 'only Dr. A can read it.' : audWords('hr') + ' can read it.') + ' You’ll see the answer under My forms.', { ms: 7000 }); S.fm = null; S.view = 'forms'; renderNav(); renderView(); window.scrollTo(0, 0); }
  },
  async fmSaveOwn(t) {
    const fm = S.fm, x = fmCur(), D = formDef(fm.form); if (!x) return;
    const staffF = fmPart(D, fm.f, 'staff'), p = fmProblem(D, staffF, 'staff'); if (p) return toast(p, { bad: true });
    if (D.sign.staff && !fm.agree) { const a = $('.fmAgree'); if (a) a.scrollIntoView({ block: 'center' }); return toast('Tick the box to sign it again first.', { bad: true }); }
    const me = meSid(), now = Date.now(), wasBack = !!x.back;
    const ok = await fmSave(t, () => B.savePerk(x.id, c => {
      c.f = Object.assign({}, fmPart(D, c.f || {}, 'hr'), staffF); c.aud = fm.aud;
      if (D.sign.staff) c.sign = Object.assign({}, c.sign || {}, { staff: sigNow() });
      delete c.back; c.events = formEvent(c.events, { a: wasBack ? 'resend' : 'edit', by: me, at: now });
      if (formTooBig(c)) throw errCode('bad', formTooBig(c));
      return { status: 'pending' };
    }, { rev: fm.rev, a: wasBack ? 'resend' : 'edit' }), null, wasBack ? 'Sent again' : 'Saved — it still waits for the office');
    if (ok) { S.fm = null; S.view = 'forms'; renderNav(); renderView(); }
  },
  async fmWithdraw() {
    const x = fmCur(); if (!x) return;
    if (!(await confirmBox('Take this form back?', 'It’s marked as taken back. You can fill out a new one any time.', 'Take it back', true))) return;
    const me = meSid(), now = Date.now();
    if (await fmSave(null, () => B.savePerk(x.id, c => { c.decision = { s: 'cancelled', by: me, at: now, note: '' }; c.events = formEvent(c.events, { a: 'withdraw', by: me, at: now }); return { status: 'cancelled' }; }, { rev: x.rev, a: 'withdraw' }), null, 'Taken back')) { S.fm = null; S.view = 'forms'; renderView(); }
  },
  async fmSaveHR(t) {
    const fm = S.fm, x = fmCur(), D = formDef(fm.form); if (!x) return;
    const hrF = fmPart(D, fm.f, 'hr'), bad = formMissing(D, hrF, 'hr').find(m => m.msg); if (bad) return toast(bad.msg, { bad: true });
    const me = meSid(), now = Date.now();
    await fmSave(t, () => B.savePerk(x.id, c => {
      c.f = Object.assign({}, c.f || {}); formFields(D).filter(fd => fd.by === 'hr').forEach(fd => { delete c.f[fd.k]; }); Object.assign(c.f, hrF);
      c.events = formEvent(c.events, { a: 'save', by: me, at: now });
      if (formTooBig(c, 'hr')) throw errCode('bad', formTooBig(c, 'hr'));
    }, { rev: fm.rev, a: 'save' }), null, 'Saved');
    renderView();
  },
  async fmDecide(t) {
    const fm = S.fm, x = fmCur(), D = formDef(fm.form); if (!x) return;
    const hrF = fmPart(D, fm.f, 'hr'), p = fmProblem(D, hrF, 'hr'); if (p) return toast(p, { bad: true });
    const who = formAnon(x) ? 'The sender' : shortName(x.sid);
    const note = await noteBox(D.act, (D.sign.hr ? 'You sign it with your login. ' : '') + (x.sid === meSid() ? '' : who + ' sees it' + (D.noteL ? ', with your reply below.' : ', with any note you add.')), D.act, false, false);
    if (note == null) return;
    const me = meSid(), now = Date.now();
    const ok = await fmSave(t, () => B.savePerk(x.id, c => {
      c.f = Object.assign({}, c.f || {}); formFields(D).filter(fd => fd.by === 'hr').forEach(fd => { delete c.f[fd.k]; }); Object.assign(c.f, hrF);
      if (D.sign.hr) c.sign = Object.assign({}, c.sign || {}, { hr: sigNow() });
      delete c.back; c.decision = { s: 'approved', by: me, at: now, note: note.slice(0, 500) };
      c.events = formEvent(c.events, { a: D.decide === 'approve' ? 'approve' : 'file', by: me, at: now, note: note.slice(0, 500) });
      if (formTooBig(c, 'hr')) throw errCode('bad', formTooBig(c, 'hr'));
      return { status: 'approved' };
    }, { rev: fm.rev, a: D.decide === 'approve' ? 'approve' : 'file' }), null, D.done + ' — ' + (formAnon(x) ? 'the sender sees' : shortName(x.sid) + ' sees') + ' it now');
    if (ok) renderView();
  },
  async fmDeny(t) {
    const fm = S.fm, x = fmCur(), D = formDef(fm.form); if (!x) return;
    const note = await noteBox('Not approved', 'Tell ' + shortName(x.sid) + ' why — they’ll see this note with the answer.', 'Send the answer', true, true); if (note == null) return;
    const me = meSid(), now = Date.now();
    if (await fmSave(t, () => B.savePerk(x.id, c => { if (D.sign.hr) c.sign = Object.assign({}, c.sign || {}, { hr: sigNow() }); delete c.back; c.decision = { s: 'denied', by: me, at: now, note: note.slice(0, 500) }; c.events = formEvent(c.events, { a: 'deny', by: me, at: now, note: note.slice(0, 500) }); return { status: 'denied' }; }, { rev: fm.rev, a: 'deny' }), null, 'Answered — ' + shortName(x.sid) + ' sees it now')) renderView();
  },
  async fmBack(t) {
    const fm = S.fm, x = fmCur(); if (!x) return;
    const who = formAnon(x) ? 'the sender' : shortName(x.sid);
    const note = await noteBox('Send it back for a change', 'Say what to change — ' + who + ' sees this note, changes the form and sends it again.', 'Send it back', true, false); if (note == null) return;
    const me = meSid(), now = Date.now();
    if (await fmSave(t, () => B.savePerk(x.id, c => { c.back = { by: me, at: now, note: note.slice(0, 500) }; c.events = formEvent(c.events, { a: 'back', by: me, at: now, note: note.slice(0, 500) }); return { status: 'pending' }; }, { rev: fm.rev, a: 'back' }), null, 'Sent back to ' + who)) renderView();
  },
  async fmCancel(t) {
    const x = fmCur(); if (!x) return;
    const note = await noteBox('Cancel this form?', 'It’s marked as cancelled (its history is kept), e.g. a duplicate or a test. ' + (formAnon(x) ? 'The sender' : shortName(x.sid)) + ' sees your note.', 'Cancel it', false, true); if (note == null) return;
    const me = meSid(), now = Date.now();
    if (await fmSave(t, () => B.savePerk(x.id, c => { c.decision = { s: 'cancelled', by: me, at: now, note: note.slice(0, 500) }; c.events = formEvent(c.events, { a: 'cancel', by: me, at: now, note: note.slice(0, 500) }); return { status: 'cancelled' }; }, { rev: x.rev, a: 'cancel' }), null, 'Cancelled')) { S.fm = null; S.view = 'forms'; renderView(); }
  },
  fmPrint() { printForm(); }
});

/* ---------- the printout (Print → Save as PDF to keep a copy) ---------- */
function printForm() {
  const fm = S.fm; if (!fm) return;
  const D = formDef(fm.form), x = fmCur();
  // a sent form prints as saved; a printout prints what's on the screen
  const f = x && D.kind === 'send' ? x.f || {} : fm.f, html = formPrintHTML(D, f, x);
  let el = $('#printDoc'); if (!el) { el = document.createElement('div'); el.id = 'printDoc'; document.body.appendChild(el); }
  el.innerHTML = html;
  const was = document.title, who = x ? (formAnon(x) ? 'name left off' : fullName(x.sid)) : fullName(meSid());
  document.title = D.title.replace(/[:’]/g, '') + ' - ' + who + ' - ' + (x ? isoOfMs(x.at) : todayISO());
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); el.innerHTML = ''; document.title = was; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  try { window.print(); } catch (e) { done(); toast('This page can’t print here.', { bad: true }); }
}
const PBOX = on => '<span class="pBox">' + (on ? '✕' : '') + '</span>';
function pLab(fd) { return fd.p || fd.l; }
function pLine(label, val, wide) { return '<div class="pF' + (wide ? ' w' : '') + '"><span class="pL">' + esc(label) + '</span><span class="pV">' + esc(val || '') + '</span></div>'; }
function formPrintHTML(D, f, x) {
  const sid = x ? x.sid : meSid(), name = x && formAnon(x) ? '(left off by the sender)' : fullName(sid), sent = x ? x.at : Date.now();
  const ctx = { name: x && formAnon(x) ? '________' : name, employer: OFFICE_NAME };
  let h = '<div class="pDoc"><div class="pTop"><div><b>' + esc(OFFICE_NAME.toUpperCase()) + '</b><span>' + esc(OFFICE_ADDR + ' · ' + OFFICE_PHONE) + '</span></div>' + (x ? '<div class="pRef">' + esc(formStatus(x)[0]) + '</div>' : '') + '</div>';
  h += '<h1 class="pTitle">' + esc(D.title.toUpperCase()) + '</h1>';
  if (D.kind === 'print') return h + printoutHTML(D, f) + '</div>';
  h += '<div class="pRow">' + pLine(D.anon && f.anon ? 'Employee name (optional)' : 'Employee', name, true) + pLine('Date', fmtDateLong(isoOfMs(sent))) + '</div>';
  (D.parts || []).forEach(p => {
    if (p.by === 'hr' && !formFields(D).some(fd => fd.by === 'hr' && filled(fd, f[fd.k])) && !(x && x.status === 'approved')) return;
    if (p.h) h += '<div class="pSec">' + esc(p.h) + '</div>';
    let row = [];
    const flush = () => { if (row.length) { h += '<div class="pRow">' + row.join('') + '</div>'; row = []; } };
    p.fields.forEach(fd => {
      if (!fieldShown(fd, f)) return;
      if (fd.t === 'say') { flush(); h += '<p class="pSay">' + esc(formSay(fd.s, ctx)) + '</p>'; return; }
      if (fd.t === 'aud') { flush(); if (!(audPick(D) && D.aud.pr)) return; const a = x ? x.aud : S.fm.aud; h += D.aud.hr ? '<div class="pChk"><span class="pL">' + esc(D.aud.l) + ':</span> ' + PBOX(a === 'hr') + ' Manager/administrator ' + PBOX(a === 'owner') + ' Employer</div>' : pLine(D.aud.l, audFull(a), true); return; }
      if (fd.k === 'anon') return;
      const v = f[fd.k];
      if (fd.t === 'area') { flush(); h += '<div class="pArea"><span class="pL">' + esc(pLab(fd)) + '</span><div class="pText">' + esc(v || '') + '</div></div>'; return; }
      if (fd.t === 'yesno') { flush(); h += '<div class="pChk"><span class="pL">' + esc(pLab(fd)) + '</span> ' + PBOX(v === false) + ' No ' + PBOX(v === true) + ' Yes</div>'; return; }
      if (fd.t === 'checks' || fd.t === 'pick') { flush(); const on = o => fd.t === 'pick' ? v === o : Array.isArray(v) && v.includes(o); h += '<div class="pChk"><span class="pL">' + esc(pLab(fd)) + ':</span> ' + fd.opts.map(([o, l]) => '<span class="pOpt">' + PBOX(on(o)) + ' ' + esc(l) + (o === 'other' && fd.k === 'items' && f.itemsOther ? ': ' + esc(f.itemsOther) : '') + '</span>').join(' ') + '</div>'; return; }
      if (fd.t === 'check') { flush(); h += '<div class="pChk">' + PBOX(v === true) + ' ' + esc(pLab(fd)) + '</div>'; return; }
      if (fd.t === 'pay') { flush(); h += '<div class="pArea"><span class="pL">' + esc(pLab(fd)) + '</span>' + payTableHTML(fd, f, false) + '</div>'; return; }
      if (fd.k === 'itemsOther') return; // printed beside "Other"
      const one = pLine(pLab(fd), fmValueText(fd, v));
      if (fd.half || fd.third) { row.push(one); if (row.length === (fd.third ? 3 : 2)) flush(); } else { flush(); h += one; }
    });
    flush();
  });
  // decision, signatures, received
  if (x && D.decide === 'approve' && (x.status === 'approved' || x.status === 'denied')) h += '<div class="pChk"><span class="pL">Employer:</span> ' + PBOX(x.status === 'approved') + ' Approved ' + PBOX(x.status === 'denied') + ' Not approved' + (x.status === 'denied' && x.decision && x.decision.note ? ' — ' + esc(x.decision.note) : '') + '</div>';
  else if (x && x.decision && x.decision.note && x.status === 'approved') h += pLine(D.noteL || 'Office note', x.decision.note, true);
  const sg = x && x.sign ? x.sign : {};
  if (D.sign.staff) h += '<div class="pSig">' + pLine('Employee’s signature', sg.staff ? 'Signed electronically by ' + (sg.staff.n || name) : '', true) + pLine('Date', sg.staff ? fmtDateLong(isoOfMs(sg.staff.at)) : '') + '</div>';
  if (D.sign.hr) h += '<div class="pSig">' + pLine('Employer’s signature', sg.hr ? 'Signed electronically by ' + (sg.hr.n || fullName(sg.hr.by)) : '', true) + pLine(D.pr && D.pr.received ? 'Date received' : 'Date', D.pr && D.pr.received ? fmtDateLong(isoOfMs(sent)) : sg.hr ? fmtDateLong(isoOfMs(sg.hr.at)) : '') + '</div>';
  if (D.pr && D.pr.cc) h += '<div class="pCc">cc: Employee’s personnel file · Employee</div>';
  h += '<div class="pFoot">Sent through NLO Time Off' + (x ? ' (form ' + esc(x.id.slice(0, 9)) + ')' : '') + ' · printed ' + esc(fmWhen(Date.now())) + (x && x.sign && (x.sign.staff || x.sign.hr) ? ' · electronic signatures are made with each person’s own NLO login' : '') + '</div>';
  return h + '</div>';
}
/* the provider's certifications: Sections 1 and 2 as filled in, then the provider's part to fill in by hand */
const BL = n => Array.from({ length: n }, () => '<div class="pBlank"></div>').join('');
function provIdHTML() {
  return '<div class="pRow">' + pLine('Health care provider’s name', '', true) + '</div><div class="pRow">' + pLine('Address', '', true) + '</div>' +
    '<div class="pRow">' + pLine('Telephone', '') + pLine('Fax', '') + '</div>';
}
function printoutHTML(D, f) {
  let h = '';
  (D.parts || []).forEach(p => {
    h += '<div class="pSec">' + esc(p.h) + '</div>'; let row = [];
    const flush = () => { if (row.length) { h += '<div class="pRow">' + row.join('') + '</div>'; row = []; } };
    p.fields.forEach(fd => {
      if (fd.t === 'pick') { flush(); h += '<div class="pArea"><span class="pL">' + esc(fd.l) + ':</span>' + fd.opts.map(([o, l]) => '<div class="pOptL">' + PBOX(f[fd.k] === o) + ' ' + esc(l) + '</div>').join('') + '</div>'; return; }
      const one = pLine(fd.l, fmValueText(fd, f[fd.k]));
      if (fd.half) { row.push(one); if (row.length === 2) flush(); } else { flush(); h += one; }
    });
    flush();
    if (D.id === 'family' && p.by === 'emp') h += '<p class="pSay">The law lets us ask for a timely, complete and sufficient medical certification to support a request for leave to care for a covered family member with a serious health condition. If we ask for it, you need to give it to us to have certain protections under the law, and an incomplete certification may lead to the leave being denied. Please return this form within <b>15 calendar days</b>.</p>';
    if (D.id === 'family' && p.by === 'staff') h += '<p class="pSay">Fill out <b>Attachment B</b> and give it to the health care provider, not to the employer.</p><p class="pSay">I certify that what I have given here is true and correct.</p><div class="pSig">' + pLine('Employee’s signature', '', true) + '</div>';
  });
  if (D.id === 'pregnancy') {
    const item = (label, more, dates) => '<div class="pItem">' + PBOX(false) + ' <b>' + label + '</b>' + (more ? '<div class="pSay">' + more + '</div>' : '') + BL(dates === 'only' ? 0 : 3) + (dates ? '<div class="pRow">' + pLine('Starting (estimate)', '') + pLine('Ending (estimate)', '') + '</div>' : '') + '</div>';
    h += '<div class="pSec">Section 3 — the health care provider</div><p class="pSay">Please confirm that, because of this patient’s pregnancy, childbirth or a related medical condition (for example recovery from childbirth, the loss or end of a pregnancy, or postpartum depression), the patient needs the following. Tick each that applies.</p>' +
      item('Time off for medical appointments.', 'When, and for how long:', false) +
      item('Disability leave.', 'Because of the pregnancy, childbirth or a related condition, the patient can’t do one or more of the essential functions of the job, or can’t do them without undue risk to herself, to the pregnancy, or to others.', 'only') +
      item('Intermittent leave.', 'The medically advisable schedule of intermittent leave:', true) +
      item('A reduced work schedule.', 'The medically advisable reduced schedule:', true) +
      item('A transfer to a less strenuous or hazardous position, or less strenuous or hazardous duties.', 'What would be medically advisable:', false) +
      item('Reasonable accommodation.', 'What is medically advisable — for example limits on lifting, more frequent breaks, or a stool or chair:', true) +
      provIdHTML() + '<div class="pRow">' + pLine('License number', '') + pLine('Specialty', '') + '</div>' +
      '<div class="pSig">' + pLine('Signature of health care provider', '', true) + pLine('Date', '') + '</div><p class="pSay"><b>Please give this form back to the employee.</b></p>';
  }
  if (D.id === 'family') {
    const yn = '<span class="pOpt">' + PBOX(false) + ' Yes</span> <span class="pOpt">' + PBOX(false) + ' No</span>';
    const freq = what => '<div class="pSay">Frequency: ______ times per ______ week(s) ______ month(s)<br>Duration: ______ hours or ______ day(s) per ' + what + '</div>';
    h += '<div class="pBreak"></div><div class="pSec">Section 3 — the health care provider</div>' +
      '<div class="pNote"><b>Important.</b> The Genetic Information Nondiscrimination Act of 2008 (GINA) prohibits employers and other entities covered by GINA Title II from requesting or requiring genetic information of an individual or family member of the individual, except as specifically allowed by this law. To comply with this law, we are asking that you not provide any genetic information when responding to this request for medical information. “Genetic information” as defined by GINA, includes an individual’s family medical history, the results of an individual’s or family member’s genetic tests, the fact that an individual or an individual’s family member sought or received genetic services, and genetic information of a fetus carried by an individual or an individual’s family member or an embryo lawfully held by an individual or family member receiving assistive reproductive services.</div>' +
      '<p class="pSay">The employee named above has asked for leave to care for your patient, who is their family member or “designated person.” Please answer every part that applies. Where a question asks how often or how long, give your best estimate from your medical knowledge, experience and examination of the patient, and be as specific as you can: words like “lifetime,” “unknown” or “indeterminate” may not be enough to decide whether the leave is protected. Answer only about the condition the employee needs the leave for. <b>Please don’t give the underlying diagnosis without the patient’s consent, and don’t give any genetic information.</b> Please sign the form.</p>' +
      provIdHTML() +
      '<ol class="pList"><li>When did the medical condition or need for treatment begin? ____________________</li>' +
      '<li>How long will the condition or need for treatment probably last? ____________________</li>' +
      '<li>Attachment A describes a “serious health condition.” Does the patient’s condition qualify as one? ' + yn + '</li>' +
      '<li>a. Does or will the patient need help with basic medical, hygiene, nutrition, safety or transportation needs, or with physical or psychological care? ' + yn + '<br>b. Having read the employee’s statement (Attachment B), does the condition call for the employee to take part in the care? (This can include psychological comfort or arranging care by others.) ' + yn + '</li>' +
      '<li>About how long would the employee’s presence help in caring for the family member?' + BL(2) + '</li>' +
      '<li>Answer only if the employee is asking for intermittent leave or a reduced schedule.<br><b>Intermittent leave:</b> Is it medically necessary for the employee to be off work now and then because of the family member’s serious health condition? ' + yn + '<br>If yes, how often and for how long (e.g. one episode every 3 months lasting 1–2 days):' + freq('episode') +
      '<b>Reduced schedule:</b> Is it medically necessary for the employee to work less than their normal schedule because of the family member’s serious health condition? ' + yn + '<br>If yes: ______ hour(s) a day; ______ day(s) a week, from ____________ through ____________<br>' +
      '<b>Appointments or treatment:</b> Is it medically necessary for the employee to take time off for the family member’s doctor visits or treatment? ' + yn + '<br>If yes, how often, and the time each takes including any recovery:' + freq('appointment or treatment') + '</li></ol>' +
      '<div class="pSig">' + pLine('Signature of health care provider', '', true) + pLine('Date', '') + '</div><p class="pSay"><b>Please give this form back to the employee.</b></p>' +
      '<div class="pBreak"></div><div class="pSec">Attachment A — what a “serious health condition” is</div>' +
      '<p class="pSay">An illness, injury (including an injury at work), impairment, or physical or mental condition of the family member that involves inpatient care or continuing treatment (treatment for substance abuse included). It can be any of these:</p>' +
      '<ul class="pList"><li><b>Hospital care:</b> an inpatient stay in a hospital, hospice or residential medical care facility — formally admitted with the expectation of staying at least overnight — including any time unable to work, or treatment, that goes with it.</li>' +
      '<li><b>Absence plus treatment:</b> more than three days in a row unable to work, school or other regular activities, with treatment by a health care provider two or more times (or by others on the provider’s orders), or treatment once that leads to continuing treatment under the provider’s supervision.</li>' +
      '<li><b>Pregnancy:</b> any time unable to work because of pregnancy, or for prenatal care.</li>' +
      '<li><b>Chronic conditions:</b> a condition that needs periodic visits for treatment, continues over a long time, and may cause episodes rather than a continuing period of incapacity (e.g. asthma, diabetes, epilepsy).</li>' +
      '<li><b>Permanent or long-term conditions:</b> incapacity for which treatment may not be effective, under the continuing supervision of a health care provider (e.g. Alzheimer’s, a severe stroke, the terminal stages of a disease).</li>' +
      '<li><b>Multiple treatments:</b> time off for several treatments (and recovery) for restorative surgery after an accident or injury, or for a condition that would likely mean more than three days of incapacity without treatment (e.g. chemotherapy or radiation, physical therapy for severe arthritis, dialysis).</li></ul>' +
      '<div class="pBreak"></div><div class="pSec">Attachment B — the employee’s statement about the seriously ill family member</div>' +
      '<p class="pSay"><b>Fill this out and sign it, then give it to the health care provider separately. Don’t give it to the employer.</b></p>' +
      '<p class="pSay">Describe the care you will give your family member, with about how long you will give it, and a schedule if the leave is intermittent or a reduced schedule:</p>' + BL(12) +
      '<p class="pSay">I certify that what I have given here is true and correct.</p><div class="pSig">' + pLine('Signature of employee', '', true) + pLine('Date', '') + '</div>';
  }
  return h + '<div class="pFoot">Printed from NLO Time Off · ' + esc(fmWhen(Date.now())) + '</div>';
}
