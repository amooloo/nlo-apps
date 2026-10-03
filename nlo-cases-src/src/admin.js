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
  return rulesCardHTML() + '<div class="adminGrid"><div>' + team + defaults + alCostCard + '</div><div>' + sec + (S.rulesOld ? '' : mailAdminHTML()) + actv + deleted + '</div></div>';
}
/* the live security rules are older than this version of the app: the owner pastes the new ones into the Firebase console
   (they ship inside the page, so they always match it; the owner's own sign-in email is filled in here) */
const NLO_RULES = "__NLO_RULES__";
function rulesCardHTML() {
  if (!S.rulesOld || !isOwner()) return '';
  const pid = (FB.cfg && FB.cfg.projectId) || '';
  return '<div class="card rulesCard" id="rulesCard"><div class="cardHd"><h3>One-time update: security rules</h3><span class="sub">Patient photos and email updates need them. Until then they stay hidden.</span></div><div class="cardBd">' +
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
    '<div class="card" style="max-width:520px;margin-top:18px"><div class="cardHd"><h3>IPR Tracker link</h3></div><div class="cardBd">' + iprAccountHTML() + '</div></div>';
}

function iprAccountHTML() {
  const L = iprLink(); if (!L.init()) return '<div class="small muted">Not available in this browser.</div>';
  const u = L.user();
  return u ? '<p class="small" style="margin-bottom:10px">Reading the IPR Tracker as <b>' + esc(u.email || 'signed in') + '</b> until you lock or sign out. Cases with a chart # show the latest IPR note.</p><button class="btn btn-sec btn-sm" data-act="iprDisconnect">Disconnect now</button>'
    : '<p class="small" style="margin-bottom:10px">Not connected. Connect with the Google account the IPR Tracker uses; it disconnects again when you lock or sign out.</p><button class="btn btn-sec btn-sm" data-act="iprConnect">Connect IPR Tracker</button>';
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
      const list = await B.deletedCases(90); S.delList = list;
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
    busyBtn(t, true, 'Checking…');
    const ok = await rulesCheck(); busyBtn(t, false);
    toast(ok ? 'The security rules are up to date. Photos and email updates are on.' : 'Still the old rules. Publish them in the Firebase console, wait a minute, then check again.', ok ? {} : { bad: true });
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
   staff included (they don't sign in to Staff Hub). Shrunk to 96 px; only when the Staff Hub photo has changed. */
async function shPhotos() {
  if (!isOwner() || !B.setStaffPhoto || SH.syncing) return; SH.syncing = true; let n = 0;
  try {
    const people = shPeople();
    for (const r of S.roster) {
      const p = shMatch(r, people); if (!p) continue;
      const src = /^data:image\/(jpeg|png|webp);base64,/.test(p.photo || '') ? p.photo : '';
      const h = src ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', TE.encode(src))).subarray(0, 8), b => b.toString(16).padStart(2, '0')).join('') : '';
      if ((r.photoSrc || '') === h) continue;
      const small = src ? await shrinkPhoto(src, 96) : ''; if (src && !small) continue;
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
