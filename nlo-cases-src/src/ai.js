/* =====================================================================
   "Make it clear" — AI for Dr. A's instructions (Amir, 10 Oct 2026: "incorporate AI into the Dr. instruction notes that would turn
   notes into clear instructions to the clinician … it can be guided by some of [my] clinical preferences … the AI at least needs to
   make it more clear even if the preferences are clear [empty]").

   The Other instructions box on the New case / Edit form gets a button. It sends the note — and only the note, with what's already
   ticked, the kind of case, the tooth chart's marks and Dr. A's standing preferences as context — to the office's AISA Worker
   (POST /rewrite-instructions → Gemini). Never the patient's name or chart #: aiScrub takes them out first, with dates, phone numbers,
   e-mail addresses and long numbers (the Worker scrubs the last four again). The Worker only keeps the note's length in its logs.

   What comes back is a short list of steps in the order of the office's own prescription (goals → movements still needed → IPR /
   attachments / staging), each one ticked, plus up to three "Worth checking" questions where the note left something out or
   contradicts itself — the AI is told to ask, not to guess. It ALWAYS makes the note clearer, with or without preferences; Dr. A's
   preferences (Team & security → AI instruction helper, `aiPrefs` in meta/settings: every signed-in person reads it, only the owner
   writes it) only add his habits on top, and a step that used one is tagged so whoever is using it can untick it. Nothing in the
   box changes until "Use this"; "Put my words back" undoes it. The steps are saved joined with "; " — the same way the ticked
   instruction tiles are, so the chart note and the case panel read them like any other.

   The same card has a "Try it" box (a made-up note, the preferences as typed — saved or not), so Dr. A can see what his preferences
   do, and whether the Worker has the new route, without making a case.
   ===================================================================== */
const AI_URL = 'https://aisa-worker.akhavan-ak.workers.dev/rewrite-instructions';
const AI_NOTE_MAX = 1500, AI_PREFS_MAX = 1500; // (the Worker refuses anything longer — never cuts it)
IC.sparkle = '<path d="M11 3l1.7 4.6L17.3 9.3 12.7 11 11 15.6 9.3 11 4.7 9.3 9.3 7.6z"/><path d="M18.5 14l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z"/>';

/* ---------- Dr. A's preferences ---------- */
function aiPrefsClean(t) { return String(t || '').replace(/\r/g, '').split('\n').map(x => x.trim()).filter(Boolean).join('\n'); }
function aiPrefsText() { const v = S.settings && S.settings.aiPrefs; return typeof v === 'string' ? aiPrefsClean(v).slice(0, AI_PREFS_MAX) : ''; }

/* ---------- what leaves this computer ---------- */
function aiRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
/* the patient's name and chart #, e-mail addresses, phone numbers, full dates and long numbers taken out of a note before it is sent.
   n = how many bits were taken out */
function aiScrub(text, patient, chart) {
  let s = String(text || ''), n = 0;
  const swap = (re, rep) => { s = s.replace(re, (...m) => { n++; return typeof rep === 'function' ? rep(m) : rep; }); };
  const L = 'A-Za-z\\u00C0-\\u024F';
  const names = Array.from(new Set(String(patient || '').split(/[\s,;\/]+/).map(w => w.replace(new RegExp('^[^' + L + ']+|[^' + L + ']+$', 'g'), '')).filter(w => w.length >= 2)))
    .sort((a, b) => b.length - a.length);
  // (one pass for every part of the name, so a [patient] mark is never matched again)
  if (names.length) swap(new RegExp('(^|[^' + L + '])(' + names.map(aiRe).join('|') + ')(?![' + L + '])', 'gi'), m => m[1] + '[patient]');
  const ch = String(chart || '').trim();
  if (ch.length >= 3) swap(new RegExp('(^|[^A-Za-z0-9])' + aiRe(ch) + '(?![A-Za-z0-9])', 'gi'), m => m[1] + '[chart #]');
  swap(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, '[removed]');
  swap(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, '[removed]');
  swap(/\b\d{3}-\d{2}-\d{4}\b/g, '[removed]');
  swap(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g, '[date]');
  swap(/\b\d{4}-\d{2}-\d{2}\b/g, '[date]');
  swap(/\b\d{5,}\b/g, '[number]');
  return { text: s, n };
}
/* the case as the form has it now: the kind, what's ticked, the chart's marks (and the name + chart #, only to take them out) */
function aiContext(root) {
  let o = {}, kind = '';
  try { o = readCaseForm(root) || {}; kind = o.detail || autoDetail(o, ($('#cf-tile', root) || {}).value || ''); } catch (e) { o = {}; }
  if (!o.patient) o.patient = (($('#cf-patient', root) || {}).value || '').trim();
  if (!o.chart) o.chart = (($('#cf-chart', root) || {}).value || '').trim();
  return { patient: o.patient || '', chart: o.chart || '', kind: String(kind || '').slice(0, 120),
    chosen: goalText(o.goals).concat(o.instrPicks || []).slice(0, 20), teeth: String(o.teethNote || '').slice(0, 400) };
}
/* → { items: [{ t, pref }], check: [...] }, or an Error whose message says what to do */
async function aiAsk(payload) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 30000);
  let r, txt;
  try {
    r = await fetch(AI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal });
    txt = await r.text();
  } catch (e) { throw new Error(e && e.name === 'AbortError' ? 'The AI took too long. Try again in a moment.' : 'Couldn’t reach the AI helper. Check the internet connection and try again.'); }
  finally { clearTimeout(timer); }
  let j = null; try { j = JSON.parse(txt); } catch (e) {}
  // (a Worker without the new route answers "NLO Worker is Running!" — plain text — to anything it doesn't know)
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('The AI helper isn’t switched on yet — the AISA Worker needs its update (Dr. A).');
  if (!r.ok || j.ok === false) throw new Error(String(j.error || 'The AI helper had a problem. Try again.').slice(0, 220));
  const items = (Array.isArray(j.items) ? j.items : []).map(x => ({ t: String((x && x.t) || '').replace(/\s+/g, ' ').trim(), pref: !!(x && x.pref === true) })).filter(x => x.t);
  const check = (Array.isArray(j.check) ? j.check : []).map(x => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3);
  return { items, check };
}

/* ---------- the button and what it shows ---------- */
function aiBarHTML() {
  return '<div class="aiBar"><button type="button" class="btn btn-ghost btn-sm" data-act="aiClear" id="cf-aiBtn">' + ic('sparkle', 15) + 'Make it clear</button>' +
    '<span class="small">Turns the note into clear steps for the clinician. Only the note is sent — never the patient’s name or chart&nbsp;#.</span></div>' +
    '<div class="aiOut" id="cf-aiOut" aria-live="polite" hidden></div>';
}
function aiResultHTML(res, mode) {
  const rows = res.items.map((x, i) => {
    const tag = x.pref ? '<span class="aiTag" title="This step came from Dr. A’s clinical preferences. Untick it if it doesn’t fit this case.">Dr. A’s preference</span>' : '';
    return mode === 'case' ? '<label class="aiRow"><input type="checkbox" data-ai="' + i + '" checked><span>' + esc(x.t) + tag + '</span></label>'
      : '<div class="aiRow ro"><span class="aiBul" aria-hidden="true">•</span><span>' + esc(x.t) + tag + '</span></div>';
  }).join('');
  const chk = res.check.length ? '<div class="aiCheck"><b>Worth checking</b><ul>' + res.check.map(q => '<li>' + esc(q) + '</li>').join('') + '</ul></div>' : '';
  const acts = mode === 'case' ? '<div class="aiAct">' + (res.items.length ? '<button type="button" class="btn btn-pri btn-sm" data-act="aiUse">Use this</button>' : '') +
    '<button type="button" class="btn btn-ghost btn-sm" data-act="aiKeep">' + (res.items.length ? 'Keep mine' : 'Close') + '</button></div>' +
    '<div class="aiFine">Read it before you use it — AI can misread a note. Nothing changes until you tap Use this.</div>' : '';
  return '<div class="aiHd">' + ic('sparkle', 14) + (res.items.length ? 'Clear steps for the clinician' : 'Nothing to turn into steps') + '</div>' + rows + chk + acts;
}
function aiMsgHTML(msg, bad) { return '<div class="aiMsg' + (bad ? ' bad' : '') + '">' + esc(msg) + '</div>'; }
function aiMsg(out, msg, bad) { out.hidden = false; out._ai = null; out.innerHTML = aiMsgHTML(msg, bad); }
function aiRoot(t) { return t.closest('.modal') || $('#drawer'); }

async function aiClear(t) {
  const root = aiRoot(t); if (!root) return;
  const ta = $('#cf-instrOther', root), out = $('#cf-aiOut', root); if (!ta || !out || t.disabled) return;
  const raw = ta.value.trim();
  if (raw.length < 3) { aiMsg(out, 'Type the note in the box first, then tap Make it clear.'); ta.focus(); return; }
  if (raw.length > AI_NOTE_MAX) { aiMsg(out, 'That note is long (' + raw.length + ' characters). Shorten it to ' + AI_NOTE_MAX + ' or fewer first.', true); return; }
  const cx = aiContext(root), sc = aiScrub(raw, cx.patient, cx.chart), label = t.innerHTML;
  t.disabled = true; t.innerHTML = ic('sparkle', 15) + 'Writing…'; out.hidden = true;
  try {
    const res = await aiAsk({ note: sc.text, kind: aiScrub(cx.kind, cx.patient, cx.chart).text, chosen: cx.chosen, teeth: cx.teeth, prefs: aiPrefsText() });
    if (!document.body.contains(ta)) return; // (the form was closed while it was thinking)
    if (ta.value.trim() !== raw) { aiMsg(out, 'The note changed while the AI was working. Tap Make it clear again.'); return; }
    out.hidden = false; out._ai = { res, orig: ta.value }; out.innerHTML = aiResultHTML(res, 'case');
    try { out.scrollIntoView({ block: 'nearest' }); } catch (e) {} // (the form scrolls: the steps and Use this come into view)
    const go = $('[data-act="aiUse"]', out) || $('[data-act="aiKeep"]', out); if (go) go.focus({ preventScroll: true });
  } catch (e) { if (document.body.contains(out)) aiMsg(out, (e && e.message) || 'Something went wrong. Try again.', true); }
  finally { t.disabled = false; t.innerHTML = label; }
}
function aiUse(t) {
  const root = aiRoot(t); if (!root) return;
  const ta = $('#cf-instrOther', root), out = $('#cf-aiOut', root), st = out && out._ai; if (!ta || !st) return;
  const steps = st.res.items.filter((x, i) => { const c = $('input[data-ai="' + i + '"]', out); return c && c.checked; }).map(x => x.t);
  if (!steps.length) { toast('Tick at least one step — or tap Keep mine', { bad: true }); return; }
  ta.dataset.aiOrig = st.orig; ta.value = steps.join('; ');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  out._ai = null; out.innerHTML = '<div class="aiDone">' + ic('check', 14) + 'Used. <button type="button" class="aiLink" data-act="aiUndo">Put my words back</button></div>';
  ta.focus({ preventScroll: true });
}
function aiKeep(t) {
  const root = aiRoot(t); if (!root) return;
  const ta = $('#cf-instrOther', root), out = $('#cf-aiOut', root); if (!out) return;
  out._ai = null; out.hidden = true; out.innerHTML = ''; if (ta) ta.focus({ preventScroll: true });
}
function aiUndo(t) {
  const root = aiRoot(t); if (!root) return;
  const ta = $('#cf-instrOther', root), out = $('#cf-aiOut', root); if (!ta) return;
  if (ta.dataset.aiOrig != null) { ta.value = ta.dataset.aiOrig; delete ta.dataset.aiOrig; ta.dispatchEvent(new Event('input', { bubbles: true })); }
  if (out) { out._ai = null; out.hidden = true; out.innerHTML = ''; }
  ta.focus({ preventScroll: true });
}

/* ---------- Team & security → AI instruction helper (Dr. A's preferences + Try it) ---------- */
function aiPrefsCardHTML() {
  const tr = S.aiTry || {}, busy = !!S.aiTryBusy;
  return '<div class="card" style="margin-top:18px" id="aiCard"><div class="cardHd"><h3>AI instruction helper</h3><span class="sub">Dr. A’s clinical preferences</span></div><div class="cardBd">' +
    '<p class="small" style="margin:0 0 10px">On a case, <b>Make it clear</b> (under Other instructions) turns a rough note into clear steps for the clinician, in the order of your prescription: goals, movements still needed, then IPR, attachments and staging. ' +
    'It works on its own. What you write below is optional and only adds your habits on top — one rule per line, general rules only, no patient names. A step that comes from one of them is tagged, and whoever is using it can untick it.</p>' +
    '<div class="field"><label for="aiPrefs">Your clinical preferences <span class="h5n">optional</span></label>' +
    '<textarea id="aiPrefs" rows="7" maxlength="' + AI_PREFS_MAX + '" placeholder="Examples — write your own:&#10;• Keep the back teeth locked unless I say otherwise&#10;• IPR: 0.2 mm per contact, never more than 0.3 mm"' + (isOwner() ? '' : ' readonly') + '>' + esc(aiPrefsText()) + '</textarea>' +
    '<div class="hint">Saves when you tap outside the box. Leave it empty and the helper still makes every note clearer.</div></div>' +
    '<div class="field"><label for="aiTry">Try it on a made-up note</label><textarea id="aiTry" rows="2" maxlength="' + AI_NOTE_MAX + '" placeholder="e.g. close lower spaces, no ipr upper, keep post locked">' + esc(S.aiTryNote || '') + '</textarea></div>' +
    '<button type="button" class="btn btn-sec btn-sm" data-act="aiTry"' + (busy ? ' disabled' : '') + '>' + ic('sparkle', 15) + (busy ? 'Writing…' : 'Try it') + '</button>' +
    '<div class="aiOut" id="aiTryOut" aria-live="polite"' + (tr.html ? '' : ' hidden') + '>' + (tr.html || '') + '</div>' +
    '<div class="small muted" style="margin-top:10px">Only the note and the preferences above go to the AI — never a patient’s name or chart&nbsp;#. Keep names out of both.</div>' +
    '</div></div>';
}
/* (the answer is kept in S.aiTry and drawn into whichever box is on the screen when it arrives — Team & security redraws itself when the
   preferences are saved, which can be while this is working, and an answer written into the old box would be lost) */
function aiTryShow(html) { S.aiTry = { html: html || '' }; const out = $('#aiTryOut'); if (out) { out.hidden = !html; out.innerHTML = html || ''; } }
function aiTryBtn() { const b = $('#aiCard [data-act="aiTry"]'); if (b) { b.disabled = !!S.aiTryBusy; b.innerHTML = ic('sparkle', 15) + (S.aiTryBusy ? 'Writing…' : 'Try it'); } }
async function aiTry() {
  const note = $('#aiTry'), pr = $('#aiPrefs'); if (!note || S.aiTryBusy) return;
  const raw = note.value.trim();
  S.aiTryNote = note.value;
  if (raw.length < 3) { aiTryShow(aiMsgHTML('Type a made-up note first, like “close lower spaces, no ipr upper”.')); note.focus(); return; }
  if (raw.length > AI_NOTE_MAX) { aiTryShow(aiMsgHTML('That note is long. Shorten it to ' + AI_NOTE_MAX + ' characters or fewer.', true)); return; }
  S.aiTryBusy = true; aiTryBtn();
  let html;
  try { html = aiResultHTML(await aiAsk({ note: aiScrub(raw, '', '').text, kind: 'Aligners (a made-up note, to try the helper)', chosen: [], teeth: '', prefs: aiPrefsClean(pr ? pr.value : aiPrefsText()).slice(0, AI_PREFS_MAX) }), 'try'); }
  catch (e) { html = aiMsgHTML((e && e.message) || 'Something went wrong. Try again.', true); }
  S.aiTryBusy = false; aiTryShow(html); aiTryBtn();
}
/* the preferences box left: saved (empty = cleared; the helper works the same without them) */
document.addEventListener('change', e => {
  const t = e.target; if (!t || t.id !== 'aiPrefs' || !isOwner()) return;
  const val = aiPrefsClean(t.value).slice(0, AI_PREFS_MAX);
  if (val === aiPrefsText()) return;
  act(() => B.saveSettings({ aiPrefs: val }), val ? 'Saved' : 'Cleared — Make it clear still works without them');
});
document.addEventListener('input', e => { const t = e.target; if (t && t.id === 'aiTry') S.aiTryNote = t.value; });
Object.assign(ADMIN_ACTS, { aiClear, aiUse, aiKeep, aiUndo, aiTry });
