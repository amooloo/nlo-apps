/* =====================================================================
   NLO Bank Deposit — email (Google Apps Script web app)

   Emails Dr. A each deposit made in the Bank Deposit app (bank-deposit.html): when someone taps
   Email, or prints the slip. The email is the record of the deposit; search the inbox for
   "Bank deposit". This script keeps nothing else: no sheet, no copy, no log of the numbers.
   Emails come from this Gmail account, to this account.

   Turn on (once, on a computer, about 2 minutes):
     1. Go to script.google.com and press New project. Click "Untitled project" and name it
        NLO Bank Deposit Email.
     2. In Code.gs select everything, delete it, paste this whole file, and press Save.
     3. Deploy → New deployment → the gear next to "Select type" → Web app.
          Execute as:      Me
          Who has access:  Anyone
        → Deploy.
     4. Authorize access → your Google account → "Google hasn't verified this app" → Advanced →
        Go to NLO Bank Deposit Email (unsafe) → Allow. (Your own script; that warning is normal.)
     5. Copy the Web app URL (it ends in /exec) and send it to Claude, who puts it in the app.
   Try it: pick sendTestEmail next to Run (top bar) and press Run. A sample deposit email arrives
   within a minute, marked TEST.

   Who gets the emails: this Google account. To send them elsewhere, or to more people:
     Project Settings (gear, left) → Script Properties → Add script property →
     DEPOSIT_EMAIL = the address, or several with commas between (up to 5).
   Changing this file later: paste the new version, Save, then Deploy → Manage deployments →
     pencil → Version: New version → Deploy. (A brand-new deployment would get a new address.)
   Turn off: Deploy → Manage deployments → Archive. The app then opens the Mail app instead.

   What it accepts: the deposit's numbers (bills by count, coin, each check's amount and who it is
   from, the day sheet). Every number and name is checked and anything else is ignored; the totals
   are worked out here, not taken from the page. It only ever emails the address(es) above, at most
   40 deposit emails a day, and a deposit the app sends twice (a retry) only once.

   v1 (30 Oct 2026): first version.
   ===================================================================== */
var VERSION = '1';
var TZ = 'America/New_York';
var DENOMS = [100, 50, 20, 10, 5, 1];
var DAILY_MAX = 40;      // deposit emails a day, whoever sends them
var MAX_CHECKS = 300;
var SEEN_SECONDS = 21600; // a retry of the same deposit within 6 hours isn't emailed again

/* The Bank Deposit app posts here (text/plain JSON, so the browser sends it without a preflight). */
function doPost(e) {
  var out;
  try {
    var raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 100000) throw userError_('bad');
    var p;
    try { p = JSON.parse(raw); } catch (x) { throw userError_('bad'); }
    out = send_(clean_(p), false);
  } catch (err) {
    if (!(err && err.user)) console.error(err && err.stack ? err.stack : err);
    out = { ok: false, error: err && err.user ? err.message : 'failed' };
  }
  return json_(out);
}

/* Opening the web app address in a browser shows that it's on. */
function doGet() {
  return json_({ ok: true, app: 'NLO Bank Deposit email', version: VERSION });
}

/* Run by hand: sends a sample deposit (marked TEST) to whoever gets the emails. */
function sendTestEmail() {
  var d = clean_({
    v: 1, id: 'test-' + Date.now(),
    bills: { 100: 2, 20: 5, 1: 7 }, coin: 1.35,
    checks: [{ amt: 412.5, from: 'Delta Dental' }, { amt: 88, from: 'MetLife' }, { amt: 150, from: '' }],
    daySheet: 958.85
  });
  var r = send_(d, true);
  Logger.log(r.ok ? 'Sent a sample deposit email to ' + recipients_().join(', ') : 'Not sent: ' + r.error);
  return r;
}

/* ------------------------------------------------------------ checking what came in */

function clean_(p) {
  if (!p || typeof p !== 'object' || p.v !== 1) throw userError_('bad');
  var bills = {}, cash = 0;
  DENOMS.forEach(function (dn) {
    var n = p.bills && typeof p.bills === 'object' ? p.bills[dn] : 0;
    if (n === undefined || n === null || n === '') n = 0;
    n = Number(n);
    if (!isFinite(n) || n < 0 || n > 100000 || Math.floor(n) !== n) throw userError_('bad');
    bills[dn] = n;
    cash += n * dn * 100;
  });
  var coin = cents_(p.coin, 1000000);              // up to $10,000 in coin
  cash += coin;
  var list = p.checks === undefined || p.checks === null ? [] : p.checks;
  if (!Array.isArray(list) || list.length > MAX_CHECKS) throw userError_('bad');
  var checks = list.map(function (c) {
    if (!c || typeof c !== 'object') throw userError_('bad');
    var amt = cents_(c.amt, 100000000);            // up to $1,000,000 a check
    if (amt <= 0) throw userError_('bad');
    return { amt: amt, from: name_(c.from) };
  });
  var checksTotal = checks.reduce(function (s, c) { return s + c.amt; }, 0);
  var total = cash + checksTotal;
  if (total <= 0) throw userError_('bad');
  var daySheet = p.daySheet === undefined || p.daySheet === null || p.daySheet === '' ? null : cents_(p.daySheet, 1000000000);
  return {
    id: String(p.id === undefined || p.id === null ? '' : p.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64),
    update: p.update === true,
    bills: bills, coin: coin, cash: cash,
    checks: checks, checksTotal: checksTotal, total: total,
    daySheet: daySheet, variance: daySheet === null ? null : total - daySheet
  };
}

/* dollars → whole cents, 0 when left blank */
function cents_(v, max) {
  if (v === undefined || v === null || v === '') return 0;
  var n = Number(v);
  if (typeof v === 'boolean' || !isFinite(n) || n < 0) throw userError_('bad');
  var c = Math.round(n * 100);
  if (c > max) throw userError_('bad');
  return c;
}

/* who a check is from: letters, digits and ordinary punctuation, at most 60 characters,
   and nothing a mail app would turn into a link (web addresses are broken up) */
function name_(v) {
  if (v === undefined || v === null || typeof v === 'object') return '';
  return String(v)
    .replace(/[^A-Za-z0-9À-ɏ &.,'()\/#-]/g, ' ')
    .replace(/\/{2,}/g, ' ')
    .replace(/([A-Za-z0-9])\.(?=[A-Za-z]{2})/g, '$1 . ')
    .replace(/\s+/g, ' ').trim().slice(0, 60);
}

/* ------------------------------------------------------------ sending */

function send_(d, isTest) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw userError_('busy');
  try {
    var cache = CacheService.getScriptCache();
    if (d.id) {
      var seen = cache.get('dep_' + d.id);
      if (seen) return { ok: true, again: true, at: seen };
    }
    var props = PropertiesService.getScriptProperties();
    var now = new Date();
    var day = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
    var kept = props.getProperty('NLO_DEP_COUNT') || '';
    var used = kept.indexOf(day + ':') === 0 ? Number(kept.slice(day.length + 1)) || 0 : 0;
    if (used >= DAILY_MAX) throw userError_('limit');
    if (MailApp.getRemainingDailyQuota() < 1) throw userError_('quota');
    var mail = compose_(d, now, isTest);
    MailApp.sendEmail({
      to: recipients_().join(','),
      subject: mail.subject,
      body: mail.text,
      htmlBody: mail.html,
      name: 'NLO Bank Deposit'
    });
    props.setProperty('NLO_DEP_COUNT', day + ':' + (used + 1));
    var at = Utilities.formatDate(now, TZ, 'h:mm a');
    if (d.id) cache.put('dep_' + d.id, at, SEEN_SECONDS);
    return { ok: true, at: at };
  } finally {
    lock.releaseLock();
  }
}

function recipients_() {
  var set = String(PropertiesService.getScriptProperties().getProperty('DEPOSIT_EMAIL') || '')
    .split(/[\s,;]+/)
    .filter(function (a) { return /^[^@\s<>"]+@[^@\s<>"]+\.[A-Za-z]{2,}$/.test(a); })
    .slice(0, 5);
  if (!set.length) set = [Session.getEffectiveUser().getEmail()];
  return set;
}

/* ------------------------------------------------------------ the email */

function compose_(d, now, isTest) {
  var dayLong = Utilities.formatDate(now, TZ, 'EEE, MMM d, yyyy');
  var dayShort = Utilities.formatDate(now, TZ, 'EEE, MMM d');
  var time = Utilities.formatDate(now, TZ, 'h:mm a');
  var subject = (isTest ? 'TEST · ' : '') + 'Bank deposit' + (d.update ? ' (updated)' : '') +
    ' · ' + money_(d.total) + ' · ' + dayShort;

  var bills = DENOMS.filter(function (dn) { return d.bills[dn] > 0; });
  var payers = byPayer_(d.checks);

  /* plain text */
  var t = [];
  t.push('Bank deposit · Bank of America');
  t.push(dayLong + ' at ' + time);
  if (d.update) t.push('Updated: this replaces the earlier email for this deposit.');
  if (isTest) t.push('TEST: a sample deposit, not a real one.');
  t.push('');
  t.push('CASH  ' + money_(d.cash));
  bills.forEach(function (dn) { t.push('  $' + dn + ' bills x ' + d.bills[dn] + '  ' + money_(d.bills[dn] * dn * 100)); });
  if (d.coin) t.push('  Coin  ' + money_(d.coin));
  if (!d.cash) t.push('  No cash');
  t.push('');
  t.push('CHECKS (' + d.checks.length + ')  ' + money_(d.checksTotal));
  d.checks.forEach(function (c, i) { t.push('  ' + (i + 1) + '. ' + (c.from || 'Not specified') + '  ' + money_(c.amt)); });
  if (!d.checks.length) t.push('  No checks');
  if (payers.length) {
    t.push('');
    t.push('CHECKS BY PAYER');
    payers.forEach(function (g) { t.push('  ' + g.name + ' (' + g.n + ')  ' + money_(g.t)); });
  }
  t.push('');
  t.push('TOTAL DEPOSIT  ' + money_(d.total));
  if (d.daySheet !== null) t.push('Day sheet collected  ' + money_(d.daySheet) + '  ·  ' + verdict_(d.variance));
  t.push('');
  t.push('Sent by the Bank Deposit app (NLO Apps).');

  /* HTML, styled inline so every mail app shows it the same */
  var C = { ink: '#111722', mute: '#6b7280', line: '#e5e7eb', ok: '#15803d', warn: '#a34a05' };
  var cell = 'padding:7px 8px;border-bottom:1px solid ' + C.line + ';font-size:14px;';
  var num = 'text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;';
  var head = 'padding:6px 8px;border-bottom:1px solid ' + C.ink + ';font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:' + C.mute + ';font-weight:700;';
  var subRow = 'padding:7px 8px;border-top:1px solid ' + C.ink + ';font-size:14px;font-weight:700;';
  function th(label, right) { return '<th style="' + head + (right ? 'text-align:right;' : 'text-align:left;') + '">' + label + '</th>'; }
  function td(v, right, extra) { return '<td style="' + cell + (right ? num : '') + (extra || '') + '">' + v + '</td>'; }
  function table(heads, rows, subLabel, subValue) {
    return '<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:0 0 4px">' +
      '<tr>' + heads + '</tr>' + rows +
      '<tr><td colspan="2" style="' + subRow + '">' + subLabel + '</td><td style="' + subRow + num + '">' + subValue + '</td></tr>' +
      '</table>';
  }
  function section(title) {
    return '<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:' + C.mute + ';margin:22px 0 6px">' + title + '</div>';
  }
  var empty = function (txt) { return '<tr><td colspan="3" style="' + cell + 'color:' + C.mute + '">' + txt + '</td></tr>'; };

  var cashRows = bills.map(function (dn) {
    return '<tr>' + td('$' + dn + ' bills') + td(String(d.bills[dn]), true) + td(money_(d.bills[dn] * dn * 100), true) + '</tr>';
  }).join('') + (d.coin ? '<tr>' + td('Coin') + td('&mdash;', true) + td(money_(d.coin), true) + '</tr>' : '');
  var checkRows = d.checks.map(function (c, i) {
    return '<tr>' + td(String(i + 1), false, 'color:' + C.mute + ';width:28px;') +
      td(c.from ? esc_(c.from) : '<span style="color:' + C.mute + '">not specified</span>') + td(money_(c.amt), true) + '</tr>';
  }).join('');
  var payerRows = payers.map(function (g) {
    return '<tr>' + td(esc_(g.name)) + td(String(g.n), true) + td(money_(g.t), true) + '</tr>';
  }).join('');

  var html =
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;color:' + C.ink + ';max-width:560px;margin:0 auto;padding:4px 2px 12px">' +
    (isTest ? '<div style="background:#fdf1e3;color:' + C.warn + ';border-radius:8px;padding:8px 12px;font-size:13px;font-weight:600;margin-bottom:12px">TEST: a sample deposit, not a real one.</div>' : '') +
    '<div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:' + C.mute + '">Bank deposit · Bank of America</div>' +
    '<div style="font-size:30px;font-weight:700;letter-spacing:-.02em;margin:4px 0 2px;font-variant-numeric:tabular-nums">' + money_(d.total) + '</div>' +
    '<div style="font-size:14px;color:' + C.mute + '">' + esc_(dayLong) + ' at ' + esc_(time) + '</div>' +
    (d.update ? '<div style="background:#e9eff9;color:#14396f;border-radius:8px;padding:8px 12px;font-size:13px;margin-top:12px"><b>Updated</b> — this replaces the earlier email for this deposit.</div>' : '') +
    section('Cash · ' + money_(d.cash)) +
    table(th('Denomination') + th('Count', true) + th('Amount', true), cashRows || empty('No cash'), 'Cash subtotal', money_(d.cash)) +
    section('Checks (' + d.checks.length + ') · ' + money_(d.checksTotal)) +
    table(th('#') + th('From') + th('Amount', true), checkRows || empty('No checks'), 'Checks subtotal', money_(d.checksTotal)) +
    (payers.length ? section('Checks by payer') + table(th('From') + th('Checks', true) + th('Amount', true), payerRows, 'All checks', money_(d.checksTotal)) : '') +
    '<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-top:20px;border:2px solid ' + C.ink + '">' +
    '<tr><td style="padding:12px 14px;font-size:15px;font-weight:700;letter-spacing:.04em">TOTAL DEPOSIT</td>' +
    '<td style="padding:12px 14px;font-size:20px;font-weight:700;' + num + '">' + money_(d.total) + '</td></tr></table>' +
    (d.daySheet !== null
      ? '<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-top:10px">' +
        '<tr><td style="padding:4px 14px;font-size:14px">Day sheet collected</td><td style="padding:4px 14px;font-size:14px;' + num + '">' + money_(d.daySheet) + '</td></tr>' +
        '<tr><td style="padding:4px 14px;font-size:14px">Variance</td><td style="padding:4px 14px;font-size:14px;font-weight:700;' + num +
        'color:' + (d.variance === 0 ? C.ok : C.warn) + '">' + verdict_(d.variance) + '</td></tr></table>'
      : '') +
    '<div style="font-size:12px;color:' + C.mute + ';margin-top:22px">Sent by the Bank Deposit app (NLO Apps).</div>' +
    '</div>';

  return { subject: subject, text: t.join('\n'), html: html };
}

/* checks grouped by who they're from, biggest first (only when at least one says who) */
function byPayer_(checks) {
  if (!checks.some(function (c) { return c.from; })) return [];
  var groups = {}, order = [];
  checks.forEach(function (c) {
    var key = c.from || 'Not specified';
    if (!groups[key]) { groups[key] = { name: key, n: 0, t: 0 }; order.push(key); }
    groups[key].n++;
    groups[key].t += c.amt;
  });
  return order.map(function (k) { return groups[k]; }).sort(function (a, b) { return b.t - a.t; });
}

function verdict_(v) {
  return v === 0 ? 'Balanced' : (v > 0 ? 'Over ' : 'Short ') + money_(Math.abs(v));
}

/* whole cents → $1,234.56 */
function money_(c) {
  c = Math.round(c);
  var neg = c < 0;
  c = Math.abs(c);
  var dollars = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  var rest = c % 100;
  return (neg ? '-' : '') + '$' + dollars + '.' + (rest < 10 ? '0' : '') + rest;
}

function esc_(s) {
  return String(s).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function userError_(code) {
  var e = new Error(code);
  e.user = true;
  return e;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
