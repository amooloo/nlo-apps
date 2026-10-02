/* =====================================================================
   NLO Cases — lab email updates (Google Apps Script)

   Every 10 minutes this script looks in this Gmail account for lab emails (uLab, Partners Dental Studio,
   Oliv, Angel, and anything labeled "Lab Update"), locks each one with NLO Cases' inbox key so only the
   app can open it, and drops it in the app's inbox. The next time anyone has NLO Cases open, the app reads
   it and updates the case. This script can't see any case, and nobody else can read what it sends.

   Turn on:  pick "setup" next to Run (top bar), press Run, and allow access.
   Turn off: pick "stop", press Run.
   ===================================================================== */
var VERSION = '1';
var CONFIG = /*NLO_CONFIG*/null; // filled in by NLO Cases when you copy the script
var DAY = 86400000;
var DEFAULT_SENDERS = ['ulabsystems.com', 'partnersdentalstudio.com', 'olivortho.com', 'angelaligner.com', 'angelalign.com'];

/* Run once: checks the encryption, turns on the 10-minute check, and checks right away. */
function setup() {
  if (!CONFIG || !CONFIG.botEmail || !CONFIG.botPassword) throw new Error('This copy has no NLO Cases login in it. Copy the script again from NLO Cases → Team & security → Email updates.');
  selfTest_();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('NLO_CFG', JSON.stringify(CONFIG));
  if (!props.getProperty('NLO_SINCE')) props.setProperty('NLO_SINCE', String(Date.now() - 14 * DAY)); // first time: the last two weeks
  props.setProperty('NLO_FAILS', '0');
  CacheService.getScriptCache().removeAll(['NLO_TOK', 'NLO_OFFICE']);
  stopTriggers_();
  ScriptApp.newTrigger('checkMail').timeBased().everyMinutes(10).create();
  var r = checkMail();
  Logger.log('NLO Cases email updates are on for ' + mailbox_() + ' (' + r + '). NLO Cases → Team & security shows each check.');
  return r;
}

/* Turns the 10-minute check off. */
function stop() {
  stopTriggers_();
  Logger.log('NLO Cases email updates are off for ' + mailbox_() + '. Run setup to turn them back on.');
}

/* Runs every 10 minutes. */
function checkMail() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return 'busy';
  var props = PropertiesService.getScriptProperties(), cfg = null;
  try {
    cfg = cfg_(props);
    var r = run_(cfg, props);
    props.setProperty('NLO_FAILS', '0');
    return r;
  } catch (e) {
    var n = Number(props.getProperty('NLO_FAILS') || 0) + 1;
    props.setProperty('NLO_FAILS', String(n));
    try { if (cfg) beat_(cfg, session_(cfg), 0, 0, String((e && e.message) || e)); } catch (x) { }
    if (n >= 3) warn_(props, e);
    throw e;
  } finally { lock.releaseLock(); }
}

function run_(cfg, props) {
  var s = session_(cfg);
  var since = Number(props.getProperty('NLO_SINCE')) || (Date.now() - 14 * DAY);
  var seen = JSON.parse(props.getProperty('NLO_SEEN') || '{}');
  var senders = (s.office.senders && s.office.senders.length) ? s.office.senders : DEFAULT_SENDERS;
  var q = '{' + senders.map(function (d) { return 'from:' + d; }).join(' ') + ' label:lab-update} after:' + Math.floor((since - 2 * DAY) / 1000);
  var threads = GmailApp.search(q, 0, 100), box = mailbox_(), started = Date.now(), looked = 0, sent = 0, finished = true;
  outer:
  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i], id = m.getId();
      if (seen[id] || m.getDate().getTime() < since - 2 * DAY) continue;
      if (Date.now() - started > 4 * 60 * 1000) { finished = false; break outer; } // well inside Apps Script's 6-minute limit
      looked++;
      var mail = { v: 1, box: box, id: id, from: m.getFrom(), to: m.getTo(), subject: m.getSubject(), date: m.getDate().getTime(),
        text: cap_(m.getPlainBody(), 40000), html: cap_(slim_(m.getBody()), 120000) };
      var docId = 'm' + NLOSeal.sha256hex(box + '|' + id).slice(0, 40);
      var sealed = NLOSeal.sealTo(s.office.pub, NLOSeal.utf8(JSON.stringify(mail)), 'inbox:' + docId, rand_);
      put_(cfg, s, docId, sealed);
      seen[id] = Date.now(); sent++;
      props.setProperty('NLO_SEEN', JSON.stringify(seen)); // progress survives a later failure
    }
  }
  var keep = {}, cut = Date.now() - 30 * DAY;
  Object.keys(seen).forEach(function (k) { if (seen[k] > cut) keep[k] = seen[k]; });
  props.setProperty('NLO_SEEN', JSON.stringify(keep));
  if (finished) props.setProperty('NLO_SINCE', String(started));
  beat_(cfg, s, looked, sent, '');
  return sent + ' email' + (sent === 1 ? '' : 's') + ' sent to NLO Cases';
}

/* ---------- NLO Cases (Firebase) ---------- */
function cfg_(props) {
  var c = JSON.parse(props.getProperty('NLO_CFG') || 'null') || CONFIG;
  if (!c || !c.botEmail) throw new Error('Not set up yet: run setup.');
  c.authBase = c.authBase || 'https://identitytoolkit.googleapis.com/v1';
  c.fsBase = c.fsBase || 'https://firestore.googleapis.com/v1';
  return c;
}
function http_(cfg, method, url, body, tok) {
  var opt = { method: method, muteHttpExceptions: true, headers: { Referer: cfg.referer || 'https://amooloo.github.io/nlo-apps/nlo-cases.html' } };
  if (tok) opt.headers.Authorization = 'Bearer ' + tok;
  if (body != null) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  var r = UrlFetchApp.fetch(url, opt), code = r.getResponseCode(), text = r.getContentText(), json = null;
  try { json = JSON.parse(text); } catch (e) { }
  return { code: code, json: json, text: text };
}
function docName_(cfg, path) { return 'projects/' + cfg.projectId + '/databases/(default)/documents/' + path; }
/* sign in as the robot and fetch the inbox key; both kept for 45 minutes */
function session_(cfg, fresh) {
  var cache = CacheService.getScriptCache();
  var tok = !fresh && cache.get('NLO_TOK'), office = !fresh && cache.get('NLO_OFFICE');
  if (tok && office) return { tok: tok, office: JSON.parse(office) };
  var a = http_(cfg, 'post', cfg.authBase + '/accounts:signInWithPassword?key=' + encodeURIComponent(cfg.apiKey), { email: cfg.botEmail, password: cfg.botPassword, returnSecureToken: true });
  if (a.code !== 200 || !a.json || !a.json.idToken) throw new Error('NLO Cases sign-in failed (' + a.code + ' ' + ((a.json && a.json.error && a.json.error.message) || '') + '). If the robot login was turned off in NLO Cases, copy the script again.');
  tok = a.json.idToken;
  var g = http_(cfg, 'get', cfg.fsBase + '/' + docName_(cfg, 'meta/inbox'), null, tok);
  if (g.code !== 200 || !g.json || !g.json.fields) throw new Error('Could not read the NLO Cases inbox key (' + g.code + '). The robot login may have been turned off.');
  var f = g.json.fields, pf = f.pub.mapValue.fields;
  office = { kid: f.kid.stringValue, pub: { kty: pf.kty.stringValue, crv: pf.crv.stringValue, x: pf.x.stringValue, y: pf.y.stringValue },
    senders: ((f.senders && f.senders.arrayValue && f.senders.arrayValue.values) || []).map(function (v) { return v.stringValue; }) };
  cache.put('NLO_TOK', tok, 45 * 60); cache.put('NLO_OFFICE', JSON.stringify(office), 45 * 60);
  return { tok: tok, office: office };
}
function commit_(cfg, s, writes) {
  var url = cfg.fsBase + '/projects/' + cfg.projectId + '/databases/(default)/documents:commit';
  var r = http_(cfg, 'post', url, { writes: writes }, s.tok);
  if (r.code === 401 || r.code === 403) { // token expired or key changed: sign in again once
    var s2 = session_(cfg, true); s.tok = s2.tok; s.office = s2.office;
    r = http_(cfg, 'post', url, { writes: writes }, s.tok);
  }
  return r;
}
function put_(cfg, s, docId, sealed) {
  var w = { update: { name: docName_(cfg, 'inbox/' + docId), fields: {
    kid: { stringValue: s.office.kid },
    epk: { mapValue: { fields: { kty: { stringValue: sealed.epk.kty }, crv: { stringValue: sealed.epk.crv }, x: { stringValue: sealed.epk.x }, y: { stringValue: sealed.epk.y } } } },
    iv: { stringValue: sealed.iv }, ct: { stringValue: sealed.ct } } },
    currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }] };
  var r = commit_(cfg, s, [w]);
  if (r.code === 200) return;
  if (/ALREADY_EXISTS|FAILED_PRECONDITION/.test(r.text)) return; // sent before
  throw new Error('NLO Cases inbox refused an email (' + r.code + ').');
}
function beat_(cfg, s, looked, sent, err) {
  var box = mailbox_();
  commit_(cfg, s, [{ update: { name: docName_(cfg, 'mailbeat/b' + NLOSeal.sha256hex(box).slice(0, 32)), fields: {
    box: { stringValue: box.slice(0, 120) }, seen: { integerValue: String(looked) }, sent: { integerValue: String(sent) },
    err: { stringValue: String(err || '').slice(0, 290) }, ver: { stringValue: VERSION } } },
    updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }] }]);
}

/* ---------- helpers ---------- */
function mailbox_() { try { return Session.getEffectiveUser().getEmail() || 'this account'; } catch (e) { return 'this account'; } }
function cap_(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) : s; }
/* keep only what the app needs to read an email: text, tables, line breaks and link addresses */
function slim_(h) {
  return String(h || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(head|style|script|title|xml)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, function (all, close, tag, attrs) {
      tag = tag.toLowerCase();
      if (!/^(a|p|br|div|span|table|thead|tbody|tr|td|th|h[1-6]|li|ul|ol|b|strong|em|i)$/.test(tag)) return ' ';
      if (tag === 'a' && !close) {
        var m = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs || '');
        return '<a href="' + String(m ? (m[2] || m[3] || '') : '').replace(/"/g, '&quot;') + '">';
      }
      return '<' + close + tag + '>';
    })
    .replace(/\s+/g, ' ');
}
/* random bytes: Apps Script has no crypto.getRandomValues, so hash fresh random UUIDs (SecureRandom underneath) */
var RAND_N_ = 0;
function rand_(n) {
  var out = [];
  while (out.length < n) {
    var seed = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid() + '|' + Date.now() + '|' + Math.random() + '|' + (RAND_N_++);
    var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed, Utilities.Charset.UTF_8);
    for (var i = 0; i < d.length && out.length < n; i++) out.push(d[i] & 255);
  }
  return out;
}
function stopTriggers_() { ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'checkMail') ScriptApp.deleteTrigger(t); }); }
function warn_(props, e) {
  var last = Number(props.getProperty('NLO_WARNED') || 0);
  if (Date.now() - last < DAY) return;
  props.setProperty('NLO_WARNED', String(Date.now()));
  try {
    MailApp.sendEmail(mailbox_(), 'NLO Cases: lab email updates need a look',
      'The NLO Cases email script in this Gmail account has failed 3 times in a row, so lab emails are not reaching NLO Cases.\n\n' +
      'Error: ' + String((e && e.message) || e).slice(0, 300) + '\n\n' +
      'To fix it: NLO Cases → Team & security → Email updates → Get the script, paste it over this one, and run setup again.\n' +
      'To turn it off instead: open script.google.com, open this project, pick "stop" and press Run.');
  } catch (x) { }
}
/* the encryption must give exactly what the browser's WebCrypto gives (values made with WebCrypto by tools/build-mail.js) */
function selfTest_() {
  var K = /*NLO_KAT*/null;
  if (!K) return;
  var ok = NLOSeal.hex(NLOSeal.hkdf(NLOSeal.unhex(K.ikm), NLOSeal.unhex(K.salt), NLOSeal.unhex(K.info), 32)) === K.hkdf
    && NLOSeal.hex(NLOSeal.ecdhX(K.d, K.pub)) === K.ecdh
    && NLOSeal.hex(NLOSeal.gcm(NLOSeal.unhex(K.key), NLOSeal.unhex(K.iv), NLOSeal.unhex(K.pt), NLOSeal.unhex(K.aad))) === K.gcm;
  if (!ok) throw new Error('The encryption self-test failed in this Google account. Nothing was sent. Tell Claude: "NLO Cases email script self-test failed".');
}
