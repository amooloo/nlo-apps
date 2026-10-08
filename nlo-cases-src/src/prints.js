/* =====================================================================
   The 3D printer → NLO Cases (Amir, 8 Oct 2026: "isn't it connected already?")
   Formlabs' Dashboard emails every print on the lab's printer to Dr. A's Gmail: Print Started, Print Finished (after how long),
   Print Aborted, from dashboard+no-reply@formlabs.com. The email-updates script in that Gmail account passes them to this app sealed,
   like the lab emails. The sender is on the script's list, which this app keeps (MAIL_SENDERS in mail.js), so nothing needs pasting
   again. The subject says it all: "<printer> | Print Finished | <the print's name>". A print sent from Titan is named after its
   models, "<patient> - <aligner #> - Maxilla" (or Mandible; "(Template)" on the attachment templates), comma-separated, and PreForm
   cuts the name at 128 characters, so a long print lists its first few models.
   For each patient on a print, the app finds their open in-house set by name (as with the lab PC's orders), keeps the print on the
   case (sealed with the rest; no names) and offers the step with one tap: a print going → Printing; the latest print finished (none
   still going) → Thermoforming. Nothing moves by itself. A print named another way (a scanner's export, "<number>_lprofile_occlusion_u"
   or "<name>_upper") or for a patient with no open in-house set changes nothing.
   ===================================================================== */
const PR_SENDER = 'dashboard+no-reply@formlabs.com'; // (on MAIL_SENDERS)
const PR_KEEP = 12;    // prints kept on a case (the newest)
const PR_LIVE_H = 12;  // a print with no Finished/Aborted email after this many hours isn't "printing now" any more
const PR_FRESH_D = 7;  // a finished print offers Thermoforming for this many days

/* ---------- reading the email ---------- */
function prMail(m) { const f = String((m && m.from) || ''), a = ((/<([^>]+)>/.exec(f) || [0, f])[1] || '').trim().toLowerCase(); return /@formlabs\.com$/.test(a); }
const PR_ST = [[/^print (started|resumed)$/i, 'run'], [/^print paused$/i, 'pause'], [/^print (finished|completed?|done|succeeded)$/i, 'done'],
  [/^print (aborted|failed|cancell?ed|stopped|errored|error)$/i, 'fail']];
function prStatus(s) { const t = String(s || '').replace(/\s+/g, ' ').trim(), x = PR_ST.find(p => p[0].test(t)); return x ? x[1] : ''; }
/* "17 min", "1 hr 5 min", "2 hours" → minutes */
function prMins(s) {
  s = String(s || ''); const h = /(\d{1,3})\s*(?:h|hr|hrs|hour|hours)\b/i.exec(s), m = /(\d{1,4})\s*(?:m|min|mins|minute|minutes)\b/i.exec(s);
  const v = (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0); return v > 0 && v < 7 * 1440 ? v : 0;
}
/* the models on a print, from its name: Titan's "<patient> - <n> - Maxilla|Mandible[ (Template)]" (other names don't say whose) */
const PR_MODEL = /^(.+?)\s+-\s+(\d{1,3})\s+-\s+(maxilla|mandible|upper|lower)\s*(\(template\))?$/i;
function prModels(job) {
  const s = String(job || ''), list = [];
  s.split(',').forEach(p => { const y = PR_MODEL.exec(p.replace(/\s+/g, ' ').trim()); if (y) list.push({ name: y[1].trim(), n: +y[2], a: /^(maxilla|upper)$/i.test(y[3]) ? 'U' : 'L', t: !!y[4] }); });
  return { list, cut: s.length >= 120 }; // (a name that long was cut off: the print had more on it)
}
/* the patients on a print, each with their models */
function prGroups(list) {
  const m = new Map();
  list.forEach(x => { const k = nameTokens(x.name).join(' '); if (k.split(' ').length < 2) return; if (!m.has(k)) m.set(k, { name: x.name, list: [] }); m.get(k).list.push(x); });
  return Array.from(m.values());
}
/* one Formlabs email: { pr: the printer, st: 'run' | 'pause' | 'done' | 'fail', job, min, eta, groups, cut }; { skip: 1 } for a
   Dashboard email that isn't a print starting, finishing or stopping (its print-history download, a resin or tank notice);
   null for one this app can't read (kept a month like any other, so a newer app still can) */
function prParse(m) {
  const subj = String((m && m.subject) || '').replace(/\s+/g, ' ').trim();
  if (/print history export/i.test(subj)) return { skip: 1 };
  const x = /^(.{1,80}?) \| (.{1,40}?) \| (.+)$/.exec(subj); if (!x) return null;
  const st = prStatus(x[2]); if (!st) return { skip: 1 };
  const text = mailText(m).replace(/[|#*]/g, ' ').replace(/\s+/g, ' ');
  const after = (/\bfinished after ([^.]{1,40})/i.exec(text) || [])[1], ein = (/\bwill be (?:finished|done) in ([^.]{1,40})/i.exec(text) || [])[1];
  const ms = prModels(x[3]);
  return { pr: x[1].trim().slice(0, 40), st, job: x[3], min: st === 'done' ? prMins(after) : 0, eta: st === 'run' ? prMins(ein) : 0, groups: prGroups(ms.list), cut: ms.cut };
}
/* "U & L templates · U1–4 · L1–2…": what of the patient's set is on the print (… when its name was cut off with more on it) */
function prWhich(list, cut) {
  const rng = ns => { const out = []; for (let i = 0; i < ns.length; i++) { let j = i; while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++; out.push(i === j ? String(ns[i]) : ns[i] + '–' + ns[j]); i = j; } return out; };
  const nums = a => Array.from(new Set(list.filter(x => !x.t && x.a === a).map(x => x.n))).sort((p, q) => p - q);
  const tu = list.some(x => x.t && x.a === 'U'), tl = list.some(x => x.t && x.a === 'L'), u = rng(nums('U')), l = rng(nums('L'));
  const parts = [tu && tl ? 'U & L templates' : tu ? 'U template' : tl ? 'L template' : '', u.length ? 'U' + u.join(', U') : '', l.length ? 'L' + l.join(', L') : ''].filter(Boolean);
  return (parts.join(' · ') || 'models') + (cut ? '…' : '');
}

/* ---------- finding the case: the patient's open in-house set, by name ---------- */
function prMatch(name, open) {
  const mine = c => c && !c.locked && !c.dup && c.type === 'nla' && c.status !== 'done';
  const cands = open.filter(c => mine(c) && nameMatches(name, 'full', c.patient));
  if (cands.length < 2) return cands[0] || null;
  // two open sets for the patient: the one not past printing yet (at Thermoforming or before)
  const keys = FLOWS.inhouse.stages.map(s => s[0]), lim = keys.indexOf('thermo'), early = cands.filter(c => keys.indexOf(liveStage(c)) <= lim);
  return early.length === 1 ? early[0] : null; // (two sets still to be printed: which one isn't known, so it's left alone)
}

/* ---------- what's kept on the case: c.prints = [{ j, pr, st, s, e, min, eta, m }], oldest first ---------- */
/* a print's own key: its printer and its name (a short hash: the name has the patient's in it) */
function prJob(pr, job) {
  const s = String(pr || '') + '|' + String(job || '').replace(/\s+/g, ' ').trim().toLowerCase(); let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}
function prList(c) { return Array.isArray(c && c.prints) ? c.prints.filter(x => x && typeof x === 'object' && (x.s || x.e)) : []; }
function prAt(x) { return x.s || x.e || 0; }
/* the case's prints with one email's news. A start adds the print — or fills in the start of one whose end was read first (two
   emails can reach the app in either order). A finish or an abort closes the latest of that print still going, or adds it when its
   start was never read. The same print's emails share its printer and name; a reprint of the same name is a new print. */
function prNext(list, ev) {
  const L = prList({ prints: list }).map(x => Object.assign({}, x)), same = x => x.j === ev.j && x.pr === ev.pr, DAY = 864e5;
  if (ev.st === 'run' || ev.st === 'pause') {
    const ended = L.filter(x => same(x) && x.e && x.e >= ev.at && x.e - ev.at < DAY && (!x.s || Math.abs(x.s - ev.at) <= 5 * 60e3)).pop();
    const cur = ended ? null : L.filter(x => same(x) && !x.e && x.s <= ev.at + 60e3 && ev.at - x.s < DAY).pop();
    if (ended) { ended.s = ev.at; if (ev.eta) ended.eta = ev.eta; }
    else if (cur) { cur.st = ev.st; if (ev.eta) cur.eta = ev.eta; }
    else L.push({ j: ev.j, pr: ev.pr, st: ev.st, s: ev.at, eta: ev.eta || 0, m: ev.m });
  } else {
    const cur = L.filter(x => same(x) && !x.e && x.s <= ev.at && ev.at - x.s < DAY).pop();
    if (cur) Object.assign(cur, { st: ev.st, e: ev.at }, ev.min ? { min: ev.min } : {});
    else L.push({ j: ev.j, pr: ev.pr, st: ev.st, s: ev.min ? ev.at - ev.min * 60e3 : 0, e: ev.at, min: ev.min || 0, m: ev.m });
  }
  return L.sort((a, b) => prAt(a) - prAt(b)).slice(-PR_KEEP);
}
/* printing now: started, and no Finished or Aborted email yet (for half a day at most: an email that never came doesn't keep it going) */
function prLive(x, now) { return (x.st === 'run' || x.st === 'pause') && !x.e && !!x.s && (now || Date.now()) - x.s < PR_LIVE_H * 3600e3; }
/* the step the printer's emails say the set is ready for: Printing while a print is going, Thermoforming once the latest finished */
function prSuggest(c) {
  const L = prList(c); if (!L.length) return null;
  const live = L.filter(x => prLive(x));
  if (live.length) return { to: 'print', why: 'a print is going on ' + live[live.length - 1].pr, via: 'print' };
  const last = L[L.length - 1];
  return last.st === 'done' && Date.now() - (last.e || 0) < PR_FRESH_D * 864e5 ? { to: 'thermo', why: 'a print finished on ' + last.pr, via: 'print' } : null;
}

/* ---------- keeping up: Formlabs' emails in the inbox (handed over by mailSync), oldest first ---------- */
async function prApply(ev, c) {
  const cur = findCase(c.id); if (!cur || cur.status === 'done' || cur.locked || cur.dup || cur.type !== 'nla') return 'skip';
  await B.mutateCase(c.id, d => {
    if (d.type !== 'nla' || d.dup || (Array.isArray(d.prIds) && d.prIds.includes(ev.key))) return 'skip'; // (this email is on the case already)
    d.prints = prNext(d.prints, ev);
    d.prIds = (Array.isArray(d.prIds) ? d.prIds : []).concat(ev.key).slice(-40);
  }, { a: 'print', st: ev.st, pr: ev.pr, m: ev.m, min: ev.min || 0, eta: ev.eta || 0 });
  return 'ok';
}
/* returns the emails it can't read (Team & security lists them, like any lab email in a format the app doesn't read yet) */
async function prSync(docs, open) {
  const unread = [], evs = [];
  for (const d of docs) {
    let p = null; try { p = prParse(d.mail); } catch (e) { p = null; }
    if (!p) { if (Date.now() - (d.at || Date.now()) > 30 * 864e5) await B.inboxDelete(d.id).catch(() => { }); else unread.push({ d }); continue; }
    if (p.skip || !p.groups.length) { await B.inboxDelete(d.id).catch(() => { }); continue; } // (nothing in it for a case)
    evs.push({ d, p, at: Number(d.mail.date) || d.at || Date.now() });
  }
  evs.sort((a, b) => a.at - b.at);
  const gone = [];
  for (const { d, p, at } of evs) {
    const hits = p.groups.map(g => ({ g, c: prMatch(g.name, open) })).filter(x => x.c);
    if (!hits.length) { await B.inboxDelete(d.id).catch(() => { }); continue; } // (nobody on it has an open in-house set)
    // one open app goes through the printer's emails, oldest first: another one has them when it holds the next one — so two
    // apps don't save one case's prints at the same moment
    if (!(await B.inboxClaim(d.id))) break;
    let ok = true;
    for (const { g, c } of hits) {
      try { await prApply({ key: d.id, st: p.st, pr: p.pr, j: prJob(p.pr, p.job), at, min: p.min, eta: p.eta, m: prWhich(g.list, p.cut) }, c); }
      catch (x) { if (!(x && (x.code === 'skip' || x.code === 'gone'))) { ok = false; if (window.console) console.warn('print update:', x && x.message); } }
    }
    if (ok || Date.now() - at > 7 * 864e5) gone.push(d.id);
  }
  // taken out of the inbox a moment later: another open app looking at the same email right now then finds this one's claim on it,
  // rather than writing its own claim to an email that's gone (the security rules refuse that)
  if (gone.length) { await new Promise(r => setTimeout(r, 2500)); for (const id of gone) await B.inboxDelete(id).catch(() => { }); }
  return { unread };
}

/* ---------- what the case shows ---------- */
function prClock(ms) { return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
function prWhen(ms) {
  if (!ms) return ''; const day = t => new Date(new Date(t).toDateString()).getTime(), dd = Math.round((day(Date.now()) - day(ms)) / 864e5);
  return dd === 0 ? prClock(ms) : dd === 1 ? 'yesterday ' + prClock(ms) : fmtWhen(ms);
}
function prDur(min) { min = Math.round(min || 0); return min < 60 ? min + ' min' : Math.floor(min / 60) + ' hr' + (min % 60 ? ' ' + (min % 60) + ' min' : ''); }
/* each print, newest first: { k: 'run' | 'pause' | 'done' | 'fail' | 'old', say, x } ('old': started, and never said it finished) */
function prRows(c) {
  const now = Date.now();
  return prList(c).slice().reverse().map(x => {
    const k = prLive(x, now) ? x.st : x.st === 'done' || x.st === 'fail' ? x.st : 'old';
    return { k, x, say: { run: 'Printing now', pause: 'Paused', done: 'Printed', fail: 'Aborted', old: 'Started' }[k] };
  });
}
/* the Lab section's folded line: { t, w } */
function prSum(c) {
  const R = prRows(c); if (!R.length) return null;
  const live = R.find(r => r.k === 'run' || r.k === 'pause'), top = R[0], n = R.filter(r => r.k === 'done').length;
  if (live) return { t: (live.k === 'pause' ? 'Print paused' : 'Printing now') + ' on ' + live.x.pr, w: live.k === 'run' && live.x.eta ? 'done about ' + prClock(live.x.s + live.x.eta * 60e3) : '' };
  if (top.k === 'fail') return { t: 'Print aborted', w: prWhen(top.x.e) };
  if (n) return { t: 'Printed' + (n > 1 ? ' (' + n + ' prints)' : ''), w: prWhen(top.x.e || top.x.s) };
  return { t: 'Print started', w: prWhen(top.x.s) };
}
/* one print, in words: "U1–4… · on WiseTamarin · 8:46 AM · 17 min" */
function prItemText(r) {
  const x = r.x, on = x.pr ? 'on ' + x.pr : '';
  const w = r.k === 'run' ? 'started ' + prClock(x.s) + (x.eta ? ' · done about ' + prClock(x.s + x.eta * 60e3) : '')
    : r.k === 'pause' ? 'started ' + prClock(x.s) : r.k === 'old' ? prWhen(x.s) + ' · it never said it finished'
    : prWhen(x.e) + (r.k === 'done' && x.min ? ' · ' + prDur(x.min) : '');
  return [on, w].filter(Boolean).join(' · ');
}
/* the case panel's Lab section: a Printing row like the Trimmed one — the printer, then each print (newest first) */
function prBoxHTML(c) {
  const R = prRows(c), live = R.some(r => r.k === 'run'), top = R[0];
  if (!R.length) return labStation(c) === 'print' || ['txp', 'txpok', 'send'].includes(liveStage(c)) ? '<div class="small muted labT">No prints from Formlabs yet.</div>' : '';
  const shown = R.slice(0, 5), cls = live ? ' on' : top.k === 'done' ? ' done' : top.k === 'fail' ? ' bad' : '';
  return '<div class="labPr prRow' + cls + '">' + labIcon('print', live, 18) + '<span class="l">Printing<small>' + esc(live ? 'printing now' : R.length + ' print' + (R.length === 1 ? '' : 's')) + '</small></span>' +
    '<div class="prL">' + shown.map(r => '<div class="prI ' + r.k + '"><div><b>' + esc(r.say) + '</b> ' + esc(r.x.m || '') + '</div><div class="w">' + esc(prItemText(r)) + '</div></div>').join('') +
    (R.length > shown.length ? '<div class="prMore">' + (R.length - shown.length) + ' earlier</div>' : '') + '</div></div>';
}
/* the board card's line (before any sticker is printed: then the Trim bar takes over) — the newest print, its icon moving while it
   prints. Past Thermoforming only a print going now shows (a reprint): how the set's printing went is in the case */
function prCardLine(c) {
  const R = prRows(c); if (!R.length) return '';
  const live = R.find(y => y.k === 'run' || y.k === 'pause'), keys = FLOWS.inhouse.stages.map(s => s[0]);
  if (!live && keys.indexOf(liveStage(c)) > keys.indexOf('thermo')) return '';
  const r = live || R[0], k = r.k;
  const t = k === 'run' ? 'Printing ' + r.x.m : k === 'pause' ? 'Print paused · ' + r.x.m : k === 'fail' ? 'Print aborted · ' + r.x.m : k === 'done' ? 'Printed ' + r.x.m : 'Print started · ' + r.x.m;
  const tip = r.say + ' ' + (r.x.m || '') + ' · ' + prItemText(r);
  return '<span class="prC ' + k + '" title="' + esc(tip) + '">' + labIcon('print', k === 'run', 15) + '<span>' + esc(t) + '</span></span>';
}
/* the case's history: "Formlabs finished printing U1–4… on WiseTamarin after 17 min" (a print starting isn't listed: the Lab section
   shows it, and its end follows) */
function prHistText(x) {
  const m = x.m ? ' ' + x.m : '', on = x.pr ? ' on ' + x.pr : '';
  if (x.st === 'done') return 'finished printing' + m + on + (x.min ? ' after ' + prDur(x.min) : '');
  if (x.st === 'fail') return 'reported the print of' + (m || ' models') + on + ' aborted';
  if (x.st === 'pause') return 'paused printing' + m + on;
  return 'started printing' + m + on + (x.eta ? ' (about ' + prDur(x.eta) + ')' : '');
}
/* Team & security → Email updates: is it coming through? The newest print on an open case (no names) */
function prFeedHTML() {
  let best = null; openCases().forEach(c => { if (c.type !== 'nla') return; prList(c).forEach(x => { const t = x.e || x.s; if (!best || t > best.t) best = { t, pr: x.pr }; }); });
  return '<div class="small muted prFeed">' + labIcon('print', false, 15) + '<span>' + (best ? 'Formlabs’ print emails come through: the latest print on an in-house set was ' + esc(prWhen(best.t)) + (best.pr ? ' on ' + esc(best.pr) : '') + '.'
    : 'No print from Formlabs has reached an in-house set yet. They come through the script in the Gmail account that gets Formlabs’ Dashboard emails (' + esc(PR_SENDER) + ').') + '</span></div>';
}
