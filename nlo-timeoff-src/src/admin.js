/* =====================================================================
   Settings (Dr. A): who approves, the HR key, the policy (with the day
   each change applies from), blackouts, office closures, the front-desk
   emails, the feed CADANCe and the office calendar read, moving from the
   old app, the database rules. People's HR records (hire date, opening
   balance, adjustments). My account (password — the NLO Cases login).
   ===================================================================== */
function viewSettings() {
  return '<div class="adminGrid"><div>' + approversCardHTML() + shCardHTML() + hrKeyCardHTML() + moveCardHTML() + feedCardHTML() + '</div><div>' +
    policyCardHTML() + scrubsSetCardHTML() + blackoutsCardHTML() + closuresCardHTML() + deskCardHTML() + securityCardHTML() + '</div></div>';
}
function afterSettings() { loadHRPeople(); loadFeed(); loadDesk(); loadScrubsMail(); shAuto().catch(() => { }); }
function paintSettings() { if (S.view !== 'settings') return; const y = window.scrollY; $('#view').innerHTML = viewSettings(); paintPhotos($('#view')); afterSettings(); window.scrollTo(0, y); }

/* ---------- who approves (who holds the HR key) ---------- */
async function loadHRPeople() {
  try { S.hrP = await B.hrPeople(); } catch (e) { S.hrP = { err: errText(e) }; }
  const a = $('#apprBox'), k = $('#hrKeyBox');
  if (a) { a.innerHTML = approversHTML(); paintPhotos(a); }
  if (k) k.innerHTML = hrKeyBodyHTML();
}
function approversCardHTML() {
  return '<div class="card"><div class="cardHd"><h3>Who approves</h3><span class="sub">Sees everyone’s requests and balances</span></div><div class="cardBd"><div id="apprBox">' + approversHTML() + '</div></div></div>';
}
function approversHTML() {
  const P = S.hrP;
  if (!P) return '<div class="small muted">Loading…</div>';
  if (P.err) return '<div class="lockErr">' + esc(P.err) + '</div><button class="btn btn-sec btn-sm" data-act="reloadHRP">' + ic('refresh', 15) + 'Try again</button>';
  const grants = new Map(P.grants.map(g => [g.uid, g])), busy = !!(S.accessBusy || S.rotating || B.rotating);
  const ms = P.members.filter(m => m.active).sort((a, b) => (a.role === 'owner' ? -1 : 0) - (b.role === 'owner' ? -1 : 0) || String(a.name).localeCompare(String(b.name)));
  let stale = 0;
  const rows = ms.map(m => {
    const owner = m.role === 'owner', g = grants.get(m.uid), on = owner || !!g, ready = !!m.pub && !m.mustSetup;
    const old = g && m.pub && g.pubX !== m.pub.x && !owner; if (old) stale++;
    const sub = owner ? 'Owner — always' : old ? 'Their login’s key changed without a reissue — press Check now (approving is turned off and a new HR key made)' : on ? 'Approves time off' : !ready ? 'Needs to sign in once (and choose a password) before this can be turned on' : 'Staff';
    return '<div class="accessRow">' + avatarHTML(m.staffId, m.name) + '<div class="grow"><b>' + esc(m.name || m.staffId) + '</b><div class="small muted">' + esc(sub) + '</div></div>' +
      '<button type="button" class="sw" role="switch" aria-checked="' + on + '" aria-label="' + esc((m.name || '') + ' approves time off') + '" data-act="toggleHR" data-uid="' + esc(m.uid) + '"' + (owner || busy || (!on && !ready) ? ' disabled' : '') + '></button></div>';
  }).join('');
  return rows + (stale ? '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="fixHR">' + ic('refresh', 15) + 'Check now</button></div>' : '') +
    (S.rotating ? '<div class="small" id="rotMsg" style="margin-top:12px">' + esc(S.rotating.msg) + '</div><div class="prog"><i id="rotBar" style="width:' + S.rotating.pct + '%"></i></div>' : '') +
    '<p class="small muted" style="margin-top:12px">The people who approve see every request with its kind and notes, everyone’s balances and HR records, and can approve, record and take back time off — but never decide their own requests (you do). Turning someone off deletes their copy of the HR key at once and makes a new key for everyone else. Their login keeps working for everything else.</p>';
}
function rotProgress(n, tot) {
  S.rotating = { msg: tot ? 'Sealing everything again under the new HR key… ' + n + ' of ' + tot : 'Sealing everything again under the new HR key…', pct: Math.round(10 + 90 * (tot ? n / tot : 1)) };
  const b = $('#rotBar'), m = $('#rotMsg'); if (b) b.style.width = S.rotating.pct + '%'; if (m) m.textContent = S.rotating.msg;
}
function keyChangedMsg(names) { return names.join(', ') + (names.length > 1 ? '’ logins' : '’s login') + ' changed its key without a reissue, so approving was turned off and a new HR key made. If that’s expected, reissue the login in NLO Cases, then turn approving on again.'; }
/* a new HR key wasn't given to a login whose key changed in place (backend newKey): say so */
function keyChangedNotice() { const n = B.keyChangedNames || []; if (n.length) { toast(keyChangedMsg(n), { bad: true, ms: 15000 }); B.keyChangedNames = []; } }
function rotDoneMsg(r) { return r && r.failed ? ' — ' + plural(r.failed, 'record') + ' couldn’t be sealed again yet; that’s retried automatically' : ''; }
Object.assign(ACT, {
  reloadHRP() { S.hrP = null; loadHRPeople(); },
  async toggleHR(t) {
    const P = S.hrP, uid = t.dataset.uid; if (!P || P.err || S.accessBusy || S.rotating || B.rotating) return;
    const m = P.members.find(x => x.uid === uid); if (!m || m.role === 'owner') return;
    const on = P.grants.some(g => g.uid === uid), who = firstName(m.name) || m.staffId;
    if (!on) {
      if (!(await confirmBox(who + ' approves time off?', who + ' will see every request (with its kind and notes), everyone’s balances and HR records, and can approve, record and take back time off — except their own.', 'Turn on'))) return;
      S.accessBusy = uid; loadHRPeople();
      try { await B.hrGrant(m); toast(who + ' approves time off now — they see Approvals the next time they sign in'); }
      catch (e) { toast(errText(e), { bad: true }); }
      S.accessBusy = ''; return loadHRPeople();
    }
    if (!(await confirmBox('Turn off approving for ' + (m.name || who) + '?', 'Their copy of the HR key is deleted at once (if they have Time Off open, it locks). Then a new HR key is made and every request and HR record is sealed again under it — it takes a minute; keep this page open until it finishes.', 'Turn off', true))) return;
    S.accessBusy = uid; S.rotating = { msg: 'Making a new HR key…', pct: 5 }; loadHRPeople();
    try { const r = await B.hrRevoke(uid, rotProgress); toast('Approving turned off for ' + who + rotDoneMsg(r), { ms: 6000 }); }
    catch (e) { toast(errText(e), { bad: true }); }
    S.accessBusy = ''; S.rotating = null; loadHRPeople(); keyChangedNotice();
  },
  async newHRKey() {
    if (S.accessBusy || S.rotating || B.rotating) return;
    if (!(await confirmBox('Make a new HR key?', 'Everyone who approves gets a copy of the new key, and every request and HR record is sealed again under it. Anything copied off a lost device stops opening new saves. It takes a minute; keep this page open until it finishes.', 'Make a new key'))) return;
    S.accessBusy = 'key'; S.rotating = { msg: 'Making a new HR key…', pct: 5 }; loadHRPeople();
    try { const r = await B.hrRotate(rotProgress); toast('New HR key made' + rotDoneMsg(r), { ms: 6000 }); }
    catch (e) { toast(errText(e), { bad: true }); }
    S.accessBusy = ''; S.rotating = null; loadHRPeople(); keyChangedNotice();
  },
  async fixHR() {
    S.accessBusy = 'fix'; loadHRPeople();
    try {
      const r = await B.hrFixGrants(), off = r.removed.concat(r.relogin);
      toast(r.keyChanged.length ? keyChangedMsg(r.keyChanged) : r.resealed.length ? 'Renewed for ' + r.resealed.join(', ') : off.length ? 'Taken off ' + off.join(', ') + ' (login turned off) — a new HR key was made' : 'Everything is up to date', r.keyChanged.length ? { bad: true, ms: 15000 } : {});
    } catch (e) { toast(errText(e), { bad: true }); }
    S.accessBusy = ''; loadHRPeople();
  }
});

/* ---------- the HR key ---------- */
function hrKeyCardHTML() {
  return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>The HR key</h3><span class="sub">Separate from the office key</span></div><div class="cardBd" id="hrKeyBox">' + hrKeyBodyHTML() + '</div></div>';
}
function hrKeyBodyHTML() {
  const P = S.hrP, v = B.hr ? B.hr.curV : 1;
  let rec = '<span class="muted">Checking…</span>';
  if (P && !P.err) rec = P.escrowOk ? '<span class="sug mint">' + ic('done', 13) + 'Up to date</span>'
    : P.hasRecovery === false ? '<span class="sug amber">No office recovery code yet</span>'
    : '<span class="sug amber">Out of date</span> <button class="linkBtn" data-act="fixHR">Update it now</button>';
  return '<div class="kvRow"><span>Current HR key</span><b>#' + esc(String(v)) + '</b></div>' +
    '<div class="kvRow"><span>Copy kept with your recovery code</span>' + rec + '</div>' +
    '<div class="kvRow"><span>People who approve</span><b>' + (P && !P.err ? P.grants.length : '…') + '</b></div>' +
    '<p class="small muted" style="margin-top:10px">Requests and HR records are sealed on the computer that saves them; the database only holds the sealed copies, plus whose they are, their status and the day they start. Each person can always open their own requests and balances (their copy is sealed to their login). Everyone sees who’s out — names, days and morning/afternoon, never why.' +
    (P && P.hasRecovery === false ? ' Set up the recovery code in NLO Cases → Team &amp; security.' : '') + '</p>' +
    '<div class="btnRow"><button class="btn btn-ghost" data-act="newHRKey"' + (S.accessBusy || S.rotating ? ' disabled' : '') + '>' + ic('key', 15) + 'Make a new HR key now</button></div><p class="small muted">Only needed if a computer or phone that had Approvals open is lost or stolen.</p>';
}

/* ---------- moving from the old app ---------- */
function moveCardHTML() {
  const m = (S.settings.to || {}).moved;
  return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Move from the old app</h3></div><div class="cardBd">' +
    (m && m.at ? '<div class="kvRow"><span>Moved</span><b>' + esc(fmtWhen(m.at)) + '</b></div><div class="kvRow"><span>People · requests</span><b>' + esc(String(m.people || 0)) + ' · ' + esc(String(m.reqs || 0)) + '</b></div><div class="kvRow"><span>Balances as of</span><b>' + esc(m.asOf ? fmtDate(m.asOf) : '—') + '</b></div>'
      : '<p class="small">Bring everyone’s hire dates, balances and requests over from the old Time-Off Google Sheet. Each balance is checked against the handbook first, and you pick what each person starts from. Nothing in the old Sheet changes.</p>') +
    '<div class="btnRow"><button class="btn ' + (m && m.at ? 'btn-sec' : 'btn-pri') + ' btn-sm" data-act="nav" data-v="import">' + ic('import', 15) + (m && m.at ? 'Move another file' : 'Move from the old app') + '</button></div></div></div>';
}

/* ---------- the feed CADANCe and the office calendar read ---------- */
async function loadFeed() {
  let f = null; try { f = await B.readFeed(); } catch (e) { }
  // any member may write the feed, so nothing in it is trusted: numbers are numbers, the time a time
  const at = f && typeof f.syncedAt === 'string' ? Date.parse(f.syncedAt) : 0, pend = f ? Number(f.pending) : NaN;
  S.feedInfo = { at: isFinite(at) ? at : 0, pending: Number.isInteger(pend) && pend >= 0 && pend < 1000 ? pend : null, n: f && Array.isArray(f.timeOff) ? f.timeOff.length : 0, key: B.feedKeyB64 ? B.feedKeyB64() : '' };
  const el = $('#feedBox'); if (el) el.innerHTML = feedBodyHTML();
}
function feedURL() { return 'https://firestore.googleapis.com/v1/projects/' + (B.projectId ? B.projectId() : 'nlo-cases') + '/databases/(default)/documents/toFeed/live'; }
function feedCardHTML() {
  return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>CADANCe and the office calendar</h3></div><div class="cardBd" id="feedBox">' + feedBodyHTML() + '</div></div>';
}
function feedBodyHTML() {
  const F = S.feedInfo;
  return '<p class="small">They show who’s out from a feed Time Off keeps up to date: names, days and morning/afternoon, office closures, and how many requests are waiting — never the kind of time off, notes or anyone’s hours. The feed is sealed with its own key; they need the key to read it.</p>' +
    (!F ? '<div class="small muted">Loading…</div>' :
      '<div class="kvRow"><span>Last updated</span><b>' + (F.at ? esc(fmtWhen(F.at)) : 'Not yet') + '</b></div><div class="kvRow"><span>In it now</span><b>' + plural(F.n, 'approved request') + (F.pending != null ? ' · ' + F.pending + ' waiting' : '') + '</b></div>' +
      '<details class="help"><summary>Address and key (for setting up CADANCe and the calendar)</summary><div class="small muted" style="margin-top:6px">Address</div><div class="keyBox">' + esc(feedURL()) + '</div>' +
      '<div class="small muted">Key</div><div class="keyBox">' + esc(F.key || '—') + '</div><div class="btnRow"><button class="btn btn-sec btn-sm" data-act="copyVal" data-v="' + esc(F.key || '') + '"' + (F.key ? '' : ' disabled') + '>' + ic('copy', 15) + 'Copy the key</button>' +
      '<button class="btn btn-ghost" data-act="newFeedKey">' + ic('key', 15) + 'Make a new key</button></div><p class="small muted">A new key only if the old one got out — CADANCe and the calendar then need the new one.</p></details>' +
      '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="feedNow">' + ic('refresh', 15) + 'Update it now</button></div>');
}
Object.assign(ACT, {
  async feedNow(t) { busyBtn(t, true, 'Updating…'); try { await syncFeed(true); toast('The feed is up to date'); } catch (e) { toast(errText(e), { bad: true }); } loadFeed(); },
  async newFeedKey() {
    if (!(await confirmBox('Make a new feed key?', 'CADANCe and the office calendar stop showing who’s out until they’re given the new key.', 'Make a new key', true))) return;
    if (await act(async () => { await B.newFeedKey(); await syncFeed(true); }, 'New feed key made')) loadFeed();
  }
});

/* ---------- the policy (handbook §41), with the day a change applies from ---------- */
function polRaw() { const to = S.settings.to || {}; return to.policy && typeof to.policy === 'object' ? to.policy : JSON.parse(JSON.stringify(POLICY)); }
function policyCardHTML() {
  const E = S.polEd || { p: S.pol, from: todayISO() }, P = E.p, to = S.settings.to || {};
  const num = (id, v, step, min, max, w) => '<input type="number" class="inp" id="' + id + '" value="' + esc(String(v)) + '" step="' + step + '" min="' + min + '" max="' + max + '"' + (w ? ' style="max-width:' + w + 'px"' : '') + '>';
  const sel = (id, v, opts) => '<select class="inp" id="' + id + '">' + opts.map(([k, l]) => '<option value="' + k + '"' + (k === v ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>';
  let h = '<div class="card"><div class="cardHd"><h3>Policy</h3><span class="sub">Handbook §41</span></div><div class="cardBd">';
  h += '<div class="grid2"><div class="field"><label for="pDay">Hours in an office day</label>' + num('pDay', P.day, '0.25', '1', '24') + '<div class="hint">A morning or afternoon is half.</div></div>' +
    '<div class="field"><label for="pSick">Sick leave earned a month (h)</label>' + num('pSick', P.sickPerMonth, '0.01', '0', '100') + '</div></div>';
  h += '<div class="flabel">Vacation by years of service</div><div class="tierEd"><span class="h n">Tier</span><span class="h">From (years)</span><span class="h">Earned a month (h)</span><span class="h">Most at once (h)</span><span></span>' +
    P.tiers.map((t, i) => '<span class="n"><span class="tierPill t' + Math.min(i + 1, 6) + '">' + tierName(i + 1) + '</span></span>' +
      '<input type="number" class="inp" data-tier="' + i + '" data-f="from" value="' + esc(String(t.from)) + '" step="1" min="0" max="60"' + (i === 0 ? ' disabled' : '') + ' aria-label="' + tierName(i + 1) + ' from years">' +
      '<input type="number" class="inp" data-tier="' + i + '" data-f="perMonth" value="' + esc(String(t.perMonth)) + '" step="0.01" min="0" max="100" aria-label="' + tierName(i + 1) + ' hours a month">' +
      '<input type="number" class="inp" data-tier="' + i + '" data-f="cap" value="' + esc(String(t.cap)) + '" step="0.5" min="0" max="2000" aria-label="' + tierName(i + 1) + ' most at once">' +
      (i > 0 && P.tiers.length > 1 ? '<button class="iconBtn x" data-act="tierRm" data-i="' + i + '" aria-label="Remove ' + tierName(i + 1) + '">' + ic('x', 16) + '</button>' : '<span class="x"></span>')).join('') + '</div>' +
    (P.tiers.length < 6 ? '<div class="btnRow" style="margin:-6px 0 12px"><button class="btn btn-ghost" data-act="tierAdd">' + ic('plus', 15) + 'Add a tier</button></div>' : '');
  h += '<div class="grid2"><div class="field"><label for="pOrient">Orientation (days after the hire date)</label>' + num('pOrient', P.orientDays, '1', '0', '366') + '<div class="hint">When a person’s record has no end date. Nothing is earned until it ends.</div></div>' +
    '<div class="field"><label for="pPT">Part-time staff</label>' + sel('pPT', P.ptAccrues ? '1' : '0', [['0', 'No paid time off'], ['1', 'Earn like full-time']]) + '</div></div>';
  h += '<div class="grid2"><div class="field"><label for="pYEv">Vacation left on Dec 31</label>' + sel('pYEv', P.yearEnd.vac, [['payout', 'Paid out by Dec 31'], ['lose', 'Not carried over']]) + '</div>' +
    '<div class="field"><label for="pYEs">Sick leave left on Dec 31</label>' + sel('pYEs', P.yearEnd.sick, [['payout', 'Paid out by Dec 31'], ['lose', 'Not carried over']]) + '</div></div>';
  h += '<div class="grid3"><div class="field"><label for="pBer">Bereavement, up to (days)</label>' + num('pBer', P.bereaveDays, '1', '0', '30') + '</div>' +
    '<div class="field"><label for="pNd">Notice: more than (days in a row)</label>' + num('pNd', P.noticeDays, '1', '0', '30') + '</div>' +
    '<div class="field"><label for="pNm">… needs (months ahead)</label>' + num('pNm', P.noticeMonths, '1', '0', '12') + '</div></div>';
  h += '<div class="flabel">Where paid time off comes from</div><div class="routeEd">' + TYPES.map(t => '<span>' + esc(t.l) + '</span>' + sel('pR_' + t.k, P.route[t.k], [['vac', 'Vacation'], ['sick', 'Sick leave'], ['none', 'No balance (paid)']])).join('') + '</div>';
  h += '<div class="field" style="max-width:260px"><label for="pFrom">This applies from</label><input type="date" id="pFrom" value="' + esc(E.from || todayISO()) + '"><div class="hint">Balances before this day stay as the earlier policy made them.</div></div>';
  h += '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="savePolicy">Save</button><button class="btn btn-ghost" data-act="handbookPolicy">Back to the handbook</button></div>';
  const prev = (S.pol.prev || []).slice().reverse();
  if (to.policyFrom || prev.length) h += '<details class="help"><summary>Earlier versions</summary><ul class="helpList small">' + (to.policyFrom ? '<li>This one: from ' + esc(fmtDateLong(to.policyFrom)) + '</li>' : '') +
    prev.map(x => '<li>Until ' + esc(fmtDateLong(x.until)) + ': ' + esc(policySummary(x.p)) + '</li>').join('') + '</ul></details>';
  return h + '</div></div>';
}
function policySummary(p) { return 'tiers ' + p.tiers.map(t => (t.from ? t.from + 'y ' : '') + hrs(t.perMonth) + ' h/mo').join(', ') + '; sick ' + hrs(p.sickPerMonth) + ' h/mo; ' + hrs(p.day) + ' h days'; }
function readTiers() { return $$('[data-tier]').reduce((a, el) => { const i = Number(el.dataset.tier); a[i] = a[i] || {}; a[i][el.dataset.f] = Number(el.value); return a; }, []); }
function readPolicy() {
  const n = id => Number((($('#' + id) || {}).value || '').trim()), v = id => (($('#' + id) || {}).value || '');
  const tiers = readTiers().map((t, i) => ({ from: i === 0 ? 0 : t.from, perMonth: round2(t.perMonth), cap: round2(t.cap) }));
  const route = {}; TYPES.forEach(t => { route[t.k] = v('pR_' + t.k); });
  return { day: n('pDay'), tiers, sickPerMonth: round2(n('pSick')), orientDays: n('pOrient'), ptAccrues: v('pPT') === '1', yearEnd: { vac: v('pYEv'), sick: v('pYEs') },
    bereaveDays: n('pBer'), noticeDays: n('pNd'), noticeMonths: n('pNm'), route };
}
function policyProblem(p) {
  const ok = (x, lo, hi) => typeof x === 'number' && isFinite(x) && x >= lo && x <= hi;
  if (!ok(p.day, 1, 24)) return 'Hours in an office day: 1 to 24.';
  if (!p.tiers.length || !p.tiers.every((t, i) => ok(t.from, 0, 60) && Number.isInteger(t.from) && ok(t.perMonth, 0, 100) && ok(t.cap, 0, 2000) && (i === 0 || t.from > p.tiers[i - 1].from))) return 'Each tier needs whole years more than the one before, hours a month (0–100) and a most-at-once (0–2000).';
  if (!ok(p.sickPerMonth, 0, 100)) return 'Sick leave a month: 0 to 100 hours.';
  if (!ok(p.orientDays, 0, 366) || !Number.isInteger(p.orientDays)) return 'Orientation: 0 to 366 days.';
  if (!ok(p.bereaveDays, 0, 30) || !ok(p.noticeDays, 0, 30) || !ok(p.noticeMonths, 0, 12)) return 'Check the bereavement and notice numbers.';
  return '';
}
/* a new version of the policy from day `from`: the one in force until then is kept for the days before */
async function savePolicyFrom(p, from) {
  const to = S.settings.to || {}, curFrom = isISO(to.policyFrom) ? to.policyFrom : '';
  const old = (Array.isArray(to.policyOld) ? to.policyOld : []).filter(x => x && isISO(x.until) && x.until < addDays(from, -1));
  if (curFrom < from) old.push({ until: addDays(from, -1), policy: polRaw() });
  await B.saveSettings({ to: { policy: p, policyFrom: from, policyOld: old } });
}
Object.assign(ACT, {
  tierAdd() { const p = readPolicy(), last = p.tiers[p.tiers.length - 1] || { from: 0, perMonth: 0, cap: 0 }; p.tiers.push({ from: (last.from || 0) + 5, perMonth: last.perMonth, cap: last.cap }); S.polEd = { p, from: ($('#pFrom') || {}).value }; paintSettings(); },
  tierRm(t) { const p = readPolicy(), k = Number(t.dataset.i); p.tiers = p.tiers.filter((x, i) => i !== k); S.polEd = { p, from: ($('#pFrom') || {}).value }; paintSettings(); },
  async savePolicy() {
    const p = readPolicy(), bad = policyProblem(p), from = ($('#pFrom') || {}).value; if (bad) { toast(bad, { bad: true }); return; }
    if (!isISO(from)) { toast('Pick the day it applies from.', { bad: true }); return; }
    const back = from < todayISO();
    if (!(await confirmBox('Save the policy?', 'It applies from ' + fmtDateLong(from) + '.' + (back ? ' That’s in the past, so balances from then on are worked out again under it.' : ' Balances before then don’t change.'), 'Save'))) return;
    if (await act(() => savePolicyFrom(p, from), 'Policy saved')) { S.polEd = null; setTimeout(paintSettings, 300); }
  },
  async handbookPolicy() {
    const from = ($('#pFrom') || {}).value; if (!isISO(from)) { toast('Pick the day it applies from.', { bad: true }); return; }
    if (!(await confirmBox('Back to the handbook?', 'Bronze to start, Silver at 2 years, Gold at 5 (' + POLICY.tiers.slice(0, 3).map(t => hrs(t.perMonth)).join(', ') + ' h a month), Platinum at 10 and Double Platinum at 15 (as Gold), sick leave ' + hrs(POLICY.sickPerMonth) + ' h a month, 90 days’ orientation, no paid time off for part-time staff, balances paid out at year end — from ' + fmtDateLong(from) + '.', 'Use the handbook'))) return;
    if (await act(() => savePolicyFrom(JSON.parse(JSON.stringify(POLICY)), from), 'Back to the handbook')) { S.polEd = null; setTimeout(paintSettings, 300); }
  }
});

/* ---------- scrubs: the yearly allowance, the deadline, and where approved orders are emailed ---------- */
async function loadScrubsMail() { try { S.scrubsMail = await B.scrubsMailState(); } catch (e) { S.scrubsMail = { err: errText(e) }; } const el = $('#scrubsBox'); if (el) el.innerHTML = scrubsSetBodyHTML(); }
function scrubsSetCardHTML() { return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Scrubs</h3><span class="sub">A yearly allowance, approved like time off</span></div><div class="cardBd" id="scrubsBox">' + scrubsSetBodyHTML() + '</div></div>'; }
function scrubsSetBodyHTML() {
  const sc = S.scrubs, M = S.scrubsMail, ex = scrubsMail('Riley', [{ color: 'navy', piece: 'set', size: 'M', petite: true }, { color: 'teal', piece: 'top', size: 'M', petite: false }], 'Dr. A');
  const st = !M ? '<span class="muted">Checking…</span>' : M.err ? '<span class="muted">' + esc(M.err) + '</span>'
    : !M.to ? '<span class="sug">Off — no address</span>'
    : !M.on ? '<span class="sug amber">Waiting — NLO Cases’ email robot isn’t sending notices</span>'
    : M.ver < 3 ? '<span class="sug amber">Waiting — the email robot needs its new script</span>'
    : !M.keyOk ? '<span class="sug amber">Waiting — NLO Cases hasn’t picked up the robot’s new key</span>'
    : !M.fresh ? '<span class="sug amber">Waiting — the email robot hasn’t checked in lately</span>' : '<span class="sug mint">' + ic('done', 13) + 'On — emailed to ' + esc(M.to) + '</span>';
  return '<div class="grid2"><div class="field"><label for="scPer">Pairs a year</label><input type="number" class="inp" id="scPer" min="0" max="10" step="1" value="' + sc.perYear + '"></div>' +
    '<div class="field"><label for="scBy">Ask by (December)</label><input type="number" class="inp" id="scBy" min="1" max="31" step="1" value="' + sc.byDay + '"><div class="hint">Closed after that until January 1. What’s not asked for doesn’t carry over.</div></div></div>' +
    '<div class="field"><label for="scTo">Approved orders are emailed to</label><input type="email" class="inp" id="scTo" maxlength="120" value="' + esc(M && !M.err ? M.to : '') + '" placeholder="' + esc(!M ? 'Loading…' : M.err ? 'Couldn’t be read just now' : SCRUBS.to) + '"' + (M && !M.err ? '' : ' disabled') + '><div class="hint">Blank: no email.</div></div>' +
    '<div class="kvRow"><span>Order emails</span>' + st + '</div>' +
    (M && !M.err && M.to && !M.on ? '<p class="small muted">They go out through NLO Cases’ email robot (the one that sends the front-desk emails). Turn its notices on in NLO Cases → Team &amp; security → Email updates.</p>' : '') +
    (M && !M.err && M.to && M.on && M.ver < 3 ? '<p class="small muted">The robot has script v' + esc(String(M.ver || 1)) + '; scrubs orders need v3. In NLO Cases → Team &amp; security → Email updates, press <b>Get the script</b>, paste it over the robot’s script in its Apps Script project, save, and run <b>setup</b>. Until then approved orders aren’t emailed (the app says so).</p>' : '') +
    (M && !M.err && M.to && M.on && M.ver >= 3 && !M.keyOk ? '<p class="small muted">The robot was set up again, so it has a new key. Open NLO Cases → Team &amp; security once and it picks the key up by itself. Until then approved orders aren’t emailed (the app says so).</p>' : '') +
    (M && !M.err && M.to && M.on && M.ver >= 3 && M.keyOk && !M.fresh ? '<p class="small muted">The robot hasn’t checked in for over 40 minutes. Look at NLO Cases → Team &amp; security → Email updates. Until it checks in again, approved orders aren’t emailed (the app says so).</p>' : '') +
    '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="saveScrubs">Save</button></div>' +
    '<details class="help"><summary>What the order email says</summary><div class="txt" style="margin-top:6px">' + esc(ex.subject + '\n\n' + ex.text) + '</div><p class="small muted" style="margin-top:6px">Who and what to order — never the reason.</p></details>';
}
ACT.saveScrubs = async () => {
  const per = Number(($('#scPer') || {}).value), by = Number(($('#scBy') || {}).value), to = (($('#scTo') || {}).value || '').trim();
  if (!Number.isInteger(per) || per < 0 || per > 10) { toast('Pairs a year: 0 to 10.', { bad: true }); return; }
  if (!Number.isInteger(by) || by < 1 || by > 31) { toast('Ask by: a day in December (1 to 31).', { bad: true }); return; }
  if (to && !/^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(to)) { toast('That email address doesn’t look right.', { bad: true }); return; }
  // the address is only written once it's known (while it loads, or if it couldn't be read, the field is off and left as it is)
  const was = S.scrubsMail && !S.scrubsMail.err ? S.scrubsMail.to : null;
  if (await act(async () => { await B.saveSettings({ to: { scrubs: { perYear: per, byDay: by } } }); if (was !== null && to !== was) await B.setScrubsMail(to); }, 'Saved')) loadScrubsMail();
};

/* ---------- blackouts ---------- */
function blackoutsCardHTML() {
  const L = S.blackouts, kinds = k => '<div class="kinds">' + TYPES.map(t => '<label><input type="checkbox" data-bk="' + t.k + '"' + (k.includes(t.k) ? ' checked' : '') + '> ' + esc(t.l) + '</label>').join('') + '</div>';
  return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Blackouts</h3><span class="sub">No requests for these days</span></div><div class="cardBd">' +
    (L.length ? L.map((b, i) => '<div class="leRow"><div class="grow"><b>' + esc(b.label) + '</b><div class="small muted">' + esc(blackoutText(b)) + ' · ' + esc(b.types.map(typeLabel).join(', ')) + '</div></div><button class="iconBtn" data-act="rmBlk" data-i="' + i + '" aria-label="Remove ' + esc(b.label) + '">' + ic('x', 16) + '</button></div>').join('') : '<div class="small muted">None.</div>') +
    '<div class="addRow"><div class="field"><label for="bkLabel">Name</label><input id="bkLabel" class="inp" maxlength="60" placeholder="e.g. Spring break"></div><div class="field"><label for="bkFrom">From</label><input type="date" id="bkFrom" class="inp"></div><div class="field"><label for="bkTo">To</label><input type="date" id="bkTo" class="inp"></div>' +
    '<button class="btn btn-sec btn-sm" data-act="addBlk">' + ic('plus', 15) + 'Add</button></div>' + kinds(['vac', 'personal', 'other']) +
    '<p class="small muted" style="margin-top:10px">Staff can’t send requests of the ticked kinds for those days; the people who approve can still record time off in them. Sick leave and emergencies are never blocked unless you tick them.</p>' +
    (!L.some(b => b.id === 'jan') || !L.some(b => b.id === 'thx') ? '<div class="btnRow"><button class="btn btn-ghost" data-act="usualBlk">Add back all of January and Thanksgiving week (every year)</button></div>' : '') + '</div></div>';
}
Object.assign(ACT, {
  async addBlk() {
    const label = ($('#bkLabel').value || '').trim().slice(0, 60), from = $('#bkFrom').value, to = $('#bkTo').value || from, types = $$('[data-bk]').filter(x => x.checked).map(x => x.dataset.bk);
    if (!label) { toast('Give it a name.', { bad: true }); return; }
    if (!isISO(from) || !isISO(to) || to < from || daysBetween(from, to) > 366) { toast('Pick the first and last day.', { bad: true }); return; }
    if (!types.length) { toast('Tick at least one kind of time off.', { bad: true }); return; }
    const list = S.blackouts.concat([{ id: 'b' + uid8(), label, kind: 'dates', from, to, types }]);
    if (await act(() => B.saveSettings({ to: { blackouts: list } }), 'Blackout added')) setTimeout(paintSettings, 300);
  },
  async rmBlk(t) {
    const b = S.blackouts[Number(t.dataset.i)]; if (!b) return;
    if (!(await confirmBox('Remove “' + b.label + '”?', 'Staff can send requests for those days again.', 'Remove', true))) return;
    if (await act(() => B.saveSettings({ to: { blackouts: S.blackouts.filter(x => x !== b) } }), 'Removed')) setTimeout(paintSettings, 300);
  },
  async usualBlk() {
    const list = S.blackouts.slice(); BLACKOUTS.forEach(b => { if (!list.some(x => x.id === b.id)) list.push(JSON.parse(JSON.stringify(b))); });
    if (await act(() => B.saveSettings({ to: { blackouts: list } }), 'Added')) setTimeout(paintSettings, 300);
  }
});

/* ---------- office closures (besides the handbook's holidays) ---------- */
function closuresCardHTML() {
  const t = todayISO(), y = Number(t.slice(0, 4)), list = Array.from(S.closed.custom.entries()).map(([date, label]) => ({ date, label })).sort((a, b) => a.date < b.date ? -1 : 1);
  const up = list.filter(c => c.date >= t), past = list.filter(c => c.date < t);
  const row = c => '<div class="leRow"><div class="grow"><b>' + esc(fmtDayY(c.date)) + '</b> <span class="small muted">' + esc(c.label) + '</span></div><button class="iconBtn" data-act="rmClos" data-d="' + esc(c.date) + '" aria-label="Remove ' + esc(fmtDayY(c.date)) + '">' + ic('x', 16) + '</button></div>';
  return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Office closed</h3><span class="sub">Closed days never count as time off</span></div><div class="cardBd">' +
    (up.length ? up.map(row).join('') : '<div class="small muted">No closures of your own coming up.</div>') +
    (past.length ? '<details class="help"><summary>Earlier (' + past.length + ')</summary>' + past.slice().reverse().map(row).join('') + '</details>' : '') +
    '<div class="addRow"><div class="field"><label for="clDate">Day</label><input type="date" id="clDate" class="inp"></div><div class="field" style="grid-column:span 2"><label for="clLabel">Why</label><input id="clLabel" class="inp" maxlength="60" placeholder="e.g. Staff training"></div>' +
    '<button class="btn btn-sec btn-sm" data-act="addClos">' + ic('plus', 15) + 'Add</button></div>' +
    '<details class="help"><summary>The handbook’s holidays (' + y + ')</summary><ul class="helpList small">' + fixedHolidays(y).map(h => '<li>' + esc(fmtDayY(h.date)) + ' — ' + esc(h.label) + '</li>').join('') + '</ul></details>' +
    '<p class="small muted" style="margin-top:8px">A closure counts for everyone, time off already approved included — those hours come back to the balance. CADANCe and the office calendar show it too.</p></div></div>';
}
Object.assign(ACT, {
  async addClos() {
    const date = $('#clDate').value, label = ($('#clLabel').value || '').trim().slice(0, 60) || 'Office closed';
    if (!isISO(date)) { toast('Pick the day.', { bad: true }); return; }
    if (fixedHolidays(Number(date.slice(0, 4))).some(h => h.date === date)) { toast('That’s a handbook holiday already.', { bad: true }); return; }
    if (weekday(date) < 1 || weekday(date) > 4) { toast('The office isn’t open that day anyway (it’s open Monday to Thursday).', { bad: true }); return; }
    const list = Array.from(S.closed.custom.entries()).map(([d, l]) => ({ date: d, label: l })).filter(c => c.date !== date).concat([{ date, label }]).sort((a, b) => a.date < b.date ? -1 : 1);
    if (await act(() => B.saveSettings({ to: { closures: list } }), 'Added — ' + fmtDayY(date) + ' is closed')) { setTimeout(paintSettings, 300); syncFeed(true).catch(() => { }); }
  },
  async rmClos(t) {
    const date = t.dataset.d; if (!(await confirmBox('Open on ' + fmtDayY(date) + '?', 'It counts as an office day again — for time off already approved too.', 'Remove the closure', true))) return;
    const list = Array.from(S.closed.custom.entries()).map(([d, l]) => ({ date: d, label: l })).filter(c => c.date !== date);
    if (await act(() => B.saveSettings({ to: { closures: list } }), 'Removed')) { setTimeout(paintSettings, 300); syncFeed(true).catch(() => { }); }
  }
});

/* ---------- the front-desk emails ---------- */
async function loadDesk() { try { S.desk = await B.deskStatus(); } catch (e) { S.desk = { err: errText(e) }; } const el = $('#deskBox'); if (el) el.innerHTML = deskBodyHTML(); }
function deskCardHTML() { return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Front-desk emails</h3></div><div class="cardBd" id="deskBox">' + deskBodyHTML() + '</div></div>'; }
function deskBodyHTML() {
  const on = (S.settings.to || {}).frontDesk !== false, D = S.desk;
  const robot = !D ? '<span class="muted">Checking…</span>' : D.err ? '<span class="muted">' + esc(D.err) + '</span>' : D.on ? '<span class="sug mint">' + ic('done', 13) + 'On — sends to ' + esc(D.to || 'the front desk') + '</span>' : '<span class="sug amber">Off</span>';
  return '<div class="accessRow" style="padding-top:0"><div class="grow"><b>Email the front desk</b><div class="small muted">When time off is approved (block the schedule) and when approved time off is cancelled (take the block off)</div></div>' +
    '<button type="button" class="sw" role="switch" aria-checked="' + on + '" aria-label="Email the front desk" data-act="toggleDesk"></button></div>' +
    '<div class="kvRow"><span>NLO Cases’ email robot</span>' + robot + '</div>' +
    (D && !D.err && !D.on ? '<p class="small muted">The emails go out through NLO Cases’ email robot (the one that sends the case emails). Turn its notices on in NLO Cases → Settings → Email.</p>' : '') +
    '<details class="help"><summary>What the email says</summary><div class="txt" style="margin-top:6px">Schedule block needed: Riley, Nov 2 – 4\n\nPlease block the schedule for Riley on Mon, Nov 2 to Wed, Nov 4 (full days). Their time off was approved.</div><p class="small muted" style="margin-top:6px">Only the name, the days and morning/afternoon — never the kind of time off or notes.</p></details>';
}
ACT.toggleDesk = async () => {
  const on = (S.settings.to || {}).frontDesk !== false;
  if (await act(() => B.saveSettings({ to: { frontDesk: !on } }), on ? 'Front-desk emails off' : 'Front-desk emails on')) setTimeout(() => { const el = $('#deskBox'); if (el) el.innerHTML = deskBodyHTML(); }, 300);
};

/* ---------- logins and the database rules ---------- */
function securityCardHTML() {
  return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Team &amp; security</h3></div><div class="cardBd small">' +
    '<p>Logins, passwords, the office key and the recovery code are shared with NLO Cases and managed there (Team &amp; security) — the people here are NLO Cases’ team, which follows Staff Hub. Time Off locks after ' + esc(String(S.settings.idleMin || 10)) + ' minutes without activity, like NLO Cases.</p>' +
    '<div class="btnRow"><a class="btn btn-sec btn-sm" href="nlo-cases.html">' + ic('next', 15) + 'Open NLO Cases</a></div>' +
    '<details class="help"><summary>Database rules</summary><p class="small muted" style="margin:8px 0">Only needed if Time Off ever says the database needs its updated rules. They’re the office’s whole rules file (NLO Cases, NLO Leads, A/R and Time Off).</p>' +
    '<ol class="steps small"><li>Press <b>Copy the rules</b>.</li><li>Open the <b>Firebase console</b> → <b>Firestore Database</b> → <b>Rules</b>.</li><li>Select everything there, paste, and press <b>Publish</b>.</li></ol>' +
    '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="copyRules">' + ic('copy', 15) + 'Copy the rules</button><a class="btn btn-ghost" href="https://console.firebase.google.com/project/nlo-cases/firestore" target="_blank" rel="noopener noreferrer">Open the Firebase console</a></div></details></div></div>';
}

/* =====================================================================
   A person's HR record (Dr. A): hire date, orientation, full/part-time,
   department, last day, opening balance, notes; adjustments
   ===================================================================== */
function balLine(sid, rec) {
  const L = rec ? ledger(rec, reqsOf(sid), S.pol, S.closed, todayISO()) : null;
  return L ? { vac: L.vac, sick: L.sick } : null;
}
Object.assign(ACT, {
  editHR(t) {
    const sid = t.dataset.sid, p = S.hrRecs.get(sid) || {}, o = p.open || {}, name = staffName(sid), depts = Array.from(new Set(Array.from(S.hrRecs.values()).map(x => x.dept).filter(Boolean))).sort();
    // the start date, full-/part-time and last day Staff Hub gives are its — changed there, shown here. A record that's here keeps its
    // own until Dr. A brings Staff Hub's in (Settings → Staff Hub); a new one starts from Staff Hub's.
    const has = S.hrRecs.has(sid), lk = shLock(sid, S.hrRecs.get(sid)), L = k => !!(lk && k in lk.f), V = k => has ? (k === 'type' ? normType(p.type) : p[k] || '') : L(k) ? lk.f[k] : '';
    const shHint = (k, word) => {
      if (!L(k)) return '';
      const sv = lk.f[k], diff = has && lk.live && sv !== V(k), say = k === 'type' ? empWord(sv, lk.f.emp) : sv ? fmtDate(sv) : 'on staff, no last day';
      return '<div class="hint">' + (diff && k === 'left' && !sv ? 'Staff Hub has them on staff, with no last day — if they’ve left, end their employment there' : diff ? 'Staff Hub says ' + esc(say) + ' — bring it in under Settings → Staff Hub' : k === 'left' && !sv ? 'Staff Hub has them on staff — a last day is set there' : 'From Staff Hub' + (word || '') + ' — change it there') + '</div>';
    };
    const typeSel = L('type') ? '<select id="hrType" disabled><option value="' + V('type') + '" selected>' + esc(empText(has ? p : { type: lk.f.type, emp: lk.f.emp })) + '</option></select>' + shHint('type')
      : '<select id="hrType">' + [['FT', 'Full-time'], ['PT', 'Part-time'], ['SAL', 'Salary (no balance)']].map(([v, l]) => '<option value="' + v + '"' + (normType(p.type) === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>';
    openModal('<h3>' + esc(name) + '</h3><div class="lsub">HR record — you and the people who approve see it; ' + esc(firstName(name)) + ' sees their own hire date and balances, not the notes</div>' +
      '<div class="grid2"><div class="field"><label for="hrHire">Hire date</label><input type="date" id="hrHire" value="' + esc(V('hire')) + '"' + (L('hire') ? ' disabled' : '') + '>' + shHint('hire', ' (its start date)') + '</div>' +
      '<div class="field"><label for="hrOrient">Orientation ends <span class="opt">(blank: ' + S.pol.orientDays + ' days)</span></label><input type="date" id="hrOrient" value="' + esc(p.orient || '') + '"></div></div>' +
      '<div class="grid2"><div class="field"><label for="hrType">Employment</label>' + typeSel + '</div>' +
      '<div class="field"><label for="hrDept">Department</label><input id="hrDept" maxlength="40" list="deptList" value="' + esc(p.dept || '') + '"><datalist id="deptList">' + depts.map(d => '<option value="' + esc(d) + '">').join('') + '</datalist><div class="hint">Two people in one department off together get a warning.</div></div></div>' +
      '<div class="grid2"><div class="field"><label for="hrLeft">Last day <span class="opt">(if they’ve left)</span></label><input type="date" id="hrLeft" value="' + esc(V('left')) + '"' + (L('left') ? ' disabled' : '') + '>' + shHint('left') + '</div><div></div></div>' +
      '<div class="flabel" style="margin-top:4px">Opening balance</div><div class="grid3"><div class="field"><label for="hrAsOf">As of the end of</label><input type="date" id="hrAsOf" value="' + esc(o.asOf || '') + '"></div>' +
      '<div class="field"><label for="hrVac">Vacation (h)</label><input type="number" step="0.01" min="0" max="2000" inputmode="decimal" id="hrVac" value="' + esc(o.asOf ? String(o.vac || 0) : '') + '"></div>' +
      '<div class="field"><label for="hrSick">Sick (h)</label><input type="number" step="0.01" min="0" max="2000" inputmode="decimal" id="hrSick" value="' + esc(o.asOf ? String(o.sick || 0) : '') + '"></div></div>' +
      '<div class="field"><label for="hrOpenNote">About it <span class="opt">(shows on the statement)</span></label><input id="hrOpenNote" maxlength="240" value="' + esc(o.note || '') + '"></div>' +
      '<p class="small muted" style="margin:-6px 0 12px">Blank: from 0 on the hire date. Approved time off on or before the “as of” day is taken to be in it already.</p>' +
      '<div class="flabel" style="margin-top:4px">Enrolled in</div><div class="chkList" style="margin-bottom:12px"><label><input type="checkbox" id="hrCel"' + ((p.ben || {}).celebrate ? ' checked' : '') + '><span>Celebrate Primary Care</span></label>' +
      '<label><input type="checkbox" id="hrK401"' + ((p.ben || {}).k401 ? ' checked' : '') + '><span>The 401(k)</span></label></div>' +
      '<div class="field"><label for="hrNotes">Notes <span class="opt">(you and the people who approve)</span></label><textarea id="hrNotes" maxlength="600">' + esc(p.notes || '') + '</textarea></div>' +
      '<div class="mFt"><button class="btn btn-sec btn-sm" data-act="closeModal">Cancel</button><button class="btn btn-pri btn-sm" id="hrSave">Save</button></div>', true);
    $('#hrSave').onclick = async () => {
      const g = id => ($('#' + id).value || '').trim(), hire = L('hire') ? V('hire') : g('hrHire'), orient = g('hrOrient'), left = L('left') ? V('left') : g('hrLeft'), asOf = g('hrAsOf'), vs = g('hrVac'), ss = g('hrSick');
      if (!isISO(hire)) return toast(L('hire') ? 'Bring in Staff Hub’s start date for ' + firstName(name) + ' first (Settings → Staff Hub).' : 'Add the hire date.', { bad: true });
      if (orient && (!isISO(orient) || orient < hire)) return toast('Orientation ends on or after the hire date.', { bad: true });
      if (left && (!isISO(left) || left < hire)) return toast('The last day is on or after the hire date.', { bad: true });
      let open = null;
      if (asOf || vs || ss) {
        const v = Number(vs || 0), s = Number(ss || 0);
        if (!isISO(asOf)) return toast('Pick the day the opening balance is as of.', { bad: true });
        if (!(v >= 0 && v <= 2000) || !(s >= 0 && s <= 2000)) return toast('Balances are 0 to 2000 hours.', { bad: true });
        open = Object.assign({}, p.open && p.open.from ? { from: p.open.from } : {}, { asOf, vac: round2(v), sick: round2(s), note: g('hrOpenNote').slice(0, 240) });
      }
      const next = Object.assign({}, p, { hire, orient, left, type: L('type') ? V('type') : normType($('#hrType').value), dept: g('hrDept').slice(0, 40), notes: ($('#hrNotes').value || '').trim().slice(0, 600), open });
      const before = S.hrRecs.has(sid) ? balLine(sid, p) : null, after = balLine(sid, next);
      // read before asking: the question replaces this form
      const ben = { celebrate: !!$('#hrCel').checked, k401: !!$('#hrK401').checked };
      if (before && normType(next.type) === 'SAL' && normType(p.type) !== 'SAL') {
        if (!(await confirmBox('Put ' + name + ' on salary?', 'No vacation or sick balance from here on, and nothing more is earned' + (before.vac || before.sick ? ' — ' + hrs(before.vac) + ' h vacation and ' + hrs(before.sick) + ' h sick leave close, not paid out' : '') + '. Their time off is still asked for here and shows on Who’s out.', 'Put on salary'))) return;
      } else if (before && after && (before.vac !== after.vac || before.sick !== after.sick) &&
        !(await confirmBox('Change ' + firstName(name) + '’s balance?', 'Vacation ' + hrs(before.vac) + ' → ' + hrs(after.vac) + ' h, sick ' + hrs(before.sick) + ' → ' + hrs(after.sick) + ' h today.', 'Save'))) return;
      const btn = $('#hrSave'); if (btn) busyBtn(btn, true, 'Saving…');
      try {
        const known = !!(SH.data && shAvailable()); // Staff Hub read on this computer: whether they're on it is known
        await B.putHR(sid, d => {
          // Staff Hub's fields aren't written from here: the record keeps what it has (a change brought in meanwhile included)
          const own = { orient: next.orient, dept: next.dept, notes: next.notes, ben }; SH_FIELDS.forEach(k => { if (!L(k)) own[k] = next[k]; });
          Object.assign(d, own); if (next.open) d.open = next.open; else delete d.open; if (!Array.isArray(d.adj)) d.adj = [];
          if (!has && lk && lk.live) shApply(d, lk.f, lk.pid); // a new record, from Staff Hub
          else if (known && !lk) { delete d.sh; delete d.emp; } // not on Staff Hub: what's typed here is the record's own
        }, has ? 'edit' : 'create');
        closeModal(); toast('Saved');
      } catch (e) { if (btn) busyBtn(btn, false); toast(errText(e), { bad: true }); }
    };
  },
  addAdj(t) {
    const sid = t.dataset.sid, p = S.hrRecs.get(sid); if (!p) return;
    const name = staffName(sid), floor = p.open && p.open.asOf ? p.open.asOf : '';
    openModal('<h3>Adjust ' + esc(firstName(name)) + '’s balance</h3><div class="lsub">It shows on their statement with your reason</div>' +
      '<div class="grid2"><div class="field"><label for="adDate">On</label><input type="date" id="adDate" value="' + esc(todayISO()) + '"' + (floor ? ' min="' + esc(addDays(floor, 1)) + '"' : '') + '></div>' +
      '<div class="field"><span class="flabel">Balance</span><div class="seg" role="group" style="display:flex"><button type="button" data-ad="vac" aria-pressed="true" style="flex:1;justify-content:center">Vacation</button><button type="button" data-ad="sick" aria-pressed="false" style="flex:1;justify-content:center">Sick leave</button></div></div></div>' +
      '<div class="field"><label for="adH">Hours</label><input type="number" id="adH" step="0.01" min="-2000" max="2000" inputmode="decimal" placeholder="e.g. 8.5 to add, -8.5 to take off"><div class="hint" id="adPrev"></div></div>' +
      '<div class="field"><label for="adNote">Reason</label><input id="adNote" maxlength="200" placeholder="e.g. Worked the Saturday event"></div>' +
      '<div class="mFt"><button class="btn btn-sec btn-sm" data-act="closeModal">Cancel</button><button class="btn btn-pri btn-sm" id="adSave">Add it</button></div>');
    let b = 'vac';
    const prev = () => { const h = Number($('#adH').value), date = $('#adDate').value, el = $('#adPrev'); if (!el) return; if (!h || !isISO(date)) { el.textContent = ''; return; } const L = ledger(p, reqsOf(sid), S.pol, S.closed, date > todayISO() ? date : todayISO()), L2 = ledger(Object.assign({}, p, { adj: (p.adj || []).concat([{ id: 'x', date, b, h }]) }), reqsOf(sid), S.pol, S.closed, date > todayISO() ? date : todayISO()); el.textContent = (b === 'vac' ? 'Vacation ' : 'Sick leave ') + hrs(L[b]) + ' → ' + hrs(L2[b]) + ' h' + (date > todayISO() ? ' on ' + fmtDate(date) : ' now'); };
    $$('[data-ad]').forEach(x => x.onclick = () => { b = x.dataset.ad; $$('[data-ad]').forEach(y => y.setAttribute('aria-pressed', String(y === x))); prev(); });
    $('#adH').oninput = prev; $('#adDate').onchange = prev;
    $('#adSave').onclick = async () => {
      const date = $('#adDate').value, h = round2(Number($('#adH').value)), note = ($('#adNote').value || '').trim().slice(0, 200);
      if (!isISO(date)) return toast('Pick the day.', { bad: true });
      if (floor && date <= floor) return toast('Pick a day after ' + fmtDate(floor) + ' (the opening balance is as of then).', { bad: true });
      if (!h || !(Math.abs(h) <= 2000)) return toast('Type the hours: more than 0 to add, less than 0 to take off.', { bad: true });
      if (!note) return toast('Add the reason — it shows on the statement.', { bad: true });
      const btn = $('#adSave'); busyBtn(btn, true, 'Saving…');
      try { await B.putHR(sid, d => { d.adj = (Array.isArray(d.adj) ? d.adj : []).concat([{ id: uid8(), date, b, h, note, by: meSid(), at: Date.now() }]); }, 'adjust'); closeModal(); toast('Adjustment added'); }
      catch (e) { busyBtn(btn, false); toast(errText(e), { bad: true }); }
    };
  },
  async rmAdj(t) {
    const sid = t.dataset.sid, id = t.dataset.id, p = S.hrRecs.get(sid), a = p && (p.adj || []).find(x => x.id === id); if (!a) return;
    if (!(await confirmBox('Remove this adjustment?', (a.h > 0 ? '+' : '−') + hrs(Math.abs(a.h)) + ' h ' + (a.b === 'sick' ? 'sick leave' : 'vacation') + ' on ' + fmtDate(a.date) + ' — ' + (a.note || ''), 'Remove', true))) return;
    act(() => B.putHR(sid, d => { d.adj = (d.adj || []).filter(x => x.id !== id); }, 'unadjust'), 'Removed');
  }
});

/* ---------- my account ---------- */
function viewAccount() {
  const me = B.me || {}, st = S.st === 'hr' ? (isOwner() ? 'Owner' : 'Approves time off') : S.st === 'staff' ? 'Staff' : '—';
  return '<div class="card" style="max-width:520px"><div class="cardHd">' + avatarHTML(meSid(), me.name, true) + '<div><h3>' + esc(me.name || '') + '</h3><div class="sub">' + (me.role === 'owner' ? 'Owner · email login' : 'Username: ' + esc(me.username || me.staffId || '')) + '</div></div></div>' +
    '<div class="cardBd"><div class="kvRow" style="margin-bottom:8px"><span>Time Off</span><b>' + esc(st) + '</b></div>' +
    '<form id="pwForm"><div class="sec" style="margin-top:6px"><h5>Change password</h5><p class="small muted" style="margin-bottom:10px">Same login as NLO Cases — the new password works there too.</p></div>' +
    '<div class="field"><label for="pwCur">Current password</label><input type="password" id="pwCur" autocomplete="current-password" required></div>' +
    '<div class="field"><label for="pwN1">New password</label><input type="password" id="pwN1" autocomplete="new-password" minlength="8" required></div>' +
    '<div class="field"><label for="pwN2">Type it again</label><input type="password" id="pwN2" autocomplete="new-password" minlength="8" required></div>' +
    '<button class="btn btn-pri" type="submit">Change password</button></form></div></div>';
}
document.addEventListener('submit', async e => {
  if (e.target.id !== 'pwForm') return; e.preventDefault();
  const cur = $('#pwCur').value, a = $('#pwN1').value, b = $('#pwN2').value;
  if (a.length < 8) return toast('Use at least 8 characters.', { bad: true });
  if (a !== b) return toast('The two new passwords don’t match.', { bad: true });
  if (a === cur) return toast('Pick a password different from the current one.', { bad: true });
  const btn = $('#pwForm button[type=submit]'); busyBtn(btn, true, 'Changing…');
  try { await B.changePassword(cur, a); toast('Password changed'); e.target.reset(); }
  catch (x) { toast(/invalid-credential|wrong-password/.test(x.code || '') ? 'Current password is wrong.' : errText(x), { bad: true }); }
  busyBtn(btn, false);
});
