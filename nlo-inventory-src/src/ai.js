/* =====================================================================
   AI — Gemini for reading product labels and packing slips and for Ask
   (questions about spending and orders), OpenAI for a clean product
   photo. The keys stay in nlo/settings: they're read when a step needs
   them and kept only in memory (the old app copied them into every
   computer's browser storage). A proxy URL, when set, is used instead
   of the key.
   The transport, the label reader and the slip/invoice line matching
   below are carried over from Inventory 3.0.1 unchanged.
   ===================================================================== */
const AIK = { gemini: null, openai: null, at: 0 };
async function aiKeys() {
  if (S.demo) return { gemini: '', openai: '', proxy: '' };
  if (!AIK.at || Date.now() - AIK.at > 10 * 60000) {
    const [g, o] = await Promise.all([B.getSetting('geminiKey').catch(() => null), B.getSetting('openaiKey').catch(() => null)]);
    AIK.gemini = g || ''; AIK.openai = o || ''; AIK.at = Date.now();
  }
  return { gemini: AIK.gemini, openai: AIK.openai, proxy: String(S.settings.geminiProxyUrl || '').trim() };
}
async function aiReady() { const k = await aiKeys(); return !!(k.gemini || k.proxy); }

function dataUrlToBase64(dataUrl) {
  return dataUrl.replace(/^data:image\/[a-z]+;base64,/, "");
}

// Helper: ensure image is JPEG/PNG data URL
async function ensureJpeg(imageDataUrl) {
  if (imageDataUrl && !imageDataUrl.startsWith("data:image/jpeg") && !imageDataUrl.startsWith("data:image/png")) {
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() {
        var cvs = document.createElement("canvas");
        cvs.width = img.naturalWidth; cvs.height = img.naturalHeight;
        cvs.getContext("2d").drawImage(img, 0, 0);
        resolve(cvs.toDataURL("image/jpeg", 0.9));
      };
      img.onerror = function() { resolve(imageDataUrl); };
      img.src = imageDataUrl;
    });
  }
  return imageDataUrl;
}

// Helper: extract MIME type from data URL
function dataUrlMime(dataUrl) {
  var m = dataUrl.match(/^data:(image\/[a-z]+);/);
  return m ? m[1] : "image/jpeg";
}

// Downscale an image data URL so its longest side is <= maxDim, re-encoding as
// JPEG. Invoices/packing slips stay perfectly readable to Gemini at ~1800px,
// while the upload shrinks 5-20x — the single biggest fix for AI scans that
// "spin forever" and time out on office Wi-Fi (full-res phone photos are
// 3-8 MB each once base64-encoded).
function downscaleDataUrl(dataUrl, maxDim, quality) {
  maxDim = maxDim || 1800; quality = quality || 0.82;
  return new Promise(function(resolve) {
    try {
      if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return resolve(dataUrl);
      var img = new Image();
      img.onload = function() {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return resolve(dataUrl);
        var scale = Math.min(1, maxDim / Math.max(w, h));
        // Already small AND already a modest JPEG — leave it untouched.
        if (scale >= 1 && dataUrl.startsWith("data:image/jpeg") && dataUrl.length < 900000) return resolve(dataUrl);
        var cvs = document.createElement("canvas");
        cvs.width = Math.max(1, Math.round(w * scale));
        cvs.height = Math.max(1, Math.round(h * scale));
        cvs.getContext("2d").drawImage(img, 0, 0, cvs.width, cvs.height);
        resolve(cvs.toDataURL("image/jpeg", quality));
      };
      img.onerror = function() { resolve(dataUrl); };
      img.src = dataUrl;
    } catch (e) { resolve(dataUrl); }
  });
}

// Pull ALL text out of a Gemini response — answers can span multiple parts,
// and reading only parts[0] occasionally returned "" for a good response.
function geminiResponseText(data) {
  var parts = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  return parts.map(function(p) { return (p && typeof p.text === "string") ? p.text : ""; }).join("");
}

// Robustly pull a JSON object/array out of a model reply (strips markdown
// fences, then falls back to grabbing the outermost {...} or [...] block).
function extractJsonBlock(text) {
  var clean = String(text || "").replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(clean); } catch (e) {}
  var m = clean.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (m) { try { return JSON.parse(m[0]); } catch (e2) {} }
  return null;
}

function withTimeout(ms) {
  var ctrl = new AbortController();
  var timer = setTimeout(function() { ctrl.abort(); }, ms);
  return { signal: ctrl.signal, done: function() { clearTimeout(timer); } };
}

function mapGeminiError(respStatus, errMsg) {
  var msg = errMsg || ("Gemini API error " + respStatus);
  if (respStatus === 400 && msg.includes("API_KEY")) return "Invalid Gemini API key. Please check your key.";
  if (msg.includes("API_KEY_HTTP_REFERRER_BLOCKED")) return "Gemini API key is restricted by HTTP referrer. If you run this as a local file, allow your local origin (or remove restriction) in Google AI Studio.";
  if (msg.includes("PERMISSION_DENIED")) return "Gemini key does not have permission for this model/project. Check API key and project settings.";
  if (respStatus === 429) return "Gemini rate limit reached. Wait a moment and try again.";
  return msg;
}

function isLikelyOpenAIKey(key) {
  return /^sk[-_]/i.test((key || "").trim());
}

function resolveOpenAIKey(sharedOpenAIKey, localOpenAIKey) {
  var shared = (sharedOpenAIKey || "").trim();
  var local = (localOpenAIKey || "").trim();
  if (isLikelyOpenAIKey(shared)) return shared;
  if (isLikelyOpenAIKey(local)) return local;
  return "";
}

// Calls Gemini with automatic retries and model fallback.
// Reliability rules learned from real office use:
//  - A single attempt with a hard 30s timeout wasn't enough: transient
//    failures (timeout / 429 rate limit / 5xx / network blip) now retry with a
//    short backoff instead of dumping the user to manual entry.
//  - Gemini 2.5's "thinking" adds a LOT of latency to plain extraction jobs,
//    so we request thinkingBudget 0 — and strip that config automatically for
//    models/proxies that reject it.
//  - On timeout we fall through to progressively FASTER models rather than
//    giving up (the retired 1.5 models were replaced with live ones).
// opts: { timeoutMs, totalBudgetMs, onStatus(msg) } — all optional.
async function callGeminiGenerateContent(payload, apiKey, proxyUrl, opts) {
  opts = opts || {};
  var timeoutMs = opts.timeoutMs || 45000;
  var onStatus = (typeof opts.onStatus === "function") ? opts.onStatus : function() {};
  var deadline = Date.now() + (opts.totalBudgetMs || 115000);
  function timeLeft() { return deadline - Date.now(); }
  function sleep(ms) { return new Promise(function(res) { setTimeout(res, ms); }); }
  function stripThinking(pl) {
    if (!pl || !pl.generationConfig || !pl.generationConfig.thinkingConfig) return pl;
    var gc = Object.assign({}, pl.generationConfig); delete gc.thinkingConfig;
    return Object.assign({}, pl, { generationConfig: gc });
  }
  async function postOnce(url, body, ms) {
    var t = withTimeout(ms);
    try {
      var resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: t.signal, body: JSON.stringify(body) });
      var data = {};
      try { data = await resp.json(); } catch (je) {}
      return { ok: resp.ok, status: resp.status, data: data };
    } finally { t.done(); }
  }

  var proxy = (proxyUrl || "").trim();
  if (proxy) {
    var pPayload = payload;
    var lastProxyErr = null;
    for (var attempt = 0; attempt < 3; attempt++) {
      if (timeLeft() < 5000) break;
      try {
        if (attempt > 0) { onStatus("Connection hiccup — retrying (attempt " + (attempt + 1) + " of 3)..."); }
        var r = await postOnce(proxy, pPayload, Math.min(timeoutMs, Math.max(8000, timeLeft())));
        if (r.ok) return r.data;
        var pMsg = (r.data && r.data.error && r.data.error.message) || ("Proxy API error " + r.status);
        // Proxy's model rejected thinkingConfig — strip it and retry immediately (doesn't count as an attempt).
        if (r.status === 400 && /thinking/i.test(pMsg) && pPayload.generationConfig && pPayload.generationConfig.thinkingConfig) {
          pPayload = stripThinking(pPayload); attempt--; continue;
        }
        if (r.status === 429 || r.status >= 500) {
          lastProxyErr = new Error(mapGeminiError(r.status, pMsg));
          await sleep(r.status === 429 ? 2500 : 1200);
          continue;
        }
        throw new Error(mapGeminiError(r.status, pMsg));
      } catch (e) {
        if (e && e.name === "AbortError") { lastProxyErr = new Error("Gemini proxy kept timing out even after retries. Try again, or process fewer pages at once."); continue; }
        if (e instanceof TypeError) { lastProxyErr = new Error("Network/CORS error calling Gemini proxy URL."); await sleep(1000); continue; }
        throw e;
      }
    }
    throw lastProxyErr || new Error("Gemini proxy request failed after retries. Check your connection and try again.");
  }

  if (!apiKey) throw new Error("No Gemini API key configured");
  // Primary model first, then progressively faster fallbacks. (gemini-1.5-*
  // are retired and 404 on new keys — they only wasted the fallback slots.)
  var models = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
  var lastErr = null;
  for (var i = 0; i < models.length; i++) {
    var model = models[i];
    if (timeLeft() < 5000) break;
    // Only 2.5-series models accept thinkingConfig — strip it for others.
    var body = /2\.5/.test(model) ? payload : stripThinking(payload);
    for (var att = 0; att < 2; att++) {
      if (timeLeft() < 5000) break;
      try {
        if (i > 0 || att > 0) { onStatus("Retrying with " + model.replace("gemini-", "Gemini ") + "..."); }
        var res = await postOnce(
          "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(apiKey),
          body, Math.min(timeoutMs, Math.max(8000, timeLeft())));
        if (res.ok) return res.data;
        var errMsg = (res.data && res.data.error && res.data.error.message) || ("API error " + res.status);
        if (res.status === 400 && /thinking/i.test(errMsg) && body.generationConfig && body.generationConfig.thinkingConfig) {
          body = stripThinking(body); att--; continue; // strip and retry same model, free attempt
        }
        if (res.status === 404 || /not found|not supported|unknown model/i.test(errMsg)) {
          lastErr = new Error("Model unavailable: " + model);
          break; // next model
        }
        if (res.status === 429) { lastErr = new Error(mapGeminiError(429, errMsg)); await sleep(2500); continue; }
        if (res.status >= 500) { lastErr = new Error(mapGeminiError(res.status, errMsg)); await sleep(1200); continue; }
        throw new Error(mapGeminiError(res.status, errMsg));
      } catch (e) {
        if (e && e.name === "AbortError") {
          // Timed out — don't burn the remaining budget on the same model; move
          // straight to the next (faster) one.
          lastErr = new Error("Gemini kept timing out even after retries. Try again in a moment, or process fewer pages at once.");
          break;
        }
        if (e instanceof TypeError) {
          lastErr = new Error("Network/CORS error calling Gemini. If you opened this HTML directly, run it from a local server (for example: `python3 -m http.server`) and retry.");
          await sleep(1000); continue;
        }
        throw e;
      }
    }
  }
  throw lastErr || new Error("No compatible Gemini model was available for this key.");
}

async function aiReadProductLabel(imageDataUrl, apiKey, proxyUrl) {
  if (!apiKey && !proxyUrl) throw new Error("No Gemini key or proxy URL configured");
  var jpegUrl = await ensureJpeg(imageDataUrl);
  jpegUrl = await downscaleDataUrl(jpegUrl, 1600, 0.85);
  var data = await callGeminiGenerateContent({
      system_instruction: { parts: [{ text: "You read dental/orthodontic/medical product labels and packaging. You MUST respond with ONLY a raw JSON object — no explanations, no markdown, no text before or after. The JSON object must have these fields: name (string, product name), sku (string, part or catalog number), vendor (string, manufacturer or brand), unit (string, what one piece is called — e.g. syringe, glove, bracket, roll), packaging (string, how they are grouped — e.g. box, pack, bag, case), unitsPerPkg (integer or null, units per package), pkgsPerCase (integer or null, packages per case), note (string or null, extra info like shade, size, color, flavor). Use null for anything you cannot determine. CRITICAL: Output ONLY the JSON object. Do NOT include any text, explanation, or commentary." }] },
      contents: [{ parts: [
        { text: "Extract product details from this image. Output ONLY the JSON object, nothing else." },
        { inline_data: { mime_type: dataUrlMime(jpegUrl), data: dataUrlToBase64(jpegUrl) } }
      ] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0, thinkingConfig: { thinkingBudget: 0 } }
    }, apiKey, proxyUrl);
  var content = geminiResponseText(data);
  var parsedLabel = extractJsonBlock(content);
  if (!parsedLabel || Array.isArray(parsedLabel)) throw new Error("AI did not return valid product data. Try a clearer photo of the label.");
  return parsedLabel;
}
// ─────────────────────────────────────────────────────────────────────────────
// Invoice-line ↔ inventory matching engine
//
// The old matcher had two failure modes staff hit constantly:
//   1) "matched nothing" — SKUs had to be EXACTLY equal (vendors print
//      860-142-00 for a stored 860142), and name matching required a big word
//      overlap, so punctuation, plurals, and abbreviations (".019", "SS",
//      "NiTi", "lig ties") killed obvious matches.
//   2) "matched the wrong thing" — a single generic shared word ("wire",
//      "plus") could drag a line onto an unrelated item.
// New strategy: normalize aggressively (synonyms, plurals, sizes, punctuation),
// then accept a match only on a normalized SKU hit, a RARE distinctive word
// (one that appears in ≤2 inventory items — near-unique is near-proof), a
// strong overlap score, or 2+ distinctive shared words. Every candidate list
// is also surfaced to the UI as tap-to-pick suggestions, so even a miss is a
// one-tap fix instead of a manual search.
// ─────────────────────────────────────────────────────────────────────────────

// Words that must never, on their own, drive a match.
var GENERIC_MATCH_WORDS = { plus: 1, white: 1, black: 1, clear: 1, blue: 1, green: 1, red: 1,
  pink: 1, yellow: 1, purple: 1, violet: 1, small: 1, large: 1, medium: 1, mini: 1,
  kit: 1, set: 1, pack: 1, box: 1, case: 1, bag: 1, refill: 1, with: 1, and: 1, the: 1,
  for: 1, size: 1, new: 1, pro: 1, exam: 1, value: 1, regular: 1, standard: 1,
  assorted: 1, asst: 1, dental: 1, ortho: 1, orthodontic: 1, orthodontics: 1,
  count: 1, per: 1, each: 1, single: 1, disposable: 1, sample: 1, unit: 1 };

// Fold common ortho-supply synonyms/abbreviations to one canonical token so
// slip wording and inventory wording line up ("Elastic Ligature Ties" ↔
// "Elastomeric Ligatures").
var MATCH_SYNONYM_RULES = [
  [/stainless\s*steel/g, " ss "],
  [/nickel[\s-]*titanium|\bniti\b|\bni-ti\b/g, " niti "],
  [/elastomerics?|elastics?/g, " elast "],
  [/ligatures?|\bligs?\b/g, " lig "],
  [/brackets?|\bbrkts?\b/g, " bracket "],
  [/arch\s*wires?|archwires?/g, " archwire "],
  [/\bmaxillary\b|\bmax\b|\bupper\b/g, " upper "],
  [/\bmandibular\b|\bmand\b|\blower\b/g, " lower "],
  [/\bgloves?\b/g, " glove "],
  [/\bo-?rings?\b/g, " oring "],
  [/power\s*chains?|powerchains?/g, " powerchain "]
];

// Normalize a product name into comparable tokens.
function matchTokens(name) {
  var s = String(name || "").toLowerCase();
  s = s.replace(/\.(\d)/g, "$1");                    // .019 → 019 (decimal sizes)
  s = s.replace(/(\d)\s*["”]/g, "$1 ");              // 019" → 019
  s = s.replace(/(\d)\s*[x×*]\s*(?=[\d.])/g, "$1x"); // 019 x 025 → 019x025
  MATCH_SYNONYM_RULES.forEach(function(rule) { s = s.replace(rule[0], rule[1]); });
  s = s.replace(/[^a-z0-9]+/g, " ");
  var out = [];
  s.split(/\s+/).forEach(function(t) {
    if (t.length < 2) return;
    t = t.replace(/\d+/g, function(d) { return String(parseInt(d, 10)); }); // 019x025 → 19x25, 007 → 7
    if (t.length > 3 && /s$/.test(t) && !/ss$/.test(t)) t = t.slice(0, -1); // naive singular
    if (t.length >= 2 && out.indexOf(t) === -1) out.push(t);
  });
  return out;
}

// Normalize a SKU/part number for comparison: case, spaces, dashes, dots,
// leading zeros all ignored.
function normSku(sku) {
  return String(sku || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^0+(?=\d)/, "");
}

// Do two normalized SKUs refer to the same part? Exact, or one contains the
// other (vendors append suffixes like -EA/-BX and packaging codes).
function skusAlike(a, b) {
  if (!a || !b || a.length < 3 || b.length < 3) return false;
  if (a === b) return true;
  return (b.length >= 5 && a.indexOf(b) !== -1) || (a.length >= 5 && b.indexOf(a) !== -1);
}

// Precompute per-item tokens + how many items contain each token (rarity).
function buildInventoryMatchIndex(items) {
  var freq = {}, toks = {};
  (items || []).forEach(function(it) {
    var t = matchTokens(it.name);
    toks[it.id] = t;
    t.forEach(function(w) { freq[w] = (freq[w] || 0) + 1; });
  });
  return { freq: freq, toks: toks };
}

// Score every inventory item against a slip-line name. Returns candidates
// sorted best-first: { id, score, dcount, rare, accepted }.
function scoreNameMatch(aiName, items, idx) {
  var aiToks = matchTokens(aiName);
  if (!aiToks.length) return [];
  var aiCompact = aiToks.join("");
  var out = [];
  (items || []).forEach(function(it) {
    var itToks = (idx && idx.toks && idx.toks[it.id]) || matchTokens(it.name);
    if (!itToks.length) return;
    var shared = itToks.filter(function(t) { return aiToks.indexOf(t) !== -1; });
    var distinct = shared.filter(function(t) { return !GENERIC_MATCH_WORDS[t]; });
    // Compact containment rescues spacing differences ("OrthoPrime" ↔ "Ortho Prime")
    var itCompact = itToks.join("");
    var compactHit = (itCompact.length >= 6 && aiCompact.indexOf(itCompact) !== -1) ||
                     (aiCompact.length >= 6 && itCompact.indexOf(aiCompact) !== -1);
    if (!distinct.length && !compactHit) return;
    var fwd = shared.length / itToks.length;
    var rev = shared.length / aiToks.length;
    var score = Math.max(fwd, rev);
    if (compactHit) score = Math.max(score, 0.9);
    // A shared distinctive word that appears in ≤2 inventory items is
    // near-unique — strong evidence even when the overall overlap is small.
    var rare = distinct.some(function(t) { return idx && idx.freq && (idx.freq[t] || 0) <= 2 && t.length >= 3; });
    var accepted = compactHit || score >= 0.5 || distinct.length >= 2 || (rare && score >= 0.15);
    out.push({ id: it.id, score: score, dcount: distinct.length, rare: rare, accepted: accepted });
  });
  out.sort(function(a, b) { return (b.score - a.score) || (b.dcount - a.dcount); });
  return out;
}

// Find inventory items whose SKU (main or any source SKU) matches the slip SKU.
function skuMatchItems(items, rawSku) {
  var q = normSku(rawSku);
  if (!q || q.length < 3) return { list: [], exact: false };
  var exact = [], partial = [];
  (items || []).forEach(function(it) {
    var skus = [];
    if (it.sku) skus.push(it.sku);
    listOf(it.sources).forEach(function(s) { if (s && s.sku) skus.push(s.sku); });
    var hitExact = false, hitPart = false;
    skus.forEach(function(s) {
      var n = normSku(s);
      if (!n || n.length < 3) return;
      if (n === q) hitExact = true;
      else if (skusAlike(n, q)) hitPart = true;
    });
    if (hitExact) exact.push(it);
    else if (hitPart) partial.push(it);
  });
  return exact.length ? { list: exact, exact: true } : { list: partial, exact: false };
}

// Full per-line matching pipeline: SKU → AI-proposed ID → fuzzy name.
// Returns { itemId, matchType ("sku" trusted | "fuzzy" needs review | "" none),
// suggestions: [itemId,...] } — suggestions power the tap-to-pick chips.
function matchRowToItem(row, items, idx) {
  // 1. SKU — a unique exact hit is the only auto-trusted match.
  if (row.sku) {
    var sm = skuMatchItems(items, row.sku);
    if (sm.list.length === 1 && sm.exact) {
      return { itemId: sm.list[0].id, matchType: "sku", suggestions: [] };
    }
    if (sm.list.length > 0) {
      // Ambiguous or partial SKU hit — solid lead, but a human confirms it.
      return { itemId: sm.list[0].id, matchType: "fuzzy", suggestions: sm.list.slice(0, 3).map(function(it) { return it.id; }) };
    }
  }
  // 2. Fuzzy name scoring (also builds the suggestion list).
  var scored = scoreNameMatch(row.name, items, idx);
  var accepted = scored.filter(function(s) { return s.accepted; });
  // 3. AI-proposed match (verified to actually exist) — Gemini sees the whole
  // inventory list and is far better at "Lig Ties Slvr 1000" ≡ "Elastomeric
  // Ligatures Silver" than any word math. Still lands as "fuzzy" so the
  // safety gate makes a human confirm before stock moves.
  var aiId = (row.matchItemId && (items || []).some(function(it) { return it.id === row.matchItemId; })) ? row.matchItemId : "";
  if (aiId) {
    var sugg = [aiId].concat(accepted.map(function(s) { return s.id; }).filter(function(id) { return id !== aiId; })).slice(0, 3);
    return { itemId: aiId, matchType: "fuzzy", suggestions: sugg };
  }
  if (accepted.length > 0) {
    return { itemId: accepted[0].id, matchType: "fuzzy", suggestions: accepted.slice(0, 3).map(function(s) { return s.id; }) };
  }
  // 4. No acceptable match — treat as new, but keep weak leads as suggestions.
  return { itemId: "", matchType: "", suggestions: scored.slice(0, 3).map(function(s) { return s.id; }) };
}

// Loose overlap between two token lists (used to align slip lines with order lines).
function tokenListsOverlap(aToks, bToks) {
  if (!aToks.length || !bToks.length) return false;
  var shared = aToks.filter(function(t) { return bToks.indexOf(t) !== -1 && !GENERIC_MATCH_WORDS[t]; });
  if (shared.length >= 2) return true;
  return shared.length >= 1 && (shared.length / Math.max(1, Math.min(aToks.length, bToks.length))) >= 0.5;
}

// Vendor-name similarity that understands abbreviations: "AO" matches
// "American Orthodontics", "HSD" matches "Henry Schein Dental", plus the old
// containment/shared-word logic. Returns true/false.

// Score one OPEN order against the scanned entries. Vendor similarity is a
// SIGNAL here, not a gate — the old hard vendor filter meant a misread vendor
// name (or "AO" vs "American Orthodontics") could never match any order, so
// slips were logged as brand-new "received" orders while the real open order
// sat there forever. An order number printed on the slip that matches one
// stored on the order is treated as decisive.
function scoreOrderAgainstScan(order, scannedEntries, slipVendor, slipOrderNumber) {
  var lines = (order && order.items) || [];
  var score = 0, itemHits = 0;
  var oNum = normSku(order && order.orderNumber);
  var sNum = normSku(slipOrderNumber);
  var numHit = !!(oNum && sNum && oNum.length >= 3 && sNum.length >= 3 && (oNum === sNum || oNum.indexOf(sNum) !== -1 || sNum.indexOf(oNum) !== -1));
  if (numHit) score += 10;
  var vendorHit = !!vendorNamesSimilar(order && order.vendor, slipVendor);
  if (vendorHit) score += 2;
  var ids = {}, skus = [], nameToks = [];
  (scannedEntries || []).forEach(function(e) {
    if (e.itemId) ids[e.itemId] = 1;
    var ns = normSku(e.sku); if (ns && ns.length >= 3) skus.push(ns);
    var nm = e.aiName || e.newName || "";
    if (nm.trim().length > 2) nameToks.push(matchTokens(nm));
  });
  lines.forEach(function(oi) {
    if (oi.itemId && ids[oi.itemId]) { itemHits++; return; }
    var os = normSku(oi.sku);
    if (os && skus.some(function(s) { return skusAlike(s, os); })) { itemHits++; return; }
    var ot = matchTokens(oi.name || "");
    if (ot.length && nameToks.some(function(nt) { return tokenListsOverlap(ot, nt); })) itemHits++;
  });
  score += itemHits * 3;
  // vendorHit is exported so the received-order (price-update) matcher can hold
  // itself to a stricter bar than the open-order matcher.
  return { score: score, itemHits: itemHits, numHit: numHit, vendorHit: vendorHit };
}

// Generates a studio-quality product photo from a snapshot
async function aiGenerateProductPhoto(imageDataUrl, productName, apiKey) {
  if (!apiKey) throw new Error("No API key configured");
  if (/^AIza/i.test((apiKey || "").trim())) {
    throw new Error("Photo Studio needs an OpenAI key (starts with sk-), but a Gemini key (AIza...) was provided.");
  }
  // Use GPT-4o image generation (images endpoint with DALL-E 3)
  var t = withTimeout(45000);
  var resp;
  try {
    resp = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { "Authorization": "Bearer " + apiKey },
      signal: t.signal,
      body: await (async function() {
        // the data URL as a file (fetch() of a data: URL is blocked by this page's security rules)
        var blob = dataUrlToBlob(await ensureJpeg(imageDataUrl));
        var fd = new FormData();
        fd.append("image", blob, /png/.test(blob.type) ? "product.png" : "product.jpg");
        fd.append("prompt",
          "Re-shoot this exact product as a clean commercial catalog photo. " +
          "CRITICAL: keep the product itself faithful to the source image. " +
          "Preserve the real shape, proportions, silhouette, materials and color of the actual product. " +
          "Preserve every brand logo, wordmark, label, sticker, printed graphic, model number and barcode exactly as they appear — do not invent, redesign, retranslate, reword, or stylize any text or logos. " +
          "Preserve the packaging design (box art, pouch print, bottle label, cap color). " +
          "Only change: the background (make it pure seamless white #ffffff), the lighting (soft studio fill with a subtle directional highlight), any clutter or reflections from the original scene, and the framing (center the product, three-quarter angle, fully visible, small margin on all sides). " +
          "Straighten the product, remove shadows onto other objects, and give it a tasteful soft contact shadow on the white background. " +
          "Deep focus across the product. No background blur. No added props, no extra units, no duplicated packaging, no photo-bashing. " +
          "The result must be instantly recognizable as the SAME SKU pictured. Product name for context: " + (productName || "dental supply product") + ".");
        fd.append("model", "gpt-image-1");
        fd.append("size", "1024x1024");
        fd.append("quality", "high");
        return fd;
      }())
    });
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("OpenAI image request timed out after 45s.");
    if (e instanceof TypeError) throw new Error("Network/CORS error calling OpenAI. Run this app from a local server instead of opening the HTML file directly.");
    throw e;
  } finally {
    t.done();
  }
  if (!resp.ok) {
    var errData = await resp.json().catch(function() { return {}; });
    /* no fallback to DALL-E: it ignores the photo and invents a different-looking product */
    throw new Error(errData.error?.message || "Image edit failed");
  }
  var data = await resp.json();
  // gpt-image-1 returns b64_json
  if (data.data?.[0]?.b64_json) {
    return "data:image/png;base64," + data.data[0].b64_json;
  }
  return data.data?.[0]?.url || null;
}


/* ---------- Ask: questions about spending, orders and who did what ---------- */
const ASK_SYS = "You are the NLO Inventory Assistant for Next Level Orthodontics, an orthodontic office. Answer questions about their supply inventory, spending, orders, vendors, usage and who did what (who added to the cart, who ordered, who received) using ONLY the JSON data provided. When computing a total, first list each matching record on its own line (item — date — amount), then give the total on a final line like 'Total: $123.45'. Double-check your arithmetic. Use today's date in the data for relative ranges like 'last 2 weeks'. Match item names loosely (e.g. 'resin' matches any item whose name or group contains it, case-insensitive). Stock counts are not always kept up to date; say so when an answer depends on them. If the data cannot answer the question, say exactly what's missing — never invent numbers. Keep answers short. Plain text only, no markdown.";
function askContext() {
  const r2 = v => Math.round((Number(v) || 0) * 10000) / 10000;
  return {
    today: todayISO(),
    note: 'Each supply is counted in "unit" (qty on hand). Some are bought bigger: "buyUnit" holds "perBuy" units (gloves: case of 10 boxes). pricePerUnit is per counted unit; pricePerBuyUnit = pricePerUnit × perBuy. Order lines: qty in their own "unit", lineTotal is what the line cost. activityLog: type receive = received into stock (amount = dollars booked), use/count/adjust = stock steps; negative receive amounts are reversals of a reopened order. "by" fields name the person.',
    items: items().map(i => { const s = primarySource(i), cp = countPrice(s); return { name: i.name, cat: catLabel(i.cat), group: i.group || undefined, qty: i.qty || 0, unit: countUnit(i), buyUnit: buysBigger(i) ? buyUnit(i) : undefined, perBuy: buysBigger(i) ? perBuy(i) : undefined, min: i.min || undefined, archived: i.archived || undefined,
      pricePerUnit: cp, pricePerBuyUnit: cp != null && buysBigger(i) ? r2(cp * perBuy(i)) : undefined, vendors: allSources(i).map(x => ({ vendor: x.vendor, price: countPrice(x), lastPaid: x.lastDate })) }; }),
    cart: S.D.cart.map(c => ({ name: c.name, qty: c.qty, unit: c.unit, vendor: c.vendor, price: c.price, addedBy: c.addedBy, addedAt: c.addedAt })),
    orders: S.D.orders.filter(o => o.status !== 'voided').sort((a, b) => orderWhen(b) - orderWhen(a)).slice(0, 200).map(o => ({ vendor: o.vendor, status: o.status, dateOrdered: o.dateOrdered, orderedBy: o.orderedBy, method: o.method, dateReceived: o.dateReceived ? dayOf(o.dateReceived) : undefined, receivedBy: o.receivedBy, total: orderTotal(o),
      lines: o.items.map(l => ({ name: l.name, qty: l.qty, unit: l.unit, unitPrice: l.price, lineTotal: orderItemCost(l), addedBy: l.addedBy })) })),
    activityLog: S.D.log.slice(0, 300).map(e => ({ item: e.itemName, type: e.type, delta: e.delta, amount: e.amount, date: e.date, by: e.by })),
    manualExpenses: listOf(S.D.expenses).map(x => ({ category: catLabel(x.category), amount: x.amount, date: x.date, note: x.note || x.vendor, by: x.by })),
    monthlyBudget: budgetMonthly()
  };
}
const ASK = { open: false, msgs: [], busy: false };
const ASK_EXAMPLES = ['How much did we spend on gloves in the last 2 months?', 'What did we order from Patterson this month, and who ordered it?', 'Which gloves are cheapest per box?', 'Who received the last American Orthodontics order?'];
function renderAsk() {
  let el = $('#askPanel');
  if (!ASK.open) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'askPanel'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Ask about supplies'); document.body.appendChild(el); }
  el.innerHTML = '<div class="askHd"><b>' + ic('spark', 16) + ' Ask about supplies</b><button class="iconBtn" data-act="askClose" aria-label="Close">' + ic('x', 16) + '</button></div><div class="askBd" id="askBd">' +
    (ASK.msgs.length ? ASK.msgs.map(m => '<div class="askM ' + m.role + '">' + esc(m.text) + '</div>').join('') : '<div class="muted small" style="margin-bottom:8px">Try:</div>' + ASK_EXAMPLES.map(x => '<button class="pick sm" style="margin:0 6px 6px 0" data-act="askEx">' + esc(x) + '</button>').join('')) +
    (ASK.busy ? '<div class="askM model"><span class="spin"></span></div>' : '') + '</div>' +
    '<div class="askFt"><input class="inp" id="askQ" placeholder="Ask about spending, orders, who…" data-enter="#askGo" autocomplete="off"><button class="btn btn-pri btn-sm" id="askGo" data-act="askGo">Ask</button></div>';
  const bd = $('#askBd'); bd.scrollTop = bd.scrollHeight; const q = $('#askQ'); if (q && !ASK.busy) q.focus();
}
ACT.askOpen = () => { ASK.open = true; renderAsk(); };
ACT.askClose = () => { ASK.open = false; renderAsk(); };
ACT.askEx = t => { const q = $('#askQ'); q.value = t.textContent; q.focus(); };
ACT.askGo = async () => {
  const q = val('askQ').trim(); if (!q || ASK.busy) return;
  ASK.msgs.push({ role: 'user', text: q }); ASK.busy = true; renderAsk();
  try {
    const k = await aiKeys();
    if (!k.gemini && !k.proxy) throw new Error(S.demo ? 'Ask isn’t available in the demo.' : 'AI isn’t set up yet. Dr. A can add the Gemini key under Settings → AI.');
    const payload = { system_instruction: { parts: [{ text: ASK_SYS + '\n\nDATA:\n' + JSON.stringify(askContext()) }] }, contents: ASK.msgs.slice(-10).map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] })) };
    const data = await callGeminiGenerateContent(payload, k.gemini, k.proxy);
    ASK.msgs.push({ role: 'model', text: geminiResponseText(data).trim() || 'No answer came back — try asking another way.' });
  } catch (e) { ASK.msgs.push({ role: 'model', text: 'Couldn’t answer: ' + errText(e) }); }
  ASK.busy = false; renderAsk();
};

/* ---------- Settings → AI (Dr. A's own account only) ---------- */
function aiSettingsHTML() {
  const mask = k => k ? '•••• ' + String(k).slice(-4) : 'not set';
  return '<div class="kvRow"><span>Gemini key</span><b id="aiG">' + (S.ui.aiK ? esc(mask(S.ui.aiK.gemini)) : '<button class="linkBtn" data-act="aiLoad">show status</button>') + '</b></div>' +
    '<div class="kvRow"><span>OpenAI key (product photos)</span><b>' + (S.ui.aiK ? esc(mask(S.ui.aiK.openai)) : '—') + '</b></div>' +
    '<div class="kvRow"><span>Gemini proxy</span><b>' + esc(S.settings.geminiProxyUrl || 'not set') + '</b></div>' +
    '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="aiEdit">' + ic('edit', 15) + 'Change</button></div>' +
    '<div class="hint">Keys are read only when a step needs them and aren’t saved on office computers. For extra safety, restrict the Gemini key to this site in Google Cloud.</div>';
}
ACT.aiLoad = async () => { AIK.at = 0; S.ui.aiK = await aiKeys(); renderView(true); };
ACT.aiEdit = () => {
  if (!(isOwnerAccount() || S.demo)) return;
  openModal('<h3>AI keys</h3><div class="lsub">Leave a box empty to keep what’s there. Type <b>clear</b> to remove one.</div>' +
    field('Gemini API key', '<input id="aiGem" autocomplete="off" spellcheck="false" placeholder="AIza…">') + field('OpenAI API key (optional)', '<input id="aiOai" autocomplete="off" spellcheck="false" placeholder="sk-…">') +
    field('Gemini proxy URL (optional)', '<input id="aiProxy" value="' + esc(S.settings.geminiProxyUrl || '') + '" placeholder="https://…workers.dev/…">') +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeModal">Cancel</button><button class="btn btn-pri" data-act="aiSave">Save</button></div>', { cls: 'mid' });
};
ACT.aiSave = async () => {
  const g = val('aiGem').trim(), o = val('aiOai').trim(), p = val('aiProxy').trim();
  const ok = await act(async () => {
    if (g) await B.setSetting('geminiKey', g === 'clear' ? null : g);
    if (o) await B.setSetting('openaiKey', o === 'clear' ? null : o);
    if (p !== String(S.settings.geminiProxyUrl || '')) await B.setSetting('geminiProxyUrl', p || null);
    AIK.at = 0; S.ui.aiK = null;
  }, 'Saved.');
  if (ok) closeModal(true);
};
