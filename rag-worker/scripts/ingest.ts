/**
 * One-off / re-run-on-update ingestion pipeline for the Velora Dune
 * knowledge-base PDF.
 *
 *   PDF -> per-page text extraction -> clean/normalize -> semantic chunking
 *   (by numbered section, sub-split with overlap when a section is long)
 *   -> embeddings (Workers AI, bge-base-en-v1.5) -> upsert into Vectorize
 *   -> archive original PDF to R2
 *
 * Run with: npm run ingest
 * Requires env vars: CF_ACCOUNT_ID, CF_API_TOKEN (Workers AI + Vectorize +
 * R2 write scopes). These are ingest-time only credentials — they never
 * ship in the Worker or the browser widget.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-ignore - pdf-parse ships without types for its default export
import pdfParse from "pdf-parse";

const PDF_PATH = process.argv[2] ?? resolve("data/velora_dune_knowledge_base.pdf");
const DOCUMENT_NAME = "Velora Dune Knowledge Base";
const VECTORIZE_INDEX = "velora-dune-kb";
const R2_BUCKET = "velora-dune-kb-source";
const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

const CF_ACCOUNT_ID = requireEnv("CF_ACCOUNT_ID");
const CF_API_TOKEN = requireEnv("CF_API_TOKEN");

const CHUNK_TARGET_CHARS = 1800; // ~350-450 tokens
const CHUNK_OVERLAP_CHARS = 270; // ~15%

interface RawChunk {
  section: string;
  category: string;
  page: number;
  text: string;
}

async function main() {
  console.log(`Reading PDF: ${PDF_PATH}`);
  const buffer = readFileSync(PDF_PATH);

  const pageTexts: string[] = [];
  await pdfParse(buffer, {
    pagerender: (pageData: any) =>
      pageData.getTextContent().then((tc: any) => {
        const text = tc.items.map((i: any) => i.str).join(" ");
        pageTexts.push(text);
        return text;
      }),
  });

  console.log(`Extracted ${pageTexts.length} pages.`);

  const cleanedPages = pageTexts.map(cleanText);
  const sections = splitIntoSections(cleanedPages);
  console.log(`Found ${sections.length} sections.`);

  // The heading regex also matches numbered sub-items inside the FAQ
  // section (e.g. "1. What are your opening hours?"). That's actually
  // useful — each FAQ question becomes its own tightly-scoped chunk — but
  // those sub-headings don't carry obvious category keywords, so category
  // is carried forward from the last clearly-categorized top-level section
  // rather than defaulting incorrectly to "About".
  let carriedCategory = "About";
  const chunks = sections.flatMap((s) => {
    const detected = categoryForSection(s.title);
    const category = detected !== "About" ? detected : carriedCategory;
    carriedCategory = category;
    return splitSectionIntoChunks(s, category);
  });
  console.log(`Produced ${chunks.length} chunks. Embedding + upserting...`);

  const BATCH = 20;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const vectors = await embedBatch(batch.map((c) => c.text));
    const ndjson = batch
      .map((c, idx) => ({
        id: `vd-${i + idx}`,
        values: vectors[idx],
        metadata: {
          document: DOCUMENT_NAME,
          section: c.section,
          category: c.category,
          page: c.page,
          text: c.text,
        },
      }))
      .map((row) => JSON.stringify(row))
      .join("\n");

    await upsertToVectorize(ndjson);
    console.log(`Upserted chunks ${i}-${i + batch.length - 1}`);
  }

  await archivePdfToR2(buffer);
  console.log("Done. PDF archived to R2, embeddings live in Vectorize.");
}

function cleanText(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/\u00ad/g, "") // soft hyphens
    .trim();
}

/**
 * The knowledge base is organized as "N. Section Title" headings (see the
 * source PDF's own table of contents-style structure, e.g. "6. The Four
 * Signature Experiences"). Splitting on that pattern first keeps each
 * chunk's topic coherent before any further size-based sub-splitting.
 */
const SECTION_HEADING = /(?:^|\s)(\d{1,2}\.\s+[A-Z][^.]{3,80})(?=\s[A-Z]|\s*$)/g;

function splitIntoSections(pages: string[]): Array<{ title: string; text: string; page: number }> {
  const fullText = pages.join(" \f "); // \f marks a page boundary for lookup below
  const headingMatches = [...fullText.matchAll(SECTION_HEADING)];

  if (headingMatches.length === 0) {
    // Fallback: treat the whole document as one section per page.
    return pages.map((text, i) => ({ title: "General Information", text, page: i + 1 }));
  }

  const sections: Array<{ title: string; text: string; page: number }> = [];
  for (let i = 0; i < headingMatches.length; i++) {
    const start = headingMatches[i]!.index! + headingMatches[i]![0].indexOf(headingMatches[i]![1]!);
    const end = i + 1 < headingMatches.length ? headingMatches[i + 1]!.index! : fullText.length;
    const title = headingMatches[i]![1]!.trim();
    const text = fullText.slice(start, end).trim();
    const page = pageNumberAtOffset(fullText, start);
    sections.push({ title, text, page });
  }
  return sections;
}

function pageNumberAtOffset(fullText: string, offset: number): number {
  const prefix = fullText.slice(0, offset);
  return (prefix.match(/\f/g)?.length ?? 0) + 1;
}

function categoryForSection(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("menu") || t.includes("starter") || t.includes("main course") || t.includes("dessert") || t.includes("drink")) return "Menu";
  if (t.includes("experience")) return "Experiences";
  if (t.includes("reservation") || t.includes("policy") || t.includes("event")) return "Policies";
  if (t.includes("location") || t.includes("getting there")) return "Location";
  if (t.includes("contact") || t.includes("faq")) return "Guest Services";
  if (t.includes("chef")) return "Chef";
  if (t.includes("sustainab") || t.includes("sourcing")) return "Sourcing";
  if (t.includes("glossary")) return "Glossary";
  return "About";
}

function splitSectionIntoChunks(
  section: { title: string; text: string; page: number },
  category: string
): RawChunk[] {
  if (section.text.length <= CHUNK_TARGET_CHARS) {
    return [{ section: section.title, category, page: section.page, text: section.text }];
  }

  const chunks: RawChunk[] = [];
  let start = 0;
  while (start < section.text.length) {
    const end = Math.min(start + CHUNK_TARGET_CHARS, section.text.length);
    // Prefer to break on a sentence boundary near the target end.
    const softEnd = section.text.lastIndexOf(". ", end);
    const cut = softEnd > start + CHUNK_TARGET_CHARS * 0.6 ? softEnd + 1 : end;
    chunks.push({
      section: section.title,
      category,
      page: section.page,
      text: section.text.slice(start, cut).trim(),
    });
    if (cut >= section.text.length) break;
    start = cut - CHUNK_OVERLAP_CHARS;
  }
  return chunks;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${EMBEDDING_MODEL}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${CF_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: texts }),
    }
  );
  if (!res.ok) throw new Error(`Embedding request failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { result: { data: number[][] } };
  return json.result.data;
}

async function upsertToVectorize(ndjson: string): Promise<void> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/vectorize/v2/indexes/${VECTORIZE_INDEX}/upsert`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${CF_API_TOKEN}`, "Content-Type": "application/x-ndjson" },
      body: ndjson,
    }
  );
  if (!res.ok) throw new Error(`Vectorize upsert failed: ${res.status} ${await res.text()}`);
}

async function archivePdfToR2(buffer: Buffer): Promise<void> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${R2_BUCKET}/objects/velora_dune_knowledge_base.pdf`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${CF_API_TOKEN}`, "Content-Type": "application/pdf" },
      body: buffer,
    }
  );
  if (!res.ok) console.warn(`R2 archive upload failed (non-fatal): ${res.status} ${await res.text()}`);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
