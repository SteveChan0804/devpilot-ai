import { FormEvent, useEffect, useState } from "react";
import { cancelAgentTask, getRepositories, indexRepository, Repository, Source, streamChat, runAgent, resolveAgentApproval, AgentCall } from "./api";

type Message = { role: "user" | "assistant"; content: string; sources?: Source[] };

export function App() {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [repositoryId, setRepositoryId] = useState("");
  const [rootPath, setRootPath] = useState("C:\\Projects\\AI\\devpilot-ai\\backend");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"chat" | "agent">("chat");
  const [approvals, setApprovals] = useState<AgentCall[]>([]);
  const [activeTaskId, setActiveTaskId] = useState("");

  useEffect(() => { getRepositories().then((items) => { setRepositories(items); if (items[0]) setRepositoryId(items[0].id); }).catch((e) => setError(e.message)); }, []);

  async function handleIndex() {
    setBusy(true); setError(""); setStatus("Indexing repository…");
    try { const result = await indexRepository(rootPath); setRepositoryId(result.repositoryId); setStatus(`Indexed ${result.files} files and ${result.chunks} chunks`); setRepositories(await getRepositories()); }
    catch (e) { setError(e instanceof Error ? e.message : "Indexing failed"); setStatus("Indexing failed"); }
    finally { setBusy(false); }
  }

  async function handleChat(event: FormEvent) {
    event.preventDefault(); if (!question.trim() || !repositoryId || busy) return;
    const prompt = question.trim(); setQuestion(""); setError(""); setBusy(true);
    setMessages((items) => [...items, { role: "user", content: prompt }, { role: "assistant", content: "" }]);
    try {
      if (mode === "agent") {
        const result = await runAgent(repositoryId, prompt, setActiveTaskId);
        setMessages((items) => items.map((item, index) => index === items.length - 1 ? { ...item, content: result.answer } : item));
        setApprovals((result.calls ?? []).filter((call) => call.status === "approval_required" && call.approvalId));
      } else {
        await streamChat(repositoryId, prompt, (token) => setMessages((items) => items.map((item, index) => index === items.length - 1 ? { ...item, content: item.content + token } : item)), (sources) => setMessages((items) => items.map((item, index) => index === items.length - 1 ? { ...item, sources } : item)));
      }
      setStatus("Ready");
    } catch (e) { setError(e instanceof Error ? e.message : "Chat failed"); }
    finally { setBusy(false); setActiveTaskId(""); }
  }

  async function handleCancel() {
    if (!activeTaskId) return;
    try { const result = await cancelAgentTask(activeTaskId); setStatus(result.status); }
    catch (e) { setError(e instanceof Error ? e.message : "Cancellation failed"); }
  }

  async function handleApproval(approvalId: string, approved: boolean) {
    try { const result = await resolveAgentApproval(approvalId, approved); setStatus(result.status); setApprovals((items) => items.filter((item) => item.approvalId !== approvalId)); }
    catch (e) { setError(e instanceof Error ? e.message : "Approval failed"); }
  }

  return <div className="app-shell">
    <header><div><span className="eyebrow">DEVPILOT AI</span><h1>Agentic engineering workspace</h1></div><span className="status-dot">{status}</span></header>
    <main>
      <aside className="panel">
        <h2>Repository</h2>
        <label>Indexed repositories<select value={repositoryId} onChange={(e) => setRepositoryId(e.target.value)}><option value="">Select a repository</option>{repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label>
        <label>Local path<input value={rootPath} onChange={(e) => setRootPath(e.target.value)} /></label>
        <button onClick={handleIndex} disabled={busy || !rootPath}>{busy ? "Working…" : "Index repository"}</button>
        <label>Mode<select value={mode} onChange={(e) => setMode(e.target.value as "chat" | "agent")}><option value="chat">RAG chat</option><option value="agent">Agent with approvals</option></select></label>
        <p className="hint">Agent mode can inspect the repository and request approval before changes.</p>
      </aside>
      <section className="chat panel"><div className="chat-header"><div><h2>Code assistant</h2><p>{mode === "agent" ? "Agent mode with approval-controlled actions." : "Ask about your indexed repository."}</p></div><span className="badge">{mode === "agent" ? "AGENT" : "LOCAL AI"}</span></div><div className="messages">{messages.length === 0 && <div className="empty"><strong>What should we explore?</strong><span>Ask about architecture, functions, bugs, or tests.</span></div>}{messages.map((message, index) => <article className={`message ${message.role}`} key={index}><span className="role">{message.role === "user" ? "YOU" : "DEVPILOT"}</span><div className="content">{message.content || (busy && index === messages.length - 1 ? "Thinking…" : "")}</div>{message.sources?.length ? <div className="sources"><strong>Sources</strong>{message.sources.map((source) => <span key={source.id}>{source.path}:{source.startLine}-{source.endLine}</span>)}</div> : null}</article>)}</div>{approvals.length > 0 && <div className="approvals"><strong>Approval required</strong>{approvals.map((approval) => <div key={approval.approvalId}><code>{approval.tool}</code>{approval.result?.preview ? <pre>{JSON.stringify(approval.result.preview, null, 2)}</pre> : null}<button onClick={() => handleApproval(approval.approvalId!, true)}>Approve</button><button onClick={() => handleApproval(approval.approvalId!, false)}>Reject</button></div>)}</div>}<form onSubmit={handleChat}><input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about your code…" disabled={busy || !repositoryId} /><button type="submit" disabled={busy || !repositoryId || !question.trim()}>Send</button></form></section>
    {activeTaskId && <button type="button" onClick={handleCancel}>Cancel active agent task</button>}
    </main>
    {error && <div className="error">{error}</div>}
  </div>;
}
