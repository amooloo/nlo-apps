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
/* (Specialty Appliances: their "Daily Case Summary" to the records inbox — Amir, 4 Oct 2026: "yes I want specialty added") */
const MAIL_SENDERS = ['ulabsystems.com', 'partnersdentalstudio.com', 'specialtyappliances.com', 'olivortho.com', 'angelaligner.com', 'angelalign.com', 'thenextlevelorthodontics@orthohost.com'];
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
const MAIL_KIND = { received: 'Received by the lab', plan: 'Ready for Dr. A’s review', shipped: 'Shipped', delivered: 'Delivered', hold: 'On hold at the lab' };
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
/* uLab: "Your uLab order X has shipped." — Order Number / Patient Name / tracking #, maybe several orders */
function parseUlab(m) {
  const t = mailText(m), out = [];
  if (!/shipped|on the way/i.test((m.subject || '') + ' ' + t)) return out;
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
const MAIL_PARSERS = [
  { co: 'ulab', re: /ulabsystems\.com/i, fn: parseUlab }, { co: 'partners', re: /partnersdentalstudio\.com/i, fn: parseLabSummary },
  { co: 'specialty', re: /specialtyappliances\.com/i, fn: parseLabSummary },
  { co: 'oliv', re: /olivortho\.com/i, fn: parseOliv }, { co: 'angel', re: /angelalign(er)?\.com/i, fn: parseAngel }
];
/* every patient update in one email: [{ co, kind, name, nameKind, ref, tracking, … }] */
function mailParse(mail) {
  const from = String((mail && mail.from) || ''), addr = (/<([^>]+)>/.exec(from) || [0, from])[1];
  const p = MAIL_PARSERS.find(x => x.re.test(addr)); if (!p) return [];
  let evs = []; try { evs = p.fn(mail) || []; } catch (e) { evs = []; }
  return evs.map(e => Object.assign({}, e, { co: p.co, name: cleanName(e.name) })).filter(e => e.name).map(e => Object.assign(e, { nameKind: nameKindOf(e.name) }));
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
function mailMatch(ev, open, closed) {
  const co = MAIL_CO[ev.co]; if (!co) return { none: true };
  const mine = c => !c.locked && co.types.includes(c.type) && (!co.lab || !c.lab || labName(c.lab) === co.lab);
  const ref = normRef(ev.ref);
  // 1. the company's own case # saved on a case (from an earlier email, or typed in)
  if (ref) { const byRef = open.filter(c => mine(c) && normRef(c.labRef) === ref); if (byRef.length === 1) return { c: byRef[0] }; }
  // 2. the name among this company's open cases (a different saved case # rules a case out)
  const cands = open.filter(c => mine(c) && nameMatches(ev.name, ev.nameKind, c.patient) && !(ref && c.labRef && normRef(c.labRef) !== ref));
  if (cands.length === 1) return { c: cands[0] };
  if (cands.length > 1) { const fwd = cands.filter(c => !!mailEffect(c, ev).to); return fwd.length === 1 ? { c: fwd[0] } : { many: cands }; }
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
  else if (ev.kind === 'received') to = fl === 'appliance' ? fwd('mfg') : fl === 'marpe' ? fwd('submitted') : null;
  else if (ev.kind === 'shipped') to = fl === 'marpe' ? fwd('approved') : fwd('shipped');
  else if (ev.kind === 'delivered') to = fwd('arrived');
  // shipped to the patient: a lab email takes it as far as Shipped (it skips Arrived), never on to Checked into Milestones —
  // someone checks it in, and only then is it complete (Amir's staff, 7 Oct 2026; until then Shipped completed the case)
  const sp = shipStep(c); if (sp && (ev.kind === 'shipped' || ev.kind === 'delivered')) to = fwd(sp);
  if (ev.kind === 'hold') {
    const late = si >= (fl === 'marpe' ? at('delivered') : at('shipped')), h = { date: ev.holdDate || '', reason: ev.reason || '' };
    if (si >= 0 && !late && c.labHoldSeen !== h.date + '|' + h.reason && !(c.labHold && c.labHold.date === h.date && c.labHold.reason === h.reason)) set.labHold = h;
  } else if (c.labHold && (ev.kind === 'shipped' || ev.kind === 'delivered')) set.labHold = '';
  if (ev.ref && !c.labRef) set.labRef = String(ev.ref).slice(0, 40);
  const tk = trackInfo(ev.tracking) || trackInfo(trackFromUrl(ev.trackUrl));
  if (tk && !trackList(c).some(t => t.n === tk.n)) { set.tracking = (String(c.tracking || '').trim() + ' ' + tk.n).trim(); if (!tk.carrier && ev.carrier && !c.carrier) set.carrier = String(ev.carrier).slice(0, 20); }
  if (ev.planUrl && okLabLink(ev.co, ev.planUrl) && c.planUrl !== ev.planUrl) set.planUrl = ev.planUrl;
  return { to, set };
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
  }, Object.assign({ a: 'email', co: ev.co, kind: ev.kind, from: c.stage, to: eff.to || null, fields: Object.keys(eff.set) }));
  return 'ok';
}

/* ---------- keeping up with the inbox ---------- */
const MAILS = { list: [], unread: [], pick: {}, sig: '', busy: false, again: false, state: null, stateAt: 0, gone: new Set(), goneFp: new Set() };
/* the same update in several emails is one update: both mailboxes can get the same email, Partners lists a patient
   day after day, and a shipment can be announced twice. A new setup from Oliv/Angel counts as new (its email date is part of it). */
function mailFp(ev) {
  return [ev.co, ev.kind, nameTokens(ev.name).join(' '), normRef(ev.ref), String(ev.tracking || trackFromUrl(ev.trackUrl) || '').replace(/\s+/g, '').toUpperCase(),
    ev.kind === 'hold' ? (ev.holdDate || '') + '|' + String(ev.reason || '').toLowerCase() : '', ev.kind === 'plan' ? String(ev.at || '') : ''].join('|');
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
    const open = openCases(), closed = (S.hist || []).concat(S.closed || [], (S.mailClosed && S.mailClosed.list) || []), groups = new Map(), unread = [], mem = mailMemLoad(), labDocs = [];
    // updates waiting for someone, one row per update however many emails carry it
    const wait = (d, i, ev, cands) => {
      const fp = mailFp(ev); let g = groups.get(fp);
      if (!g) { g = { id: d.id + ':' + i, fp, ev, items: [], cands: cands || [] }; groups.set(fp, g); }
      g.items.push({ d, i, key: d.id + ':' + i }); if ((ev.at || 0) > (g.ev.at || 0)) g.ev = ev;
      if (!g.cands.length && cands && cands.length) g.cands = cands;
    };
    for (const d of docs) {
      const old = Date.now() - (d.at || Date.now()) > 30 * 864e5;
      // can't be opened (another key, or damaged): kept a month like a format the app doesn't read, then cleared
      if (!d.mail) { if (old) await B.inboxDelete(d.id).catch(() => { }); else unread.push({ d, bad: true }); continue; }
      if (d.mail.lab) { labDocs.push(d); continue; } // the lab PC's progress on the in-house sets (lab.js)
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
          if (m.c || m.done) todo.push({ i, ev, m }); else wait(d, i, ev, m.many);
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
    let labSig = ''; try { labSig = await labSync(labDocs, open, closed, mem); } catch (e) { if (window.console) console.warn('lab progress:', e && e.message); }
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

/* ---------- Today: updates waiting for a case ---------- */
function mailCardHTML() {
  const L = MAILS.list; if (!L.length) return '';
  const open = openCases().filter(c => !c.locked).sort((a, b) => String(a.patient || '').localeCompare(String(b.patient || '')));
  return '<div class="card mailCard" id="mailCard"><div class="cardHd"><h3>Email updates</h3><span class="sub">' + L.length + ' from lab emails didn’t match an open case — pick the case, or dismiss</span><span style="flex:1"></span>' +
    (L.length > 1 ? '<button class="btn btn-ghost btn-sm" data-act="mailSkipAll" title="Nothing to do for any of these">Dismiss all</button>' : '') + '</div><div class="cardBd">' +
    L.map(x => {
      const ev = x.ev, co = MAIL_CO[ev.co], pick = MAILS.pick[x.id] || (x.cands.length === 1 ? x.cands[0].id : ''), gid = esc(x.id);
      const opt = c => '<option value="' + esc(c.id) + '"' + (pick === c.id ? ' selected' : '') + '>' + esc((ptNameText(c.patient) || '(no name)') + ' · ' + typeOf(c).l + ' · ' + stageLabel(c)) + '</option>';
      const mine = open.filter(c => co.types.includes(c.type)), rest = open.filter(c => !co.types.includes(c.type));
      return '<div class="mlRow"><div class="mlWhat"><span class="badge ' + TYPE[co.types[0]].cls + '">' + esc(co.l) + '</span><b>' + esc(MAIL_KIND[ev.kind] || ev.kind) + '</b>' +
        '<span class="mlName">' + ptName(ev.name) + '</span>' + (ev.ref ? '<span class="small muted">#' + esc(ev.ref) + '</span>' : '') +
        (ev.tracking ? '<span class="small muted">' + esc((trackInfo(ev.tracking) || {}).carrier || 'tracking') + ' ' + esc(ev.tracking) + '</span>' : '') +
        (ev.reason ? '<span class="small" style="color:var(--coral-700)">' + esc(ev.reason) + '</span>' : '') +
        '<span class="small muted">' + esc(fmtWhen(ev.at)) + '</span>' + (x.items.length > 1 ? '<span class="small muted">in ' + x.items.length + ' emails</span>' : '') +
        (x.cands.length > 1 ? '<span class="small" style="color:var(--amber-700)">' + x.cands.length + ' possible cases</span>' : '') + '</div>' +
        '<div class="mlDo"><span class="mlPh" data-mlph="' + gid + '">' + ptAv(pick ? findCase(pick) : null, 32) + '</span><select class="inp mlSel" data-g="' + gid + '" aria-label="Case for this update"><option value="">Pick the case…</option>' +
        (x.cands.length > 1 ? '<optgroup label="Possible matches">' + x.cands.map(opt).join('') + '</optgroup>' : '') +
        (mine.length ? '<optgroup label="' + esc(co.l) + ' cases">' + mine.map(opt).join('') + '</optgroup>' : '') +
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
  const how = '<p class="small" style="margin-bottom:10px">A small script in each Gmail account that gets lab emails (yours and the records inbox) sends them — uLab, Partners Dental Solutions, Specialty Appliances, Oliv, Angel and anything labeled “Lab Update” — to this app, locked so only the app can read them. When anyone has NLO Cases open, cases move on by themselves: plan ready → Dr. A action, received by the lab → Manufacturing, shipped → Shipped with the tracking #, delivered → Arrived, on hold → a Lab hold flag. Anything it can’t place shows on Today.</p>';
  if (!st.on) return head + how + '<button class="btn btn-act btn-sm" data-act="mailSetup">' + ic('plus', 15) + 'Set up email updates</button></div></div>';
  const beats = (st.beats || []).filter(b => !labBeat(b)).sort((a, b) => (b.at || 0) - (a.at || 0)); // (the lab PC's are under Lab PC)
  const box = b => { const late = !b.at || Date.now() - b.at > 40 * 60000;
    return '<div class="mlBeat"><span class="dot ' + (b.err ? 'bad' : late ? 'busy' : 'ok') + '"></span><b>' + esc(b.box) + '</b><span class="small muted">checked ' + esc(b.at ? fmtWhen(b.at) : '—') + (b.sent ? ' · ' + b.sent + ' sent' : '') + (b.ver ? ' · script v' + esc(b.ver) : '') + '</span>' +
      (b.err ? '<div class="small" style="color:var(--coral-700);flex-basis:100%">Last problem: ' + esc(b.err) + '</div>' : late ? '<div class="small" style="color:var(--amber-700);flex-basis:100%">No check in the last 40 minutes. Is the script still on?</div>' : '') + '</div>'; };
  const unread = MAILS.unread.filter(x => !x.bad).length;
  return head + how +
    (beats.length ? beats.map(box).join('') : '<div class="notice">No mailbox has checked in yet. Get the script and run <b>setup</b> in each Gmail account.</div>') +
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
