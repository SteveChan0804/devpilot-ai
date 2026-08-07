import * as vscode from "vscode";

type Repository = { id: string; rootPath: string; name: string };
type ApiOptions = { method?: string; body?: unknown };

function backendUrl() { return vscode.workspace.getConfiguration("devpilot").get<string>("backendUrl", "http://localhost:3000").replace(/\/$/, ""); }

async function api<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const response = await fetch(`${backendUrl()}${endpoint}`, { method: options.method ?? "GET", headers: { "content-type": "application/json" }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

function workspacePath() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error("Open a workspace before using DevPilot");
  return folder.uri.fsPath;
}

async function currentRepository(): Promise<Repository> {
  const root = workspacePath();
  const result = await api<{ repositories: Repository[] }>("/repositories");
  const normalized = root.toLowerCase().replaceAll("/", "\\");
  const repository = result.repositories.find((item) => item.rootPath.toLowerCase().replaceAll("/", "\\") === normalized);
  if (!repository) throw new Error("Index this workspace first with DevPilot: Index Workspace");
  return repository;
}

async function indexWorkspace() {
  const rootPath = workspacePath();
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "DevPilot: indexing workspace" }, async () => {
    const result = await api<{ files: number; chunks: number }>("/repositories/index", { method: "POST", body: { rootPath, name: vscode.workspace.name ?? "workspace" } });
    vscode.window.showInformationMessage(`DevPilot indexed ${result.files} files and ${result.chunks} chunks.`);
  });
}

async function askAboutCode(prompt: string) {
  const repository = await currentRepository();
  const result = await api<{ answer: string }>("/chat", { method: "POST", body: { repositoryId: repository.id, message: prompt, provider: "ollama", limit: 8 } });
  const document = await vscode.workspace.openTextDocument({ content: result.answer, language: "markdown" });
  await vscode.window.showTextDocument(document, { preview: true });
}

class ChatViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly extensionUri: vscode.Uri) {}
  resolveWebviewView(view: vscode.WebviewView) {
    view.webview.options = { enableScripts: true };
    view.webview.html = `<!doctype html><html><body style="font-family: sans-serif"><h3>DevPilot AI</h3><textarea id="q" rows="5" style="width:100%" placeholder="Ask about this workspace"></textarea><button id="ask">Ask</button><pre id="answer" style="white-space:pre-wrap"></pre><script>const vscode=acquireVsCodeApi();document.getElementById('ask').onclick=()=>{const q=document.getElementById('q').value;vscode.postMessage({type:'ask',q})};window.addEventListener('message',e=>{document.getElementById('answer').textContent=e.data.answer})</script></body></html>`;
    view.webview.onDidReceiveMessage(async (message) => { if (message.type !== "ask") return; try { const repository = await currentRepository(); const result = await api<{ answer: string }>("/chat", { method: "POST", body: { repositoryId: repository.id, message: message.q, provider: "ollama", limit: 8 } }); view.webview.postMessage({ answer: result.answer }); } catch (error) { view.webview.postMessage({ answer: String(error) }); } });
  }
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(vscode.commands.registerCommand("devpilot.indexWorkspace", () => indexWorkspace().catch((error) => vscode.window.showErrorMessage(String(error)))));
  context.subscriptions.push(vscode.commands.registerCommand("devpilot.askAboutCode", async () => { const prompt = await vscode.window.showInputBox({ prompt: "Ask DevPilot about this workspace" }); if (prompt) await askAboutCode(prompt).catch((error) => vscode.window.showErrorMessage(String(error))); }));
  context.subscriptions.push(vscode.commands.registerCommand("devpilot.explainSelection", async () => { const selection = vscode.window.activeTextEditor?.document.getText(vscode.window.activeTextEditor.selection); if (!selection) return vscode.window.showInformationMessage("Select code first."); await askAboutCode(`Explain this code:\n\n${selection}`).catch((error) => vscode.window.showErrorMessage(String(error))); }));
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("devpilot.chatView", new ChatViewProvider(context.extensionUri)));
}

export function deactivate() {}
