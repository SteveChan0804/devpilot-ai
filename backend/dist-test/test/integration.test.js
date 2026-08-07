import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { buildApp } from "../src/app.js";
const app = buildApp();
before(async () => { await app.ready(); });
after(async () => { await app.close(); });
test("health reports a live database", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().database, "ok");
    assert.match(response.headers["x-request-id"], /^req-/);
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
test("agent tools are exposed and malformed tool input is rejected", async () => {
    const tools = await app.inject({ method: "GET", url: "/agent/tools" });
    assert.equal(tools.statusCode, 200);
    assert.equal(tools.json().tools.length, 6);
    const invalid = await app.inject({ method: "POST", url: "/agent/tools/execute", payload: { tool: "not-a-tool" } });
    assert.equal(invalid.statusCode, 400);
});
test("streaming chat route exists and validates input", async () => {
    const options = await app.inject({ method: "OPTIONS", url: "/chat/stream" });
    assert.equal(options.statusCode, 204);
    const invalid = await app.inject({ method: "POST", url: "/chat/stream", payload: { message: "hello" } });
    assert.equal(invalid.statusCode, 400);
});
