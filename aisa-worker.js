// ====================================================================
// AISA Worker — RAG Mode (full-context toggle retained)
// v2.1 — CLEANUP + SPEED FIX (2026-07-19):
//   1. thinkingLevel: "minimal" replaces thinkingBudget: 0
//      (Gemini 3.x ignores thinkingBudget — the model was silently
//      running at default "medium" thinking on every question.
//      Auto-fallback: if the API rejects the field, retry without it.)
//   2. NEW /purge-stale route — safely removes stale vector generations
//      (old uploads under other labels) WITHOUT touching live chunks.
//      Run it after deploy, repeat until it reports clean:true.
//   3. /purge-old RETIRED (it deleted live vectors — returns 410 now).
//   4. /train + /delete-file now record exact chunk counts in KV
//      (key: chunks:<label>) and delete using the recorded range, so
//      stale chunks can never accumulate again.
//   5. Streamed answers now pass through the same cleanup filter as
//      /ask (no more raw [PHOTO:] tags / thumbnail URLs on first ask).
//   6. Answer-cache keys are SHA-256 hashed (no more silent cache
//      failures on long/non-ASCII questions, no collisions).
//   7. CORS origin check is exact-match (startsWith was spoofable),
//      responses send Vary: Origin.
//   8. Input caps on /ask (question 4k chars, image ~2MB, history 12
//      turns) + soft per-IP rate limit (30 req/min) + 45s Gemini timeout.
//   9. (v2.1.1) All vector deletes are POLITE: 500-id batches, paced,
//      with retry — avoids Vectorize "Too Many Requests" (code 40041).
//      If the limit still trips, /purge-stale saves progress and tells
//      you to wait a minute and refresh instead of erroring out.
// v2.2 — ACCURACY UPDATE (2026-07-19):
//   A. FOLLOW-UP-AWARE SEARCH: follow-ups like "what about step 3?"
//      now blend the previous question into the vector search, so the
//      right chunks are retrieved mid-conversation.
//   B. NEW /health route (admin) — live index stats + trained files,
//      so trainings/purges can be verified from a URL.
//   C. Cut-off detection: if an answer hits the length cap, AISA says
//      so instead of stopping mid-sentence.
// v2.3.4 — OUTPUT CAP RAISED 1200 → 8192 (2026-07-19): thinking tokens
//   share the maxOutputTokens budget, so "medium" thinking was eating
//   the 1200 cap and truncating answers (the new cut-off notice caught
//   it). Prompt still enforces short answers; the cap is a cost guard.
// v2.3.3 — REASONING SET TO "medium" (2026-07-19), per Dr. Akhavan:
//   accuracy prioritized over speed. At "minimal" the model fabricated
//   a MARA activation protocol that contradicted retrieved KB content
//   (invented steps, tools, timings). "medium" is the model's default —
//   the same level AISA effectively ran before 2026-07-19. The dial is
//   thinkingLevel in generationConfig below (minimal/low/medium/high);
//   speed comes from streaming + answer cache + the clean index, not
//   from cutting reasoning.
// v2.3 — KB VERSION VISIBILITY (2026-07-19):
//   D. The worker reads the "VERSION:" line from the KB (on /train, or
//      once from the stored copy) and remembers it. Three ways to see it,
//      none of which require touching the frontend HTML on KB updates:
//        - PUBLIC GET /version → {"version":"2.53","lastUpdated":...}
//        - AISA is told its current version on every question, so asking
//          "what version are you running?" is always answered correctly
//          (no longer depends on the right chunk being retrieved)
//        - /health includes it
// v2.0 — SPEED UPDATE (2026-06-10): streaming, answer cache, KB cache.
// ====================================================================
// MODE TOGGLE: Set to "full" to send all training files as context,
//              or "rag" to use vector search.
// NOTE (2026-07-19): KB is ~483k tokens — too large for "full" mode
// (~7¢/question and slower first token). Keep "rag".
const KNOWLEDGE_MODE = "rag";

// In-memory knowledge base cache (per isolate; refreshed every 5 min,
// cleared immediately on /train in the same isolate) — used in "full" mode only.
let KB_CACHE = { text: null, ts: 0 };
const KB_CACHE_TTL = 5 * 60 * 1000;

// Answer cache: reuses final answers for repeated identical questions (6h TTL in KV).
// Skipped for questions with images, live inventory data, or chat history.
const ANSWER_CACHE_TTL_SECONDS = 6 * 60 * 60;
let ANS_GEN = { val: '0', ts: 0 };

// KB version info (extracted from the "VERSION:" line; 5-min memory cache)
let KB_VER = { val: null, ts: 0 };

// Soft per-IP rate limit for /ask and /ask-stream (per isolate; resets on
// isolate recycle — a light guard, not a substitute for a WAF rule).
const RATE_LIMIT_PER_MIN = 30;
let RATE_BUCKET = new Map();

// /purge-stale tuning
const PURGE_RANGE_MAX = 4000;   // assume no upload ever exceeded this many chunks
const PURGE_TAIL_RANGE = 1200;  // tail ids checked beyond the recorded count
const PURGE_TOPK = 50;
const DELETE_BATCH_SIZE = 500;  // ids per deleteByIds call (binding allows up to ~1000)
const DELETE_PACE_MS = 400;     // pause between delete calls to respect rate limits

export default {
async fetch(request, env, ctx) {
const origin = request.headers.get('Origin') || '';

// 1. Handle CORS preflight
if (request.method === "OPTIONS") {
return new Response(null, {
          status: 204,
          headers: corsHeaders(origin)
});
}

const url = new URL(request.url);

// ====================================================================
// ROUTE 1: THE TRAINING ROUTE (/train) — requires ADMIN_KEY
// Stores full file text in KV. Also stores vectors for RAG.
// Records exact chunk count (chunks:<label>) for precise cleanup.
// ====================================================================
if (url.pathname === "/train" && request.method === "POST") {
if (!checkAdmin(request, env)) {
return jsonResponse({ error: 'Unauthorized' }, 401, origin);
}

try {
const { text, fileLabel } = await request.json();
const label = (fileLabel || text.substring(0, 50)).replace(/[^a-zA-Z0-9]/g, '_').substring(0, 80).toLowerCase();
if (env.KNOWLEDGE_KV) {
await env.KNOWLEDGE_KV.put(`file:${label}`, text);
let fileIndex = [];
try {
const existing = await env.KNOWLEDGE_KV.get('__file_index__', 'json');
if (Array.isArray(existing)) fileIndex = existing;
} catch (e) {}
if (!fileIndex.includes(label)) {
fileIndex.push(label);
await env.KNOWLEDGE_KV.put('__file_index__', JSON.stringify(fileIndex));
}
KB_CACHE = { text: null, ts: 0 }; // invalidate in-memory cache
try { await env.KNOWLEDGE_KV.put('__ans_gen__', String(Date.now())); } catch (e) {}
ANS_GEN = { val: '0', ts: 0 }; // invalidate answer cache
// Record the KB version from the uploaded text (e.g. "VERSION: 2.53")
try {
const vm = text.match(/^VERSION:\s*(\S+)/mi);
if (vm) {
const um = text.match(/^LAST UPDATED:\s*(.+)$/mi);
await env.KNOWLEDGE_KV.put('__kb_version__', JSON.stringify({ version: vm[1], lastUpdated: um ? um[1].trim() : null, fileLabel: label, trainedAt: new Date().toISOString() }));
KB_VER = { val: null, ts: 0 };
}
} catch (e) {}
}
let totalSaved = 0;
if (env.VECTORIZE) {
const rawChunks = buildChunks(text, fileLabel, label);
// Delete the previous generation for THIS label using the recorded
// chunk count (not a blind guess), plus a margin for older larger runs.
let oldCount = 0;
try { const rec = env.KNOWLEDGE_KV ? await env.KNOWLEDGE_KV.get(`chunks:${label}`) : null; oldCount = parseInt(rec || '0', 10) || 0; } catch (e) {}
const deleteUpTo = Math.max(oldCount, rawChunks.length, 1000) + 100;
try {
const oldIds = [];
for (let j = 0; j < deleteUpTo; j++) { oldIds.push(`${label}_chunk_${j}`); }
await politeDeleteByIds(env, oldIds, { deleted: 0, rateLimited: false });
} catch (delErr) {}
const batchSize = 50;
for (let i = 0; i < rawChunks.length; i += batchSize) {
const batch = rawChunks.slice(i, i + batchSize);
const embeddingData = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: batch });
const vectorsToInsert = batch.map((chunk, index) => ({ id: `${label}_chunk_${i + index}`, values: embeddingData.data[index], metadata: { text: chunk, fileLabel: label } }));
await env.VECTORIZE.upsert(vectorsToInsert);
totalSaved += batch.length;
}
if (env.KNOWLEDGE_KV) { try { await env.KNOWLEDGE_KV.put(`chunks:${label}`, String(rawChunks.length)); } catch (e) {} }
}
return jsonResponse({ success: true, mode: env.KNOWLEDGE_KV ? 'full-context + rag-backup' : 'rag-only', fileLabel: label, chunksSaved: totalSaved, kvStored: !!env.KNOWLEDGE_KV }, 200, origin);
} catch (err) {
return jsonResponse({ error: err.message }, 500, origin);
}
}

// ====================================================================
// ROUTE: LIST FILES (/files)
// ====================================================================
if (url.pathname === "/files" && request.method === "GET") {
if (!checkAdmin(request, env, url)) { return jsonResponse({ error: 'Unauthorized' }, 401, origin); }
try {
let files = [];
if (env.KNOWLEDGE_KV) {
const index = await env.KNOWLEDGE_KV.get('__file_index__', 'json');
if (Array.isArray(index)) {
const results = await Promise.all(index.map(async (label) => {
const [text, chunkRec] = await Promise.all([
env.KNOWLEDGE_KV.get(`file:${label}`),
env.KNOWLEDGE_KV.get(`chunks:${label}`)
]);
return { label, characters: text ? text.length : 0, recordedChunks: parseInt(chunkRec || '0', 10) || 0 };
}));
files = results;
}
}
const totalChars = files.reduce((sum, f) => sum + f.characters, 0);
const estimatedTokens = Math.round(totalChars / 4);
return jsonResponse({ mode: KNOWLEDGE_MODE, fileCount: files.length, totalCharacters: totalChars, estimatedTokens, estimatedCostPerQuery: `$${(estimatedTokens * 0.00000015).toFixed(6)}`, files }, 200, origin);
} catch (err) { return jsonResponse({ error: err.message }, 500, origin); }
}

// ====================================================================
// ROUTE: KB VERSION (/version) — public, safe: version string only.
// Lets the frontend (or anyone on staff) see which KB is live without
// re-uploading the HTML when the KB changes.
// ====================================================================
if (url.pathname === "/version" && request.method === "GET") {
let v = null;
try { v = env.KNOWLEDGE_KV ? await getKbVersion(env) : null; } catch (e) {}
return jsonResponse(v || { version: null, note: 'No VERSION line found in the stored KB yet.' }, 200, origin);
}

// ====================================================================
// ROUTE: HEALTH CHECK (/health) — admin; live stats without the dashboard
// ====================================================================
if (url.pathname === "/health" && request.method === "GET") {
if (!checkAdmin(request, env, url)) { return jsonResponse({ error: 'Unauthorized' }, 401, origin); }
const out = { ok: true, mode: KNOWLEDGE_MODE, time: new Date().toISOString() };
try {
const idx = await env.KNOWLEDGE_KV.get('__file_index__', 'json');
out.files = [];
if (Array.isArray(idx)) {
for (const label of idx) {
const rec = await env.KNOWLEDGE_KV.get(`chunks:${label}`);
out.files.push({ label, recordedChunks: parseInt(rec || '0', 10) || null });
}
}
out.expectedVectorsApprox = out.files.reduce((s, f) => s + (f.recordedChunks || 0), 0);
} catch (e) { out.ok = false; out.kvError = e.message; }
try { out.vectorizeIndex = await env.VECTORIZE.describe(); }
catch (e) { out.vectorizeNote = 'describe() unavailable: ' + e.message; }
try { out.kbVersion = await getKbVersion(env); } catch (e) {}
return jsonResponse(out, 200, origin);
}

// ====================================================================
// ROUTE: DELETE A FILE (/delete-file)
// ====================================================================
if (url.pathname === "/delete-file" && request.method === "POST") {
if (!checkAdmin(request, env)) { return jsonResponse({ error: 'Unauthorized' }, 401, origin); }
try {
const { fileLabel } = await request.json();
const label = (fileLabel || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 80).toLowerCase();
if (!label) return jsonResponse({ error: 'Missing fileLabel' }, 400, origin);
let recCount = 0;
if (env.KNOWLEDGE_KV) {
try { recCount = parseInt((await env.KNOWLEDGE_KV.get(`chunks:${label}`)) || '0', 10) || 0; } catch (e) {}
await env.KNOWLEDGE_KV.delete(`file:${label}`);
await env.KNOWLEDGE_KV.delete(`chunks:${label}`);
let fileIndex = [];
try { const existing = await env.KNOWLEDGE_KV.get('__file_index__', 'json'); if (Array.isArray(existing)) fileIndex = existing; } catch (e) {}
fileIndex = fileIndex.filter(f => f !== label);
await env.KNOWLEDGE_KV.put('__file_index__', JSON.stringify(fileIndex));
KB_CACHE = { text: null, ts: 0 }; // invalidate in-memory cache
try { await env.KNOWLEDGE_KV.put('__ans_gen__', String(Date.now())); } catch (e) {}
ANS_GEN = { val: '0', ts: 0 }; // invalidate answer cache
}
if (env.VECTORIZE) {
try {
const upTo = Math.max(recCount, 1000) + 100;
const oldIds = [];
for (let j = 0; j < upTo; j++) { oldIds.push(`${label}_chunk_${j}`); }
await politeDeleteByIds(env, oldIds, { deleted: 0, rateLimited: false });
} catch (e) {}
}
return jsonResponse({ success: true, deleted: label }, 200, origin);
} catch (err) { return jsonResponse({ error: err.message }, 500, origin); }
}

// ====================================================================
// ROUTE: PURGE STALE VECTORS (/purge-stale) — the SAFE cleanup.
// Finds vectors whose label is NOT in the current file index and
// deletes them. Never touches ids belonging to current files (below
// their recorded chunk count). Handles one stale label per call —
// run it repeatedly (browser refresh) until it reports clean: true.
// Accepts GET (?key=...) or POST (X-Admin-Key header).
// ====================================================================
if (url.pathname === "/purge-stale" && (request.method === "GET" || request.method === "POST")) {
if (!checkAdmin(request, env, url)) { return jsonResponse({ error: 'Unauthorized' }, 401, origin); }
try {
if (!env.VECTORIZE || !env.KNOWLEDGE_KV) return jsonResponse({ error: 'VECTORIZE and KNOWLEDGE_KV bindings required' }, 500, origin);

// 1. Current labels + their recorded chunk counts
const fileIndex = (await env.KNOWLEDGE_KV.get('__file_index__', 'json')) || [];
const currentLabels = new Set(Array.isArray(fileIndex) ? fileIndex : []);
if (currentLabels.size === 0) return jsonResponse({ error: 'File index is empty — refusing to purge (everything would look stale). Train first.' }, 400, origin);
const counts = {};
for (const label of currentLabels) {
const rec = await env.KNOWLEDGE_KV.get(`chunks:${label}`);
counts[label] = parseInt(rec || '0', 10) || Infinity; // no record -> never tail-delete
}

// 2. Probe the index from many angles and collect ids
const probes = [
"MARA Herbst orthodontic appliance Class II", "RPE expansion palatal separator bands",
"orthodontic protocol delivery cement appointment", "inventory supplies materials ordering",
"policy manual HR benefits vacation", "infection control sterilization safety",
"patient scheduling billing insurance", "staff training onboarding procedures",
"emergency protocol medical office", "orthodontic bonding debonding adjustment",
"staff bios birthdays team members", "photos videos media references",
"fees pricing treatment plans", "retainers aligners Invisalign trays",
"front desk phone scripts new patient"
];
const emb = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: probes });
const seenIds = new Set();
for (const vec of emb.data) {
const results = await env.VECTORIZE.query(vec, { topK: PURGE_TOPK, returnValues: false, returnMetadata: 'none' });
for (const m of results.matches) { if (m.id) seenIds.add(m.id); }
}

// 3. Classify every seen id by parsing its label from the id itself
const staleLabels = new Set();
const strayIds = [];      // ids that don't follow <label>_chunk_<n> at all
const staleSeenIds = [];  // seen ids belonging to stale labels
const tailIds = [];       // current-label ids at/above the recorded count
for (const id of seenIds) {
const m = id.match(/^(.*)_chunk_(\d+)$/);
if (!m) { strayIds.push(id); continue; }
const [, idLabel, idxStr] = m;
if (currentLabels.has(idLabel)) {
if (parseInt(idxStr, 10) >= counts[idLabel]) tailIds.push(id);
} else {
staleLabels.add(idLabel);
staleSeenIds.push(id);
}
}

// 4. Delete politely: strays + ONE stale label's full id range per call.
// Tail sweep only runs on calls with no stale label left (keeps each
// call's mutation count low so Vectorize rate limits stay happy).
const state = { deleted: 0, rateLimited: false };
if (strayIds.length) await politeDeleteByIds(env, strayIds, state);
if (tailIds.length && !state.rateLimited) await politeDeleteByIds(env, tailIds, state);
let purgedLabel = null;
if (staleLabels.size > 0 && !state.rateLimited) {
purgedLabel = [...staleLabels][0];
const rangeIds = [];
for (let j = 0; j < PURGE_RANGE_MAX; j++) rangeIds.push(`${purgedLabel}_chunk_${j}`);
await politeDeleteByIds(env, rangeIds.concat(staleSeenIds.filter(id => id.startsWith(purgedLabel + '_chunk_'))), state);
}
if (staleLabels.size === 0 && !state.rateLimited) {
// Tail sweep for current labels with a recorded count (idempotent)
for (const label of currentLabels) {
if (Number.isFinite(counts[label]) && !state.rateLimited) {
const t = [];
for (let j = counts[label]; j < counts[label] + PURGE_TAIL_RANGE; j++) t.push(`${label}_chunk_${j}`);
await politeDeleteByIds(env, t, state);
}
}
}

const clean = staleLabels.size === 0 && strayIds.length === 0 && !state.rateLimited;
if (state.deleted > 0) { try { await env.KNOWLEDGE_KV.put('__ans_gen__', String(Date.now())); ANS_GEN = { val: '0', ts: 0 }; } catch (e) {} }
return jsonResponse({
        clean,
        rateLimited: state.rateLimited,
        purgedLabelThisCall: purgedLabel,
        staleLabelsSeen: [...staleLabels],
        strayIdsDeleted: strayIds.length,
        idsDeletedThisCall: state.deleted,
        currentLabels: [...currentLabels],
        note: state.rateLimited
          ? 'Vectorize rate limit hit — progress so far is SAVED. Wait about 60 seconds, then refresh this page to continue.'
          : (clean ? 'No stale vectors found in probes. Refresh once more to confirm, then check Stored Vectors in the dashboard (~sum of recorded chunks).' : 'Stale content found and purged. REFRESH AGAIN until clean: true.')
}, 200, origin);
} catch (err) { return jsonResponse({ error: err.message }, 500, origin); }
}

// ====================================================================
// ROUTE: /purge-old — RETIRED. It deleted whatever matched its probe
// queries, INCLUDING live vectors. Kept only as a signpost.
// ====================================================================
if (url.pathname === "/purge-old" && request.method === "POST") {
return jsonResponse({ error: 'Retired: /purge-old could delete LIVE vectors. Use /purge-stale instead.' }, 410, origin);
}

// ====================================================================
// ROUTE 2: THE CHAT ROUTE (/ask) — classic, full answer at once
// ====================================================================
if (url.pathname === "/ask" && request.method === "POST") {
try {
const limited = rateLimit(request);
if (limited) return jsonResponse({ error: 'Too many requests — please wait a moment.' }, 429, origin);
const reqJson = await request.json();
const bad = validateAsk(reqJson);
if (bad) return bad(origin);

// Answer cache: instant response for repeated questions
const cacheKey = await answerCacheKey(reqJson, env);
if (cacheKey) {
let cachedAnswer = null;
try { cachedAnswer = await env.KNOWLEDGE_KV.get(cacheKey); } catch (e) {}
if (cachedAnswer) {
return jsonResponse({ answer: cachedAnswer, cached: true }, 200, origin);
}
}

const geminiBody = await buildGeminiBody(reqJson, env);
const geminiResponse = await callGemini(env, geminiBody, false);

if (!geminiResponse.ok) {
const errData = await geminiResponse.json().catch(() => ({}));
const errMsg = errData?.error?.message || `Gemini API error (${geminiResponse.status})`;
console.error('Gemini API error:', errMsg);
return jsonResponse({ error: errMsg }, 502, origin);
}

const geminiData = await geminiResponse.json();
const parts = geminiData.candidates?.[0]?.content?.parts || [];
let finalAnswer = parts.map(p => p.text || '').join('') || "I'm sorry, I hit a snag. Can you try again?";
finalAnswer = cleanAnswer(finalAnswer);
if (geminiData.candidates?.[0]?.finishReason === 'MAX_TOKENS') { finalAnswer += "\n\n*(I hit my answer length limit — ask me to continue and I'll pick up where I left off.)*"; }

if (cacheKey && finalAnswer) { try { await env.KNOWLEDGE_KV.put(cacheKey, finalAnswer, { expirationTtl: ANSWER_CACHE_TTL_SECONDS }); } catch (e) {} }

return jsonResponse({ answer: finalAnswer }, 200, origin);
} catch (err) {
console.error('Worker /ask error:', err);
return jsonResponse({ error: err.message }, 500, origin);
}
}

// ====================================================================
// ROUTE 3: STREAMING CHAT (/ask-stream) — plain-text chunked answer
// Frontend v3.1.0 tries this first and falls back to /ask.
// Streamed text now passes through the same noise filter as /ask.
// ====================================================================
if (url.pathname === "/ask-stream" && request.method === "POST") {
try {
const limited = rateLimit(request);
if (limited) return jsonResponse({ error: 'Too many requests — please wait a moment.' }, 429, origin);
const reqJson = await request.json();
const bad = validateAsk(reqJson);
if (bad) return bad(origin);

// Answer cache: instant response for repeated questions
const cacheKey = await answerCacheKey(reqJson, env);
if (cacheKey) {
let cachedAnswer = null;
try { cachedAnswer = await env.KNOWLEDGE_KV.get(cacheKey); } catch (e) {}
if (cachedAnswer) {
return new Response(cachedAnswer, { headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff", ...corsHeaders(origin) } });
}
}

const geminiBody = await buildGeminiBody(reqJson, env);
const geminiResponse = await callGemini(env, geminiBody, true);

if (!geminiResponse.ok || !geminiResponse.body) {
const errData = await geminiResponse.json().catch(() => ({}));
const errMsg = errData?.error?.message || `Gemini API error (${geminiResponse.status})`;
console.error('Gemini stream error:', errMsg);
return jsonResponse({ error: errMsg }, 502, origin);
}

const { readable, writable } = new TransformStream();
const pump = streamSseToText(geminiResponse.body, writable, async (fullText) => {
if (cacheKey && fullText) { try { await env.KNOWLEDGE_KV.put(cacheKey, cleanAnswer(fullText), { expirationTtl: ANSWER_CACHE_TTL_SECONDS }); } catch (e) {} }
});
if (ctx && ctx.waitUntil) ctx.waitUntil(pump);

return new Response(readable, {
            headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff", ...corsHeaders(origin) }
});
} catch (err) {
console.error('Worker /ask-stream error:', err);
return jsonResponse({ error: err.message }, 500, origin);
}
}

	  // ====================================================================
	  // ROUTE: PHOTO VISION (/describe) — requires ADMIN_KEY
	  // Takes one image, returns category + caption + description + keywords
	  // + the manual section the photo belongs in (RAG over the trained files).
	  // Used by the AISA Photo Portal so nobody types photo descriptions.
	  // ====================================================================
	  if (url.pathname === "/describe" && request.method === "POST") {
		if (!checkAdmin(request, env, url)) return jsonResponse({ success: false, error: 'Unauthorized — check your admin key.' }, 401, origin);
		if (rateLimit(request)) return jsonResponse({ success: false, error: 'Too many requests — wait a minute and try again.' }, 429, origin);
		try {
		  const reqJson = await request.json();
		  const img = reqJson.image || {};
		  if (!img.data || !img.mimeType) return jsonResponse({ success: false, error: 'Missing image.data / image.mimeType' }, 400, origin);
		  if (img.data.length > MAX_PHOTO_B64) return jsonResponse({ success: false, error: 'Image too large — please resize under ~4MB.' }, 413, origin);

		  const categories = Array.isArray(reqJson.categories) && reqJson.categories.length ? reqJson.categories.slice(0, 60) : DEFAULT_PHOTO_CATEGORIES;
		  const hint = (reqJson.hint || '').toString().slice(0, 300);
		  const fileName = (reqJson.fileName || '').toString().slice(0, 200);

		  // Pass 1 — look at the photo
		  const vision = await describePhotoWithGemini({ img, categories, hint, fileName }, env);

		  // Pass 2 — where does it belong? (never fatal)
		  let placement = { suggestedSection: '', sectionRationale: '' };
		  try { placement = await suggestPhotoPlacement(vision, env); }
		  catch (e) { console.error('placement lookup failed:', e); }

		  return jsonResponse({
			success: true,
			category: vision.category,
			caption: vision.caption,
			description: vision.description,
			keywords: vision.keywords,
			confidence: vision.confidence,
			suggestedSection: placement.suggestedSection || '',
			sectionRationale: placement.sectionRationale || ''
		  }, 200, origin);
		} catch (err) {
		  console.error('Worker /describe error:', err);
		  return jsonResponse({ success: false, error: err.message }, 500, origin);
		}
	  }

return new Response("NLO Worker is Running!", { headers: { "Content-Type": "text/plain", ...corsHeaders(origin) } });
}
};

// ====================================================================
// SHARED HELPERS
// ====================================================================

function jsonResponse(obj, status, origin) {
return new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Delete vector ids politely: large batches, paced, with retry on rate
// limits. Mutates `state` ({ deleted, rateLimited }) so callers can
// report progress and stop gracefully instead of throwing.
async function politeDeleteByIds(env, ids, state) {
for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
if (state.rateLimited) return;
const batch = ids.slice(i, i + DELETE_BATCH_SIZE);
let ok = false;
for (let attempt = 0; attempt < 2 && !ok; attempt++) {
try {
await env.VECTORIZE.deleteByIds(batch);
ok = true;
state.deleted += batch.length;
} catch (e) {
const msg = String((e && e.message) || e);
if (/too many request|429|40041/i.test(msg)) {
if (attempt === 0) { await sleep(2500); continue; }
state.rateLimited = true;
return;
}
// Possibly batch-size related — fall back to 100-id sub-batches
try {
for (let j = 0; j < batch.length; j += 100) {
await env.VECTORIZE.deleteByIds(batch.slice(j, j + 100));
state.deleted += Math.min(100, batch.length - j);
await sleep(300);
}
ok = true;
} catch (e2) {
const m2 = String((e2 && e2.message) || e2);
if (/too many request|429|40041/i.test(m2)) { state.rateLimited = true; return; }
throw e2;
}
}
}
await sleep(DELETE_PACE_MS);
}
}

function checkAdmin(request, env, url) {
const authKey = request.headers.get('X-Admin-Key') || (url ? (url.searchParams.get('key') || '') : '');
const storedKey = env['ADMIN-KEY'] || env['ADMIN_KEY'];
return !!storedKey && authKey === storedKey;
}

// Soft per-IP rate limit (per isolate)
function rateLimit(request) {
const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
const now = Date.now();
let entry = RATE_BUCKET.get(ip);
if (!entry || (now - entry.start) > 60000) { entry = { start: now, count: 0 }; }
entry.count++;
RATE_BUCKET.set(ip, entry);
if (RATE_BUCKET.size > 5000) RATE_BUCKET = new Map(); // memory guard
return entry.count > RATE_LIMIT_PER_MIN;
}

function validateAsk(reqJson) {
if (!reqJson || !reqJson.question || typeof reqJson.question !== 'string') {
return (origin) => jsonResponse({ error: 'Missing "question" field' }, 400, origin);
}
if (reqJson.question.length > 4000) {
return (origin) => jsonResponse({ error: 'Question too long (max 4000 characters)' }, 400, origin);
}
if (reqJson.image && reqJson.image.data && reqJson.image.data.length > 2800000) {
return (origin) => jsonResponse({ error: 'Image too large (max ~2MB)' }, 400, origin);
}
return null;
}

// Build a cache key for the answer cache; returns null when the request
// isn't cacheable (image attached, live inventory data, or mid-conversation).
// Key material is SHA-256 hashed: fixed-size keys, no collisions, no
// non-ASCII length problems.
async function answerCacheKey(reqJson, env) {
if (!env.KNOWLEDGE_KV) return null;
const { question, inventoryData, history, image, staffName, staffRole } = reqJson;
if (image || inventoryData) return null;
if (Array.isArray(history) && history.length > 0) return null;
const norm = question.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[?.!\s]+$/, '');
if (!norm) return null;
const gen = await getAnsGen(env);
const material = (staffName || '') + ':' + (staffRole || '') + ':' + norm;
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
return 'anscache:' + gen + ':' + hex;
}

// KB version: normally recorded at /train time; if missing (e.g. first
// deploy of this worker version), it self-heals by reading the stored KB
// text once and extracting the "VERSION:" line. 5-min memory cache.
async function getKbVersion(env) {
if (KB_VER.ts && (Date.now() - KB_VER.ts) < 5 * 60 * 1000) return KB_VER.val;
let v = null;
try {
v = await env.KNOWLEDGE_KV.get('__kb_version__', 'json');
if (!v) {
const idx = await env.KNOWLEDGE_KV.get('__file_index__', 'json');
if (Array.isArray(idx)) {
for (const label of idx) {
const text = await env.KNOWLEDGE_KV.get(`file:${label}`);
if (!text) continue;
const vm = text.match(/^VERSION:\s*(\S+)/mi);
if (vm) {
const um = text.match(/^LAST UPDATED:\s*(.+)$/mi);
v = { version: vm[1], lastUpdated: um ? um[1].trim() : null, fileLabel: label, trainedAt: null };
await env.KNOWLEDGE_KV.put('__kb_version__', JSON.stringify(v));
break;
}
}
}
}
} catch (e) {}
KB_VER = { val: v, ts: Date.now() };
return v;
}

// Answer-cache generation: bumped on every /train or /delete-file so stale
// answers are never served after a KB update (5-min memory cache).
async function getAnsGen(env) {
if (ANS_GEN.ts && (Date.now() - ANS_GEN.ts) < 5 * 60 * 1000) return ANS_GEN.val;
let v = '0';
try { v = (await env.KNOWLEDGE_KV.get('__ans_gen__')) || '0'; } catch (e) {}
ANS_GEN = { val: v, ts: Date.now() };
return v;
}

// Build the vector-search query. Follow-ups like "what about step 3?"
// match nothing useful on their own — blend the previous user question
// in so retrieval stays on-topic. The CURRENT question goes first so it
// survives any truncation by the embedding model.
function buildSearchQuery(question, history) {
if (!Array.isArray(history) || history.length === 0) return question;
let prev = '';
for (let i = history.length - 1; i >= 0 && !prev; i--) {
const turn = history[i];
if (turn && turn.role === 'user' && Array.isArray(turn.parts)) {
prev = turn.parts.map(p => String((p && p.text) || '')).join(' ').replace(/\s+/g, ' ').trim();
}
}
if (!prev) return question;
return (question + '\n(Context from previous question: ' + prev + ')').slice(0, 1500);
}

async function getKnowledgeBase(question, env) {
let knowledgeBase = "";
if (KNOWLEDGE_MODE === "full" && env.KNOWLEDGE_KV) {
// Serve from in-memory cache when fresh (skips KV reads entirely)
if (KB_CACHE.text && (Date.now() - KB_CACHE.ts) < KB_CACHE_TTL) {
return KB_CACHE.text;
}
try {
const fileIndex = await env.KNOWLEDGE_KV.get('__file_index__', 'json');
if (Array.isArray(fileIndex) && fileIndex.length > 0) {
const texts = await Promise.all(fileIndex.map(label => env.KNOWLEDGE_KV.get(`file:${label}`)));
const fileTexts = [];
fileIndex.forEach((label, i) => { if (texts[i]) fileTexts.push(`\n========== FILE: ${label} ==========\n${texts[i]}`); });
knowledgeBase = fileTexts.join('\n\n');
if (knowledgeBase) KB_CACHE = { text: knowledgeBase, ts: Date.now() };
}
} catch (kvErr) { console.error('KV read error, falling back to RAG:', kvErr); }
}
if (!knowledgeBase && env.VECTORIZE) {
const questionEmbedding = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [question] });
const searchResults = await env.VECTORIZE.query(questionEmbedding.data[0], { topK: 20, returnMetadata: true });
let contextSnippets = "";
for (const match of searchResults.matches) { if (match.metadata?.text) contextSnippets += match.metadata.text + "\n\n"; }
knowledgeBase = contextSnippets;
}
return knowledgeBase;
}

// Call Gemini with thinkingLevel: "minimal". If the API rejects the
// thinking field (older/newer API drift), retry once without it so
// production never breaks on a config field.
async function callGemini(env, geminiBody, stream) {
const endpoint = stream ? 'streamGenerateContent?alt=sse&' : 'generateContent?';
const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:${endpoint}key=${env.GEMINI_API_KEY}`;
const doFetch = (body) => {
const opts = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
// Timeout only on non-streaming calls: aborting a stream mid-flight would truncate long answers.
try { if (!stream && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) opts.signal = AbortSignal.timeout(45000); } catch (e) {}
return fetch(geminiUrl, opts);
};
let resp = await doFetch(geminiBody);
if (!resp.ok && geminiBody.generationConfig && geminiBody.generationConfig.thinkingConfig) {
let errText = '';
try { errText = await resp.clone().text(); } catch (e) {}
if (/thinking/i.test(errText) || resp.status === 400) {
const fallbackBody = { ...geminiBody, generationConfig: { ...geminiBody.generationConfig } };
delete fallbackBody.generationConfig.thinkingConfig;
console.error('Gemini rejected thinkingConfig — retrying without it. Error was:', errText.slice(0, 300));
resp = await doFetch(fallbackBody);
}
}
return resp;
}

async function buildGeminiBody(reqJson, env) {
const { question, inventoryData, history, image, staffName, staffRole } = reqJson;

const knowledgeBase = await getKnowledgeBase(buildSearchQuery(question, history), env);

const kbVer = env.KNOWLEDGE_KV ? await getKbVersion(env) : null;
const versionLine = (kbVer && kbVer.version)
? `\n        AUTHORITATIVE VERSION INFO (injected by the system, always current): You are running NLO Master Knowledge Base VERSION ${kbVer.version}${kbVer.lastUpdated ? ', last updated ' + kbVer.lastUpdated : ''}. If anyone asks what version you are, which version you're running, or how current your knowledge is, answer with exactly this version — it overrides any version numbers found in retrieved knowledge excerpts or change logs.\n`
: '';

const systemInstruction = `
        You are AISA, a friendly and experienced Senior Clinical Assistant at Next Level Orthodontics.
${versionLine}

        YOUR CORE VALUES — These guide everything you say and recommend:
        Our motto is "Break down the barriers that lead to new possibilities." You live by four values:

        1. GREAT FINISH — Every recommendation you make should serve the best possible outcome. Never suggest shortcuts that compromise quality. When advising on clinical procedures, always think about the end result and the patient's joy. Encourage excellence in every step.

        2. GREAT COMMUNICATION — Listen to understand, not just to respond. Be clear AND kind in every answer. Put the person asking first. If something is confusing, break it down with patience. Foster understanding, not just compliance.

        3. GREAT HOSPITALITY — Treat every person who asks you a question as a valued guest, not a task to complete. Be warm, inclusive, and make people feel welcome. Remember: the experience matters as much as the information. Break down barriers and open up possibilities.

        4. GREAT ACCOUNTABILITY — If you don't know something, own it honestly. Encourage the team to assess situations, understand them, own them, and act decisively. When giving advice, emphasize doing the right thing even when it's hard. Actions speak louder than words.

        These aren't just words on a wall — they should come through in HOW you answer, not just WHAT you answer.

        TONE:
        - Be warm, professional, and sound like a helpful teammate.
        - Avoid sounding like a search engine; use natural, conversational transitions.

        RESPONSE LENGTH — DEFAULT TO SHORT:
        - Your #1 formatting priority is BREVITY. Assistants are busy chairside — they need the answer fast, not a textbook.
        - Default to the SHORTEST answer that fully answers the question. 3-5 bullet points is ideal for most questions. Only go longer if the question genuinely requires it (e.g., a full multi-step procedure).
        - Do NOT add background, context, or "nice to know" info unless the user asks for it. Just answer the question.
        - Do NOT repeat the question back or paraphrase it before answering.
        - Do NOT add a closing line like "Let me know if you need anything else!" unless you genuinely need clarification. Just stop when the answer is done.
        - If the user asks for more detail, THEN expand. Trust them to ask follow-ups.

        FORMATTING RULES — Keep it scannable:
        - Use **bold** for key terms, names, codes, and important details.
        - Use numbered lists ONLY for step-by-step procedures where order matters.
        - Use bullet points for short lists. Keep bullets to ONE line each when possible.
        - Use section headers (## or ###) ONLY when the answer covers 3+ distinct topics. Most answers should NOT have headers.
        - Do NOT use emojis anywhere in your responses. Instead, use clean Unicode symbols sparingly:
          → for next steps or flow indicators
          ✗ for warnings or things to avoid
        - Use bold labels for critical callouts only: **WARNING:**, **NOTE:**
        - Do NOT use horizontal rules (---) unless the response is very long with truly separate sections.
        - Keep paragraphs to 1-2 sentences max.

        CONTENT CATEGORIES — Adjust your style based on what the question is about:

        **CLINICAL / SOP / POLICY content** (procedures, protocols, compliance, HR policies, benefits, safety, infection control, etc.):
        - Be precise but concise. Give the steps needed — not the full SOP. If someone asks about one part of a procedure, answer that part only.
        - Cite the SOP reference (e.g., "SOP-CL-002") so they can look up the full version if needed.
        - If you cannot find the full answer, provide the closest relevant SOP or section reference as a starting point.
        - Use numbered lists for multi-step procedures. Keep each step to one line when possible.

        **FOUNDATIONAL DENTAL/ORTHODONTIC knowledge** (tooth numbering, anatomy, basic terminology, general dental concepts):
        - Do NOT cite SOP numbers or references. This is standard dental knowledge, not an office-specific protocol.
        - Answer naturally and directly like a knowledgeable colleague would.

        **NON-CLINICAL content** (staff bios, birthdays, fun facts, team-building ideas, gift suggestions, office culture, general conversation):
        - Be creative, warm, and personable — like a friendly coworker chatting.
        - Do NOT cite SOP numbers or section references. These are not procedures.
        - Feel free to make thoughtful suggestions, brainstorm ideas, and add personality.
        - Use what you know about the person (hobbies, interests, family) to give personalized, helpful answers.
        - It's okay to be playful, suggest fun ideas, and go beyond just reading back facts.

        BEHAVIOR:
        1. CLARIFY BEFORE ANSWERING — This is critical:
           - If a question could have multiple answers depending on context, ALWAYS ask a short clarifying question FIRST instead of dumping all possible answers.
           - Keep clarifying questions short and offer 2-4 specific options to choose from.
           - Only skip clarification if the question is very specific and has one clear answer (e.g., "How many turns for a standalone RPE?" → just answer 28).

        2. ANSWER THE SPECIFIC QUESTION — This is the MOST important rule:
           - Give ONLY the information needed to answer the question. Nothing extra. Nothing "nice to know." Nothing "while we're on the topic."
           - Think of it like a busy colleague asking you a quick question chairside — give a fast, direct answer. They'll ask more if they need more.
           - Aim for the SHORTEST correct answer. If you can answer in 3 bullets, do NOT write 10.
           - Walls of text = bad. Short and scannable = good.
        3. CHAT HISTORY: You have access to the recent conversation. Use it to stay in context.
        4. KNOWLEDGE: Answer using the knowledge base provided below. You may also use general orthodontic knowledge to supplement your answers, but if the knowledge base contains a specific protocol or procedure, ALWAYS prioritize it over general knowledge — our office may do things differently. If you cannot find the answer in the knowledge base or your general knowledge, say: "I'm not finding that specific detail in our manuals yet. I can flag that for Dr. Akhavan, or is there something else I can help with?"
        5. IMAGES: If the user has attached an image, analyze it in context of their question (e.g., identifying orthodontic supplies, reading labels, checking equipment).
        6. MEDIA REFERENCES: The knowledge base contains photo references in this format:
           [PHOTO: Description]
           https://drive.google.com/thumbnail?id=XXXXX&sz=w800
           When you see this pattern in the knowledge base, you MUST include the photo in your response using Markdown image syntax: ![Description](URL)
           IMPORTANT: Always include ALL relevant photos from the knowledge base. ONLY use the ![Description](URL) markdown syntax. Do NOT also print raw URLs or [PHOTO:] tags.
           - For VIDEOS: Use a regular Markdown link: [Watch: Video title](URL)
           - For DOCUMENTS: Use a regular Markdown link: [View: Document title](URL)

        === KNOWLEDGE BASE ===
${knowledgeBase}
      `;

let roleContext = '';
if (staffName && staffRole) {
roleContext = `\n=== CURRENT USER ===\nName: ${staffName}\nRole: ${staffRole}\n\nPersonalize your response for this person's role:\n`;
const role = staffRole.toLowerCase();
if (role.includes('orthodontist') || role.includes('owner')) { roleContext += `- This is Dr. Akhavan, the practice owner. Be concise and clinical. Provide data-driven answers. Skip basic explanations — he knows orthodontics. Focus on practice-specific protocols, staff info, and operational details.\n`; }
else if (role.includes('assistant') || role.includes('da')) { roleContext += `- This is a Clinical/Orthodontic Assistant. Focus on clinical procedures, chairside protocols, materials, instrument details, and step-by-step instructions. Be thorough with clinical steps.\n`; }
else if (role.includes('treatment coordinator') || role.includes('tc')) { roleContext += `- This is a Treatment Coordinator. Focus on treatment plans, pricing, insurance, patient communication, consultation procedures, and financial arrangements. Include fee details when relevant.\n`; }
else if (role.includes('appointment') || role.includes('scheduling')) { roleContext += `- This is the Appointment Coordinator. Focus on scheduling codes, appointment types, patient flow, phone scripts, and front desk procedures. Include appointment codes when relevant.\n`; }
else if (role.includes('marketing')) { roleContext += `- This is the Marketing Coordinator. Focus on brand info, events, community outreach, social media, and patient experience details.\n`; }
else if (role.includes('office coordinator')) { roleContext += `- This is the Office Coordinator. Sarah handles both clinical support and administrative/financial duties including insurance, billing, and patient finances. Provide comprehensive answers covering clinical, administrative, and financial aspects.\n`; }
}

let userMessageText = '';
if (inventoryData) userMessageText += `=== LIVE INVENTORY DATA ===\n${String(inventoryData).slice(0, 20000)}\n`;
if (roleContext) userMessageText += roleContext;
userMessageText += `\n=== USER QUESTION ===\n${question}`;

const userParts = [{ text: userMessageText }];
if (image && image.data && image.mimeType) { userParts.push({ inline_data: { mime_type: image.mimeType, data: image.data } }); }

const contents = [];
if (Array.isArray(history)) {
const recent = history.slice(-12); // cap context growth
for (const turn of recent) { if (turn.role && Array.isArray(turn.parts) && (turn.role === 'user' || turn.role === 'model')) { contents.push({ role: turn.role, parts: turn.parts.map(p => ({ text: String(p.text || '') })) }); } }
}
contents.push({ role: "user", parts: userParts });

return {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: contents,
    generationConfig: {
      temperature: 0.6,
      // NOTE: on Gemini, THINKING tokens count against maxOutputTokens.
      // With thinkingLevel "medium" the model may spend 1-2k tokens
      // reasoning before it writes a word — 1200 caused mid-answer
      // cut-offs. Answer BREVITY is enforced by the prompt; this cap is
      // only a runaway guard.
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingLevel: "medium" }
}
};
}

// Line-level noise check shared by cleanAnswer and the stream filter
function isNoiseLine(trimmed) {
if (trimmed.match(/^https:\/\/drive\.google\.com\/thumbnail/)) return true;
if (trimmed.includes('loading="lazy"')) return true;
if (trimmed.match(/^\[PHOTO:[^\]]*\]$/)) return true;
return false;
}

function cleanAnswer(finalAnswer) {
return finalAnswer.split('\n').filter(line => !isNoiseLine(line.trim())).join('\n').replace(/\[PHOTO:[^\]]*\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

// Could this partial line still turn INTO a noise line? (hold it if so)
function couldBecomeNoise(partial) {
const t = partial.trimStart();
if (t.length === 0) return false;
const prefixes = ['https://drive.google.com/thumbnail', '[PHOTO:'];
for (const p of prefixes) { if (p.startsWith(t) || t.startsWith(p)) return true; }
if (t.includes('loading="lazy"')) return true;
return false;
}

// Convert Gemini's SSE stream into plain-text answer chunks.
// Complete lines are filtered through the same noise rules as /ask;
// partial lines are held back only while they might still be noise.
async function streamSseToText(sseBody, writable, onDone) {
const writer = writable.getWriter();
const reader = sseBody.getReader();
const decoder = new TextDecoder();
const encoder = new TextEncoder();
let buf = '';        // SSE line buffer
let lineBuf = '';    // answer-text partial-line buffer
let full = '';
let cutOff = false;  // set when Gemini stops at the token cap
const emit = async (text) => { if (text) await writer.write(encoder.encode(text)); };
const handleText = async (text) => {
full += text;
lineBuf += text;
let nl;
while ((nl = lineBuf.indexOf('\n')) !== -1) {
const line = lineBuf.slice(0, nl);
lineBuf = lineBuf.slice(nl + 1);
if (!isNoiseLine(line.trim())) await emit(line.replace(/\[PHOTO:[^\]]*\]/g, '') + '\n');
}
if (lineBuf && !couldBecomeNoise(lineBuf)) { await emit(lineBuf.replace(/\[PHOTO:[^\]]*\]/g, '')); lineBuf = ''; }
};
const handleSseLine = async (line) => {
if (!line.startsWith('data:')) return;
const data = line.slice(5).trim();
if (data === '[DONE]') return;
try {
const json = JSON.parse(data);
if (json.candidates?.[0]?.finishReason === 'MAX_TOKENS') cutOff = true;
const parts = json.candidates?.[0]?.content?.parts || [];
for (const p of parts) { if (p.text) await handleText(p.text); }
} catch (e) { /* ignore partial lines */ }
};
try {
while (true) {
const { done, value } = await reader.read();
if (done) break;
buf += decoder.decode(value, { stream: true });
let nl;
while ((nl = buf.indexOf('\n')) !== -1) {
const line = buf.slice(0, nl).trim();
buf = buf.slice(nl + 1);
await handleSseLine(line);
}
}
if (buf.trim()) await handleSseLine(buf.trim()); // flush leftover SSE line
if (lineBuf && !isNoiseLine(lineBuf.trim())) await emit(lineBuf.replace(/\[PHOTO:[^\]]*\]/g, '')); // flush final partial line
if (cutOff) { const notice = "\n\n*(I hit my answer length limit — ask me to continue and I'll pick up where I left off.)*"; full += notice; await emit(notice); }
} catch (e) {
console.error('Stream pump error:', e);
} finally {
try { await writer.close(); } catch (e) {}
if (onDone) { try { await onDone(full); } catch (e) {} }
}
}

// ====================================================================
// CHUNKER (unchanged logic, extracted so /train stays readable)
// ====================================================================
function buildChunks(text, fileLabel, label) {
const CHUNK_TARGET = 2000;
const lines = text.split('\n');
let sections = [];
let currentSection = { header: '', lines: [] };
for (const line of lines) {
const trimmedLine = line.trim();
const isSeparator = /^={4,}$/.test(trimmedLine);
const isSopHeader = /^SOP-[A-Z]+-\d/.test(trimmedLine);
const isMajorHeader = /^(PURPOSE|BEHAVIOR|METHOD \d|ALTERNATIVE|QUICK REFERENCE|IMPORTANT)/i.test(trimmedLine);
if (isSeparator) {
if (currentSection.lines.length > 0) sections.push({ header: currentSection.header, text: currentSection.lines.join('\n').trim() });
currentSection = { header: '', lines: [] };
} else if (isSopHeader || isMajorHeader) {
if (currentSection.lines.length > 0) sections.push({ header: currentSection.header, text: currentSection.lines.join('\n').trim() });
currentSection = { header: trimmedLine, lines: [line] };
} else {
if (!currentSection.header && trimmedLine.length > 10 && trimmedLine.length < 120 && !trimmedLine.startsWith('-') && !trimmedLine.startsWith('*')) currentSection.header = trimmedLine;
currentSection.lines.push(line);
}
}
if (currentSection.lines.length > 0) sections.push({ header: currentSection.header, text: currentSection.lines.join('\n').trim() });
let rawChunks = [];
const readableLabel = (fileLabel || label).replace(/_/g, ' ').replace(/\.txt$/i, '');
for (const section of sections) {
if (section.text.length === 0) continue;
const prefix = section.header ? `[Source: ${readableLabel} | Section: ${section.header}]\n` : `[Source: ${readableLabel}]\n`;
if ((prefix.length + section.text.length) <= CHUNK_TARGET) {
rawChunks.push(prefix + section.text);
} else {
const paragraphs = section.text.split(/\n\n+/);
let currentChunk = prefix;
for (const para of paragraphs) {
const trimmed = para.trim();
if (trimmed.length === 0) continue;
if ((currentChunk.length + trimmed.length + 2) < CHUNK_TARGET) {
currentChunk += trimmed + "\n\n";
} else {
if (currentChunk.length > prefix.length) rawChunks.push(currentChunk.trim());
if (trimmed.length > CHUNK_TARGET) {
let remaining = trimmed;
while (remaining.length > CHUNK_TARGET) {
let splitAt = -1;
for (let i = Math.min(remaining.length - 1, CHUNK_TARGET - 1); i > CHUNK_TARGET * 0.4; i--) {
if ('.!?'.includes(remaining[i])) { const after = remaining.substring(i + 1, i + 10); if (after.match(/^\s/) || after.length === 0) { splitAt = i + 1; break; } }
}
if (splitAt === -1) { for (let i = CHUNK_TARGET - 1; i > CHUNK_TARGET * 0.4; i--) { if (remaining[i] === ' ') { splitAt = i; break; } } }
if (splitAt === -1) splitAt = CHUNK_TARGET;
rawChunks.push(prefix + remaining.substring(0, splitAt).trim());
remaining = remaining.substring(splitAt).trim();
}
if (remaining.length > 0) currentChunk = prefix + remaining + "\n\n";
else currentChunk = prefix;
} else { currentChunk = prefix + trimmed + "\n\n"; }
}
}
if (currentChunk.trim().length > prefix.trim().length) rawChunks.push(currentChunk.trim());
}
}
return rawChunks;
}

// --- CORS helpers ---
// Exact-origin matching: startsWith('https://amooloo.github.io') also
// matched e.g. https://amooloo.github.io.evil.com — fixed.
const ALLOWED_HOSTS = ['amooloo.github.io'];
function isAllowedOrigin(origin) {
if (!origin || origin === 'null') return true;
try {
const u = new URL(origin);
if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true; // any port, dev use
return u.protocol === 'https:' && ALLOWED_HOSTS.includes(u.hostname);
} catch (e) { return false; }
}
function corsHeaders(origin) {
const base = { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin' };
if (!origin || origin === 'null') return { 'Access-Control-Allow-Origin': '*', ...base };
const allowedOrigin = isAllowedOrigin(origin) ? origin : 'https://' + ALLOWED_HOSTS[0];
return { 'Access-Control-Allow-Origin': allowedOrigin, ...base };
}

// ====================================================================
// PHOTO VISION HELPERS (/describe) — added 2026-08-22
// The AISA Photo Portal posts one photo; these write the caption,
// description, keywords and the manual section it belongs in.
// ====================================================================

const MAX_PHOTO_B64 = 5600000; // ~4MB of image once base64-decoded

const DEFAULT_PHOTO_CATEGORIES = [
  "MARA", "Herbst", "Herbst-Smith-Type-I", "Herbst-Smith-Type-II",
  "RPE", "MSE", "MARPE", "Schwartz", "Hawley", "Finger-Spring",
  "Bonding", "Brackets", "Instruments", "Archwires", "Elastics",
  "Clinical-Before", "Clinical-After", "Clinical-Progress",
  "Intraoral", "Extraoral", "Ceph", "Panoramic", "Patient-Education", "Office", "Other"
];

async function describePhotoWithGemini({ img, categories, hint, fileName }, env) {
  const systemText = `You are the photo librarian for Next Level Orthodontics' clinical knowledge base (AISA).

Someone uploaded a photo. Describe it accurately enough that a colleague who CANNOT see the image can decide exactly where it belongs in the clinical manual.

RULES:
- Describe only what is actually in the frame. Never name an appliance you cannot clearly see. If it is ambiguous, say so and pick the broader category (e.g. "Intraoral") instead of inventing a specific one.
- Read any text, labels, arrows, packaging or handwriting in the image and quote it exactly.
- Use correct orthodontic vocabulary: arch (maxillary/mandibular), side (right/left), view (occlusal, buccal, lingual, frontal, lateral), tooth identifiers when clearly readable (UR6, LL5), and appliance parts by name (bands, tubes, arms, expander screw, offset bend, hooks, ligatures, elastomerics).
- For patient clinical photos, describe the clinical situation without identifying the patient. Never invent a patient name, age or chart number.
- For supplies, instruments or packaging, name the product and manufacturer only if legible in the image.

Reply with ONLY a JSON object, no markdown fence, with these keys:
  "category": EXACTLY one of: ${categories.join(', ')}
  "caption": short human label, 3-8 words, Title Case, no trailing period (becomes the file name and the [PHOTO:] tag)
  "description": 2-4 sentences — what is shown, from what view, the teaching point, and any visible text. A colleague reads this INSTEAD of seeing the picture, so make it concretely useful.
  "keywords": array of 4-8 lowercase search terms a clinical assistant would type to find this photo
  "confidence": "high" if you are sure what the subject is, "medium" if reasonably sure, "low" if the image is unclear`;

  let ask = 'Describe this photo for the AISA knowledge base.';
  if (fileName) ask += `\nOriginal file name (may or may not be meaningful): "${fileName}"`;
  if (hint) ask += `\nThe uploader added this note — trust it over your own guess where they conflict: "${hint}"`;

  const body = {
	system_instruction: { parts: [{ text: systemText }] },
	contents: [{ role: 'user', parts: [ { text: ask }, { inline_data: { mime_type: img.mimeType, data: img.data } } ] }],
	generationConfig: {
	  temperature: 0.2,
	  maxOutputTokens: 2048,
	  responseMimeType: 'application/json',
	  thinkingConfig: { thinkingLevel: "low" }
	}
  };

  const parsed = await geminiJson(env, body);
  const category = categories.indexOf(parsed.category) >= 0 ? parsed.category : 'Other';
  const caption = String(parsed.caption || 'Untitled Photo').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80);
  return {
	category,
	caption: caption || 'Untitled Photo',
	description: String(parsed.description || '').trim(),
	keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(k => String(k).toLowerCase().slice(0, 40)).slice(0, 8) : [],
	confidence: ['high', 'medium', 'low'].indexOf(parsed.confidence) >= 0 ? parsed.confidence : 'medium'
  };
}

// Finds the manual section this photo illustrates, using the trained files.
async function suggestPhotoPlacement(vision, env) {
  const query = `${vision.caption}. ${vision.description} ${(vision.keywords || []).join(' ')}`.slice(0, 900);
  const context = await retrievePhotoContext(query, env);
  if (!context) return { suggestedSection: '', sectionRationale: '' };

  const body = {
	system_instruction: { parts: [{ text: `You place photos into Next Level Orthodontics' clinical manuals.

You get a photo description plus excerpts from the trained manuals. Name the ONE section the photo best illustrates.

RULES:
- Only name a section that actually appears in the excerpts. Quote its heading or SOP number as written (e.g. "SOP-CL-002 — Herbst Delivery").
- If nothing in the excerpts is a good match, return "" for suggestedSection and use sectionRationale to say in one line what section would need to exist.
- sectionRationale: ONE sentence, 20 words max.

Reply with ONLY a JSON object: {"suggestedSection": "...", "sectionRationale": "..."}` }] },
	contents: [{ role: 'user', parts: [{ text: `PHOTO:\n${query}\n\n=== MANUAL EXCERPTS ===\n${context}` }] }],
	generationConfig: {
	  temperature: 0.1,
	  maxOutputTokens: 1024,
	  responseMimeType: 'application/json',
	  thinkingConfig: { thinkingLevel: "low" }
	}
  };

  const parsed = await geminiJson(env, body);
  return {
	suggestedSection: String(parsed.suggestedSection || '').trim().slice(0, 200),
	sectionRationale: String(parsed.sectionRationale || '').trim().slice(0, 300)
  };
}

// Ranked manual sections for the placement pass (vector search only —
// the full KB is far too big to hand a placement prompt).
async function retrievePhotoContext(query, env) {
  if (!env.VECTORIZE || !env.AI) return '';
  const emb = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [query] });
  const results = await env.VECTORIZE.query(emb.data[0], { topK: 8, returnMetadata: true });
  let out = '';
  for (const m of (results.matches || [])) {
	if (m.metadata && m.metadata.text) out += m.metadata.text.slice(0, 1200) + '\n\n---\n\n';
  }
  return out.slice(0, 12000);
}

// Calls Gemini and parses a JSON object out of the reply.
async function geminiJson(env, body) {
  const resp = await callGemini(env, body, false);
  if (!resp.ok) {
	const errData = await resp.json().catch(() => ({}));
	throw new Error((errData && errData.error && errData.error.message) || `Gemini API error (${resp.status})`);
  }
  const data = await resp.json();
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  let text = '';
  for (const p of parts) { if (typeof p.text === 'string' && !p.thought) text += p.text; }
  text = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  if (!text) throw new Error('Gemini returned an empty response.');
  try { return JSON.parse(text); }
  catch (e) {
	const match = text.match(/\{[\s\S]*\}/);
	if (match) { try { return JSON.parse(match[0]); } catch (e2) {} }
	throw new Error('Could not read the model reply as JSON.');
  }
}
