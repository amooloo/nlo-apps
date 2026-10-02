// Builds mail/nlo-cases-mail.gs: the Apps Script that forwards lab emails to NLO Cases.
//   node tools/build-mail.js
// = mail/script.js + the NLOSeal crypto bundle (mail/seal.js, bundled with esbuild into one plain script)
// + known-answer values made with WebCrypto, which the script checks itself against before it sends anything.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { webcrypto } = require('crypto');
const root = path.join(__dirname, '..');

(async () => {
  const bundle = await esbuild.build({
    entryPoints: [path.join(root, 'mail/seal.js')], bundle: true, write: false, format: 'iife', globalName: 'NLOSeal',
    platform: 'browser', target: 'es2017', minify: true, external: ['buffer'], legalComments: 'none'
  });
  const sealJs = bundle.outputFiles[0].text;
  // Apps Script's editor rejects BigInt literals (and esbuild's es2017 target would too); keep BigInt out entirely
  if (/\bBigInt\b/.test(sealJs)) throw new Error('bundle uses BigInt');

  // known answers from the browser's own crypto (fixed inputs, so the file only changes when the code does)
  const NLOSeal = new Function(sealJs + '\nreturn NLOSeal;')();
  const fromHex = h => Uint8Array.from(h.match(/../g).map(x => parseInt(x, 16)));
  const toHex = b => Buffer.from(new Uint8Array(b)).toString('hex');
  const s = webcrypto.subtle;
  const ikm = '0b'.repeat(22), salt = '000102030405060708090a0b0c', info = 'f0f1f2f3f4f5f6f7f8f9';
  const hk = await s.importKey('raw', fromHex(ikm), 'HKDF', false, ['deriveBits']);
  const hkdf = toHex(await s.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: fromHex(salt), info: fromHex(info) }, hk, 256));
  const d = '1d4b6f0a2c9e8b7d6a5f4e3d2c1b0a99887766554433221100ffeeddccbbaa99';
  const dPeer = '7c9a1e5b3d2f4a6c8e0b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c';
  const me = NLOSeal.pubOf(d), peer = NLOSeal.pubOf(dPeer);
  const b64u = h => Buffer.from(fromHex(h)).toString('base64url');
  const priv = await s.importKey('jwk', Object.assign({ d: b64u(d), ext: true }, me), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const pubKey = await s.importKey('jwk', Object.assign({ ext: true }, peer), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = toHex(await s.deriveBits({ name: 'ECDH', public: pubKey }, priv, 256));
  const key = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', iv = 'cafebabefacedbaddecaf888';
  const pt = Buffer.from('NLO Cases self-test: lab email, 37+ bytes long.').toString('hex'), aad = Buffer.from('inbox:self-test').toString('hex');
  const ak = await s.importKey('raw', fromHex(key), 'AES-GCM', false, ['encrypt']);
  const gcm = toHex(await s.encrypt({ name: 'AES-GCM', iv: fromHex(iv), additionalData: fromHex(aad) }, ak, fromHex(pt)));
  const KAT = { ikm, salt, info, hkdf, d, pub: peer, ecdh, key, iv, pt, aad, gcm };
  // the bundle must agree with WebCrypto here too, or there's no point shipping it
  const same = NLOSeal.hex(NLOSeal.hkdf(NLOSeal.unhex(ikm), NLOSeal.unhex(salt), NLOSeal.unhex(info), 32)) === hkdf
    && NLOSeal.hex(NLOSeal.ecdhX(d, peer)) === ecdh && NLOSeal.hex(NLOSeal.gcm(NLOSeal.unhex(key), NLOSeal.unhex(iv), NLOSeal.unhex(pt), NLOSeal.unhex(aad))) === gcm;
  if (!same) throw new Error('NLOSeal disagrees with WebCrypto');

  let src = fs.readFileSync(path.join(root, 'mail/script.js'), 'utf8');
  if (src.split('/*NLO_KAT*/null').length !== 2 || src.split('/*NLO_CONFIG*/null').length !== 2) throw new Error('placeholders missing');
  src = src.replace('/*NLO_KAT*/null', JSON.stringify(KAT));
  const out = src + '\n/* ---------- NLOSeal: P-256 ECDH + HKDF-SHA256 + AES-256-GCM in plain JavaScript (bn.js, elliptic, aes-js, hash.js; MIT) ---------- */\n' + sealJs;
  fs.writeFileSync(path.join(root, 'mail/nlo-cases-mail.gs'), out);
  console.log('mail/nlo-cases-mail.gs', out.length, 'bytes');
})().catch(e => { console.error(e); process.exit(1); });
