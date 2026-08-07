import Fastify from "fastify";
import { pool } from "./db/client.js";
import { repositoryRoutes } from "./routes/repository.routes.js";
import { searchRoutes } from "./routes/search.routes.js";
import { chatRoutes } from "./routes/chat.routes.js";
import { agentRoutes } from "./routes/agent.routes.js";
import { env } from "./config/env.js";
import { metricsSnapshot, requestFinished, requestStarted } from "./services/metrics.service.js";
export function buildApp() {
    const app = Fastify({ logger: true });
    const rateLimits = new Map();
    const requestStarts = new WeakMap();
    app.addHook("onRequest", async (request, reply) => {
        requestStarted();
        requestStarts.set(request, Date.now());
        if (request.method === "OPTIONS" || request.url === "/health" || request.url === "/ready")
            return;
        if (env.API_KEY) {
            const provided = request.headers["x-api-key"] ?? request.headers.authorization?.replace(/^Bearer\s+/i, "");
            if (provided !== env.API_KEY)
                return reply.code(401).send({ error: "Authentication required", requestId: request.id });
        }
        const now = Date.now();
        const current = rateLimits.get(request.ip);
        if (!current || current.resetAt <= now)
            rateLimits.set(request.ip, { count: 1, resetAt: now + 60_000 });
        else {
            current.count++;
            if (current.count > env.RATE_LIMIT_PER_MINUTE)
                return reply.code(429).header("retry-after", Math.ceil((current.resetAt - now) / 1000)).send({ error: "Rate limit exceeded", requestId: request.id });
        }
    });
    app.addHook("onSend", async (_request, reply) => {
        reply.header("access-control-allow-origin", "*");
        reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
        reply.header("access-control-allow-headers", "content-type,x-api-key,authorization");
        reply.header("x-request-id", reply.request.id);
    });
    app.addHook("onResponse", async (request, reply) => {
        requestFinished(reply.statusCode, Math.max(0, Date.now() - (requestStarts.get(request) ?? Date.now())));
    });
    app.options("/*", async (_request, reply) => reply.code(204).send());
    app.get("/health", async () => {
        await pool.query("select 1");
        return { status: "ok", database: "ok" };
    });
    app.get("/ready", async (_request, reply) => {
        try {
            await pool.query("select 1");
            const ollama = await fetch(`${env.OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2_000) });
            if (!ollama.ok)
                throw new Error(`Ollama returned ${ollama.status}`);
            return { status: "ready", database: "ok", ollama: "ok" };
        }
        catch (error) {
            return reply.code(503).send({ status: "not_ready", error: error instanceof Error ? error.message : String(error) });
        }
    });
    app.get("/metrics", async () => metricsSnapshot());
    app.setErrorHandler((error, request, reply) => {
        const err = error;
        const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
        request.log.error({ err: error, requestId: request.id }, "request failed");
        return reply.code(statusCode).send({ error: statusCode === 500 ? "Internal server error" : err.message, requestId: request.id });
    });
    app.register(repositoryRoutes);
    app.register(searchRoutes);
    app.register(chatRoutes);
    app.register(agentRoutes);
    app.addHook("onClose", async () => pool.end());
    return app;
}
