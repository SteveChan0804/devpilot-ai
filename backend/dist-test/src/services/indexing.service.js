import { db } from "../db/client.js";
import { chunks as chunksTable, indexJobs, repositories } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { scanRepository } from "../scanner/scanner.js";
import { chunkFiles } from "../chunker/chunker.js";
import { syncRepository } from "./document.service.js";
import { embedText } from "./embedding.service.js";
import { env } from "../config/env.js";
import { recordMetric } from "./metrics.service.js";
export async function runIndexing(repositoryId, rootPath, jobId) {
    recordMetric("indexing.started");
    const updateJob = async (values) => {
        if (jobId)
            await db.update(indexJobs).set(values).where(eq(indexJobs.id, jobId));
    };
    await db.update(repositories).set({ status: "indexing" }).where(eq(repositories.id, repositoryId));
    await updateJob({ status: "indexing", startedAt: new Date() });
    try {
        const files = await scanRepository(rootPath);
        const chunks = chunkFiles(files);
        await updateJob({ totalFiles: files.length, totalChunks: chunks.length });
        const syncResult = await syncRepository(repositoryId, files, chunks);
        let embeddedChunks = 0;
        for (const item of syncResult.embeddingTasks) {
            const embedding = await embedText(item.content);
            await db.update(chunksTable).set({ embedding, embeddingModel: env.OLLAMA_EMBEDDING_MODEL }).where(eq(chunksTable.id, item.id));
            embeddedChunks++;
            recordMetric("indexing.embedded_chunks");
            await updateJob({ embeddedChunks });
        }
        const result = { repositoryId, rootPath, files: files.length, chunks: chunks.length, embeddedChunks, removedFiles: syncResult.removedFiles, status: "indexed" };
        await db.update(repositories).set({ status: "indexed", lastIndexedAt: new Date() }).where(eq(repositories.id, repositoryId));
        await updateJob({ embeddedChunks, removedFiles: syncResult.removedFiles, status: "completed", completedAt: new Date() });
        recordMetric("indexing.completed");
        return result;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await db.update(repositories).set({ status: "failed" }).where(eq(repositories.id, repositoryId));
        await updateJob({ status: "failed", error: message, completedAt: new Date() });
        recordMetric("indexing.failed");
        throw error;
    }
}
