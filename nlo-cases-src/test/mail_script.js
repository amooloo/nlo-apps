// Tests for the Apps Script email forwarder (mail/nlo-cases-mail.gs) without Google: its encryption against the
// app's own Crypto (WebCrypto), and a full run against a fake Firestore. Made-up patients only.
//   node test/mail_script.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');
const { makeGas } = require('./gas');

let pass = 0, fail = 0;
const check = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

// the app's Crypto object, straight from src/core.js
const app = vm.createContext({ crypto: webcrypto, TextEncoder, TextDecoder, btoa, atob, console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'core.js'), 'utf8') + '\nthis.Crypto = Crypto; this.TD = TD;', app);
const AppCrypto = app.Crypto;

(async () => {
  console.log('\n# Encryption: the script seals, the app opens');
  const pair = await AppCrypto.newPair(), pub = await AppCrypto.pubJwk(pair);
  const g0 = makeGas();
  const S = g0.ctx.NLOSeal, rand = g0.ctx.rand_;
  let allOk = true;
  const samples = ['', 'a', 'x'.repeat(15), 'y'.repeat(16), 'z'.repeat(17), 'Patient Name: Dana Exampleton — José Ñúñez 🦷 “quotes”', 'line\n'.repeat(400), JSON.stringify({ html: '<td>Robin T.</td>'.repeat(3000) })];
  for (const msg of samples) {
    const info = 'inbox:m' + 'a'.repeat(40);
    const box = S.sealTo(pub, S.utf8(msg), info, rand);
    let out = null; try { out = new TextDecoder().decode(await AppCrypto.openFrom(pair.privateKey, box, info)); } catch (e) { out = 'ERR ' + e.message; }
    if (out !== msg) { allOk = false; console.log('    mismatch at length', msg.length); }
  }
  check(allOk, 'every sample (empty to 90 KB, accents, emoji) opens with the app’s Crypto.openFrom');
  const box1 = S.sealTo(pub, S.utf8('same'), 'inbox:x', rand), box2 = S.sealTo(pub, S.utf8('same'), 'inbox:x', rand);
  check(box1.ct !== box2.ct && box1.epk.x !== box2.epk.x && box1.iv !== box2.iv, 'each seal uses a fresh one-time key and IV');
  let wrongInfo = false; try { await AppCrypto.openFrom(pair.privateKey, box1, 'inbox:y'); } catch (e) { wrongInfo = true; }
  check(wrongInfo, 'a sealed email only opens under its own inbox id (moving it to another id fails)');
  const tampered = Object.assign({}, box1, { ct: box1.ct.slice(0, -4) + (box1.ct.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA') });
  let tamperFail = false; try { await AppCrypto.openFrom(pair.privateKey, tampered, 'inbox:x'); } catch (e) { tamperFail = true; }
  check(tamperFail, 'a changed byte makes it unreadable (GCM tag)');
  check(g0.ctx.rand_(64).every(b => b >= 0 && b < 256) && new Set(g0.ctx.rand_(64)).size > 40, 'random bytes look random');
  let badKey = false; try { S.sealTo({ kty: 'EC', crv: 'P-256', x: pub.x, y: pub.x }, [1], 'i', rand); } catch (e) { badKey = /curve/.test(e.message); }
  check(badKey, 'refuses a public key that is not on the curve');

  console.log('\n# A full run against a fake NLO Cases');
  const NOW = Date.now(), H = 3600e3;
  const msgs = [
    { id: 'g1', date: NOW - 2 * H, from: 'uLab Systems <noreply@ulabsystems.com>', subject: 'Your uLab order TST11 has shipped.', text: 'Order Number: TST11\nPatient Name: Dana Exampleton\nClick here to track your order: 123456789012', html: '<html><head><style>p{color:red}</style></head><body><p>Order Number: TST11</p><script>x()</script><a href="https://www.fedex.com/fedextrack/?trknbr=123456789012" style="x">123456789012</a></body></html>' },
    { id: 'g2', date: NOW - H, from: 'general@partnersdentalstudio.com', subject: 'Daily Cases Received, Shipped, and Held', text: '', html: '<table><tr><th>Patient Name</th><th>Invoice Number</th><th>Tracking Number</th><th>Carrier</th></tr><tr><td>Robin T.</td><td>4242</td><td>1Z999AA10123456784</td><td>UPS</td></tr></table>' },
    { id: 'g3', date: NOW - H, from: 'Someone <friend@example.com>', subject: 'Lunch?', text: 'not a lab email' },
    { id: 'g4', date: NOW - H, from: 'Labs <updates@speciallab.example>', subject: 'Case update', text: 'labeled by Amir', labels: ['Lab Update'] },
    { id: 'g5', date: NOW - 40 * 86400e3, from: 'noreply@ulabsystems.com', subject: 'Old', text: 'too old' }
  ];
  const writes = [], beats = []; let signIns = 0, failSignIn = false;
  const fake = (url, opt) => {
    const res = (code, obj) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(obj) });
    if (/accounts:signInWithPassword/.test(url)) { signIns++; return failSignIn ? res(400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } }) : res(200, { idToken: 'tok-' + signIns }); }
    if (/documents\/meta\/inbox$/.test(url)) return res(200, { fields: { kid: { stringValue: 'k1' }, pub: { mapValue: { fields: { kty: { stringValue: 'EC' }, crv: { stringValue: 'P-256' }, x: { stringValue: pub.x }, y: { stringValue: pub.y } } } },
      senders: { arrayValue: { values: [{ stringValue: 'ulabsystems.com' }, { stringValue: 'partnersdentalstudio.com' }] } } } });
    if (/documents:commit$/.test(url)) {
      const w = JSON.parse(opt.payload).writes[0];
      if (/\/mailbeat\//.test(w.update.name)) { beats.push(w); return res(200, {}); }
      if (writes.some(x => x.update.name === w.update.name)) return res(409, { error: { status: 'ALREADY_EXISTS' } });
      writes.push(w); return res(200, {});
    }
    return res(404, {});
  };
  const cfg = { apiKey: 'k', projectId: 'demo-nlo-cases', botEmail: 'mailbot.x@staff.example', botPassword: 'pw' };
  const g = makeGas({ messages: msgs, fetch: fake, user: 'office@example.com', config: cfg });
  const r = g.ctx.setup();
  check(/3 emails sent/.test(r), 'setup checks the mail right away: 3 lab emails sent (' + r + ')');
  check(g.triggers.length === 1 && g.triggers[0].fn === 'checkMail' && g.triggers[0].n === 10, 'and turns on a check every 10 minutes');
  check(/from:ulabsystems\.com/.test(g.GmailApp.lastQuery) && /from:partnersdentalstudio\.com/.test(g.GmailApp.lastQuery) && /label:lab-update/.test(g.GmailApp.lastQuery), 'it looks for the senders NLO Cases lists, plus the "Lab Update" label');
  const ids = writes.map(w => w.update.name.split('/').pop());
  check(ids.every(id => /^m[0-9a-f]{40}$/.test(id)) && writes.every(w => w.currentDocument && w.currentDocument.exists === false && w.updateTransforms[0].setToServerValue === 'REQUEST_TIME'), 'each email is a new inbox item with a hashed id and the server’s time');
  check(writes.every(w => Object.keys(w.update.fields).sort().join() === 'ct,epk,iv,kid'), 'an inbox item holds only the sealed email (no names, subjects or senders in the clear)');
  const opened = [];
  for (const w of writes) {
    const f = w.update.fields, id = w.update.name.split('/').pop(), e = f.epk.mapValue.fields;
    const sealedBox = { epk: { kty: e.kty.stringValue, crv: e.crv.stringValue, x: e.x.stringValue, y: e.y.stringValue }, iv: f.iv.stringValue, ct: f.ct.stringValue };
    opened.push(JSON.parse(new TextDecoder().decode(await AppCrypto.openFrom(pair.privateKey, sealedBox, 'inbox:' + id))));
  }
  const u = opened.find(m => m.id === 'g1');
  check(!!u && u.subject === 'Your uLab order TST11 has shipped.' && /Patient Name: Dana Exampleton/.test(u.text) && u.box === 'office@example.com', 'the app opens each one: sender, subject and text arrive intact');
  check(!!u && !/<style|<script|color:red|style=/.test(u.html) && /<a href="https:\/\/www\.fedex\.com\/fedextrack\/\?trknbr=123456789012">/.test(u.html), 'the HTML is slimmed to text, tables and link addresses');
  check(opened.some(m => m.id === 'g2') && opened.some(m => m.id === 'g4') && !opened.some(m => m.id === 'g3'), 'lab senders and "Lab Update" emails go; personal email doesn’t');
  check(!opened.some(m => m.id === 'g5'), 'emails older than the first look-back (two weeks) are left alone');
  check(beats.length >= 1 && beats[beats.length - 1].update.fields.sent.integerValue === '3' && beats[beats.length - 1].update.fields.box.stringValue === 'office@example.com', 'it notes the check (3 sent) for Team & security');
  const n0 = writes.length; g.ctx.checkMail();
  check(writes.length === n0, 'the next check sends nothing twice');
  msgs.push({ id: 'g6', date: Date.now(), from: 'Oliv Doctors <doctor@olivortho.com>', subject: 'Oliv™: D. Exampleton (500123) setup is ready', text: 'x' });
  msgs.push({ id: 'g7', date: Date.now(), from: 'noreply@ulabsystems.com', subject: 'Your uLab order TST12 has shipped.', text: 'Order Number: TST12' });
  g.ctx.checkMail();
  check(writes.length === n0 + 1, 'a new email from a listed sender goes on the next check (Oliv isn’t on this office’s list yet, so it waits)');
  g.ctx.setup(); check(g.triggers.length === 1, 'running setup again keeps a single 10-minute check');
  g.ctx.stop(); check(g.triggers.length === 0, 'stop turns the check off');

  console.log('\n# When something is wrong');
  const g2 = makeGas({ messages: msgs, fetch: fake, config: cfg }); failSignIn = true;
  let threw = 0; for (let i = 0; i < 4; i++) { try { g2.ctx.checkMail(); } catch (e) { threw++; } }
  check(threw === 4, 'a refused sign-in stops the run (nothing sent)');
  check(g2.mails.length === 1 && /need a look/.test(g2.mails[0].subject) && !/Exampleton/.test(g2.mails[0].body), 'after 3 failures in a row it emails the mailbox once (no patient details in it)');
  failSignIn = false;
  const g3 = makeGas({ messages: [], fetch: fake, config: null });
  let noCfg = ''; try { g3.ctx.setup(); } catch (e) { noCfg = e.message; }
  check(/Copy the script again/.test(noCfg), 'a copy without the NLO Cases login says to copy the script again');

  console.log('\nPASS ' + pass + '  FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
