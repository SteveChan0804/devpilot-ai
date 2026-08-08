import { db } from "../db/client.js";
import { agentApprovals } from "../db/schema.js";
import { and, eq, gt } from "drizzle-orm";
import { AgentTool, ToolArgs } from "./tools.js";

const MAX_AGE_MS = 10 * 60 * 1000;

export async function createApproval(action: { taskId?: string; repositoryId: string; tool: AgentTool; args: ToolArgs }) {
  const rows = await db.insert(agentApprovals).values({
    taskId: action.taskId,
    repositoryId: action.repositoryId,
    tool: action.tool,
    args: action.args,
    expiresAt: new Date(Date.now() + MAX_AGE_MS),
  }).returning({ id: agentApprovals.id });
  return rows[0].id;
}

export async function resolveApproval(id: string, approved: boolean) {
  const rows = await db.update(agentApprovals)
    .set({ status: approved ? "approved" : "rejected", resolvedAt: new Date() })
    .where(and(eq(agentApprovals.id, id), eq(agentApprovals.status, "pending"), gt(agentApprovals.expiresAt, new Date())))
  .returning({ taskId: agentApprovals.taskId, repositoryId: agentApprovals.repositoryId, tool: agentApprovals.tool, args: agentApprovals.args });
  return rows[0] as { taskId: string | null; repositoryId: string; tool: AgentTool; args: ToolArgs } | undefined;
}
