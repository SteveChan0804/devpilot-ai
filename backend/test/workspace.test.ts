import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertSafeAgentPath, resolveWorkspacePath } from "../src/agent/workspace.js";
import { executeTool, previewWrite, restoreSnapshot, snapshotWrite, validateWorkspace } from "../src/agent/tools.js";

test("workspace guard permits files inside the repository", () => {
  assert.equal(resolveWorkspacePath("C:\\repo", "src\\app.ts"), "C:\\repo\\src\\app.ts");
});

test("workspace guard rejects traversal", () => {
  assert.throws(() => resolveWorkspacePath("C:\\repo", "..\\secrets.txt"), /escapes/);
});

test("agent path guard rejects secrets and dependency folders", () => {
  assert.throws(() => assertSafeAgentPath(".env"), /Sensitive/);
  assert.throws(() => assertSafeAgentPath("config/credentials.json"), /Sensitive/);
  assert.throws(() => assertSafeAgentPath("node_modules/pkg/index.js"), /Sensitive/);
});

test("write previews stay inside the workspace and show changed lines", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devpilot-preview-"));
  try {
    await writeFile(path.join(root, "example.ts"), "const value = 1;\n", "utf8");
    const result = await previewWrite(root, { path: "example.ts", content: "const value = 2;\n" });
    assert.match(result.preview, /- const value = 1;/);
    assert.match(result.preview, /\+ const value = 2;/);
    await assert.rejects(() => previewWrite(root, { path: "..\\outside.ts", content: "blocked" }), /escapes/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approved npm scripts route to package workspaces", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devpilot-command-"));
  try {
    const backend = path.join(root, "backend");
    await mkdir(backend, { recursive: true });
    await writeFile(path.join(backend, "package.json"), JSON.stringify({ scripts: { typecheck: "node -e \\\"console.log('check-ok')\\\"" } }), "utf8");
    const result = await executeTool("run_command", root, { command: "npm run typecheck" });
    assert.deepEqual(result.directories, ["backend"]);
    assert.match(result.output, /check-ok/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("post-change validation uses the same workspace-safe npm runner", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devpilot-validation-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { typecheck: "node -e \\\"console.log('validation-ok')\\\"" } }), "utf8");
    const result = await validateWorkspace(root);
    assert.equal(result.passed, true);
    assert.equal(result.checks[0].status, "passed");
    assert.match(result.checks[0].output, /validation-ok/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file snapshots restore existing files and remove new files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devpilot-rollback-"));
  try {
    const existingPath = path.join(root, "existing.ts");
    await writeFile(existingPath, "before\n", "utf8");
    const existing = await snapshotWrite(root, { path: "existing.ts" });
    await writeFile(existingPath, "broken\n", "utf8");
    await restoreSnapshot(root, existing);
    assert.equal(await readFile(existingPath, "utf8"), "before\n");

    const created = await snapshotWrite(root, { path: "new.ts" });
    await writeFile(path.join(root, "new.ts"), "broken\n", "utf8");
    await restoreSnapshot(root, created);
    await assert.rejects(() => readFile(path.join(root, "new.ts"), "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
