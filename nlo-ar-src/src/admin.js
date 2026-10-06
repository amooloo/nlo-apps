/* =====================================================================
   Settings (owner): who can use A/R, the A/R key, the numbers the lists
   use, recent activity. My account (password — shared with NLO Cases).
   ===================================================================== */
function viewSettings() {
  return '<div class="adminGrid"><div>' + accessCardHTML() + keyCardHTML() + '</div><div>' + numbersCardHTML() +
    '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Recent activity</h3><span class="sub">Last 7 days</span><span style="flex:1"></span><button class="btn btn-ghost" data-act="loadActivity">' + ic('refresh', 15) + 'Load</button></div><div class="cardBd" id="actBox"><div class="small muted">Who did what on which account. Click Load.</div></div></div>' +
    securityCardHTML() + '</div></div>';
}
function afterSettings() { loadPeople(); } // fresh each time Settings opens (someone may have just chosen their password)
/* everyone in the office, who has A/R, and whether the recovery copy is current (owner only) */
async function loadPeople() {
  try { const p = await B.arPeople(); S.people = Object.assign(p, { at: Date.now() }); }
  catch (e) { S.people = { err: errText(e), at: 0 }; }
  paintAccess();
}
function paintAccess() {
  if (S.view !== 'settings') return;
  const a = $('#accessBox'), k = $('#keyBox');
  if (a) { a.innerHTML = accessListHTML(); paintPhotos(a); }
  if (k) k.innerHTML = keyBodyHTML();
}

/* ---------- who can use A/R ---------- */
function accessCardHTML() {
  return '<div class="card"><div class="cardHd"><h3>Who can use A/R</h3><span class="sub">Patients’ balances — only the people who work them</span></div><div class="cardBd"><div id="accessBox">' + accessListHTML() + '</div></div></div>';
}
function accessListHTML() {
  const P = S.people;
  if (!P) return '<div class="small muted">Loading…</div>';
  if (P.err) return '<div class="lockErr">' + esc(P.err) + '</div><button class="btn btn-sec btn-sm" data-act="reloadPeople">' + ic('refresh', 15) + 'Try again</button>';
  const grants = new Map(P.grants.map(g => [g.uid, g])), busy = !!(S.accessBusy || S.rotating || B.rotating);
  const ms = P.members.filter(m => m.active).sort((a, b) => (a.role === 'owner' ? -1 : 0) - (b.role === 'owner' ? -1 : 0) || String(a.name).localeCompare(String(b.name)));
  let stale = 0;
  const rows = ms.map(m => {
    const owner = m.role === 'owner', g = grants.get(m.uid), on = owner || !!g, ready = !!m.pub && !m.mustSetup;
    const old = g && m.pub && g.pubX !== m.pub.x && !owner; if (old) stale++;
    const sub = owner ? 'Owner — always' : old ? 'Their login was renewed — their key is renewed for them (press Renew if it stays)' : on ? 'Can use A/R' : !ready ? 'Needs to sign in once (and choose a password) before A/R can be turned on' : 'No access';
    return '<div class="accessRow">' + avatarHTML(m.staffId, m.name) + '<div class="grow"><b>' + esc(m.name || m.staffId) + '</b><div class="small muted">' + esc(sub) + '</div></div>' +
      '<button type="button" class="sw" role="switch" aria-checked="' + on + '" aria-label="A/R for ' + esc(m.name || '') + '" data-act="toggleAR" data-uid="' + esc(m.uid) + '"' + (owner || busy || (!on && !ready) ? ' disabled' : '') + '></button></div>';
  }).join('');
  return rows + (stale ? '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="fixGrants">' + ic('refresh', 15) + 'Renew now</button></div>' : '') +
    (S.rotating ? '<div class="small" id="rotMsg" style="margin-top:12px">' + esc(S.rotating.msg) + '</div><div class="prog"><i id="rotBar" style="width:' + S.rotating.pct + '%"></i></div>' : '') +
    '<p class="small muted" style="margin-top:12px">Turning someone on lets them open A/R the next time they sign in. Turning someone off deletes their copy of the A/R key at once and makes a new key for everyone else, so nothing they could have kept opens anything saved from then on. Their login keeps working for NLO Cases and NLO Leads.</p>' +
    '<div class="btnRow"><button class="btn btn-ghost" data-act="newARKey"' + (busy ? ' disabled' : '') + '>' + ic('key', 15) + 'Make a new A/R key now</button></div>' +
    '<p class="small muted">Only needed if an office computer or phone that had A/R open is lost or stolen.</p>';
}
function rotProgress(n, tot) {
  S.rotating = { msg: tot ? 'Sealing everything again under the new key… ' + n + ' of ' + tot : 'Sealing everything again under the new key…', pct: Math.round(10 + 90 * (tot ? n / tot : 1)) };
  const b = $('#rotBar'), m = $('#rotMsg'); if (b) b.style.width = S.rotating.pct + '%'; if (m) m.textContent = S.rotating.msg;
}
function rotDoneMsg(r) { return r && r.failed ? ' — ' + plural(r.failed, 'record') + ' couldn’t be sealed again yet; that’s retried automatically' : ''; }
Object.assign(ACT, {
  reloadPeople() { S.people = null; paintAccess(); loadPeople(); },
  async toggleAR(t) {
    const P = S.people, uid = t.dataset.uid; if (!P || P.err || S.accessBusy || S.rotating || B.rotating) return;
    const m = P.members.find(x => x.uid === uid); if (!m || m.role === 'owner') return;
    const on = P.grants.some(g => g.uid === uid), who = firstName(m.name) || m.staffId;
    if (!on) {
      S.accessBusy = uid; paintAccess();
      try { await B.arGrant(m); toast('A/R turned on for ' + who + ' — they’ll see it the next time they sign in'); }
      catch (e) { toast(errText(e), { bad: true }); }
      S.accessBusy = ''; return loadPeople();
    }
    if (!(await confirmBox('Turn off A/R for ' + (m.name || who) + '?', 'Their copy of the A/R key is deleted at once (if they have A/R open, it locks). Then a new A/R key is made and every report and account note is sealed again under it — it takes a minute; keep this page open until it finishes.', 'Turn off', true))) return;
    S.accessBusy = uid; S.rotating = { msg: 'Making a new A/R key…', pct: 5 }; paintAccess();
    try { const r = await B.arRevoke(uid, rotProgress); toast('A/R turned off for ' + who + rotDoneMsg(r), { ms: 6000 }); }
    catch (e) { toast(errText(e), { bad: true }); }
    S.accessBusy = ''; S.rotating = null; loadPeople();
  },
  async newARKey() {
    if (S.accessBusy || S.rotating || B.rotating) return;
    if (!(await confirmBox('Make a new A/R key?', 'Everyone who has A/R gets a copy of the new key, and every report and account note is sealed again under it. Anything copied off a lost device stops opening new saves. It takes a minute; keep this page open until it finishes.', 'Make a new key'))) return;
    S.accessBusy = 'key'; S.rotating = { msg: 'Making a new A/R key…', pct: 5 }; paintAccess();
    try { const r = await B.arRotate(rotProgress); toast('New A/R key made' + rotDoneMsg(r), { ms: 6000 }); }
    catch (e) { toast(errText(e), { bad: true }); }
    S.accessBusy = ''; S.rotating = null; loadPeople();
  },
  async fixGrants() {
    S.accessBusy = 'fix'; paintAccess();
    try {
      const r = await B.arFixGrants(), off = r.removed.concat(r.relogin);
      toast(r.resealed.length ? 'Renewed for ' + r.resealed.join(', ') : off.length ? 'Taken off ' + off.join(', ') + ' (login turned off) — a new A/R key was made' : 'Everything is up to date');
    } catch (e) { toast(errText(e), { bad: true }); }
    S.accessBusy = ''; loadPeople();
  }
});

/* ---------- the A/R key ---------- */
function keyCardHTML() {
  return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>The A/R key</h3><span class="sub">Separate from the office key</span></div><div class="cardBd" id="keyBox">' + keyBodyHTML() + '</div></div>';
}
function keyBodyHTML() {
  const P = S.people, v = B.ar ? B.ar.curV : 1;
  let rec = '<span class="muted">Checking…</span>';
  if (P && !P.err) rec = P.escrowOk ? '<span class="sug mint">' + ic('done', 13) + 'Up to date</span>'
    : P.hasRecovery === false ? '<span class="sug amber">No office recovery code yet</span>'
    : '<span class="sug amber">Out of date</span> <button class="linkBtn" data-act="fixGrants">Update it now</button>';
  return '<div class="kvRow"><span>Current A/R key</span><b>#' + esc(String(v)) + '</b></div>' +
    '<div class="kvRow"><span>Copy kept with your recovery code</span>' + rec + '</div>' +
    '<div class="kvRow"><span>People with A/R</span><b>' + (P && !P.err ? P.grants.length : '…') + '</b></div>' +
    '<p class="small muted" style="margin-top:10px">Reports and account notes are sealed on the computer that saves them. The database only ever holds the sealed copies, plus dates and counts — never a name, a phone number or an amount. Each person’s copy of the A/R key is sealed to their own login, and one more copy to your recovery code (from NLO Cases), so it can’t be lost.' +
    (P && P.hasRecovery === false ? ' Set up the recovery code in NLO Cases → Team &amp; security.' : '') + '</p>';
}

/* ---------- the numbers the lists use ---------- */
function numbersCardHTML() {
  const c = S.cfg, n = (id, v, step, min, max, w) => '<input type="number" class="inp" id="' + id + '" data-cfg value="' + esc(String(v)) + '" step="' + step + '" min="' + min + '" max="' + max + '" style="max-width:' + (w || 110) + 'px">';
  return '<div class="card"><div class="cardHd"><h3>How the lists are made</h3><span class="sub">Dr. A’s rules</span></div><div class="cardBd">' +
    '<div class="field"><label for="cfgInst">Insurance instalment ($ a month)</label>' + n('cfgInst', c.inst, '0.01', '0.01', '5000') +
    '<div class="hint">Insurance past due that is an exact multiple of this means the carrier has paid nothing (N × the instalment = N months).</div></div>' +
    '<div class="flabel">Insurance with nothing paid — days past due</div><div class="grid3">' +
    '<div class="field"><label for="cfgT0">Monitor up to</label>' + n('cfgT0', c.tiers[0], '1', '1', '3650') + '</div>' +
    '<div class="field"><label for="cfgT1">Chase now up to</label>' + n('cfgT1', c.tiers[1], '1', '2', '3650') + '</div>' +
    '<div class="field"><label for="cfgT2">Investigate up to</label>' + n('cfgT2', c.tiers[2], '1', '3', '3650') + '</div></div>' +
    '<div class="small muted" style="margin:-8px 0 14px">Older than that: probably never filed.</div>' +
    '<div class="field"><label for="cfgWo">Write-off candidate: 91+ under ($)</label>' + n('cfgWo', c.writeOff, '1', '1', '100000') + '</div>' +
    '<div class="field"><label for="cfgStale">Say the report is old after (days)</label>' + n('cfgStale', c.staleDays, '1', '1', '90') + '</div>' +
    '<div class="small planPrev" id="cfgPrev">' + cfgPreview() + '</div>' +
    '<div class="btnRow" style="margin-top:12px"><button class="btn btn-pri btn-sm" data-act="saveCfg">Save</button><button class="btn btn-ghost" data-act="resetCfg">Back to the usual numbers</button></div></div></div>';
}
function readCfg() {
  const num = id => Number((($('#' + id) || {}).value || '').trim());
  return { inst: round2(num('cfgInst')), writeOff: num('cfgWo'), tiers: [num('cfgT0'), num('cfgT1'), num('cfgT2')], staleDays: num('cfgStale') };
}
function cfgProblem(c) {
  if (!(c.inst > 0 && c.inst <= 5000)) return 'The instalment needs to be more than $0.';
  if (!c.tiers.every(t => Number.isInteger(t) && t > 0 && t <= 3650)) return 'The day cutoffs need to be whole numbers of days.';
  if (!(c.tiers[0] < c.tiers[1] && c.tiers[1] < c.tiers[2])) return 'Each day cutoff needs to be more than the one before it.';
  if (!(c.writeOff >= 1 && c.writeOff <= 100000)) return 'The write-off amount needs to be at least $1.';
  if (!(Number.isInteger(c.staleDays) && c.staleDays >= 1 && c.staleDays <= 90)) return 'Use 1 to 90 days for an old report.';
  return '';
}
/* what the numbers typed would give with the report on screen */
function cfgPreview() {
  if (!S.rep) return '<span class="muted">Import a report to see what these numbers give.</span>';
  const c = $('#cfgInst') ? readCfg() : S.cfg; if (cfgProblem(c)) return '<span class="muted">—</span>';
  const A = reportAccts(S.rep, arCfg({ ar: c })), nev = A.filter(a => a.months), by = t => nev.filter(a => a.tier === t).length;
  const wo = A.filter(a => a.bucket === '91' && a.b90 < c.writeOff).length;
  return 'With the ' + esc(fmtDate(S.rep.asOf)) + ' report: <b>' + plural(nev.length, 'insurance account') + '</b> with nothing paid (chase now ' + by('chase') + ' · investigate ' + by('investigate') + ' · never filed? ' + by('nofile') + ' · monitor ' + by('monitor') + '), <b>' + wo + '</b> write-off candidate' + (wo === 1 ? '' : 's') + '.';
}
document.addEventListener('input', e => { if (e.target.matches && e.target.matches('[data-cfg]')) { const p = $('#cfgPrev'); if (p) p.innerHTML = cfgPreview(); } });
Object.assign(ACT, {
  saveCfg() {
    const c = readCfg(), bad = cfgProblem(c); if (bad) { toast(bad, { bad: true }); return; }
    act(() => B.saveSettings({ ar: c }), 'Saved — the lists use the new numbers');
  },
  async resetCfg() {
    if (!(await confirmBox('Go back to the usual numbers?', '$' + AR_DEFAULTS.inst.toFixed(2) + ' instalment; monitor up to ' + AR_DEFAULTS.tiers[0] + ' days, chase up to ' + AR_DEFAULTS.tiers[1] + ', investigate up to ' + AR_DEFAULTS.tiers[2] + '; write-off under ' + money(AR_DEFAULTS.writeOff) + '; a report is old after ' + AR_DEFAULTS.staleDays + ' days.', 'Use the usual numbers'))) return;
    const d = { inst: AR_DEFAULTS.inst, writeOff: AR_DEFAULTS.writeOff, tiers: AR_DEFAULTS.tiers.slice(), staleDays: AR_DEFAULTS.staleDays };
    if (await act(() => B.saveSettings({ ar: d }), 'Back to the usual numbers')) { S.cfg = arCfg({ ar: d }); renderView(); }
  }
});

/* ---------- recent activity ---------- */
Object.assign(ACT, {
  async loadActivity() {
    const box = $('#actBox'); if (!box) return; box.innerHTML = '<div class="small muted">Loading…</div>';
    try {
      const list = (await B.activity(7)).filter(x => x.a !== 'rekey' && x.a !== 'save'), b2 = $('#actBox'); if (!b2) return;
      if (!list.length) { b2.innerHTML = '<div class="small muted">Nothing in the last 7 days.</div>'; return; }
      b2.innerHTML = list.slice(0, 80).map(x => {
        const it = S.items.get(x.itemId), name = it && !it.locked ? it.name : '';
        return '<div class="hist"><time>' + esc(fmtWhen(x.at)) + '</time><span><b>' + esc(firstName(staffName(x.sid, x.sid)) || '') + '</b> ' + esc(histText(x)) + ' — ' +
          (name ? '<button class="linkBtn" data-act="open" data-key="' + esc(it.key) + '">' + esc(name) + '</button>' : 'an account resolved a while ago') + '</span></div>';
      }).join('');
    } catch (x) { const b2 = $('#actBox'); if (b2) b2.innerHTML = '<div class="small" style="color:var(--coral-700)">' + esc(errText(x)) + '</div>'; }
  }
});

/* ---------- logins and the database rules ---------- */
function securityCardHTML() {
  return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Team &amp; security</h3></div><div class="cardBd small">' +
    '<p>Logins, passwords, the office key and the recovery code are shared with NLO Cases and managed there (Team &amp; security). A/R locks after ' + esc(String(S.settings.idleMin || 10)) + ' minutes without activity, like NLO Cases.</p>' +
    '<div class="btnRow"><a class="btn btn-sec btn-sm" href="nlo-cases.html">' + ic('next', 15) + 'Open NLO Cases</a></div>' +
    '<details class="help"><summary>Database rules</summary><p class="small muted" style="margin:8px 0">Only needed if A/R ever says the database needs its updated rules. They’re the office’s whole rules file (NLO Cases, NLO Leads and A/R).</p>' +
    '<ol class="steps small"><li>Press <b>Copy the rules</b>.</li><li>Open the <b>Firebase console</b> → <b>Firestore Database</b> → <b>Rules</b>.</li><li>Select everything there, paste, and press <b>Publish</b>.</li></ol>' +
    '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="copyRules">' + ic('copy', 15) + 'Copy the rules</button><a class="btn btn-ghost" href="https://console.firebase.google.com/project/nlo-cases/firestore" target="_blank" rel="noopener noreferrer">Open the Firebase console</a></div></details></div></div>';
}

/* ---------- my account ---------- */
function viewAccount() {
  const me = B.me || {}, ar = S.arState === 'ok';
  return '<div class="card" style="max-width:520px"><div class="cardHd"><span class="av lg">' + esc(initials(me.name)) + '</span><div><h3>' + esc(me.name || '') + '</h3><div class="sub">' + (me.role === 'owner' ? 'Owner · email login' : 'Username: ' + esc(me.username || '')) + '</div></div></div>' +
    '<div class="cardBd"><div class="kvRow" style="margin-bottom:8px"><span>A/R</span>' + (ar ? '<span class="sug mint">' + ic('done', 13) + 'You can use it</span>' : '<span class="sug">Not turned on for you</span>') + '</div>' +
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
