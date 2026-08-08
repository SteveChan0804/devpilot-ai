import { Chunk } from "../chunker/types.js";
import { ScannedFile } from "../scanner/types.js";
import { db } from "../db/client.js";
import { chunks, documents, repositories } from "../db/schema.js";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function languageForPath(filePath: string) {
  const extension = filePath.toLowerCase().split(".").pop();
  return extension ? ({ ts: "typescript", tsx: "typescriptreact", js: "javascript", jsx: "javascriptreact", json: "json", md: "markdown" } as Record<string, string>)[extension] ?? extension : undefined;
}

export async function upsertRepository(name: string, rootPath: string) {
  const existing = await db.select().from(repositories).where(eq(repositories.rootPath, rootPath));
  if (existing[0]) {
    const updated = await db.update(repositories).set({ name }).where(eq(repositories.id, existing[0].id)).returning();
    return updated[0];
  }
  const inserted = await db.insert(repositories).values({ name, rootPath }).returning();
  return inserted[0];
}

export async function syncRepository(repositoryId: string, files: ScannedFile[], data: Chunk[]) {
  const embeddingTasks: Array<{ id: string; content: string }> = [];
  const existingDocuments = await db.select().from(documents).where(eq(documents.repositoryId, repositoryId));
  const fileMap = new Map(files.map((file) => [file.path, file]));
  const grouped = new Map<string, Chunk[]>();
  for (const chunk of data) grouped.set(chunk.path, [...(grouped.get(chunk.path) ?? []), chunk]);

  for (const document of existingDocuments) {
    if (!fileMap.has(document.path)) await db.delete(documents).where(eq(documents.id, document.id));
  }

  for (const file of files) {
    const fileChunks = grouped.get(file.path) ?? [];
    const contentHash = hash(file.content);
    const existing = existingDocuments.find((document) => document.path === file.path);
    if (existing?.contentHash === contentHash) continue;

    const document = await db.insert(documents).values({
      repositoryId,
      path: file.path,
      content: file.content,
      contentHash,
      language: languageForPath(file.path),
    }).onConflictDoUpdate({
      target: [documents.repositoryId, documents.path],
      set: { content: file.content, contentHash, language: languageForPath(file.path), updatedAt: new Date() },
    }).returning();
    const documentId = document[0].id;
    await db.delete(chunks).where(eq(chunks.documentId, documentId));
    const inserted = fileChunks.length === 0 ? [] : await db.insert(chunks).values(fileChunks.map((chunk) => ({
      documentId,
      path: chunk.path,
      chunkIndex: chunk.chunkIndex,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      content: chunk.content,
      contentHash: hash(chunk.content),
    }))).returning({ id: chunks.id, content: chunks.content });
    embeddingTasks.push(...inserted);
  }
  return { embeddingTasks, removedFiles: existingDocuments.filter((document) => !fileMap.has(document.path)).length };
}
