import { FastifyInstance } from "fastify";
import path from "node:path";
import { z } from "zod";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { indexJobs, repositories } from "../db/schema.js";
import { and, desc, eq, inArray } from "drizzle-orm";
import { upsertRepository } from "../services/document.service.js";
import { runIndexing } from "../services/indexing.service.js";

const indexBody = z.object({ rootPath: z.string().min(1).optional(), name: z.string().min(1).optional() });

async function createJob(repositoryId: string) {
  const active = await db.select({ id: indexJobs.id }).from(indexJobs).where(and(eq(indexJobs.repositoryId, repositoryId), inArray(indexJobs.status, ["pending", "indexing"])));
  if (active[0]) return active[0].id;
  const rows = await db.insert(indexJobs).values({ repositoryId }).returning({ id: indexJobs.id });
  return rows[0].id;
}

export async function repositoryRoutes(app: FastifyInstance) {
  app.get("/repositories", async () => ({ repositories: await db.select({ id: repositories.id, name: repositories.name, rootPath: repositories.rootPath, status: repositories.status, lastIndexedAt: repositories.lastIndexedAt }).from(repositories) }));

  app.get("/repositories/:repositoryId/index-jobs", async (request, reply) => {
    const parsed = z.object({ repositoryId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { jobs: await db.select().from(indexJobs).where(eq(indexJobs.repositoryId, parsed.data.repositoryId)).orderBy(desc(indexJobs.createdAt)).limit(20) };
  });

  app.get("/index-jobs/:jobId", async (request, reply) => {
    const parsed = z.object({ jobId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const rows = await db.select().from(indexJobs).where(eq(indexJobs.id, parsed.data.jobId));
    if (!rows[0]) return reply.code(404).send({ error: "Index job not found" });
    return rows[0];
  });

  app.post("/repositories/index", async (request, reply) => {
    const parsed = indexBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const rootPath = path.resolve(parsed.data.rootPath ?? env.INDEX_ROOT);
    const repository = await upsertRepository(parsed.data.name ?? (path.basename(rootPath) || "repository"), rootPath);
    return runIndexing(repository.id, rootPath);
  });

  app.post("/repositories/index/jobs", async (request, reply) => {
    const parsed = indexBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const rootPath = path.resolve(parsed.data.rootPath ?? env.INDEX_ROOT);
    const repository = await upsertRepository(parsed.data.name ?? (path.basename(rootPath) || "repository"), rootPath);
    const jobId = await createJob(repository.id);
    void runIndexing(repository.id, rootPath, jobId).catch(() => undefined);
    return reply.code(202).send({ jobId, repositoryId: repository.id, status: "pending" });
  });
}
