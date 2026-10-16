/**
 * NLO Inventory Alerts — version 2 (Google Apps Script)
 * ---------------------------------------------------------------------------
 * Emails Dr. Akhavan within about a minute whenever someone in NLO Inventory:
 *   - adds something to the cart (or more of something already in it)
 *   - places an order (from the cart, a new order, a backorder, a reopen)
 *   - receives an order
 * Everything from the same minute comes as one email, with who did it.
 *
 * Since October 2026 Inventory signs in with NLO Cases logins and keeps its
 * records in the NLO Cases database. This script also keeps a copy of the
 * supply numbers (supplies, orders, the activity log, the budget and its
 * expenses) and the AI keys in the old Inventory database, where Staff
 * Meeting's spending card, Month-End and AISA's stock answers read them. And
 * if an old Inventory page is still open on some computer and someone uses
 * it, it emails Dr. A to reload that computer.
 * The emails and the copy are separate steps: one failing never holds up the
 * other. Many alerts at once come as a few emails (at most 25 alerts each),
 * and if Gmail's daily limit is used up they wait for the next day.
 *
 *   setup()           one time: checks both databases, starts the
 *                     every-minute check, and copies everything once
 *   sendTestAlert()   sends a sample alert
 *   stopAlerts()      stops the every-minute check (Inventory → Settings →
 *                     Email alerts turns the emails themselves off and on)
 *   enablePhonePush() optional: also push to the free "ntfy" phone app
 *
 * It signs in to NLO Inventory with a login of its own (made by Dr. A in
 * Inventory → Settings → Email alerts → Get the alert script) that can read
 * Inventory and clear the alerts it sent, nothing else. The old database is
 * reached as this Google account, as before.
 * At night (9 PM to 5 AM) it checks every 10 minutes instead of every minute.
 *
 * Optional Script Properties (Project Settings > Script Properties):
 *   ALERT_EMAIL  who gets the email (default: this account; commas for more)
 *   NTFY_TOPIC   set by enablePhonePush()
 */
var VERSION = '2';
var CONFIG = /*INV_CONFIG*/null; // filled in by NLO Inventory when you copy the script

var DB_URL = 'https://nlo-inventory-default-rtdb.firebaseio.com';
var QUEUE_PATH = '/nlo/settings/alertQueue';   // where an OLD Inventory page still leaves its alerts
var APP_URL = 'https://amooloo.github.io/nlo-apps/nlo-inventory.html';
var TZ = 'America/New_York';
var HANDLER = 'checkInventoryAlerts';
var FAILS_BEFORE_NOTICE = 15;   // ~15 minutes of failed checks
var MAX_PER_RUN = 200;
var PER_EMAIL = 25;              // alerts in one email at most
var EMAIL_BYTES = 150000;        // and about this much of it (Gmail takes 200 KB)
var OVERLAP_MS = 5 * 60000;      // each copy looks this far back again (a save's time is when it was sent: one sent a moment
                                 // before another can land after it)
var BUDGET_KEYS = ['monthly', 'categories', 'history', 'changedBy', 'changedAt'];

var TYPE_INFO = {
  cart:     { label: 'Added to cart',       color: '#7c3aed', tag: 'shopping_cart' },
  ordered:  { label: 'Moved to Open Orders', color: '#2563eb', tag: 'package' },
  reopened: { label: 'Reopened',             color: '#d97706', tag: 'leftwards_arrow_with_hook' },
  received: { label: 'Received',             color: '#059669', tag: 'white_check_mark' }
};

// ─── One-time setup / test / off ────────────────────────────────────────────
function setup() {
  if (!CONFIG || !CONFIG.apiKey || !CONFIG.projectId || !CONFIG.botEmail || !CONFIG.botPassword) {
    throw new Error('This copy has no NLO Inventory login in it. Copy it again: NLO Inventory → Settings → Email alerts → Get the alert script.');
  }
  var props = PropertiesService.getScriptProperties();
  props.setProperty('INV_CFG', JSON.stringify(CONFIG));
  ['FAILS', 'FAIL_NOTICE_DAY', 'INV_REV', 'INV_UP', 'INV_FULL_DAY', 'INV_BEAT', 'INV_LAST', 'INV_BUD', 'INV_AI'].forEach(function (k) { props.deleteProperty(k); });
  try { CacheService.getScriptCache().remove('inv_login'); } catch (e) { }
  var cfg = cfg_(props), s = session_(cfg, true);
  getDoc_(cfg, s, 'meta/rules_inv_1', 'the rules');      // proves the login works (and the rules know Inventory)
  db_(cfg, 'get', '/nlo/items', 'shallow=true');         // proves the old database is reachable as this Google account
  removeTriggers_();
  ScriptApp.newTrigger(HANDLER).timeBased().everyMinutes(1).create();
  var r = run_(true);
  Logger.log('NLO Inventory alerts (version ' + VERSION + ') are running for ' + mailbox_() + '. ' + summary_(r) +
    ' It checks every minute (every 10 minutes at night); emails go to ' + alertEmail_() + '.');
  return r;
}

function sendTestAlert() {
  deliver_([{ t: 'cart', at: Date.now(), by: 'Test', test: true, inCart: 1,
    lines: [{ n: 'Sample item (test only)', q: 1, u: 'box', p: 12.34, v: 'Sample Vendor' }] }]);
  Logger.log('Test alert sent to ' + alertEmail_() + '.');
}

function stopAlerts() {
  removeTriggers_();
  Logger.log('The every-minute check is off: no emails, and Staff Meeting and AISA stop getting new supply numbers. Run setup() to turn it back on.');
}

// Optional phone push through ntfy (free app for iPhone and Android).
function enablePhonePush() {
  var props = PropertiesService.getScriptProperties();
  var topic = props.getProperty('NTFY_TOPIC');
  if (!topic) {
    topic = 'nlo-inv-' + Utilities.getUuid().replace(/-/g, '').slice(0, 24);
    props.setProperty('NTFY_TOPIC', topic);
  }
  push_(topic, { title: 'NLO inventory push alerts are on', text: 'You’ll get a push here for cart adds, open orders and received orders.', tag: 'bell' });
  var steps = 'On your phone: install the free "ntfy" app, tap +, and subscribe to this topic:\n\n' + topic +
    '\n\nKeep the topic private; anyone who has it can read these alerts. Run disablePhonePush() to stop.';
  MailApp.sendEmail({ to: alertEmail_(), name: 'NLO Inventory', subject: 'Phone push for NLO inventory alerts', body: steps });
  Logger.log(steps);
}

function disablePhonePush() {
  PropertiesService.getScriptProperties().deleteProperty('NTFY_TOPIC');
  Logger.log('Phone push is off. Email alerts continue.');
}

// ─── Every minute (the trigger runs this) ──────────────────────────────────
function checkInventoryAlerts() { return run_(false); }

/* one check. force: everything now, whatever the hour (setup) */
function run_(force) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return { busy: true };          // a previous run is still going
  var props = PropertiesService.getScriptProperties(), now = Date.now(), out = { sent: 0, waiting: 0, copied: 0, old: 0, moved: false };
  var cfg = null, s = null, errs = [], notes = [];
  try {
    cfg = cfg_(props);
    var hr = Number(Utilities.formatDate(new Date(now), TZ, 'H')), last = Number(props.getProperty('INV_LAST') || 0);
    if (!force && (hr >= 21 || hr < 5) && now - last < 10 * 60000) return { quiet: true };
    props.setProperty('INV_LAST', String(now));
    s = session_(cfg, false);
    var revDoc = getDoc_(cfg, s, 'invState/rev', 'the change counter');
    var rev = revDoc && revDoc.fields && revDoc.fields.n ? String(val_(revDoc.fields.n)) : '0';
    var full = force || fullDue_(props, now);
    if (rev !== props.getProperty('INV_REV') || full) {
      var done = true;
      // the emails and the copy each on their own: one failing never holds up the other (both are tried again next minute)
      try { var a = alerts_(cfg, s, props); out.sent = a.sent; out.waiting = a.waiting; if (a.note) notes.push(a.note); if (a.waiting) done = false; }
      catch (e) { done = false; errs.push(msg_(e)); }
      try {
        var c = copy_(cfg, s, props, full);
        out.copied = c.n; out.moved = c.moved; if (c.note) notes.push(c.note);
        if (full && c.moved) props.setProperty('INV_FULL_DAY', day_(now));
      } catch (e) { done = false; errs.push(msg_(e)); }
      if (done) props.setProperty('INV_REV', rev);    // (read before the work: a change made meanwhile is seen next minute)
    }
    try { out.old = oldPage_(cfg, props, now); } catch (e) { errs.push(msg_(e)); }
    if (errs.length) throw new Error(errs.join(' · '));
    beat_(cfg, s, props, out, notes.join(' · '), now);
    if (props.getProperty('FAILS')) props.deleteProperty('FAILS');
  } catch (err) {
    noteFailure_(props, err);
    try { if (cfg && s) beat_(cfg, s, props, out, msg_(err), now, true); } catch (e) { }
    if (force) throw err;
  } finally {
    lock.releaseLock();
  }
  return out;
}
function summary_(r) {
  if (!r || r.busy) return '';
  return (r.moved ? 'Copied ' + r.copied + ' supply records to the old database for Staff Meeting and AISA.' : 'Inventory hasn’t been moved over yet, so nothing was copied (the old database is left as it is).') +
    (r.sent ? ' Sent ' + r.sent + ' alert(s).' : '') + (r.waiting ? ' ' + r.waiting + ' alert(s) wait for the next check.' : '');
}

// ─── Alerts: the ones Inventory left, emailed once, then cleared ───────────
/* → { sent, waiting, note }: emails of at most PER_EMAIL alerts and about EMAIL_BYTES each; what was sent is remembered one
   email at a time (so a failure part way never sends anything twice) and cleared; the rest waits for the next check */
function alerts_(cfg, s, props) {
  var docs = query_(cfg, s, 'invAlerts', [], 'at', MAX_PER_RUN).docs;
  if (!docs.length) return { sent: 0, waiting: 0 };
  var sent = readJson_(props, 'SENT_KEYS', []), already = {};
  sent.forEach(function (k) { already[k] = true; });
  var fresh = docs.filter(function (d) { return !already[idOf_(d)]; }).map(function (d) { return { id: idOf_(d), e: plain_(d.fields) }; });
  var groups = emailGroups_(fresh), n = 0, note = '', each = recipients_();
  for (var i = 0; i < groups.length; i++) {
    // (each email counts once per address it goes to)
    if (quota_() < each) { note = 'Gmail’s daily email limit is used up: ' + (fresh.length - n) + ' alert(s) wait until tomorrow.'; break; }
    deliver_(groups[i].map(function (g) { return g.e; }));
    sent = sent.concat(groups[i].map(function (g) { return g.id; })).slice(-400);
    props.setProperty('SENT_KEYS', JSON.stringify(sent));
    n += groups[i].length;
  }
  var gone = {}; sent.forEach(function (k) { gone[k] = true; });
  var clear = docs.filter(function (d) { return gone[idOf_(d)]; });
  if (clear.length) {
    var r = commit_(cfg, s, clear.map(function (d) { return { delete: d.name }; }));
    if (r.code !== 200) throw new Error('Couldn’t clear the alerts it sent (' + why_(r) + ').');
  }
  // a full page of alerts: there may be more behind it — the next check goes on with them (the change counter isn't moved on)
  return { sent: n, waiting: fresh.length - n + (docs.length >= MAX_PER_RUN ? 1 : 0), note: note };
}
/* alerts → emails: in order, a new email at PER_EMAIL alerts or about EMAIL_BYTES */
function emailGroups_(list) {
  var out = [], cur = [], size = 0;
  list.forEach(function (x) {
    var p = describe_(x.e), n = p.html.length + p.text.length + 200;
    if (cur.length && (cur.length >= PER_EMAIL || size + n > EMAIL_BYTES)) { out.push(cur); cur = []; size = 0; }
    cur.push(x); size += n;
  });
  if (cur.length) out.push(cur);
  return out;
}
function quota_() { try { return MailApp.getRemainingDailyQuota(); } catch (e) { return 100; } }
function recipients_() { return Math.max(1, alertEmail_().split(',').filter(function (x) { return x.trim(); }).length); }

// ─── The copy in the old database (Staff Meeting's spending card, AISA's stock answers) ───
/* changed records only, each minute something changed; everything once a night. Records are only ever added or changed in
   the old database here (never removed), and nothing is copied before Inventory has moved over. → { n (new changes
   copied), moved, note } */
function copy_(cfg, s, props, full) {
  var moved = getDoc_(cfg, s, 'invMeta/moved', 'whether Inventory moved');
  if (!moved) return { n: 0, moved: false };
  var up = readJson_(props, 'INV_UP', {}), n = 0, note = '';
  [['invItems', '/nlo/items'], ['invOrders', '/nlo/orders'], ['invLog', '/nlo/log']].forEach(function (x) {
    var coll = x[0], path = x[1], since = full ? 0 : Number(up[coll] || 0);
    var docs = (since ? query_(cfg, s, coll, [ff_('up', 'GREATER_THAN', tsv_(since - OVERLAP_MS))], 'up') : query_(cfg, s, coll, [], null)).docs;
    if (!docs.length) return;
    var patch = {}, newest = since;
    docs.forEach(function (d) {
      var o = plain_(d.fields), t = d.fields.up ? tsMs_(d.fields.up.timestampValue) : 0, isNew = !since || t > since;
      if (t > newest) newest = t;
      delete o.up; delete o.upBy;
      if (coll === 'invLog') {
        // whose record an entry is in says who made it (the moved entries, in old…, keep the old app's stamps)
        var who = String(o.who || ''), e = o.e || {};
        Object.keys(e).forEach(function (k) { var x = e[k]; if (!x || typeof x !== 'object') return; if (who && !/^old\d*$/.test(who)) x.byId = who; patch[rtKey_(k)] = rtdb_(x); if (isNew) n++; });
      } else { patch[rtKey_(String(o.id != null ? o.id : idOf_(d)))] = rtdb_(o); if (isNew) n++; }
    });
    patchInParts_(cfg, path, patch);
    up[coll] = newest;
  });
  // the budget: its amounts and the expenses (records of their own here, one list there); only the keys the app keeps, so
  // anything else in the old budget stays
  var bud = getDoc_(cfg, s, 'invState/budget', 'the budget');
  if (bud) {
    var b = plain_(bud.fields), out = {};
    BUDGET_KEYS.forEach(function (k) { out[k] = b[k] == null ? null : rtdb_(b[k]); });
    var ex = query_(cfg, s, 'invExpenses', [], null).docs.map(function (d) { var o = plain_(d.fields); delete o.up; delete o.upBy; return o; });
    ex.sort(function (a, z) { return String(z.addedAt || z.date || '').localeCompare(String(a.addedAt || a.date || '')); });
    out.expenses = ex.length ? rtdb_(ex) : null;
    var sig = hash_(JSON.stringify(out));
    if (full || sig !== props.getProperty('INV_BUD')) { db_(cfg, 'patch', '/nlo/budget', '', out); props.setProperty('INV_BUD', sig); n++; }
  }
  // the AI keys: Staff Meeting and Month-End read them there
  try {
    var ai = getDoc_(cfg, s, 'invState/ai', 'the AI keys');
    if (ai) {
      var k = plain_(ai.fields), keys = { geminiKey: k.gemini || null, openaiKey: k.openai || null }, sigAi = hash_(JSON.stringify(keys));
      if (full || sigAi !== props.getProperty('INV_AI')) { db_(cfg, 'patch', '/nlo/settings', '', keys); props.setProperty('INV_AI', sigAi); }
    }
  } catch (e) { note = 'The AI keys weren’t copied for Staff Meeting (' + msg_(e) + ').'; }
  props.setProperty('INV_UP', JSON.stringify(up));
  return { n: n, moved: true, note: note };
}
/* a short fingerprint of a text (whether something changed since the last copy) */
function hash_(t) { var h = 0x811c9dc5; for (var i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = (h * 16777619) >>> 0; } return h.toString(36) + ':' + t.length; }
/* a big copy in pieces (one request each, well under the size a request may have) */
function patchInParts_(cfg, path, patch) {
  var keys = Object.keys(patch), part = {}, size = 0;
  for (var i = 0; i < keys.length; i++) {
    var text = JSON.stringify(patch[keys[i]]);
    if (size + text.length > 4000000 && Object.keys(part).length) { db_(cfg, 'patch', path, '', part); part = {}; size = 0; }
    part[keys[i]] = patch[keys[i]]; size += text.length;
  }
  if (Object.keys(part).length) db_(cfg, 'patch', path, '', part);
}
/* the old database's way: no nulls, keys without . $ # [ ] / */
function rtKey_(k) { k = String(k).replace(/[.#$\/\[\]]/g, '_'); return k || '_'; }
function rtdb_(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(rtdb_);
  if (typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { var c = rtdb_(v[k]); if (c != null) o[rtKey_(k)] = c; }); return o; }
  return v;
}
/* the whole copy once a day, after 3 AM */
function fullDue_(props, now) {
  var hr = Number(Utilities.formatDate(new Date(now), TZ, 'H'));
  return hr >= 3 && props.getProperty('INV_FULL_DAY') !== day_(now);
}
function day_(ms) { return Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM-dd'); }

// ─── An old Inventory page still open somewhere ────────────────────────────
/* The old page leaves its alerts in the old database. After the move, anything there means a computer is still showing the
   old page: what was done there went into the old database only. Dr. A gets one email an hour about it. */
function oldPage_(cfg, props, now) {
  var data = db_(cfg, 'get', QUEUE_PATH, 'orderBy=' + encodeURIComponent('"$key"') + '&limitToFirst=' + MAX_PER_RUN);
  if (!data || typeof data !== 'object') return 0;
  var keys = Object.keys(data).sort(), events = keys.map(function (k) { return data[k]; }).filter(function (e) { return e && typeof e === 'object'; });
  if (events.length && now - Number(props.getProperty('OLD_PAGE_AT') || 0) > 3600000) {
    props.setProperty('OLD_PAGE_AT', String(now));
    var lines = events.slice(0, 20).map(function (e) { return '  • ' + when_(e.at) + ' — ' + describe_(e).headline; });
    MailApp.sendEmail({ to: alertEmail_(), name: 'NLO Inventory', subject: 'An old Inventory page is still open on a computer',
      body: 'Someone used an old Inventory page (one opened before the move), so these went into the old database only — not into NLO Inventory:\n\n' +
        lines.join('\n') + (events.length > 20 ? '\n  … and ' + (events.length - 20) + ' more' : '') +
        '\n\nPlease reload that computer (it opens the new Inventory, which signs in with NLO Cases logins) and do these again there.\n\nOpen NLO Inventory: ' + APP_URL });
  }
  var clear = {}; keys.forEach(function (k) { clear[k] = null; });
  if (keys.length) db_(cfg, 'patch', QUEUE_PATH, '', clear);
  return events.length;
}

// ─── Delivery ──────────────────────────────────────────────────────────────
function deliver_(events) {
  var msg = buildMessage_(events);
  MailApp.sendEmail({ to: alertEmail_(), name: 'NLO Inventory', subject: msg.subject, body: msg.text, htmlBody: msg.html });
  var topic = PropertiesService.getScriptProperties().getProperty('NTFY_TOPIC');
  if (topic) {
    try { push_(topic, { title: msg.subject, text: msg.pushText, tag: msg.tag }); }
    catch (e) { console.warn('Phone push failed: ' + e); }
  }
}

function push_(topic, m) {
  var res = UrlFetchApp.fetch('https://ntfy.sh/', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({ topic: topic, title: m.title, message: m.text, click: APP_URL, tags: m.tag ? [m.tag] : [] })
  });
  if (res.getResponseCode() >= 300) throw new Error('ntfy HTTP ' + res.getResponseCode());
}

function buildMessage_(events) {
  events = events.slice().sort(function (a, b) { return (Number(a.at) || 0) - (Number(b.at) || 0); });
  var parts = events.map(describe_);
  var subject, tag;
  if (parts.length === 1) {
    subject = parts[0].subject;
    tag = parts[0].tag;
  } else {
    var counts = {}, order = [];
    events.forEach(function (e) { var t = TYPE_INFO[e.t] ? e.t : 'other'; if (!counts[t]) { counts[t] = 0; order.push(t); } counts[t]++; });
    var words = { cart: ['added to cart', 'added to cart'], ordered: ['open order', 'open orders'],
      reopened: ['reopened', 'reopened'], received: ['received', 'received'], other: ['update', 'updates'] };
    subject = 'Inventory: ' + order.map(function (t) { return counts[t] + ' ' + words[t][counts[t] === 1 ? 0 : 1]; }).join(', ');
    tag = 'bell';
  }
  if (events.some(function (e) { return e.test; })) subject = 'TEST — ' + subject;
  var html = wrapHtml_(parts.map(function (p) { return p.html; }).join(''));
  var text = parts.map(function (p) { return p.text; }).join('\n\n') + '\n\nOpen NLO Inventory: ' + APP_URL;
  var pushText = parts.map(function (p) { return p.headline; }).join('\n');
  if (pushText.length > 900) pushText = pushText.slice(0, 897) + '...';
  return { subject: subject, html: html, text: text, pushText: pushText, tag: tag };
}

function describe_(e) {
  var info = TYPE_INFO[e.t] || { label: 'Inventory update', color: '#6b7280', tag: 'bell' };
  var all = Array.isArray(e.lines) ? e.lines.filter(function (l) { return l && typeof l === 'object'; }) : [];
  var lines = all.slice(0, 60).map(function (l) { return { n: cut_(l.n, 120), q: l.q, u: cut_(l.u, 20), p: l.p, v: cut_(l.v, 80) }; });
  var by = cut_(e.by, 60);
  var vendor = cut_(e.vendor, 100);
  e = { t: e.t, at: e.at, test: e.test, inCart: Number(e.inCart) || 0, total: e.total, note: cut_(e.note, 300), ordered: cut_(e.ordered, 24), noCount: e.noCount };
  var nItems = all.length + ' item' + (all.length === 1 ? '' : 's');
  var total = Number(e.total) || 0;
  var headline, subject, extra = [];

  if (e.t === 'cart') {
    var what = lines.length === 1 ? clean_(lines[0].n) + ' ×' + num_(lines[0].q) : nItems;
    headline = (by || 'Someone') + ' added ' + what + ' to the cart';
    subject = 'Added to cart: ' + what;
    var vendors = uniq_(lines.map(function (l) { return clean_(l.v); }).filter(Boolean));
    if (vendors.length) extra.push('From ' + vendors.join(', '));
    if (e.inCart) extra.push(e.inCart + ' item' + (e.inCart === 1 ? '' : 's') + ' now in the cart');
  } else if (e.t === 'ordered') {
    headline = (by || 'Someone') + ' moved an order to Open Orders: ' + (vendor || 'no vendor') + ', ' + nItems + (total ? ', about ' + money_(total) : '');
    subject = 'Open order: ' + (vendor || 'no vendor') + ', ' + nItems;
    if (e.note) extra.push(clean_(e.note));
  } else if (e.t === 'reopened') {
    headline = (by || 'Someone') + ' reopened ' + (vendor ? 'the ' + vendor + ' order' : 'an order') + (e.ordered ? ' from ' + shortDate_(e.ordered) : '') + ' (back in Open Orders)';
    subject = 'Reopened: ' + (vendor || 'an') + ' order';
  } else if (e.t === 'received') {
    headline = (by || 'Someone') + ' received ' + (vendor ? 'the ' + vendor + ' order' : 'an order') + ': ' + nItems + (total ? ', ' + money_(total) : '');
    subject = 'Received: ' + (vendor || 'order') + ', ' + nItems;
    if (e.ordered) extra.push('Ordered ' + shortDate_(e.ordered));
    if (e.noCount) extra.push('Marked received without changing stock counts');
    if (e.note) extra.push(clean_(e.note));
  } else {
    headline = 'Inventory update';
    subject = 'Inventory update';
  }
  if (by) subject += ' — ' + by;
  if (e.test) headline = 'TEST: ' + headline;

  var when = when_(e.at);
  var rows = lines.map(function (l) {
    var qty = num_(l.q) + (l.u ? ' ' + clean_(l.u) : '');
    return '<tr><td style="padding:3px 0;color:#111827">' + esc_(clean_(l.n)) + '</td>' +
      '<td style="padding:3px 0 3px 10px;text-align:right;white-space:nowrap;color:#374151">' + esc_(qty) + '</td>' +
      '<td style="padding:3px 0 3px 10px;text-align:right;white-space:nowrap;color:#6b7280">' + (l.p ? money_(l.p) : '') + '</td></tr>';
  }).join('');
  var html = '<div style="border:1px solid #e5e7eb;border-left:4px solid ' + info.color + ';border-radius:8px;padding:12px 14px;margin:0 0 12px">' +
    '<div style="font-size:12px;color:#6b7280;margin:0 0 2px">' + esc_(when) + ' · ' + esc_(info.label) + '</div>' +
    '<div style="font-size:15px;font-weight:bold;color:#111827;margin:0 0 6px">' + esc_(headline) + '</div>' +
    (rows ? '<table style="width:100%;border-collapse:collapse;font-size:14px">' + rows + '</table>' : '') +
    (extra.length ? '<div style="font-size:12px;color:#6b7280;margin-top:6px">' + extra.map(esc_).join(' · ') + '</div>' : '') +
    '</div>';
  if (all.length > lines.length) extra.push('and ' + (all.length - lines.length) + ' more line(s)');
  var text = when + ' — ' + headline + (lines.length ? '\n' + lines.map(function (l) {
    return '  • ' + clean_(l.n) + ' — ' + num_(l.q) + (l.u ? ' ' + clean_(l.u) : '') + (l.p ? ' (' + money_(l.p) + ')' : '');
  }).join('\n') : '') + (extra.length ? '\n  ' + extra.join(' · ') : '');
  return { subject: subject, headline: headline, html: html, text: text, tag: info.tag };
}

function wrapHtml_(inner) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;color:#111827">' + inner +
    '<a href="' + APP_URL + '" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;' +
    'font-size:14px;font-weight:bold;padding:9px 14px;border-radius:8px">Open NLO Inventory</a>' +
    '<div style="font-size:11px;color:#9ca3af;margin-top:12px">Sent by the “NLO Inventory Alerts” Apps Script. ' +
    'To stop these emails: NLO Inventory → Settings → Email alerts → Turn off.</div></div>';
}

// ─── NLO Inventory (the NLO Cases database), signed in with the script's own login ───
function cfg_(props) {
  var c = JSON.parse(props.getProperty('INV_CFG') || 'null') || CONFIG;
  if (!c || !c.apiKey || !c.projectId || !c.botEmail || !c.botPassword) throw new Error('Not set up yet: pick “setup” next to Run and press Run.');
  c.authBase = c.authBase || 'https://identitytoolkit.googleapis.com/v1';
  c.fsBase = c.fsBase || 'https://firestore.googleapis.com/v1';
  c.dbUrl = c.dbUrl || DB_URL;
  return c;
}
function http_(cfg, method, url, body, tok) {
  var opt = { method: method, muteHttpExceptions: true, headers: { Referer: APP_URL } };
  if (tok) opt.headers.Authorization = 'Bearer ' + tok;
  if (body != null) { opt.contentType = 'application/json'; opt.payload = ascii_(JSON.stringify(body)); }
  var r = UrlFetchApp.fetch(url, opt), code = r.getResponseCode(), text = r.getContentText(), json = null;
  try { json = JSON.parse(text); } catch (e) { }
  return { code: code, json: json, text: text };
}
/* sign in with the script's own login; kept for 45 minutes (it lasts an hour) */
function session_(cfg, fresh) {
  var cache = CacheService.getScriptCache();
  if (!fresh) {
    var c = null; try { c = JSON.parse(cache.get('inv_login') || 'null'); } catch (e) { }
    if (c && c.tok && c.email === cfg.botEmail) return { tok: c.tok, fresh: false };
  }
  var a = http_(cfg, 'post', cfg.authBase + '/accounts:signInWithPassword?key=' + encodeURIComponent(cfg.apiKey), { email: cfg.botEmail, password: cfg.botPassword, returnSecureToken: true });
  if (a.code !== 200 || !a.json || !a.json.idToken) {
    throw new Error('Couldn’t sign in to NLO Inventory (' + why_(a) + '). If its login was replaced, copy the script again: NLO Inventory → Settings → Email alerts → Get the alert script, paste it over this one, and run setup.');
  }
  try { cache.put('inv_login', JSON.stringify({ tok: a.json.idToken, email: cfg.botEmail }), 45 * 60); } catch (e) { }
  return { tok: a.json.idToken, fresh: true };
}
/* a database call; if the saved login was refused, sign in again once and retry */
function fs_(cfg, s, method, url, body) {
  var r = http_(cfg, method, url, body, s.tok);
  if ((r.code === 401 || r.code === 403) && !s.fresh) {
    var s2 = session_(cfg, true); s.tok = s2.tok; s.fresh = true;
    r = http_(cfg, method, url, body, s.tok);
  }
  return r;
}
function root_(cfg) { return cfg.fsBase + '/projects/' + cfg.projectId + '/databases/(default)/documents'; }
function docName_(cfg, path) { return 'projects/' + cfg.projectId + '/databases/(default)/documents/' + path; }
function commit_(cfg, s, writes) { return fs_(cfg, s, 'post', root_(cfg) + ':commit', { writes: writes }); }
/* one document, or null when there isn't one */
function getDoc_(cfg, s, path, what) {
  var r = fs_(cfg, s, 'get', root_(cfg) + '/' + path, null);
  if (r.code === 404) return null;
  if (r.code !== 200 || !r.json) throw new Error(readErr_(what || path, r));
  return r.json;
}
/* a query → { docs } */
function query_(cfg, s, coll, filters, order, limit) {
  var q = { from: [{ collectionId: coll }] };
  if (filters.length === 1) q.where = filters[0];
  else if (filters.length > 1) q.where = { compositeFilter: { op: 'AND', filters: filters } };
  if (order) q.orderBy = [{ field: { fieldPath: order }, direction: 'ASCENDING' }];
  if (limit) q.limit = limit;
  var r = fs_(cfg, s, 'post', root_(cfg) + ':runQuery', { structuredQuery: q });
  if (r.code !== 200 || !Array.isArray(r.json)) throw new Error(readErr_(coll, r));
  return { docs: r.json.filter(function (x) { return x && x.document; }).map(function (x) { return x.document; }) };
}
function readErr_(what, r) {
  return 'Couldn’t read NLO Inventory (' + what + ': ' + why_(r) + ').' +
    (r.code === 403 ? ' If the database’s rules don’t know Inventory yet, Dr. A publishes them from NLO Inventory; if this script’s login was replaced, copy the script again (Settings → Email alerts).' : '');
}
function why_(r) { return r.code + ((r.json && r.json.error && (' ' + (r.json.error.status || r.json.error.message || ''))) || ''); }
/* when it last checked, every 15 minutes or when something happened (Inventory → Settings shows it) */
function beat_(cfg, s, props, out, err, now, force) {
  var did = out.sent || out.copied || out.old || err;
  if (!did && !force && now - Number(props.getProperty('INV_BEAT') || 0) < 15 * 60000) return;
  var uid = uidOf_(s.tok); if (!uid) return;
  var r = commit_(cfg, s, [{ update: { name: docName_(cfg, 'invBeat/' + uid), fields: { ver: sv_(VERSION), err: sv_(String(err || '').slice(0, 300)), sent: iv_(out.sent), copied: iv_(out.copied) } },
    updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }] }]);
  if (r.code === 200) props.setProperty('INV_BEAT', String(now));
}
function uidOf_(tok) {
  try { var p = String(tok).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); while (p.length % 4) p += '='; return JSON.parse(Utilities.newBlob(Utilities.base64Decode(p)).getDataAsString()).user_id || ''; }
  catch (e) { return ''; }
}

/* Firestore's typed values ⇄ plain values (timestamps become milliseconds) */
function val_(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return String(v.stringValue);
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue === true;
  if ('timestampValue' in v) return tsMs_(v.timestampValue);
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(val_);
  if ('mapValue' in v) return plain_((v.mapValue && v.mapValue.fields) || {});
  return null;
}
function plain_(fields) { var o = {}; Object.keys(fields || {}).forEach(function (k) { o[k] = val_(fields[k]); }); return o; }
function sv_(s) { return { stringValue: String(s) }; }
function iv_(n) { return { integerValue: String(Math.round(Number(n) || 0)) }; }
function tsv_(ms) { return { timestampValue: new Date(ms).toISOString() }; }
function ff_(field, op, value) { return { fieldFilter: { field: { fieldPath: field }, op: op, value: value } }; }
function idOf_(d) { return String(d.name || '').split('/').pop(); }
/* "2026-10-15T17:40:12.123456Z" → milliseconds (the database gives microseconds) */
function tsMs_(s) {
  var m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)$/.exec(String(s || ''));
  if (!m) { var t = Date.parse(s); return isNaN(t) ? 0 : t; }
  var ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +(m[7] + '00').slice(0, 3) : 0);
  if (m[8] !== 'Z') ms -= (m[8][0] === '-' ? -1 : 1) * (+m[8].slice(1, 3) * 60 + +m[8].slice(4, 6)) * 60000;
  return ms;
}
function ascii_(json) { return json.replace(/[\u007f-\uffff]/g, function (c) { return '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4); }); }

// ─── The old Inventory database (REST, signed in as this Google account) ───
function db_(cfg, method, path, query, body) {
  var base = cfg.dbUrl + path + '.json';
  var qs = query ? [query] : [];
  if (cfg.dbNs) qs.push('ns=' + encodeURIComponent(cfg.dbNs));
  var opts = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } };
  if (body !== undefined) { opts.payload = ascii_(JSON.stringify(body)); opts.contentType = 'application/json'; }
  var res = UrlFetchApp.fetch(base + (qs.length ? '?' + qs.join('&') : ''), opts);
  var code = res.getResponseCode();
  if (code === 401) {
    // the same token, the other documented form
    delete opts.headers.Authorization;
    qs.push('access_token=' + encodeURIComponent(ScriptApp.getOAuthToken()));
    res = UrlFetchApp.fetch(base + '?' + qs.join('&'), opts);
    code = res.getResponseCode();
  }
  var text = res.getContentText();
  if (code < 200 || code >= 300) throw new Error('Old database ' + method.toUpperCase() + ' ' + path + ' failed (HTTP ' + code + '): ' + String(text).slice(0, 200));
  return text ? JSON.parse(text) : null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function alertEmail_() {
  var v = PropertiesService.getScriptProperties().getProperty('ALERT_EMAIL');
  return (v && v.trim()) || Session.getEffectiveUser().getEmail();
}
function mailbox_() { try { return Session.getEffectiveUser().getEmail() || 'this account'; } catch (e) { return 'this account'; } }
function removeTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === HANDLER) ScriptApp.deleteTrigger(t);
  });
}
function noteFailure_(props, err) {
  var n = (Number(props.getProperty('FAILS')) || 0) + 1;
  props.setProperty('FAILS', String(n));
  console.error('Inventory alert check failed (' + n + ' in a row): ' + err);
  if (n < FAILS_BEFORE_NOTICE) return;
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  if (props.getProperty('FAIL_NOTICE_DAY') === today) return;
  props.setProperty('FAIL_NOTICE_DAY', today);
  try {
    MailApp.sendEmail({
      to: alertEmail_(), name: 'NLO Inventory',
      subject: 'NLO inventory alerts are not working',
      body: 'For the last ' + n + ' checks the alert script could not check NLO Inventory. Nothing is lost: ' +
        'missed alerts will be sent once it works again, and Staff Meeting and AISA catch up then.\n\nLast error: ' + err + '\n\nOpen the "NLO Inventory Alerts" ' +
        'script > Executions to see details.'
    });
  } catch (e) { console.error('Could not send the failure notice: ' + e); }
}
function msg_(e) { return String((e && e.message) || e); }
function readJson_(props, key, fallback) {
  try { var v = props.getProperty(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}
function clean_(v) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); }
function cut_(v, max) { v = clean_(v); return v.length > max ? v.slice(0, max - 1) + '…' : v; }
function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function num_(v) { var n = Number(v) || 0; return Math.round(n) === n ? String(n) : String(Math.round(n * 100) / 100); }
function money_(v) {
  var n = Math.round((Number(v) || 0) * 100) / 100;
  var s = n.toFixed(2).split('.');
  return '$' + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + s[1];
}
function uniq_(arr) { var seen = {}; return arr.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; }); }
function when_(at) {
  var d = new Date(Number(at) || Date.now());
  var sameDay = Utilities.formatDate(d, TZ, 'yyyy-MM-dd') === Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  return Utilities.formatDate(d, TZ, sameDay ? 'h:mm a' : 'EEE M/d, h:mm a');
}
function shortDate_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? Number(m[2]) + '/' + Number(m[3]) : clean_(iso);
}
