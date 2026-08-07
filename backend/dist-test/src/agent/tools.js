import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import fg from "fast-glob";
import { assertReasonableSize, resolveWorkspacePath } from "./workspace.js";
const execFileAsync = promisify(execFile);
export const toolDefinitions = [
    { name: "list_files", permission: "READ_ONLY", description: "List source files in the repository" },
    { name: "read_file", permission: "READ_ONLY", description: "Read a file inside the repository" },
    { name: "search_code", permission: "READ_ONLY", description: "Search text in source files" },
    { name: "get_git_status", permission: "READ_ONLY", description: "Read git status" },
    { name: "write_file", permission: "USER_APPROVAL", description: "Write a file after approval" },
    { name: "run_command", permission: "USER_APPROVAL", description: "Run an allowlisted development command after approval" },
];
export function isApprovalTool(tool) { return tool === "write_file" || tool === "run_command"; }
export async function executeTool(tool, rootPath, args) {
    switch (tool) {
        case "list_files": {
            const files = await fg(["**/*"], { cwd: rootPath, onlyFiles: true, ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/dist-test/**"] });
            return { files: files.slice(0, 2_000) };
        }
        case "read_file": {
            const requestedPath = String(args.path ?? "").replace(/:\d+(?:-\d+)?$/, "");
            const filePath = resolveWorkspacePath(rootPath, requestedPath);
            const content = await readFile(filePath, "utf8");
            assertReasonableSize(content);
            return { path: path.relative(rootPath, filePath), content };
        }
        case "search_code": {
            const query = String(args.query ?? "");
            if (!query)
                throw new Error("Search query is required");
            const files = await fg(["**/*.{ts,tsx,js,jsx,json,md}"], { cwd: rootPath, onlyFiles: true, ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/dist-test/**"] });
            const matches = [];
            for (const file of files) {
                const content = await readFile(path.join(rootPath, file), "utf8");
                content.split("\n").forEach((text, index) => { if (text.toLowerCase().includes(query.toLowerCase()) && matches.length < 200)
                    matches.push({ path: file, line: index + 1, text: text.slice(0, 500) }); });
            }
            return { matches };
        }
        case "get_git_status": {
            const result = await execFileAsync("git", ["status", "--short"], { cwd: rootPath, timeout: 15_000, maxBuffer: 100_000 });
            return { output: result.stdout };
        }
        case "write_file": {
            const filePath = resolveWorkspacePath(rootPath, String(args.path ?? ""));
            const content = String(args.content ?? "");
            assertReasonableSize(content);
            await writeFile(filePath, content, "utf8");
            return { path: path.relative(rootPath, filePath), bytes: Buffer.byteLength(content, "utf8") };
        }
        case "run_command": {
            const command = String(args.command ?? "");
            const allowed = {
                "npm test": [process.platform === "win32" ? "npm.cmd" : "npm", ["test"]],
                "npm run build": [process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"]],
                "npm run typecheck": [process.platform === "win32" ? "npm.cmd" : "npm", ["run", "typecheck"]],
                "git status": ["git", ["status", "--short"]],
            };
            const selected = allowed[command];
            if (!selected)
                throw new Error("Command is not on the DevPilot allowlist");
            const result = await execFileAsync(selected[0], selected[1], { cwd: rootPath, timeout: 120_000, maxBuffer: 500_000 });
            return { command, output: `${result.stdout}${result.stderr}`.slice(0, 500_000) };
        }
    }
}
