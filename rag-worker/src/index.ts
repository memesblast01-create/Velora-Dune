import type { ChatResponseBody, Env } from "./types";
import {
  checkRateLimit,
  ClientError,
  corsHeaders,
  looksLikeInjectionAttempt,
  resolveCorsOrigin,
  validateChatRequest,
} from "./lib/security";
import { retrieveContext } from "./lib/retrieval";
import { buildUserTurn, SYSTEM_PROMPT } from "./lib/prompt";

/**
 * Generation model, hosted on Workers AI — no external LLM provider or
 * secret key required. Llama 3.3 70B is a strong, instruction-following
 * open model available on Workers AI at low per-token cost; swap the
 * string below (env.GENERATION_MODEL) if you'd rather use a different
 * Workers AI text-generation model.
 */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = resolveCorsOrigin(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/api/chat") {
      return new Response("Not found", { status: 404 });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders(origin) });
    }

    // Reject cross-origin calls outright — the widget is the only intended caller.
    if (!origin) {
      return jsonError("Origin not allowed.", 403, null);
    }

    try {
      const clientIp = request.headers.get("CF-Connecting-IP") ?? "unknown";
      await checkRateLimit(env, clientIp);

      const rawBody = await request.json().catch(() => {
        throw new ClientError("Request body must be valid JSON.");
      });
      const { message, history } = validateChatRequest(rawBody, env);

      if (looksLikeInjectionAttempt(message)) {
        // Answer honestly and helpfully without ever touching the LLM with
        // this input, and without confirming/denying any internal detail.
        return jsonOk(
          {
            answer:
              "I'm just able to help with questions about Velora Dune — our menu, hours, location, dining experiences, and reservations. What would you like to know?",
            sources: [],
          },
          origin
        );
      }

      const chunks = await retrieveContext(env, message, history);

      const userTurn = buildUserTurn(message, chunks);
      const priorTurns = (history ?? []).map((t) => ({ role: t.role, content: t.content }));

      const answer = await callWorkersAI(env, [
        ...priorTurns,
        { role: "user", content: userTurn },
      ]);

      const sources = dedupeSources(chunks.map((c) => ({ section: c.section, page: c.page })));

      const body: ChatResponseBody = { answer, sources };
      return jsonOk(body, origin);
    } catch (err) {
      if (err instanceof ClientError) {
        return jsonError(err.message, err.status, origin);
      }
      // Safe logging: no message content, no secrets — just enough to debug.
      console.error("chat_handler_error", { name: (err as Error)?.name });
      return jsonError("Something went wrong on our end — please try again in a moment.", 500, origin);
    }
  },
};

/**
 * Generation call via the Workers AI binding — runs entirely inside
 * Cloudflare's network. No provider API key exists anywhere in this
 * codebase because none is needed: env.AI is a first-party binding, not a
 * secret credential, so there's nothing here that could leak to the browser.
 */
async function callWorkersAI(
  env: Env,
  messages: Array<{ role: "user" | "assistant"; content: string }>
): Promise<string> {
  let response: { response?: string };
  try {
    response = (await env.AI.run(env.GENERATION_MODEL, {
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      max_tokens: Number(env.MAX_ANSWER_TOKENS),
    })) as { response?: string };
  } catch (err) {
    console.error("workers_ai_error", { name: (err as Error)?.name });
    throw new ClientError("The assistant is temporarily unavailable — please try again shortly.", 502);
  }

  const text = response.response;
  if (!text) {
    throw new ClientError("The assistant is temporarily unavailable — please try again shortly.", 502);
  }
  return text;
}

function dedupeSources(sources: Array<{ section: string; page: number }>) {
  const seen = new Set<string>();
  return sources.filter((s) => {
    const key = `${s.section}|${s.page}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function jsonOk(body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

function jsonError(message: string, status: number, origin: string | null): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}
