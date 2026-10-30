/* =====================================================================
   Lab emails → case updates (Amir, 2 Oct 2026: "just like how I had it set up on Asana")
   A Google Apps Script in the office's Gmail accounts (nlo-cases-mail.gs, set up from Team & security)
   forwards lab emails, each sealed to the office inbox key: the script can add to /inbox but read nothing.
   Whenever someone has the app open, the app opens them here, reads each patient's update (one email can
   name several), finds the case — the company's own case # saved on it, else the name among that company's
   open cases — and applies it: moves the case forward (never back), saves the tracking #, the lab's case #
   and the plan link, notes a lab hold. Updates it can't place wait on Today for someone to pick the case.
   Reading the emails happens here, not in the script, so a new lab format only needs an app update.
   The website's appointment requests come through the same script (the last sender below) but belong to
   NLO Leads, which files each one and takes it out of the inbox — see leadsMail().
   ===================================================================== */
/* (Specialty Appliances: their "Daily Case Summary" to the records inbox — Amir, 4 Oct 2026: "yes I want specialty added")
   (Formlabs' Dashboard: each print on the lab's printer, to Dr. A's Gmail — 8 Oct 2026, read by prints.js. Its one address only:
   Formlabs' support and order emails stay out) */
const MAIL_SENDERS = ['ulabsystems.com', 'partnersdentalstudio.com', 'specialtyappliances.com', 'olivortho.com', 'angelaligner.com', 'angelalign.com', 'thenextlevelorthodontics@orthohost.com',
  'dashboard+no-reply@formlabs.com'];
/* a website appointment request, or something about one in the same thread (Asana's notice): NLO Leads' to handle, so
   this app leaves it alone (one left for a month — NLO Leads never opened — is cleared like any old email) */
function leadsMail(m) { return /thenextlevelorthodontics@orthohost\.com/i.test(String(m.from || '')) || /website appointment request/i.test(String(m.subject || '')); }
const MAIL_CO = {
  ulab: { l: 'uLab', types: ['ulab'], hosts: ['ulabsystems.com', 'udesign.cloud'] },
  partners: { l: 'Partners Dental Solutions', types: ['appliance', 'marpe'], lab: 'Partners Dental Solutions', hosts: ['partnersdentalstudio.com'] },
  specialty: { l: 'Specialty Appliances', types: ['appliance', 'marpe'], lab: 'Specialty Orthodontic Lab', hosts: ['specialtyappliances.com'] },
  oliv: { l: 'Oliv', types: ['oliv'], hosts: ['olivortho.com'] },
  angel: { l: 'Angel', types: ['angel'], hosts: ['angelalign.com', 'angelaligner.com'] }
};
const MAIL_KIND = { received: 'Received by the lab', plan: 'Ready for Dr. A’s review', shipped: 'Shipped', delivered: 'Delivered', hold: 'On hold at the lab', zoom: 'Zoom call' };
/* what the company calls its own number for the case */
function refLabel(c) {
  const t = c.type;
  if (t === 'oliv') return 'Oliv case #'; if (t === 'angel') return 'Angel patient #'; if (t === 'ulab') return 'uLab order #';
  if (t === 'invisalign') return 'Invisalign patient #'; if (t === 'insmile') return 'InSmile case #';
  if (t === 'marpe' || labName(c.lab) === 'Partners Dental Solutions') return 'Partners case #'; if (c.lab === 'Specialty Orthodontic Lab') return 'Specialty case #';
  return 'Lab case #';
}

/* ---------- reading an email ---------- */
function decodeEnt(s) {
  const cp = n => { try { return String.fromCodePoint(n); } catch (e) { return ' '; } };
  return String(s || '').replace(/&nbsp;/gi, ' ').replace(/&#(\d+);/g, (m, n) => cp(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => cp(parseInt(n, 16)))
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, '&');
}
/* HTML → lines; a table row becomes one line with its cells kept apart. flat: what's inside a cell stays on the row — its own
   blocks and line breaks are spaces (Specialty's daily summary puts each cell's words in a <div>, a <br> after them, which split the
   row over several lines and lost the table). Only cells with no table inside: a layout cell around the whole email keeps its lines */
function htmlRows(html, flat) {
  let s = String(html || '').replace(/[\r\n]+/g, ' ').replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  if (flat) s = s.replace(/(<(td|th)\b[^>]*>)((?:(?!<\/?(?:td|th|table)\b)[\s\S])*)(<\/\2\s*>)/gi, (m, a, t, inner, b) => a + inner.replace(/<br\s*\/?>/gi, ' ').replace(/<\/?(p|div|h[1-6]|li)\b[^>]*>/gi, ' ') + b);
  s = s.replace(/<\/(td|th)\s*>/gi, '\u0001').replace(/<\/tr\s*>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|table|li|caption|thead|tbody)\s*>/gi, '\n').replace(/<[^>]*>/g, '');
  return decodeEnt(s).split('\n').map(line => {
    const cells = line.split('\u0001').map(c => c.replace(/\s+/g, ' ').trim());
    while (cells.length > 1 && cells[cells.length - 1] === '') cells.pop();
    return cells;
  }).filter(cells => cells.some(Boolean));
}
function htmlLinks(html) {
  const out = [], re = /<a\b[^>]*?href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a\s*>/gi; let x;
  while ((x = re.exec(String(html || '')))) out.push({ href: decodeEnt(x[1]).trim(), text: decodeEnt(x[2].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim() });
  return out;
}
function linkFor(html, re) { const l = htmlLinks(html).find(x => re.test(x.text)); return l ? l.href : ''; }
function mailText(m) { const t = String(m.text || '').replace(/\r/g, ''); return t.trim() ? t : htmlRows(m.html).map(r => r.join(' ')).join('\n'); }
function cleanName(s) {
  return String(s || '').replace(/[​ ]/g, ' ').replace(/\s+(click here|tracking|order number|patient name|case number)\b.*$/i, '')
    .replace(/\s+/g, ' ').replace(/^[\s"'“”(:,.*_-]+|[\s"'“”):,*_-]+$/g, '').slice(0, 80); // (*bold* in a plain-text copy)
}
/* uLab: "Your uLab order X has shipped." — Order Number / Patient Name / tracking #, maybe several orders. Read only when the
   subject says it shipped: any uLab email that mentioned shipping anywhere used to count (12 Oct 2026 review: an order confirmation
   saying the aligners "will be shipped within 5–7 days" would have moved the case to Shipped). Any other uLab email stays unread,
   listed under Team & security → Email updates, until the app learns its format. */
function ulabShipped(subject) { const s = String(subject || ''); return /\bshipped\b|\bon\s+(?:the|its|their)\s+way\b/i.test(s) && !/\b(?:will|to)\s+be\s+shipped\b|\bonce\b|\bwhen\b|\bnot\b/i.test(s); }
function parseUlab(m) {
  const t = mailText(m), out = [];
  if (!ulabShipped(m.subject)) return out;
  t.split(/Order Number\s*:/i).slice(1).forEach(p => {
    const name = (p.match(/Patient Name\s*:\s*([^\n]+)/i) || [])[1];
    if (name) out.push({ kind: 'shipped', name, ref: (p.match(/^\s*([A-Za-z0-9-]{2,30})/) || [])[1] || '', tracking: (p.match(/track your order\s*:?\s*([A-Za-z0-9]{8,34})/i) || [])[1] || '' });
  });
  return out;
}
/* the labs' daily summary — tables of cases received, shipped (tracking + carrier) and on hold, under headings like "Cases Shipped
   Today" or "No Cases Received Today": Partners Dental Studio's, and Specialty Appliances' "Daily Case Summary" (the same tables) */
function parseLabSummary(m) {
  const out = []; let sec = '', cols = null;
  htmlRows(m.html, true).forEach(r => {
    const line = r.join(' ');
    const head = r.length === 1 && /^(no\s+)?cases\s+(received|shipped|(?:placed\s+)?on hold)/i.exec(line);
    if (head) { sec = head[1] ? '' : /received/i.test(head[2]) ? 'received' : /shipped/i.test(head[2]) ? 'shipped' : 'hold'; cols = null; return; }
    if (/^patient name$/i.test(r[0] || '')) { cols = r.map(c => c.toLowerCase()); return; }
    if (!sec || !cols || r.length < 2) return;
    const get = k => { const i = cols.findIndex(c => c.indexOf(k) >= 0); return i >= 0 ? String(r[i] || '').trim() : ''; };
    const name = get('patient'); if (!name || /^patient name$/i.test(name)) return;
    out.push({ kind: sec, name, ref: get('case'), invoice: get('invoice'), tracking: get('tracking').replace(/\s+/g, ''), carrier: get('carrier'), holdDate: get('hold date'), reason: get('reason') });
  });
  return out;
}
/* Oliv: "Oliv™: F. Last (123456) setup is ready"; "The aligners for F. Last, case #123456 (…) have been delivered/shipped".
   Each paragraph is read with its line breaks taken out, and the email's HTML when its plain text doesn't have the sentence: a
   plain-text copy can wrap mid-sentence ("(Oliv\nComprehensive)") or be only image labels (Amir's "Your patient's aligners have
   been delivered", 5 Oct 2026) */
function parseOliv(m) {
  const s = m.subject || '', out = [];
  const plan = /:\s*(.+?)\s*\((\d{3,})\)\s*setup is ready/i.exec(s);
  if (plan) out.push({ kind: 'plan', name: plan[1], ref: plan[2], planUrl: linkFor(m.html, /treatment plan/i) });
  const sent = blocks => { const r = []; blocks.forEach(b => {
    const t = String(b || '').replace(/\s+/g, ' '), re = /aligners for\s+((?:(?!aligners for).)+?),\s*case\s*#\s*(\d{3,}).{0,80}?have\s+(?:been\s+)?(delivered|shipped)/gi; let y;
    while ((y = re.exec(t))) r.push({ kind: y[3].toLowerCase(), name: y[1], ref: y[2], trackUrl: linkFor(m.html, /track/i) }); }); return r; };
  let got = sent(String(m.text || '').split(/\n\s*\n/)); if (!got.length) got = sent(htmlRows(m.html).map(r => r.join(' ')));
  return out.concat(got);
}
/* Angel (iOrtho): "(patient:Full Name #ID ) is ready for review"; "Your case for patient Full Name #ID has shipped" */
function parseAngel(m) {
  const t = mailText(m), out = []; let y;
  const plan = /patient\s*:\s*([^#()\n]+?)\s*#\s*([A-Za-z0-9]{3,})\s*\)?[^.\n]*?ready for review/gi;
  while ((y = plan.exec(t))) out.push({ kind: 'plan', name: y[1], ref: y[2] });
  const ship = /case for patient\s+([^#\n]+?)\s*#\s*([A-Za-z0-9]{3,})\s+has shipped/gi;
  while ((y = ship.exec(t))) out.push({ kind: 'shipped', name: y[1], ref: y[2] });
  return out;
}
/* ---------- Partners' Airway Department: the Zoom call for a MARPE design (Amir, 30 Oct 2026: "the zoom invites got to
   akhavan.ak@gmail.com which is already connected to the app. can you use this to scan and add the zoom with relevant information to the
   case tracker?") ----------
   Each call is booked on Partners' Calendly and comes as a Google Calendar invitation from airway@partnersdentalstudio.com —
   "Invitation: Amir Akhavan and Airway Department @ Fri Sep 18, 2026 11:30am - 12:30pm (EDT) (…)" — with the Zoom link in it and the
   booking form's answers: "Provide first and last name for the patient(s):" one per line, up to four patients in one call. Every patient
   named gets the call's date, time and link on their MARPE case (zoomEffect), which moves to Zoom call scheduled once both records are on
   file. An invite that names no one (Partners' "CBCT Consult with Dr. Akhavan" booking) fills in the case that already has that call,
   else waits on Today for the case to be picked (zoomNoName). A rescheduled call ("Updated invitation") changes the date. Cancellations, the "URGENT: Zoom Call Today" reminders and follow-ups aren't
   read (they stay under Team & security → Email updates for a month, like any email the app doesn't read). */
const OFFICE_TZ = 'America/New_York';
const ZOOM_TZ = { EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7, AKST: -9, AKDT: -8, HST: -10, UTC: 0, GMT: 0 };
const ZOOM_ZONE = { eastern: 'America/New_York', central: 'America/Chicago', mountain: 'America/Denver', pacific: 'America/Los_Angeles' };
const MON3 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function zoomInvite(m) { return /^\s*(?:updated\s+)?invitation(?:\s+with\s+note)?\s*:/i.test(String((m && m.subject) || '')); }
/* the wall clock in a time zone at an instant */
function tzParts(ms, zone) {
  const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return p;
}
function tzOffsetMin(ms, zone) { const p = tzParts(ms, zone); return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - Math.floor(ms / 60000) * 60000) / 60000; }
/* a date and time as the invite gives it (src: a fixed offset in hours, or a time zone) → the office's date and time ('' for no time) */
function officeWhen(y, mo, d, h, mi, src) {
  if (h == null) return { date: y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'), time: '' };
  const guess = Date.UTC(y, mo, d, h, mi); let utc;
  if (src && src.off != null) utc = guess - src.off * 3600e3;
  else { const zone = (src && src.zone) || OFFICE_TZ; utc = guess - tzOffsetMin(guess, zone) * 60000; utc = guess - tzOffsetMin(utc, zone) * 60000; }
  const p = tzParts(utc, OFFICE_TZ);
  return { date: p.year + '-' + p.month + '-' + p.day, time: String(+p.hour % 24).padStart(2, '0') + ':' + p.minute };
}
function hour24(h, ap) { h = Number(h); if (!ap) return h; ap = ap.toLowerCase(); return ap === 'pm' ? (h % 12) + 12 : h % 12; }
/* when the call is: Google's subject ("@ Fri Sep 18, 2026 11:30am - 12:30pm (EDT)"), else the invite's first lines ("Friday Sep 18, 2026 ⋅
   11:30am – 12:30pm" / "Eastern Time - New York") */
function zoomWhen(subject, text) {
  const s = /@\s*(?:[a-z]{3,9}\.?,?\s+)?([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:,?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?(?:[^()]*?\(([a-z]{2,5})\))?/i.exec(String(subject || ''));
  const mk = (mon, d, y, h, mi, ap, src) => { const mo = MON3.indexOf(String(mon).slice(0, 3).toLowerCase()); if (mo < 0 || !(+d >= 1 && +d <= 31)) return null;
    return officeWhen(+y, mo, +d, h == null ? null : hour24(h, ap), Number(mi) || 0, src); };
  if (s) { const tz = s[7] && ZOOM_TZ[s[7].toUpperCase()]; const w = mk(s[1], s[2], s[3], s[4], s[5], s[6], tz != null ? { off: tz } : null); if (w) return w; }
  const b = /\b(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?,?\s+([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s*[⋅·•|-]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i.exec(String(text || ''));
  if (b) { const z = /\b(eastern|central|mountain|pacific)\s+time\b/i.exec(String(text || '')); return mk(b[1], b[2], b[3], b[4], b[5], b[6], z ? { zone: ZOOM_ZONE[z[1].toLowerCase()] } : null); }
  return null;
}
/* the patients the booking form names, or null when the invite has no such question */
function zoomNames(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const qi = lines.findIndex(l => /(first\s+and\s+last\s+names?|patients?['’]?\s+(?:full\s+)?names?)\b[^:]{0,80}:/i.test(l)); if (qi < 0) return null;
  const same = lines[qi].replace(/^[\s\S]*?(?:first\s+and\s+last\s+names?|patients?['’]?\s+(?:full\s+)?names?)\b[^:]{0,80}:/i, '');
  const out = [];
  const take = l => String(l || '').split(/[,;]|\s&\s|\s+and\s+/i).forEach(x => { const n = cleanName(x.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, '')); if (n && n.length <= 60) out.push(n); });
  take(same);
  // (one patient per line under the question, up to a blank line — or the form's next question, in an HTML-only copy)
  for (let i = qi + 1; i < lines.length && out.length < 6; i++) { const l = lines[i].trim(); if (!l || /[:?]/.test(l) || l.length > 60) break; take(l); }
  return out.slice(0, 6);
}
function zoomMeet(url) { return (/\/(?:j|w)\/(\d{9,12})/.exec(String(url || '')) || [])[1] || ''; }
function parseZoomInvite(m) {
  if (!zoomInvite(m)) return [];
  const t = mailText(m), url = zoomLinkFrom(t) || zoomLinkFrom(htmlLinks(m.html).map(l => l.href).join('\n')), when = zoomWhen(m.subject, t);
  if (!zoomHost(url)) return []; // (a calendar invitation that isn't for a Zoom call — a lunch & learn at the office — isn't a case's call)
  const base = { kind: 'zoom', zoomDate: when ? when.date : '', zoomTime: when ? when.time : '', zoomUrl: url, meet: zoomMeet(url),
    title: cleanName(((/event name\s*:?\s*\n\s*([^\n]+)/i.exec(t)) || [])[1] || '').slice(0, 60) };
  const names = zoomNames(t);
  return names && names.length ? names.map(n => Object.assign({ name: n }, base)) : [Object.assign({ name: '' }, base)];
}
function parsePartners(m) { return zoomInvite(m) ? parseZoomInvite(m) : parseLabSummary(m); }
const MAIL_PARSERS = [
  { co: 'ulab', re: /ulabsystems\.com/i, fn: parseUlab }, { co: 'partners', re: /partnersdentalstudio\.com/i, fn: parsePartners },
  { co: 'specialty', re: /specialtyappliances\.com/i, fn: parseLabSummary },
  { co: 'oliv', re: /olivortho\.com/i, fn: parseOliv }, { co: 'angel', re: /angelalign(er)?\.com/i, fn: parseAngel }
];
/* every patient update in one email: [{ co, kind, name, nameKind, ref, tracking, … }] */
function mailParse(mail) {
  const from = String((mail && mail.from) || ''), addr = (/<([^>]+)>/.exec(from) || [0, from])[1];
  const p = MAIL_PARSERS.find(x => x.re.test(addr)); if (!p) return [];
  let evs = []; try { evs = p.fn(mail) || []; } catch (e) { evs = []; }
  // (a Zoom invite that names no one is kept: it waits on Today for the case to be picked)
  return evs.map(e => Object.assign({}, e, { co: p.co, name: cleanName(e.name) })).filter(e => e.name || e.kind === 'zoom').map(e => Object.assign(e, { nameKind: e.name ? nameKindOf(e.name) : '' }));
}

/* ---------- names ---------- */
function nameTokens(s) {
  s = String(s || '');
  if (/,/.test(s)) { const i = s.indexOf(','); s = s.slice(i + 1) + ' ' + s.slice(0, i); } // "Last, First"
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’-]/g, '').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
}
/* "O. Brightwater" (first initial), "Priya Q." (last initial) or a full name */
function nameKindOf(n) { const t = nameTokens(n); return t.length >= 2 && t[0].length === 1 ? 'initialLast' : t.length >= 2 && t[t.length - 1].length === 1 ? 'firstInitial' : 'full'; }
function nameMatches(name, kind, patient) {
  const e = nameTokens(name), p = nameTokens(patient); if (e.length < 2 || p.length < 2) return false;
  const pf = p[0], pl = p[p.length - 1], ef = e[0], el = e[e.length - 1];
  if (kind === 'initialLast') return pf[0] === ef && (pl === el || p.slice(1).join('') === e.slice(1).join(''));
  if (kind === 'firstInitial') return pf === ef && pl[0] === el;
  return e.join(' ') === p.join(' ') || (pf === ef && pl === el); // middle names don't matter
}
const normRef = s => String(s || '').replace(/[\s#-]+/g, '').toUpperCase();

/* ---------- links ---------- */
function hostOk(url, hosts) { try { const u = new URL(url); const h = u.hostname.toLowerCase(); return u.protocol === 'https:' && hosts.some(d => h === d || h.endsWith('.' + d)); } catch (e) { return false; } }
function okLabLink(co, url) { return !!(MAIL_CO[co] && hostOk(url, MAIL_CO[co].hosts)); }
/* a carrier's tracking link (UPS, FedEx, USPS, DHL) → the tracking number in it */
function trackFromUrl(url) {
  if (!url || !hostOk(url, ['ups.com', 'fedex.com', 'usps.com', 'dhl.com'])) return '';
  try { for (const [k, v] of new URL(url).searchParams) if (/^(tracknum|trknbr|tracknumbers?|tlabels|qtc_tlabels1|tracking-?id|awb|trackingnumber|inquirylabels?)$/i.test(k)) { const n = String(v).split(/[\s,]+/)[0]; if (trackInfo(n)) return n; } } catch (e) { }
  return '';
}

/* ---------- finding the case ---------- */
/* matched on the name alone: a lab's daily summary names a patient "First L." and its shipped table has no case # — it could be someone
   else (a patient not entered yet, or the same first name and initial). Partners' and Specialty's rows move a case by themselves only
   when the case is at that lab and has been sent there; otherwise they wait on Today with the case suggested (12 Oct 2026). The aligner
   companies give full names and their own case #s. */
function nameOnlyOk(ev, c) {
  const co = MAIL_CO[ev.co]; if (!co || !co.lab) return true;
  if (!c.lab || labName(c.lab) !== co.lab) return false;
  if (ev.kind === 'received') return true;
  const keys = caseStages(c).map(s => s[0]), sub = keys.indexOf('submitted');
  return sub < 0 || keys.indexOf(pathStage(c, c.stage)) >= sub;
}
/* a Zoom invite → the patient's MARPE case at Partners (or with no lab yet) whose design isn't approved yet. The names are typed by
   whoever booked the call, so a full name has to match to be applied by itself; the same last name is only suggested on Today
   (a first name spelled another way, as Partners' staff typed it). */
function zoomMatch(ev, open, closed) {
  const co = MAIL_CO[ev.co];
  const mine = c => !c.locked && c.type === 'marpe' && (!c.lab || labName(c.lab) === co.lab);
  const marpe = open.filter(mine), ahead = marpe.filter(c => zoomAhead(c));
  if (!ev.name) return zoomNoName(ev, ahead);
  const same = c => nameMatches(ev.name, ev.nameKind, c.patient), exact = ahead.filter(same);
  if (exact.length === 1) return { c: exact[0] };
  if (exact.length > 1) return { many: exact };
  // the patient's MARPE case is past its call (design approved), or was completed after the invite: nothing to do
  if (marpe.some(same) || closed.some(c => mine(c) && same(c) && (c.closedAt || 0) >= (ev.at || 0))) return { done: true };
  const ln = nameTokens(ev.name).slice(-1)[0];
  const sameLast = ln && ln.length > 1 ? ahead.filter(c => nameTokens(c.patient).slice(-1)[0] === ln) : [];
  return sameLast.length ? { many: sameLast, check: true } : { none: true };
}
/* an invite that names no one (Partners' "CBCT Consult with Dr. Akhavan" booking doesn't ask). The case that has this call already — its
   Zoom link pasted in, or its day and time typed in — gets what's missing by itself (the time, the link; Zoom call scheduled once it can
   go there). A case with only the day is suggested on Today; otherwise Today suggests the MARPE cases still waiting for a Zoom date.
   A call that's over by now is left alone: nothing says which case it was. */
function zoomNoName(ev, ahead) {
  const byLink = ev.meet ? ahead.filter(c => zoomMeet(zoomLinkOf(c)) === ev.meet) : [];
  if (byLink.length === 1) return { c: byLink[0] };
  if (byLink.length) return { done: true }; // (several patients on the call, the link on each case already)
  if (ev.zoomDate && ev.zoomDate < todayISO()) return { done: true };
  // (the same day without a link, unless its time says it's another call that day)
  const day = ev.zoomDate ? ahead.filter(c => c.zoomDate === ev.zoomDate && !zoomLinkOf(c) && (!c.zoomTime || !ev.zoomTime || c.zoomTime === ev.zoomTime)) : [];
  const slot = ev.zoomTime ? day.filter(c => c.zoomTime === ev.zoomTime) : [];
  if (slot.length === 1) return { c: slot[0] };
  if (day.length) return { many: day, check: true };
  return { many: ahead.filter(c => !c.zoomDate && ['records', 'submitted'].includes(pathStage(c, c.stage))), check: true };
}
function mailMatch(ev, open, closed) {
  const co = MAIL_CO[ev.co]; if (!co) return { none: true };
  if (ev.kind === 'zoom') return zoomMatch(ev, open, closed);
  const mine = c => !c.locked && co.types.includes(c.type) && (!co.lab || !c.lab || labName(c.lab) === co.lab);
  const ref = normRef(ev.ref);
  const byName = c => mine(c) && nameMatches(ev.name, ev.nameKind, c.patient) && !(ref && c.labRef && normRef(c.labRef) !== ref); // (a different saved case # rules a case out)
  // 1. the company's own case # saved on a case (from an earlier email, or typed in) — unless that case can't move for this update and
  //    another of the patient's open cases can: Angel keeps one patient # for every refinement, so a refinement's "ready for review" or
  //    "shipped" landed on the first case, changed nothing there, and was cleared (12 Oct 2026)
  if (ref) {
    const byRef = open.filter(c => mine(c) && normRef(c.labRef) === ref);
    if (byRef.length === 1) {
      if (mailEffect(byRef[0], ev).to) return { c: byRef[0] };
      const other = open.filter(c => c !== byRef[0] && byName(c) && !!mailEffect(c, ev).to && nameOnlyOk(ev, c));
      return { c: other.length === 1 ? other[0] : byRef[0] };
    }
  }
  // 2. the name among this company's open cases
  const cands = open.filter(byName);
  if (cands.length === 1) return nameOnlyOk(ev, cands[0]) ? { c: cands[0] } : { many: cands, check: true };
  if (cands.length > 1) { const fwd = cands.filter(c => !!mailEffect(c, ev).to); return fwd.length === 1 && nameOnlyOk(ev, fwd[0]) ? { c: fwd[0] } : { many: fwd.length === 1 ? fwd.concat(cands.filter(c => c !== fwd[0])) : cands }; }
  // 3. about a case already completed: nothing to do (a shipment notice can trail the visit by days)
  const recent = ev.kind === 'shipped' || ev.kind === 'delivered' || ev.kind === 'hold' ? 14 * 864e5 : 0;
  if (closed.some(c => mine(c) && ((ref && normRef(c.labRef) === ref) || nameMatches(ev.name, ev.nameKind, c.patient)) && (c.closedAt || 0) >= (ev.at || 0) - recent)) return { done: true };
  return { none: true };
}
/* what an update does to a case: the step it moves to (forward only) and the fields it fills in */
function mailEffect(c, ev) {
  const fl = typeOf(c).flow, keys = caseStages(c).map(s => s[0]), si = keys.indexOf(pathStage(c, c.stage)), at = k => keys.indexOf(k);
  const fwd = k => keys.includes(k) && at(k) > si ? k : null, set = {}; let to = null;
  if (ev.kind === 'plan') to = fwd('dra');
  // (outside aligners: the lab has it — Submitted to lab, 12 Oct 2026. None of the aligner companies' emails read so far says a
  // case was received, so staff tap that step; the setup coming back moves it to Dr. A action from either step)
  else if (ev.kind === 'received') to = fl === 'appliance' ? fwd('mfg') : fl === 'marpe' || fl === 'outside' ? fwd('submitted') : null;
  else if (ev.kind === 'shipped') to = fl === 'marpe' ? fwd('approved') : fwd('shipped');
  else if (ev.kind === 'delivered') to = fwd('arrived');
  else if (ev.kind === 'zoom') { if (typeOf(c).flow !== 'marpe' || !zoomAhead(c)) return { to: null, set }; to = zoomEffect(c, ev, set, fwd); } // (nothing for another kind of case)
  // shipped to the patient: a lab email takes it as far as Shipped (it skips Arrived), never on to Checked into Milestones —
  // someone checks it in, and only then is it complete (Amir's staff, 7 Oct 2026; until then Shipped completed the case)
  const sp = shipStep(c); if (sp && (ev.kind === 'shipped' || ev.kind === 'delivered')) to = fwd(sp);
  if (ev.kind === 'hold') {
    const late = si >= (fl === 'marpe' ? at('delivered') : at('shipped')), h = { date: ev.holdDate || '', reason: ev.reason || '' };
    if (si >= 0 && !late && c.labHoldSeen !== h.date + '|' + h.reason && !(c.labHold && c.labHold.date === h.date && c.labHold.reason === h.reason)) set.labHold = h;
  } else if (c.labHold && (ev.kind === 'shipped' || ev.kind === 'delivered')) set.labHold = '';
  if (ev.ref && !c.labRef) set.labRef = String(ev.ref).slice(0, 40);
  const lab = MAIL_CO[ev.co] && MAIL_CO[ev.co].lab; if (lab && !c.lab) set.lab = lab; // (its next summary rows then match by themselves)
  const tk = trackInfo(ev.tracking) || trackInfo(trackFromUrl(ev.trackUrl));
  if (tk && !trackList(c).some(t => t.n === tk.n)) { set.tracking = (String(c.tracking || '').trim() + ' ' + tk.n).trim(); if (!tk.carrier && ev.carrier && !c.carrier) set.carrier = String(ev.carrier).slice(0, 20); }
  if (ev.planUrl && okLabLink(ev.co, ev.planUrl) && c.planUrl !== ev.planUrl) set.planUrl = ev.planUrl;
  return { to, set };
}
/* a Zoom invite on a MARPE case (only while its call is still ahead — before Design approved): the call's date, time and link, and
   Zoom call scheduled once the case can go there (both records on file: stageNeeds). zoomAt is when the case's Zoom call was last
   set — by an invite (the email's time) or by hand (Edit, the Zoom call window, New submission). An invite newer than that sets the
   call (a rescheduled one changes it); an older one — a copy that came late, or one from before the date was typed in — only fills
   in the time or the link of the same day's call, and never undoes a later change. */
function zoomEffect(c, ev, set, fwd) {
  if (typeOf(c).flow !== 'marpe' || !zoomAhead(c)) return null;
  const link = zoomLinkOf(c);
  if ((ev.at || 0) > (Number(c.zoomAt) || 0)) {
    if (ev.zoomDate && ev.zoomDate !== (c.zoomDate || '')) { set.zoomDate = ev.zoomDate; set.zoomTime = ev.zoomTime || ''; }
    else if (ev.zoomDate && ev.zoomTime && ev.zoomTime !== (c.zoomTime || '')) set.zoomTime = ev.zoomTime;
    if (ev.zoomUrl && ev.zoomUrl !== link) set.zoomUrl = ev.zoomUrl;
  } else if (ev.zoomDate && ev.zoomDate === c.zoomDate) {
    if (ev.zoomTime && !c.zoomTime) set.zoomTime = ev.zoomTime;
    if (ev.zoomUrl && !link) set.zoomUrl = ev.zoomUrl;
  }
  if (Object.keys(set).length) set.zoomAt = Math.max(Number(c.zoomAt) || 0, ev.at || 0);
  const after = Object.assign({}, c, set);
  return after.zoomDate && !stageNeeds(after, 'zoom').length ? fwd('zoom') : null;
}
/* apply one update to a case (in a transaction; an update already applied, or one that changes nothing, is skipped) */
async function mailApply(ev, c) {
  const eff = mailEffect(c, ev);
  await B.mutateCase(c.id, d => {
    if ((d.mailIds || []).includes(ev.key)) return 'skip';
    const e2 = mailEffect(Object.assign({}, d, { id: c.id }), ev);
    if (!e2.to && !Object.keys(e2.set).length) return 'skip';
    if (e2.to) d.stage = e2.to;
    Object.assign(d, e2.set);
    d.mailIds = (d.mailIds || []).concat(ev.key).slice(-40);
  }, Object.assign({ a: 'email', co: ev.co, kind: ev.kind, from: c.stage, to: eff.to || null, fields: Object.keys(eff.set).filter(k => k !== 'zoomAt') }));
  return 'ok';
}

/* ---------- keeping up with the inbox ---------- */
const MAILS = { list: [], unread: [], pick: {}, sig: '', busy: false, again: false, state: null, stateAt: 0, gone: new Set(), goneFp: new Set() };
/* the same update in several emails is one update: both mailboxes can get the same email, Partners lists a patient
   day after day, and a shipment can be announced twice. A new setup from Oliv/Angel counts as new (its email date is part of it). */
function mailFp(ev) {
  const a = [ev.co, ev.kind, nameTokens(ev.name).join(' '), normRef(ev.ref), String(ev.tracking || trackFromUrl(ev.trackUrl) || '').replace(/\s+/g, '').toUpperCase(),
    ev.kind === 'hold' ? (ev.holdDate || '') + '|' + String(ev.reason || '').toLowerCase() : '', ev.kind === 'plan' ? String(ev.at || '') : ''];
  // a Zoom invite: its call (a rescheduled call is a new update; the same invite in both mailboxes is one). Added only for these, so
  // every other update keeps the same fingerprint as before (the dismissed ones stay dismissed)
  if (ev.kind === 'zoom') a.push([ev.zoomDate || '', ev.zoomTime || '', ev.meet || ev.zoomUrl || ''].join('/'));
  return a.join('|');
}
/* updates dismissed or applied on this computer are remembered here for 30 days (a keyed hash, no names), so the same
   update in a later email — the next day's Partners summary, a copy in the other mailbox — doesn't come back */
const MAILMEM = 'nloCases.mailGone';
async function mailHash(fp) {
  if (!MAILS.hk) {
    const ring = B === FB && FB.ring ? FB.ring : null, v = ring ? Math.min.apply(null, Object.keys(ring).map(Number)) : 0;
    const raw = ring ? unb64(ring[v]) : TE.encode('nlo-cases-demo-only-key-material!');
    const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
    MAILS.hk = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: TE.encode('mail-dismissed') }, base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
  }
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', MAILS.hk, TE.encode(fp)));
  return Array.from(sig.subarray(0, 12), b => b.toString(16).padStart(2, '0')).join('');
}
function mailMemLoad() {
  if (MAILS.mem) return MAILS.mem; let a = [];
  try { a = JSON.parse(localStorage.getItem(MAILMEM) || '[]'); } catch (e) { }
  const cut = Date.now() - 30 * 864e5; MAILS.mem = new Map((Array.isArray(a) ? a : []).filter(x => x && x.h && x.t > cut).map(x => [x.h, x.t]));
  return MAILS.mem;
}
async function mailMemAdd(fp) {
  const m = mailMemLoad(); m.set(await mailHash(fp), Date.now());
  try { localStorage.setItem(MAILMEM, JSON.stringify(Array.from(m, ([h, t]) => ({ h, t })).slice(-3000))); } catch (e) { }
}
async function mailMemDel(fp) { // (a lab order dismissed here once, and linked to a case since)
  const m = mailMemLoad(); if (!m.delete(await mailHash(fp))) return;
  try { localStorage.setItem(MAILMEM, JSON.stringify(Array.from(m, ([h, t]) => ({ h, t })).slice(-3000))); } catch (e) { }
}
/* the completed cases a lab email could be about (mailMatch: closed after the email's date, less two weeks) — those closed since
   the oldest email waiting, not every completed case; read again after half an hour */
async function mailClosedReady(docs) {
  if (S.histLoaded) return;
  const oldest = Math.min.apply(null, [Date.now()].concat(docs.map(d => Number((d.mail && d.mail.date) || d.at) || Date.now())));
  const days = Math.min(3650, Math.ceil((Date.now() - oldest) / 864e5) + 15), m = S.mailClosed;
  if (m && m.days >= days && Date.now() - m.at < 30 * 60e3) return;
  try { const list = liveCases(await B.loadClosed(days)); if (S.inApp) S.mailClosed = { list, days, at: Date.now() }; } catch (e) { }
}
/* an opened inbox item as the app reads it: plain text and numbers only. A robot could seal anything — an object where a string
   should be would stop every sync on every computer (security review, 6 Oct 2026) — so the known fields are taken as text */
function plainStr(v) { return typeof v === 'string' ? v : typeof v === 'number' && isFinite(v) ? String(v) : ''; }
function mailNorm(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  if (m.lab) return Object.assign({}, m, { lab: 1 }); // (the lab PC's: lab.js reads its own fields as carefully)
  if (m.bt) return Object.assign({}, m, { bt: 1 }); // (the Tray Maker's: traymaker.js)
  const n = typeof m.date === 'number' ? m.date : Number(plainStr(m.date));
  return { box: plainStr(m.box), from: plainStr(m.from), subject: plainStr(m.subject), text: plainStr(m.text), html: plainStr(m.html), date: n > 0 && isFinite(n) ? n : 0 };
}
async function mailSync() {
  if (!S.inApp || !B.inboxLoad || S.firstLoad) return;
  if (MAILS.busy) { MAILS.again = true; return; }
  MAILS.busy = true;
  try {
    const docs = await B.inboxLoad(); if (!S.inApp) return;
    docs.forEach(d => { d.mail = mailNorm(d.mail); });
    if (docs.length) await mailClosedReady(docs);
    const open = openCases(), closed = (S.hist || []).concat(S.closed || [], (S.mailClosed && S.mailClosed.list) || []), groups = new Map(), unread = [], mem = mailMemLoad(), labDocs = [], prDocs = [], btDocs = [];
    // updates waiting for someone, one row per update however many emails carry it
    const wait = (d, i, ev, cands, check) => {
      const fp = mailFp(ev); let g = groups.get(fp);
      if (!g) { g = { id: d.id + ':' + i, fp, ev, items: [], cands: cands || [], check: !!check }; groups.set(fp, g); }
      g.items.push({ d, i, key: d.id + ':' + i }); if ((ev.at || 0) > (g.ev.at || 0)) g.ev = ev;
      if (!g.cands.length && cands && cands.length) g.cands = cands;
    };
    for (const d of docs) {
      const old = Date.now() - (d.at || Date.now()) > 30 * 864e5;
      // can't be opened (another key, or damaged): kept a month like a format the app doesn't read, then cleared
      if (!d.mail) { if (old) await B.inboxDelete(d.id).catch(() => { }); else unread.push({ d, bad: true }); continue; }
      if (d.mail.lab) { labDocs.push(d); continue; } // the lab PC's progress on the in-house sets (lab.js)
      if (d.mail.bt) { btDocs.push(d); continue; } // the Tray Maker: a case's models are in OrthoFactory (traymaker.js)
      if (prMail(d.mail)) { prDocs.push(d); continue; } // Formlabs' emails about each print (prints.js)
      try {
        if (leadsMail(d.mail)) { if (Date.now() - (d.at || Date.now()) > 30 * 864e5) await B.inboxDelete(d.id).catch(() => { }); continue; }
        const evs = mailParse(d.mail);
        if (!evs.length) { // not a format the app reads yet: kept a month, so a newer app can still read it
          if (Date.now() - (d.at || Date.now()) > 30 * 864e5) await B.inboxDelete(d.id).catch(() => { }); else unread.push({ d });
          continue;
        }
        const done = new Set(d.done || []), add = [], todo = [];
        for (let i = 0; i < evs.length; i++) {
          if (done.has(i)) continue;
          const ev = Object.assign(evs[i], { key: d.id + ':' + i, at: d.mail.date || d.at || Date.now() });
          // dealt with already (this copy, or the same update in another email): mark it done here too, never show it again
          const fp = mailFp(ev);
          if (MAILS.gone.has(ev.key) || MAILS.goneFp.has(fp) || mem.has(await mailHash(fp))) { done.add(i); add.push(i); continue; }
          const m = mailMatch(ev, open, closed);
          if (m.c || m.done) todo.push({ i, ev, m }); else wait(d, i, ev, m.many, m.check);
        }
        // what can be applied is applied by one open app (the one that claims the email); the rest wait on Today
        if (todo.length && await B.inboxClaim(d.id)) {
          for (const { i, ev, m } of todo) {
            let ok = !!m.done; if (m.c) { try { await mailApply(ev, m.c); ok = true; } catch (e) { ok = e && e.code === 'skip'; } }
            if (ok) { done.add(i); add.push(i); } else wait(d, i, ev, [m.c]);
          }
        }
        if (done.size >= evs.length) await B.inboxDelete(d.id).catch(() => { });
        else if (add.length) await B.inboxDone(d.id, add).catch(() => { });
      } catch (e) { if (window.console) console.warn('email update:', e && e.message); if (old) await B.inboxDelete(d.id).catch(() => { }); } // (one item that fails doesn't stop the rest)
    }
    // the Tray Maker's notes before the lab PC's orders: a case its note moves on is past To make when the lab PC's report of the
    // same order is read (lab.js tmMatch), so that one changes nothing more
    if (btDocs.length) { try { await tmSync(btDocs, open, closed); } catch (e) { if (window.console) console.warn('tray maker:', e && e.message); } }
    let labSig = ''; try { labSig = await labSync(labDocs, openCases(), closed, mem); } catch (e) { if (window.console) console.warn('lab progress:', e && e.message); }
    if (prDocs.length) { try { (await prSync(prDocs, open)).unread.forEach(x => unread.push(x)); } catch (e) { if (window.console) console.warn('prints:', e && e.message); } }
    const list = Array.from(groups.values()).filter(g => !MAILS.goneFp.has(g.fp)).sort((a, b) => (b.ev.at || 0) - (a.ev.at || 0));
    MAILS.list = list; MAILS.unread = unread;
    const sig = list.map(x => x.id + '#' + x.items.length).join() + '|' + unread.length + '|' + labSig;
    if (sig !== MAILS.sig) { MAILS.sig = sig; if (S.view === 'today' || S.view === 'admin') queueRender('team'); }
    if (isOwner()) mailOwnerChecks();
  } catch (e) { if (window.console) console.warn('email updates:', e && e.message); }
  finally { MAILS.busy = false; if (MAILS.again) { MAILS.again = false; setTimeout(mailSync, 400); } else nsCheck(); } // (then the front-desk email — noship.js)
}
/* the owner's app keeps the script's sender list current (so a new lab doesn't need a new script); looked at again at
   most once a minute, since a page opened before an update (until it's reloaded) puts its own older list back */
async function mailOwnerChecks() {
  try {
    const fresh = MAILS.state && Date.now() - (MAILS.stateAt || 0) < 60000;
    const st = fresh ? MAILS.state : await B.mailState(); if (!fresh) { MAILS.state = st; MAILS.stateAt = Date.now(); }
    if (st && st.pub && JSON.stringify(st.pub.senders || []) !== JSON.stringify(MAIL_SENDERS)) { await B.mailSenders(MAIL_SENDERS); MAILS.state = null; }
  } catch (e) { }
}
async function mailResolve(gid, how) {
  const x = MAILS.list.find(g => g.id === gid); if (!x) return;
  if (how === 'apply') {
    const c = findCase(MAILS.pick[x.id] || (x.cands.length === 1 ? x.cands[0].id : '')); if (!c) return;
    // (a Zoom call goes on a MARPE case before Design approved: the update stays for the right case — one picked that changed since)
    if (x.ev.kind === 'zoom' && (typeOf(c).flow !== 'marpe' || !zoomAhead(c))) { toast('A Zoom call goes on the patient’s MARPE case before its design is approved — pick that case', { bad: true }); return; }
    try { await mailApply(x.ev, c); toast('Applied to ' + (ptNameText(c.patient) || 'the case')); } // (it saves the lab's case #: later emails for this patient match on it)
    catch (e) { if (!(e && e.code === 'skip')) { toast(errText(e), { bad: true }); return; } toast('Nothing to change on ' + (ptNameText(c.patient) || 'that case')); }
  }
  await mailForget(x);
  mailSync();
}
/* an update is dealt with: this app won't show it again, and its next sync (which runs right after, one at a time)
   marks every email carrying it done for everyone, or removes the email once nothing in it is left */
async function mailForget(g) {
  MAILS.goneFp.add(g.fp); g.items.forEach(it => MAILS.gone.add(it.key));
  MAILS.list = MAILS.list.filter(y => y !== g); MAILS.sig = ''; queueRender();
  try { await mailMemAdd(g.fp); } catch (e) { }
}

/* ---------- Today, for Dr. A: a mailbox that has gone quiet ----------
   Each mailbox's script checks every 10 minutes and notes it (mailbeat). When one hasn't for an hour, or reports a problem, lab
   emails from that mailbox aren't reaching the app — until now that showed only under Team & security (12 Oct 2026). The lab PC's
   check-ins are left out (it's off at night; Team & security shows it). */
const MAIL_QUIET = 60 * 60000;
function mailHealthBad() { return (MAILS.beats || []).filter(b => !labBeat(b) && (b.err || !b.at || Date.now() - b.at > MAIL_QUIET)); }
function mailHealthHTML() {
  if (!isOwner() || S.tour) return '';
  const bad = mailHealthBad(); MAILS.healthSig = bad.map(b => b.id + (b.err ? '!' : '')).join();
  if (!bad.length) return '';
  return '<div class="card bkDue mlHealth" id="mlHealth"><div class="cardBd">' + ic('alert', 20) + '<span class="grow"><b>Lab emails may not be reaching NLO Cases.</b> ' +
    bad.map(b => esc(b.box || 'A mailbox') + (b.err ? ' reported a problem: ' + esc(b.err) : b.at ? ' hasn’t checked in since ' + esc(fmtWhen(b.at)) : ' hasn’t checked in yet')).join(' · ') +
    '</span><button class="btn btn-sec btn-sm" data-act="nav" data-v="admin">Team &amp; security</button></div></div>';
}
// a mailbox goes quiet without anything changing, so look again every 5 minutes
if (typeof setInterval === 'function') setInterval(() => {
  try { if (S.view === 'today' && isOwner() && mailHealthBad().map(b => b.id + (b.err ? '!' : '')).join() !== (MAILS.healthSig || '')) queueRender(); } catch (e) { }
}, 5 * 60000);

/* ---------- Today: updates waiting for a case ---------- */
function mailCardHTML() {
  const L = MAILS.list; if (!L.length) return '';
  const open = openCases().filter(c => !c.locked).sort((a, b) => String(a.patient || '').localeCompare(String(b.patient || '')));
  return '<div class="card mailCard" id="mailCard"><div class="cardHd"><h3>Email updates</h3><span class="sub">' + L.length + ' from lab emails didn’t match an open case for sure — pick the case, or dismiss</span><span style="flex:1"></span>' +
    (L.length > 1 ? '<button class="btn btn-ghost btn-sm" data-act="mailSkipAll" title="Nothing to do for any of these">Dismiss all</button>' : '') + '</div><div class="cardBd">' +
    L.map(x => {
      const ev = x.ev, co = MAIL_CO[ev.co], pick = MAILS.pick[x.id] || (x.cands.length === 1 ? x.cands[0].id : ''), gid = esc(x.id), zm = ev.kind === 'zoom';
      const opt = c => '<option value="' + esc(c.id) + '"' + (pick === c.id ? ' selected' : '') + '>' + esc((ptNameText(c.patient) || '(no name)') + ' · ' + typeOf(c).l + ' · ' + stageLabel(c)) + '</option>';
      // (a Zoom invite only goes on a MARPE case whose call is still ahead: only those are offered)
      const isMine = c => zm ? c.type === 'marpe' && zoomAhead(c) : co.types.includes(c.type), mine = open.filter(isMine), rest = zm ? [] : open.filter(c => !isMine(c));
      const zWhen = zm && ev.zoomDate ? fmtDay(ev.zoomDate) + (ev.zoomTime ? ', ' + fmtTime(ev.zoomTime) : '') : '';
      return '<div class="mlRow"><div class="mlWhat"><span class="badge ' + TYPE[co.types[0]].cls + '">' + esc(co.l) + '</span><b>' + esc(MAIL_KIND[ev.kind] || ev.kind) + '</b>' +
        (ev.name ? '<span class="mlName">' + ptName(ev.name) + '</span>' : '<span class="mlName muted">The invite doesn’t name the patient</span>') + (ev.ref ? '<span class="small muted">#' + esc(ev.ref) + '</span>' : '') +
        (zWhen ? '<span class="small" style="display:inline-flex;align-items:center;gap:4px">' + ic('video', 13) + esc(zWhen) + '</span>' : '') + (zm && ev.title ? '<span class="small muted">' + esc(ev.title) + '</span>' : '') +
        (ev.tracking ? '<span class="small muted">' + esc((trackInfo(ev.tracking) || {}).carrier || 'tracking') + ' ' + esc(ev.tracking) + '</span>' : '') +
        (ev.reason ? '<span class="small" style="color:var(--coral-700)">' + esc(ev.reason) + '</span>' : '') +
        '<span class="small muted">' + esc(fmtWhen(ev.at)) + '</span>' + (x.items.length > 1 ? '<span class="small muted">in ' + x.items.length + ' emails</span>' : '') +
        (x.cands.length > 1 ? '<span class="small" style="color:var(--amber-700)">' + x.cands.length + ' possible cases</span>'
          : zm && !ev.name ? '<span class="small" style="color:var(--amber-700)">' + (!x.cands.length ? 'Pick the MARPE case it’s for'
            : ev.zoomDate && x.cands[0].zoomDate === ev.zoomDate ? 'This case has the call’s day — check it’s this one' : 'The one MARPE case waiting for a Zoom date — check it’s this one') + '</span>'
          : x.check ? '<span class="small" style="color:var(--amber-700)">' + (zm ? 'Matched on the last name only — check it’s this case' : 'Matched on the name only — check it’s this case') + '</span>'
          // (a named invite stays in the inbox for a month: the case added with this name later gets the call by itself)
          : zm && !x.cands.length ? '<span class="small" style="color:var(--amber-700)">No open MARPE case with this name — add it and the call goes on it by itself, or pick the case</span>' : '') + '</div>' +
        '<div class="mlDo"><span class="mlPh" data-mlph="' + gid + '">' + ptAv(pick ? findCase(pick) : null, 32) + '</span><select class="inp mlSel" data-g="' + gid + '" aria-label="Case for this update"><option value="">Pick the case…</option>' +
        (x.cands.length > 1 ? '<optgroup label="Possible matches">' + x.cands.map(opt).join('') + '</optgroup>' : '') +
        (mine.length ? '<optgroup label="' + esc(zm ? 'MARPE cases' : co.l + ' cases') + '">' + mine.map(opt).join('') + '</optgroup>' : zm ? '<option value="" disabled>No MARPE case waiting for its Zoom call</option>' : '') +
        (rest.length ? '<optgroup label="Other open cases">' + rest.map(opt).join('') + '</optgroup>' : '') + '</select>' +
        '<button class="btn btn-mint btn-sm" data-act="mailApply" data-g="' + gid + '"' + (pick ? '' : ' disabled') + '>Apply</button>' +
        '<button class="btn btn-ghost btn-sm" data-act="mailSkip" data-g="' + gid + '" title="Nothing to do for this one">Dismiss</button></div></div>';
    }).join('') + '</div></div>';
}

/* ---------- Team & security: set up the script, see each mailbox's last check ---------- */
function mailAdminHTML() {
  const st = MAILS.state;
  if (!st || Date.now() - MAILS.stateAt > 60000) loadMailState();
  const head = '<div class="card" style="margin-top:18px" id="mailAdmin"><div class="cardHd"><h3>Email updates</h3><span class="sub">Lab emails update cases by themselves</span></div><div class="cardBd">';
  if (!st) return head + '<div class="small muted">Loading…</div></div></div>';
  const how = '<p class="small" style="margin-bottom:10px">A small script in each Gmail account that gets lab emails (yours and the records inbox) sends them — uLab, Partners Dental Solutions, Specialty Appliances, Oliv, Angel and anything labeled “Lab Update” — to this app, locked so only the app can read them. When anyone has NLO Cases open, cases move on by themselves: plan ready → Dr. A action, received by the lab → Manufacturing, shipped → Shipped with the tracking #, delivered → Arrived, on hold → a Lab hold flag, and a Zoom invite from Partners’ Airway Department → the call’s date, time and Zoom link on each patient’s MARPE case (Zoom call scheduled once both records are on file). Anything it can’t place shows on Today. Formlabs’ emails about each print (to your Gmail) show on the in-house set they’re for, in its Lab section, and offer Printing, then Thermoforming, with one tap.</p>';
  if (!st.on) return head + how + '<button class="btn btn-act btn-sm" data-act="mailSetup">' + ic('plus', 15) + 'Set up email updates</button></div></div>';
  const beats = (st.beats || []).filter(b => !labBeat(b)).sort((a, b) => (b.at || 0) - (a.at || 0)); // (the lab PC's are under Lab PC)
  const box = b => { const late = !b.at || Date.now() - b.at > 40 * 60000;
    return '<div class="mlBeat"><span class="dot ' + (b.err ? 'bad' : late ? 'busy' : 'ok') + '"></span><b>' + esc(b.box) + '</b><span class="small muted">checked ' + esc(b.at ? fmtWhen(b.at) : '—') + (b.sent ? ' · ' + b.sent + ' sent' : '') + (b.ver ? ' · script v' + esc(b.ver) : '') + '</span>' +
      (b.err ? '<div class="small" style="color:var(--coral-700);flex-basis:100%">Last problem: ' + esc(b.err) + '</div>' : late ? '<div class="small" style="color:var(--amber-700);flex-basis:100%">No check in the last 40 minutes. Is the script still on?</div>' : '') + '</div>'; };
  const unread = MAILS.unread.filter(x => !x.bad).length;
  return head + how +
    (beats.length ? beats.map(box).join('') : '<div class="notice">No mailbox has checked in yet. Get the script and run <b>setup</b> in each Gmail account.</div>') +
    prFeedHTML() + // (the 3D printer's emails: the newest print on a case — prints.js)
    (unread ? '<div class="small muted" style="margin:8px 0">' + unread + ' lab email' + (unread > 1 ? 's' : '') + ' from a format the app doesn’t read yet (kept 30 days): ' + MAILS.unread.filter(x => !x.bad).slice(0, 5).map(x => esc(String(x.d.mail.from || '').replace(/<.*$/, '').trim() || 'unknown sender')).join(', ') + '</div>' : '') +
    '<div class="mlBtns"><button class="btn btn-sec btn-sm" data-act="mailScript">' + ic('download', 15) + 'Get the script</button><button class="btn btn-ghost btn-sm" data-act="mailOff" style="color:var(--coral-700)">Turn off</button></div>' +
    nsAdminHTML() + '</div></div>'; // (the front-desk email for a case not shipped in time — noship.js)
}
async function loadMailState() {
  if (MAILS.stateLoading || !B.mailState) return; MAILS.stateLoading = true;
  try { MAILS.state = await B.mailState(); MAILS.stateAt = Date.now(); nsKeepKey(); } catch (e) { MAILS.state = { on: false, beats: [], err: errText(e) }; MAILS.stateAt = Date.now(); }
  MAILS.stateLoading = false; if (S.view === 'admin') queueRender('team');
}
/* the script with this office's robot login filled in */
async function mailScriptText(creds) {
  const r = await fetch('nlo-cases-mail.gs', { cache: 'no-store' }); if (!r.ok) throw new Error('Could not load the script (' + r.status + ')');
  const src = await r.text(), cfg = B === DEMO ? { demo: true } : FB.cfg;
  const conf = { apiKey: cfg.apiKey || 'demo', projectId: cfg.projectId || 'demo', botEmail: creds.email, botPassword: creds.password };
  if (FB.emu) { conf.authBase = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'; conf.fsBase = 'http://127.0.0.1:8080/v1'; }
  if (src.indexOf('/*NLO_CONFIG*/null') < 0) throw new Error('This copy of the script is missing its settings line');
  return src.replace('/*NLO_CONFIG*/null', JSON.stringify(conf));
}
async function mailScriptModal(creds) {
  let text = ''; try { text = await mailScriptText(creds); } catch (e) { toast(errText(e), { bad: true }); return; }
  MAILS.script = text;
  openModal('<h3>Email updates script</h3><div class="lsub">Do this once in each Gmail account that gets lab emails — yours and the records inbox. About 3 minutes each.</div>' +
    '<ol class="mlSteps"><li>Signed in to that Gmail account, open <b>script.google.com</b> and click <b>New project</b>.</li>' +
    '<li>Click <b>Copy the script</b> below. In the project, select all of the sample code, paste over it, and click <b>Save</b> (the disk icon).</li>' +
    '<li>In the top bar, pick <b>setup</b> next to Run and click <b>Run</b>. Click <b>Review permissions</b>, choose the account, then <b>Allow</b>. If Google says it hasn’t verified the app: <b>Advanced → Go to the project</b>. It’s your own script.</li>' +
    '<li>Back here, the account appears under Email updates with its first check. From then on it checks every 10 minutes.</li></ol>' +
    '<p class="small muted">The script holds the email robot’s login, which can only add sealed emails to this app. Don’t share it. If it ever leaks, use <b>Turn off</b>, then set up again.</p>' +
    '<textarea id="mlScript" class="inp" rows="4" readonly spellcheck="false" style="width:100%;font-family:ui-monospace,Menlo,monospace;font-size:11px;margin-top:6px">' + esc(text) + '</textarea>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="mailDownload">' + ic('download', 16) + 'Download .gs</button><button class="btn btn-pri" data-act="mailCopy">Copy the script</button><button class="btn btn-sec" data-act="closeModal">Done</button></div>', w => w.querySelector('.modal').classList.add('wide'));
}
Object.assign(ADMIN_ACTS, {
  async mailSetup(t) {
    if (!await confirmBox('Set up email updates?', 'This makes a login for the email robot. It can only add sealed lab emails to this app. Then you copy a short script into each Gmail account.', 'Set up')) return;
    busyBtn(t, true, 'Setting up…');
    try { const creds = await B.mailSetup(); MAILS.state = null; loadMailState(); await mailScriptModal(creds); }
    catch (e) { busyBtn(t, false); toast(errText(e), { bad: true }); }
  },
  async mailScript() {
    try { const creds = await B.mailCreds(); if (!creds) { toast('Set up email updates first', { bad: true }); return; } await mailScriptModal(creds); }
    catch (e) { toast(errText(e), { bad: true }); }
  },
  async mailCopy() { const ok = await copyText(MAILS.script || ''); toast(ok ? 'Script copied — paste it into the new Apps Script project' : 'Couldn’t copy — use Download .gs instead', ok ? {} : { bad: true }); },
  mailDownload() {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([MAILS.script || ''], { type: 'text/plain' })); a.download = 'nlo-cases-email-updates.gs';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },
  async mailOff() {
    if (!await confirmBox('Turn off email updates?', 'The email robot’s login stops working right away, so the scripts can’t send anything more. Also open each script and run “stop” so it stops trying. You can set it up again any time.', 'Turn off', true)) return;
    try { await B.mailOff(); MAILS.state = null; loadMailState(); toast('Email updates turned off'); } catch (e) { toast(errText(e), { bad: true }); }
  },
  mailApply(t) { mailResolve(t.dataset.g, 'apply'); },
  mailSkip(t) { mailResolve(t.dataset.g, 'skip'); },
  async mailSkipAll(t) {
    const L = MAILS.list.slice(); if (!L.length) return;
    if (!await confirmBox('Dismiss all ' + L.length + ' email updates?', 'They’re cleared from Today for everyone. Nothing changes on any case.', 'Dismiss all')) return;
    busyBtn(t, true, 'Dismissing…');
    await Promise.all(L.map(g => mailForget(g)));
    toast(L.length + ' email update' + (L.length > 1 ? 's' : '') + ' dismissed'); mailSync();
  }
});
