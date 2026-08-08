import path from "node:path";

export function resolveWorkspacePath(rootPath: string, relativePath: string) {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error("A relative workspace path is required");
  const root = path.resolve(rootPath);
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Path escapes the repository workspace");
  return target;
}

export function assertSafeAgentPath(relativePath: string) {
  const normalized = relativePath.replaceAll("\\", "/").toLowerCase();
  const segments = normalized.split("/");
  const filename = segments.at(-1) ?? "";
  if (segments.includes(".git") || segments.includes("node_modules") || filename.startsWith(".env") || /\.(pem|key|p12|pfx|crt|cer)$/.test(filename) || /(credentials|secrets?|tokens?)\.(json|ya?ml|toml|ini|txt)$/.test(filename)) {
    throw new Error("Sensitive or dependency paths are not available to the agent");
  }
}

export function assertReasonableSize(value: string, maxBytes = 200_000) {
  if (Buffer.byteLength(value, "utf8") > maxBytes) throw new Error(`Input exceeds the ${maxBytes}-byte limit`);
}
