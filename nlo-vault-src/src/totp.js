/* Two-step codes (TOTP, RFC 6238) — for office accounts whose authenticator secret is kept in the vault. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(s) {
  const clean = String(s || '').toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!clean || /[^A-Z2-7]/.test(clean)) return null;
  let bits = 0, val = 0; const out = [];
  for (const ch of clean) {
    val = (val << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

/* accepts a plain secret ("JBSW Y3DP …") or an otpauth:// link from a QR code */
export function parseTotp(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  let secret = s, digits = 6, period = 30, algo = 'SHA-1';
  if (/^otpauth:\/\//i.test(s)) {
    let u; try { u = new URL(s); } catch (e) { return null; }
    if (u.host.toLowerCase() !== 'totp') return null;
    secret = u.searchParams.get('secret') || '';
    const d = parseInt(u.searchParams.get('digits') || '6', 10); if (d >= 6 && d <= 8) digits = d;
    const p = parseInt(u.searchParams.get('period') || '30', 10); if (p >= 10 && p <= 120) period = p;
    const a = String(u.searchParams.get('algorithm') || 'SHA1').toUpperCase().replace('-', '');
    algo = a === 'SHA256' ? 'SHA-256' : a === 'SHA512' ? 'SHA-512' : 'SHA-1';
  }
  const key = base32Decode(secret);
  if (!key || key.length < 10) return null;
  return { key, digits, period, algo };
}

export async function totpCode(cfg, nowMs) {
  const t = Math.floor((nowMs === undefined ? Date.now() : nowMs) / 1000 / cfg.period);
  const msg = new Uint8Array(8);
  let x = t;
  for (let i = 7; i >= 0; i--) { msg[i] = x & 255; x = Math.floor(x / 256); }
  const k = await globalThis.crypto.subtle.importKey('raw', cfg.key, { name: 'HMAC', hash: cfg.algo }, false, ['sign']);
  const mac = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', k, msg));
  const o = mac[mac.length - 1] & 15;
  const bin = ((mac[o] & 127) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return String(bin % Math.pow(10, cfg.digits)).padStart(cfg.digits, '0');
}
export function totpLeft(cfg, nowMs) {
  const s = (nowMs === undefined ? Date.now() : nowMs) / 1000;
  return Math.ceil(cfg.period - (s % cfg.period));
}
