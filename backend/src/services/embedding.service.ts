import { env } from "../config/env.js";

type OllamaEmbeddingResponse = { embedding?: number[]; embeddings?: number[][] };

export async function embedText(text: string): Promise<number[]> {
  const response = await fetch(`${env.OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: env.OLLAMA_EMBEDDING_MODEL, input: text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Ollama embedding failed (${response.status})`);
  const payload = (await response.json()) as OllamaEmbeddingResponse;
  const embedding = payload.embedding ?? payload.embeddings?.[0];
  if (!embedding?.length) throw new Error("Ollama returned no embedding");
  return embedding;
}
