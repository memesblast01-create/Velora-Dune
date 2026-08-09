import type { ChatTurn, Env, RetrievedChunk } from "../types";

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

/**
 * Builds the text that gets embedded for retrieval. Follow-up questions
 * ("which one is vegetarian?") are given the previous user turn as context
 * so the embedding captures what "which one" refers to, without needing an
 * extra LLM call to rewrite the query.
 */
function buildRetrievalQuery(message: string, history: ChatTurn[] = []): string {
  const lastUserTurn = [...history].reverse().find((t) => t.role === "user");
  if (!lastUserTurn || lastUserTurn.content === message) return message;
  return `${lastUserTurn.content}\n${message}`;
}

export async function retrieveContext(
  env: Env,
  message: string,
  history: ChatTurn[] = []
): Promise<RetrievedChunk[]> {
  const queryText = buildRetrievalQuery(message, history);

  const embedding = await env.AI.run(EMBEDDING_MODEL, { text: [queryText] });
  const vector = (embedding as { data: number[][] }).data[0];
  if (!vector) return [];

  const topK = Number(env.RETRIEVAL_TOP_K);
  const threshold = Number(env.SIMILARITY_THRESHOLD);

  const results = await env.VECTORIZE_INDEX.query(vector, {
    topK,
    returnMetadata: "all",
  });

  return results.matches
    .filter((m) => m.score >= threshold)
    .map((m) => {
      const md = m.metadata as Record<string, unknown>;
      return {
        score: m.score,
        section: String(md.section ?? "Unknown section"),
        category: String(md.category ?? "General"),
        page: Number(md.page ?? 0),
        text: String(md.text ?? ""),
      };
    });
}
