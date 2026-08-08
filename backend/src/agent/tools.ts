import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import fg from "fast-glob";
import { assertReasonableSize, assertSafeAgentPath, resolveWorkspacePath } from "./workspace.js";

const execFileAsync = promisify(execFile);
export type AgentTool = "list_files" | "read_file" | "search_code" | "get_git_status" | "write_file" | "run_command";

export const toolDefinitions = [
  { name: "list_files", permission: "READ_ONLY", description: "List source files in the repository" },
  { name: "read_file", permission: "READ_ONLY", description: "Read a file inside the repository" },
  { name: "search_code", permission: "READ_ONLY", description: "Search text in source files" },
  { name: "get_git_status", permission: "READ_ONLY", description: "Read git status" },
  { name: "write_file", permission: "USER_APPROVAL", description: "Write a file after approval" },
  { name: "run_command", permission: "USER_APPROVAL", description: "Run an allowlisted development command after approval" },
] as const;

export type ToolArgs = Record<string, string | number | undefined>;

export function isApprovalTool(tool: AgentTool) { return tool === "write_file" || tool === "run_command"; }

export async function previewWrite(rootPath: string, args: ToolArgs) {
  assertSafeAgentPath(String(args.path ?? ""));
  const filePath = resolveWorkspacePath(rootPath, String(args.path ?? ""));
  const next = String(args.content ?? "");
  assertReasonableSize(next);
  let previous = "";
  try { previous = await readFile(filePath, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const before = previous.split("\n");
  const after = next.split("\n");
  const lines: string[] = [`--- ${path.relative(rootPath, filePath)}`, `+++ ${path.relative(rootPath, filePath)} (proposed)`];
  const max = Math.max(before.length, after.length);
  for (let index = 0; index < max && lines.length < 204; index++) {
    if (before[index] === after[index]) { if (index < 3 || index >= max - 3) lines.push(`  ${before[index] ?? ""}`); }
    else {
      if (before[index] !== undefined) lines.push(`- ${before[index]}`);
      if (after[index] !== undefined) lines.push(`+ ${after[index]}`);
    }
  }
  if (lines.length >= 204) lines.push("… diff truncated …");
  return { path: path.relative(rootPath, filePath), preview: lines.join("\n"), bytes: Buffer.byteLength(next, "utf8") };
}

export async function validateWorkspace(rootPath: string) {
  const checks: Array<{ directory: string; command: string; status: "passed" | "failed"; output: string }> = [];
  const candidates = [rootPath, path.join(rootPath, "backend"), path.join(rootPath, "frontend")];
  for (const directory of candidates) {
    let packageJson: { scripts?: Record<string, string> };
    try { packageJson = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8")); } catch { continue; }
    const command = packageJson.scripts?.typecheck ? "npm run typecheck" : packageJson.scripts?.build ? "npm run build" : undefined;
    if (!command) continue;
    const executable = process.platform === "win32" ? "npm.cmd" : "npm";
    try {
      const result = await execFileAsync(executable, command.split(" ").slice(1), { cwd: directory, timeout: 120_000, maxBuffer: 500_000 });
      checks.push({ directory: path.relative(rootPath, directory) || ".", command, status: "passed", output: `${result.stdout}${result.stderr}`.slice(-20_000) });
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; message?: string };
      checks.push({ directory: path.relative(rootPath, directory) || ".", command, status: "failed", output: `${failure.stdout ?? ""}${failure.stderr ?? failure.message ?? ""}`.slice(-20_000) });
    }
  }
  return { checks, passed: checks.every((check) => check.status === "passed") };
}

export async function executeTool(tool: AgentTool, rootPath: string, args: ToolArgs) {
  switch (tool) {
    case "list_files": {
      const files = await fg(["**/*"], { cwd: rootPath, onlyFiles: true, ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/dist-test/**", "**/.env*", "**/*.{pem,key,p12,pfx,crt,cer}", "**/*credentials*", "**/*secret*", "**/*token*"] });
      return { files: files.slice(0, 2_000) };
    }
    case "read_file": {
      const requestedPath = String(args.path ?? "").replace(/:\d+(?:-\d+)?$/, "");
      assertSafeAgentPath(requestedPath);
      const filePath = resolveWorkspacePath(rootPath, requestedPath);
      const content = await readFile(filePath, "utf8");
      assertReasonableSize(content);
      return { path: path.relative(rootPath, filePath), content };
    }
    case "search_code": {
      const query = String(args.query ?? "");
      if (!query) throw new Error("Search query is required");
      const files = await fg(["**/*.{ts,tsx,js,jsx,json,md}"], { cwd: rootPath, onlyFiles: true, ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/dist-test/**", "**/.env*", "**/*credentials*", "**/*secret*", "**/*token*"] });
      const matches: Array<{ path: string; line: number; text: string }> = [];
      for (const file of files) {
        const content = await readFile(path.join(rootPath, file), "utf8");
        content.split("\n").forEach((text, index) => { if (text.toLowerCase().includes(query.toLowerCase()) && matches.length < 200) matches.push({ path: file, line: index + 1, text: text.slice(0, 500) }); });
      }
      return { matches };
    }
    case "get_git_status": {
      const result = await execFileAsync("git", ["status", "--short"], { cwd: rootPath, timeout: 15_000, maxBuffer: 100_000 });
      return { output: result.stdout };
    }
    case "write_file": {
      assertSafeAgentPath(String(args.path ?? ""));
      const filePath = resolveWorkspacePath(rootPath, String(args.path ?? ""));
      const content = String(args.content ?? "");
      assertReasonableSize(content);
      await writeFile(filePath, content, "utf8");
      return { path: path.relative(rootPath, filePath), bytes: Buffer.byteLength(content, "utf8") };
    }
    case "run_command": {
      const command = String(args.command ?? "");
      const allowed: Record<string, [string, string[]]> = {
        "npm test": [process.platform === "win32" ? "npm.cmd" : "npm", ["test"]],
        "npm run build": [process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"]],
        "npm run typecheck": [process.platform === "win32" ? "npm.cmd" : "npm", ["run", "typecheck"]],
        "git status": ["git", ["status", "--short"]],
      };
      const selected = allowed[command];
      if (!selected) throw new Error("Command is not on the DevPilot allowlist");
      const result = await execFileAsync(selected[0], selected[1], { cwd: rootPath, timeout: 120_000, maxBuffer: 500_000 });
      return { command, output: `${result.stdout}${result.stderr}`.slice(0, 500_000) };
    }
  }
}
