import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { db } from "../src/db/client.js";
import { repositories } from "../src/db/schema.js";
import { runAgentTask } from "../src/agent/runner.js";
import { eq } from "drizzle-orm";

test("agent planner, tool execution, and final synthesis work with injected dependencies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devpilot-agent-"));
  const repository = (await db.insert(repositories).values({ name: "agent-test", rootPath: root }).returning({ id: repositories.id }))[0];
  try {
    await writeFile(path.join(root, "src-health.ts"), "export function health() { return true; }\n", "utf8");
    let calls = 0;
    const result = await runAgentTask(repository.id, "where is health implemented?", "ollama", undefined, {
      retrieveChunks: async () => [{ id: "source-1", path: "src-health.ts", startLine: 1, endLine: 1, content: "export function health() { return true; }", similarity: 0.9 }],
      completeChat: async (_provider, messages) => {
        calls++;
        if (calls === 1) return JSON.stringify({ calls: [{ tool: "search_code", args: { query: "health" } }] });
        return "health is implemented in src-health.ts.";
      },
    });
    assert.equal(result.status, "completed");
    assert.equal(result.answer, "health is implemented in src-health.ts.");
    assert.equal(result.calls[0].status, "completed");
  } finally {
    await db.delete(repositories).where(eq(repositories.id, repository.id));
    await rm(root, { recursive: true, force: true });
  }
});
