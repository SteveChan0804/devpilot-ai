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
  const keyword = query.split(/\s+/).filter((word) => word.length > 2).slice(0, 4).join(" ") || query;
  const result = await pool.query<SearchResult>(
    `SELECT c.id, c.path, c.start_line AS "startLine", c.end_line AS "endLine", c.content,
            (1 - (c.embedding <=> $1::vector))
            + CASE WHEN lower(c.path) LIKE lower($3) THEN 0.15 ELSE 0 END
            + CASE WHEN lower(c.content) LIKE lower($4) THEN 0.25 ELSE 0 END AS similarity
     FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE d.repository_id = $2 AND c.embedding IS NOT NULL
     ORDER BY similarity DESC LIMIT $5`,
    [vector, repositoryId, `%${query}%`, `%${keyword}%`, limit],
  );
  return result.rows;
}
