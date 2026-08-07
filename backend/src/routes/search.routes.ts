import { FastifyInstance } from "fastify";
import { z } from "zod";
import { retrieveChunks } from "../services/search.service.js";

const searchBody = z.object({
  repositoryId: z.string().uuid(),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(8),
});

export async function searchRoutes(app: FastifyInstance) {
  app.post("/search", async (request, reply) => {
    const parsed = searchBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { results: await retrieveChunks(parsed.data.repositoryId, parsed.data.query, parsed.data.limit) };
  });
}
