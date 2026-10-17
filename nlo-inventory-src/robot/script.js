/**
 * NLO Inventory Alerts — version 3 (Google Apps Script)
 * ---------------------------------------------------------------------------
 * Emails Dr. Akhavan within about a minute whenever someone in NLO Inventory:
 *   - adds something to the cart (or more of something already in it)
 *   - places an order (from the cart, a new order, a backorder, a reopen)
 *   - receives an order
 * Everything from the same minute comes as one email, with who did it.
 * With the phone push on (Inventory → Settings → Phone push), what someone
 * else adds to the cart (it needs his OK) comes as a push in the free ntfy
 * app instead of an email: straight to ntfy, or — when Google's servers
 * can't reach it — through ntfy's email address for the topic.
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
 *                     Email alerts turns the emails themselves off and on,
 *                     Phone push the pushes)
 *
 * It signs in to NLO Inventory with a login of its own (made by Dr. A in
 * Inventory → Settings → Email alerts → Get the alert script) that can read
 * Inventory and clear the alerts it sent, nothing else. The old database is
 * reached as this Google account, as before.
 * At night (9 PM to 5 AM) it checks every 10 minutes instead of every minute.
 *
 * Version 4 (Oct 2026) also watches for deals: by day, once an hour, it looks at
 * this Gmail's new emails from Mari's List, from the vendors the office buys
 * from, or that mention Mari's List. Order, shipping, invoice, case and login
 * emails, replies, and anything naming a patient are left alone. The offers go
 * to the AI (the office's Gemini key) with the office's supply list; an offer
 * on supplies the office buys comes to Dr. A's phone (the same push as the cart
 * adds) and shows on Inventory's Home, with a "Deal" tag on those supplies,
 * until it ends.
 * Every offer goes into Friday morning's roundup email. (Reading the promo
 * emails is why it asks for Gmail access.)
 *
 * Optional Script Properties (Project Settings > Script Properties):
 *   ALERT_EMAIL  who gets the email (default: this account; commas for more)
 */
var VERSION = '4';
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
var NTFY_REST = 3 * 3600000;     // the direct way to ntfy rests this long after Google's servers couldn't reach it
var NTFY_MAIL_EVERY = 10 * 60000; // meanwhile, pushes go through ntfy's email address at most this often (all waiting in one)
var MAIL_RESERVE = 10;           // and only while this many of the day's emails are left for the alerts themselves

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
  ['FAILS', 'FAIL_NOTICE_DAY', 'INV_REV', 'INV_UP', 'INV_FULL_DAY', 'INV_BEAT', 'INV_LAST', 'INV_BUD', 'INV_AI', 'INV_NTFY_REST', 'INV_NTFY_MAIL_AT', 'NTFY_TOPIC'].forEach(function (k) { props.deleteProperty(k); });
  try { CacheService.getScriptCache().remove('inv_login'); } catch (e) { }
  var cfg = cfg_(props), s = session_(cfg, true);
  getDoc_(cfg, s, 'meta/rules_inv_1', 'the rules');      // proves the login works (and the rules know Inventory)
  db_(cfg, 'get', '/nlo/items', 'shallow=true');         // proves the old database is reachable as this Google account
  GmailApp.getInboxUnreadCount();                        // and that it may read this Gmail's promo emails (the deals)
  removeTriggers_();
  ScriptApp.newTrigger(HANDLER).timeBased().everyMinutes(1).create();
  var r = run_(true);
  Logger.log('NLO Inventory alerts (version ' + VERSION + ') are running for ' + mailbox_() + '. ' + summary_(r) +
    ' It checks every minute (every 10 minutes at night); emails go to ' + alertEmail_() + '. Deals: it looks at the promo emails every hour by day' +
    (r.deals ? ' (' + r.deals + ' deal(s) on the office’s supplies so far)' : '') + '; the roundup comes Friday mornings.');
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

// ─── Every minute (the trigger runs this) ──────────────────────────────────
function checkInventoryAlerts() { return run_(false); }

/* one check. force: everything now, whatever the hour (setup) */
function run_(force) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return { busy: true };          // a previous run is still going
  var props = PropertiesService.getScriptProperties(), now = Date.now(), out = { sent: 0, waiting: 0, copied: 0, old: 0, moved: false, deals: 0 };
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
      try { var a = alerts_(cfg, s, props, now); out.sent = a.sent; out.waiting = a.waiting; if (a.note) notes.push(a.note); if (a.waiting) done = false; }
      catch (e) { done = false; errs.push(msg_(e)); }
      try {
        var c = copy_(cfg, s, props, full);
        out.copied = c.n; out.moved = c.moved; if (c.note) notes.push(c.note);
        if (full && c.moved) props.setProperty('INV_FULL_DAY', day_(now));
      } catch (e) { done = false; errs.push(msg_(e)); }
      if (done) props.setProperty('INV_REV', rev);    // (read before the work: a change made meanwhile is seen next minute)
    }
    try { out.old = oldPage_(cfg, props, now); } catch (e) { errs.push(msg_(e)); }
    // the deals: on their own too (a problem with them is noted, never held against the alerts or the copy)
    try { var dl = deals_(cfg, s, props, now, force); out.deals = dl.n; if (dl.note) notes.push(dl.note); } catch (e) { notes.push('Deals: ' + msg_(e)); }
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

// ─── Alerts: the ones Inventory left, emailed (or pushed) once, then cleared ───
/* → { sent, waiting, note }. With the phone push on, someone else's cart adds go to Dr. A's phone (his own aren't sent at all);
   the rest are emailed while the email alerts are on (and cleared unsent while they're off): emails of at most PER_EMAIL alerts
   and about EMAIL_BYTES each. What went is remembered as it goes (so a failure part way never sends anything twice) and
   cleared; the rest waits for the next check. A test push Dr. A asked for goes first. */
function alerts_(cfg, s, props, now) {
  var pushDoc = getDoc_(cfg, s, 'invState/push', 'the phone push'), pf = pushDoc ? pushDoc.fields || {} : {};
  var push = { topic: String(val_(pf.topic) || ''), owner: String(val_(pf.upBy) || ''), test: Number(val_(pf.test) || 0) };
  var note = '', testWaits = 0;
  if (push.topic && push.test > Number(props.getProperty('PUSH_TEST') || 0)) {
    var t = pushes_(cfg, props, push.topic, [{ title: 'NLO Inventory: test push', text: 'Cart adds that need your OK come here.' }], now);
    if (t.got[0]) props.setProperty('PUSH_TEST', String(push.test)); else { note = 'The test push didn’t go: ' + t.err; testWaits = 1; }
  }
  var docs = query_(cfg, s, 'invAlerts', [], 'at', MAX_PER_RUN).docs;
  if (!docs.length) return { sent: 0, waiting: testWaits, note: note };
  var setDoc = getDoc_(cfg, s, 'invState/settings', 'the settings'), set = setDoc ? plain_(setDoc.fields) : {};
  var pushOn = set.pushOn === true && !!push.topic, mailOn = set.alertsOn === true;
  var sent = readJson_(props, 'SENT_KEYS', []), already = {};
  sent.forEach(function (k) { already[k] = true; });
  var fresh = docs.filter(function (d) { return !already[idOf_(d)]; }).map(function (d) { return { id: idOf_(d), e: plain_(d.fields) }; });
  var toPush = [], toMail = [], drop = [];
  fresh.forEach(function (x) {
    if (x.e.t === 'cart' && pushOn) (push.owner && x.e.upBy === push.owner ? drop : toPush).push(x);
    else (mailOn ? toMail : drop).push(x);
  });
  var keep = function (list) { sent = sent.concat(list.map(function (g) { return g.id; })).slice(-400); props.setProperty('SENT_KEYS', JSON.stringify(sent)); };
  var n = 0, left = 0;
  if (drop.length) keep(drop);
  if (toPush.length) {
    var r = pushes_(cfg, props, push.topic, toPush.map(function (x) { return pushOf_(x.e); }), now);
    var went = toPush.filter(function (x, i) { return r.got[i]; });
    if (went.length) keep(went);
    n += went.length; left += toPush.length - went.length;
    if (r.err && toPush.length > went.length) note = (note ? note + ' · ' : '') + 'Phone push: ' + r.err;
  }
  var groups = emailGroups_(toMail), each = recipients_(), mailed = 0;
  for (var i = 0; i < groups.length; i++) {
    // (each email counts once per address it goes to)
    if (quota_() < each) { note = (note ? note + ' · ' : '') + 'Gmail’s daily email limit is used up: ' + (toMail.length - mailed) + ' alert(s) wait until tomorrow.'; break; }
    deliver_(groups[i].map(function (g) { return g.e; }));
    keep(groups[i]);
    mailed += groups[i].length;
  }
  n += mailed; left += toMail.length - mailed;
  var gone = {}; sent.forEach(function (k) { gone[k] = true; });
  var clear = docs.filter(function (d) { return gone[idOf_(d)]; });
  if (clear.length) {
    var r = commit_(cfg, s, clear.map(function (d) { return { delete: d.name }; }));
    if (r.code !== 200) throw new Error('Couldn’t clear the alerts it sent (' + why_(r) + ').');
  }
  // a full page of alerts: there may be more behind it — the next check goes on with them (the change counter isn't moved on)
  return { sent: n, waiting: left + testWaits + (docs.length >= MAX_PER_RUN ? 1 : 0), note: note };
}
/* a cart add (or a line changed after Dr. A's OK) as a phone push: who, what, and that it needs his OK; short: one line of it,
   for a push of several */
function pushOf_(e) {
  var lines = (Array.isArray(e.lines) ? e.lines : []).filter(function (l) { return l && typeof l === 'object'; });
  var line = function (l) { return cut_(l.n, 80) + ' — ' + num_(l.q) + (l.u ? ' ' + cut_(l.u, 20) : '') + (l.v ? ' (' + cut_(l.v, 40) + ')' : ''); };
  var what = lines.slice(0, 6).map(function (l) { return '• ' + line(l); });
  if (lines.length > 6) what.push('and ' + (lines.length - 6) + ' more');
  var by = cut_(e.by || 'Someone', 60), changed = e.note === 'changed';
  return { title: by + (changed ? ' changed a line in the cart' : ' added to the cart'), text: what.join('\n') + (what.length ? '\n' : '') + (changed ? 'Needs your OK again: Inventory → Cart.' : 'Needs your OK: Inventory → Cart.'),
    short: by + ': ' + (lines.length ? line(lines[0]) + (lines.length > 1 ? ' +' + (lines.length - 1) + ' more' : '') : 'the cart') + (changed ? ' (changed)' : '') };
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

// ─── Deals: the promo emails in this Gmail, matched to the supplies the office buys ───
/* Amir, 16 Oct 2026: "can you find a way for us to get live updates on things from Marislist that we actually use? they send
   emails and also they have a website. I usually don't see the promotions or I miss them". By day, once an hour, it looks at
   this Gmail's new emails from Mari's List, from the vendors the office buys from (Inventory's vendors and the websites its
   supplies come from, and the usual orthodontic ones), or that mention Mari's List. Order, shipping, invoice, case, return
   and login emails, replies and forwards, and anything naming a patient are left alone: never read further, never sent
   anywhere. What's left, when it looks like an offer, goes to the AI (the office's Gemini key, Inventory → Settings → AI)
   with the office's supply list: what's on offer, until when, how to get it, and which supplies it's for. An offer on
   supplies the office buys: a push to Dr. A's phone (the cart pushes' topic; tapping it opens the email) and a record in
   Inventory (invDeals, under the email's id): it shows on Inventory's Home with those supplies, which carry a "Deal" tag, until
   it ends (Amir: "shouldn't they appear in the dashboard instead? the items … or maybe both"). Every offer goes into
   Friday morning's roundup email. Each email is looked at once. (The Mari's List member portal signs in with a code by email,
   so its specials aren't read from here: their emails are the source.) */
var DEALS_EVERY = 60 * 60000;          // how often it looks (6 AM to 9 PM)
var DEALS_PER_RUN = 8;                 // offers read by the AI in one check at most (the rest wait for the next)
var DEALS_LOOKBACK = 3 * 864e5;        // how far back the very first look goes
var DEAL_DAYS = 21;                    // a deal with no end date shows this long
var DEAL_TRIES = 3;                    // an email the AI couldn't read this many times is left
var ROUNDUP_WEEKDAY = 5, ROUNDUP_HOUR = 7;   // Friday, 7 AM office time (Fridays are for vendor calls)
var FREE_MAIL = ['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com', 'me.com', 'live.com', 'msn.com', 'comcast.net', 'att.net'];
var DEAL_VENDORS = ['marislist.com', 'americanortho.com', 'henryschein.com', 'pattersondental.com', 'benco.com', 'ormco.com', 'dentsplysirona.com',
  'solventum.com', '3m.com', 'orthotechnology.com', 'ultradent.com', 'orthoarch.com', 'net32.com', 'safcodental.com', 'darbydental.com',
  'sunsurgical.com', 'kometusa.com', 'baymaterials.com', 'zenduradental.com', 'ulabsystems.com', 'allureortho.com', 'brandhousedental.com'];
var NOT_OFFER = /\b(order\s*#?\s*\d|order (confirmed|confirmation|received|has shipped|is on the way)|invoice|receipt|statement|shipped|shipment|tracking|delivered|out for delivery|verification|login code|your code|password|sign[- ]in|case\s*#|uassist|treatment plan|rma\b|return label|payment|past due|refund)/i;
var PATIENT = /\bpatients?\b|\bDOB\b|date of birth|\bMRN\b/i;
var OFFER = /(\d+\s?%\s?off|%\s?off|\bsave\b|\bsale\b|special|promo|\bdeals?\b|exclusive|discount|\bfree\b|limited[- ]time|\boffer\b|clearance|\bbogo\b|buy \d+|rebate|bundle|price (drop|reduction)|coupon)/i;
var MARIS = /mari'?\u2019?s\s*list|marislist/i;
/* → { n: deals saved, note } */
function deals_(cfg, s, props, now, force) {
  var out = { n: 0, note: '' }, hr = hour_(now);
  if (force || (now - Number(props.getProperty('DEALS_AT') || 0) >= DEALS_EVERY && hr >= 6 && hr < 21)) {
    props.setProperty('DEALS_AT', String(now));
    out = dealScan_(cfg, s, props, now);
  }
  try { roundup_(props, now); } catch (e) { out.note = (out.note ? out.note + ' · ' : '') + 'Deals roundup: ' + msg_(e); }
  return out;
}
function dealScan_(cfg, s, props, now) {
  var ai = getDoc_(cfg, s, 'invState/ai', 'the AI keys'), key = ai ? String(val_((ai.fields || {}).gemini) || '') : '';
  if (!key) return { n: 0, note: 'Deals: there’s no Gemini key yet (Inventory → Settings → AI), so the promo emails aren’t read.' };
  var cat = dealCatalog_(cfg, s), byId = {};
  cat.items.forEach(function (i) { byId[i.id] = i; });
  var since = Number(props.getProperty('DEALS_SINCE') || 0) || now - DEALS_LOOKBACK;
  var seen = readJson_(props, 'DEALS_SEEN', []), tries = readJson_(props, 'DEALS_TRIES', {}), had = {};
  seen.forEach(function (k) { had[k] = true; });
  var msgs = dealMail_(cat.domains, since - 3600000).filter(function (m) { return !had[m.getId()]; });
  var pushDoc = getDoc_(cfg, s, 'invState/push', 'the phone push'), topic = String(val_(((pushDoc || {}).fields || {}).topic) || '');
  var setDoc = getDoc_(cfg, s, 'invState/settings', 'the settings'), pushOn = !!topic && (setDoc ? plain_(setDoc.fields) : {}).pushOn === true;
  var mark = function (id) { seen.push(id); had[id] = true; delete tries[id]; };
  var saved = 0, read = 0, note = '', rulesOld = false, waitFrom = 0, pushList = [];
  for (var i = 0; i < msgs.length; i++) {
    var m = msgs[i], id = String(m.getId()), at = m.getDate().getTime(), subject = String(m.getSubject() || ''), from = String(m.getFrom() || '');
    if (!dealSender_(from, subject, cat.domains) || /^\s*(re|fwd?|aw)\s*:/i.test(subject) || NOT_OFFER.test(subject)) { mark(id); continue; }
    var text = cleanMail_(m.getPlainBody());
    if (PATIENT.test(subject + '\n' + text)) { mark(id); continue; }
    if (!MARIS.test(from + ' ' + subject + ' ' + text) && !OFFER.test(subject + '\n' + text)) { mark(id); continue; }
    if (read >= DEALS_PER_RUN) { waitFrom = at; break; }       // (not marked: the next check reads it)
    read++;
    var o;
    try { o = dealAi_(cfg, key, { from: from, subject: subject, day: day_(at), text: text }, cat, day_(now)); }
    catch (e) {
      tries[id] = (tries[id] || 0) + 1; note = 'Deals: the AI couldn’t read an offer (' + msg_(e) + ')';
      if (tries[id] >= DEAL_TRIES) { mark(id); continue; }
      waitFrom = at; break;                                    // (AI trouble: the rest wait for the next check)
    }
    var d = dealOf_(o, byId);
    if (d) {
      if (!d.title) d.title = cut_(subject, 200);
      if (!d.vendor) d.vendor = cut_(fromName_(from), 120) || 'A vendor';
      var names = d.items.map(function (x) { return byId[x.id].n; }), link = mailLink_(id);
      if (d.items.length) {
        var st = dealSave_(cfg, s, id, d, subject, from, link);
        if (st === 'rules') rulesOld = true; else if (st === 'saved') saved++;
        if (pushOn && st !== 'had') pushList.push({ title: 'Deal: ' + cut_(d.vendor, 60), click: link, tags: ['moneybag'],
          text: d.title + (d.ends ? ' (ends ' + shortDate_(d.ends) + ')' : '') + '\nFor: ' + names.slice(0, 3).join(', ') + (names.length > 3 ? ' and ' + (names.length - 3) + ' more' : '') + (d.how ? '\n' + d.how : ''),
          short: cut_(d.vendor, 40) + ': ' + cut_(d.title, 90) });
      }
      roundupAdd_(props, { id: id, v: cut_(d.vendor, 40), t: cut_(d.title, 90), e: d.ends, f: names.slice(0, 3).map(function (n) { return cut_(n, 40); }), n: names.length });
    }
    mark(id);
  }
  props.setProperty('DEALS_SEEN', JSON.stringify(seen.slice(-300)));
  props.setProperty('DEALS_TRIES', JSON.stringify(tries));
  props.setProperty('DEALS_SINCE', String(waitFrom ? Math.min(waitFrom, now) : now));
  if (pushList.length) {
    var r = pushes_(cfg, props, topic, pushList, now, { title: function (n) { return n + ' new deals on things you buy'; }, click: APP_URL + '#home', tags: ['moneybag'] });   // (Home leads with them)
    if (r.err) note = (note ? note + ' · ' : '') + 'Deals push: ' + r.err;
  }
  try { dealsTidy_(cfg, s, props, now); } catch (e) { if (/\b403\b/.test(msg_(e))) rulesOld = true; else note = (note ? note + ' · ' : '') + 'Deals: ' + msg_(e); }
  if (rulesOld) note = (note ? note + ' · ' : '') + 'Deals: to show them in Inventory, Dr. A publishes the new rules (Inventory → Settings → Vendor deals). The pushes and the Friday roundup work meanwhile.';
  return { n: saved, note: note };
}
/* the office's supplies (id | name | vendor | #sku | maker) and the email domains of the vendors it buys from; kept 6 hours */
function dealCatalog_(cfg, s) {
  var cache = CacheService.getScriptCache(), c = null;
  try { c = JSON.parse(cache.get('deal_catalog') || 'null'); } catch (e) { }
  if (c && c.items && c.domains) return c;
  var dom = {}, add = function (x) { var k = domainOf_(x); if (k) dom[k] = true; };
  DEAL_VENDORS.forEach(function (d) { dom[d] = true; });
  var items = [];
  query_(cfg, s, 'invItems', [], null).docs.forEach(function (d) {
    var i = plain_(d.fields); if (!i || i.id == null || i.deleted || i.archived) return;
    var srcs = Array.isArray(i.sources) ? i.sources.filter(function (x) { return x && typeof x === 'object'; }) : [], src = srcs[0] || {};
    srcs.forEach(function (x) { add(x.src); add(x.url); });
    items.push({ id: String(i.id), n: cut_(i.name, 90), v: cut_(src.vendor || '', 40), k: cut_(src.sku || i.sku || '', 24), m: cut_(i.manufacturer || '', 30) });
  });
  query_(cfg, s, 'invVendors', [], null).docs.forEach(function (d) { var v = plain_(d.fields); if (!v.deleted) { add(v.email); add(v.repEmail); add(v.portal); } });
  c = { items: items.slice(0, 600), domains: Object.keys(dom).sort() };
  try { cache.put('deal_catalog', JSON.stringify(c), 6 * 3600); } catch (e) { }   // (too big for the cache: read again next time)
  return c;
}
/* "rep@shop.americanortho.com", "https://www.sunsurgical.com/x" → "americanortho.com", "sunsurgical.com" ('' for free mail) */
function domainOf_(x) {
  x = String(x || '').toLowerCase().trim();
  var m = /@([a-z0-9.-]+)/.exec(x) || /^(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/.exec(x);
  if (!m) return '';
  var parts = m[1].replace(/\.+$/, '').split('.').filter(Boolean);
  if (parts.length < 2) return '';
  var d = parts.slice(-2).join('.');
  return FREE_MAIL.indexOf(d) >= 0 ? '' : d;
}
/* from Mari's List, from one of the vendors, or mentioning Mari's List */
function dealSender_(from, subject, domains) {
  var d = domainOf_(from);
  return (d && domains.indexOf(d) >= 0) || MARIS.test(from + ' ' + subject);
}
/* this Gmail's emails since then that could be offers (the checks above decide); oldest first */
function dealMail_(domains, since) {
  var q = 'after:' + Math.floor(since / 1000) + ' -in:sent -in:drafts -in:chats -in:spam -in:trash (' +
    ['"Mari\'s List"', 'marislist'].concat(domains.map(function (d) { return 'from:' + d; })).join(' OR ') + ')';
  var out = [];
  GmailApp.search(q, 0, 50).forEach(function (t) {
    t.getMessages().forEach(function (m) { if (m.getDate().getTime() > since) out.push(m); });
  });
  out.sort(function (a, b) { return a.getDate().getTime() - b.getDate().getTime(); });
  return out;
}
/* an email's words for the AI: no endless tracking links, no blank stretches, at most 12,000 characters */
function cleanMail_(t) {
  t = String(t || '').replace(/\r/g, '').replace(/https?:\/\/\S{80,}/g, function (u) { return u.slice(0, 60) + '…'; })
    .replace(/[ \t\u00a0]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  return t.length > 12000 ? t.slice(0, 12000) + '\n…' : t;
}
function fromName_(from) { var m = /^\s*"?([^"<]+?)"?\s*</.exec(String(from || '')); return m ? m[1] : String(from || '').replace(/@.*/, ''); }
function mailLink_(id) { return 'https://mail.google.com/mail/?authuser=' + encodeURIComponent(mailbox_()) + '#all/' + id; }
function hour_(ms) { return Number(Utilities.formatDate(new Date(ms), TZ, 'H')); }
/* the AI's reading of one email: { promo, vendor, title, ends, how, items: [{ id, what, price }] } */
function dealAi_(cfg, key, mail, cat, today) {
  var list = cat.items.map(function (i) { return i.id + ' | ' + i.n + (i.v ? ' | ' + i.v : '') + (i.k ? ' | #' + i.k : '') + (i.m ? ' | ' + i.m : ''); }).join('\n');
  var prompt = 'You help an orthodontic office (Next Level Orthodontics) catch offers on the supplies it buys. Today is ' + today + '.\n' +
    'Read the email below and answer with JSON only:\n' +
    '{"promo": true only if the email offers the office a sale, a discount, a special price, free goods, a bundle or a rebate (false for a newsletter without an offer, an order or shipping notice, an invoice, a webinar or an event),\n' +
    ' "vendor": "the company making the offer",\n' +
    ' "title": "the offer in plain words, under 90 characters, e.g. \\"20% off all o-ties\\" or \\"Buy 10, get 2 free: Transbond XT\\"",\n' +
    ' "ends": "the last day of the offer as YYYY-MM-DD, or \\"\\" if the email doesn\'t say",\n' +
    ' "how": "how to get it (a code, a link, call the rep), under 200 characters, or \\"\\"",\n' +
    ' "items": [{"id": "an id from OUR SUPPLIES", "what": "what the offer means for that supply, under 80 characters", "price": "the deal price if the email gives one, else \\"\\""}]}\n' +
    'Put a supply in items only when the offer clearly covers that product: the same product, or its whole product line from the same brand. Leave items empty when nothing on our list fits.\n\n' +
    'OUR SUPPLIES (id | name | vendor | #sku | maker):\n' + list + '\n\n' +
    'THE EMAIL\nFrom: ' + cut_(mail.from, 160) + '\nSubject: ' + cut_(mail.subject, 200) + '\nDate: ' + mail.day + '\n\n' + mail.text;
  var models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'], err = '';
  for (var i = 0; i < models.length; i++) {
    var gen = { responseMimeType: 'application/json', temperature: 0 };
    if (/2\.5/.test(models[i])) gen.thinkingConfig = { thinkingBudget: 0 };
    var r = UrlFetchApp.fetch(cfg.aiBase + '/v1beta/models/' + models[i] + ':generateContent?key=' + encodeURIComponent(key),
      { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: ascii_(JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: gen })) });
    var code = r.getResponseCode();
    if (code === 200) {
      var j = null; try { j = JSON.parse(r.getContentText()); } catch (e) { }
      var parts = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
      var text = parts ? parts.map(function (p) { return p.text || ''; }).join('') : '';
      try { return JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (e) { err = 'its answer wasn’t JSON'; continue; }
    }
    err = 'the AI answered ' + code;
    if (code === 400 || code === 401 || code === 403) break;   // (the key: the other models won't do better)
  }
  throw new Error(err || 'no answer');
}
/* the AI's answer, checked: an offer, its supplies only from the office's list (each once) → { vendor, title, ends, how, items } */
function dealOf_(o, byId) {
  if (!o || typeof o !== 'object' || o.promo !== true) return null;
  var seen = {}, items = [];
  (Array.isArray(o.items) ? o.items : []).forEach(function (x) {
    var id = x && x.id != null ? String(x.id) : '';
    if (!id || !byId[id] || seen[id] || items.length >= 30) return;
    seen[id] = true; items.push({ id: id, what: cut_(x.what, 120), price: cut_(x.price, 40) });
  });
  return { vendor: cut_(o.vendor, 120), title: cut_(o.title, 200), ends: /^\d{4}-\d{2}-\d{2}$/.test(String(o.ends || '')) ? String(o.ends) : '', how: cut_(o.how, 400), items: items };
}
/* a deal into Inventory: 'saved', 'had' (saved before), or 'rules' (the rules from before the deals refuse it) */
function dealSave_(cfg, s, id, d, subject, from, link) {
  var fields = { vendor: sv_(d.vendor), title: sv_(d.title), ends: sv_(d.ends), how: sv_(d.how), subject: sv_(cut_(subject, 200)), from: sv_(cut_(from, 160)),
    mail: sv_(link.slice(0, 300)), src: sv_('email'),
    items: { arrayValue: { values: d.items.map(function (x) { return { mapValue: { fields: { id: sv_(x.id), what: sv_(x.what), price: sv_(x.price) } } }; }) } } };
  var r = commit_(cfg, s, [{ update: { name: docName_(cfg, 'invDeals/' + id), fields: fields }, currentDocument: { exists: false },
    updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }] }]);
  if (r.code === 200) return 'saved';
  var st = r.json && r.json.error ? String(r.json.error.status || '') : '';
  if (r.code === 409 || /ALREADY_EXISTS|FAILED_PRECONDITION/.test(st)) return 'had';
  if (r.code === 403) return 'rules';
  throw new Error('a deal couldn’t be saved in Inventory (' + why_(r) + ')');
}
/* deals that have ended (or, with no end date, are DEAL_DAYS old) come off Inventory; once a day */
function dealsTidy_(cfg, s, props, now) {
  var today = day_(now);
  if (props.getProperty('DEALS_TIDY') === today) return;
  var gone = query_(cfg, s, 'invDeals', [], null).docs.filter(function (d) {
    var o = plain_(d.fields), age = now - (Number(o.at) || 0);
    return (o.ends && String(o.ends) < today) || (!o.ends && age > DEAL_DAYS * 864e5) || age > 90 * 864e5;
  }).map(function (d) { return { delete: d.name }; });
  if (gone.length) { var r = commit_(cfg, s, gone); if (r.code !== 200) throw new Error('ended deals couldn’t be taken off (' + why_(r) + ')'); }
  props.setProperty('DEALS_TIDY', today);
}
/* the week's offers, for Friday's roundup (in the script's properties: kept small) */
function roundupAdd_(props, e) {
  var w = readJson_(props, 'DEALS_WEEK', []);
  w.push(e);
  while (w.length > 25 || JSON.stringify(w).length > 8000) {
    var k = -1; for (var i = 0; i < w.length; i++) if (!w[i].n) { k = i; break; }   // (an offer on nothing the office buys goes first)
    w.splice(k >= 0 ? k : 0, 1);
  }
  props.setProperty('DEALS_WEEK', JSON.stringify(w));
}
/* Friday from 7 AM: one email with the week's offers (the ones on the office's supplies first); nothing when there were none */
function roundup_(props, now) {
  var today = day_(now);
  if (Number(Utilities.formatDate(new Date(now), TZ, 'u')) !== ROUNDUP_WEEKDAY || hour_(now) < ROUNDUP_HOUR || props.getProperty('ROUNDUP_DAY') === today) return 0;
  var w = readJson_(props, 'DEALS_WEEK', []);
  if (w.length) {
    if (quota_() < recipients_() + MAIL_RESERVE) return 0;     // (the alerts come first: tried again next check)
    var mine = w.filter(function (e) { return e.n; }), other = w.filter(function (e) { return !e.n; });
    var row = function (e) {
      return '<div style="border:1px solid #e5e7eb;border-left:4px solid ' + (e.n ? '#059669' : '#9ca3af') + ';border-radius:8px;padding:10px 12px;margin:0 0 10px">' +
        '<div style="font-size:12px;color:#6b7280">' + esc_(e.v || 'A vendor') + (e.e ? ' · ends ' + esc_(shortDate_(e.e)) : '') + '</div>' +
        '<div style="font-size:15px;font-weight:bold;color:#111827;margin:2px 0">' + esc_(e.t) + '</div>' +
        (e.n ? '<div style="font-size:13px;color:#047857">For: ' + esc_((e.f || []).join(', ') + (e.n > (e.f || []).length ? ' and ' + (e.n - e.f.length) + ' more' : '')) + '</div>' : '') +
        '<a href="' + esc_(mailLink_(e.id)) + '" style="font-size:13px;color:#1D3EA9">Open the email</a></div>';
    };
    var text = function (e) { return '• ' + (e.v || 'A vendor') + ': ' + e.t + (e.e ? ' (ends ' + shortDate_(e.e) + ')' : '') + (e.n ? ' — for ' + (e.f || []).join(', ') : '') + '\n  ' + mailLink_(e.id); };
    MailApp.sendEmail({ to: alertEmail_(), name: 'NLO Inventory',
      subject: 'This week’s deals: ' + (mine.length ? mine.length + ' on things you buy' + (other.length ? ', ' + other.length + ' more' : '') : w.length + ' offer' + (w.length === 1 ? '' : 's')),
      htmlBody: '<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;color:#111827">' +
        (mine.length ? '<h3 style="margin:0 0 10px;font-size:16px">On things you buy</h3>' + mine.map(row).join('') : '') +
        (other.length ? '<h3 style="margin:14px 0 10px;font-size:16px">Other offers this week</h3>' + other.map(row).join('') : '') +
        '<div style="font-size:11px;color:#9ca3af;margin-top:12px">From the promo emails in ' + esc_(mailbox_()) + ', read by the “NLO Inventory Alerts” Apps Script. The deals on supplies the office buys show in NLO Inventory (Home, and a Deal tag on the supplies) until they end.</div></div>',
      body: (mine.length ? 'On things you buy:\n' + mine.map(text).join('\n') + '\n\n' : '') + (other.length ? 'Other offers this week:\n' + other.map(text).join('\n') + '\n' : '') });
    props.setProperty('DEALS_WEEK', '[]');
  }
  props.setProperty('ROUNDUP_DAY', today);
  return w.length;
}

// ─── Delivery ──────────────────────────────────────────────────────────────
function deliver_(events) {
  var msg = buildMessage_(events);
  MailApp.sendEmail({ to: alertEmail_(), name: 'NLO Inventory', subject: msg.subject, body: msg.text, htmlBody: msg.html });
}

/* The phone pushes of one check (the free ntfy app: Dr. A subscribes to the topic in Inventory → Settings → Phone push):
   { got: [went?, for each], err, via: 'ntfy' | 'mail' | '' }. Straight to ntfy: one push per alert, or one for all of them
   when there are more than 4. When Google's servers can't reach ntfy (no answer, or "too many": ntfy.sh shuts out, for hours
   at a time, addresses many people share, and Google's are shared by everyone's scripts), the ones still to go go in one
   email to ntfy's own address for the topic, which ntfy turns into the same notification, and the direct way rests for 3
   hours (each try would hang about a minute, and those minutes count against this account's daily script time).
   (The Time Clock's alert script does the same since 13 Oct 2026.) */
function pushes_(cfg, props, topic, list, now, many) {
  var got = list.map(function () { return false; }), err = '', via = '';
  var rest = !!cfg.ntfyMail && Number(props.getProperty('INV_NTFY_REST') || 0) > now;
  if (!rest) {
    var groups = list.length > 4 ? [list.map(function (a, i) { return i; })] : list.map(function (a, i) { return [i]; });
    for (var k = 0; k < groups.length; k++) {
      var g = groups[k], one = g.length === 1 ? list[g[0]] : null;
      try {
        if (one) push_(cfg, topic, one.title, one.text, one.click, one.tags);
        else push_(cfg, topic, many ? many.title(g.length) : g.length + ' cart adds need your OK', g.map(function (i) { return list[i].short || list[i].title; }).join('\n'), many && many.click, many && many.tags);
        g.forEach(function (i) { got[i] = true; });
        via = 'ntfy';
      } catch (e) {
        err = msg_(e);
        if (e.away && cfg.ntfyMail) { rest = true; props.setProperty('INV_NTFY_REST', String(now + NTFY_REST)); break; }
      }
    }
  }
  var left = list.filter(function (a, i) { return !got[i]; });
  if (rest && left.length) {
    // the email way: at most every 10 minutes (the ones waiting go together), and never using up the emails the alerts need
    var lastMail = Number(props.getProperty('INV_NTFY_MAIL_AT') || 0);
    if (now - lastMail < NTFY_MAIL_EVERY) err = '';
    else if (quota_() < recipients_() + MAIL_RESERVE) err = 'Gmail’s daily email limit is nearly used up: the push waits';
    else {
      try { pushMail_(cfg, topic, left, many); props.setProperty('INV_NTFY_MAIL_AT', String(now)); list.forEach(function (a, i) { got[i] = true; }); err = ''; via = 'mail'; }
      catch (e) { err = msg_(e); }
    }
  }
  return { got: got, err: err, via: via };
}
/* one phone push, straight to ntfy (tapping it opens the cart; a deal's, its email) */
function push_(cfg, topic, title, message, click, tags) {
  var body = { topic: topic, title: cut_(title, 200), message: utf8Cap_(message, 3500), tags: tags || ['shopping_cart'], click: click || APP_URL + '#cart' };
  var r;
  try { r = UrlFetchApp.fetch(cfg.ntfyBase + '/', { method: 'post', contentType: 'application/json', payload: ascii_(JSON.stringify(body)), muteHttpExceptions: true }); }
  catch (e) { throw away_('couldn’t reach ntfy (' + cut_(msg_(e), 80) + ')'); }
  var code = r.getResponseCode();
  if (code === 429) throw away_('ntfy answered 429 (too many messages from Google’s servers just now)');
  if (code !== 200) throw new Error('ntfy answered ' + code);
}
/* a problem reaching ntfy from Google's servers (the email way still works) */
function away_(text) { var e = new Error(text); e.away = true; return e; }
/* the pushes through ntfy's email address for the topic: one email from this Gmail account for all of them (it counts toward
   the account's emails for the day). ntfy turns it into the notification: the subject is its title, the email its words (no
   tap-to-open link that way). */
function pushMail_(cfg, topic, list, many) {
  if (quota_() < 1) throw new Error('this Gmail account’s daily email limit is used up (it resets within a day)');
  var one = list.length === 1 ? list[0] : null;
  MailApp.sendEmail({
    to: cfg.ntfyMail.replace('{topic}', topic),
    subject: cut_(one ? one.title : many ? many.title(list.length) : list.length + ' cart adds need your OK', 200),
    body: utf8Cap_(one ? one.text : list.map(function (a) { return a.short || a.title; }).join('\n'), 3500),   // (ntfy keeps 4,096 bytes)
    name: 'NLO Inventory'
  });
}
/* at most n bytes once in UTF-8, never cutting a character in half */
function utf8Cap_(s, n) {
  s = String(s == null ? '' : s);
  var b = 0, i = 0;
  for (; i < s.length; i++) {
    var c = s.charCodeAt(i);
    var w = c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xD800 && c <= 0xDBFF ? 4 : c >= 0xDC00 && c <= 0xDFFF ? 0 : 3; // (a pair: 4 for both halves)
    if (b + w > n) break;
    b += w;
  }
  return s.slice(0, i);
}

function buildMessage_(events) {
  events = events.slice().sort(function (a, b) { return (Number(a.at) || 0) - (Number(b.at) || 0); });
  var parts = events.map(describe_);
  var subject;
  if (parts.length === 1) subject = parts[0].subject;
  else {
    var counts = {}, order = [];
    events.forEach(function (e) { var t = TYPE_INFO[e.t] ? e.t : 'other'; if (!counts[t]) { counts[t] = 0; order.push(t); } counts[t]++; });
    var words = { cart: ['added to cart', 'added to cart'], ordered: ['open order', 'open orders'],
      reopened: ['reopened', 'reopened'], received: ['received', 'received'], other: ['update', 'updates'] };
    subject = 'Inventory: ' + order.map(function (t) { return counts[t] + ' ' + words[t][counts[t] === 1 ? 0 : 1]; }).join(', ');
  }
  if (events.some(function (e) { return e.test; })) subject = 'TEST — ' + subject;
  var html = wrapHtml_(parts.map(function (p) { return p.html; }).join(''));
  var text = parts.map(function (p) { return p.text; }).join('\n\n') + '\n\nOpen NLO Inventory: ' + APP_URL;
  return { subject: subject, html: html, text: text };
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
    headline = e.note === 'changed' ? (by || 'Someone') + ' changed ' + what + ' in the cart (it needs your OK again)' : (by || 'Someone') + ' added ' + what + ' to the cart';
    subject = (e.note === 'changed' ? 'Changed in the cart: ' : 'Added to cart: ') + what;
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
  c.ntfyBase = String(c.ntfyBase || 'https://ntfy.sh').replace(/\/+$/, '');
  // ntfy's email address for a topic (ntfy.sh's: ntfy-<topic>@ntfy.sh); '' for a server without one
  c.ntfyMail = c.ntfyMail != null ? String(c.ntfyMail) : c.ntfyBase === 'https://ntfy.sh' ? 'ntfy-{topic}@ntfy.sh' : '';
  c.aiBase = String(c.aiBase || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
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
