import { FastifyInstance } from "fastify";
import { z } from "zod";
import { executeTool, isApprovalTool, toolDefinitions } from "../agent/tools.js";
import { createApproval, resolveApproval } from "../agent/approvals.js";
import { getRepositoryRoot } from "../agent/repository.js";
import { runAgentTask } from "../agent/runner.js";
import { agentApprovals, agentTasks } from "../db/schema.js";
import { db } from "../db/client.js";
import { and, eq, gt } from "drizzle-orm";
import { recordMetric } from "../services/metrics.service.js";

const toolNames = ["list_files", "read_file", "search_code", "get_git_status", "write_file", "run_command"] as const;
const requestSchema = z.object({ repositoryId: z.string().uuid(), tool: z.enum(toolNames), args: z.record(z.string(), z.union([z.string(), z.number()])).default({}) });
const approvalSchema = z.object({ approvalId: z.string().uuid(), approved: z.boolean() });
const runSchema = z.object({ repositoryId: z.string().uuid(), task: z.string().min(1).max(10_000), provider: z.enum(["ollama", "openrouter"]).default("ollama") });

export async function agentRoutes(app: FastifyInstance) {
  app.get("/agent/tools", async () => ({ tools: toolDefinitions }));

  app.post("/agent/run", async (request, reply) => {
    const parsed = runSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const taskRow = await db.insert(agentTasks).values({ repositoryId: parsed.data.repositoryId, task: parsed.data.task, provider: parsed.data.provider }).returning({ id: agentTasks.id });
    const taskId = taskRow[0].id;
    recordMetric("agent.tasks.started");
    try {
      const result = await runAgentTask(parsed.data.repositoryId, parsed.data.task, parsed.data.provider, taskId);
      await db.update(agentTasks).set({ status: result.status, result, completedAt: new Date() }).where(eq(agentTasks.id, taskId));
      recordMetric(`agent.tasks.${result.status}`);
      return { taskId, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.update(agentTasks).set({ status: "failed", error: message, completedAt: new Date() }).where(eq(agentTasks.id, taskId));
      recordMetric("agent.tasks.failed");
      throw error;
    }
  });

  app.get("/agent/tasks/:repositoryId", async (request, reply) => {
    const parsed = z.object({ repositoryId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { tasks: await db.select().from(agentTasks).where(eq(agentTasks.repositoryId, parsed.data.repositoryId)) };
  });

  app.get("/agent/approvals/:repositoryId", async (request, reply) => {
    const parsed = z.object({ repositoryId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { approvals: await db.select().from(agentApprovals).where(and(eq(agentApprovals.repositoryId, parsed.data.repositoryId), eq(agentApprovals.status, "pending"), gt(agentApprovals.expiresAt, new Date()))) };
  });

  app.post("/agent/tools/execute", async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { repositoryId, tool, args } = parsed.data;
    if (isApprovalTool(tool)) return { status: "approval_required", approvalId: await createApproval({ repositoryId, tool, args }), tool, args };
    return { status: "completed", tool, result: await executeTool(tool, await getRepositoryRoot(repositoryId), args) };
  });

  app.post("/agent/approve", async (request, reply) => {
    const parsed = approvalSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const action = await resolveApproval(parsed.data.approvalId, parsed.data.approved);
    if (!action) return reply.code(404).send({ error: "Approval request not found or expired" });
    if (!parsed.data.approved) return { status: "rejected", tool: action.tool };
    const result = await executeTool(action.tool, await getRepositoryRoot(action.repositoryId), action.args);
    return { status: "completed", tool: action.tool, result };
  });
}
