export interface Env {
  AI: Ai;
  VECTORIZE_INDEX: VectorizeIndex;
  RATE_LIMIT_KV: KVNamespace;
  KB_SOURCE_BUCKET: R2Bucket;

  ALLOWED_ORIGINS: string;
  GENERATION_MODEL: string;
  RETRIEVAL_TOP_K: string;
  SIMILARITY_THRESHOLD: string;
  MAX_MESSAGE_LENGTH: string;
  MAX_HISTORY_TURNS: string;
  MAX_ANSWER_TOKENS: string;
  RATE_LIMIT_PER_MINUTE: string;
  RATE_LIMIT_PER_DAY: string;
}

/** A single chat turn as sent by the widget. Never trusted as instructions. */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequestBody {
  message: string;
  history?: ChatTurn[];
}

/** Metadata stored alongside each vector in Vectorize. */
export interface ChunkMetadata {
  document: string;
  section: string;
  category: string;
  page: number;
  text: string;
}

export interface RetrievedChunk {
  score: number;
  section: string;
  category: string;
  page: number;
  text: string;
}

export interface ChatResponseBody {
  answer: string;
  sources: Array<{ section: string; page: number }>;
}
