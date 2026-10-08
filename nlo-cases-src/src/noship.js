/* ---------- Not shipped → an email to the front desk (Amir, 8 Oct 2026) ----------
   "when the case gets delayed (not shipped by the expected time) please also send a email to Questions@thenextlevelorthodontics.com
   to let the front desk know" — "want to make sure the email goes out automatically".
   When an outside lab's case turns red Not shipped (shipWarn 'late': not marked Shipped N business days before its delivery appt, as set
   in Team & security) and the appt hasn't passed, the first NLO Cases that sees it leaves a note for the email script of the mailbox the
   owner picked (records@), sealed to that script's own key (only that script can open it), in the same save that marks the case
   (noshipMail = the appt it was for). However many computers have the app open, it goes once per case and appointment; the script emails
   it to the front-desk address within 10 minutes. Nothing to click: it's checked at sign-in, after every look at the lab emails (so a
   shipment that just came in isn't reported as late), every few minutes while the app is open, and when a case changes.
   The owner turns it on in Team & security → Email updates (the address, the mailbox that sends it, with or without the patient's
   name) — kept in meta/inbox.notify, which the script reads for the one address it may send these to. */

const NS_TO = 'Questions@thenextlevelorthodontics.com';
const NS = { cfg: null, at: 0, busy: false, soon: 0 };

/* the owner's settings { on, to, box, pub, names }, kept a minute (false = none yet) */
async function nsCfg(fresh) {
  if (!B.notifyCfg) return null;
  if (!fresh && NS.cfg !== null && Date.now() - NS.at < 60000) return NS.cfg;
  try { NS.cfg = (await B.notifyCfg()) || false; } catch (e) { NS.cfg = false; }
  NS.at = Date.now(); return NS.cfg;
}
function nsOk(n) { return !!(n && n.on && n.to && n.box && n.pub && n.pub.x); }
/* the case should email the front desk now: red Not shipped, its appt today or later, not emailed for this appt yet */
function nsDue(c) {
  const x = shipWarn(c); if (!x || x.lv !== 'late') return null;
  if (x.appt < todayISO() || c.noshipMail === x.appt) return null;
  return x;
}
async function nsCheck() {
  if (!S.inApp || NS.busy || S.firstLoad || S.rulesLv !== 3 || !B.noshipSend) return;
  if (!openCases().some(c => nsDue(c))) return;
  NS.busy = true;
  try {
    const n = await nsCfg(); if (!nsOk(n)) return;
    for (const c of openCases().filter(c => nsDue(c)).slice(0, 12)) {
      const cur = findCase(c.id), x = cur && nsDue(cur); if (!x) continue;
      try { await B.noshipSend(cur.id, x.appt, nsNote(cur, x, n), n); }
      catch (e) { if (!(e && e.code === 'skip') && window.console) console.warn('front-desk email:', e && e.message); }
    }
  } finally { NS.busy = false; }
}
/* a case changed: check again in a moment (after the lab emails being read, if they are) */
function nsSoon() { clearTimeout(NS.soon); NS.soon = setTimeout(() => { if (MAILS.busy) return; nsCheck(); }, 4000); }

/* the email itself: what the front desk needs to act on (plain text) */
function nsWhen(x, c) {
  const a = apptOf(c), dd = dayDiff(x.appt), t = a && a.k === 'delivery' && c.deliveryTime ? fmtTime(c.deliveryTime) : '';
  return fmtDay(x.appt) + (t ? ' at ' + t : '') + (dd === 0 ? ' (today)' : dd === 1 ? ' (tomorrow)' : dd > 1 ? ' (in ' + dd + ' days)' : '');
}
function nsNote(c, x, n) {
  const pt = String(c.patient || '').trim(), names = n.names !== false && !!pt, appt = delWord(c).toLowerCase();
  const what = (caseTitle(c) || typeOf(c).l) + (c.lab ? ' from ' + labName(c.lab) : ''), when = nsWhen(x, c);
  const who = c.assignee ? staffName(c.assignee, '') : c.assigneeName || '';
  const subject = names ? 'Not shipped: ' + pt + ' - ' + appt + ' ' + fmtDay(x.appt) : 'Not shipped: a case for the ' + appt + ' on ' + fmtDay(x.appt);
  // (shipped straight to the patient: no appointment to move — the patient is told instead)
  const todo = c.shipToPatient && typeOf(c).aligner ? 'Please check with the lab, or let the patient know it will be late.' : 'Please check with the lab, or reschedule the appointment.';
  const details = names ? [c.chart ? 'Chart #: ' + c.chart : '', c.labRef ? refLabel(c) + ': ' + c.labRef : '',
    String(c.tracking || '').trim() ? 'Tracking #: ' + String(c.tracking).trim() : '', who ? 'Assigned to: ' + who : ''].filter(Boolean) : [];
  const paras = names
    ? [pt + "'s " + what + " isn't marked shipped yet.", delWord(c) + ': ' + when + '.', todo, details.join('\n')]
    : ['A ' + what + ' for the ' + appt + ' on ' + when + " isn't marked shipped yet.", todo + ' Open NLO Cases (Today, Not shipped) to see which patient.'];
  const text = paras.filter(Boolean).join('\n\n') + '\n\n-- \nSent automatically by NLO Cases. Once the case ships, the lab\'s shipping email (or Shipped in NLO Cases) clears it.';
  return { v: 1, subject: subject.slice(0, 200), text: text.slice(0, 8000) };
}

/* ---------- Team & security → Email updates: the front-desk email ---------- */
/* the mailboxes whose script can send them (a newer script, which shows its key when it checks in), the practice's own address first */
function nsBoxes() {
  const st = MAILS.state; if (!st) return [];
  return (st.beats || []).filter(b => !labBeat(b) && b.pub && b.pub.x && /^b[0-9a-f]{32}$/.test(b.id))
    .sort((a, b) => (/gmail\.com$/i.test(a.box) ? 1 : 0) - (/gmail\.com$/i.test(b.box) ? 1 : 0) || (b.at || 0) - (a.at || 0));
}
function nsAdminHTML() {
  if (!isOwner()) return '';
  const head = '<div class="nsBox" id="nsBox"><h5>Not shipped → email the front desk</h5>';
  if (S.rulesMail) return head + '<p class="small muted">Publish the new security rules first (the card at the top of this page), then come back here.</p></div>';
  const st = MAILS.state, n = (st && st.pub && st.pub.notify) || {}, boxes = nsBoxes(), on = !!(n.on && n.box && n.pub);
  const cur = boxes.find(b => b.id === n.box), lv = shipWarnDays().late;
  const say = 'When an outside lab’s case isn’t marked shipped ' + lv + ' business day' + (lv === 1 ? '' : 's') + ' before its delivery appt (red Not shipped), NLO Cases emails the front desk once — by itself, from the mailbox below, within about 10 minutes.';
  if (!boxes.length) return head + '<p class="small" style="margin-bottom:8px">' + say + '</p><div class="notice">It needs the newer script in the mailbox that sends it (records@): <b>Get the script</b> below, paste it over the old one in that Gmail account, Save, and run <b>setup</b>. The mailbox appears here once it checks in.</div></div>';
  const sel = n.box && cur ? n.box : boxes[0].id;
  return head + '<p class="small" style="margin-bottom:10px">' + say + '</p>' +
    (on ? '<div class="nsOn small"><span class="dot ok"></span><span><b>On</b> — to <b>' + esc(n.to) + '</b> from ' + esc(cur ? cur.box : 'a mailbox that hasn’t checked in lately') + (n.names ? ', with the patient’s name' : ', without patient names') + '.</span></div>'
      : '<div class="nsOn small"><span class="dot"></span><span><b>Off</b></span></div>') +
    '<div class="nsForm"><label class="field"><span class="lbl">Send to</span><input class="inp" id="nsTo" type="email" autocomplete="off" spellcheck="false" value="' + esc(n.to || NS_TO) + '"></label>' +
    '<label class="field"><span class="lbl">Send from</span><select class="inp" id="nsFrom">' + boxes.map(b => '<option value="' + esc(b.id) + '"' + (b.id === sel ? ' selected' : '') + '>' + esc(b.box) + '</option>').join('') + '</select></label>' +
    '<label class="nsChk"><input type="checkbox" id="nsNames"' + (n.names === false ? '' : ' checked') + '> Include the patient’s name, chart # and lab case #</label></div>' +
    '<div class="mlBtns"><button class="btn btn-pri btn-sm" data-act="nsSave">' + (on ? 'Save' : 'Turn on') + '</button>' +
    (on ? '<button class="btn btn-sec btn-sm" data-act="nsTest">Send a test email</button><button class="btn btn-ghost btn-sm" data-act="nsOff" style="color:var(--coral-700)">Stop front-desk emails</button>' : '') + '</div></div>';
}
/* the owner's app keeps the sending mailbox's key current (a script set up afresh has a new one) */
function nsKeepKey() {
  const st = MAILS.state, n = st && st.pub && st.pub.notify; if (!isOwner() || !n || !n.on || !n.box || !B.notifySet) return;
  const b = (st.beats || []).find(x => x.id === n.box); if (!b || !b.pub || !b.pub.x) return;
  if (n.pub && n.pub.x === b.pub.x && n.pub.y === b.pub.y) return;
  const next = Object.assign({}, n, { pub: { kty: 'EC', crv: 'P-256', x: b.pub.x, y: b.pub.y } });
  B.notifySet(next).then(() => { st.pub.notify = next; NS.cfg = null; }).catch(() => { });
}
Object.assign(ADMIN_ACTS, {
  async nsSave(t) {
    const to = String(($('#nsTo') || {}).value || '').trim(), id = ($('#nsFrom') || {}).value || '', names = !!($('#nsNames') || {}).checked;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { toast('Type the front desk’s email address', { bad: true }); return; }
    const b = nsBoxes().find(x => x.id === id); if (!b) { toast('Pick the mailbox that sends it', { bad: true }); return; }
    const was = MAILS.state && MAILS.state.pub && MAILS.state.pub.notify, n = { on: true, to, box: b.id, pub: { kty: 'EC', crv: 'P-256', x: b.pub.x, y: b.pub.y }, names };
    busyBtn(t, true, 'Saving…');
    try { await B.notifySet(n); if (MAILS.state && MAILS.state.pub) MAILS.state.pub.notify = n; NS.cfg = null; toast(was && was.on ? 'Saved' : 'On: the front desk gets an email when a case isn’t shipped in time'); nsCheck(); }
    catch (e) { toast(errText(e), { bad: true }); }
    busyBtn(t, false); queueRender('team');
  },
  async nsOff(t) {
    const n = MAILS.state && MAILS.state.pub && MAILS.state.pub.notify; if (!n) return;
    busyBtn(t, true, 'Turning off…');
    try { const off = Object.assign({}, n, { on: false }); await B.notifySet(off); MAILS.state.pub.notify = off; NS.cfg = null; toast('Off: no more front-desk emails'); }
    catch (e) { toast(errText(e), { bad: true }); }
    busyBtn(t, false); queueRender('team');
  },
  async nsTest(t) {
    const n = MAILS.state && MAILS.state.pub && MAILS.state.pub.notify; if (!nsOk(n)) return;
    busyBtn(t, true, 'Sending…');
    try {
      await B.noshipTest({ v: 1, subject: 'NLO Cases test: front-desk emails work', text: 'This is a test from NLO Cases (Team & security, Email updates).\n\nWhen a case isn\'t marked shipped in time for its delivery appt, an email like this one comes to this address, by itself.\n\n-- \nSent by NLO Cases.' }, n);
      toast('Test sent to the mailbox’s script: it should reach ' + n.to + ' within about 10 minutes', { ms: 8000 });
    } catch (e) { toast(errText(e), { bad: true }); }
    busyBtn(t, false);
  }
});
