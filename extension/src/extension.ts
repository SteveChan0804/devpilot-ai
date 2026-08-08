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

async function resolveAgentApproval(approvalId: string, approved: boolean) {
  const result = await api<{ status: string; answer?: string }>("/agent/approve", { method: "POST", body: { approvalId, approved } });
  vscode.window.showInformationMessage(`DevPilot approval ${result.status}.`);
  return result;
}

function registerChatParticipant(context: vscode.ExtensionContext) {
  const participant = vscode.chat.createChatParticipant("devpilot-ai.agent", async (request, _chatContext, response, token) => {
    if (token.isCancellationRequested) return;
    try {
      const repository = await currentRepository();
      response.progress("Planning repository actions…");
      const result = await api<{ answer: string; status: string; calls?: Array<{ tool: string; status: string; approvalId?: string }> }>("/agent/run", { method: "POST", body: { repositoryId: repository.id, task: request.prompt, provider: "ollama" } });
      if (token.isCancellationRequested) return;
      response.markdown(result.answer);
      for (const call of result.calls ?? []) {
        if (call.status !== "approval_required" || !call.approvalId) continue;
        response.button({ command: "devpilot.resolveApproval", title: `Approve ${call.tool}`, arguments: [call.approvalId, true] });
        response.button({ command: "devpilot.resolveApproval", title: `Reject ${call.tool}`, arguments: [call.approvalId, false] });
      }
    } catch (error) {
      response.markdown(`DevPilot error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "devpilot.svg");
  context.subscriptions.push(participant);
}

class ChatViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly extensionUri: vscode.Uri) {}
  resolveWebviewView(view: vscode.WebviewView) {
    view.webview.options = { enableScripts: true };
    view.webview.html = `<!doctype html><html><body style="font-family: sans-serif"><h3>DevPilot AI</h3><button id="index">Index Workspace</button><p id="status">Index this workspace before asking questions.</p><textarea id="q" rows="5" style="width:100%" placeholder="Ask about this workspace"></textarea><button id="ask">Run Agent</button><pre id="answer" style="white-space:pre-wrap"></pre><div id="approvals"></div><script>const vscode=acquireVsCodeApi();document.getElementById('index').onclick=()=>{document.getElementById('status').textContent='Indexing…';vscode.postMessage({type:'index'})};document.getElementById('ask').onclick=()=>{const q=document.getElementById('q').value;vscode.postMessage({type:'ask',q})};window.addEventListener('message',e=>{if(e.data.status)document.getElementById('status').textContent=e.data.status;if(e.data.answer)document.getElementById('answer').textContent=e.data.answer;const box=document.getElementById('approvals');box.replaceChildren();(e.data.approvals||[]).forEach(a=>{const row=document.createElement('div');const detail=document.createElement('pre');detail.textContent=a.tool+'\\n'+(a.preview?.preview||JSON.stringify(a.preview||a.args||{},null,2));const approve=document.createElement('button');approve.textContent='Approve';approve.onclick=()=>vscode.postMessage({type:'approve',approvalId:a.approvalId,approved:true});const reject=document.createElement('button');reject.textContent='Reject';reject.onclick=()=>vscode.postMessage({type:'approve',approvalId:a.approvalId,approved:false});row.append(detail,approve,reject);box.appendChild(row)})})</script></body></html>`;
    view.webview.onDidReceiveMessage(async (message) => {
      try {
        if (message.type === "index") {
          const rootPath = workspacePath();
          const result = await api<{ files: number; chunks: number }>("/repositories/index", { method: "POST", body: { rootPath, name: vscode.workspace.name ?? "workspace" } });
          view.webview.postMessage({ status: `Indexed ${result.files} files and ${result.chunks} chunks.` });
          return;
        }
        const repository = await currentRepository();
        if (message.type === "approve") {
          const result = await api<{ result?: unknown; status: string }>("/agent/approve", { method: "POST", body: { approvalId: message.approvalId, approved: message.approved === true } });
          view.webview.postMessage({ answer: JSON.stringify(result.result ?? result), status: "Approved" });
          return;
        }
        if (message.type !== "ask") return;
        const result = await api<{ answer: string; status: string; calls?: Array<{ tool: string; status: string; approvalId?: string; result?: unknown }> }>("/agent/run", { method: "POST", body: { repositoryId: repository.id, task: message.q, provider: "ollama" } });
        view.webview.postMessage({ answer: result.answer, status: result.status, approvals: (result.calls ?? []).filter((call) => call.status === "approval_required" && call.approvalId).map((call) => ({ ...call, args: (call.result as { args?: unknown } | undefined)?.args, preview: (call.result as { preview?: unknown } | undefined)?.preview })) });
      } catch (error) {
        view.webview.postMessage({ answer: String(error), status: "Action failed" });
      }
    });
  }
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(vscode.commands.registerCommand("devpilot.indexWorkspace", () => indexWorkspace().catch((error) => vscode.window.showErrorMessage(String(error)))));
  context.subscriptions.push(vscode.commands.registerCommand("devpilot.askAboutCode", async () => { const prompt = await vscode.window.showInputBox({ prompt: "Ask DevPilot about this workspace" }); if (prompt) await askAboutCode(prompt).catch((error) => vscode.window.showErrorMessage(String(error))); }));
  context.subscriptions.push(vscode.commands.registerCommand("devpilot.explainSelection", async () => { const selection = vscode.window.activeTextEditor?.document.getText(vscode.window.activeTextEditor.selection); if (!selection) return vscode.window.showInformationMessage("Select code first."); await askAboutCode(`Explain this code:\n\n${selection}`).catch((error) => vscode.window.showErrorMessage(String(error))); }));
  context.subscriptions.push(vscode.commands.registerCommand("devpilot.resolveApproval", (approvalId: string, approved: boolean) => resolveAgentApproval(approvalId, approved).catch((error) => vscode.window.showErrorMessage(String(error)))));
  registerChatParticipant(context);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("devpilot.chatView", new ChatViewProvider(context.extensionUri)));
}

export function deactivate() {}
