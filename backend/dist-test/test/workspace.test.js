import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkspacePath } from "../src/agent/workspace.js";
test("workspace guard permits files inside the repository", () => {
    assert.equal(resolveWorkspacePath("C:\\repo", "src\\app.ts"), "C:\\repo\\src\\app.ts");
});
test("workspace guard rejects traversal", () => {
    assert.throws(() => resolveWorkspacePath("C:\\repo", "..\\secrets.txt"), /escapes/);
});
