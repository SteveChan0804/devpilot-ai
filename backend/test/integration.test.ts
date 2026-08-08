import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/client.js";
import { agentApprovals, agentTasks, repositories } from "../src/db/schema.js";
import { eq } from "drizzle-orm";

const app = buildApp();

before(async () => { await app.ready(); });
after(async () => { await app.close(); });

test("health reports a live database", async () => {
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().database, "ok");
  assert.match(response.headers["x-request-id"] as string, /^req-/);
});

test("readiness reports database and Ollama availability", async () => {
  const response = await app.inject({ method: "GET", url: "/ready" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ollama, "ok");
});

test("repository and metrics contracts are available", async () => {
  const repositories = await app.inject({ method: "GET", url: "/repositories" });
  assert.equal(repositories.statusCode, 200);
  assert.ok(Array.isArray(repositories.json().repositories));
  const metrics = await app.inject({ method: "GET", url: "/metrics" });
  assert.equal(metrics.statusCode, 200);
  assert.ok(metrics.json().metrics);
});

test("asynchronous indexing job routes validate requests", async () => {
  const invalidCreate = await app.inject({ method: "POST", url: "/repositories/index/jobs", payload: { rootPath: "" } });
  assert.equal(invalidCreate.statusCode, 400);
  const invalidStatus = await app.inject({ method: "GET", url: "/index-jobs/not-a-uuid" });
  assert.equal(invalidStatus.statusCode, 400);
});

test("agent tools are exposed and malformed tool input is rejected", async () => {
  const tools = await app.inject({ method: "GET", url: "/agent/tools" });
  assert.equal(tools.statusCode, 200);
  assert.equal(tools.json().tools.length, 6);
  const invalid = await app.inject({ method: "POST", url: "/agent/tools/execute", payload: { tool: "not-a-tool" } });
  assert.equal(invalid.statusCode, 400);
});

test("agent approval queue validates repository identifiers", async () => {
  const response = await app.inject({ method: "GET", url: "/agent/approvals/not-a-uuid" });
  assert.equal(response.statusCode, 400);
});

test("agent task status route validates and reports missing tasks", async () => {
  const invalid = await app.inject({ method: "GET", url: "/agent/task/not-a-uuid" });
  assert.equal(invalid.statusCode, 400);
  const missing = await app.inject({ method: "GET", url: "/agent/task/00000000-0000-0000-0000-000000000000" });
  assert.equal(missing.statusCode, 404);
});

test("asynchronous agent job route validates requests", async () => {
  const response = await app.inject({ method: "POST", url: "/agent/run/jobs", payload: { task: "missing repository" } });
  assert.equal(response.statusCode, 400);
});

test("rejecting a linked approval closes the agent task safely", async () => {
  const repository = (await db.insert(repositories).values({ name: "approval-test", rootPath: path.join(os.tmpdir(), `devpilot-approval-${Date.now()}`) }).returning({ id: repositories.id }))[0];
  const task = (await db.insert(agentTasks).values({ repositoryId: repository.id, task: "test approval", provider: "ollama" }).returning({ id: agentTasks.id }))[0];
  const approval = (await db.insert(agentApprovals).values({ taskId: task.id, repositoryId: repository.id, tool: "run_command", args: { command: "git status" }, expiresAt: new Date(Date.now() + 60_000) }).returning({ id: agentApprovals.id }))[0];
  try {
    const response = await app.inject({ method: "POST", url: "/agent/approve", payload: { approvalId: approval.id, approved: false } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, "rejected");
    const stored = (await db.select({ status: agentTasks.status }).from(agentTasks).where(eq(agentTasks.id, task.id)))[0];
    assert.equal(stored.status, "rejected");
  } finally {
    await db.delete(repositories).where(eq(repositories.id, repository.id));
  }
});

test("streaming chat route exists and validates input", async () => {
  const options = await app.inject({ method: "OPTIONS", url: "/chat/stream" });
  assert.equal(options.statusCode, 204);
  const invalid = await app.inject({ method: "POST", url: "/chat/stream", payload: { message: "hello" } });
  assert.equal(invalid.statusCode, 400);
});
