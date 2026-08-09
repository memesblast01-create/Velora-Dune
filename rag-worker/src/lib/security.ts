import type { ChatRequestBody, ChatTurn, Env } from "../types";

export class ClientError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Resolves and validates the CORS origin against the configured allow-list. */
export function resolveCorsOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
  return allowed.includes(origin) ? origin : null;
}

export function corsHeaders(origin: string | null): HeadersInit {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/**
 * Sliding-window rate limit backed by KV. Two windows (per-minute, per-day)
 * are tracked per client IP so a burst and a slow drip are both bounded.
 * KV is eventually-consistent, so this is a practical deterrent against
 * casual abuse and cost blowout — not a hard security boundary. For strict
 * guarantees, front the Worker with Cloudflare Rate Limiting rules too.
 */
export async function checkRateLimit(env: Env, clientIp: string): Promise<void> {
  const now = Date.now();
  const minuteKey = `rl:min:${clientIp}:${Math.floor(now / 60_000)}`;
  const dayKey = `rl:day:${clientIp}:${new Date(now).toISOString().slice(0, 10)}`;

  const [minuteCountRaw, dayCountRaw] = await Promise.all([
    env.RATE_LIMIT_KV.get(minuteKey),
    env.RATE_LIMIT_KV.get(dayKey),
  ]);

  const minuteCount = Number(minuteCountRaw ?? 0);
  const dayCount = Number(dayCountRaw ?? 0);

  const perMinuteLimit = Number(env.RATE_LIMIT_PER_MINUTE);
  const perDayLimit = Number(env.RATE_LIMIT_PER_DAY);

  if (minuteCount >= perMinuteLimit) {
    throw new ClientError("You're sending messages too quickly — please wait a moment and try again.", 429);
  }
  if (dayCount >= perDayLimit) {
    throw new ClientError("Daily message limit reached for this chatbot — please try again tomorrow, or call the restaurant directly.", 429);
  }

  await Promise.all([
    env.RATE_LIMIT_KV.put(minuteKey, String(minuteCount + 1), { expirationTtl: 90 }),
    env.RATE_LIMIT_KV.put(dayKey, String(dayCount + 1), { expirationTtl: 60 * 60 * 26 }),
  ]);
}

/** Validates shape and size of the incoming request body. Throws ClientError on failure. */
export function validateChatRequest(body: unknown, env: Env): ChatRequestBody {
  if (typeof body !== "object" || body === null) {
    throw new ClientError("Invalid request body.");
  }
  const { message, history } = body as Record<string, unknown>;

  if (typeof message !== "string" || message.trim().length === 0) {
    throw new ClientError("A non-empty 'message' string is required.");
  }

  const maxLen = Number(env.MAX_MESSAGE_LENGTH);
  if (message.length > maxLen) {
    throw new ClientError(`Message is too long (max ${maxLen} characters).`);
  }

  let cleanHistory: ChatTurn[] = [];
  if (history !== undefined) {
    if (!Array.isArray(history)) {
      throw new ClientError("'history' must be an array.");
    }
    const maxTurns = Number(env.MAX_HISTORY_TURNS) * 2; // user+assistant per turn
    cleanHistory = history.slice(-maxTurns).filter(isChatTurn).map((t) => ({
      role: t.role,
      content: t.content.slice(0, maxLen),
    }));
  }

  return { message: message.trim(), history: cleanHistory };
}

function isChatTurn(t: unknown): t is ChatTurn {
  return (
    typeof t === "object" &&
    t !== null &&
    (("role" in t) && ((t as any).role === "user" || (t as any).role === "assistant")) &&
    typeof (t as any).content === "string"
  );
}

/**
 * Lightweight pre-filter for obvious prompt-injection / secret-exfiltration
 * attempts. This is a defense-in-depth speed bump, NOT the primary defense —
 * the primary defense is that the system prompt never contains a secret and
 * Claude is instructed to treat all user/retrieved text as untrusted data.
 * Legitimate questions are never blocked by topic; only clear attempts to
 * extract system internals are short-circuited before hitting the model.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all|any|previous|prior) instructions/i,
  /(reveal|show|print|output|leak).{0,20}(system prompt|instructions|api key|secret|env(ironment)? variable)/i,
  /you are now/i,
  /act as (an? )?(admin|administrator|developer|root|dan)/i,
  /forget (your|all) (rules|instructions|guidelines)/i,
  /disregard (the|your) (above|previous|system)/i,
];

export function looksLikeInjectionAttempt(message: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(message));
}
