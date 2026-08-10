export interface Env {
  AI: Ai;
  VECTORIZE_INDEX: VectorizeIndex;
  RATE_LIMIT_KV: KVNamespace;
  RESERVATIONS_DB: D1Database;

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

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequestBody {
  message: string;
  history?: ChatTurn[];
}

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

export interface ReservationRequestBody {
  name: string;
  email: string;
  phone: string;
  guests: string;
  date: string;
  time: string;
  specialRequest?: string;
}
