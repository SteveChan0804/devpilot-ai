export type Repository = { id: string; name: string; rootPath: string; status: string; lastIndexedAt?: string };
export type Source = { id: string; path: string; startLine: number; endLine: number; content: string; similarity: number };
export type AgentCall = { tool: string; status: string; approvalId?: string; result?: { preview?: unknown } };

const base = import.meta.env.VITE_API_URL ?? "/api";

export async function getRepositories(): Promise<Repository[]> {
  const response = await fetch(`${base}/repositories`);
  if (!response.ok) throw new Error("Unable to load repositories");
  return (await response.json()).repositories;
}

export async function indexRepository(rootPath: string, name?: string) {
  const response = await fetch(`${base}/repositories/index`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rootPath, name }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<{ repositoryId: string; files: number; chunks: number; embeddedChunks: number; status: string }>;
}

export async function streamChat(repositoryId: string, message: string, onToken: (token: string) => void, onSources: (sources: Source[]) => void) {
  const response = await fetch(`${base}/chat/stream`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repositoryId, message, provider: "ollama", limit: 8 }),
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
  const response = await fetch(`${base}/agent/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repositoryId, task, provider: "ollama" }) });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<{ answer: string; status: string; calls?: AgentCall[] }>;
}

export async function resolveAgentApproval(approvalId: string, approved: boolean) {
  const response = await fetch(`${base}/agent/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approvalId, approved }) });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<{ status: string; result?: unknown }>;
}
