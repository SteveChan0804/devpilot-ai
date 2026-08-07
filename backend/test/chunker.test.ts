import assert from "node:assert/strict";
import test from "node:test";
import { chunkFiles } from "../src/chunker/chunker.js";

test("chunker preserves paths and line metadata", () => {
  const chunks = chunkFiles([{ path: "src/example.ts", content: "const a = 1;\nconst b = 2;\n" }]);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].path, "src/example.ts");
  assert.equal(chunks[0].startLine, 1);
  assert.equal(chunks[0].endLine, 3);
});

test("chunker handles an oversized line without dropping content", () => {
  const content = "x".repeat(2_000);
  const chunks = chunkFiles([{ path: "large.ts", content }]);
  assert.equal(chunks.map((chunk) => chunk.content).join(""), `${content}\n`);
});
