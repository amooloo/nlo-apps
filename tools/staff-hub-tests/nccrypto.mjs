// NLO Cases' own crypto (nlo-cases-src/src/core.js: TE/TD/b64/unb64/rnd/Crypto, normCode, recoveryCode), loaded
// unchanged into Node, so the made-up office's keys are exactly what NLO Cases makes and opens.
import fs from 'node:fs';
import vm from 'node:vm';

const core = fs.readFileSync(new URL('../../nlo-cases-src/src/core.js', import.meta.url), 'utf8');
const cut = (from, to) => { const i = core.indexOf(from), j = core.indexOf(to, i); if (i < 0 || j < 0) throw new Error('core.js changed: ' + from); return core.slice(i, j); };
// a function as written in core.js: on one line, or up to the first line that is just "}"
const fn = name => { const m = new RegExp('^function ' + name + '\\([^)]*\\) \\{[^\\n]*\\}$', 'm').exec(core) || new RegExp('^function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}$', 'm').exec(core); if (!m) throw new Error('core.js: no ' + name); return m[0]; };
const src = [
  /const KDF_ITER = \d+;/.exec(core)[0],
  fn('randChars'), fn('recoveryCode'), fn('normCode'),
  cut('/* ---------- crypto ---------- */', '/* ---------- parse Asana task text'),
  'globalThis.__x = { Crypto, KDF_ITER, normCode, recoveryCode, b64, unb64, TE, TD };'
].join('\n');
const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, TextDecoder, btoa, atob, Uint8Array, JSON, Math, Object, String, Number, Array });
vm.runInContext(src, ctx);
export const { Crypto, KDF_ITER, normCode, recoveryCode, b64, unb64, TE, TD } = ctx.__x;
