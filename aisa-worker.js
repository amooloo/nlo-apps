// ====================================================================
// AISA Worker — v2.4 (2026-09-27) — ACCURACY + SPEED UPDATE
// Deployed as the Cloudflare Worker "aisa-worker". This file in the
// nlo-apps repo is the master copy: edit here, then paste into the
// Cloudflare editor (or wrangler deploy). Bindings: AI, VECTORIZE
// (nlo-knowledge), KNOWLEDGE_KV. Secrets: GEMINI_API_KEY, ADMIN_KEY.
//
// v2.4 changes (review of 2026-09-27):
//   1. GROUNDING RULES RESTORED + TIGHTENED. The June 10 rules (never
//      invent contacts; never say "we use X" unless the manual says so)
//      had been lost in the July rewrite. Office-specific facts must now
//      come only from the retrieved excerpts.
//   2. temperature removed (Gemini 3 is tuned for its default; 3.8 Flash
//      ignores it). Consistency comes from the prompt + retrieval.
//   3. "NOTHING FOUND" SIGNAL: excerpts are scored by a reranker; when
//      nothing scores well, AISA is told so and says it can't find it
//      instead of stitching an answer from loosely related text.
//   4. Answer cache only stores COMPLETE answers (no "snag" fallbacks,
//      no cut-off or interrupted streams).
//   5. NEW CHUNKER (v2): every chunk carries its full location
//      (Section › SOP › sub-part), ~1,100 characters with overlap so the
//      whole chunk fits the embedding model, and the table of contents,
//      metadata header and CHANGE LOGs are left out of the index.
//   6. RERANKING + EXACT-CODE MATCH: 50 vector candidates are reranked
//      with @cf/baai/bge-reranker-base; SOP IDs, appointment codes and
//      letter names (SOP-CL-029, code 802, FC- #4) are also matched
//      exactly. Only the best ~8 excerpts go to Gemini.
//   7. SOURCES: answers return the sections they came from (/ask JSON
//      "sources"; /ask-stream header X-AISA-Sources) and every question
//      is logged (retrieval scores, timings, tokens) to Workers Logs.
//   8. Security without a passcode: admin key accepted ONLY in the
//      X-Admin-Key header (no ?key= in URLs), Gemini key sent in a
//      header, per-IP rate limit + daily question cap.
//   9. Staff picker removed from the frontend — answers no longer vary
//      by who is asking, so the answer cache is shared by everyone.
//  10. Model + thinking level are a LIVE SETTING saved from the Training
//      portal ("Save as live" → POST /settings, stored in KV). MODEL /
//      THINKING_LEVEL below are only the fallback. Admins can still A/B a
//      model per request with the X-AISA-Model / X-AISA-Thinking headers.
//      2026-09-27: switched to gemini-3.8-flash (same 37/39 on the check
//      set as 3.5 Flash, ~2.8 s vs ~4.0 s median, lower price).
//  2.4.2 (2026-09-27, vacation-days miss): chunker v3 turns ALL-CAPS
//      handbook headings ("VACATION BENEFITS") into chunk labels and never
//      starts a chunk mid-sentence; "nothing found" now needs BOTH a weak
//      rerank score and a weak vector score (the reranker under-scores
//      tables); prompt: hypothetical "for example, if…" text is not policy,
//      and AISA doesn't know who is asking (give the rule/table, no guess).
//  2.5.0 (2026-09-27, "which software…" missed Weave): OFFICE MAP — on every
//      upload/rebuild Gemini reads the whole manual once (in parts) and
//      writes a short overview: systems & software and what each is for,
//      who handles what, outside partners, and what each section covers.
//      It goes with every question (POST /map builds it, GET /map shows
//      it). Also: the next chunk under the same heading is added after the
//      top matches, and list questions must list everything that applies.
//  11. BLUE/GREEN RETRAINS: /train and the new /reindex build a new
//      index generation first and switch over only when it is complete,
//      so answers never go blank mid-retrain. Old generation is then
//      removed. Thinking-config fallback retries only on thinking errors.
//
// Earlier history: v2.3 (KB version visibility), v2.2 (follow-up-aware
// search, /health), v2.1 (/purge-stale, polite deletes, CORS exact
// match), v2.0 (streaming, answer cache).
// ====================================================================

const WORKER_VERSION = '2.5.0';

// ---------- Model (fallback — the live choice is saved from the portal) ----------
const MODEL = 'gemini-3.8-flash';
const THINKING_LEVEL = 'medium';   // accuracy first (see v2.3.3); low/medium/high
const MODEL_ALLOW = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash'];
const THINKING_ALLOW = ['low', 'medium', 'high'];
const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
const RERANK_MODEL = '@cf/baai/bge-reranker-base';

// ---------- Retrieval ----------
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
const USE_QUERY_PREFIX = true;
const VEC_TOPK = 50;            // max allowed with returnMetadata 'all'
const RERANK_POOL = 30;         // vector candidates sent to the reranker
const CONTEXT_CHUNKS = 8;       // excerpts that go to Gemini
const LOW_CONF_SCORE = 0.2;     // best rerank score below this…
const LOW_CONF_VEC = 0.62;      // …AND best vector similarity below this = "nothing found"
const MIN_KEEP_SCORE = 0.02;    // excerpts below this are dropped (keeping at least 3)
const SOURCE_MIN_SCORE = 0.3;   // only confident excerpts are shown as sources
const NEIGHBOR_CHUNKS = 3;      // continuation chunks added right after the top matches

// ---------- Office map (automatic overview of the whole manual) ----------
const MAP_PART_CHARS = 360000;  // ~90k tokens per extraction call (stays under per-minute token limits)
const MAP_MAX_CHARS = 22000;    // cap on the map sent with each question (~5.5k tokens)
const MAP_TIMEOUT_MS = 170000;

// ---------- Caches / limits ----------
const ANSWER_CACHE_TTL_SECONDS = 6 * 60 * 60;
const RATE_LIMIT_PER_MIN = 30;
const DAILY_QUESTION_CAP = 1000;

// ---------- Index maintenance ----------
const EMBED_BATCH = 50;
const UPSERT_BATCH = 200;
const PURGE_RANGE_MAX = 4000;
const PURGE_TOPK = 50;
const DELETE_BATCH_SIZE = 500;
const DELETE_PACE_MS = 400;

// Per-isolate memory caches
let ANS_GEN = { val: '0', ts: 0 };
let KB_VER = { val: null, ts: 0 };
let IDX_STATE = { ts: 0 };
let CSTORE = new Map();
let RATE_BUCKET = new Map();
let USAGE = { day: '', count: 0, ts: 0 };
let LIVE = { kv: null, ts: 0, model: MODEL, thinking: THINKING_LEVEL, updatedAt: null };
let MAP_CACHE = { kv: null, ts: 0, val: null };

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ---------- Public ----------
      if (path === '/version' && request.method === 'GET') {
        let v = null;
        try { v = env.KNOWLEDGE_KV ? await getKbVersion(env) : null; } catch (e) {}
        // Warm this isolate's search caches for the first question (page load calls /version).
        if (ctx && ctx.waitUntil) ctx.waitUntil(warmCaches(env).catch(() => {}));
        return jsonResponse(Object.assign({ worker: WORKER_VERSION }, v || { version: null, note: 'No VERSION line found in the stored KB yet.' }), 200, origin);
      }

      if ((path === '/ask' || path === '/ask-stream') && request.method === 'POST') {
        return await handleAsk(request, env, ctx, origin, path === '/ask-stream');
      }

      // ---------- Admin (X-Admin-Key header only) ----------
      const adminRoutes = ['/train', '/reindex', '/files', '/health', '/delete-file', '/purge-stale', '/describe', '/settings', '/map'];
      if (adminRoutes.includes(path)) {
        if (!checkAdmin(request, env)) return jsonResponse({ success: false, error: 'Unauthorized — send the admin key in the X-Admin-Key header.' }, 401, origin);
        if (path === '/train' && request.method === 'POST') return await handleTrain(request, env, origin);
        if (path === '/reindex' && request.method === 'POST') return await handleReindex(request, env, origin);
        if (path === '/files' && request.method === 'GET') return await handleFiles(env, origin);
        if (path === '/health' && request.method === 'GET') return await handleHealth(env, origin);
        if (path === '/delete-file' && request.method === 'POST') return await handleDeleteFile(request, env, origin);
        if (path === '/purge-stale' && (request.method === 'POST' || request.method === 'GET')) return await handlePurgeStale(env, origin);
        if (path === '/describe' && request.method === 'POST') return await handleDescribe(request, env, origin);
        if (path === '/settings' && request.method === 'POST') return await handleSettings(request, env, origin);
        if (path === '/settings' && request.method === 'GET') return jsonResponse(settingsView(await getLiveSettings(env)), 200, origin);
        if (path === '/map' && request.method === 'POST') return await handleMapBuild(request, env, origin);
        if (path === '/map' && request.method === 'GET') return await handleMapGet(env, origin);
      }

      if (path === '/purge-old') return jsonResponse({ error: 'Retired: use /purge-stale (or /reindex, which cleans up automatically).' }, 410, origin);

      return new Response('NLO Worker is Running!', { headers: { 'Content-Type': 'text/plain', ...corsHeaders(origin) } });
    } catch (err) {
      console.error('Worker error on ' + path + ':', err && err.stack || err);
      return jsonResponse({ error: (err && err.message) || 'Unexpected error' }, 500, origin);
    }
  }
};

// ====================================================================
// ASK (/ask and /ask-stream)
// ====================================================================
async function handleAsk(request, env, ctx, origin, stream) {
  const t0 = Date.now();
  if (rateLimit(request)) return jsonResponse({ error: 'Too many requests — please wait a moment.' }, 429, origin);
  let reqJson;
  try { reqJson = await request.json(); } catch (e) { return jsonResponse({ error: 'Invalid JSON body' }, 400, origin); }
  const bad = validateAsk(reqJson);
  if (bad) return jsonResponse({ error: bad }, 400, origin);

  // Live model/thinking (saved from the portal), plus admin-only per-request
  // overrides for A/B testing (overrides bypass the answer cache).
  const live = await getLiveSettings(env);
  const isAdmin = checkAdmin(request, env);
  const model = (isAdmin && MODEL_ALLOW.includes(request.headers.get('X-AISA-Model') || '')) ? request.headers.get('X-AISA-Model') : live.model;
  const thinking = (isAdmin && THINKING_ALLOW.includes((request.headers.get('X-AISA-Thinking') || '').toLowerCase())) ? request.headers.get('X-AISA-Thinking').toLowerCase() : live.thinking;
  const overridden = model !== live.model || thinking !== live.thinking;
  const noCache = overridden || (isAdmin && request.headers.get('X-AISA-No-Cache') === '1');

  // 1) Answer cache (keyed by model + thinking, so a model switch never serves old answers)
  const cacheKey = noCache ? null : await answerCacheKey(reqJson, env, model, thinking);
  if (cacheKey) {
    let hit = null;
    try { hit = await env.KNOWLEDGE_KV.get(cacheKey, 'json'); } catch (e) {}
    if (hit && hit.a) {
      logEvent(ctx, { evt: 'ask', cached: true, q: reqJson.question.slice(0, 150), ms: Date.now() - t0 });
      if (stream) return new Response(hit.a, { headers: { ...textHeaders(origin), 'X-AISA-Sources': encodeSources(hit.s), 'X-AISA-Cache': 'hit' } });
      return jsonResponse({ answer: hit.a, sources: hit.s || [], cached: true }, 200, origin);
    }
  }

  // 2) Daily cap (cost guard — no passcode on this app)
  if (await overDailyCap(env)) {
    return jsonResponse({ error: 'AISA has reached its daily question limit. Please try again tomorrow or let Dr. Akhavan know.' }, 429, origin);
  }
  countQuestion(env, ctx);

  // 3) Retrieval
  const r = await retrieve(reqJson, env);
  const tRetrieved = Date.now();

  // 4) Gemini
  const geminiBody = await buildGeminiBody(reqJson, env, r, thinking);
  const meta = {
    evt: 'ask', q: reqJson.question.slice(0, 150), model, thinking, mode: r.mode,
    lowConfidence: r.lowConfidence, topScore: round3(r.topScore), topVec: round3(r.topVec), exact: r.exactTokens,
    top: r.chosen.slice(0, 5).map(c => ({ s: round3(c.rr), v: round3(c.vs), p: c.path.slice(0, 90) })),
    ms: { retrieval: tRetrieved - t0, embed: r.ms.embed, vector: r.ms.vector, rerank: r.ms.rerank }
  };

  if (!stream) {
    const resp = await callGemini(env, geminiBody, false, model);
    if (!resp.ok) {
      const errMsg = await geminiError(resp);
      logEvent(ctx, Object.assign(meta, { error: errMsg, ms: Object.assign(meta.ms, { total: Date.now() - t0 }) }));
      return jsonResponse({ error: errMsg }, 502, origin);
    }
    const data = await resp.json();
    const cand = (data.candidates && data.candidates[0]) || {};
    const parts = (cand.content && cand.content.parts) || [];
    let answer = parts.filter(p => !p.thought).map(p => p.text || '').join('');
    const complete = !!answer.trim() && cand.finishReason === 'STOP';
    if (!answer.trim()) answer = "I'm sorry, I hit a snag. Can you try again?";
    answer = cleanAnswer(answer);
    if (cand.finishReason === 'MAX_TOKENS') answer += "\n\n*(I hit my answer length limit — ask me to continue and I'll pick up where I left off.)*";
    if (cacheKey && complete && !r.degraded) {
      const put = env.KNOWLEDGE_KV.put(cacheKey, JSON.stringify({ a: answer, s: r.sources }), { expirationTtl: ANSWER_CACHE_TTL_SECONDS }).catch(() => {});
      if (ctx && ctx.waitUntil) ctx.waitUntil(put);
    }
    logEvent(ctx, Object.assign(meta, { finish: cand.finishReason, tokens: usageOf(data.usageMetadata), ms: Object.assign(meta.ms, { total: Date.now() - t0 }) }));
    return jsonResponse({ answer, sources: r.sources }, 200, origin);
  }

  const resp = await callGemini(env, geminiBody, true, model);
  if (!resp.ok || !resp.body) {
    const errMsg = await geminiError(resp);
    logEvent(ctx, Object.assign(meta, { error: errMsg, ms: Object.assign(meta.ms, { total: Date.now() - t0 }) }));
    return jsonResponse({ error: errMsg }, 502, origin);
  }
  const { readable, writable } = new TransformStream();
  const pump = streamSseToText(resp.body, writable, async (res) => {
    if (cacheKey && res.complete && res.full.trim() && !r.degraded) {
      try { await env.KNOWLEDGE_KV.put(cacheKey, JSON.stringify({ a: cleanAnswer(res.full), s: r.sources }), { expirationTtl: ANSWER_CACHE_TTL_SECONDS }); } catch (e) {}
    }
    logEvent(null, Object.assign(meta, { finish: res.finishReason, clientGone: res.clientGone, tokens: usageOf(res.usage), ms: Object.assign(meta.ms, { firstToken: res.firstTokenAt ? res.firstTokenAt - t0 : null, total: Date.now() - t0 }) }));
  });
  if (ctx && ctx.waitUntil) ctx.waitUntil(pump);
  return new Response(readable, { headers: { ...textHeaders(origin), 'X-AISA-Sources': encodeSources(r.sources), 'X-AISA-Cache': 'miss' } });
}

function validateAsk(reqJson) {
  if (!reqJson || !reqJson.question || typeof reqJson.question !== 'string' || !reqJson.question.trim()) return 'Missing "question" field';
  if (reqJson.question.length > 4000) return 'Question too long (max 4000 characters)';
  if (reqJson.image && reqJson.image.data && reqJson.image.data.length > 2800000) return 'Image too large (max ~2MB)';
  return null;
}

// ====================================================================
// RETRIEVAL — vector search → exact-code match → rerank → best excerpts
// ====================================================================
async function retrieve(reqJson, env) {
  const { question, history } = reqJson;
  const searchQuery = buildSearchQuery(question, history);
  const out = { mode: 'none', chosen: [], sources: [], lowConfidence: true, topScore: 0, topVec: 0, exactTokens: [], degraded: false, ms: {} };
  if (!env.VECTORIZE || !env.AI) { out.degraded = true; return out; }

  let t = Date.now();
  const [emb, idx] = await Promise.all([
    env.AI.run(EMBED_MODEL, { text: [(USE_QUERY_PREFIX ? QUERY_PREFIX : '') + searchQuery] }),
    getIndexState(env)
  ]);
  out.ms.embed = Date.now() - t;
  out.mode = idx.mode;

  t = Date.now();
  const res = await env.VECTORIZE.query(emb.data[0], { topK: VEC_TOPK, returnMetadata: 'all' });
  out.ms.vector = Date.now() - t;

  // Vector candidates. Prefer the active index generation; during a
  // switch-over (or before the first v2 reindex) accept whatever exists.
  const seen = new Set();
  const all = [];
  for (const m of (res.matches || [])) {
    const text = m.metadata && m.metadata.text;
    if (!text) continue;
    if (seen.has(text)) continue;   // same text in two generations = one candidate
    seen.add(text);
    all.push({ id: m.id, vs: m.score, text, path: pathOf(text), active: isActiveId(m.id, idx) });
  }
  out.topVec = all.reduce((m, c) => Math.max(m, c.vs || 0), 0);
  let pool = all.filter(c => c.active);
  if (pool.length < 8) pool = all;
  pool = pool.slice(0, RERANK_POOL);

  // Exact-code matches (SOP IDs, appointment codes, letter names, CDT codes, quoted phrases)
  const tokens = exactTokens(question);
  out.exactTokens = tokens.map(x => x.label);
  const exactHits = [];
  if (tokens.length && Object.keys(idx.labels).length) {
    const hits = await lexicalSearch(env, idx, tokens);
    for (const h of hits) {
      const existing = pool.find(c => c.text === h.text);
      if (existing) { existing.exact = true; exactHits.push(existing); continue; }
      const c = { id: h.id, vs: 0, text: h.text, path: pathOf(h.text), active: true, exact: true };
      pool.push(c); exactHits.push(c);
    }
  }

  // Rerank
  t = Date.now();
  let ranked;
  if (!pool.length) {
    out.ms.rerank = 0;
    return out; // nothing retrieved — lowConfidence stays true
  }
  try {
    const rr = await env.AI.run(RERANK_MODEL, { query: searchQuery.slice(0, 1000), contexts: pool.map(c => ({ text: c.text.slice(0, 1800) })) });
    const list = (rr && (rr.response || rr.result || rr.data)) || [];
    for (const item of list) {
      const i = (item.id !== undefined ? item.id : item.index);
      if (pool[i]) pool[i].rr = typeof item.score === 'number' ? item.score : 0;
    }
    ranked = pool.map(c => Object.assign(c, { rr: c.rr || 0 })).sort((a, b) => b.rr - a.rr);
  } catch (e) {
    console.error('Rerank failed — using vector order:', e && e.message);
    out.degraded = true;
    ranked = pool.map(c => Object.assign(c, { rr: c.vs })).sort((a, b) => b.rr - a.rr);
  }
  out.ms.rerank = Date.now() - t;

  let chosen = ranked.slice(0, CONTEXT_CHUNKS);
  let forced = 0;
  for (const h of exactHits.sort((a, b) => b.rr - a.rr)) {
    if (!chosen.includes(h) && forced < 3) { chosen.push(h); forced++; }
  }
  chosen = chosen.filter((c, k) => k < 3 || c.exact || c.rr >= MIN_KEEP_SCORE);

  // Small-to-big: bring the next chunk under the same heading right after each
  // of the top matches, so a table's rules or a procedure's next steps come along.
  if (idx.mode === 'v2' && chosen.length) {
    const expanded = [];
    let added = 0;
    for (let k = 0; k < chosen.length; k++) {
      const c = chosen[k];
      expanded.push(c);
      if (k >= 3 || added >= NEIGHBOR_CHUNKS || c.neighbor) continue;
      const loc = locateId(c.id, idx);
      if (!loc) continue;
      const store = await getChunkStore(env, loc.label, loc.gen);
      const next = store && store[loc.i + 1];
      if (!next || pathOf(next) !== c.path || chosen.some(x => x.text === next) || expanded.some(x => x.text === next)) continue;
      expanded.push({ id: vecId(loc.label, loc.gen, loc.i + 1), vs: 0, rr: c.rr, text: next, path: c.path, active: true, neighbor: true });
      added++;
    }
    chosen = expanded;
  }

  out.topScore = ranked.length ? ranked[0].rr : 0;
  // "Nothing found" only when the reranker AND the vector search both come up weak —
  // the small reranker under-scores tables (e.g. the vacation accrual table).
  out.lowConfidence = out.degraded ? false : (out.topScore < LOW_CONF_SCORE && out.topVec < LOW_CONF_VEC && !exactHits.length);
  out.chosen = chosen;
  out.sources = out.lowConfidence ? [] : sourcesOf(chosen);
  return out;
}

// Follow-ups like "what about step 3?" match nothing on their own — blend
// in the previous user question. Current question first (survives truncation).
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

function exactTokens(question) {
  const q = String(question || '');
  const out = [];
  const add = (label, re) => { if (!out.some(x => x.label === label)) out.push({ label, re }); };
  for (const m of q.matchAll(/\bSOP[-\s]?([A-Z]{2,5})[-\s]?(\d{1,3})([A-Z]?)\b/gi)) {
    const id = ('SOP-' + m[1] + '-' + m[2].padStart(3, '0') + m[3]).toUpperCase();
    add(id, new RegExp('\\b' + id + '\\b', 'i'));
  }
  for (const m of q.matchAll(/\bcode\s*#?\s*(\d{3})\b/gi)) add('Code ' + m[1], new RegExp('\\b(code:?\\s*#?\\s*' + m[1] + '|' + m[1] + '\\s*=)', 'i'));
  for (const m of q.matchAll(/\b(FC|SC|AC|TC)\s*-?\s*#\s*(\d{1,2})\b/gi)) add(m[1].toUpperCase() + '- #' + m[2], new RegExp('\\b' + m[1] + '\\s*-\\s*#\\s*' + m[2] + '\\b', 'i'));
  for (const m of q.matchAll(/\bD\d{4}\b/g)) add(m[0], new RegExp('\\b' + m[0] + '\\b'));
  for (const m of q.matchAll(/["“]([^"”]{4,60})["”]/g)) add('"' + m[1] + '"', new RegExp(m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  return out.slice(0, 4);
}

async function lexicalSearch(env, idx, tokens) {
  const hits = [];
  for (const label of Object.keys(idx.labels)) {
    const rec = idx.labels[label];
    const store = await getChunkStore(env, label, rec.gen);
    if (!store) continue;
    for (const tok of tokens) {
      const inPath = [], inBody = [];
      for (let i = 0; i < store.length; i++) {
        const text = store[i];
        if (!tok.re.test(text)) continue;
        const nl = text.indexOf('\n');
        (tok.re.test(nl > 0 ? text.slice(0, nl) : '') ? inPath : inBody).push(i);
        if (inPath.length >= 4) break;
      }
      const pick = inPath.length ? inPath.slice(0, 3) : inBody.slice(0, 3);
      for (const i of pick) hits.push({ id: vecId(label, rec.gen, i), text: store[i] });
    }
  }
  return hits.slice(0, 6);
}

function pathOf(text) {
  const m = String(text).match(/^\[([^\]\n]{1,300})\]/);
  if (!m) return '';
  return m[1].replace(/^Source:\s*/i, '').replace(/\s*\|\s*Section:\s*/i, ' › ');
}

function sourcesOf(chosen) {
  const out = [];
  for (const c of chosen) {
    if (out.length >= 3) break;
    if (!(c.rr >= SOURCE_MIN_SCORE || c.exact) || !c.path) continue;
    const parts = c.path.split(' › ');
    const sop = (c.path.match(/\bSOP-[A-Z]{2,5}-\d{2,3}[A-Z]?\b/) || [])[0];
    let label;
    if (sop) {
      const withSop = parts.find(p => p.includes(sop)) || sop;
      label = withSop.length > 70 ? withSop.slice(0, 67) + '…' : withSop;
    } else {
      const sec = parts[0].replace(/^Section\s+/i, '§');
      const leaf = parts.length > 1 ? parts[parts.length - 1] : '';
      label = leaf && !/^FAQ|^NEGATIVE/i.test(leaf) ? (sec.split(' — ')[0] + ' · ' + leaf) : sec;
      if (label.length > 70) label = label.slice(0, 67) + '…';
    }
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

function encodeSources(s) {
  try { return encodeURIComponent(JSON.stringify(Array.isArray(s) ? s : [])); } catch (e) { return '%5B%5D'; }
}

// ====================================================================
// PROMPT
// ====================================================================
async function buildGeminiBody(reqJson, env, r, thinking) {
  const { question, inventoryData, history, image } = reqJson;

  const kbVer = env.KNOWLEDGE_KV ? await getKbVersion(env) : null;
  const versionLine = (kbVer && kbVer.version)
    ? `\nAUTHORITATIVE VERSION INFO (injected by the system, always current): You are running NLO Master Knowledge Base VERSION ${kbVer.version}${kbVer.lastUpdated ? ', last updated ' + kbVer.lastUpdated : ''}. If anyone asks what version you are or how current your knowledge is, answer with exactly this version — it overrides any version number found in the excerpts.\n`
    : '';

  const officeMap = env.KNOWLEDGE_KV ? await getOfficeMap(env) : null;
  const mapBlock = (officeMap && officeMap.text)
    ? `\n=== OFFICE MAP (automatic overview of the whole manual, rebuilt on every upload) ===\n${officeMap.text.trim()}\n`
    : '';

  let knowledge = '';
  r.chosen.forEach((c, k) => { knowledge += `\n--- Excerpt ${k + 1} ---\n${c.text.trim()}\n`; });
  if (!knowledge) knowledge = '\n(No excerpts were retrieved for this question.)\n';
  const searchNote = r.lowConfidence
    ? '\nSEARCH NOTE: The manual search found nothing that closely matches this question. If it asks how OUR office does something (a protocol, setting, product, fee, code, schedule, policy, person or contact) and no excerpt below clearly answers it, reply with the not-found line from the GROUNDING rules instead of filling the gap. General dental/orthodontic knowledge, questions about an attached image, and casual conversation can still be answered normally (label general knowledge as general).\n'
    : '';

  const systemInstruction = `You are AISA, a friendly and experienced Senior Clinical Assistant at Next Level Orthodontics.
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
- Exception: when asked WHICH or WHAT tools, apps, software, people, partners, options or steps — list every one that applies (one short line each). Don't stop at the "main" ones.

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
- Use numbered lists for multi-step procedures. Keep each step to one line when possible.

**FOUNDATIONAL DENTAL/ORTHODONTIC knowledge** (tooth numbering, anatomy, basic terminology, general dental concepts):
- Do NOT cite SOP numbers or references. This is standard dental knowledge, not an office-specific protocol.
- Answer naturally and directly like a knowledgeable colleague would.

**NON-CLINICAL content** (staff bios, birthdays, fun facts, team-building ideas, gift suggestions, office culture, general conversation):
- Be creative, warm, and personable — like a friendly coworker chatting.
- Do NOT cite SOP numbers or section references. These are not procedures.
- Brainstorming (gift ideas, team activities) can be creative and can use what the staff bios say about the person being discussed — but never invent facts about a person (birthdays, titles, start dates, family details).

BEHAVIOR:
1. CLARIFY ONLY WHEN IT MATTERS:
   - If the question is specific, just answer it (e.g., "How many turns for a standalone RPE?" → 28).
   - If the answer depends on the situation and the options fit in 2-3 short bullets, give each option briefly instead of asking.
   - Ask ONE short clarifying question (offering 2-4 options) only when covering every option would be long or could mislead.

2. ANSWER THE SPECIFIC QUESTION:
   - Give ONLY the information needed to answer the question. Nothing extra. Nothing "while we're on the topic."
   - Aim for the SHORTEST correct answer. Walls of text = bad. Short and scannable = good.

3. CHAT HISTORY: You have access to the recent conversation. Use it to stay in context.

4. GROUNDING — THESE RULES COME BEFORE EVERYTHING ELSE ABOUT CONTENT:
   a. Office-specific facts — names, phone numbers, emails, addresses, fees, codes, appointment lengths, products and brands, materials, machine settings, protocol steps, timings and counts (turns, swings, weeks, seconds) — must come ONLY from the knowledge base excerpts or the OFFICE MAP below. Never fill a gap with a "typical" value.
   b. NEVER invent contact details. Give a name, phone number, email or address only if it appears in the excerpts. If it is not there, say you don't have it on file and suggest checking with Sarah or Dr. Akhavan.
   c. NEVER say or imply that the office uses a product, brand, device, material or technique unless the excerpts say so. General dental knowledge must be labeled as general ("In general, ..."), never phrased as "we use" or "our office".
   d. General orthodontic knowledge is fine for definitions and background (the FOUNDATIONAL category), clearly labeled as general.
   e. If the excerpts don't contain the answer, say: "I'm not finding that specific detail in our manuals yet. I can flag that for Dr. Akhavan, or is there something else I can help with?" Do not guess. If they answer only part of the question, give that part and say in a few words what the manual doesn't cover — don't tack the not-found line onto a real answer.
   f. Excerpts labeled NEGATIVE EXAMPLES contain statements marked INCORRECT on purpose. Never repeat an INCORRECT line as fact — use the CORRECT line.
   g. If two excerpts conflict, follow the more specific SOP, mention the discrepancy in one short line, and suggest confirming with Dr. Akhavan.
   h. Each excerpt starts with its location in the manual in [brackets]. Use it to judge which excerpt applies (e.g., MARPE vs RPE, braces vs aligners) and to cite the SOP.
   i. Hypothetical examples in the manual ("For example, if full-time employees earn 1 week…") only illustrate a rule — they are NOT the office's actual numbers. Use the actual policy text or table instead.
   j. You don't know who is asking. When the answer depends on the person (years of service, role, full-/part-time, schedule), give the rule or table that applies to each case — don't assume their situation. Show the manual's units (e.g. hours); if you convert (hours to days), say what you assumed.
   k. The OFFICE MAP is an automatic overview of the WHOLE manual (every system and what it's for, who handles what, outside partners, what each section covers). Use it for broad questions ("which software/apps do we use for…", "who handles…", "which labs…") and to make sure a list is complete — then add details from the excerpts. For specific steps, numbers, settings and template names rely on the excerpts; if only the map mentions something, say so briefly and name its section.

5. IMAGES: If the user has attached an image, analyze it in context of their question (e.g., identifying orthodontic supplies, reading labels, checking equipment).

6. MEDIA REFERENCES: The knowledge base contains photo references in this format:
   [PHOTO: Description]
   https://drive.google.com/thumbnail?id=XXXXX&sz=w800
   When you see this pattern in the excerpts, you MUST include the photo in your response using Markdown image syntax: ![Description](URL)
   IMPORTANT: Always include ALL relevant photos from the excerpts. ONLY use the ![Description](URL) markdown syntax. Do NOT also print raw URLs or [PHOTO:] tags.
   - For VIDEOS: Use a regular Markdown link: [Watch: Video title](URL)
   - For DOCUMENTS: Use a regular Markdown link: [View: Document title](URL)

7. PRIVACY: Do not ask for or repeat patient names or other patient identifiers. If a question includes them, answer the general question without repeating the identifiers.
${mapBlock}${searchNote}
=== KNOWLEDGE BASE EXCERPTS (most relevant first) ===
${knowledge}`;

  let userMessageText = '';
  if (inventoryData) userMessageText += `=== LIVE INVENTORY DATA ===\n${String(inventoryData).slice(0, 20000)}\n`;
  userMessageText += `\n=== USER QUESTION ===\n${question}`;

  const userParts = [{ text: userMessageText }];
  if (image && image.data && image.mimeType) userParts.push({ inline_data: { mime_type: image.mimeType, data: image.data } });

  const contents = [];
  if (Array.isArray(history)) {
    for (const turn of history.slice(-12)) {
      if (turn && Array.isArray(turn.parts) && (turn.role === 'user' || turn.role === 'model')) {
        contents.push({ role: turn.role, parts: turn.parts.map(p => ({ text: String((p && p.text) || '') })) });
      }
    }
  }
  contents.push({ role: 'user', parts: userParts });

  return {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: {
      // No temperature: Gemini 3 models are tuned for their default.
      // Thinking tokens share maxOutputTokens — this is a runaway guard, not a length target.
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingLevel: thinking || THINKING_LEVEL }
    }
  };
}

// ====================================================================
// GEMINI
// ====================================================================
async function callGemini(env, body, stream, model, timeoutMs) {
  const endpoint = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || MODEL}:${endpoint}`;
  const doFetch = async (b) => {
    // Time out if Gemini doesn't START responding within 45s. Streams are
    // not cut once they begin (long answers must be allowed to finish).
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 45000);
    try {
      return await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: JSON.stringify(b), signal: ctrl.signal });
    } finally { clearTimeout(timer); }
  };
  let resp = await doFetch(body);
  if (!resp.ok && body.generationConfig && body.generationConfig.thinkingConfig) {
    let errText = '';
    try { errText = await resp.clone().text(); } catch (e) {}
    if (/thinking/i.test(errText)) {
      const fallback = { ...body, generationConfig: { ...body.generationConfig } };
      delete fallback.generationConfig.thinkingConfig;
      console.error('Gemini rejected thinkingConfig — retrying without it:', errText.slice(0, 300));
      resp = await doFetch(fallback);
    }
  }
  return resp;
}

async function geminiError(resp) {
  let msg = '';
  try { const d = await resp.json(); msg = d && d.error && d.error.message; } catch (e) {}
  return msg || `Gemini API error (${resp.status})`;
}

function usageOf(u) {
  if (!u) return null;
  return { in: u.promptTokenCount || 0, out: u.candidatesTokenCount || 0, think: u.thoughtsTokenCount || 0, cached: u.cachedContentTokenCount || 0 };
}

// Line-level noise check shared by cleanAnswer and the stream filter
function isNoiseLine(trimmed) {
  if (/^https:\/\/drive\.google\.com\/thumbnail/.test(trimmed)) return true;
  if (trimmed.includes('loading="lazy"')) return true;
  if (/^\[PHOTO:[^\]]*\]$/.test(trimmed)) return true;
  return false;
}
function cleanAnswer(text) {
  return text.split('\n').filter(line => !isNoiseLine(line.trim())).join('\n').replace(/\[PHOTO:[^\]]*\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}
function photoTagHoldPoint(s) {
  const i = s.lastIndexOf('[');
  if (i === -1) return s.length;
  const tail = s.slice(i);
  if (tail.includes(']')) return s.length;
  return ('[PHOTO:'.startsWith(tail) || tail.startsWith('[PHOTO:')) ? i : s.length;
}
function couldBecomeNoise(partial) {
  const t = partial.trimStart();
  if (!t) return false;
  for (const p of ['https://drive.google.com/thumbnail', '[PHOTO:']) { if (p.startsWith(t) || t.startsWith(p)) return true; }
  return t.includes('loading="lazy"');
}

// Convert Gemini's SSE stream into plain-text chunks (same noise filter as /ask).
// onDone receives { full, complete, finishReason, usage, clientGone, firstTokenAt }.
async function streamSseToText(sseBody, writable, onDone) {
  const writer = writable.getWriter();
  const reader = sseBody.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buf = '', lineBuf = '', full = '';
  let finishReason = null, usage = null, clientGone = false, errored = false, firstTokenAt = null;
  const emit = async (text) => {
    if (!text || clientGone) return;
    if (!firstTokenAt) firstTokenAt = Date.now();
    try { await writer.write(encoder.encode(text)); } catch (e) { clientGone = true; }
  };
  const handleText = async (text) => {
    full += text; lineBuf += text;
    let nl;
    while ((nl = lineBuf.indexOf('\n')) !== -1) {
      const line = lineBuf.slice(0, nl);
      lineBuf = lineBuf.slice(nl + 1);
      if (!isNoiseLine(line.trim())) await emit(line.replace(/\[PHOTO:[^\]]*\]/g, '') + '\n');
    }
    if (lineBuf && !couldBecomeNoise(lineBuf)) {
      const cut = photoTagHoldPoint(lineBuf); // keep a half-received "[PHOTO:" tag back
      await emit(lineBuf.slice(0, cut).replace(/\[PHOTO:[^\]]*\]/g, ''));
      lineBuf = lineBuf.slice(cut);
    }
  };
  const handleSseLine = async (line) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let json;
    try { json = JSON.parse(data); } catch (e) { return; }
    const cand = json.candidates && json.candidates[0];
    if (cand && cand.finishReason) finishReason = cand.finishReason;
    if (json.usageMetadata) usage = json.usageMetadata;
    const parts = (cand && cand.content && cand.content.parts) || [];
    for (const p of parts) { if (p.text && !p.thought) await handleText(p.text); }
  };
  try {
    while (true) {
      if (clientGone) { try { await reader.cancel(); } catch (e) {} break; }
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
    if (buf.trim()) await handleSseLine(buf.trim());
    if (lineBuf && !isNoiseLine(lineBuf.trim())) await emit(lineBuf.replace(/\[PHOTO:[^\]]*\]/g, ''));
    if (finishReason === 'MAX_TOKENS') {
      const notice = "\n\n*(I hit my answer length limit — ask me to continue and I'll pick up where I left off.)*";
      full += notice; await emit(notice);
    }
  } catch (e) {
    errored = true;
    console.error('Stream pump error:', e && e.message);
  } finally {
    try { await writer.close(); } catch (e) {}
    const complete = !errored && !clientGone && finishReason === 'STOP';
    if (onDone) { try { await onDone({ full, complete, finishReason, usage, clientGone, firstTokenAt }); } catch (e) {} }
  }
}

// ====================================================================
// TRAINING / INDEX MAINTENANCE (admin)
// ====================================================================
async function handleTrain(request, env, origin) {
  const { text, fileLabel } = await request.json();
  if (!text || typeof text !== 'string') return jsonResponse({ success: false, error: 'Missing "text"' }, 400, origin);
  const label = labelOf(fileLabel || text.substring(0, 50));
  if (!label) return jsonResponse({ success: false, error: 'Missing fileLabel' }, 400, origin);
  await env.KNOWLEDGE_KV.put(`file:${label}`, text);
  const fileIndex = await getFileIndex(env);
  if (!fileIndex.includes(label)) { fileIndex.push(label); await env.KNOWLEDGE_KV.put('__file_index__', JSON.stringify(fileIndex)); }
  await recordKbVersion(env, text, label);
  const result = await reindexLabel(env, label, text, fileLabel || label);
  await bumpAnswerGen(env);
  return jsonResponse({ success: true, fileLabel: label, chunksSaved: result.chunks, gen: result.gen, oldVectorsDeleted: result.deletedOld, cleanupPending: result.rateLimited, chunker: CHUNKER_VERSION }, 200, origin);
}

async function handleReindex(request, env, origin) {
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const fileIndex = await getFileIndex(env);
  const targets = body && body.fileLabel ? [labelOf(body.fileLabel)] : fileIndex;
  const results = [];
  for (const label of targets) {
    const text = await env.KNOWLEDGE_KV.get(`file:${label}`);
    if (!text) { results.push({ label, error: 'No stored text for this label' }); continue; }
    if (/^VERSION:/mi.test(text)) await recordKbVersion(env, text, label);
    results.push(await reindexLabel(env, label, text, label));
  }
  await bumpAnswerGen(env);
  return jsonResponse({ success: results.every(r => !r.error), chunker: CHUNKER_VERSION, results }, 200, origin);
}

// Build a complete new generation, switch to it, then delete the old one.
async function reindexLabel(env, label, text, fileTitle) {
  const chunks = buildChunksV2(text, prettyTitle(fileTitle));
  const gen = Date.now().toString(36);
  let pending = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const emb = await aiRunWithRetry(env, EMBED_MODEL, { text: batch.map(c => c.text) });
    batch.forEach((c, k) => pending.push({ id: vecId(label, gen, i + k), values: emb.data[k], metadata: { text: c.text, fileLabel: label, gen } }));
    if (pending.length >= UPSERT_BATCH || i + EMBED_BATCH >= chunks.length) {
      await upsertWithRetry(env, pending);
      pending = [];
    }
  }
  await env.KNOWLEDGE_KV.put(`cstore:${label}:${gen}`, JSON.stringify(chunks.map(c => c.text)));

  const prev = await env.KNOWLEDGE_KV.get(`idx:${label}`, 'json');
  const legacyCount = parseInt((await env.KNOWLEDGE_KV.get(`chunks:${label}`)) || '0', 10) || 0;
  await env.KNOWLEDGE_KV.put(`idx:${label}`, JSON.stringify({ gen, count: chunks.length, chunker: CHUNKER_VERSION, builtAt: new Date().toISOString() }));
  IDX_STATE = { ts: 0 };

  // Remove the previous generation (new format) or the legacy vectors.
  const state = { deleted: 0, rateLimited: false };
  const oldIds = [];
  if (prev && prev.gen && prev.gen !== gen) {
    for (let j = 0; j < (prev.count || 0) + 50; j++) oldIds.push(vecId(label, prev.gen, j));
  } else if (!prev) {
    const upTo = Math.max(legacyCount, 3000) + 100;
    for (let j = 0; j < upTo; j++) oldIds.push(`${label}_chunk_${j}`);
  }
  if (oldIds.length) await politeDeleteByIds(env, oldIds, state);
  if (!state.rateLimited) {
    if (prev && prev.gen && prev.gen !== gen) { try { await env.KNOWLEDGE_KV.delete(`cstore:${label}:${prev.gen}`); } catch (e) {} }
    if (!prev) { try { await env.KNOWLEDGE_KV.delete(`chunks:${label}`); } catch (e) {} }
  }
  return { label, gen, chunks: chunks.length, deletedOld: state.deleted, rateLimited: state.rateLimited };
}

async function handleFiles(env, origin) {
  const fileIndex = await getFileIndex(env);
  const files = await Promise.all(fileIndex.map(async (label) => {
    const [text, rec] = await Promise.all([env.KNOWLEDGE_KV.get(`file:${label}`), env.KNOWLEDGE_KV.get(`idx:${label}`, 'json')]);
    return { label, characters: text ? text.length : 0, index: rec || 'legacy (not yet rebuilt)' };
  }));
  const live = await getLiveSettings(env);
  return jsonResponse({ worker: WORKER_VERSION, model: live.model, thinking: live.thinking, fileCount: files.length, files }, 200, origin);
}

async function handleHealth(env, origin) {
  const live = await getLiveSettings(env, true);
  const out = { ok: true, worker: WORKER_VERSION, model: live.model, thinking: live.thinking, live: settingsView(live), chunker: CHUNKER_VERSION, time: new Date().toISOString() };
  try {
    const idx = await getIndexState(env, true);
    out.searchMode = idx.mode === 'v2' ? 'v2 (rebuilt index)' : 'legacy (run Rebuild index)';
    out.files = idx.fileIndex.map(l => ({ label: l, index: idx.labels[l] || null }));
    out.expectedVectors = Object.values(idx.labels).reduce((s, r) => s + (r.count || 0), 0) || null;
    out.rebuildRecommended = idx.fileIndex.some(l => !idx.labels[l] || idx.labels[l].chunker !== CHUNKER_VERSION);
    const m = await getOfficeMap(env, true);
    out.officeMap = m ? { builtAt: m.builtAt, words: m.words, parts: m.parts, kbVersion: m.kbVersion || null, stale: m.sig !== mapSignature(idx) } : null;
    const job = await env.KNOWLEDGE_KV.get('mapjob', 'json');
    if (job) out.officeMapJob = { done: job.results.length, of: job.parts.length, startedAt: job.startedAt };
  } catch (e) { out.ok = false; out.kvError = e.message; }
  try { out.vectorizeIndex = await env.VECTORIZE.describe(); } catch (e) { out.vectorizeNote = 'describe() unavailable: ' + e.message; }
  try { out.kbVersion = await getKbVersion(env); } catch (e) {}
  try { out.questionsToday = parseInt((await env.KNOWLEDGE_KV.get('usage:' + today())) || '0', 10); out.dailyCap = DAILY_QUESTION_CAP; } catch (e) {}
  return jsonResponse(out, 200, origin);
}

async function handleDeleteFile(request, env, origin) {
  const { fileLabel } = await request.json();
  const label = labelOf(fileLabel || '');
  if (!label) return jsonResponse({ success: false, error: 'Missing fileLabel' }, 400, origin);
  const [rec, legacyRec] = await Promise.all([env.KNOWLEDGE_KV.get(`idx:${label}`, 'json'), env.KNOWLEDGE_KV.get(`chunks:${label}`)]);
  await Promise.all([`file:${label}`, `idx:${label}`, `chunks:${label}`].map(k => env.KNOWLEDGE_KV.delete(k)));
  const fileIndex = (await getFileIndex(env)).filter(f => f !== label);
  await env.KNOWLEDGE_KV.put('__file_index__', JSON.stringify(fileIndex));
  IDX_STATE = { ts: 0 };
  await bumpAnswerGen(env);
  const ids = [];
  if (rec && rec.gen) { for (let j = 0; j < (rec.count || 0) + 50; j++) ids.push(vecId(label, rec.gen, j)); try { await env.KNOWLEDGE_KV.delete(`cstore:${label}:${rec.gen}`); } catch (e) {} }
  const legacyCount = parseInt(legacyRec || '0', 10) || 0;
  for (let j = 0; j < Math.max(legacyCount, 1000) + 100; j++) ids.push(`${label}_chunk_${j}`);
  const state = { deleted: 0, rateLimited: false };
  await politeDeleteByIds(env, ids, state);
  return jsonResponse({ success: true, deleted: label, cleanupPending: state.rateLimited }, 200, origin);
}

// Finds vectors that don't belong to an active generation and deletes them.
// Run repeatedly until clean: true (one stale group per call keeps it gentle).
async function handlePurgeStale(env, origin) {
  const idx = await getIndexState(env, true);
  if (!idx.fileIndex.length) return jsonResponse({ error: 'File index is empty — refusing to purge (everything would look stale). Train first.' }, 400, origin);
  const probes = [
    'MARA Herbst orthodontic appliance Class II', 'RPE expansion palatal separator bands', 'orthodontic protocol delivery cement appointment',
    'inventory supplies materials ordering', 'policy manual HR benefits vacation', 'infection control sterilization safety',
    'patient scheduling billing insurance', 'staff training onboarding procedures', 'emergency protocol medical office',
    'orthodontic bonding debonding adjustment', 'staff bios birthdays team members', 'photos videos media references',
    'fees pricing treatment plans', 'retainers aligners trays', 'front desk phone scripts new patient', 'Edge Cloud letters collections'
  ];
  const emb = await env.AI.run(EMBED_MODEL, { text: probes });
  const seen = new Set();
  for (const vec of emb.data) {
    const res = await env.VECTORIZE.query(vec, { topK: 100, returnValues: false, returnMetadata: 'none' });
    for (const m of res.matches) if (m.id) seen.add(m.id);
  }
  const staleGroups = new Map(); // groupKey -> ids seen
  for (const id of seen) {
    if (isActiveId(id, idx)) continue;
    const legacy = id.match(/^(.*)_chunk_(\d+)$/);
    const v2 = id.match(/^(.*)\.g([0-9a-z]+)\.(\d+)$/);
    const key = v2 ? `v2|${v2[1]}|${v2[2]}` : legacy ? `legacy|${legacy[1]}` : `stray|${id}`;
    if (!staleGroups.has(key)) staleGroups.set(key, []);
    staleGroups.get(key).push(id);
  }
  // Legacy vectors of a label that has NO v2 index yet are still live — never touch them.
  for (const key of [...staleGroups.keys()]) {
    const [kind, base] = key.split('|');
    if (kind === 'legacy' && idx.fileIndex.includes(base) && !idx.labels[base]) staleGroups.delete(key);
  }
  const state = { deleted: 0, rateLimited: false };
  let purged = null;
  const first = [...staleGroups.keys()][0];
  if (first) {
    const [kind, base, gen] = first.split('|');
    const ids = [];
    if (kind === 'v2') for (let j = 0; j < PURGE_RANGE_MAX; j++) ids.push(`${base}.g${gen}.${j}`);
    else if (kind === 'legacy') for (let j = 0; j < PURGE_RANGE_MAX; j++) ids.push(`${base}_chunk_${j}`);
    else ids.push(...staleGroups.get(first));
    await politeDeleteByIds(env, ids, state);
    purged = first;
  }
  const clean = staleGroups.size === 0;
  if (state.deleted > 0) await bumpAnswerGen(env);
  return jsonResponse({
    clean, rateLimited: state.rateLimited, purgedThisCall: purged, staleGroupsSeen: [...staleGroups.keys()],
    idsDeletedThisCall: state.deleted,
    note: state.rateLimited ? 'Vectorize rate limit hit — progress is saved. Wait about a minute and run it again.'
      : clean ? 'Clean — no stale search data found.' : 'Removed one stale group. Run again until clean: true.'
  }, 200, origin);
}

// ====================================================================
// INDEX STATE, CHUNK STORE, IDS
// ====================================================================
async function getFileIndex(env) {
  try { const v = await env.KNOWLEDGE_KV.get('__file_index__', 'json'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

async function getIndexState(env, fresh) {
  if (!fresh && IDX_STATE.ts && Date.now() - IDX_STATE.ts < 60000) return IDX_STATE;
  const fileIndex = await getFileIndex(env);
  const recs = await Promise.all(fileIndex.map(l => env.KNOWLEDGE_KV.get(`idx:${l}`, 'json').catch(() => null)));
  const labels = {};
  let allV2 = fileIndex.length > 0;
  fileIndex.forEach((l, k) => { if (recs[k] && recs[k].gen) labels[l] = recs[k]; else allV2 = false; });
  IDX_STATE = { ts: Date.now(), fileIndex, labels, mode: allV2 ? 'v2' : 'legacy' };
  return IDX_STATE;
}

async function getChunkStore(env, label, gen) {
  const key = label + ':' + gen;
  if (CSTORE.has(key)) return CSTORE.get(key);
  let arr = null;
  try { arr = await env.KNOWLEDGE_KV.get(`cstore:${label}:${gen}`, 'json'); } catch (e) {}
  if (Array.isArray(arr)) { if (CSTORE.size >= 4) CSTORE.clear(); CSTORE.set(key, arr); }
  return arr;
}

async function warmCaches(env) {
  const idx = await getIndexState(env);
  for (const label of Object.keys(idx.labels)) await getChunkStore(env, label, idx.labels[label].gen);
}

function locateId(id, idx) {
  const m = String(id || '').match(/^(.*)\.g([0-9a-z]+)\.(\d+)$/);
  if (!m) return null;
  for (const label of Object.keys(idx.labels)) {
    if (idBase(label) === m[1] && idx.labels[label].gen === m[2]) return { label, gen: m[2], i: parseInt(m[3], 10) };
  }
  return null;
}

function isActiveId(id, idx) {
  const m = String(id).match(/^(.*)\.g([0-9a-z]+)\.(\d+)$/);
  if (!m) return idx.mode === 'legacy';
  for (const label of Object.keys(idx.labels)) {
    if (idBase(label) === m[1] && idx.labels[label].gen === m[2]) return true;
  }
  return false;
}

function labelOf(s) { return String(s || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 80).toLowerCase(); }
function idBase(label) { return label.slice(0, 40); }                       // vector ids must stay ≤ 64 bytes
function vecId(label, gen, i) { return `${idBase(label)}.g${gen}.${i}`; }
function prettyTitle(s) { return String(s || '').replace(/_/g, ' ').replace(/\.txt$/i, '').replace(/\b\w/g, c => c.toUpperCase()).trim(); }

async function aiRunWithRetry(env, model, input) {
  for (let attempt = 0; ; attempt++) {
    try { return await env.AI.run(model, input); }
    catch (e) { if (attempt >= 2) throw e; await sleep(1500 * (attempt + 1)); }
  }
}
async function upsertWithRetry(env, vectors) {
  for (let attempt = 0; ; attempt++) {
    try { return await env.VECTORIZE.upsert(vectors); }
    catch (e) { if (attempt >= 3) throw e; await sleep(2500 * (attempt + 1)); }
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Delete vector ids politely: large batches, paced, with retry on rate limits.
async function politeDeleteByIds(env, ids, state) {
  for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
    if (state.rateLimited) return;
    const batch = ids.slice(i, i + DELETE_BATCH_SIZE);
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        await env.VECTORIZE.deleteByIds(batch);
        ok = true; state.deleted += batch.length;
      } catch (e) {
        const msg = String((e && e.message) || e);
        if (/too many request|429|40041/i.test(msg)) {
          if (attempt === 0) { await sleep(2500); continue; }
          state.rateLimited = true; return;
        }
        try {
          for (let j = 0; j < batch.length; j += 100) {
            await env.VECTORIZE.deleteByIds(batch.slice(j, j + 100));
            state.deleted += Math.min(100, batch.length - j);
            await sleep(300);
          }
          ok = true;
        } catch (e2) {
          if (/too many request|429|40041/i.test(String((e2 && e2.message) || e2))) { state.rateLimited = true; return; }
          throw e2;
        }
      }
    }
    await sleep(DELETE_PACE_MS);
  }
}

// ====================================================================
// LIVE SETTINGS (model + thinking level, saved from the Training portal)
// ====================================================================
async function getLiveSettings(env, fresh) {
  if (!fresh && LIVE.kv === env.KNOWLEDGE_KV && LIVE.ts && Date.now() - LIVE.ts < 30000) return LIVE;
  let s = null;
  try { s = env.KNOWLEDGE_KV ? await env.KNOWLEDGE_KV.get('__settings__', 'json') : null; } catch (e) {}
  LIVE = {
    kv: env.KNOWLEDGE_KV, ts: Date.now(),
    model: s && MODEL_ALLOW.includes(s.model) ? s.model : MODEL,
    thinking: s && THINKING_ALLOW.includes(s.thinking) ? s.thinking : THINKING_LEVEL,
    updatedAt: (s && s.updatedAt) || null
  };
  return LIVE;
}
function settingsView(live) {
  return { model: live.model, thinking: live.thinking, updatedAt: live.updatedAt, fallback: { model: MODEL, thinking: THINKING_LEVEL }, allowedModels: MODEL_ALLOW, allowedThinking: THINKING_ALLOW };
}
async function handleSettings(request, env, origin) {
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const cur = await getLiveSettings(env, true);
  const model = body.model ? String(body.model) : cur.model;
  const thinking = body.thinking ? String(body.thinking).toLowerCase() : cur.thinking;
  if (!MODEL_ALLOW.includes(model)) return jsonResponse({ success: false, error: 'Unknown model: ' + model }, 400, origin);
  if (!THINKING_ALLOW.includes(thinking)) return jsonResponse({ success: false, error: 'Unknown thinking level: ' + thinking }, 400, origin);
  const rec = { model, thinking, updatedAt: new Date().toISOString() };
  await env.KNOWLEDGE_KV.put('__settings__', JSON.stringify(rec));
  LIVE = { kv: env.KNOWLEDGE_KV, ts: Date.now(), ...rec };
  logEvent(null, { evt: 'settings', model, thinking });
  return jsonResponse(Object.assign({ success: true, note: 'Takes effect within about 30 seconds.' }, settingsView(LIVE)), 200, origin);
}

// ====================================================================
// OFFICE MAP — an automatic overview of the whole manual, built in parts
// (POST /map, called repeatedly by the portal until done) and sent with
// every question. Rebuilt after every upload/rebuild; the previous map
// stays in use until the new one is finished.
// ====================================================================
async function getOfficeMap(env, fresh) {
  if (!fresh && MAP_CACHE.kv === env.KNOWLEDGE_KV && MAP_CACHE.ts && Date.now() - MAP_CACHE.ts < 60000) return MAP_CACHE.val;
  let v = null;
  try { v = await env.KNOWLEDGE_KV.get('map:current', 'json'); } catch (e) {}
  MAP_CACHE = { kv: env.KNOWLEDGE_KV, ts: Date.now(), val: v };
  return v;
}

function mapSignature(idx) {
  return idx.fileIndex.map(l => l + '@' + ((idx.labels[l] && idx.labels[l].gen) || 'legacy')).join('|');
}

// Drop the historical CHANGE LOG at the END of the file (a section's own
// "CHANGE LOG" block earlier in the file is left alone).
function stripChangeLog(text) {
  const t = String(text || '');
  let last = null;
  for (const m of t.matchAll(/\n[=═]{4,}[ \t]*\n[ \t]*CHANGE ?LOG\b[^\n]*\n/gi)) last = m;
  return (last && last.index > t.length * 0.6) ? t.slice(0, last.index) : t;
}

// Split one file into parts of at most MAP_PART_CHARS, at section stamps where possible.
function planMapParts(label, text) {
  const body = stripChangeLog(text);
  const starts = [0];
  const re = /^[ \t]*\[SECTION STAMP\][ \t]*$/gm;
  let m;
  while ((m = re.exec(body))) if (m.index > 0) starts.push(m.index);
  starts.push(body.length);
  const parts = [];
  let partStart = 0;
  for (let k = 1; k < starts.length; k++) {
    const secStart = starts[k - 1], secEnd = starts[k];
    if (secEnd - partStart > MAP_PART_CHARS && secStart > partStart) { parts.push({ label, start: partStart, end: secStart }); partStart = secStart; }
    while (secEnd - partStart > MAP_PART_CHARS) {
      let cut = body.lastIndexOf('\n', partStart + MAP_PART_CHARS);
      if (cut <= partStart) cut = partStart + MAP_PART_CHARS;
      parts.push({ label, start: partStart, end: cut });
      partStart = cut;
    }
  }
  if (partStart < body.length) parts.push({ label, start: partStart, end: body.length });
  return parts;
}

async function handleMapBuild(request, env, origin) {
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const idx = await getIndexState(env, true);
  if (!idx.fileIndex.length) return jsonResponse({ success: false, error: 'No knowledge base uploaded yet.' }, 400, origin);
  const sig = mapSignature(idx);
  let job = null;
  try { job = await env.KNOWLEDGE_KV.get('mapjob', 'json'); } catch (e) {}
  if (!job || job.sig !== sig || body.restart) {
    const parts = [];
    for (const label of idx.fileIndex) {
      const text = await env.KNOWLEDGE_KV.get(`file:${label}`);
      if (text) parts.push(...planMapParts(label, text));
    }
    if (!parts.length) return jsonResponse({ success: false, error: 'Stored knowledge base text not found.' }, 400, origin);
    job = { sig, parts, results: [], startedAt: new Date().toISOString() };
  }
  const k = job.results.length;
  if (k < job.parts.length) {
    const part = job.parts[k];
    const text = stripChangeLog((await env.KNOWLEDGE_KV.get(`file:${part.label}`)) || '').slice(part.start, part.end);
    const live = await getLiveSettings(env);
    let result;
    try { result = await extractMapPart(env, text, k + 1, job.parts.length, live.model); }
    catch (e) {
      await env.KNOWLEDGE_KV.put('mapjob', JSON.stringify(job));
      return jsonResponse({ success: false, error: 'Office map part ' + (k + 1) + ' of ' + job.parts.length + ' failed: ' + e.message + ' — run it again to retry.', part: k, of: job.parts.length }, 502, origin);
    }
    job.results.push(result);
    await env.KNOWLEDGE_KV.put('mapjob', JSON.stringify(job));
  }
  if (job.results.length < job.parts.length) {
    return jsonResponse({ success: true, done: false, part: job.results.length, of: job.parts.length }, 200, origin);
  }
  const text = renderOfficeMap(mergeMapParts(job.results));
  const kbv = await getKbVersion(env);
  const rec = { text, sig, builtAt: new Date().toISOString(), kbVersion: (kbv && kbv.version) || null, parts: job.parts.length, words: text.split(/\s+/).filter(Boolean).length };
  await env.KNOWLEDGE_KV.put('map:current', JSON.stringify(rec));
  try { await env.KNOWLEDGE_KV.delete('mapjob'); } catch (e) {}
  MAP_CACHE = { kv: env.KNOWLEDGE_KV, ts: Date.now(), val: rec };
  await bumpAnswerGen(env);
  logEvent(null, { evt: 'map', parts: rec.parts, words: rec.words });
  return jsonResponse({ success: true, done: true, parts: rec.parts, words: rec.words, builtAt: rec.builtAt }, 200, origin);
}

async function handleMapGet(env, origin) {
  const [m, idx] = await Promise.all([getOfficeMap(env, true), getIndexState(env, true)]);
  if (!m) return jsonResponse({ success: true, exists: false }, 200, origin);
  return jsonResponse({ success: true, exists: true, text: m.text, builtAt: m.builtAt, words: m.words, parts: m.parts, kbVersion: m.kbVersion, stale: m.sig !== mapSignature(idx) }, 200, origin);
}

async function extractMapPart(env, text, k, n, model) {
  const sys = `You build an OFFICE MAP for AISA, the staff assistant at Next Level Orthodontics (NLO). You get part ${k} of ${n} of NLO's staff manual.
Extract ONLY what this text states about NLO. Copy names exactly as written. No general knowledge, no guesses.
Ignore hypothetical examples ("for example, if..."), negative-example lines marked INCORRECT, and change-log history.
Reply with ONLY a JSON object of this shape:
{"systems":[{"name":"","use":"","sections":[]}],"roles":[{"who":"","handles":"","sections":[]}],"partners":[{"name":"","for":"","sections":[]}],"sections":[{"num":"","title":"","covers":""}]}
- systems: EVERY software, app, web app, portal, platform, device software or online service NLO staff use (practice management, patient texting/communication, reminders, remote monitoring, imaging, scanning, lab/design, payments/financing, payroll/HR, forms, task tracking, file storage). "use" = what NLO uses it for, max 15 words.
- roles: job roles and named staff, with what they handle (max 18 words).
- partners: outside labs, vendors, suppliers, insurers, consultants, referral offices/doctors — what NLO uses them for (max 12 words).
- sections: each manual section that appears in this part (from its SECTION # stamp or heading), with the questions it answers (max 20 words).
- "sections" inside systems/roles/partners = the section numbers where that item appears (numbers only).`;
  const body = {
    system_instruction: { parts: [{ text: sys }] },
    contents: [{ role: 'user', parts: [{ text: 'MANUAL TEXT (part ' + k + ' of ' + n + '):\n\n' + text }] }],
    generationConfig: { maxOutputTokens: 16384, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } }
  };
  const resp = await callGemini(env, body, false, model, MAP_TIMEOUT_MS);
  if (!resp.ok) throw new Error(await geminiError(resp));
  return parseJsonReply(await resp.json());
}

function mapKey(s) { return String(s || '').toLowerCase().replace(/[™®©]/g, '').replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim(); }
function secNums(arr) { return (Array.isArray(arr) ? arr : [arr]).map(x => String(x == null ? '' : x).replace(/[^0-9]/g, '')).filter(Boolean); }

function mergeMapParts(results) {
  const spec = { systems: ['name', 'use'], roles: ['who', 'handles'], partners: ['name', 'for'] };
  const groups = { systems: new Map(), roles: new Map(), partners: new Map() };
  const sections = new Map();
  for (const r of results) {
    if (!r || typeof r !== 'object') continue;
    for (const g of Object.keys(spec)) {
      const [nameF, descF] = spec[g];
      for (const it of (Array.isArray(r[g]) ? r[g] : [])) {
        if (!it || !it[nameF]) continue;
        const key = mapKey(it[nameF]);
        if (!key) continue;
        const e = groups[g].get(key) || { name: String(it[nameF]).trim().slice(0, 80), descs: [], secs: new Set() };
        const d = String(it[descF] || '').trim().slice(0, 140);
        if (d && e.descs.length < 3 && !e.descs.some(x => mapKey(x) === mapKey(d))) e.descs.push(d);
        secNums(it.sections).forEach(x => e.secs.add(x));
        groups[g].set(key, e);
      }
    }
    for (const sct of (Array.isArray(r.sections) ? r.sections : [])) {
      const num = String((sct && sct.num) || '').replace(/[^0-9]/g, '');
      if (!num || sections.has(num)) continue;
      sections.set(num, { num, title: String(sct.title || '').trim().slice(0, 80), covers: String(sct.covers || '').trim().slice(0, 160) });
    }
  }
  return { groups, sections };
}

function renderOfficeMap({ groups, sections }) {
  const line = (e) => '- ' + e.name + (e.descs.length ? ': ' + e.descs.join('; ') : '') +
    (e.secs.size ? ' (§' + [...e.secs].sort((a, b) => Number(a) - Number(b)).slice(0, 6).join(', §') + ')' : '');
  const block = (title, m, cap) => {
    const arr = [...m.values()].sort((a, b) => b.secs.size - a.secs.size).slice(0, cap); // most-mentioned first
    return arr.length ? title + '\n' + arr.map(line).join('\n') + '\n\n' : '';
  };
  let out = block('SYSTEMS & SOFTWARE NLO USES', groups.systems, 80) +
    block('WHO HANDLES WHAT', groups.roles, 50) +
    block('OUTSIDE PARTNERS (labs, vendors, insurers, consultants, referrals)', groups.partners, 80);
  const secs = [...sections.values()].sort((a, b) => Number(a.num) - Number(b.num));
  if (secs.length) out += 'SECTION GUIDE\n' + secs.map(x => '§' + x.num + ' ' + x.title + (x.covers ? ' — ' + x.covers : '')).join('\n') + '\n';
  return out.slice(0, MAP_MAX_CHARS);
}

// ====================================================================
// SMALL HELPERS
// ====================================================================
function jsonResponse(obj, status, origin) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } });
}
function textHeaders(origin) {
  return { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...corsHeaders(origin) };
}

function checkAdmin(request, env) {
  const authKey = request.headers.get('X-Admin-Key') || '';
  const storedKey = env['ADMIN-KEY'] || env['ADMIN_KEY'];
  return !!storedKey && !!authKey && authKey === storedKey;
}

function rateLimit(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  let entry = RATE_BUCKET.get(ip);
  if (!entry || now - entry.start > 60000) entry = { start: now, count: 0 };
  entry.count++;
  RATE_BUCKET.set(ip, entry);
  if (RATE_BUCKET.size > 5000) RATE_BUCKET = new Map();
  return entry.count > RATE_LIMIT_PER_MIN;
}

function today() { return new Date().toISOString().slice(0, 10); }
async function overDailyCap(env) {
  const day = today();
  if (USAGE.day !== day || Date.now() - USAGE.ts > 30000) {
    let n = 0;
    try { n = parseInt((await env.KNOWLEDGE_KV.get('usage:' + day)) || '0', 10) || 0; } catch (e) {}
    USAGE = { day, count: Math.max(n, USAGE.day === day ? USAGE.count : 0), ts: Date.now() };
  }
  return USAGE.count >= DAILY_QUESTION_CAP;
}
function countQuestion(env, ctx) {
  USAGE.count++;
  const day = USAGE.day || today();
  const p = (async () => {
    try {
      const n = parseInt((await env.KNOWLEDGE_KV.get('usage:' + day)) || '0', 10) || 0;
      await env.KNOWLEDGE_KV.put('usage:' + day, String(Math.max(n + 1, USAGE.count)), { expirationTtl: 3 * 86400 });
    } catch (e) {}
  })();
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
}

// Answer cache: question-only key (answers no longer depend on who asks).
async function answerCacheKey(reqJson, env, model, thinking) {
  if (!env.KNOWLEDGE_KV) return null;
  const { question, inventoryData, history, image } = reqJson;
  if (image || inventoryData) return null;
  if (Array.isArray(history) && history.length > 0) return null;
  const norm = question.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[?.!\s]+$/, '');
  if (!norm) return null;
  const gen = await getAnsGen(env);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode((model || MODEL) + '|' + (thinking || THINKING_LEVEL) + '|' + norm));
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  return 'anscache2:' + gen + ':' + hex;
}
async function getAnsGen(env) {
  if (ANS_GEN.ts && Date.now() - ANS_GEN.ts < 5 * 60 * 1000) return ANS_GEN.val;
  let v = '0';
  try { v = (await env.KNOWLEDGE_KV.get('__ans_gen__')) || '0'; } catch (e) {}
  ANS_GEN = { val: v, ts: Date.now() };
  return v;
}
async function bumpAnswerGen(env) {
  const v = String(Date.now());
  try { await env.KNOWLEDGE_KV.put('__ans_gen__', v); } catch (e) {}
  ANS_GEN = { val: v, ts: Date.now() };
}

async function recordKbVersion(env, text, label) {
  try {
    const vm = text.match(/^VERSION:\s*(\S+)/mi);
    if (!vm) return;
    const um = text.match(/^LAST UPDATED:\s*(.+)$/mi);
    await env.KNOWLEDGE_KV.put('__kb_version__', JSON.stringify({ version: vm[1], lastUpdated: um ? um[1].trim() : null, fileLabel: label, trainedAt: new Date().toISOString() }));
    KB_VER = { val: null, ts: 0 };
  } catch (e) {}
}
async function getKbVersion(env) {
  if (KB_VER.ts && Date.now() - KB_VER.ts < 5 * 60 * 1000) return KB_VER.val;
  let v = null;
  try {
    v = await env.KNOWLEDGE_KV.get('__kb_version__', 'json');
    if (!v) {
      for (const label of await getFileIndex(env)) {
        const text = await env.KNOWLEDGE_KV.get(`file:${label}`);
        const vm = text && text.match(/^VERSION:\s*(\S+)/mi);
        if (vm) {
          const um = text.match(/^LAST UPDATED:\s*(.+)$/mi);
          v = { version: vm[1], lastUpdated: um ? um[1].trim() : null, fileLabel: label, trainedAt: null };
          await env.KNOWLEDGE_KV.put('__kb_version__', JSON.stringify(v));
          break;
        }
      }
    }
  } catch (e) {}
  KB_VER = { val: v, ts: Date.now() };
  return v;
}

function logEvent(ctx, obj) {
  try { console.log(JSON.stringify(obj)); } catch (e) {}
}
function round3(x) { return typeof x === 'number' ? Math.round(x * 1000) / 1000 : x; }

// --- CORS ---
const ALLOWED_HOSTS = ['amooloo.github.io'];
function isAllowedOrigin(origin) {
  if (!origin || origin === 'null') return true;
  try {
    const u = new URL(origin);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    return u.protocol === 'https:' && ALLOWED_HOSTS.includes(u.hostname);
  } catch (e) { return false; }
}
function corsHeaders(origin) {
  const base = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key, X-AISA-Model, X-AISA-Thinking, X-AISA-No-Cache',
    'Access-Control-Expose-Headers': 'X-AISA-Sources, X-AISA-Cache',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  if (!origin || origin === 'null') return { 'Access-Control-Allow-Origin': '*', ...base };
  return { 'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : 'https://' + ALLOWED_HOSTS[0], ...base };
}

// ====================================================================
// CHUNKER v2 — structure-aware chunks with a full heading path.
// ====================================================================
const CHUNKER_VERSION = 3;

const CHUNK_TARGET = 1100;   // start a new chunk once the body passes this
const CHUNK_MAX = 1600;      // no single piece may exceed this
const OVERLAP_MAX = 320;     // carry the previous paragraph if it is at most this long
const TINY_TAIL = 80;        // fragments shorter than this merge into the previous chunk

const SEP_RE = /^\s*[=═]{4,}\s*$/;
const SOP_RE = /\bSOP-[A-Z]{2,5}-\d{2,3}[A-Z]?\b/;
const STAMP_OPEN_RE = /^\s*\[SECTION STAMP\]\s*$/;
const STAMP_CLOSE_RE = /^\s*\[END SECTION STAMP\]\s*$/;
const STAMP_NUM_RE = /^\s*SECTION #:\s*(\S+)\s+of\s+\d+/;
const TOC_RE = /^\s*SECTION\s+(\S+)\s+—\s+(.*)\(([^()]+\.txt)\)\s*$/;
const INLINE_HEAD_RE = /^\s*(?:={3}|-{3})\s*(\S.*?\S|\S)\s*(?:={3}|-{3})\s*$/;
const SKIP_TITLE_RE = /^(NLO MASTER KNOWLEDGE BASE — METADATA|AISA IDENTITY|TABLE OF CONTENTS|SECTION STAMP KEY|BEGIN KNOWLEDGE BASE CONTENT|CHANGE ?LOG)/i;
const NOISE_LINE_RE = /^\s*(\[AUDIENCE TAGS\].*|\[END OF SECTION[^\]]*\]|Copyright © \d{4} .*All Rights Reserved|Printed Date: \S+ Page \d+)\s*$/;
// A standalone ALL-CAPS line of 2-7 words with no digits and no trailing colon is a
// heading in the handbook-style parts of the KB ("VACATION BENEFITS", "PAID HOLIDAYS").
const CAPS_HEAD_RE = /^[A-Z][A-Z &\/'’()\-—,]{6,58}[A-Z)]$/;
function capsHeading(line) {
  const t = line.trim();
  if (!CAPS_HEAD_RE.test(t) || /\d/.test(t)) return null;
  const words = t.split(/\s+/).filter(w => /[A-Z]/.test(w));
  if (words.length < 2 || words.length > 7) return null;
  const small = new Set(['AND', 'OR', 'OF', 'THE', 'TO', 'FOR', 'IN', 'ON', 'AT', 'A', 'AN', 'BY', 'WITH']);
  return t.toLowerCase().split(/(\s+|\/|-)/).map((w, i) => {
    if (!/[a-z]/.test(w)) return w;
    return (i > 0 && small.has(w.toUpperCase())) ? w : w.charAt(0).toUpperCase() + w.slice(1);
  }).join('');
}

function tidyLine(line) {
  // Collapse wide space runs (column padding) — saves tokens, keeps meaning.
  return line.replace(/\s+$/, '').replace(/[ \t]{3,}/g, '  ');
}

function cleanTitle(titleLines) {
  const joined = titleLines.join(' / ');
  const sop = (joined.match(SOP_RE) || [''])[0];
  let title = titleLines[0].replace(/\s*·\s+.*$/, '').trim();
  if (sop && !title.includes(sop)) title = sop + ' ' + title;
  return { title: title.slice(0, 120), sop };
}

function splitLong(p) {
  // Break an over-long paragraph by lines, then by sentences.
  const out = [];
  let cur = '';
  const pushCur = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  for (const line of p.split('\n')) {
    if (line.length > CHUNK_MAX) {
      pushCur();
      let rest = line;
      while (rest.length > CHUNK_MAX) {
        let cut = -1;
        for (let k = CHUNK_TARGET; k > CHUNK_TARGET * 0.5; k--) {
          if ('.!?;'.includes(rest[k]) && /\s/.test(rest[k + 1] || ' ')) { cut = k + 1; break; }
        }
        if (cut === -1) cut = rest.lastIndexOf(' ', CHUNK_TARGET);
        if (cut <= 0) cut = CHUNK_TARGET;
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) cur = rest;
      continue;
    }
    if (cur && cur.length + line.length + 1 > CHUNK_TARGET) {
      // Cut after the last line that ends a sentence, so no piece starts mid-sentence
      // (a piece that began "week paid vacation after 1 year..." read like policy).
      const ls = cur.split('\n');
      let cut = -1, len = 0;
      for (let k = 0; k < ls.length; k++) { len += ls[k].length + 1; if (/[.!?:;]["')\]]?\s*$/.test(ls[k]) && len >= CHUNK_TARGET * 0.35) cut = k; }
      if (cut >= 0 && cut < ls.length - 1) {
        out.push(ls.slice(0, cut + 1).join('\n').trim());
        cur = ls.slice(cut + 1).join('\n');
      } else pushCur();
    }
    cur += (cur ? '\n' : '') + line;
  }
  pushCur();
  return out;
}

function buildChunksV2(text, fileTitle) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const rootTitle = (fileTitle || 'Knowledge Base').replace(/_/g, ' ').replace(/\.txt$/i, '').trim();

  const sectionNames = {};
  for (let i = 0; i < Math.min(lines.length, 600); i++) {
    const m = lines[i].match(TOC_RE);
    if (m) sectionNames[m[1]] = m[2].trim();
  }

  const chunks = [];
  let sec = null, l2 = '', l3 = '', special = '', saved = null;
  let skip = false, inStamp = false, stampNum = null;
  let para = [];
  let body = [], bodyLen = 0, carriedOnly = false;

  const pathOf = () => {
    const parts = [sec ? ('Section ' + sec.num + (sec.name ? ' — ' + sec.name : '')) : rootTitle];
    for (const p of [l2, special, l3]) if (p) parts.push(p.slice(0, 110));
    return parts.join(' › ').slice(0, 260);
  };

  const emit = (path, textBody) => {
    const last = chunks[chunks.length - 1];
    if (textBody.length < TINY_TAIL && last && last.path === path && last.body.length + textBody.length < CHUNK_MAX) {
      last.body += '\n\n' + textBody;
      return;
    }
    chunks.push({ path, body: textBody });
  };

  const flush = (carry) => {
    if (!body.length || carriedOnly) { if (!carry) { body = []; bodyLen = 0; carriedOnly = false; } return; }
    const path = pathOf();
    emit(path, body.join('\n\n'));
    const last = body[body.length - 1];
    if (carry && body.length > 1 && last.length <= OVERLAP_MAX) {
      body = [last]; bodyLen = last.length + 2; carriedOnly = true;
    } else {
      body = []; bodyLen = 0; carriedOnly = false;
    }
  };
  const flushAll = () => { endPara(); flush(false); body = []; bodyLen = 0; carriedOnly = false; };

  const addParagraph = (p) => {
    if (!p) return;
    if (p.length > CHUNK_MAX) { for (const piece of splitLong(p)) addParagraph(piece); return; }
    if (bodyLen > 0 && bodyLen + p.length + 2 > CHUNK_TARGET) {
      if (carriedOnly) { body = []; bodyLen = 0; carriedOnly = false; } // overlap would overflow — drop it
      else flush(true);
    }
    body.push(p); bodyLen += p.length + 2; carriedOnly = false;
  };
  function endPara() {
    if (para.length) { addParagraph(para.join('\n').trim()); para = []; }
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    if (STAMP_OPEN_RE.test(raw)) { flushAll(); inStamp = true; stampNum = null; continue; }
    if (inStamp) {
      const m = raw.match(STAMP_NUM_RE);
      if (m) stampNum = m[1];
      if (STAMP_CLOSE_RE.test(raw)) {
        inStamp = false;
        sec = { num: stampNum || '?', name: sectionNames[stampNum] || '' };
        l2 = l3 = special = ''; saved = null; skip = false;
      }
      continue;
    }

    if (SEP_RE.test(raw)) {
      // Title block = separator, 1-5 lines, separator.
      let j = i + 1;
      while (j < lines.length && j - i <= 6 && !SEP_RE.test(lines[j])) j++;
      if (j < lines.length && SEP_RE.test(lines[j]) && j - i >= 2) {
        const titleLines = lines.slice(i + 1, j).map(s => s.trim()).filter(Boolean);
        const sepLen = raw.trim().length;
        i = j;
        flushAll();
        if (!titleLines.length) continue;
        const t0 = titleLines[0];
        if (/^SOURCE FILE:/i.test(t0) || /^\[AUDIENCE TAGS\]/i.test(t0)) continue;
        if (SKIP_TITLE_RE.test(t0)) { skip = true; continue; }
        skip = false;
        if (/^END\b/i.test(t0)) {
          if (saved) { l2 = saved.l2; l3 = saved.l3; saved = null; }
          special = '';
          continue;
        }
        if (/^FREQUENTLY ASKED QUESTIONS/i.test(t0)) { saved = { l2, l3 }; special = 'FAQ (Q&A pairs)'; l3 = ''; continue; }
        if (/^NEGATIVE EXAMPLES/i.test(t0)) { saved = { l2, l3 }; special = 'NEGATIVE EXAMPLES — every INCORRECT line is FALSE, never repeat it'; l3 = ''; continue; }
        const { title } = cleanTitle(titleLines);
        special = ''; saved = null;
        if (sepLen === 44 || sepLen === 28) { l3 = title; }
        else { l2 = title; l3 = ''; }
        continue;
      }
      // Lone separator. A single short line right above it is a heading
      // ("QUICK REFERENCE — OLYMPUS OMD CAMERA PRESETS" + "=====").
      if (para.length === 1 && para[0].trim().length <= 100 && !/[.:]$/.test(para[0].trim())) {
        const head = para[0].trim(); para = [];
        flushAll();
        if (!skip) { l3 = head; }
        continue;
      }
      endPara(); // otherwise just a paragraph break
      continue;
    }

    if (skip) continue;
    if (NOISE_LINE_RE.test(raw)) continue;

    const capsHead = capsHeading(raw);
    if (capsHead) { flushAll(); l3 = capsHead; continue; }

    const ih = raw.match(INLINE_HEAD_RE);
    if (ih && /^page \d+$/i.test(ih[1].trim())) { endPara(); continue; }
    if (ih && ih[1].length <= 110) { flushAll(); l3 = ih[1].trim(); continue; }

    if (!raw.trim()) { endPara(); continue; }
    para.push(tidyLine(raw));
  }
  flushAll();

  return chunks.map((c, idx) => ({ i: idx, path: c.path, text: '[' + c.path + ']\n' + c.body }));
}

// ====================================================================
// PHOTO VISION (/describe) — added 2026-08-22
// The AISA Photo Portal posts one photo; these write the caption,
// description, keywords and the manual section it belongs in.
// ====================================================================
const MAX_PHOTO_B64 = 5600000; // ~4MB of image once base64-decoded

const DEFAULT_PHOTO_CATEGORIES = [
  'MARA', 'Herbst', 'Herbst-Smith-Type-I', 'Herbst-Smith-Type-II',
  'RPE', 'MSE', 'MARPE', 'Schwartz', 'Hawley', 'Finger-Spring',
  'Bonding', 'Brackets', 'Instruments', 'Archwires', 'Elastics',
  'Clinical-Before', 'Clinical-After', 'Clinical-Progress',
  'Intraoral', 'Extraoral', 'Ceph', 'Panoramic', 'Patient-Education', 'Office', 'Other'
];

async function handleDescribe(request, env, origin) {
  if (rateLimit(request)) return jsonResponse({ success: false, error: 'Too many requests — wait a minute and try again.' }, 429, origin);
  try {
    const reqJson = await request.json();
    const img = reqJson.image || {};
    if (!img.data || !img.mimeType) return jsonResponse({ success: false, error: 'Missing image.data / image.mimeType' }, 400, origin);
    if (img.data.length > MAX_PHOTO_B64) return jsonResponse({ success: false, error: 'Image too large — please resize under ~4MB.' }, 413, origin);
    const categories = Array.isArray(reqJson.categories) && reqJson.categories.length ? reqJson.categories.slice(0, 60) : DEFAULT_PHOTO_CATEGORIES;
    const hint = (reqJson.hint || '').toString().slice(0, 300);
    const fileName = (reqJson.fileName || '').toString().slice(0, 200);
    const vision = await describePhotoWithGemini({ img, categories, hint, fileName }, env);
    let placement = { suggestedSection: '', sectionRationale: '' };
    try { placement = await suggestPhotoPlacement(vision, env); } catch (e) { console.error('placement lookup failed:', e); }
    return jsonResponse({
      success: true, category: vision.category, caption: vision.caption, description: vision.description,
      keywords: vision.keywords, confidence: vision.confidence,
      suggestedSection: placement.suggestedSection || '', sectionRationale: placement.sectionRationale || ''
    }, 200, origin);
  } catch (err) {
    console.error('Worker /describe error:', err);
    return jsonResponse({ success: false, error: err.message }, 500, origin);
  }
}

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
    contents: [{ role: 'user', parts: [{ text: ask }, { inline_data: { mime_type: img.mimeType, data: img.data } }] }],
    generationConfig: { maxOutputTokens: 2048, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } }
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
    generationConfig: { maxOutputTokens: 1024, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } }
  };
  const parsed = await geminiJson(env, body);
  return {
    suggestedSection: String(parsed.suggestedSection || '').trim().slice(0, 200),
    sectionRationale: String(parsed.sectionRationale || '').trim().slice(0, 300)
  };
}

async function retrievePhotoContext(query, env) {
  if (!env.VECTORIZE || !env.AI) return '';
  const emb = await env.AI.run(EMBED_MODEL, { text: [(USE_QUERY_PREFIX ? QUERY_PREFIX : '') + query] });
  const results = await env.VECTORIZE.query(emb.data[0], { topK: 8, returnMetadata: 'all' });
  let out = '';
  for (const m of (results.matches || [])) {
    if (m.metadata && m.metadata.text) out += m.metadata.text.slice(0, 1200) + '\n\n---\n\n';
  }
  return out.slice(0, 12000);
}

async function geminiJson(env, body) {
  const live = await getLiveSettings(env);
  const resp = await callGemini(env, body, false, live.model);
  if (!resp.ok) throw new Error(await geminiError(resp));
  return parseJsonReply(await resp.json());
}

function parseJsonReply(data) {
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
