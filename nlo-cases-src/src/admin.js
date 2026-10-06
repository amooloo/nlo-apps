/* =====================================================================
   Team & security, import & export, my account
   ===================================================================== */
function memberStatus(sid) {
  const ms = S.members.filter(m => m.staffId === sid);
  const act = ms.find(m => m.active);
  if (!act) return { k: 'off', l: 'Removed' };
  if (act.mustSetup) return { k: 'wait', l: 'Waiting for first sign-in', m: act };
  return { k: 'ok', l: 'Active', m: act };
}
function viewAdmin() {
  const people = S.roster.slice().sort((a, b) => (b.active - a.active) || (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.name.localeCompare(b.name)));
  const team = '<div class="card"><div class="cardHd"><h3>Team</h3><span class="sub">Everyone signs in with their own login</span><span style="flex:1"></span><button class="btn btn-act btn-sm" data-act="addStaff">' + ic('plus', 15) + 'Add person</button></div>' +
    '<div class="tblWrap"><table class="tbl"><thead><tr><th>Name</th><th>Username</th><th>Status</th><th class="hideM">Last sign-in</th><th></th></tr></thead><tbody>' +
    people.map(r => {
      const st = r.role === 'owner' ? { k: 'ok', l: 'Owner', m: S.members.find(m => m.staffId === r.sid && m.active) } : memberStatus(r.sid);
      const last = st.m && st.m.lastLogin ? fmtWhen(FB.tsMs ? FB.tsMs(st.m.lastLogin) : st.m.lastLogin) : '';
      return '<tr><td><div class="nameCell"><span class="av" data-sav="' + esc(r.sid) + '">' + esc(r.initials || initials(r.name)) + '</span><b>' + esc(r.name) + '</b></div></td><td class="small">' + esc(r.username || (r.role === 'owner' ? 'email login' : '')) + '</td>' +
        '<td><span class="stat ' + st.k + '">' + esc(st.l) + '</span></td><td class="hideM small muted">' + esc(last) + '</td><td style="text-align:right;white-space:nowrap">' +
        (r.role === 'owner' ? '' : r.active ? '<button class="btn btn-ghost" data-act="reissue" data-sid="' + esc(r.sid) + '">Reissue login</button><button class="btn btn-ghost" style="color:var(--coral-700)" data-act="removeStaff" data-sid="' + esc(r.sid) + '">Remove</button>'
          : '<button class="btn btn-ghost" data-act="readd" data-sid="' + esc(r.sid) + '">Add back</button>') + '</td></tr>';
    }).join('') + '</tbody></table></div>' +
    '<div class="cardBd" style="padding-top:2px;padding-bottom:4px">' + shBoxHTML() + '</div>' +
    '<div class="cardBd small muted" style="padding-top:10px">Forgot password? Use <b>Reissue login</b>: they get a new temporary password and choose their own at sign-in. Removing someone cuts their access immediately and changes the office key.</div></div>';
  const kv = (FB && FB.curV) || (DEMO && DEMO.curV) || 1;
  const sec = '<div class="card"><div class="cardHd"><h3>Security</h3></div><div class="cardBd">' +
    '<div class="field"><label for="idleSel">Lock after no activity</label><select id="idleSel" data-setting="idleMin">' + [5, 10, 15, 30, 60].map(n => '<option value="' + n + '"' + (Number(S.settings.idleMin || 10) === n ? ' selected' : '') + '>' + n + ' minutes</option>').join('') + '</select></div>' +
    '<div class="sec"><h5>Office key</h5><p class="small" style="margin-bottom:10px">Version ' + kv + '. Every case is sealed with it in the browser. It changes automatically when someone is removed.</p><button class="btn btn-sec btn-sm" data-act="rotate">' + ic('refresh', 15) + 'Change office key now</button></div>' +
    '<div class="sec"><h5>Recovery code</h5><p class="small" style="margin-bottom:10px">Unlocks the office data if you forget your password. Making a new one turns the old one off.</p><button class="btn btn-sec btn-sm" data-act="newCode">' + ic('key', 15) + 'Make a new recovery code</button></div>' +
    '<div class="sec"><h5>HIPAA checklist</h5><ul class="small" style="padding-left:18px;line-height:1.7">' +
    '<li>Google BAA accepted for this Firebase project (Google Cloud console → IAM &amp; Admin → HIPAA Business Associate Addendum → Review and accept)</li>' +
    '<li>Every person has their own login — no shared passwords</li><li>Patient cases no longer kept in Asana or Tally</li><li>Recovery code printed and stored safely</li></ul></div>' +
    '</div></div>';
  const defaults = '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Who gets new cases</h3><span class="sub">Default “assigned to” on the New case form</span></div><div class="cardBd"><div class="grid2">' +
    TYPES.filter(t => !t.legacy).map(t => '<div class="field"><label for="def-' + t.k + '">' + esc(t.l) + '</label><select id="def-' + t.k + '" data-act-def="' + t.k + '"><option value="">Automatic</option>' + activeRoster().map(r => '<option value="' + esc(r.sid) + '"' + (((S.settings.defaults || {})[t.k]) === r.sid ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select></div>').join('') +
    '</div><div class="small muted">Automatic: Oliv, Angel, Invisalign, appliances and MARPE go to Sarah; uLab, InSmile, retainers, mouthguards and study models to whoever creates the case; in-house aligners to Dr. A.</div></div></div>';
  const cost = v => v == null || v === '' ? '' : esc(String(v));
  const alCostCard = '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>In-house aligner cost</h3><span class="sub">For the estimate on in-house cases</span></div><div class="cardBd"><div class="grid2">' +
    '<div class="field"><label for="alPer">Per aligner ($)</label><input id="alPer" type="number" min="0" step="0.01" inputmode="decimal" placeholder="e.g. 4.50" data-setting="alPerAligner" value="' + cost(S.settings.alPerAligner) + '"></div>' +
    '<div class="field"><label for="alSetCost">Per set ($, optional)</label><input id="alSetCost" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" data-setting="alPerSet" value="' + cost(S.settings.alPerSet) + '"></div>' +
    '</div><div class="small muted">Per aligner: materials for one aligner (sheet, printed model, packaging). Per set: anything paid once per case, such as a setup fee. Estimate = per set + aligners × per aligner.</div></div></div>';
  const deleted = '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Deleted cases</h3><span class="sub">Last 90 days</span><span style="flex:1"></span><button class="btn btn-ghost" data-act="loadDeleted">' + ic('refresh', 15) + 'Load</button></div><div class="cardBd" id="delBox"><div class="small muted">Deleted cases can be brought back. Click Load.</div></div></div>';
  const actv = '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Recent activity</h3><span class="sub">Last 7 days</span><span style="flex:1"></span><button class="btn btn-ghost" data-act="loadActivity">' + ic('refresh', 15) + 'Load</button></div><div class="cardBd" id="actBox"><div class="small muted">Shows who changed what. Click Load.</div></div></div>';
  return rulesCardHTML() + '<div class="adminGrid"><div>' + team + defaults + shipWarnCardHTML() + alCostCard + noteInstrCardHTML() + rxAdminCardHTML() + '</div><div>' + sec + backupCardHTML() + (S.rulesOld ? '' : mailAdminHTML()) + actv + deleted + '</div></div>';
}
/* when the Not shipped labels show (Amir, 6 Oct 2026: "not sure if the 2 days is the best option"): orange and red, in business days
   before the delivery appt (see shipWarn in ui.js) */
function shipWarnCardHTML() {
  const w = shipWarnDays(), opt = (v, l, on) => '<option value="' + v + '"' + (on ? ' selected' : '') + '>' + l + '</option>', days = n => n + ' business day' + (n === 1 ? '' : 's') + ' before';
  return '<div class="card" style="margin-top:18px" id="shipWarnCard"><div class="cardHd"><h3>Not shipped warning</h3><span class="sub">Outside labs: a case not marked Shipped as its delivery appt gets close</span></div><div class="cardBd"><div class="grid2">' +
    '<div class="field"><label for="shipSoonSel"><span class="swDot soon"></span>Orange from</label><select id="shipSoonSel" data-setting="shipSoon">' + opt(0, 'Off', !w.soon) + [3, 4, 5, 6, 7, 10].map(n => opt(n, days(n), w.soon === n)).join('') + '</select></div>' +
    '<div class="field"><label for="shipLateSel"><span class="swDot late"></span>Red from</label><select id="shipLateSel" data-setting="shipLate">' + [1, 2, 3, 4, 5].map(n => opt(n, days(n), w.late === n)).join('') + '</select></div>' +
    '</div><div class="small muted">Orange “Not shipped yet” is the heads-up — time to call the lab; red “Not shipped” — it may not make it in time. For Oliv, Angel, Invisalign, uLab, InSmile and appliances, counted back from the delivery appt (or the expected delivery, shipped to the patient). Business days are Monday–Friday, without the office holidays. Orange shows only when it starts before red. The label goes away once the case is marked Shipped — the lab’s shipping email does that for uLab, Oliv, Angel, Partners and Specialty; Invisalign and InSmile are marked by hand.</div></div></div>';
}

/* the live security rules are older than this version of the app: the owner pastes the new ones into the Firebase console
   (they ship inside the page, so they always match it; the owner's own sign-in email is filled in here) */
const NLO_RULES = "__NLO_RULES__";
function rulesCardHTML() {
  if (!(S.rulesOld || S.rulesIdx) || !isOwner()) return '';
  const pid = (FB.cfg && FB.cfg.projectId) || '';
  const why = S.rulesOld ? 'Patient photos and email updates need them. Until then they stay hidden.'
    : 'They keep NLO Cases quick as completed cases pile up: each computer loads only the patients it shows. Everything works meanwhile.';
  return '<div class="card rulesCard" id="rulesCard"><div class="cardHd"><h3>One-time update: security rules</h3><span class="sub">' + why + '</span></div><div class="cardBd">' +
    '<ol class="small mlSteps"><li>Click <b>Copy the new rules</b>.</li><li>Click <b>Open the Firebase console</b> (the Google account that owns the project). Pick <b>Firestore Database</b> in the left menu (the stacked-lines icon under the gear), then the <b>Rules</b> tab.</li>' +
    '<li>Select everything in the editor, paste, and click <b>Publish</b>.</li><li>Come back here and click <b>Check again</b>.</li></ol>' +
    '<div class="pickRow" style="margin-top:10px"><button class="btn btn-pri btn-sm" data-act="rulesCopy">' + ic('download', 15) + 'Copy the new rules</button>' +
    '<a class="btn btn-sec btn-sm" href="https://console.firebase.google.com/project/' + esc(pid) + '/firestore" target="_blank" rel="noopener noreferrer">' + ic('ext', 15) + 'Open the Firebase console</a>' +
    '<button class="btn btn-ghost btn-sm" data-act="rulesCheck">' + ic('refresh', 15) + 'Check again</button></div></div></div>';
}
function viewImport() {
  return '<div class="adminGrid"><div><div class="card"><div class="cardHd"><h3>Import from Asana</h3></div><div class="cardBd">' +
    '<p class="small" style="margin-bottom:12px">Brings your Asana case tasks in here. It runs in this browser, so patient names go straight from Asana into the encrypted app. Cases already imported are skipped.</p>' +
    '<div class="sec" style="margin-top:4px"><h5>Option 1 — Asana token (all projects at once)</h5>' +
    '<p class="small muted" style="margin-bottom:8px">In Asana: profile photo → Settings → Apps → Developer apps → Create new token. Paste it here; it’s used once and not saved.</p>' +
    '<form id="asForm2"><div class="field"><label for="asTok">Personal access token</label><input id="asTok" type="password" autocomplete="off"></div>' +
    '<button class="btn btn-sec btn-sm" data-act="asLoad" type="submit">Load my Asana projects</button></form><div id="asProj" style="margin-top:12px"></div></div>' +
    '<div class="sec"><h5>Option 2 — CSV files</h5><p class="small muted" style="margin-bottom:8px">In each Asana project: ⌄ next to the name → Export/Print → CSV. Pick all the files together.</p>' +
    '<input type="file" id="csvFiles" accept=".csv,text/csv" multiple class="inp"></div>' +
    '<label class="small" style="display:flex;gap:8px;align-items:center;margin-top:14px"><input type="checkbox" id="impDelivered" checked> Leave out cases already delivered — sitting in the last column (Front desk pick up, Checked into Milestones, Checked In) with a date more than 7 days ago or none</label>' +
    '<label class="small" style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="impDone"> Also bring completed tasks (history)</label>' +
    '<div id="impPreview" style="margin-top:14px"></div></div></div></div>' +
    '<div><div class="card"><div class="cardHd"><h3>Export</h3></div><div class="cardBd"><p class="small" style="margin-bottom:12px">Downloads every case (open and completed) as a spreadsheet. <b>The file contains patient names</b> — keep it on an office computer and delete it when you’re done.</p>' +
    '<button class="btn btn-sec btn-sm" data-act="exportCSV">' + ic('download', 15) + 'Download all cases (CSV)</button></div></div></div></div>';
}
function viewAccount() {
  const me = B.me || {};
  return '<div class="card" style="max-width:520px"><div class="cardHd"><span class="av lg" data-sav="' + esc(me.staffId || '') + '">' + esc(initials(me.name)) + '</span><div><h3>' + esc(me.name || '') + '</h3><div class="sub">' + (me.role === 'owner' ? 'Owner · email login' : 'Username: ' + esc(me.username || '')) + '</div></div></div>' +
    '<div class="cardBd"><form id="pwForm"><div class="sec" style="margin-top:0"><h5>Change password</h5></div>' +
    '<div class="field"><label for="pwCur">Current password</label><input type="password" id="pwCur" autocomplete="current-password" required></div>' +
    '<div class="field"><label for="pwN1">New password</label><input type="password" id="pwN1" autocomplete="new-password" minlength="8" required></div>' +
    '<div class="field"><label for="pwN2">Type it again</label><input type="password" id="pwN2" autocomplete="new-password" minlength="8" required></div>' +
    '<button class="btn btn-pri" type="submit">Change password</button></form></div></div>' +
    '<div class="card" style="max-width:520px;margin-top:18px"><div class="cardHd"><h3>IPR Tracker link</h3></div><div class="cardBd">' + iprAccountHTML() + '</div></div>' +
    tourAccountHTML();
}

function iprAccountHTML() {
  const L = iprLink(); if (!L.init()) return '<div class="small muted">Not available in this browser.</div>';
  const u = L.user(); let last = 0; try { last = Number(localStorage.getItem('nloCases.iprSyncAt')) || 0; } catch (e) { }
  // (5 Oct 2026: every open aligner case's IPR chart is synced at once, and kept on the case for everyone)
  return u ? '<p class="small" style="margin-bottom:10px">Reading the IPR Tracker as <b>' + esc(u.email || 'signed in') + '</b> until you lock or sign out. Every open aligner case with a chart # gets its latest IPR chart, kept on the case for everyone' + (last ? ' — last synced from this computer ' + esc(fmtWhen(last)) : '') + '.</p>' +
      '<div class="pickRow"><button class="btn btn-sec btn-sm" data-act="iprSyncAll">' + ic('refresh', 15) + 'Sync all patients now</button><button class="btn btn-ghost btn-sm" data-act="iprDisconnect">Disconnect now</button></div>'
    : '<p class="small" style="margin-bottom:10px">Not connected. Connect with the Google account the IPR Tracker uses; it disconnects again when you lock or sign out. The IPR charts already synced stay on the cases.</p><button class="btn btn-sec btn-sm" data-act="iprConnect">Connect IPR Tracker</button>';
}
/* ---------- staff dialogs ---------- */
function issuedModal(name, res, reissue) {
  S.shownCode = res.temp;
  openModal('<h3>' + (reissue ? 'New login for ' : 'Login for ') + esc(name) + '</h3><div class="lsub">Give these to ' + esc(firstName(name)) + ' in person. The temporary password only works once.</div>' +
    '<div class="kv" style="margin-bottom:6px"><div><div class="k">Username</div><div class="v" style="font-size:18px">' + esc(res.username) + '</div></div><div><div class="k">Temporary password</div><div class="v" style="font-size:18px;font-family:ui-monospace,Menlo,monospace;user-select:all">' + esc(res.temp) + '</div></div></div>' +
    '<p class="small muted" style="margin:10px 0 4px">They open NLO Cases, sign in with these, then choose their own password.' + (reissue ? ' Their old password no longer works.' : '') + '</p>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="copyCode" data-code="' + esc('Username: ' + res.username + '  Temporary password: ' + res.temp) + '">Copy</button><button class="btn btn-pri" data-act="closeModal">Done</button></div>');
}
const ADMIN_ACTS = {
  addStaff(t, e, pre) { // pre: { name, username, rid } when picked from Staff Hub's roster
    openModal('<h3>Add a person</h3><div class="lsub">They get a username and a temporary password. They choose their own password the first time they sign in.</div><div id="asErr"></div><form id="asForm">' +
      '<div class="field"><label for="asName">Full name</label><input id="asName" required autocomplete="off"></div>' +
      '<div class="field"><label for="asUser">Username</label><input id="asUser" required autocomplete="off" autocapitalize="none" spellcheck="false"><div class="hint">Lowercase, no spaces. Usually their first name.</div></div>' +
      '<div class="mFt"><button class="btn btn-sec" type="button" data-act="closeModal">Cancel</button><button class="btn btn-pri" type="submit">Create login</button></div></form>', w => {
        const n = $('#asName', w), u = $('#asUser', w); let touched = false;
        u.addEventListener('input', () => { touched = true; });
        n.addEventListener('input', () => { if (!touched) u.value = slug(firstName(n.value)); });
        if (pre) { n.value = pre.name; u.value = pre.username; touched = true; $('button[type=submit]', w).focus(); }
        $('#asForm', w).onsubmit = async e => {
          e.preventDefault(); const btn = $('button[type=submit]', w); busyBtn(btn, true, 'Creating…');
          try { const r = await B.addStaff(n.value.trim(), u.value.trim(), pre && n.value.trim() === pre.name ? pre.rid : ''); issuedModal(n.value.trim(), r, false); }
          catch (x) { busyBtn(btn, false); $('#asErr', w).innerHTML = '<div class="lockErr">' + esc(errText(x)) + '</div>'; }
        };
      });
  },
  async reissue(t) {
    const r = staff(t.dataset.sid); if (!r) return;
    if (!await confirmBox('Reissue ' + firstName(r.name) + '’s login?', 'Their current password stops working and you’ll get a new temporary password to give them.', 'Reissue')) return;
    try { const res = await B.reissue(r.sid); issuedModal(r.name, res, true); } catch (x) { toast(errText(x), { bad: true }); }
  },
  async readd(t) {
    const r = staff(t.dataset.sid); if (!r) return;
    try { const res = await B.reissue(r.sid); issuedModal(r.name, res, true); } catch (x) { toast(errText(x), { bad: true }); }
  },
  async removeStaff(t) {
    const r = staff(t.dataset.sid); if (!r) return;
    if (!await confirmBox('Remove ' + r.name + '?', 'They lose access right away. The office key changes so cases are re-sealed under a key they never had. Cases assigned to them stay assigned until you change them.', 'Remove', true)) return;
    try { await B.removeStaff(r.sid); await rotateWithProgress('Removed ' + firstName(r.name) + '. Changing the office key…'); }
    catch (x) { toast(errText(x), { bad: true }); }
  },
  async rotate() {
    if (!await confirmBox('Change the office key?', 'Every case is re-sealed under a new key. Takes a few seconds. Anyone signed in keeps working.', 'Change key')) return;
    rotateWithProgress('Changing the office key…');
  },
  async newCode() {
    if (!await confirmBox('Make a new recovery code?', 'Your old recovery code will stop working.', 'Make new code')) return;
    try {
      const code = await B.newRecoveryCode(); S.shownCode = code;
      openModal('<h3>New recovery code</h3><div class="lsub">Print it or write it down. The old one no longer works.</div><div class="codeBox" id="recShow">' + esc(code) + '</div><div class="mFt"><button class="btn btn-sec" data-act="printCode">Print</button><button class="btn btn-pri" data-act="closeModal">I saved it</button></div>');
    } catch (x) { toast(errText(x), { bad: true }); }
  },
  async loadDeleted() {
    if (!$('#delBox')) return; $('#delBox').innerHTML = '<div class="small muted">Loading…</div>';
    try {
      const list = await B.deletedCases(90, Number(S.settings.pidx0) || 0); S.delList = list;
      const box = $('#delBox'); if (!box) return;
      box.innerHTML = list.length ? list.map((x, i) => '<div class="row" style="cursor:default"><span class="grow"><span class="pt">' + esc(x.data.patient || '(no name)') + '</span><span class="meta">' + esc(typeOf(x.data).l + ' · deleted ' + fmtWhen(x.at) + ' by ' + firstName(staffName(x.sid, x.sid))) + '</span></span><button class="btn btn-sec btn-sm" data-act="undelete" data-i="' + i + '">Restore</button></div>').join('')
        : '<div class="small muted">Nothing deleted in the last 90 days.</div>';
    } catch (x) { const box = $('#delBox'); if (box) box.innerHTML = '<div class="small" style="color:var(--coral-700)">' + esc(errText(x)) + '</div>'; }
  },
  async undelete(t) {
    const x = S.delList && S.delList[Number(t.dataset.i)]; if (!x) return;
    try { await B.undelete(x); toast((x.data.patient || 'Case') + ' restored'); ADMIN_ACTS.loadDeleted(); } catch (e) { toast(errText(e), { bad: true }); }
  },
  async loadActivity() {
    if (!$('#actBox')) return; $('#actBox').innerHTML = '<div class="small muted">Loading…</div>';
    try {
      const list = await B.activity(7); const box = $('#actBox'); if (!box) return;
      if (!list.length) { box.innerHTML = '<div class="small muted">No activity in the last 7 days.</div>'; return; }
      box.innerHTML = list.filter(x => x.a !== 'rekey').slice(0, 80).map(x => {
        const c = S.cases.get(x.caseId); const who = x.a === 'email' ? ((MAIL_CO[x.co] || {}).l || 'Lab') + ' email' : firstName(staffName(x.sid, x.sid));
        const what = { create: 'created', import: 'imported', stage: 'moved', comment: 'commented on', close: 'completed', reopen: 'reopened', assign: 'reassigned', edit: 'edited', restore: 'restored', delete: 'deleted', save: 'saved', rekey: 're-sealed', email: 'updated', photo: 'changed the photo of' }[x.a] || x.a;
        return '<div class="hist"><time>' + esc(fmtWhen(x.at)) + '</time><span><b>' + esc(who) + '</b> ' + esc(what) + ' ' + (c ? '<button class="linkBtn" data-act="open" data-id="' + esc(c.id) + '">' + esc(c.patient) + '</button>' : 'a completed case') + '</span></div>';
      }).join('');
    } catch (x) { const box = $('#actBox'); if (box) box.innerHTML = '<div class="small" style="color:var(--coral-700)">' + esc(errText(x)) + '</div>'; }
  },
  async exportCSV() {
    if (!await confirmBox('Download every case?', 'The file will contain patient names. Keep it on an office computer and delete it when you’re done.', 'Download')) return;
    try {
      const all = await B.loadAll();
      all.forEach(c => { c.assigneeLabel = staffName(c.assignee, c.assigneeName); });
      const head = ['Patient', 'Type', 'Detail', 'Stage', 'Status', 'Scan', 'Lab completion', 'Delivery appt', 'Assigned', 'Dr. A instructions', 'Patient CC', 'IPR & spacing', 'Notes', 'Chart #', 'Titan link', 'Also', 'Initial/refinement', 'Lab', 'Tooth chart', 'Aligners in set', 'Ship to patient', 'Records on file', 'Zoom call', 'Attachment templates', 'Arches treated', 'Treatment start', 'Expected removal'].join(',');
      const blob = new Blob(['﻿' + head + '\n' + all.map(caseToCSVRow).join('\n')], { type: 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'nlo-cases-' + todayISO() + '.csv'; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (x) { toast(errText(x), { bad: true }); }
  },
  async asLoad() {
    const tok = $('#asTok').value.trim(); const box = $('#asProj');
    if (!tok) { box.innerHTML = '<div class="lockErr">Paste your Asana token first.</div>'; return; }
    box.innerHTML = '<div class="small muted">Loading projects…</div>';
    try {
      const ws = await asana(tok, '/workspaces?limit=100');
      let projects = [];
      for (const w of ws.data) { const p = await asana(tok, '/projects?workspace=' + w.gid + '&archived=false&limit=100&opt_fields=name'); projects = projects.concat(p.data); }
      S.asTok = tok;
      box.innerHTML = '<div class="flabel">Projects to import</div>' + projects.map(p => {
        const t = typeFromProject(p.name); const on = !!t;
        return '<label class="small" style="display:flex;gap:8px;align-items:center;padding:4px 0"><input type="checkbox" class="asP" value="' + esc(p.gid) + '" data-name="' + esc(p.name) + '"' + (on ? ' checked' : '') + '> ' + esc(p.name) + (t ? ' <span class="badge ' + TYPE[t].cls + '">' + esc(TYPE[t].l) + '</span>' : ' <span class="small muted">(not a case project)</span>') + '</label>';
      }).join('') + '<button class="btn btn-sec btn-sm" style="margin-top:10px" data-act="asFetch">Preview import</button>';
    } catch (x) {
      box.innerHTML = '<div class="lockErr">' + esc(/Failed to fetch|NetworkError|TypeError/.test(String(x)) ? 'Asana didn’t allow this from the browser. Use the CSV option instead.' : errText(x)) + '</div>';
    }
  },
  async asFetch() {
    const picks = $$('.asP:checked'); const box = $('#impPreview'); box.innerHTML = '<div class="small muted">Reading tasks from Asana…</div>';
    const incDone = $('#impDone').checked;
    try {
      const rows = [];
      for (const p of picks) {
        let path = '/projects/' + p.value + '/tasks?limit=100&opt_fields=name,notes,due_on,completed,completed_at,assignee.name,memberships.section.name,memberships.project.gid' + (incDone ? '' : '&completed_since=now');
        while (path) {
          const r = await asana(S.asTok, path);
          r.data.forEach(t => {
            const mem = (t.memberships || []).find(m => m.project && m.project.gid === p.value) || (t.memberships || [])[0] || {};
            rows.push({ gid: t.gid, name: t.name, notes: t.notes, due: t.due_on || '', assignee: t.assignee ? t.assignee.name : '', section: mem.section ? mem.section.name : '', project: p.dataset.name, completed: t.completed, completedAt: t.completed_at || '' });
          });
          path = r.next_page ? r.next_page.path : null;
        }
      }
      // NL Lab cases in fabrication: their checklist (subtasks) says which step they're on
      for (const row of rows) {
        if (row.completed || !/fabrication/i.test(row.section)) continue;
        try { row.subtasks = (await asana(S.asTok, '/tasks/' + row.gid + '/subtasks?opt_fields=name,completed')).data; } catch (e) { }
      }
      S.asTok = ''; $('#asTok').value = '';
      previewImport(rows);
    } catch (x) { box.innerHTML = '<div class="lockErr">' + esc(errText(x)) + '</div>'; }
  },
  async doImport() {
    const list = S.impList || []; if (!list.length) return;
    const box = $('#impPreview');
    box.innerHTML = '<div class="small">Importing ' + list.length + ' cases…</div><div class="prog"><i id="impBar"></i></div>';
    try {
      await B.createCases(list.map(c => {
        const done = c._done; const closedAt = c._closedAt; const data = Object.assign({}, c); delete data._done; delete data._closedAt;
        data.createdAt = Date.now(); data.createdBy = meSid();
        return { data, status: done ? 'done' : 'open', closedAt, action: { a: 'import' } };
      }), (n, tot) => { const b = $('#impBar'); if (b) b.style.width = Math.round(n / tot * 100) + '%'; });
      S.impList = null; S.closedLoaded = false;
      box.innerHTML = '<div class="lockOk">Imported ' + list.length + ' cases. Check the Board, then archive or clean up the Asana projects.</div>';
    } catch (x) { box.innerHTML = '<div class="lockErr">' + esc(errText(x)) + ' — nothing after this point was imported. Run it again; finished ones are skipped.</div>'; }
  }
};
async function asana(tok, path) {
  const r = await fetch('https://app.asana.com/api/1.0' + path, { headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json' } });
  if (r.status === 401) throw errCode('asana-auth', 'Asana rejected that token.');
  if (!r.ok) throw errCode('asana', 'Asana error ' + r.status);
  return r.json();
}
async function previewImport(rows) {
  const incDone = $('#impDone').checked; $('#impPreview').innerHTML = '<div class="small muted">Checking what’s already here…</div>';
  let existing;
  try { existing = new Set((await B.loadAll()).map(c => c.src && c.src.asana).filter(Boolean)); } catch (e) { existing = new Set(); }
  const roster = S.roster.map(r => ({ sid: r.sid, name: r.name }));
  const list = []; let skipped = 0, doneSkipped = 0, delivered = 0;
  const skipDelivered = !$('#impDelivered') || $('#impDelivered').checked, weekAgo = addDays(todayISO(), -7);
  rows.forEach(t => {
    if (t.gid && existing.has(String(t.gid))) { skipped++; return; }
    if (t.completed && !incDone) { doneSkipped++; return; }
    const c = caseFromAsana(t, t.project, roster); if (!c.patient) return;
    // still open in Asana but already at the end (picked up / checked in) and not recent: delivered, so leave it out
    if (skipDelivered && !t.completed && typeOf(c).flow !== 'misc') {
      const st = flowOf(c).stages, when = c.deliveryDate || '';
      if (c.stage === st[st.length - 1][0] && (!when || when < weekAgo)) { delivered++; return; }
    }
    list.push(c);
  });
  S.impList = list; S.impRows = rows;
  const byType = {}; list.forEach(c => { const k = typeOf(c).l + (c._done ? ' (completed)' : ''); byType[k] = (byType[k] || 0) + 1; });
  const unmatched = Array.from(new Set(list.filter(c => c.assigneeName).map(c => c.assigneeName)));
  const box = $('#impPreview'); if (!box) return;
  box.innerHTML = '<div class="card" style="box-shadow:none"><div class="cardBd" style="padding:14px 16px">' +
    '<div class="flabel">Ready to import: ' + list.length + '</div>' +
    (list.length ? '<ul class="small" style="padding-left:18px;margin:6px 0 10px">' + Object.keys(byType).map(k => '<li>' + esc(k) + ': ' + byType[k] + '</li>').join('') + '</ul>' : '') +
    (skipped ? '<div class="small muted">' + skipped + ' already imported — skipped.</div>' : '') + (doneSkipped ? '<div class="small muted">' + doneSkipped + ' completed tasks left out.</div>' : '') + (delivered ? '<div class="small muted">' + delivered + ' already delivered (last column, older than a week) left out.</div>' : '') +
    (unmatched.length ? '<div class="notice" style="margin-top:10px">No login yet for: ' + esc(unmatched.join(', ')) + '. Their cases import with the name shown; add them on Team &amp; security first if you want them linked.</div>' : '') +
    (list.length ? '<button class="btn btn-pri btn-sm" style="margin-top:12px" data-act="doImport">Import ' + list.length + ' cases</button>' : '') + '</div></div>';
}
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'csvFiles' && t.files.length) {
    const rows = [];
    for (const f of t.files) {
      const text = await f.text(); const proj = f.name.replace(/\.csv$/i, '');
      asanaRowsFromCSV(text).forEach(r => { r.project = typeFromProject(r.project) ? r.project : proj; rows.push(r); });
    }
    previewImport(rows);
  }
  if (t.id === 'impDelivered' && S.impRows) previewImport(S.impRows);
  if (t.dataset && t.dataset.actDef) {
    const defs = Object.assign({}, S.settings.defaults || {}); defs[t.dataset.actDef] = t.value;
    act(() => B.saveSettings({ defaults: defs }), 'Saved');
  }
});
document.addEventListener('submit', async e => {
  if (e.target.id === 'asForm2') { e.preventDefault(); return; }
  if (e.target.id !== 'pwForm') return; e.preventDefault();
  const cur = $('#pwCur').value, a = $('#pwN1').value, b = $('#pwN2').value;
  if (a.length < 8) return toast('Use at least 8 characters.', { bad: true });
  if (a !== b) return toast('The two new passwords don’t match.', { bad: true });
  const btn = $('#pwForm button[type=submit]'); busyBtn(btn, true, 'Changing…');
  try { await B.changePassword(cur, a); toast('Password changed'); e.target.reset(); }
  catch (x) { toast(/invalid-credential|wrong-password/.test(x.code || '') ? 'Current password is wrong.' : errText(x), { bad: true }); }
  busyBtn(btn, false);
});
async function rotateWithProgress(title) {
  openModal('<h3>Office key</h3><div class="lsub" id="rotMsg">' + esc(title) + '</div><div class="prog"><i id="rotBar"></i></div>');
  try {
    const r = await B.rotate((n, tot) => { const b = $('#rotBar'); if (b) b.style.width = Math.round(n / tot * 100) + '%'; });
    closeModal();
    toast('Office key changed. ' + r.cases + ' case' + (r.cases === 1 ? '' : 's') + (r.photos ? ' and ' + r.photos + ' photo' + (r.photos === 1 ? '' : 's') : '') + ' re-sealed.' + (r.pendingInvites ? ' ' + r.pendingInvites + ' unused invite(s) need reissuing.' : '') + (r.badKeys && r.badKeys.length ? ' Couldn’t give the new key to ' + r.badKeys.join(', ') + ' — reissue their login.' : ''), { ms: 9000 });
    queueRender();
  } catch (x) { closeModal(); toast('Key change stopped: ' + errText(x) + '. Run “Change office key now” again.', { bad: true, ms: 8000 }); }
}
Object.assign(ADMIN_ACTS, {
  async rulesCopy() {
    const email = String((FB.auth && FB.auth.currentUser && FB.auth.currentUser.email) || '').toLowerCase();
    if (!email || NLO_RULES.indexOf('__OWNER_EMAIL__') < 0) { toast('Couldn’t prepare the rules — sign in again and retry.', { bad: true }); return; }
    const ok = await copyText(NLO_RULES.replace('__OWNER_EMAIL__', email));
    toast(ok ? 'Rules copied. Paste them in Firestore Database → Rules, then Publish.' : 'Couldn’t copy. Try again.', ok ? { ms: 8000 } : { bad: true });
  },
  async rulesCheck(t) {
    busyBtn(t, true, 'Checking…'); const photosOff = !!S.rulesOld;
    const ok = await rulesCheck(); busyBtn(t, false);
    toast(ok ? 'The security rules are up to date.' + (photosOff ? ' Photos and email updates are on.' : '') : 'Still the old rules. Publish them in the Firebase console, wait a minute, then check again.', ok ? {} : { bad: true });
    queueRender('team');
  }
});

/* ---------- Team from Staff Hub's office roster (Amir: "for the team, can I just add from staff hub?")
   Staff Hub shares a basic roster (name they go by, title, active / last day, photo) in the nlo-inventory database,
   which Cadence, the calendar and the IPR Tracker already follow. Here it's read with the IPR link's Google sign-in
   (it ends when NLO Cases locks). Logins are still made here: each person's own password unlocks the office key. ---------- */
const SH = { data: null, err: '', loading: false, at: 0 };
function shPeople() { return Object.values((SH.data && SH.data.people) || {}).filter(p => p && p.id && p.name); }
function shNorm(s) { return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^dr\.?\s+/, '').replace(/[^a-z\s'-]/g, ' ').replace(/\s+/g, ' ').trim(); }
/* this NLO Cases person in the roster: by the id saved when they were added from it, else by name */
function shMatch(r, people) {
  if (r.rid) return people.find(p => p.id === r.rid) || null;
  const n = shNorm(r.name), parts = n.split(' '), f = parts[0] || '', l = parts.length > 1 ? parts[parts.length - 1] : '';
  let hit = people.filter(p => shNorm(p.name) === n); if (hit.length === 1) return hit[0];
  hit = people.filter(p => [p.first, p.nick].some(x => x && shNorm(x) === f) && (!l || !p.last || shNorm(p.last) === l));
  return hit.length === 1 ? hit[0] : null;
}
function shGone(p) { return p.active === false || (!!p.end && p.end < todayISO()); }
function shState() {
  const people = shPeople(), used = new Set(), link = new Map();
  S.roster.forEach(r => { const p = shMatch(r, people); if (p) { used.add(p.id); link.set(r.sid, p); } });
  const add = people.filter(p => !used.has(p.id) && !shGone(p) && p.id !== 's_amir').sort((a, b) => a.name.localeCompare(b.name));
  const mine = S.roster.filter(r => r.active && r.role !== 'owner' && link.has(r.sid));
  return { add, left: mine.filter(r => shGone(link.get(r.sid))).map(r => ({ r, p: link.get(r.sid) })),
    leaving: mine.filter(r => !shGone(link.get(r.sid)) && link.get(r.sid).end).map(r => ({ r, p: link.get(r.sid) })), linked: link.size };
}
function shUsername(p) {
  const taken = u => S.roster.some(r => r.sid === u || r.username === u);
  const f = slug(p.first || firstName(p.name)), l = slug(p.last || '').slice(0, 1);
  if (f && !taken(f)) return f; if (f && l && !taken(f + l)) return f + l;
  for (let i = 2; i < 20; i++) if (!taken(f + i)) return f + i;
  return f;
}
async function shLoad() {
  if (SH.loading) return; SH.loading = true; SH.err = '';
  try { SH.data = (await iprLink().roster()) || { people: {} }; SH.at = Date.now(); shPhotos(); }
  catch (e) { SH.data = null; SH.err = /permission|denied/i.test(String(e && (e.code || e.message))) ? 'This Google account can’t read the office roster. Connect with the account Staff Hub shares it with.' : 'Couldn’t reach the office roster. Check the connection and try again.'; }
  SH.loading = false; if (S.view === 'admin') queueRender('team');
}
function shPhoto(p) { const el = '<span class="av shAv"' + (p.photo ? ' data-shph="' + esc(p.id) + '"' : '') + '>' + esc(initials(p.name)) + '</span>'; return el; }
function shBoxHTML() {
  const L = iprLink(), head = '<div class="shBox" id="shBox"><div class="shHd"><b>From Staff Hub</b><span class="small muted">the office roster Cadence and the IPR Tracker follow</span>';
  if (!L.init()) return head + '</div><p class="small muted">Not available in this browser.</p></div>';
  if (!L.user()) return head + '</div><p class="small" style="margin:4px 0 10px">Pick people from Staff Hub’s roster instead of typing them in, and see who has left.</p>' +
    '<button class="btn btn-sec btn-sm" data-act="shConnect">' + ic('team', 15) + 'Connect to the office roster</button><p class="small muted" style="margin-top:6px">Uses the Google sign-in the IPR Tracker link uses. It ends when NLO Cases locks.</p></div>';
  if (SH.err) return head + '</div><p class="small" style="color:var(--coral-700);margin:6px 0 8px">' + esc(SH.err) + '</p><button class="btn btn-ghost btn-sm" data-act="shRefresh">' + ic('refresh', 15) + 'Try again</button></div>';
  if (!SH.data) { shLoad(); return head + '</div><p class="small muted">Loading the office roster…</p></div>'; }
  if (Date.now() - SH.at > 30000 && !SH.loading) shLoad(); // read again when Team & security is opened later (shows the last copy meanwhile)
  const st = shState(), when = SH.data.updatedAt ? fmtWhen(SH.data.updatedAt) : '';
  const row = (p, right, note) => '<div class="shRow">' + shPhoto(p) + '<div class="shWho"><b>' + esc(p.name) + '</b><span class="small muted">' + esc([p.title, note].filter(Boolean).join(' · ')) + '</span></div>' + right + '</div>';
  return head + '<span style="flex:1"></span><button class="btn btn-ghost btn-sm" data-act="shRefresh" title="Read the roster again">' + ic('refresh', 15) + 'Refresh</button></div>' +
    (st.left.length ? '<div class="shGrp bad"><h6>Left the practice — remove their login</h6>' + st.left.map(x => row(x.p, '<button class="btn btn-sec btn-sm" style="color:var(--coral-700)" data-act="removeStaff" data-sid="' + esc(x.r.sid) + '">Remove login</button>', 'last day ' + (x.p.end ? fmtDate(x.p.end) : 'passed'))).join('') + '</div>' : '') +
    (st.add.length ? '<div class="shGrp"><h6>No NLO Cases login yet</h6>' + st.add.map(p => row(p, '<button class="btn btn-act btn-sm" data-act="shAdd" data-rid="' + esc(p.id) + '">' + ic('plus', 14) + 'Add</button>', p.end ? 'leaving ' + fmtDate(p.end) : '')).join('') + '</div>' : '') +
    (st.leaving.length ? '<div class="shGrp"><h6>Leaving soon</h6>' + st.leaving.map(x => row(x.p, '<span class="small muted">remove on ' + esc(fmtDate(x.p.end)) + '</span>', '')).join('') + '</div>' : '') +
    (!st.add.length && !st.left.length ? '<p class="small" style="margin:6px 0 2px;color:var(--mint-700)">' + ic('done', 15) + ' Everyone on Staff Hub’s roster has a login, and nobody who left still does.</p>' : '') +
    '<p class="small muted shFoot">' + st.linked + ' linked' + (when ? ' · roster shared ' + esc(when) : '') + '. Add a hire or end someone’s employment in Staff Hub; it shows up here.</p></div>';
}
/* bring each linked person's Staff Hub photo onto their NLO Cases roster entry (Amir: "import staff photos"), so everyone sees it,
   staff included (they don't sign in to Staff Hub). Shrunk to 96 px; only when the Staff Hub photo has changed — and only ever
   adding or replacing one, never removing it. */
async function shPhotos() {
  if (!isOwner() || !B.setStaffPhoto || SH.syncing) return; SH.syncing = true; let n = 0;
  try {
    const people = shPeople();
    for (const r of S.roster) {
      const p = shMatch(r, people); if (!p) continue;
      const src = /^data:image\/(jpeg|png|webp);base64,/.test(p.photo || '') ? p.photo : '';
      // no photo on Staff Hub's side never takes one away here (Amir, 5 Oct 2026: the staff photos were gone everywhere — Staff
      // Hub's record had been overwritten by an older copy on 4 Oct, and this followed it); a new photo there still replaces it
      if (!src) continue;
      const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', TE.encode(src))).subarray(0, 8), b => b.toString(16).padStart(2, '0')).join('');
      if ((r.photoSrc || '') === h) continue;
      const small = await shrinkPhoto(src, 96); if (!small) continue;
      await B.setStaffPhoto(r.sid, small, h); n++;
    }
  } catch (e) { } finally { SH.syncing = false; }
  if (n) toast(n + ' staff photo' + (n > 1 ? 's' : '') + ' brought in from Staff Hub');
}
function shrinkPhoto(src, px) {
  return new Promise(res => {
    const im = new Image();
    im.onload = () => { try { const c = document.createElement('canvas'); c.width = c.height = px; const g = c.getContext('2d'), s = Math.min(im.naturalWidth, im.naturalHeight);
      g.fillStyle = '#fff'; g.fillRect(0, 0, px, px); g.imageSmoothingQuality = 'high';
      g.drawImage(im, (im.naturalWidth - s) / 2, (im.naturalHeight - s) / 2, s, s, 0, 0, px, px); res(c.toDataURL('image/jpeg', 0.85)); } catch (e) { res(''); } };
    im.onerror = () => res(''); im.src = src;
  });
}
/* staff photos from Staff Hub (data: URLs from the roster) are set after drawing, like the company logos */
function shPaint() { $$('[data-shph]').forEach(el => { const p = shPeople().find(x => x.id === el.dataset.shph); if (p && /^data:image\/jpeg;base64,/.test(p.photo || '')) { el.textContent = ''; const im = document.createElement('img'); im.alt = ''; im.src = p.photo; el.appendChild(im); el.classList.add('ph'); } }); }
Object.assign(ADMIN_ACTS, {
  shConnect(t) { busyBtn(t, true, 'Connecting…'); iprLink().connect().then(() => { SH.data = null; SH.err = ''; queueRender('team'); }).catch(x => { busyBtn(t, false); if (!/popup-closed|cancelled-popup/.test(String(x && x.code))) toast(errText(x), { bad: true }); }); },
  shRefresh() { SH.data = null; SH.err = ''; queueRender('team'); },
  shAdd(t) { const p = shPeople().find(x => x.id === t.dataset.rid); if (p) ADMIN_ACTS.addStaff(t, null, { name: p.name, username: shUsername(p), rid: p.id }); }
});

/* ---------- backups (Amir, 4 Oct 2026: "how can this app back it self up? I'm afraid ... all the data will be lost") ----------
   Google keeps the whole database: a backup every day for 14 weeks, and a rewind to any minute of the last 7 days (turned on in
   the Firebase console, 4 Oct 2026). This is a copy outside Google, in the office: every case as it is now, open and completed,
   with its photo, the team list and the settings, sealed as they're stored (FB.backupDump) — so it opens only in NLO Cases, with
   this office's key or the recovery code. Restore brings back the cases that aren't here; nothing that's here is changed. */
const BK_DAYS = 30; // Today asks for a new one after this many days
function bkLast() { const lb = S.settings.lastBackup; return lb && lb.at ? lb : null; }
function backupCardHTML() {
  const lb = bkLast();
  return '<div class="card" style="margin-top:18px" id="backupCard"><div class="cardHd"><h3>Backups</h3><span class="sub">Two copies, kept apart</span></div><div class="cardBd">' +
    '<p class="small" style="margin-bottom:8px"><b>Google</b> keeps a backup of the whole database every day for 14 weeks, and can rewind it to any minute in the past 7 days.</p>' +
    '<p class="small" style="margin-bottom:10px"><b>Yours:</b> about once a month, download a backup and save it on the office server. It’s sealed with the office key: it opens only in NLO Cases — here, or with your recovery code in an office set up again.</p>' +
    '<div class="small" style="margin-bottom:12px" id="bkLast">Last backup: ' + (lb ? '<b>' + esc(fmtWhen(lb.at)) + '</b>' + (lb.cases != null ? ' · ' + lb.cases + ' case' + (lb.cases === 1 ? '' : 's') : '') : '<b>none yet</b>') + '</div>' +
    '<div class="pickRow"><button class="btn btn-pri btn-sm" data-act="backupNow">' + ic('download', 15) + 'Download a backup</button>' +
    '<button class="btn btn-sec btn-sm" data-act="backupRestore">' + ic('refresh', 15) + 'Restore from a backup</button></div></div></div>';
}
/* Today, for Dr. A: time for a new one (none yet, or the last one is over a month old) — "Later" waits a week on this computer */
function backupDueHTML() {
  if (!isOwner() || S.tour || !S.settingsLoaded || !S.cases.size) return '';
  const lb = bkLast(), age = lb ? Math.floor((Date.now() - lb.at) / 864e5) : null;
  if (lb && age < BK_DAYS) return '';
  let later = 0; try { later = Number(localStorage.getItem('nloCases.backupLater')) || 0; } catch (e) { }
  if (Date.now() < later) return '';
  return '<div class="card bkDue" id="bkDue"><div class="cardBd">' + ic('shield', 20) + '<span class="grow"><b>Time to download a backup.</b> ' +
    (lb ? 'The last one was ' + age + ' days ago.' : 'There isn’t one yet.') + ' Save it on the office server, away from Google’s copies.</span>' +
    '<button class="btn btn-pri btn-sm" data-act="backupNow">' + ic('download', 15) + 'Download a backup</button><button class="btn btn-ghost btn-sm" data-act="backupLater">Later</button></div></div>';
}
/* the file: gzip-compressed JSON (plain JSON where the browser can't compress) */
async function bkBlob(json) {
  if (typeof CompressionStream === 'undefined') return { blob: new Blob([json], { type: 'application/json' }), ext: '.json' };
  const gz = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  return { blob: new Blob([gz], { type: 'application/gzip' }), ext: '.json.gz' };
}
async function bkRead(f) {
  const buf = new Uint8Array(await f.arrayBuffer()); let text;
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw errCode('backup-browser');
    try { text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); } catch (e) { throw errCode('backup-bad'); }
  } else text = TD.decode(buf);
  let o; try { o = JSON.parse(text); } catch (e) { throw errCode('backup-bad'); }
  if (!o || o.kind !== 'nlo-cases-backup' || !Array.isArray(o.cases)) throw errCode('backup-bad');
  if (Number(o.ver) > 1) throw errCode('backup-newer');
  return o;
}
/* a case body without the fields the database adds around it, written with its keys in order (to compare two copies) */
const BK_META = ['id', 'rev', 'v', 'status', 'by', 'updatedAt', 'createdAtSrv', 'closedAt', 'locked', 'assigneeLabel'];
function bkBody(c) { const o = {}; Object.keys(c || {}).filter(k => !BK_META.includes(k)).sort().forEach(k => { o[k] = c[k]; }); return o; }
function bkCanon(v) { return JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x); }
/* the backup set against what's in NLO Cases now: missing (not here — not even brought back before, under a new id), changed */
async function bkCompare(opened) {
  const live = await B.loadAll();
  const byId = new Map(live.map(c => [c.id, c])), sigs = new Set(live.map(c => caseSig(c)).filter(Boolean));
  const missing = [], changed = []; let here = 0, locked = 0;
  for (const x of opened.cases) {
    if (x.locked) { locked++; continue; }
    const l = byId.get(x.id);
    if (l) { here++; if (bkCanon(bkBody(l)) !== bkCanon(bkBody(x.data))) changed.push(x); continue; }
    if (sigs.has(caseSig(x.data))) { here++; continue; }
    missing.push(x);
  }
  missing.sort((a, b) => String(a.data.patient || '').localeCompare(String(b.data.patient || '')));
  return { missing, changed, here, locked };
}
function bkHeadHTML(file) {
  const n = file.cases.length, done = file.cases.filter(c => c.status === 'done').length;
  return '<div class="bkHead"><b>Backup of ' + esc(fmtWhen(file.at)) + '</b><span class="small muted">' + esc((file.by ? 'by ' + file.by + ' · ' : '') + n + ' case' + (n === 1 ? '' : 's') + (done ? ' (' + done + ' completed)' : '') + ((file.photos || []).length ? ' · ' + file.photos.length + ' photo' + (file.photos.length === 1 ? '' : 's') : '')) + '</span></div>';
}
async function bkLoad(f, code) {
  const box = $('#bkBox'); if (!box) return;
  box.innerHTML = '<div class="small muted">' + (code ? 'Opening the backup…' : 'Reading the backup…') + '</div>';
  let file;
  try {
    file = S.bk && S.bk.f === f ? S.bk.file : await bkRead(f);
    S.bk = { f, file };
    const opened = await B.backupOpen(file, code);
    box.innerHTML = bkHeadHTML(file) + '<div class="small muted">Comparing it with NLO Cases…</div>';
    const cmp = await bkCompare(opened); if (!$('#bkBox')) return;
    S.bk = { f, file, opened, cmp };
    bkShow();
  } catch (e) {
    const b = $('#bkBox'); if (!b) return;
    if (file && e && (e.code === 'backup-needs-code' || (e.code === 'bad-code' && code))) {
      b.innerHTML = bkHeadHTML(file) + '<div class="notice" style="margin:8px 0 10px">This backup is from before the office was set up again, so it opens with the recovery code you had when it was made.</div>' +
        (e.code === 'bad-code' ? '<div class="lockErr">' + esc(errText(e)) + '</div>' : '') +
        '<form id="bkCodeForm"><div class="field"><label for="bkCode">Recovery code</label><input id="bkCode" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" required></div>' +
        '<button class="btn btn-pri btn-sm" type="submit">Open the backup</button></form>';
      const fm = $('#bkCodeForm'); $('#bkCode').focus();
      fm.onsubmit = ev => { ev.preventDefault(); bkLoad(f, $('#bkCode').value); };
      return;
    }
    b.innerHTML = (file ? bkHeadHTML(file) : '') + '<div class="lockErr">' + esc(errText(e)) + '</div>';
  }
}
function bkShow() {
  const box = $('#bkBox'), bk = S.bk; if (!box || !bk || !bk.cmp) return;
  const { file, opened, cmp } = bk, m = cmp.missing;
  const who = sid => firstName(staffName(sid, '')) || '';
  const row = x => '<label class="oldRow"><input type="checkbox" data-bk="' + esc(x.id) + '" checked><span class="pt">' + esc(x.data.patient || '(no name)') + '</span>' +
    '<span class="small muted">' + esc(typeOf(x.data).l + ' · ' + (x.status === 'done' ? 'completed' : stageLabel(x.data)) + (who(x.data.assignee) ? ' · ' + who(x.data.assignee) : '')) + '</span>' +
    '<span class="small oldD">' + esc(x.data.createdAt ? fmtDate(isoOf(new Date(x.data.createdAt))) : '') + '</span></label>';
  const team = (file.roster || []).filter(r => r.active && r.role !== 'owner' && r.username).map(r => r.username);
  box.innerHTML = bkHeadHTML(file) +
    (opened.foreign ? '<div class="notice" style="margin:8px 0">Opened with the recovery code. Cases brought back are sealed with this office’s key.</div>' : '') +
    (m.length ? '<div class="flabel" style="margin-top:10px">Not in NLO Cases now: ' + m.length + '</div><div class="oldList bkList">' + m.map(row).join('') + '</div>' +
      (opened.foreign && file.settings && Object.keys(file.settings).length ? '<label class="small" style="display:flex;gap:8px;align-items:center;margin:8px 0 0"><input type="checkbox" id="bkSettings" checked> Also bring back the settings (Lab Rx details, who gets new cases, aligner cost)</label>' : '') +
      '<div class="oldAct"><b id="bkStatus">' + m.length + ' ticked</b><span style="flex:1"></span><button class="btn btn-pri btn-sm" data-act="bkBring">' + ic('refresh', 15) + '<span id="bkBringL">Bring back ' + m.length + '</span></button></div>'
      : '<div class="lockOk" style="margin-top:10px">Every case in this backup is in NLO Cases.</div>') +
    (cmp.changed.length ? '<p class="small muted" style="margin-top:10px">' + cmp.changed.length + ' case' + (cmp.changed.length === 1 ? ' has' : 's have') + ' changed since this backup. Each one’s earlier versions are kept in NLO Cases — open it and use Versions.</p>' : '') +
    (cmp.locked ? '<p class="small muted">' + cmp.locked + ' case' + (cmp.locked === 1 ? '' : 's') + ' in it couldn’t be opened.</p>' : '') +
    (opened.foreign && team.length ? '<p class="small muted">Add the team again in Team &amp; security with the same usernames (' + esc(team.join(', ')) + '), so their cases stay assigned to them.</p>' : '');
  box.querySelectorAll('input[data-bk]').forEach(i => i.addEventListener('change', () => {
    const n = $$('#bkBox input[data-bk]').filter(x => x.checked).length;
    const st = $('#bkStatus'), l = $('#bkBringL'), b = $('[data-act=bkBring]'); if (st) st.textContent = n + ' ticked'; if (l) l.textContent = 'Bring back ' + n; if (b) b.disabled = !n;
  }));
}
Object.assign(ADMIN_ACTS, {
  async backupNow(t) {
    busyBtn(t, true, 'Preparing…');
    try {
      const dump = await B.backupDump();
      const file = Object.assign({ kind: 'nlo-cases-backup', ver: 1, at: Date.now(), by: (B.me && B.me.name) || '', office: (B === FB && FB.cfg && FB.cfg.projectId) || 'demo' }, dump);
      const { blob, ext } = await bkBlob(JSON.stringify(file));
      const d = new Date(file.at), name = 'nlo-cases-backup-' + isoOf(d) + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + ext;
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      await B.saveSettings({ lastBackup: { at: file.at, by: meSid(), cases: dump.cases.length } });
      toast('Backup downloaded: ' + dump.cases.length + ' case' + (dump.cases.length === 1 ? '' : 's') + '. Save ' + name + ' on the office server.', { ms: 9000 });
      queueRender();
    } catch (x) { toast(errText(x), { bad: true }); }
    busyBtn(t, false);
  },
  backupLater() { try { localStorage.setItem('nloCases.backupLater', String(Date.now() + 7 * 864e5)); } catch (e) { } const c = $('#bkDue'); if (c) c.remove(); toast('Asking again in a week.'); },
  backupRestore() {
    S.bk = null;
    openModal('<h3>Restore from a backup</h3><div class="lsub">Brings back cases that aren’t in NLO Cases anymore, as they were in the backup. Nothing that’s here is changed.</div>' +
      '<div class="field"><label for="bkFile">Backup file</label><input type="file" id="bkFile" accept=".gz,.json,application/gzip,application/json" class="inp"><div class="hint">nlo-cases-backup-….json.gz, from the office server</div></div>' +
      '<div id="bkBox"></div><div class="mFt"><button class="btn btn-sec" type="button" data-act="closeModal">Close</button></div>', w => {
        w.querySelector('.modal').classList.add('wide');
        $('#bkFile', w).addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) { S.bk = null; bkLoad(f); } });
      });
  },
  async bkBring(t) {
    const bk = S.bk; if (!bk || !bk.cmp) return;
    const ids = new Set($$('#bkBox input[data-bk]').filter(i => i.checked).map(i => i.dataset.bk));
    const pick = bk.cmp.missing.filter(x => ids.has(x.id)); if (!pick.length) return;
    const withSettings = !!($('#bkSettings') && $('#bkSettings').checked);
    $$('#bkBox input, #bkBox button').forEach(x => { x.disabled = true; });
    const st = $('#bkStatus'); if (st) st.innerHTML = 'Bringing back… <span class="prog" style="display:inline-block;width:120px;vertical-align:middle"><i id="bkBar"></i></span>';
    try {
      await B.createCases(pick.map(x => {
        const data = JSON.parse(JSON.stringify(x.data)), photo = bk.opened.photos.get(x.id) || null; if (!photo) delete data.photo;
        return { data, status: x.status, closedAt: x.closedAt || Date.now(), photo, action: { a: 'restore', from: 'backup', at: bk.file.at } };
      }), (n, tot) => { const b = $('#bkBar'); if (b) b.style.width = Math.round(n / tot * 100) + '%'; });
      if (withSettings) { const s = Object.assign({}, bk.file.settings); ['lastBackup', 'pidx', 'pidx0', 'idleMin'].forEach(k => delete s[k]); await B.saveSettings(s); }
      histReset(); S.closedLoaded = false; queueRender();
      toast(pick.length + ' case' + (pick.length === 1 ? '' : 's') + ' brought back from the backup', { ms: 6000 });
    } catch (x) { toast(errText(x) + ' — run it again; the ones already back are skipped.', { bad: true, ms: 9000 }); }
    // what's left to bring back (by now, normally nothing)
    try { const cmp = await bkCompare(bk.opened); if (S.bk === bk) { bk.cmp = cmp; bkShow(); } } catch (e) { }
  }
});

/* =====================================================================
   Chart note: what the patient was told (Amir, 5 Oct 2026: "it should say instructed pt to stay in the last set night time
   only. no elastics with aligners etc. that instruction will be different if it's initial delivery, refinement, appliance
   delivery so on so forth"). One row per kind of case (NOTE_KINDS, ui.js), folded to its two lines; open it to word the
   scan visit's and the delivery visit's. Each box saves when it's left; empty = nothing added; the suggested wording
   comes back with one button.
   ===================================================================== */
function noteInstrCardHTML() {
  const short = t => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t ? (t.length > 64 ? t.slice(0, 62).trim() + '…' : t) : 'nothing added'; };
  const row = x => {
    const own = noteInstrOwn(x.k, 'scan') || noteInstrOwn(x.k, 'del');
    const box = (v, l) => { const id = 'ni-' + x.k + '-' + v;
      return '<div class="field"><label for="' + id + '">' + l + '</label><textarea id="' + id + '" rows="3" maxlength="800" data-ni="' + x.k + '.' + v + '" placeholder="Nothing added">' + esc(noteInstr(x.k, v)) + '</textarea></div>'; };
    return '<details class="niRow" id="niRow-' + x.k + '" data-nk="' + x.k + '"' + (S.niOpen && S.niOpen.has(x.k) ? ' open' : '') + '><summary>' +
      '<span class="niName"><b>' + esc(noteKindLabel(x)) + '</b>' + (own ? '<span class="niOwn">your wording</span>' : '') + '</span>' +
      '<span class="niSum"><span><i>Scan</i> ' + esc(short(noteInstr(x.k, 'scan'))) + '</span><span><i>Delivery</i> ' + esc(short(noteInstr(x.k, 'del'))) + '</span></span></summary>' +
      '<div class="niBd">' + (x.s ? '<div class="small muted" style="margin-bottom:8px">' + esc(x.s.charAt(0).toUpperCase() + x.s.slice(1)) + '.</div>' : '') +
      box('scan', 'At the scan visit') + box('del', 'At the delivery visit') +
      (own ? '<button type="button" class="btn btn-ghost btn-sm" data-act="niReset" data-nk="' + x.k + '">' + ic('refresh', 15) + 'Back to the suggested wording</button>' : '') + '</div></details>';
  };
  return '<div class="card" style="margin-top:18px" id="niCard"><div class="cardHd"><h3>Chart note</h3><span class="sub">What the patient was told, for each kind of case</span></div><div class="cardBd">' +
    '<p class="small" style="margin:0 0 4px">Each case’s chart note has a <b>Scan visit</b> and a <b>Delivery visit</b> version, and adds what’s here for that kind of case. ' +
    'Tap a row to change its wording; an empty box adds nothing.</p>' +
    NOTE_GROUPS.map(g => '<h5 class="niGrp">' + esc(g.l) + (g.s ? ' <span class="h5n">' + esc(g.s) + '</span>' : '') + '</h5>' + NOTE_KINDS.filter(x => x.g === g.g).map(row).join('')).join('') +
    '</div></div>';
}
/* a box left: its wording saved (the suggested wording again = nothing of our own saved, so it follows later suggestions) */
document.addEventListener('change', e => {
  const t = e.target; if (!t || !t.dataset || !t.dataset.ni || !isOwner()) return;
  const [k, v] = t.dataset.ni.split('.'); if (!NOTE_KIND[k] || (v !== 'scan' && v !== 'del')) return;
  const val = noteInstrClean(t.value).slice(0, 800), mine = val === noteInstrClean(noteInstrDef(k, v)) ? null : val;
  if (mine === (noteInstrOwn(k, v) ? noteInstrClean(noteInstrSaved()[k + '.' + v]) : null)) return; // (nothing changed)
  act(() => B.saveSettings({ noteInstr: { [k + '.' + v]: mine } }), mine === '' ? 'Saved — nothing added at that visit' : 'Saved');
});
/* which rows are open, so a redraw (a save, a live update) keeps them open */
document.addEventListener('toggle', e => {
  const d = e.target; if (!d || !d.classList || !d.classList.contains('niRow')) return;
  S.niOpen = S.niOpen || new Set(); if (d.open) S.niOpen.add(d.dataset.nk); else S.niOpen.delete(d.dataset.nk);
}, true);
Object.assign(ADMIN_ACTS, {
  niReset(t) { const k = t.dataset.nk; if (!NOTE_KIND[k]) return; (S.niOpen = S.niOpen || new Set()).add(k);
    act(() => B.saveSettings({ noteInstr: { [k + '.scan']: null, [k + '.del']: null } }), 'Back to the suggested wording'); }
});
