/* Password generator and a strength estimate (no outside libraries). */
import { WORDS } from './words.js';
import { randInt } from './crypto.js';

const LOWER = 'abcdefghijkmnopqrstuvwxyz', UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ', DIGITS = '23456789', SYMBOLS = '!#$%&*+-=?@^_~';
const LOWER_ALL = 'abcdefghijklmnopqrstuvwxyz', UPPER_ALL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', DIGITS_ALL = '0123456789';

/* random characters; every chosen kind of character appears at least once */
export function genChars(len, o) {
  o = Object.assign({ upper: true, lower: true, digits: true, symbols: true, ambiguous: false }, o || {});
  len = Math.max(6, Math.min(64, len | 0 || 20));
  const sets = [];
  if (o.lower) sets.push(o.ambiguous ? LOWER_ALL : LOWER);
  if (o.upper) sets.push(o.ambiguous ? UPPER_ALL : UPPER);
  if (o.digits) sets.push(o.ambiguous ? DIGITS_ALL : DIGITS);
  if (o.symbols) sets.push(SYMBOLS);
  if (!sets.length) sets.push(LOWER);
  const pool = sets.join('');
  for (let tries = 0; tries < 200; tries++) {
    let s = '';
    for (let i = 0; i < len; i++) s += pool[randInt(pool.length)];
    if (sets.every(set => [...s].some(c => set.includes(c)))) return s;
  }
  return genChars(len, o);
}
/* a passphrase of common words ("acorn-ablaze-agenda-afford-alarm"); optionally a capital and a number for sites that insist */
export function genWords(n, o) {
  o = Object.assign({ sep: '-', capNum: false }, o || {});
  n = Math.max(3, Math.min(10, n | 0 || 5));
  const w = [];
  for (let i = 0; i < n; i++) w.push(WORDS[randInt(WORDS.length)]);
  if (o.capNum) { const i = randInt(n); w[i] = w[i][0].toUpperCase() + w[i].slice(1) + String(randInt(10)); }
  return w.join(o.sep);
}

/* ---------- strength estimate ----------
   Counts roughly how many guesses an attacker would need (in bits), treating common patterns as cheap:
   dictionary words, common passwords, names of the office, years, keyboard runs, repeats. */
const COMMON_PW = new Set(('password password1 password123 passw0rd 123456 1234567 12345678 123456789 1234567890 12345 qwerty qwerty123 qwertyuiop ' +
  'abc123 111111 000000 123123 iloveyou welcome welcome1 admin admin123 letmein monkey dragon sunshine princess football baseball ' +
  'master shadow superman batman trustno1 login starwars whatever freedom hello hello123 charlie donald michael jordan23 ' +
  'changeme secret test test123 guest default access flower summer winter spring autumn soccer hockey killer pepper ginger ' +
  'zaq12wsx 1q2w3e4r 1qaz2wsx qazwsx asdfgh asdfghjkl zxcvbnm 654321 7777777 121212 696969 112233 lovely loveme ' +
  'p@ssword p@ssw0rd pa$$word passw0rd! password! welcome123 office office123 dental dental1 ortho ortho1 smile smile1 ' +
  'nlo nlo123 nextlevel nextlevel1 braces braces1 teeth gators gogators').split(/\s+/));
const COMMON_WORDS = new Set(('love baby angel god jesus dog dogs cat cats my me you the and his her mom dad son girl boy man king queen ' +
  'blue red green black white pink purple gold silver star sun moon sky fire water ice rock life live happy lucky magic money ' +
  'cash dream hope faith grace peace joy home family friend sweet honey sugar candy cookie apple orange lemon cherry banana ' +
  'tiger lion bear wolf eagle horse pony bunny monkey dragon shark fish bird duck chicken summer winter spring fall beach ocean ' +
  'florida gator gators gainesville miami tampa orlando texas london paris house car truck ford chevy jeep nike music dance rose ' +
  'lily daisy flower heart pass word login admin user test office work school college team game play player soccer football ' +
  'baseball hockey golf super power cool hot funny pretty little big boss best first last new old good bad dark light secret ' +
  'welcome hello jordan michael ashley jessica jennifer sarah emily madison hannah daniel david james john chris matt mike ' +
  'dental dentist ortho orthodontics braces teeth tooth smile smiles clinic patient doctor nurse level next vault').split(/\s+/));
const WORDSET = new Set(WORDS);
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890', 'abcdefghijklmnopqrstuvwxyz'];
/* keyboard walks (1q2w3e4r, zaq1xsw2, !QAZ2wsx): each next key touches the last one on a US keyboard */
const KB = ['`1234567890-=', 'qwertyuiop[]\\', "asdfghjkl;'", 'zxcvbnm,./'];
const SHIFTED = { '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', '_': '-', '+': '=',
  '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/' };
const POS = {}, STAGGER = [0, 1.5, 1.75, 2.25];   // how far each row sits to the right on a real keyboard
KB.forEach((row, r) => Array.from(row).forEach((ch, c) => { POS[ch] = [r, c + STAGGER[r]]; }));
function keyOf(ch) { const b = SHIFTED[ch] || ch.toLowerCase(); return POS[b] || null; }
function touching(a, b) {
  const p = keyOf(a), q = keyOf(b); if (!p || !q || (p[0] === q[0] && p[1] === q[1])) return false;
  return Math.abs(q[0] - p[0]) <= 1 && Math.abs(q[1] - p[1]) <= 1;
}
const LEET = { '@': 'a', '4': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '$': 's', '5': 's', '7': 't' };
const log2 = Math.log2;

function charCost(c) {
  if (/[a-z]/.test(c)) return log2(26);
  if (/[A-Z]/.test(c)) return log2(26) + 0.5;
  if (/[0-9]/.test(c)) return log2(10);
  if (/\s/.test(c)) return 2;
  return log2(33);
}
function caseBits(s) {
  if (s === s.toLowerCase()) return 0;
  if (s[0] !== s[0].toLowerCase() && s.slice(1) === s.slice(1).toLowerCase()) return 1;
  if (s === s.toUpperCase()) return 1;
  return Math.min(s.length, 4);
}
/* could this run of letters be a word? (has vowels, no clusters that English words don't have) */
function vowely(s) { return /[aeiouy]/.test(s) && !/[^aeiouy]{4,}/.test(s) && !/q[^u]|q$|[jxzqv][^aeiouy]|[^aeiouy][jxzqv]|([^aeiouy])\1\1|[aeiouy]{4,}/.test(s); }

/* a password built from a repeating step pattern: "a1b2c3d4", "9z9z9z", "acegik", "123123" … (k interleaved runs,
   each going up or down by a constant step) */
function stepPattern(s) {
  if (s.length < 6) return false;
  if (new Set(s).size < 3) return false;   // plain repeats are handled elsewhere
  const c = Array.from(s, ch => ch.charCodeAt(0));
  for (let k = 1; k <= 3; k++) {
    let all = true;
    for (let r = 0; r < k && all; r++) {
      const seq = c.filter((_, i) => i % k === r);
      if (seq.length < 3) { all = false; break; }
      // each interleaved run is either a constant step (a,b,c / 2,4,6) or a run along a keyboard row (q,w,e,r)
      const part = String.fromCharCode(...seq).toLowerCase();
      if (k > 1 && ROWS.some(row => row.includes(part) || row.split('').reverse().join('').includes(part))) continue;
      const d = seq[1] - seq[0];
      if (Math.abs(d) > 3) { all = false; break; }
      for (let i = 2; i < seq.length; i++) if (seq[i] - seq[i - 1] !== d) { all = false; break; }
    }
    if (all) return true;
  }
  return false;
}
export function strength(pw, context) {
  // very long passwords are strong anyway; looking at the first 128 characters keeps this quick
  const s = String(pw || '').slice(0, 128);
  if (!s) return { bits: 0, score: 0, label: 'Empty', tip: '' };
  if (stepPattern(s)) return { bits: 12, score: 0, label: 'Very weak', tip: 'Avoid patterns like a1b2c3 or 9z9z9z.' };
  const low = s.toLowerCase();
  const ctx = new Set((context || []).map(x => String(x || '').toLowerCase()).filter(x => x.length >= 3));
  const deleet = low.replace(/[@4310!$57]/g, c => LEET[c] || c);
  if (COMMON_PW.has(low) || COMMON_PW.has(deleet) || COMMON_PW.has(low.replace(/[^a-z0-9]+$/, '')))
    return { bits: 4, score: 0, label: 'Very weak', tip: 'This is one of the most common passwords.' };
  let bits = 0, i = 0, lastSep = null, pieces = 0, onlyWords = true;
  while (i < s.length) {
    let best = null;
    // the same chunk again ("ab12ab12", "go!go!go!") costs almost nothing
    for (let L = Math.min(12, i, s.length - i); L >= 2 && !best; L--) {
      if (s.slice(i, i + L) === s.slice(i - L, i)) best = { L, cost: 1 };
    }
    if (best) { bits += best.cost; i += best.L; pieces++; onlyWords = false; continue; }
    // words: longest match first, also with simple letter-for-number swaps (p@ss -> pass)
    for (let L = Math.min(12, s.length - i); L >= 3; L--) {
      const part = low.slice(i, i + L), dl = deleet.slice(i, i + L), orig = s.slice(i, i + L);
      let cost = null;
      if (ctx.has(part) || ctx.has(dl)) cost = 4;
      else if (COMMON_WORDS.has(part) || COMMON_WORDS.has(dl)) cost = 8;
      else if (WORDSET.has(part) || WORDSET.has(dl)) cost = 11;
      else if (L >= 4 && /^[a-z]+$/.test(dl) && /^[A-Za-z][a-z]+$/.test(orig) && vowely(dl)) cost = 11 + Math.max(0, L - 6) * 1.5 + 2; // probably some other word
      if (cost !== null) { cost += caseBits(orig) + (dl !== part ? 1 : 0); best = { L, cost }; break; }
    }
    // runs: 1234, abcd, qwer, and backwards
    if (!best) {
      for (let L = Math.min(10, s.length - i); L >= 3; L--) {
        const part = low.slice(i, i + L);
        if (ROWS.some(r => r.includes(part) || r.split('').reverse().join('').includes(part))) { best = { L, cost: 3 + log2(L) }; onlyWords = false; break; }
      }
    }
    // repeats: aaaa, 1111
    if (!best) {
      let L = 1; while (i + L < s.length && s[i + L] === s[i]) L++;
      if (L >= 3) { best = { L, cost: charCost(s[i]) + log2(L) }; onlyWords = false; }
    }
    // a step pattern somewhere inside ("…a1b2c3d4…")
    for (let L = Math.min(24, s.length - i); L >= 6 && !best; L--) if (stepPattern(s.slice(i, i + L))) { best = { L, cost: 10 + log2(L) }; onlyWords = false; }
    // a keyboard walk of 4 keys or more (1q2w3e4r, zaq1xsw2)
    if (!best) {
      let L = 1; while (i + L < s.length && touching(s[i + L - 1], s[i + L])) L++;
      if (L >= 4) { const shifts = Array.from(s.slice(i, i + L)).filter(ch => SHIFTED[ch] || /[A-Z]/.test(ch)).length; best = { L, cost: 6 + (L - 1) * 1.6 + Math.min(shifts, 2) }; onlyWords = false; }
    }
    // years 1900–2039
    if (!best && /^(19\d\d|20[0-3]\d)/.test(s.slice(i, i + 4)) && !/\d/.test(s[i + 4] || '')) { best = { L: 4, cost: 7 }; onlyWords = false; }
    if (!best) {
      const c = s[i];
      if (/[^a-zA-Z0-9]/.test(c) && lastSep === c) best = { L: 1, cost: 1 };      // the same separator again
      else { best = { L: 1, cost: charCost(c) }; if (/[a-zA-Z0-9]/.test(c)) onlyWords = false; }
      if (/[^a-zA-Z0-9]/.test(c)) lastSep = c;
    }
    bits += best.cost; i += best.L; pieces++;
  }
  bits += Math.min(4, log2(pieces + 1)); // a little for the order of the pieces
  bits = Math.round(bits);
  const score = bits < 28 ? 0 : bits < 36 ? 1 : bits < 50 ? 2 : bits < 64 ? 3 : 4;
  const label = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'][score];
  let tip = '';
  if (score < 3) tip = s.length < 12 ? 'Make it longer — at least 12 characters.' : onlyWords ? 'Add another word.' : 'Avoid names, years and common words; a short sentence works well.';
  return { bits, score, label, tip };
}

/* what the vault itself accepts as someone's own password */
export const MIN_LEN = 12;
export function vaultPasswordProblem(pw, context) {
  const s = String(pw || '');
  if (s.length < MIN_LEN) return 'Use at least ' + MIN_LEN + ' characters.';
  if (s.length > 200) return 'That’s too long (200 characters at most).';
  const st = strength(s, context);
  if (st.score < 3) return 'Too easy to guess. ' + (st.tip || '');
  return '';
}
