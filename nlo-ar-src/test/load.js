/* Loads the app's plain scripts (core.js, edge.js, ar.js …) in a sandbox and hands back every top-level function/constant,
   so the report reader and the worklist rules can be tested without a browser. The office is in Gainesville (Eastern time). */
process.env.TZ = 'America/New_York';
const fs = require('fs'), vm = require('vm'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');
function load(files) {
  const text = files.map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
  const names = Array.from(text.matchAll(/^(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm), m => m[1]);
  const ctx = vm.createContext({
    console, Date, Math, JSON, Object, Array, String, Number, RegExp, Set, Map, Uint8Array, Int32Array, ArrayBuffer, DataView, TextEncoder, TextDecoder,
    crypto: globalThis.crypto, btoa, atob, Promise, Error, parseInt, parseFloat, isFinite, isNaN, setTimeout, clearTimeout, encodeURIComponent,
    CompressionStream, DecompressionStream, Response, Blob, Symbol, Infinity, NaN
  });
  return vm.runInContext(text + '\n;({' + Array.from(new Set(names)).join(',') + '})', ctx);
}
module.exports = { load };
