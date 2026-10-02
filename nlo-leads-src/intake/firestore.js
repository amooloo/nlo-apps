'use strict';
/* The few Firestore calls the intake service makes, over Firestore's REST API — no client library,
   no dependencies. On Google Cloud it acts as its own service account (a short-lived token from the
   metadata server); with FIRESTORE_EMULATOR_HOST set (tests) it talks to the local emulator. */
const EMU = process.env.FIRESTORE_EMULATOR_HOST || '';
const BASE = EMU ? 'http://' + EMU + '/v1' : 'https://firestore.googleapis.com/v1';
const META = 'http://metadata.google.internal/computeMetadata/v1/';
let project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '';
let token = { v: '', exp: 0 };

async function meta(path) {
  const r = await fetch(META + path, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw Object.assign(new Error('metadata ' + r.status), { code: 'metadata' });
  return r;
}
async function auth() {
  if (EMU) return 'Bearer owner';
  if (Date.now() < token.exp) return 'Bearer ' + token.v;
  const j = await (await meta('instance/service-accounts/default/token')).json();
  token = { v: j.access_token, exp: Date.now() + (Number(j.expires_in) - 120) * 1000 };
  return 'Bearer ' + token.v;
}
async function root() {
  if (!project) project = (await (await meta('project/project-id')).text()).trim();
  return 'projects/' + project + '/databases/(default)/documents';
}
async function call(method, body) {
  const r = await fetch(BASE + '/' + (await root()) + ':' + method, {
    method: 'POST', headers: { Authorization: await auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) throw Object.assign(new Error('firestore ' + method + ' ' + r.status), { code: 'firestore-' + r.status });
  return r.json();
}

/* Firestore's typed values ⇄ plain values */
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  const fields = {}; Object.keys(v).forEach(k => { fields[k] = enc(v[k]); }); return { mapValue: { fields } };
}
function dec(x) {
  if (!x || typeof x !== 'object') return null;
  if ('stringValue' in x) return x.stringValue;
  if ('booleanValue' in x) return x.booleanValue;
  if ('integerValue' in x) return Number(x.integerValue);
  if ('doubleValue' in x) return x.doubleValue;
  if ('timestampValue' in x) return Date.parse(x.timestampValue);
  if ('mapValue' in x) { const o = {}, f = x.mapValue.fields || {}; Object.keys(f).forEach(k => { o[k] = dec(f[k]); }); return o; }
  if ('arrayValue' in x) return (x.arrayValue.values || []).map(dec);
  return null;
}

/* read documents by path ("meta/intake"): { path: plainFields | null } */
async function getDocs(paths) {
  const r = await root();
  const res = await call('batchGet', { documents: paths.map(p => r + '/' + p) });
  const out = {}; paths.forEach(p => { out[p] = null; });
  (res || []).forEach(x => { if (x.found) { const p = x.found.name.split('/documents/')[1]; out[p] = dec({ mapValue: { fields: x.found.fields || {} } }); } });
  return out;
}
/* how many documents a collection holds, counting no further than upTo */
async function count(collectionId, upTo) {
  const res = await call('runAggregationQuery', { structuredAggregationQuery: { structuredQuery: { from: [{ collectionId }] }, aggregations: [{ alias: 'n', count: { upTo: String(upTo) } }] } });
  const row = (res || []).find(x => x.result);
  return row ? Number(row.result.aggregateFields.n.integerValue || 0) : 0;
}
/* create a document that must not exist yet; `stamp` names a field set to the server's time */
async function create(path, fields, stamp) {
  const r = await root(), f = {}; Object.keys(fields).forEach(k => { f[k] = enc(fields[k]); });
  return call('commit', { writes: [{ update: { name: r + '/' + path, fields: f }, currentDocument: { exists: false }, updateTransforms: stamp ? [{ fieldPath: stamp, setToServerValue: 'REQUEST_TIME' }] : [] }] });
}
/* set some fields of a document (creating it if needed), plus a server-time field */
async function merge(path, fields, stamp) {
  const r = await root(), f = {}; Object.keys(fields).forEach(k => { f[k] = enc(fields[k]); });
  return call('commit', { writes: [{ update: { name: r + '/' + path, fields: f }, updateMask: { fieldPaths: Object.keys(fields) }, updateTransforms: stamp ? [{ fieldPath: stamp, setToServerValue: 'REQUEST_TIME' }] : [] }] });
}
module.exports = { getDocs, count, create, merge, enc, dec };
