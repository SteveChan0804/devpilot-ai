import { FastifyInstance } from "fastify";
import { z } from "zod";
import { executeTool, isApprovalTool, restoreSnapshot, snapshotWrite, toolDefinitions, validateWorkspace } from "../agent/tools.js";
import { createApproval, resolveApproval } from "../agent/approvals.js";
import { getRepositoryRoot } from "../agent/repository.js";
import { resumeAgentTask, runAgentTask } from "../agent/runner.js";
import { agentApprovals, agentTasks } from "../db/schema.js";
import { db } from "../db/client.js";
import { and, eq, gt } from "drizzle-orm";
import { recordMetric } from "../services/metrics.service.js";

const toolNames = ["list_files", "read_file", "search_code", "get_git_status", "write_file", "run_command"] as const;
const requestSchema = z.object({ repositoryId: z.string().uuid(), tool: z.enum(toolNames), args: z.record(z.string(), z.union([z.string(), z.number()])).default({}) });
const approvalSchema = z.object({ approvalId: z.string().uuid(), approved: z.boolean() });
const runSchema = z.object({ repositoryId: z.string().uuid(), task: z.string().min(1).max(10_000), provider: z.enum(["ollama", "openrouter"]).default("ollama") });

async function executeStoredTask(taskId: string, repositoryId: string, task: string, provider: "ollama" | "openrouter") {
  try {
    const result = await runAgentTask(repositoryId, task, provider, taskId);
    await db.update(agentTasks).set({ status: result.status, result, ...(result.status === "approval_required" ? {} : { completedAt: new Date() }) }).where(eq(agentTasks.id, taskId));
    recordMetric(`agent.tasks.${result.status}`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(agentTasks).set({ status: "failed", error: message, completedAt: new Date() }).where(eq(agentTasks.id, taskId));
    recordMetric("agent.tasks.failed");
    throw error;
  }
}

export async function agentRoutes(app: FastifyInstance) {
  app.get("/agent/tools", async () => ({ tools: toolDefinitions }));

  app.post("/agent/run", async (request, reply) => {
    const parsed = runSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const taskRow = await db.insert(agentTasks).values({ repositoryId: parsed.data.repositoryId, task: parsed.data.task, provider: parsed.data.provider }).returning({ id: agentTasks.id });
    const taskId = taskRow[0].id;
    recordMetric("agent.tasks.started");
    return { taskId, ...(await executeStoredTask(taskId, parsed.data.repositoryId, parsed.data.task, parsed.data.provider)) };
  });

  app.post("/agent/run/jobs", async (request, reply) => {
    const parsed = runSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const taskRow = await db.insert(agentTasks).values({ repositoryId: parsed.data.repositoryId, task: parsed.data.task, provider: parsed.data.provider }).returning({ id: agentTasks.id });
    const taskId = taskRow[0].id;
    recordMetric("agent.tasks.started");
    void executeStoredTask(taskId, parsed.data.repositoryId, parsed.data.task, parsed.data.provider).catch(() => undefined);
    return reply.code(202).send({ taskId, status: "running" });
  });

  app.get("/agent/tasks/:repositoryId", async (request, reply) => {
    const parsed = z.object({ repositoryId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { tasks: await db.select().from(agentTasks).where(eq(agentTasks.repositoryId, parsed.data.repositoryId)) };
  });

  app.get("/agent/task/:taskId", async (request, reply) => {
    const parsed = z.object({ taskId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const rows = await db.select().from(agentTasks).where(eq(agentTasks.id, parsed.data.taskId));
    if (!rows[0]) return reply.code(404).send({ error: "Agent task not found" });
    return { task: rows[0] };
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
    if (!action.taskId) return reply.code(409).send({ error: "Approval is not linked to an agent task" });
    if (!parsed.data.approved) return resumeAgentTask({ id: action.id, taskId: action.taskId, repositoryId: action.repositoryId, tool: action.tool, approved: false });
    const repositoryRoot = await getRepositoryRoot(action.repositoryId);
    const snapshot = action.tool === "write_file" ? await snapshotWrite(repositoryRoot, action.args) : undefined;
    const result = await executeTool(action.tool, repositoryRoot, action.args);
    const validation = action.tool === "write_file" ? await validateWorkspace(repositoryRoot) : undefined;
    let rolledBack = false;
    if (snapshot && validation && !validation.passed) {
      await restoreSnapshot(repositoryRoot, snapshot);
      rolledBack = true;
    }
    return resumeAgentTask({ id: action.id, taskId: action.taskId, repositoryId: action.repositoryId, tool: action.tool, approved: true, result: { tool: action.tool, result, validation, rolledBack }, validation });
  });
}
