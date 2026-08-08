import { z } from "zod";
import { completeChat, ChatMessage, LlmProvider } from "../services/llm.service.js";
import { retrieveChunks } from "../services/search.service.js";
import { AgentTool, executeTool, isApprovalTool, toolDefinitions } from "./tools.js";
import { createApproval } from "./approvals.js";
import { getRepositoryRoot } from "./repository.js";

const planSchema = z.object({
  calls: z.array(z.object({ tool: z.enum(["list_files", "read_file", "search_code", "get_git_status", "write_file", "run_command"]), args: z.record(z.string(), z.union([z.string(), z.number()])).default({}) })).max(5),
});

export type AgentPlan = z.infer<typeof planSchema>;

export function parseAgentPlan(text: string): AgentPlan | undefined {
  const cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try { return planSchema.parse(JSON.parse(cleaned.slice(start, end + 1))); } catch { return undefined; }
}

function fallbackSearchQuery(task: string) {
  const preferred = ["stream", "chat", "index", "embed", "repository", "agent", "frontend", "extension"];
  const lower = task.toLowerCase();
  return preferred.find((word) => lower.includes(word)) ?? task.split(/\s+/).find((word) => word.length > 3) ?? "export";
}

function hasMutationIntent(task: string) {
  return /\b(modify|change|edit|write|create|delete|remove|refactor|run tests?|run command|execute)\b/i.test(task);
}

export async function runAgentTask(repositoryId: string, task: string, provider: LlmProvider, taskId?: string) {
  const sources = await retrieveChunks(repositoryId, task, 6);
  const repositoryRoot = await getRepositoryRoot(repositoryId);
  const context = sources.map((source) => `FILE ${source.path}:${source.startLine}-${source.endLine}\n${source.content}`).join("\n\n").slice(0, 16_000);
  const plannerMessages: ChatMessage[] = [
    { role: "system", content: `You are DevPilot's planning engine. Return ONLY valid JSON with this shape: {"calls":[{"tool":"read_file","args":{"path":"src/file.ts"}}]}. Choose at most 5 tools. For questions asking where code is implemented or how it works, use search_code and then read_file on the best matching path; list_files alone is insufficient. Read-only tools may execute automatically. write_file and run_command require approval. Available tools: ${JSON.stringify(toolDefinitions)}. Never invent paths; use context or list_files first.` },
    { role: "user", content: `Task: ${task}\n\nRepository context:\n${context || "No context found."}` },
  ];
  const plannerResponse = await completeChat(provider, plannerMessages);
  const plan = parseAgentPlan(plannerResponse);
  if (!plan) return { status: "needs_clarification", answer: plannerResponse, sources, calls: [] };

  const results: Array<{ tool: AgentTool; status: string; result?: unknown; approvalId?: string; error?: string }> = [];
  for (const call of plan.calls) {
    try {
      const args = { ...call.args };
      if (call.tool === "search_code" && !args.query) args.query = fallbackSearchQuery(task);
      if (isApprovalTool(call.tool)) results.push({ tool: call.tool, status: "approval_required", approvalId: await createApproval({ taskId, repositoryId, tool: call.tool, args }) });
      else results.push({ tool: call.tool, status: "completed", result: await executeTool(call.tool, repositoryRoot, args) });
    } catch (error) {
      results.push({ tool: call.tool, status: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }

  const hasUsefulEvidence = results.some((result) => result.status === "completed" && (result.tool === "search_code" || result.tool === "read_file"));
  if (!hasUsefulEvidence && /\b(where|how|explain|find|which)\b/i.test(task)) {
    try { results.push({ tool: "search_code", status: "completed", result: await executeTool("search_code", repositoryRoot, { query: fallbackSearchQuery(task) }) }); }
    catch (error) { results.push({ tool: "search_code", status: "failed", error: error instanceof Error ? error.message : String(error) }); }
  }

  if (results.some((result) => result.status === "approval_required")) return { status: "approval_required", answer: "I need your approval before I can perform the requested changes or commands.", sources, calls: results };
  if (hasMutationIntent(task)) return { status: "approval_required", answer: "This task requests a change or command, but the planner did not produce a safe actionable proposal. No changes were made. Please review the requested operation and try again.", sources, calls: results };
  const final = await completeChat(provider, [
    { role: "system", content: "You are DevPilot, an engineering agent. Answer only from the repository context and tool results below. Every file or line citation must appear in that evidence. Never invent a path, module, or implementation detail. If evidence is insufficient, explicitly say so. Do not claim actions that failed." },
    { role: "user", content: `Task: ${task}\n\nRepository context:\n${context}\n\nTool results:\n${JSON.stringify(results).slice(0, 24_000)}` },
  ]);
  return { status: "completed", answer: final, sources, calls: results };
}
