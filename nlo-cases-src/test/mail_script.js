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

  console.log('\n# Front-desk emails (8 Oct 2026): a case not shipped in time');
  {
    const store = { notify: null, outbox: [], deletes: [], beats: [], outboxCode: 200, toMail: null };
    const mapOf = o => ({ mapValue: { fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) }])) } });
    const fk = (url, opt) => {
      const res = (code, obj) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(obj) });
      if (/accounts:signInWithPassword/.test(url)) return res(200, { idToken: 'tok' });
      if (/documents\/meta\/inbox$/.test(url)) {
        const fields = { kid: { stringValue: 'k1' }, pub: { mapValue: { fields: { kty: { stringValue: 'EC' }, crv: { stringValue: 'P-256' }, x: { stringValue: pub.x }, y: { stringValue: pub.y } } } }, senders: { arrayValue: { values: [] } } };
        if (store.notify) fields.notify = mapOf(store.notify);
        return res(200, { fields });
      }
      if (/documents\/meta\/toMail$/.test(url)) return store.toMailCode && store.toMailCode !== 200 ? res(store.toMailCode, { error: { status: 'UNAVAILABLE' } })
        : store.toMail ? res(200, { fields: { scrubs: { stringValue: store.toMail } } }) : res(404, { error: { status: 'NOT_FOUND' } });
      if (/documents\/outbox\?pageSize=/.test(url)) return store.outboxCode === 200 ? res(200, { documents: store.outbox.filter(d => !store.deletes.includes(d.name)) }) : res(store.outboxCode, { error: { status: 'PERMISSION_DENIED' } });
      if (/documents:commit$/.test(url)) {
        const w = JSON.parse(opt.payload).writes[0];
        if (w.delete) { store.deletes.push(w.delete); return res(200, {}); }
        if (/\/mailbeat\//.test(w.update.name)) { store.beats.push(w); return res(200, {}); }
        return res(200, {});
      }
      return res(404, {});
    };
    const gf = makeGas({ messages: [], fetch: fk, user: 'records@example.com', config: cfg });
    gf.ctx.setup();
    const k = JSON.parse(gf.props.get('NLO_KEY') || 'null'), box = 'b' + gf.ctx.NLOSeal.sha256hex('records@example.com').slice(0, 32);
    const bf = store.beats[store.beats.length - 1].update.fields;
    check(!!k && /^[0-9a-f]{64}$/.test(k.d) && bf.pub && bf.pub.mapValue.fields.x.stringValue === k.pub.x && store.beats[store.beats.length - 1].update.name.endsWith('/mailbeat/' + box),
      'setup makes the script’s own key and its check-in shows the public half (the private half stays in the script’s properties)');
    const k0 = gf.props.get('NLO_KEY'); gf.ctx.setup(); check(gf.props.get('NLO_KEY') === k0, 'running setup again keeps the same key');
    // NLO Cases (WebCrypto) seals a note to that key, the way the app does
    const noteDoc = async (id, msg, forBox, kpub) => {
      const sealedNote = await AppCrypto.sealTo(kpub || k.pub, new TextEncoder().encode(JSON.stringify(msg)), 'outbox:' + id);
      return { name: 'projects/demo-nlo-cases/databases/(default)/documents/outbox/' + id, fields: { box: { stringValue: forBox || box },
        epk: { mapValue: { fields: { kty: { stringValue: 'EC' }, crv: { stringValue: 'P-256' }, x: { stringValue: sealedNote.epk.x }, y: { stringValue: sealedNote.epk.y } } } },
        iv: { stringValue: sealedNote.iv }, ct: { stringValue: sealedNote.ct } } };
    };
    const subj = 'Not shipped: Dana Exampleton — delivery appt Thu, Oct 10', body = 'Dana Exampleton’s Herbst (Specialty Orthodontic Lab) isn’t marked shipped.\n🦷 Check with the lab, or reschedule.';
    store.outbox.push(await noteDoc('o' + '1'.repeat(32), { v: 1, subject: subj, text: body, to: 'someone-else@example.com' }));
    store.outbox.push(await noteDoc('o' + '2'.repeat(32), { v: 1, subject: 'For the other mailbox', text: 'x' }, 'b' + 'f'.repeat(32)));
    gf.mails.length = 0; gf.ctx.checkMail();
    check(gf.mails.length === 0, 'off (or never turned on): nothing is sent');
    store.notify = { on: true, to: 'Questions@frontdesk.example', box, names: true };
    const r1 = gf.ctx.checkMail();
    check(gf.mails.length === 1 && gf.mails[0].to === 'Questions@frontdesk.example' && gf.mails[0].subject === subj && gf.mails[0].body === body && gf.mails[0].opts && gf.mails[0].opts.name === 'NLO Cases',
      'on: the note is opened and emailed to the front-desk address, word for word, from “NLO Cases” (' + r1 + ')');
    check(!gf.mails.some(m => m.to === 'someone-else@example.com'), 'it goes only to the address the owner set (whatever a note says)');
    check(store.deletes.length === 1 && store.deletes[0].endsWith('/outbox/o' + '1'.repeat(32)), 'the note is removed once it’s sent; the other mailbox’s note is left for it');
    gf.ctx.checkMail(); check(gf.mails.length === 1, 'the next check sends nothing twice');
    store.deletes.length = 0; store.outbox = store.outbox.filter(d => d.name.endsWith('o' + '1'.repeat(32))); // (as if the removal didn't go through)
    gf.ctx.checkMail(); check(gf.mails.length === 1 && store.deletes.length === 1, '…even when removing it failed the first time (it’s removed, not sent again)');
    store.outbox = [];
    const other = await AppCrypto.pubJwk(await AppCrypto.newPair());
    store.outbox.push(await noteDoc('o' + '3'.repeat(32), { v: 1, subject: 'x', text: 'y' }, box, other));
    const n3 = await noteDoc('o' + '4'.repeat(32), { v: 1, subject: 'x', text: 'y' }); n3.fields.ct.stringValue = n3.fields.ct.stringValue.slice(0, -6) + (n3.fields.ct.stringValue.slice(-6, -2) === 'AAAA' ? 'BBBB' : 'AAAA') + n3.fields.ct.stringValue.slice(-2);
    store.outbox.push(n3);
    gf.ctx.checkMail();
    const lastErr = store.beats[store.beats.length - 1].update.fields.err.stringValue;
    check(gf.mails.length === 1 && /couldn’t be opened/.test(lastErr), 'a note locked with another key, or changed, isn’t sent — the check-in says so (' + lastErr + ')');
    store.outbox = [await noteDoc('o' + '5'.repeat(32), { v: 1, subject: 's', text: 't' })];
    store.notify = { on: true, to: 'Questions@frontdesk.example', box: 'b' + 'f'.repeat(32), names: true };
    gf.ctx.checkMail(); check(gf.mails.length === 1, 'when the owner picks another mailbox, this one sends nothing');
    store.notify = { on: false, to: 'Questions@frontdesk.example', box, names: true };
    gf.ctx.checkMail(); check(gf.mails.length === 1, 'turned off: nothing is sent');
    store.notify = { on: true, to: 'Questions@frontdesk.example', box, names: true }; store.outboxCode = 403;
    let crashed = false; try { gf.ctx.checkMail(); } catch (e) { crashed = true; }
    check(!crashed && gf.mails.length === 1, 'security rules older than the front-desk email: the lab emails still go, no front-desk emails');
    store.outboxCode = 200; gf.ctx.checkMail();
    check(gf.mails.length === 2 && gf.mails[1].subject === 's', 'once they’re published, the waiting note goes out');

    console.log('\n# Scrubs orders from NLO Time Off (v3, 9 Oct 2026)');
    check(gf.ctx.VERSION === '3', 'the script says it’s version 3 (NLO Time Off waits for it before sending orders)');
    const before = gf.mails.length;
    store.outbox = [await noteDoc('o' + '6'.repeat(32), { kind: 'scrubs', subject: 'Scrubs order: Riley — 2 pairs', text: 'Pair 1: Navy · top and bottom · M · petite', to: 'someone-else@example.com' })];
    gf.ctx.checkMail();
    check(gf.mails.length === before && store.deletes.some(d => d.endsWith('/outbox/o' + '6'.repeat(32))), 'with no address set in Time Off: not sent (and not to the front desk)');
    store.toMail = 'community@office.example';
    store.outbox = [await noteDoc('o' + '7'.repeat(32), { kind: 'scrubs', subject: 'Scrubs order: Riley — 2 pairs', text: 'Pair 1: Navy · top and bottom · M · petite', to: 'someone-else@example.com' }),
      await noteDoc('o' + '8'.repeat(32), { v: 1, subject: 'Not shipped', text: 'x' })];
    gf.ctx.checkMail();
    const sc = gf.mails.slice(before);
    check(sc.length === 2 && sc[0].to === 'community@office.example' && sc[0].opts.name === 'NLO Time Off' && /Navy · top and bottom/.test(sc[0].body) && sc[1].to === 'Questions@frontdesk.example',
      'a scrubs order goes to the address Dr. A set in Time Off (from “NLO Time Off”); the front-desk note still goes to the front desk');
    check(!gf.mails.some(m => m.to === 'someone-else@example.com'), '…never to an address the note names');
    store.toMail = 'not an address'; store.outbox = [await noteDoc('o' + '9'.repeat(32), { kind: 'scrubs', subject: 's', text: 't' })];
    const b2 = gf.mails.length; gf.ctx.checkMail(); check(gf.mails.length === b2, 'an address that isn’t one: nothing is sent');
    // the address can't be read just then (an outage): the order waits — kept, not sent, not dropped — and goes out later
    store.toMail = 'community@office.example'; store.toMailCode = 503;
    store.outbox = [await noteDoc('o' + 'a'.repeat(32), { kind: 'scrubs', subject: 'Scrubs order: Riley — 1 pair', text: 'Pair 1: Gray · top · L' }), await noteDoc('o' + 'b'.repeat(32), { v: 1, subject: 'Not shipped 2', text: 'y' })];
    const b3 = gf.mails.length; gf.ctx.checkMail();
    const err3 = store.beats[store.beats.length - 1].update.fields.err.stringValue;
    check(gf.mails.length === b3 + 1 && gf.mails[b3].subject === 'Not shipped 2' && !store.deletes.some(d => d.endsWith('/outbox/o' + 'a'.repeat(32))) && /scrubs order waiting/.test(err3),
      'the address can’t be read just then: the order waits (kept, not sent) and the check-in says so; the front-desk note still goes (' + err3 + ')');
    store.toMailCode = 200; gf.ctx.checkMail();
    const err4 = store.beats[store.beats.length - 1].update.fields.err.stringValue;
    check(gf.mails.length === b3 + 2 && gf.mails[b3 + 1].to === 'community@office.example' && gf.mails[b3 + 1].subject === 'Scrubs order: Riley — 1 pair' && store.deletes.some(d => d.endsWith('/outbox/o' + 'a'.repeat(32))) && err4 === '',
      '…and goes out at the next check, then it’s removed and the problem clears');
    gf.ctx.checkMail(); check(gf.mails.length === b3 + 2, '…once');
    // an address Gmail won't take (it passes the format check): that order waits, and the front-desk notes behind it still go
    const realSend = gf.ctx.MailApp.sendEmail;
    gf.ctx.MailApp.sendEmail = (to, subject, body, opts) => { if (/,/.test(to)) throw new Error('Invalid email: ' + to); return realSend(to, subject, body, opts); };
    store.toMail = 'first,last@office.example';
    store.outbox = [await noteDoc('o' + 'c'.repeat(32), { kind: 'scrubs', subject: 'Scrubs order: Taylor — 1 pair', text: 'Pair 1: Black · bottom · S' }), await noteDoc('o' + 'd'.repeat(32), { v: 1, subject: 'Not shipped 3', text: 'z' })];
    const b5 = gf.mails.length; gf.ctx.checkMail();
    const err5 = store.beats[store.beats.length - 1].update.fields.err.stringValue;
    check(gf.mails.length === b5 + 1 && gf.mails[b5].subject === 'Not shipped 3' && !store.deletes.some(d => d.endsWith('/outbox/o' + 'c'.repeat(32))) && /Gmail wouldn’t send \(Invalid email/.test(err5),
      'an address Gmail won’t send to: that order waits, the front-desk note after it still goes, and the check-in says why (' + err5 + ')');
    store.toMail = 'community@office.example'; gf.ctx.checkMail();
    check(gf.mails.length === b5 + 2 && gf.mails[b5 + 1].to === 'community@office.example' && gf.mails[b5 + 1].subject === 'Scrubs order: Taylor — 1 pair' && store.beats[store.beats.length - 1].update.fields.err.stringValue === '',
      '…once the address is fixed, it goes out at the next check');
    gf.ctx.MailApp.sendEmail = realSend;
  }

  console.log('\nPASS ' + pass + '  FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
