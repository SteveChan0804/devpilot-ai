export type Repository = { id: string; name: string; rootPath: string; status: string; lastIndexedAt?: string };
export type Source = { id: string; path: string; startLine: number; endLine: number; content: string; similarity: number };
export type AgentCall = { tool: string; status: string; approvalId?: string; result?: { preview?: unknown } };

const base = import.meta.env.VITE_API_URL ?? "/api";
const headers = () => ({ "content-type": "application/json", ...((import.meta.env.VITE_API_KEY as string | undefined) ? { "x-api-key": import.meta.env.VITE_API_KEY as string } : {}) });

export async function getRepositories(): Promise<Repository[]> {
  const response = await fetch(`${base}/repositories`, { headers: headers() });
  if (!response.ok) throw new Error("Unable to load repositories");
  return (await response.json()).repositories;
}

export async function indexRepository(rootPath: string, name?: string) {
  const response = await fetch(`${base}/repositories/index/jobs`, {
    method: "POST", headers: headers(), body: JSON.stringify({ rootPath, name }),
  });
  if (!response.ok) throw new Error(await response.text());
  const job = await response.json() as { jobId: string; repositoryId: string };
  for (let attempt = 0; attempt < 1_200; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const statusResponse = await fetch(`${base}/index-jobs/${job.jobId}`, { headers: headers() });
    if (!statusResponse.ok) throw new Error(await statusResponse.text());
    const status = await statusResponse.json() as { status: string; totalFiles: number; totalChunks: number; embeddedChunks: number; error?: string };
    if (status.status === "completed") return { repositoryId: job.repositoryId, files: status.totalFiles, chunks: status.totalChunks, embeddedChunks: status.embeddedChunks, status: status.status };
    if (status.status === "failed") throw new Error(status.error ?? "Repository indexing failed");
  }
  throw new Error("Repository indexing timed out");
}

export async function streamChat(repositoryId: string, message: string, onToken: (token: string) => void, onSources: (sources: Source[]) => void) {
  const response = await fetch(`${base}/chat/stream`, {
    method: "POST", headers: headers(), body: JSON.stringify({ repositoryId, message, provider: "ollama", limit: 8 }),
  });
  if (!response.ok || !response.body) throw new Error(await response.text());
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const dataLine = event.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      const data = JSON.parse(dataLine.slice(6));
      if (event.includes("event: sources")) onSources(data as Source[]);
      if (event.includes("event: token")) onToken(data as string);
      if (event.includes("event: error")) throw new Error(data.error);
    }
  }
}

export async function runAgent(repositoryId: string, task: string) {
  const response = await fetch(`${base}/agent/run/jobs`, { method: "POST", headers: headers(), body: JSON.stringify({ repositoryId, task, provider: "ollama" }) });
  if (!response.ok) throw new Error(await response.text());
  const started = await response.json() as { taskId: string };
  for (let attempt = 0; attempt < 1_200; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const taskResponse = await fetch(`${base}/agent/task/${started.taskId}`, { headers: headers() });
    if (!taskResponse.ok) throw new Error(await taskResponse.text());
    const payload = await taskResponse.json() as { task: { status: string; error?: string; result?: { answer?: string; status?: string; calls?: AgentCall[] } } };
    const current = payload.task;
    if (["completed", "approval_required", "rejected", "validation_failed", "needs_clarification"].includes(current.status)) {
      if (current.status === "failed") throw new Error(current.error ?? "Agent task failed");
      return { taskId: started.taskId, status: current.status, answer: current.result?.answer ?? current.error ?? "Agent task finished.", calls: current.result?.calls };
    }
    if (current.status === "failed") throw new Error(current.error ?? "Agent task failed");
  }
  throw new Error("Agent task timed out");
}

export async function resolveAgentApproval(approvalId: string, approved: boolean) {
  const response = await fetch(`${base}/agent/approve`, { method: "POST", headers: headers(), body: JSON.stringify({ approvalId, approved }) });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<{ status: string; result?: unknown }>;
}
