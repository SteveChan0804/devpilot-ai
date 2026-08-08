import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertSafeAgentPath, resolveWorkspacePath } from "../src/agent/workspace.js";
import { previewWrite } from "../src/agent/tools.js";

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
