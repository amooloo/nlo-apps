// ====================================================================
// AISA Worker — Full-Context Mode (with RAG fallback)
// v2.0 — SPEED UPDATE (2026-06-10):
//   1. Gemini "thinking" disabled (thinkingBudget: 0) — biggest latency win
//   2. Knowledge base moved into system_instruction — stable prompt prefix
//      so Gemini's implicit caching kicks in across questions
//   3. In-memory KB cache (5 min) — skips re-reading KV on every question
//   4. maxOutputTokens capped — shorter answers generate faster
//   5. NEW /ask-stream route — streams the answer as plain text chunks
//      (frontend v3.1.0 uses it automatically, falls back to /ask)
// ====================================================================
// MODE TOGGLE: Set to "full" to send all training files as context,
//              or "rag" to use vector search (legacy behavior).
const KNOWLEDGE_MODE = "full";

// In-memory knowledge base cache (per isolate; refreshed every 5 min,
// cleared immediately on /train in the same isolate)
let KB_CACHE = { text: null, ts: 0 };
const KB_CACHE_TTL = 5 * 60 * 1000;

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
	  // Stores full file text in KV. Also stores vectors for RAG fallback.
	  // ====================================================================
	  if (url.pathname === "/train" && request.method === "POST") {
		const authKey = request.headers.get('X-Admin-Key') || '';
		const storedKey = env['ADMIN-KEY'] || env['ADMIN_KEY'] || env.ADMIN_KEY;
		if (!storedKey || authKey !== storedKey) {
		  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
		  });
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
		  }
		  let totalSaved = 0;
		  if (env.VECTORIZE) {
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
			try {
			  const oldIds = [];
			  for (let j = 0; j < 1000; j++) { oldIds.push(`${label}_chunk_${j}`); }
			  for (let j = 0; j < oldIds.length; j += 100) { await env.VECTORIZE.deleteByIds(oldIds.slice(j, j + 100)); }
			} catch (delErr) {}
			const batchSize = 50;
			for (let i = 0; i < rawChunks.length; i += batchSize) {
			  const batch = rawChunks.slice(i, i + batchSize);
			  const embeddingData = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: batch });
			  const vectorsToInsert = batch.map((chunk, index) => ({ id: `${label}_chunk_${i + index}`, values: embeddingData.data[index], metadata: { text: chunk, fileLabel: label } }));
			  await env.VECTORIZE.upsert(vectorsToInsert);
			  totalSaved += batch.length;
			}
		  }
		  return new Response(JSON.stringify({ success: true, mode: env.KNOWLEDGE_KV ? 'full-context + rag-backup' : 'rag-only', fileLabel: label, chunksSaved: totalSaved, kvStored: !!env.KNOWLEDGE_KV }), { headers: { "Content-Type": "application/json", ...corsHeaders(origin) } });
		} catch (err) {
		  return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } });
		}
	  }

	  // ====================================================================
	  // ROUTE: LIST FILES (/files)
	  // ====================================================================
	  if (url.pathname === "/files" && request.method === "GET") {
		const authKey = request.headers.get('X-Admin-Key') || url.searchParams.get('key') || '';
		const storedKey = env['ADMIN-KEY'] || env['ADMIN_KEY'] || env.ADMIN_KEY;
		if (!storedKey || authKey !== storedKey) { return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } }); }
		try {
		  let files = [];
		  if (env.KNOWLEDGE_KV) {
			const index = await env.KNOWLEDGE_KV.get('__file_index__', 'json');
			if (Array.isArray(index)) { for (const label of index) { const text = await env.KNOWLEDGE_KV.get(`file:${label}`); files.push({ label, characters: text ? text.length : 0 }); } }
		  }
		  const totalChars = files.reduce((sum, f) => sum + f.characters, 0);
		  const estimatedTokens = Math.round(totalChars / 4);
		  return new Response(JSON.stringify({ mode: KNOWLEDGE_MODE, fileCount: files.length, totalCharacters: totalChars, estimatedTokens, estimatedCostPerQuery: `$${(estimatedTokens * 0.00000015).toFixed(6)}`, files }), { headers: { "Content-Type": "application/json", ...corsHeaders(origin) } });
		} catch (err) { return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } }); }
	  }

	  // ====================================================================
	  // ROUTE: DELETE A FILE (/delete-file)
	  // ====================================================================
	  if (url.pathname === "/delete-file" && request.method === "POST") {
		const authKey = request.headers.get('X-Admin-Key') || '';
		const storedKey = env['ADMIN-KEY'] || env['ADMIN_KEY'] || env.ADMIN_KEY;
		if (!storedKey || authKey !== storedKey) { return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } }); }
		try {
		  const { fileLabel } = await request.json();
		  const label = (fileLabel || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 80).toLowerCase();
		  if (env.KNOWLEDGE_KV) {
			await env.KNOWLEDGE_KV.delete(`file:${label}`);
			let fileIndex = [];
			try { const existing = await env.KNOWLEDGE_KV.get('__file_index__', 'json'); if (Array.isArray(existing)) fileIndex = existing; } catch (e) {}
			fileIndex = fileIndex.filter(f => f !== label);
			await env.KNOWLEDGE_KV.put('__file_index__', JSON.stringify(fileIndex));
			KB_CACHE = { text: null, ts: 0 }; // invalidate in-memory cache
		  }
		  if (env.VECTORIZE) { try { const oldIds = []; for (let j = 0; j < 1000; j++) { oldIds.push(`${label}_chunk_${j}`); } for (let j = 0; j < oldIds.length; j += 100) { await env.VECTORIZE.deleteByIds(oldIds.slice(j, j + 100)); } } catch (e) {} }
		  return new Response(JSON.stringify({ success: true, deleted: label }), { headers: { "Content-Type": "application/json", ...corsHeaders(origin) } });
		} catch (err) { return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } }); }
	  }

	  // ====================================================================
	  // ROUTE: PURGE OLD VECTORS (/purge-old)
	  // ====================================================================
	  if (url.pathname === "/purge-old" && request.method === "POST") {
		const authKey = request.headers.get('X-Admin-Key') || '';
		const storedKey = env['ADMIN-KEY'] || env['ADMIN_KEY'] || env.ADMIN_KEY;
		if (!storedKey || authKey !== storedKey) { return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } }); }
		try {
		  const queries = ["MARA Herbst orthodontic appliance Class II","RPE expansion palatal separator bands","orthodontic protocol delivery cement appointment","inventory supplies materials ordering","policy manual HR benefits vacation","infection control sterilization safety","patient scheduling billing insurance","staff training onboarding procedures","emergency protocol medical office","orthodontic bonding debonding adjustment"];
		  const allOldIds = new Set();
		  for (const q of queries) { const emb = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [q] }); const results = await env.VECTORIZE.query(emb.data[0], { topK: 50, returnMetadata: 'indexed' }); for (const m of results.matches) { if (m.id) allOldIds.add(m.id); } }
		  const oldIds = [...allOldIds];
		  let deleted = 0;
		  if (oldIds.length > 0) { for (let i = 0; i < oldIds.length; i += 100) { await env.VECTORIZE.deleteByIds(oldIds.slice(i, i + 100)); } deleted = oldIds.length; }
		  return new Response(JSON.stringify({ success: true, deletedCount: deleted, deletedIds: oldIds }), { headers: { "Content-Type": "application/json", ...corsHeaders(origin) } });
		} catch (err) { return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } }); }
	  }

	  // ====================================================================
	  // ROUTE 2: THE CHAT ROUTE (/ask) — classic, full answer at once
	  // ====================================================================
	  if (url.pathname === "/ask" && request.method === "POST") {
		try {
		  const reqJson = await request.json();
		  const bad = validateAsk(reqJson);
		  if (bad) return bad(origin);

		  const geminiBody = await buildGeminiBody(reqJson, env);

		  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
		  const geminiResponse = await fetch(geminiUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(geminiBody) });

		  if (!geminiResponse.ok) {
			const errData = await geminiResponse.json().catch(() => ({}));
			const errMsg = errData?.error?.message || `Gemini API error (${geminiResponse.status})`;
			console.error('Gemini API error:', errMsg);
			return new Response(JSON.stringify({ error: errMsg }), { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } });
		  }

		  const geminiData = await geminiResponse.json();
		  let finalAnswer = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "I'm sorry, I hit a snag. Can you try again?";
		  finalAnswer = cleanAnswer(finalAnswer);

		  return new Response(JSON.stringify({ answer: finalAnswer }), { headers: { "Content-Type": "application/json", ...corsHeaders(origin) } });
		} catch (err) {
		  console.error('Worker /ask error:', err);
		  return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } });
		}
	  }

	  // ====================================================================
	  // ROUTE 3: STREAMING CHAT (/ask-stream) — plain-text chunked answer
	  // Frontend v3.1.0 tries this first and falls back to /ask.
	  // ====================================================================
	  if (url.pathname === "/ask-stream" && request.method === "POST") {
		try {
		  const reqJson = await request.json();
		  const bad = validateAsk(reqJson);
		  if (bad) return bad(origin);

		  const geminiBody = await buildGeminiBody(reqJson, env);

		  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${env.GEMINI_API_KEY}`;
		  const geminiResponse = await fetch(geminiUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(geminiBody) });

		  if (!geminiResponse.ok || !geminiResponse.body) {
			const errData = await geminiResponse.json().catch(() => ({}));
			const errMsg = errData?.error?.message || `Gemini API error (${geminiResponse.status})`;
			console.error('Gemini stream error:', errMsg);
			return new Response(JSON.stringify({ error: errMsg }), { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } });
		  }

		  const { readable, writable } = new TransformStream();
		  const pump = streamSseToText(geminiResponse.body, writable);
		  if (ctx && ctx.waitUntil) ctx.waitUntil(pump);

		  return new Response(readable, {
			headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff", ...corsHeaders(origin) }
		  });
		} catch (err) {
		  console.error('Worker /ask-stream error:', err);
		  return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } });
		}
	  }

	  return new Response("NLO Worker is Running!", { headers: { "Content-Type": "text/plain", ...corsHeaders(origin) } });
	}
};

// ====================================================================
// SHARED HELPERS for /ask and /ask-stream
// ====================================================================

function validateAsk(reqJson) {
  if (!reqJson || !reqJson.question || typeof reqJson.question !== 'string') {
	return (origin) => new Response(JSON.stringify({ error: 'Missing "question" field' }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } });
  }
  return null;
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
		const fileTexts = [];
		for (const label of fileIndex) { const text = await env.KNOWLEDGE_KV.get(`file:${label}`); if (text) fileTexts.push(`\n========== FILE: ${label} ==========\n${text}`); }
		knowledgeBase = fileTexts.join('\n\n');
		if (knowledgeBase) KB_CACHE = { text: knowledgeBase, ts: Date.now() };
	  }
	} catch (kvErr) { console.error('KV read error, falling back to RAG:', kvErr); }
  }
  if (!knowledgeBase && env.VECTORIZE) {
	const questionEmbedding = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [question] });
	const searchResults = await env.VECTORIZE.query(questionEmbedding.data[0], { topK: 15, returnMetadata: true });
	let contextSnippets = "";
	for (const match of searchResults.matches) { if (match.metadata?.text) contextSnippets += match.metadata.text + "\n\n"; }
	knowledgeBase = contextSnippets;
  }
  return knowledgeBase;
}

async function buildGeminiBody(reqJson, env) {
  const { question, inventoryData, history, image, staffName, staffRole } = reqJson;

  const knowledgeBase = await getKnowledgeBase(question, env);

  const systemInstruction = `
		You are AISA, a friendly and experienced Senior Clinical Assistant at Next Level Orthodontics.

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
  if (inventoryData) userMessageText += `=== LIVE INVENTORY DATA ===\n${inventoryData}\n`;
  if (roleContext) userMessageText += roleContext;
  userMessageText += `\n=== USER QUESTION ===\n${question}`;

  const userParts = [{ text: userMessageText }];
  if (image && image.data && image.mimeType) { userParts.push({ inline_data: { mime_type: image.mimeType, data: image.data } }); }

  const contents = [];
  if (Array.isArray(history)) { for (const turn of history) { if (turn.role && Array.isArray(turn.parts) && (turn.role === 'user' || turn.role === 'model')) { contents.push({ role: turn.role, parts: turn.parts.map(p => ({ text: String(p.text || '') })) }); } } }
  contents.push({ role: "user", parts: userParts });

  return {
	system_instruction: { parts: [{ text: systemInstruction }] },
	contents: contents,
	generationConfig: {
	  temperature: 0.6,
	  maxOutputTokens: 1200,
	  thinkingConfig: { thinkingBudget: 0 }
	}
  };
}

function cleanAnswer(finalAnswer) {
  return finalAnswer.split('\n').filter(line => { const trimmed = line.trim(); if (trimmed.match(/^https:\/\/drive\.google\.com\/thumbnail/)) return false; if (trimmed.includes('loading="lazy"')) return false; if (trimmed.match(/^\[PHOTO:[^\]]*\]$/)) return false; return true; }).join('\n').replace(/\[PHOTO:[^\]]*\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

// Convert Gemini's SSE stream into plain-text answer chunks
async function streamSseToText(sseBody, writable) {
  const writer = writable.getWriter();
  const reader = sseBody.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buf = '';
  try {
	while (true) {
	  const { done, value } = await reader.read();
	  if (done) break;
	  buf += decoder.decode(value, { stream: true });
	  let nl;
	  while ((nl = buf.indexOf('\n')) !== -1) {
		const line = buf.slice(0, nl).trim();
		buf = buf.slice(nl + 1);
		if (!line.startsWith('data:')) continue;
		const data = line.slice(5).trim();
		if (data === '[DONE]') continue;
		try {
		  const json = JSON.parse(data);
		  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
		  if (text) await writer.write(encoder.encode(text));
		} catch (e) { /* ignore partial lines */ }
	  }
	}
  } catch (e) {
	console.error('Stream pump error:', e);
  } finally {
	try { await writer.close(); } catch (e) {}
  }
}

// --- CORS helpers ---
const ALLOWED_ORIGINS = ['https://amooloo.github.io', 'http://localhost', 'http://127.0.0.1'];
function isAllowedOrigin(origin) { if (!origin || origin === 'null') return true; return ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed)); }
function corsHeaders(origin) {
  if (!origin || origin === 'null') return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key', 'Access-Control-Max-Age': '86400' };
  const allowedOrigin = isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0];
  return { 'Access-Control-Allow-Origin': allowedOrigin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key', 'Access-Control-Max-Age': '86400' };
}
