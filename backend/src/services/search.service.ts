import { pool } from "../db/client.js";
import { embedText } from "./embedding.service.js";

export type SearchResult = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  similarity: number;
};

export async function retrieveChunks(repositoryId: string, query: string, limit: number): Promise<SearchResult[]> {
  const embedding = await embedText(query);
  const vector = `[${embedding.join(",")}]`;
  const result = await pool.query<SearchResult>(
    `SELECT c.id, c.path, c.start_line AS "startLine", c.end_line AS "endLine", c.content,
            1 - (c.embedding <=> $1::vector) AS similarity
     FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE d.repository_id = $2 AND c.embedding IS NOT NULL
     ORDER BY c.embedding <=> $1::vector LIMIT $3`,
    [vector, repositoryId, limit],
  );
  return result.rows;
}
