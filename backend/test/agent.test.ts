import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { db } from "../src/db/client.js";
import { repositories } from "../src/db/schema.js";
import { parseAgentPlan, runAgentTask } from "../src/agent/runner.js";
import { scanRepository } from "../src/scanner/scanner.js";
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

test("planner parsing caps oversized plans and normalizes search aliases", () => {
  const plan = parseAgentPlan(JSON.stringify({ calls: Array.from({ length: 7 }, (_, index) => ({ tool: "search_code", args: { text: `query-${index}` } })) }));
  assert.equal(plan?.calls.length, 5);
  assert.equal(plan?.calls[0].args.query, "query-0");
});

test("planner parsing salvages malformed read-only output but never mutations", () => {
  const plan = parseAgentPlan('{"calls":[{"tool":"search_code","args":{"path":"broken ["model" quote"}},{"tool":"write_file","args":{"path":"src/a.ts","content":"bad"}}]}');
  assert.equal(plan?.calls.length, 1);
  assert.equal(plan?.calls[0].tool, "search_code");
});

test("repository scanning excludes dependency lockfiles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devpilot-scan-"));
  try {
    await writeFile(path.join(root, "package-lock.json"), "{\"stream\": true}\n", "utf8");
    await writeFile(path.join(root, "app.ts"), "export const stream = true;\n", "utf8");
    const files = await scanRepository(root);
    assert.deepEqual(files.map((file) => file.path), ["app.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
