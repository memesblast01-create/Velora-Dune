# Velora Dune — RAG Chatbot (Cloudflare + Claude)

A production-oriented Retrieval-Augmented Generation chatbot for the Velora Dune
restaurant website, built entirely on Cloudflare's edge stack with Anthropic's
Claude API as the generator. It is designed to be dropped into the existing
site (`https://velora-dune.vercel.app/`) as a small floating chat widget
without touching the rest of the page.

## Architecture

```
Browser (velora-dune.vercel.app)
   │  widget/velora-chat-widget.js  (floating chat bubble)
   │  POST /api/chat  { message, history }
   ▼
Cloudflare Worker  (src/index.ts)
   │  1. CORS + origin check
   │  2. Rate limit (KV, sliding window per IP)
   │  3. Input validation (length, shape, basic abuse patterns)
   │  4. Embed the user's question — Workers AI (bge-base-en-v1.5)
   │  5. Query Vectorize for top-k relevant chunks (+ similarity threshold)
   │  6. Assemble a grounded context block (chunks tagged as DATA, not instructions)
   │  7. Generate the answer — Workers AI (Llama 3.3 70B instruct)
   │  8. Return { answer, sources }
   ▼
Vectorize index          Workers AI (embeddings + generation, one platform)
   ▲
   │ populated once (and whenever the PDF changes) by:
scripts/ingest.ts  →  PDF → clean → chunk → embed → upsert
   │
R2 bucket (original PDF, for audit / re-ingestion)
```

D1 is intentionally **not** used — there's no structured application data here
(no orders, accounts, etc.), just a knowledge base and ephemeral rate-limit
counters, both of which fit Vectorize + KV better than a relational store.
Adding D1 would be exactly the "unnecessary infrastructure" the brief warns
against.

## Why these choices

**Chunking — semantic, section-based, ~150–350 words (≈250–500 tokens) with
~15% overlap.**
The knowledge base PDF is already organized into 21 clearly numbered sections
(`1. Cover / Title Page` … `21. Closing Summary Page`), each closed with a
one-paragraph summary sentence. Splitting on those section boundaries first —
rather than a blind fixed-character split — keeps each chunk topically
coherent (e.g. the whole "Reservations Policy" section stays together,
instead of being sliced mid-sentence). Sections that run long (the four menu
sections, the FAQ) are then sub-split on paragraph/dish boundaries into
~250–500 token pieces with ~15% overlap, so a chunk boundary never cuts a
dish's name away from its price and description. Overlap is kept modest
(not 50%) because the source sections are already short and self-contained;
heavy overlap would mostly just duplicate storage and dilute retrieval.

**Embedding model — `@cf/baai/bge-base-en-v1.5` (Workers AI).**
768 dimensions, strong general-purpose retrieval quality, runs natively on
Workers AI so embeddings never leave Cloudflare's network, and it's
inexpensive enough for a ~120-page knowledge base plus per-query embedding
at chat time. `bge-large` would add cost/latency for a marginal quality gain
on a knowledge base this size; a smaller model would start losing nuance on
menu/dietary questions.

**Retrieval — top_k = 5, cosine similarity threshold = 0.72.**
Five chunks is enough to cover a multi-part question ("what vegetarian mains
do you have and are they gluten-free?") without bloating the Claude context
or drowning the model in marginally-related chunks. The 0.72 threshold is a
practical cutoff for bge-base cosine scores on short, well-structured
passages: chunks above it are treated as reliable grounding, chunks below it
are dropped rather than passed to the model. If *nothing* clears the
threshold, the Worker tells Claude explicitly "no reliable context found,"
which is what makes the "I couldn't find that in my Velora Dune information"
behavior actually reliable instead of a hope.

**No reranking / hybrid search.** At ~150–250 chunks total, a single dense
vector search over Vectorize is already fast and accurate. Reranking or
BM25+vector hybrid retrieval would add real infrastructure and latency for a
knowledge base this size — the brief explicitly says not to add complexity
that isn't needed, so this stays out unless the KB grows substantially.

**Generation — Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`), not
an external LLM provider.** The Worker calls `env.AI.run(...)` directly —
`env.AI` is a first-party Cloudflare binding, not a credential, so there is
no external provider key to store, rotate, or ever risk leaking. Everything
(embeddings + generation + vector search) runs on one platform and one bill.
If you'd rather use a different Workers AI chat model (e.g. Mistral, or a
newer Llama release), it's a one-line change: `GENERATION_MODEL` in
`wrangler.jsonc`. If you later want a hosted third-party model instead, swap
`callWorkersAI()` in `src/index.ts` for an HTTP call to that provider and
add its key as a Worker secret — the rest of the pipeline (retrieval, prompt
construction, security) doesn't change either way.

## Security model (summary — see `src/lib/security.ts` and `src/index.ts`)

- **Prompt injection**: the system prompt is fixed and never built from user
  input. Retrieved chunks and the user's message are both wrapped in explicit
  `<untrusted_*>` delimiters with a standing instruction that any
  instruction-like text inside them is data to describe, never a command to
  follow. There's a lightweight pre-filter that flags obvious
  exfiltration attempts (asking for the system prompt, API keys, "ignore
  previous instructions", etc.) and short-circuits them before they ever
  reach Claude.
- **RAG poisoning**: retrieved chunk content is only ever placed inside the
  untrusted-context block, never concatenated into the system prompt or
  treated as configuration.
- **Data leakage**: only the top-k chunk *text* and a `{section, page}`
  citation are returned — no vector IDs, raw metadata, or unrelated chunks.
- **Secrets**: there is no LLM provider key at runtime at all — generation
  goes through the first-party `env.AI` binding. The only credentials in
  this project are `CF_ACCOUNT_ID` / `CF_API_TOKEN`, used solely by the
  *ingestion script* (which you run locally, not in the browser or the
  Worker) to write embeddings into Vectorize and archive the PDF to R2.
- **Abuse / cost protection**: per-IP sliding-window rate limit in KV (default
  15 requests/minute, 100/day), a hard 500-character user-message cap, a
  6-turn (12-message) history cap, and a Claude `max_tokens` ceiling.
- **XSS**: the widget renders responses as text nodes / a tiny escaping
  markdown-lite renderer — it never uses `innerHTML` on model output.
- **CORS**: locked to the restaurant's own origin(s) via `ALLOWED_ORIGINS`.

## Setup

```bash
npm install
npx wrangler login

# 1. Create the Vectorize index (768-dim, cosine — matches bge-base-en-v1.5)
npx wrangler vectorize create velora-dune-kb --dimensions=768 --metric=cosine

# 2. Create a KV namespace for rate limiting
npx wrangler kv namespace create RATE_LIMIT_KV

# 3. Create an R2 bucket to archive the source PDF
npx wrangler r2 bucket create velora-dune-kb-source

# 4. Fill in the resulting IDs in wrangler.jsonc

# 5. Credentials for the ingestion script only (it runs locally with your
#    own account, not inside the Worker — export as shell env vars, or put
#    them in a local .env you source before running `npm run ingest`):
export CF_ACCOUNT_ID="..."
export CF_API_TOKEN="..."   # needs Workers AI, Vectorize, and R2 write scopes

# The Worker itself needs NO secrets — generation runs on the built-in
# Workers AI binding, so there's no LLM provider key to set at all.

# 6. Ingest the knowledge base (run once, and again whenever the PDF changes)
cp /path/to/velora_dune_knowledge_base.pdf data/
npm run ingest

# 7. Deploy
npx wrangler deploy
```

Then embed `widget/velora-chat-widget.js` on the live site (one `<script>`
tag, e.g. right before `</body>`), pointing `data-api` at the deployed
Worker URL. It renders as a small floating chat bubble in the bottom-right
corner and does not alter any existing markup.

## Files

- `src/index.ts` — the Worker: request handling, CORS, orchestration.
- `src/lib/security.ts` — rate limiting, input validation, injection screen.
- `src/lib/retrieval.ts` — embed query → Vectorize search → threshold filter.
- `src/lib/prompt.ts` — the hardened system prompt + context assembly.
- `scripts/ingest.ts` — PDF → clean → semantic chunk → embed → upsert to Vectorize (+ archive to R2).
- `widget/velora-chat-widget.js` — the embeddable frontend chat widget.
