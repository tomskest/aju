/**
 * Embedding provider: Voyage AI (voyage-4-large, 1024 dims).
 *
 * Chosen over OpenAI text-embedding-3-small for retrieval quality on
 * developer/agent-memory corpora. voyage-4-large is Voyage's flagship
 * general-purpose multilingual retrieval model. Platform-managed via env
 * var VOYAGE_API_KEY; later we layer BYOK on top (per-org provider keys).
 *
 * Docs: https://docs.voyageai.com/reference/embeddings-api
 */

const VOYAGE_API = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-4-large";

/** Voyage's context window is 32K tokens. ~4 chars/token → truncate at 96k to be safe. */
const MAX_CHARS = 96000;

/**
 * `input_type` tells Voyage whether the text is a stored document or a
 * user query. Using the right one measurably improves retrieval quality.
 */
export type EmbeddingInputType = "document" | "query";

function truncate(text: string): string {
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
}

export function prepareDocumentText(
  title: string,
  tags: string[],
  content: string,
): string {
  // Strip frontmatter YAML block
  const stripped = content.replace(/^---[\s\S]*?---\n*/m, "");
  const parts = [title];
  if (tags.length > 0) parts.push(tags.join(", "));
  parts.push(stripped);
  return parts.join("\n\n");
}

export function prepareFileText(
  filename: string,
  tags: string[],
  extractedText: string | null,
): string {
  const parts = [filename];
  if (tags.length > 0) parts.push(tags.join(", "));
  if (extractedText) parts.push(extractedText);
  return parts.join("\n\n");
}

type VoyageResponse = {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage?: { total_tokens?: number };
};

async function voyageEmbed(
  inputs: string[],
  inputType: EmbeddingInputType,
): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "VOYAGE_API_KEY is not set. Configure it in the runtime environment.",
    );
  }

  const res = await fetch(VOYAGE_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: inputs.map(truncate),
      model: MODEL,
      input_type: inputType,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Voyage embeddings failed (${res.status}): ${body.slice(0, 400)}`,
    );
  }

  const data = (await res.json()) as VoyageResponse;
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

export async function generateEmbedding(
  text: string,
  inputType: EmbeddingInputType = "document",
): Promise<number[]> {
  const [embedding] = await voyageEmbed([text], inputType);
  return embedding;
}

export async function generateEmbeddings(
  texts: string[],
  inputType: EmbeddingInputType = "document",
): Promise<number[][]> {
  if (texts.length === 0) return [];
  return voyageEmbed(texts, inputType);
}

export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/** Dimension of the configured embedding model. Single source of truth for
 *  pgvector column creation / index tuning. */
export const EMBEDDING_DIMENSIONS = 1024;
export const EMBEDDING_PROVIDER = "voyageai" as const;
export const EMBEDDING_MODEL = MODEL;
