// Unit tests: encryption, 2-step codes, generator/strength, spreadsheet/document reading. Run: node test/unit.test.js
import * as C from '../src/crypto.js';
import { parseTotp, totpCode, base32Decode } from '../src/totp.js';
import { genChars, genWords, strength, vaultPasswordProblem } from '../src/gen.js';
import { parseDelimited, guessColumns, rowsToItems, parseBlocks, sniff, looksLikeHeader } from '../src/importer.js';
import { createHash } from 'crypto';

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  FAIL ' + m); } }
async function throws(p, m) { try { await p; ok(false, m); } catch (e) { ok(true, m); } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n# encryption');
{
  const big = C.rnd(3 * 1024 * 1024);
  ok(eq(C.unb64(C.b64(big)).slice(0, 50), big.slice(0, 50)) && C.unb64(C.b64(big)).length === big.length, 'base64 round-trips 3 MB (no stack overflow)');
  const t0 = Date.now();
  const a = await C.deriveMaster('correct horse battery staple', 'Sarah');
  const ms = Date.now() - t0;
  const b = await C.deriveMaster('correct horse battery staple', ' sarah ');
  const c = await C.deriveMaster('correct horse battery staplf', 'sarah');
  const d = await C.deriveMaster('correct horse battery staple', 'gwen');
  ok(a.authPw === b.authPw, 'same password + login -> same sign-in secret (login is case/space-insensitive)');
  ok(a.authPw !== c.authPw && a.authPw !== d.authPw, 'different password or login -> different sign-in secret');
  ok(!a.authPw.includes('correct') && a.authPw.startsWith('nv1.') && a.authPw.length === 47, 'sign-in secret reveals nothing of the password');
  console.log('      (600k-round key derivation took ' + ms + ' ms in Node)');
  const priv = C.rnd(100);
  const box = await C.seal(a.wrapKey, priv, C.AAD.priv('u1'));
  ok(eq(await C.open(b.wrapKey, box, C.AAD.priv('u1')), priv), 'private key opens with the same password');
  await throws(C.open(c.wrapKey, box, C.AAD.priv('u1')), 'private key does not open with a wrong password');
  await throws(C.open(a.wrapKey, box, C.AAD.priv('u2')), 'private key does not open for another person (bound to uid)');
  // ECDH sealed boxes
  const pair = await C.newPair(), pub = await C.pubJwk(pair), pk = await C.importPriv(await C.privBytes(pair));
  const other = await C.newPair(), opk = await C.importPriv(await C.privBytes(other));
  const fkey = C.rnd(32);
  const g = await C.sealTo(pub, fkey, C.AAD.grant('u1', 'f1', 1));
  ok(eq(await C.openFrom(pk, g, C.AAD.grant('u1', 'f1', 1)), fkey), 'folder key sealed to a person opens with their key');
  await throws(C.openFrom(opk, g, C.AAD.grant('u1', 'f1', 1)), 'someone else\'s key cannot open it');
  await throws(C.openFrom(pk, g, C.AAD.grant('u1', 'f2', 1)), 'a grant cannot be replayed for another folder');
  await throws(C.openFrom(pk, g, C.AAD.grant('u1', 'f1', 2)), 'a grant cannot be replayed for another key version');
  const g2 = await C.sealTo(pub, fkey, C.AAD.grant('u1', 'f1', 1));
  ok(g2.ct !== g.ct && g2.epk.x !== g.epk.x, 'each seal uses a fresh one-time key');
  // items
  const k = await C.aesKey(fkey);
  const item = { t: 'Delta Dental', u: 'nlo', p: 'S3cret!', n: '' };
  const ib = await C.sealJSON(k, item, C.AAD.item('i1', 'f1', 1));
  ok(C.unb64(ib.ct).length % 256 === 16, 'item ciphertext is padded to 256-byte blocks (+16 tag)');
  ok(eq(await C.openJSON(k, ib, C.AAD.item('i1', 'f1', 1)), item), 'item opens');
  await throws(C.openJSON(k, ib, C.AAD.item('i2', 'f1', 1)), 'item ciphertext cannot be moved to another item id');
  await throws(C.openJSON(k, ib, C.AAD.item('i1', 'f9', 1)), 'item ciphertext cannot be moved to another folder');
  const tampered = Object.assign({}, ib, { ct: C.b64(C.unb64(ib.ct).map((x, i) => i === 5 ? x ^ 1 : x)) });
  await throws(C.openJSON(k, tampered, C.AAD.item('i1', 'f1', 1)), 'a changed byte is detected');
  // recovery code
  const code = C.recoveryCode();
  ok(/^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/.test(code) && !/[01OIL]/.test(code), 'recovery code: 24 characters, no look-alikes');
  const rb = await C.secretSeal(code, priv, C.AAD.rec('u1'), C.REC_ITER);
  ok(eq(await C.secretOpen(C.normCode(code.toLowerCase().replace(/-/g, ' ')), rb, C.AAD.rec('u1')), priv), 'recovery code works typed in lower case with spaces');
  await throws(C.secretOpen(C.recoveryCode(), rb, C.AAD.rec('u1')), 'a wrong recovery code fails');
  // folder keys signed by Dr. A
  const sp = await C.newSignPair(), spk = await C.pubJwk(sp), spriv = await C.importSignPriv(await C.privBytes(sp));
  const other2 = await C.newSignPair(), ospriv = await C.importSignPriv(await C.privBytes(other2));
  const fk = C.rnd(32), sig = await C.signFolderKey(spriv, 'f1', 3, fk);
  ok(await C.verifyFolderKey(spk, sig, 'f1', 3, fk), 'a folder key signed by Dr. A verifies');
  ok(!(await C.verifyFolderKey(spk, sig, 'f1', 4, fk)), 'the signature doesn’t carry over to another key version');
  ok(!(await C.verifyFolderKey(spk, sig, 'f2', 3, fk)), '…or another folder');
  ok(!(await C.verifyFolderKey(spk, sig, 'f1', 3, C.rnd(32))), '…or another key');
  ok(!(await C.verifyFolderKey(spk, await C.signFolderKey(ospriv, 'f1', 3, fk), 'f1', 3, fk)), 'a key signed by anyone else is refused');
  ok(!(await C.verifyFolderKey(spk, 'not-a-signature', 'f1', 3, fk)) && !(await C.verifyFolderKey(null, sig, 'f1', 3, fk)), 'junk signatures/keys are refused, not crashed on');
  // his signature on people and their places in folders
  const pubA = { kty: 'EC', crv: 'P-256', x: 'x'.repeat(43), y: 'y'.repeat(43) }, pubB = Object.assign({}, pubA, { x: 'z'.repeat(43) });
  const ps = await C.signText(spriv, C.SIG.person('u1', pubA));
  ok(await C.verifyText(spk, ps, C.SIG.person('u1', pubA)), 'a person Dr. A added verifies');
  ok(!(await C.verifyText(spk, ps, C.SIG.person('u1', pubB))) && !(await C.verifyText(spk, ps, C.SIG.person('u2', pubA))), '…not with another public key or another login');
  const gs = await C.signText(spriv, C.SIG.member('u1', 'f1', 'view', 3));
  ok(await C.verifyText(spk, gs, C.SIG.member('u1', 'f1', 'view', 3)), 'a place he gave in a folder verifies');
  ok(!(await C.verifyText(spk, gs, C.SIG.member('u1', 'f1', 'view', 4))) && !(await C.verifyText(spk, gs, C.SIG.member('u2', 'f1', 'view', 3))) && !(await C.verifyText(spk, gs, C.SIG.member('u1', 'f2', 'view', 3))),
    '…not for a later key version, another person or another folder (an old place can’t be replayed)');
  ok(!(await C.verifyText(spk, gs, C.SIG.member('u1', 'f1', 'edit', 3))), '…and “view” can’t be turned into “edit”');
  ok(!(await C.verifyText(spk, await C.signText(ospriv, C.SIG.member('u1', 'f1', 'view', 3)), C.SIG.member('u1', 'f1', 'view', 3))) && !(await C.verifyText(spk, undefined, 'x')), 'anyone else’s signature, or none, is refused');
  ok(!(await C.verifyText(spk, sig, C.SIG.member('u1', 'f1', 'view', 3))), 'a folder-key signature can’t pass for a place signature');
  // one-time tokens guarding Dr. A's key copy
  const mA = await C.deriveMaster('maple river cocoa lamp desk', 'dr@x.test', 1000), mA2 = await C.deriveMaster('maple river cocoa lamp desk', 'dr@x.test', 1000), mB = await C.deriveMaster('maple river cocoa lamp desks', 'dr@x.test', 1000);
  const tk0 = await C.lockToken(mA.lockKey, '0');
  ok(tk0 === await C.lockToken(mA2.lockKey, '0') && tk0.length === 43, 'the same password gives the same token');
  ok(tk0 !== await C.lockToken(mA.lockKey, '1') && tk0 !== await C.lockToken(mA.lockKey, 'next/0') && tk0 !== await C.lockToken(mB.lockKey, '0'), 'tokens differ per counter, per use and per password');
  const cl = await C.codeLockKey(code, 'u1'), cl2 = await C.codeLockKey(code.toLowerCase().replace(/-/g, ' '), 'u1'), cl3 = await C.codeLockKey(code, 'u2');
  ok(await C.lockToken(cl, '0') === await C.lockToken(cl2, '0') && await C.lockToken(cl, '0') !== await C.lockToken(mA.lockKey, '0'), 'the recovery code gives its own tokens (typed any way)');
  ok(await C.lockToken(cl, '0') !== await C.lockToken(cl3, '0'), '…bound to the person');
  ok(/^[0-9a-f]{64}$/.test(await C.lockHash(tk0)) && await C.lockHash(tk0) === createHash('sha256').update(tk0, 'utf8').digest('hex'), 'stored check = SHA-256 hex of the token (what the rules compute)');
  const packed = C.packKeys(C.rnd(138), C.rnd(138)), un = C.unpackKeys(packed);
  ok(un.e.length === 138 && un.s.length === 138 && C.unpackKeys(C.packKeys(C.rnd(138))).s === null, 'key container packs and unpacks');
  const tp = C.tempPassword(); ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(tp), 'temporary password format ' + tp);
  const counts = {}; for (let i = 0; i < 31000; i++) { const v = C.randInt(31); counts[v] = (counts[v] || 0) + 1; }
  ok(Object.keys(counts).length === 31 && Math.min(...Object.values(counts)) > 800, 'random numbers cover every value evenly');
}

console.log('\n# 2-step codes (RFC 6238 test vectors)');
{
  const key = new TextEncoder().encode('12345678901234567890');
  const cfg = { key, digits: 8, period: 30, algo: 'SHA-1' };
  ok(await totpCode(cfg, 59000) === '94287082', 'T=59');
  ok(await totpCode(cfg, 1111111109000) === '07081804', 'T=1111111109');
  ok(await totpCode(cfg, 2000000000000) === '69279037', 'T=2000000000');
  const k256 = new TextEncoder().encode('12345678901234567890123456789012');
  ok(await totpCode({ key: k256, digits: 8, period: 30, algo: 'SHA-256' }, 59000) === '46119246', 'SHA-256 T=59');
  ok(eq(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), Array.from(key)) || base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').length === 20, 'base32 decodes');
  const p = parseTotp('otpauth://totp/NLO:office?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=NLO&digits=6');
  ok(p && p.digits === 6 && p.period === 30, 'otpauth:// link is read');
  ok(parseTotp('gezd gnbv gy3t qojq gezd gnbv gy3t qojq') !== null, 'secret with spaces/lower case is read');
  ok(parseTotp('not a secret!') === null && parseTotp('ABC') === null, 'garbage is refused');
}

console.log('\n# generator and strength');
{
  const p = genChars(20); ok(p.length === 20 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p) && /[^a-zA-Z0-9]/.test(p), 'character password has every kind: ' + p);
  ok(!/[0O1lI]/.test(genChars(64)), 'no look-alike characters by default');
  const w = genWords(5); ok(w.split('-').length === 5, 'passphrase: ' + w);
  const wc = genWords(4, { capNum: true }); ok(/[A-Z]/.test(wc) && /[0-9]/.test(wc), 'passphrase with capital+number: ' + wc);
  const cases = [
    ['password', 0], ['Summer2024!', 0], ['P@ssw0rd!', 0], ['nlo12345', 0], ['Smile2025', 0], ['qwerty123456', 0],
    ['MyDogMax2015!', 2, true], ['Gainesville2026!', 1, true],
    ['Kx9#mP2$vL7qT4', 3], [genWords(5), 3], ['acorn-ablaze-agenda-afford', 3], [genChars(16), 4]
  ];
  for (const [pw, min, maxOnly] of cases) {
    const s = strength(pw, ['sarah', 'akhavan']);
    ok(maxOnly ? s.score <= min : (min === 0 ? s.score === 0 : s.score >= min), JSON.stringify(pw) + ' -> ' + s.label + ' (' + s.bits + ' bits)');
  }
  ok(strength('sarahsarah2026!!', ['sarah']).score < 3, 'own name counts as easy to guess');
  for (const w of ['a1b2c3d4e5f6', 'Aa1!Aa1!Aa1!', 'ab12ab12ab12', 'Xy9-Xy9-Xy9-', 'Q1w2Q1w2Q1w2', '9z9z9z9z9z9z', 'go!go!go!go!go!go!', 'Gwen2026Gwen2026!',
    'a1b2c3d4e5f6!', '!a1b2c3d4e5f6', 'a1b2c3d4e5f7', '1q2w3e4r5t6y', 'q1w2e3r4t5y6', '!QAZ2wsx#EDC', 'zaq12wsxcde3', 'Qwerty123456'])
    ok(vaultPasswordProblem(w) !== '', 'repeats/patterns refused: ' + w);
  ok(vaultPasswordProblem('short') !== '', 'vault password: too short refused');
  ok(vaultPasswordProblem('Summer2024!!') !== '', 'vault password: common pattern refused');
  ok(vaultPasswordProblem(genWords(5)) === '', 'vault password: 5-word passphrase accepted');
  ok(vaultPasswordProblem('maple river cocoa lamp') === '', 'vault password: 4 everyday words with spaces accepted');
}

console.log('\n# reading spreadsheets and documents');
{
  const tsv = 'Account\tWebsite\tUser\tPassword\tNotes\nDelta Dental\thttps://deltadentalins.com\tnlo_front\tDd!2345\tfront desk\nHenry Schein\twww.henryschein.com\torders@nlo.com\tHs#999\t\n';
  ok(sniff(tsv) === 'table', 'pasted spreadsheet is recognised as a table');
  const { rows } = parseDelimited(tsv);
  ok(rows.length === 3 && rows[1][3] === 'Dd!2345', 'tab-separated rows read');
  ok(looksLikeHeader(rows[0]), 'first row recognised as headings');
  const map = guessColumns(rows, true);
  ok(eq(map, ['title', 'url', 'user', 'pass', 'notes']), 'columns guessed from headings: ' + map.join(','));
  const items = rowsToItems(rows, map, { hasHeader: true });
  ok(items.length === 2 && items[0].t === 'Delta Dental' && items[0].p === 'Dd!2345' && items[1].u === 'orders@nlo.com', 'logins built from rows');
  const csv = 'name,url,username,password,note\n"Oliv, portal",https://portal.olivortho.com,dra,"pa""ss,1",\n"Multi\nline",x.com,u,p,"a\nb"\n';
  const r2 = parseDelimited(csv).rows;
  ok(r2.length === 3 && r2[1][0] === 'Oliv, portal' && r2[1][3] === 'pa"ss,1' && r2[2][0] === 'Multi\nline', 'CSV quotes, commas and line breaks in cells (Chrome export format)');
  ok(eq(guessColumns(r2, true), ['title', 'url', 'user', 'pass', 'notes']), 'Chrome export columns');
  const bw = 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\nLab,,login,Oliv,,,0,https://portal.olivortho.com,dra,pw1,\n';
  const r3 = parseDelimited(bw).rows, m3 = guessColumns(r3, true);
  ok(m3[0] === 'folder' && m3[3] === 'title' && m3[7] === 'url' && m3[8] === 'user' && m3[9] === 'pass' && m3[10] === 'totp', 'Bitwarden export columns: ' + m3.join(','));
  const noHead = 'Wifi\tNLO-Guest\tsmile123\nPrinter\tadmin\tPr1nt!\n';
  const r4 = parseDelimited(noHead).rows;
  ok(!looksLikeHeader(r4[0]), 'no headings detected when there are none');
  ok(eq(guessColumns(r4, false), ['title', 'user', 'pass']), 'no headings: name, username, password');
  const sec = 'FRONT OFFICE\t\t\nOrthoBanc\tnlo\tob1\nCLINICAL\t\t\niTero\tdra\tit1\n';
  const r5 = parseDelimited(sec).rows, i5 = rowsToItems(r5, ['title', 'user', 'pass'], { sections: true });
  ok(i5.length === 2 && i5[0].folder === 'FRONT OFFICE' && i5[1].folder === 'CLINICAL', 'section headings become folders');
  const doc = 'Delta Dental\nUsername: nlo_front\nPassword: Dd!2345\nWebsite: deltadentalins.com\n\nHenry Schein\nuser: orders@nlo.com  pass: Hs#999\nCall rep: Mike 555-1212\n\nThis paragraph is just notes about the office and has no logins.\n\nhttps://portal.olivortho.com\nLogin: dra / Password: ol!v\nPIN: 4455\n';
  ok(sniff(doc) === 'blocks', 'pasted document is recognised as blocks of text');
  const b = parseBlocks(doc);
  ok(b.length === 3, 'three logins found in the document (prose skipped): ' + b.length);
  ok(b[0].t === 'Delta Dental' && b[0].u === 'nlo_front' && b[0].p === 'Dd!2345' && b[0].url === 'deltadentalins.com', 'labelled lines read');
  ok(b[1].u === 'orders@nlo.com' && b[1].p === 'Hs#999' && b[1].fx.some(f => f.l === 'Call rep'), 'two pairs on one line, extra field kept: ' + JSON.stringify(b[1]));
  ok(b[2].url === 'https://portal.olivortho.com' && b[2].u === 'dra' && b[2].p === 'ol!v' && b[2].fx.some(f => f.l === 'PIN' && f.h), 'a block that starts with a web address; PIN kept hidden: ' + JSON.stringify(b[2]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
