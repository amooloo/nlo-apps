/* =====================================================================
   Settings (owner): website feed, follow-up plan, who gets new leads,
   message wording, recent activity, deleted leads.
   Import & export (owner), My account.
   ===================================================================== */
const FEED_HINT = 'https://lead-intake-…-uc.a.run.app';
const BAD_WHY = { key: 'wrong address', off: 'feed turned off', full: 'too many waiting', big: 'too large', setup: 'feed not set up', error: 'server error' };
function saveLeads(patch, okMsg) { const cur = (S.settings && S.settings.leads) || {}; return act(() => B.saveSettings({ leads: Object.assign({}, cur, patch) }), okMsg || 'Saved'); }

function viewSettings() {
  return '<div class="adminGrid"><div>' + feedCardHTML() + planCardHTML() + '</div><div>' + assignCardHTML() + msgCardHTML() +
    '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Recent activity</h3><span class="sub">Last 7 days</span><span style="flex:1"></span><button class="btn btn-ghost" data-act="loadActivity">' + ic('refresh', 15) + 'Load</button></div><div class="cardBd" id="actBox"><div class="small muted">Shows who did what. Click Load.</div></div></div>' +
    '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Deleted leads</h3><span class="sub">Last 90 days</span><span style="flex:1"></span><button class="btn btn-ghost" data-act="loadDeleted">' + ic('refresh', 15) + 'Load</button></div><div class="cardBd" id="delBox"><div class="small muted">Deleted leads can be brought back. Click Load.</div></div></div>' +
    '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Team &amp; security</h3></div><div class="cardBd small"><p>Logins, the office key and the recovery code are shared with NLO Cases and managed there (Team &amp; security). The screen locks after ' + esc(String(S.settings.idleMin || 10)) + ' minutes without activity.</p>' +
    '<a class="btn btn-sec btn-sm" href="nlo-cases.html" style="margin-top:10px">' + ic('next', 15) + 'Open NLO Cases</a></div></div>' +
    '</div></div>';
}

/* ---------- website feed ---------- */
function feedUrlFull(secret) { const base = (S.cfg.feedUrl || '').trim(); return base && secret ? base + (base.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(secret) : ''; }
function feedCardHTML() { return '<div class="card" id="feedCard"><div class="cardHd"><h3>Website feed</h3><span class="sub">The website’s appointment form → here, automatically</span></div><div class="cardBd" id="feedBd"></div></div>'; }
function updateFeedStatus() {
  const bd = $('#feedBd'); if (!bd) return;
  const state = S.intake ? 'on' : 'none';
  if (bd.dataset.state !== state) { bd.dataset.state = state; bd.innerHTML = feedBodyHTML(); if (S.intake) loadFeed(); return; }
  const st = $('#feedStatus'); if (st) st.innerHTML = feedStatusHTML();
}
function feedBodyHTML() {
  if (!S.intake) return '<p class="small" style="margin-bottom:10px">Not set up yet. Setting it up makes the feed’s own lock and key: the website can lock a request for the office, but only someone signed in here can open it.</p>' +
    '<ol class="steps small"><li>Press <b>Set up the website feed</b>.</li><li>Put the receiving service online once (Google Cloud Shell, about 5 minutes — steps below).</li><li>Paste its address here, then put the address this page gives you into the website form.</li></ol>' +
    '<button class="btn btn-pri btn-sm" data-act="setupFeed">' + ic('web', 15) + 'Set up the website feed</button>' + cloudShellHelp();
  return '<div id="feedStatus">' + feedStatusHTML() + '</div>' +
    '<div class="field" style="margin-top:14px"><label for="feedUrl">1 · Receiving service address</label><div class="inRow"><input id="feedUrl" placeholder="' + FEED_HINT + '" value="' + esc(S.cfg.feedUrl || '') + '" autocomplete="off" spellcheck="false"><button class="btn btn-sec btn-sm" data-act="saveFeedUrl">Save</button></div><div class="hint">Printed at the end of the one-time setup in Google Cloud Shell (steps below).</div></div>' +
    '<div class="field"><label for="hookUrl">2 · Address for the website form (keep it private)</label><div class="inRow"><input id="hookUrl" readonly value="" placeholder="Loading…"><button class="btn btn-sec btn-sm" data-act="showHook" id="showHook">Show</button><button class="btn btn-sec btn-sm" data-act="copyHook">' + ic('copy', 14) + 'Copy</button></div><div class="hint">Anyone with this address could send requests in, so it only goes into the website form’s settings.</div></div>' +
    '<div class="btnRow"><button class="btn btn-act btn-sm" data-act="testFeed">Send a test request</button><button class="btn btn-sec btn-sm" data-act="feedOnOff" id="feedOnOff">Turn the feed off</button><button class="btn btn-ghost" data-act="newSecret">Make a new address</button></div><div id="testMsg" class="small" style="margin-top:8px"></div>' +
    elementorHelp() + cloudShellHelp();
}
function feedStatusHTML() {
  const f = S.feed || {}, st = f.stats || {}, on = f.on !== false;
  const bad = Object.keys(S.inboxBad);
  let h = '<div class="feedSt"><span class="dot ' + (!S.feed ? '' : on ? 'ok' : 'bad') + '"></span><b>' + (!S.feed ? 'Checking…' : on ? 'On' : 'Off') + '</b>' + (S.feed ? ' — ' + (on ? 'requests from the website are added here' : 'requests from the website are refused (they still arrive by email)') : '') + '</div>';
  if (f.err) h += '<div class="small" style="color:var(--coral-700)">' + esc(f.err) + '</div>';
  h += '<div class="small muted">' + (st.okAt ? 'Last request received ' + esc(fmtAgo(st.okAt)) : 'No request received yet') + (st.badAt ? ' · last one refused ' + esc(fmtAgo(st.badAt)) + ' (' + esc(BAD_WHY[st.badWhy] || st.badWhy || '') + ')' : '') + '</div>';
  if (S.inbox.length) h += '<div class="small" style="margin-top:6px">' + S.inbox.length + ' waiting to be added' + (bad.length ? ', ' + bad.length + ' couldn’t be opened' : '') + '.</div>';
  h += bad.map(id => '<div class="row" style="cursor:default"><span class="grow"><span class="meta">Received ' + esc(fmtWhen((S.inbox.find(x => x.id === id) || {}).at)) + ' — ' + esc(S.inboxBad[id]) + '</span></span><button class="btn btn-ghost" data-act="dismissInbox" data-id="' + esc(id) + '">Remove</button></div>').join('');
  if (S.intake && S.intake.bad) h += '<div class="notice bad" style="margin-top:8px">The feed key can’t be opened with the current office key. Requests stay safely waiting; use “Make a new address” and set the feed up again if this doesn’t clear after signing in again.</div>';
  return h;
}
async function loadFeed() {
  try {
    const [secret, doc, stats] = await Promise.all([B.readSecret(), B.intakeSecretDoc(), B.intakeStats().catch(() => null)]);
    S.feed = { secret, on: doc ? doc.on !== false : true, stats: stats || {} };
  } catch (e) { S.feed = { err: 'Couldn’t read the feed settings: ' + errText(e) }; }
  if (S.view !== 'settings') return;
  const hu = $('#hookUrl'); if (hu) { hu.value = S.feed.secret ? (S.showHook ? feedUrlFull(S.feed.secret) || '(save the receiving service’s address first)' : '•'.repeat(24)) : ''; hu.placeholder = S.feed.secret ? '' : 'Not available'; }
  const b = $('#feedOnOff'); if (b) b.textContent = S.feed.on === false ? 'Turn the feed on' : 'Turn the feed off';
  const st = $('#feedStatus'); if (st) st.innerHTML = feedStatusHTML();
}
function elementorHelp() {
  return '<details class="help"><summary>Connect the website form (Elementor)</summary><ol class="steps small">' +
    '<li>In WordPress, open the <b>Request an Appointment</b> page with <b>Edit with Elementor</b>.</li>' +
    '<li>Click the form, then <b>Content → Actions After Submit</b>. Keep <b>Email</b> and add <b>Webhook</b>.</li>' +
    '<li>Open the new <b>Webhook</b> section, paste the address from step 2, and turn on <b>Advanced Data</b>.</li>' +
    '<li>Press <b>Update</b>. Then fill in the form on the website with made-up details — it shows up here under <b>Need a look</b> within a minute. Close it as a test.</li>' +
    '<li>Once real requests are arriving here, turn off the rule that copies the form emails into Asana. Keep the office email as a backup.</li></ol></details>';
}
function cloudShellHelp() {
  const cmd = 'git clone --depth 1 https://github.com/amooloo/nlo-apps && bash nlo-apps/nlo-leads-src/intake/deploy-intake.sh';
  return '<details class="help"><summary>Put the receiving service online (one time, Google Cloud Shell)</summary><ol class="steps small">' +
    '<li>Open <a href="https://shell.cloud.google.com/?show=terminal" target="_blank" rel="noopener noreferrer">Google Cloud Shell</a>, signed in with the Google account that owns the <b>nlo-cases</b> Firebase project.</li>' +
    '<li>Paste this and press Enter:<div class="cmd"><code>' + esc(cmd) + '</code><button class="btn btn-ghost" data-act="copyVal" data-v="' + esc(cmd) + '">' + ic('copy', 14) + 'Copy</button></div></li>' +
    '<li>It takes 3–5 minutes. If it asks to enable a service or authorize, say yes. At the end it prints the service’s address — paste it in step 1.</li></ol>' +
    '<p class="small muted">It runs on Google’s free allowance at this office’s volume. The service can only lock a request with the feed key and store it — it can’t open leads.</p></details>';
}
Object.assign(ACT, {
  async setupFeed() {
    if (!await confirmBox('Set up the website feed?', 'This makes the feed’s key and the private address for the website form. Nothing changes on the website until you add that address to the form.', 'Set it up')) return;
    try {
      const secret = await B.setupIntake(); S.feed = { secret, on: true, stats: {} };
        toast('Website feed set up'); renderView();
    } catch (x) { toast(errText(x), { bad: true }); }
  },
  saveFeedUrl() {
    const v = ($('#feedUrl').value || '').trim();
    if (v && !/^https:\/\/[a-z0-9.-]+\.run\.app(\/[\w\-./]*)?$/i.test(v)) { toast('That doesn’t look like the receiving service’s address (https://….run.app, printed by the setup in Cloud Shell).', { bad: true, ms: 6000 }); return; }
    saveLeads({ feedUrl: v }, 'Saved').then(() => loadFeed());
  },
  showHook(t) { S.showHook = !S.showHook; t.textContent = S.showHook ? 'Hide' : 'Show'; loadFeed(); },
  copyHook() {
    const u = feedUrlFull(S.feed && S.feed.secret);
    if (!u) { toast(!(S.cfg.feedUrl || '').trim() ? 'Save the receiving service’s address (step 1) first.' : 'Still loading — try again in a moment.', { bad: true }); return; }
    copyText(u).then(ok => toast(ok ? 'Copied. Paste it into the website form’s Webhook action.' : 'Couldn’t copy — press Show and copy it by hand', ok ? {} : { bad: true }));
  },
  async testFeed() {
    const m = $('#testMsg'), url = feedUrlFull(S.feed && S.feed.secret);
    if (!(S.cfg.feedUrl || '').trim()) { m.innerHTML = '<span class="bad">Paste the receiving service’s address in step 1 and press Save first.</span>'; return; }
    if (!url) { m.innerHTML = '<span class="muted">Still loading the feed’s address — try again in a moment.</span>'; return; }
    if (S.feed.on === false) { m.innerHTML = '<span class="bad">The feed is off. Turn it on first.</span>'; return; }
    const sentAt = Date.now(); m.innerHTML = '<span class="muted">Sending…</span>';
    try { await B.sendTest(url); } catch (e) { m.innerHTML = '<span class="bad">Couldn’t reach that address from this computer. Check it in step 1.</span>'; return; }
    m.innerHTML = '<span class="muted">Sent. Waiting for it to arrive (up to a minute)…</span>';
    clearInterval(S.testT);
    S.testT = setInterval(() => {
      const el = $('#testMsg');
      const got = openLeads().some(l => l.src && l.src.test && (l.createdAt || 0) >= sentAt - 2000);
      if (got) { clearInterval(S.testT); if (el) el.innerHTML = '<span class="ok">✓ It arrived and was added. The test request is on Today under Need a look — close it there.</span>'; loadFeed(); return; }
      if (el && S.inbox.some(x => x.at >= sentAt - 30000)) el.innerHTML = '<span class="muted">It arrived — adding it…</span>';
      if (Date.now() - sentAt > 60000) { clearInterval(S.testT); if (el) el.innerHTML = '<span class="bad">Nothing arrived within a minute. Check that the receiving service is online (the address in step 1) and the feed is on, then try again.</span>'; loadFeed(); }
    }, 1000);
  },
  async feedOnOff() {
    const on = !(S.feed && S.feed.on === false);
    if (on && !await confirmBox('Turn the website feed off?', 'Within a minute, website requests stop coming in here (they still arrive by email). Turn it back on any time.', 'Turn off', true)) return;
    try { await B.setFeedOn(!on); S.feed = Object.assign({}, S.feed, { on: !on }); toast(on ? 'Feed turned off' : 'Feed turned on'); loadFeed(); } catch (x) { toast(errText(x), { bad: true }); }
  },
  async newSecret() {
    if (!await confirmBox('Make a new address?', 'The current address stops working within a minute. Paste the new one into the website form’s Webhook action straight after, or requests will only arrive by email.', 'Make new address', true)) return;
    try { const s = await B.rotateSecret(); S.feed = Object.assign({}, S.feed, { secret: s }); S.showHook = true; const b = $('#showHook'); if (b) b.textContent = 'Hide'; loadFeed(); toast('New address made — copy it into the website form now', { ms: 7000 }); }
    catch (x) { toast(errText(x), { bad: true }); }
  },
  async dismissInbox(t) {
    if (!await confirmBox('Remove this request?', 'It couldn’t be opened, so it can’t become a lead. The same request also went to the office email.', 'Remove', true)) return;
    act(() => B.dismissInbox(t.dataset.id), 'Removed');
  }
});

/* ---------- follow-up plan ---------- */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function planCardHTML() {
  const c = S.cfg;
  return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Follow-up plan</h3><span class="sub">For new leads; open leads keep their dates</span></div><div class="cardBd">' +
    '<div class="planEd">' + STEP_DEFS.map((d, i) => '<div class="peRow"><span class="pn">' + (i + 1) + '</span><span class="pl"><b>' + esc(d.label) + '</b><span class="small muted">' + (d.t === 'call' ? 'Call' : 'Text or email') + '</span></span>' +
      '<label class="small peDay">Day <input type="number" min="0" max="120" step="1" class="inp" id="off' + i + '" value="' + c.offsets[i] + '" data-plan></label></div>').join('') + '</div>' +
    '<div class="small muted" style="margin:6px 0 12px">Day 0 is the day the request comes in (or the next office day). Each attempt lands on an office day.</div>' +
    '<div class="field"><label>Office days</label><div class="pickRow" id="dayPick">' + WEEKDAYS.map((n, d) => '<button type="button" class="pick sm" data-day="' + d + '" aria-pressed="' + c.days.includes(d) + '">' + n + '</button>').join('') + '</div><div class="hint">Holidays from the handbook are skipped automatically.</div></div>' +
    '<div class="field" style="max-width:300px"><label for="closeHour">Requests from this time count as the next day</label><select id="closeHour" data-plan>' + [12, 13, 14, 15, 16, 17, 18, 19, 20, 24].map(hr => '<option value="' + hr + '"' + (c.closeHour === hr ? ' selected' : '') + '>' + (hr === 24 ? 'Never (same day until midnight)' : fmtClock(hr + ':00')) + '</option>').join('') + '</select></div>' +
    '<div class="small planPrev" id="planPrev">' + planPreview() + '</div>' +
    '<div class="btnRow" style="margin-top:12px"><button class="btn btn-pri btn-sm" data-act="savePlan">Save plan</button><button class="btn btn-ghost" data-act="resetPlan">Back to the usual plan</button></div></div></div>';
}
function readPlan() {
  const offsets = STEP_DEFS.map((d, i) => Number(($('#off' + i) || {}).value));
  const days = $$('#dayPick [aria-pressed="true"]').map(b => Number(b.dataset.day));
  const closeHour = Number(($('#closeHour') || {}).value || 17);
  return { offsets, days, closeHour };
}
function planPreview() {
  const p = $('#off0') ? readPlan() : { offsets: S.cfg.offsets, days: S.cfg.days, closeHour: S.cfg.closeHour };
  if (!p.days.length || p.offsets.some(n => !Number.isInteger(n) || n < 0 || n > 120)) return '<span class="muted">—</span>';
  const cfg = leadCfg({ leads: p }), mon = nextOfficeDay(addDays(todayISO(), 1), cfg);
  const [y, m, d] = mon.split('-').map(Number), start = new Date(y, m - 1, d, 10).getTime();
  const plan = planSteps(dayZero(start, cfg), cfg);
  return 'Example — a request on ' + esc(fmtDay(mon)) + ' at 10 AM: ' + plan.map((s, i) => '<span class="pp">' + (i + 1) + ' · ' + esc(fmtDay(s.due)) + '</span>').join(' ');
}
document.addEventListener('click', e => { const b = e.target.closest('#dayPick [data-day]'); if (!b) return; b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); const pv = $('#planPrev'); if (pv) pv.innerHTML = planPreview(); });
document.addEventListener('input', e => { if (e.target.matches && e.target.matches('[data-plan]')) { const pv = $('#planPrev'); if (pv) pv.innerHTML = planPreview(); } });
document.addEventListener('change', e => { if (e.target.matches && e.target.matches('[data-plan]')) { const pv = $('#planPrev'); if (pv) pv.innerHTML = planPreview(); } });
Object.assign(ACT, {
  savePlan() {
    const p = readPlan();
    if (p.offsets.some(n => !Number.isInteger(n) || n < 0 || n > 120)) { toast('Days must be whole numbers from 0 to 120.', { bad: true }); return; }
    if (p.offsets.some((n, i) => i && n < p.offsets[i - 1])) { toast('Each attempt needs to be on or after the one before it.', { bad: true }); return; }
    if (!p.days.length) { toast('Pick at least one office day.', { bad: true }); return; }
    saveLeads(p, 'Plan saved — new leads use it');
  },
  async resetPlan() {
    if (!await confirmBox('Go back to the usual plan?', 'Call and text on day 0, call on day 1, text or email on day 7, final call on day 14; Monday–Thursday; 5 PM cutoff.', 'Use the usual plan')) return;
    await saveLeads({ offsets: DEFAULT_LEADS_CFG.offsets.slice(), days: DEFAULT_LEADS_CFG.days.slice(), closeHour: DEFAULT_LEADS_CFG.closeHour }, 'Back to the usual plan');
    S.cfg = leadCfg(S.settings); renderView();
  }
});

/* ---------- who gets new leads ---------- */
function assignCardHTML() {
  const cur = S.cfg.assignee, sav = pickAssignee(Object.assign({}, S.cfg, { assignee: 'auto' }), S.roster);
  return '<div class="card"><div class="cardHd"><h3>Who gets new leads</h3></div><div class="cardBd"><div class="field"><label for="defWho">New website and phone leads go to</label><select id="defWho" data-chg="defWho">' +
    '<option value="auto"' + (cur === 'auto' ? ' selected' : '') + '>Savannah (automatic, as in Asana)</option><option value=""' + (cur === '' ? ' selected' : '') + '>Nobody — leave them unassigned</option>' +
    activeRoster().map(r => '<option value="' + esc(r.sid) + '"' + (cur === r.sid ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select>' +
    '<div class="hint">' + (cur === 'auto' && !sav ? 'There’s no login named Savannah yet, so new leads stay unassigned until she has one (NLO Cases → Team &amp; security).' : 'Anyone can still reassign a lead from its page.') + '</div></div></div></div>';
}
CHG.defWho = t => { saveLeads({ assignee: t.value }, 'Saved').then(() => { S.cfg = leadCfg(S.settings); }); };

/* ---------- message wording ---------- */
const TPL_KEYS = ['text1', 'subj1', 'email1', 'text2', 'subj2', 'email2'];
function msgCardHTML() {
  const t = S.cfg.tpl;
  const ta = (k, label, rows) => '<div class="field"><label for="tpl-' + k + '">' + label + '</label><textarea id="tpl-' + k + '" rows="' + rows + '">' + esc(t[k]) + '</textarea></div>';
  const inp = (k, label) => '<div class="field"><label for="tpl-' + k + '">' + label + '</label><input id="tpl-' + k + '" value="' + esc(t[k]) + '"></div>';
  return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Messages</h3><span class="sub">Filled in for attempts 2 and 4</span></div><div class="cardBd">' +
    '<div class="field" style="max-width:260px"><label for="ofPhone">Office phone in messages</label><input id="ofPhone" value="' + esc(S.cfg.phone) + '"></div>' +
    '<div class="small muted" style="margin-bottom:10px">Fill-ins: {first} = the parent’s first name (or the patient’s), {me} = the first name of whoever sends it, {office} = Next Level Orthodontics, {phone} = the office phone.</div>' +
    '<div class="subH">Attempt 2</div>' + ta('text1', 'Text', 3) + inp('subj1', 'Email subject') + ta('email1', 'Email', 6) +
    '<div class="subH">Attempt 4</div>' + ta('text2', 'Text', 3) + inp('subj2', 'Email subject') + ta('email2', 'Email', 6) +
    '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="saveMsgs">Save messages</button><button class="btn btn-ghost" data-act="resetMsgs">Back to the usual wording</button></div></div></div>';
}
Object.assign(ACT, {
  saveMsgs() {
    const tpl = {}; TPL_KEYS.forEach(k => { tpl[k] = (($('#tpl-' + k) || {}).value || '').trim() || DEFAULT_TPL[k]; });
    saveLeads({ tpl, phone: (($('#ofPhone') || {}).value || '').trim() }, 'Messages saved');
  },
  async resetMsgs() {
    if (!await confirmBox('Go back to the usual wording?', 'All six messages go back to the wording the app came with.', 'Reset')) return;
    await saveLeads({ tpl: Object.assign({}, DEFAULT_TPL), phone: DEFAULT_LEADS_CFG.phone }, 'Back to the usual wording');
    S.cfg = leadCfg(S.settings); renderView();
  }
});

/* ---------- activity and deleted leads ---------- */
Object.assign(ACT, {
  async loadActivity() {
    const box = $('#actBox'); if (!box) return; box.innerHTML = '<div class="small muted">Loading…</div>';
    try {
      const list = (await B.activity(7)).filter(x => x.a !== 'rekey' && x.a !== 'save'); const b2 = $('#actBox'); if (!b2) return;
      if (!list.length) { b2.innerHTML = '<div class="small muted">No activity in the last 7 days.</div>'; return; }
      b2.innerHTML = list.slice(0, 80).map(x => {
        const l = findLead(x.leadId), who = x.a === 'create' && x.how === 'website' ? 'Website' : firstName(staffName(x.sid, x.sid)) || x.sid || '';
        return '<div class="hist"><time>' + esc(fmtWhen(x.at)) + '</time><span><b>' + esc(who) + '</b> ' + esc(histText(x)) + ' — ' + (l ? '<button class="linkBtn" data-act="open" data-id="' + esc(l.id) + '">' + esc(leadName(l)) + '</button>' : 'a closed lead') + '</span></div>';
      }).join('');
    } catch (x) { const b2 = $('#actBox'); if (b2) b2.innerHTML = '<div class="small" style="color:var(--coral-700)">' + esc(errText(x)) + '</div>'; }
  },
  async loadDeleted() {
    const box = $('#delBox'); if (!box) return; box.innerHTML = '<div class="small muted">Loading…</div>';
    try {
      const list = await B.deletedLeads(90); S.delList = list; const b2 = $('#delBox'); if (!b2) return;
      b2.innerHTML = list.length ? list.map((x, i) => '<div class="row" style="cursor:default"><span class="grow"><span class="pt">' + esc(leadName(x.data)) + '</span><span class="meta">' + esc('deleted ' + fmtWhen(x.at) + ' by ' + firstName(staffName(x.sid, x.sid))) + '</span></span><button class="btn btn-sec btn-sm" data-act="undelete" data-i="' + i + '">Restore</button></div>').join('')
        : '<div class="small muted">Nothing deleted in the last 90 days.</div>';
    } catch (x) { const b2 = $('#delBox'); if (b2) b2.innerHTML = '<div class="small" style="color:var(--coral-700)">' + esc(errText(x)) + '</div>'; }
  },
  async undelete(t) {
    const x = S.delList && S.delList[Number(t.dataset.i)]; if (!x) return;
    try { await B.undelete(x); toast(leadName(x.data) + ' restored'); S.closedLoaded = false; ACT.loadDeleted(); } catch (e) { toast(errText(e), { bad: true }); }
  }
});

/* ---------- import & export ---------- */
function viewImport() {
  return '<div class="adminGrid"><div><div class="card"><div class="cardHd"><h3>Import from Asana</h3></div><div class="cardBd">' +
    '<p class="small" style="margin-bottom:12px">Brings the leads from your Asana project (“New Leads – Appointment Requests”) in here, with the attempts already ticked off kept. It runs in this browser, so names go straight from Asana into the encrypted app. Leads already imported are skipped.</p>' +
    '<div class="sec" style="margin-top:4px"><h5>Option 1 — Asana token</h5><p class="small muted" style="margin-bottom:8px">In Asana: profile photo → Settings → Apps → Developer apps → Create new token. Paste it here; it’s used once and not saved.</p>' +
    '<form id="asForm"><div class="field"><label for="asTok">Personal access token</label><input id="asTok" type="password" autocomplete="off"></div><button class="btn btn-sec btn-sm" type="submit">Load my Asana projects</button></form><div id="asProj" style="margin-top:12px"></div></div>' +
    '<div class="sec"><h5>Option 2 — CSV file</h5><p class="small muted" style="margin-bottom:8px">In the Asana project: ⌄ next to its name → Export/Print → CSV.</p><input type="file" id="csvFile" accept=".csv,text/csv" class="inp"></div>' +
    '<label class="small" style="display:flex;gap:8px;align-items:center;margin-top:14px"><input type="checkbox" id="impDone"> Also bring leads already completed in Asana (for Results)</label>' +
    '<div id="impPreview" style="margin-top:14px"></div></div></div></div>' +
    '<div><div class="card"><div class="cardHd"><h3>Export</h3></div><div class="cardBd"><p class="small" style="margin-bottom:12px">Downloads every lead (open and closed) as a spreadsheet. <b>The file contains names and contact details</b> — keep it on an office computer and delete it when you’re done.</p>' +
    '<button class="btn btn-sec btn-sm" data-act="exportCSV">' + ic('download', 15) + 'Download all leads (CSV)</button></div></div></div></div>';
}
async function asana(tok, path) {
  const r = await fetch('https://app.asana.com/api/1.0' + path, { headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json' } });
  if (r.status === 401) throw errCode('asana-auth', 'Asana rejected that token.');
  if (!r.ok) throw errCode('asana', 'Asana error ' + r.status);
  return r.json();
}
const asOutcome = cf => { const f = (cf || []).find(x => /outcome|result|status/i.test(x.name || '')); return f ? f.display_value || '' : ''; };
async function previewImport(tasks) {
  const box = $('#impPreview'); if (!box) return; box.innerHTML = '<div class="small muted">Checking what’s already here…</div>';
  let existing; try { existing = new Set((await B.loadAll()).map(l => l.src && l.src.asana).filter(Boolean)); } catch (e) { existing = new Set(); }
  const incDone = $('#impDone') && $('#impDone').checked, roster = S.roster.map(r => ({ sid: r.sid, name: r.name, active: r.active }));
  const list = []; let skipped = 0, doneSkipped = 0;
  tasks.forEach(t => {
    if (t.gid && existing.has(String(t.gid))) { skipped++; return; }
    if (t.completed && !incDone) { doneSkipped++; return; }
    const r = leadFromAsana(t, roster, S.cfg, Date.now()); if (!r.data.name && !r.data.parent) return;
    list.push(r);
  });
  S.impList = list; S.impTasks = tasks;
  const open = list.filter(r => r.status === 'open'), closed = list.filter(r => r.status === 'done');
  const why = {}; closed.forEach(r => { const k = CLOSE_WHY[r.data.closeWhy] || 'Closed'; why[k] = (why[k] || 0) + 1; });
  const unmatched = Array.from(new Set(list.filter(r => r.data.assigneeName).map(r => r.data.assigneeName)));
  const b2 = $('#impPreview'); if (!b2) return;
  b2.innerHTML = '<div class="card" style="box-shadow:none"><div class="cardBd" style="padding:14px 16px"><div class="flabel">Ready to import: ' + list.length + '</div>' +
    '<ul class="small" style="padding-left:18px;margin:6px 0 10px"><li>Open: ' + open.length + ' (' + open.filter(r => r.data.steps.some(s => s.doneAt)).length + ' already contacted)</li>' + Object.keys(why).map(k => '<li>Closed — ' + esc(k) + ': ' + why[k] + '</li>').join('') + '</ul>' +
    (skipped ? '<div class="small muted">' + skipped + ' already imported — skipped.</div>' : '') + (doneSkipped ? '<div class="small muted">' + doneSkipped + ' completed in Asana — left out.</div>' : '') +
    (unmatched.length ? '<div class="notice" style="margin-top:10px">No login yet for: ' + esc(unmatched.join(', ')) + '. Their leads import with the name shown; add them in NLO Cases → Team &amp; security first if you want them linked.</div>' : '') +
    (list.length ? '<button class="btn btn-pri btn-sm" style="margin-top:12px" data-act="doImport">Import ' + list.length + ' lead' + (list.length > 1 ? 's' : '') + '</button>' : '') + '</div></div>';
}
Object.assign(ACT, {
  async asFetch() {
    const picks = $$('.asP:checked'), box = $('#impPreview'); if (!picks.length) { box.innerHTML = '<div class="lockErr">Tick at least one project.</div>'; return; }
    box.innerHTML = '<div class="small muted">Reading tasks from Asana…</div>';
    const incDone = $('#impDone').checked, tasks = [];
    try {
      for (const p of picks) {
        let path = '/projects/' + p.value + '/tasks?limit=100&opt_fields=name,notes,created_at,completed,completed_at,assignee.name,memberships.section.name,memberships.project.gid,custom_fields.name,custom_fields.display_value' + (incDone ? '' : '&completed_since=now');
        while (path) {
          const r = await asana(S.asTok, path);
          r.data.forEach(t => {
            const mem = (t.memberships || []).find(m => m.project && m.project.gid === p.value) || (t.memberships || [])[0] || {};
            tasks.push({ gid: t.gid, name: t.name, notes: t.notes, assignee: t.assignee ? t.assignee.name : '', section: mem.section ? mem.section.name : '', createdAt: t.created_at || '', completed: t.completed, completedAt: t.completed_at || '', outcome: asOutcome(t.custom_fields), subtasks: [] });
          });
          path = r.next_page ? r.next_page.path : null;
        }
      }
      // the "Attempt 1–5" subtasks say what was already done (open leads only; finished ones don't need them)
      let n = 0;
      for (const t of tasks) {
        if (t.completed) continue;
        try { t.subtasks = (await asana(S.asTok, '/tasks/' + t.gid + '/subtasks?opt_fields=name,completed,completed_at,due_on,custom_fields.name,custom_fields.display_value')).data.map(s => ({ name: s.name, completed: s.completed, completedAt: s.completed_at || '', due: s.due_on || '', outcome: asOutcome(s.custom_fields) })); } catch (e) { }
        if (++n % 10 === 0) box.innerHTML = '<div class="small muted">Reading attempts… ' + n + '</div>';
      }
      S.asTok = ''; $('#asTok').value = '';
      previewImport(tasks);
    } catch (x) { box.innerHTML = '<div class="lockErr">' + esc(errText(x)) + '</div>'; }
  },
  async doImport() {
    const list = S.impList || []; if (!list.length) return;
    const box = $('#impPreview');
    box.innerHTML = '<div class="small">Importing ' + list.length + ' leads…</div><div class="prog"><i id="impBar"></i></div>';
    try {
      await B.createLeads(list.map(r => ({ data: r.data, status: r.status, closedAt: r.closedAt, action: { a: 'import' } })), (n, tot) => { const b = $('#impBar'); if (b) b.style.width = Math.round(n / tot * 100) + '%'; });
      S.impList = null; S.closedLoaded = false; S.histLoaded = false; ensureHist();
      box.innerHTML = '<div class="lockOk">Imported ' + list.length + ' leads. Check Today and the Board, then archive the Asana project.</div>';
    } catch (x) { box.innerHTML = '<div class="lockErr">' + esc(errText(x)) + ' — nothing after this point was imported. Run it again; finished ones are skipped.</div>'; }
  },
  async exportCSV() {
    if (!await confirmBox('Download every lead?', 'The file will contain names, phone numbers and emails. Keep it on an office computer and delete it when you’re done.', 'Download')) return;
    try {
      const all = (await B.loadAll()).filter(l => !l.locked).sort((a, b) => receivedAt(b) - receivedAt(a));
      const blob = new Blob(['﻿' + LEAD_CSV_HEAD + '\n' + all.map(l => leadToCSVRow(l, staffName(l.assignee, l.assigneeName))).join('\n')], { type: 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'nlo-leads-' + todayISO() + '.csv'; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (x) { toast(errText(x), { bad: true }); }
  }
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'csvFile' && t.files.length) {
    try { previewImport(asanaLeadsFromCSV(await t.files[0].text())); } catch (x) { const b = $('#impPreview'); if (b) b.innerHTML = '<div class="lockErr">Couldn’t read that file.</div>'; }
  }
  if (t.id === 'impDone' && S.impTasks) previewImport(S.impTasks);
});

/* ---------- my account ---------- */
function viewAccount() {
  const me = B.me || {};
  return '<div class="card" style="max-width:520px"><div class="cardHd"><span class="av lg">' + esc(initials(me.name)) + '</span><div><h3>' + esc(me.name || '') + '</h3><div class="sub">' + (me.role === 'owner' ? 'Owner · email login' : 'Username: ' + esc(me.username || '')) + '</div></div></div>' +
    '<div class="cardBd"><form id="pwForm"><div class="sec" style="margin-top:0"><h5>Change password</h5><p class="small muted" style="margin-bottom:10px">Same login as NLO Cases — the new password works in both.</p></div>' +
    '<div class="field"><label for="pwCur">Current password</label><input type="password" id="pwCur" autocomplete="current-password" required></div>' +
    '<div class="field"><label for="pwN1">New password</label><input type="password" id="pwN1" autocomplete="new-password" minlength="8" required></div>' +
    '<div class="field"><label for="pwN2">Type it again</label><input type="password" id="pwN2" autocomplete="new-password" minlength="8" required></div>' +
    '<button class="btn btn-pri" type="submit">Change password</button></form></div></div>';
}
document.addEventListener('submit', async e => {
  if (e.target.id === 'asForm') {
    e.preventDefault();
    const tok = $('#asTok').value.trim(), box = $('#asProj');
    if (!tok) { box.innerHTML = '<div class="lockErr">Paste your Asana token first.</div>'; return; }
    box.innerHTML = '<div class="small muted">Loading projects…</div>';
    try {
      const ws = await asana(tok, '/workspaces?limit=100'); let projects = [];
      for (const w of ws.data) { const p = await asana(tok, '/projects?workspace=' + w.gid + '&archived=false&limit=100&opt_fields=name'); projects = projects.concat(p.data); }
      S.asTok = tok;
      box.innerHTML = '<div class="flabel">Projects to import</div>' + projects.map(p => {
        const on = /lead|appointment request/i.test(p.name);
        return '<label class="small" style="display:flex;gap:8px;align-items:center;padding:4px 0"><input type="checkbox" class="asP" value="' + esc(p.gid) + '"' + (on ? ' checked' : '') + '> ' + esc(p.name) + '</label>';
      }).join('') + '<button class="btn btn-sec btn-sm" style="margin-top:10px" data-act="asFetch">Preview import</button>';
    } catch (x) { box.innerHTML = '<div class="lockErr">' + esc(/Failed to fetch|NetworkError|TypeError/.test(String(x)) ? 'Asana didn’t allow this from the browser. Use the CSV option instead.' : errText(x)) + '</div>'; }
    return;
  }
  if (e.target.id !== 'pwForm') return; e.preventDefault();
  const cur = $('#pwCur').value, a = $('#pwN1').value, b = $('#pwN2').value;
  if (a.length < 8) return toast('Use at least 8 characters.', { bad: true });
  if (a !== b) return toast('The two new passwords don’t match.', { bad: true });
  const btn = $('#pwForm button[type=submit]'); busyBtn(btn, true, 'Changing…');
  try { await B.changePassword(cur, a); toast('Password changed'); e.target.reset(); }
  catch (x) { toast(/invalid-credential|wrong-password/.test(x.code || '') ? 'Current password is wrong.' : errText(x), { bad: true }); }
  busyBtn(btn, false);
});
