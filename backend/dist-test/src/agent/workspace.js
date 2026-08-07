import path from "node:path";
export function resolveWorkspacePath(rootPath, relativePath) {
    if (!relativePath || path.isAbsolute(relativePath))
        throw new Error("A relative workspace path is required");
    const root = path.resolve(rootPath);
    const target = path.resolve(root, relativePath);
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative))
        throw new Error("Path escapes the repository workspace");
    return target;
}
export function assertReasonableSize(value, maxBytes = 200_000) {
    if (Buffer.byteLength(value, "utf8") > maxBytes)
        throw new Error(`Input exceeds the ${maxBytes}-byte limit`);
}
