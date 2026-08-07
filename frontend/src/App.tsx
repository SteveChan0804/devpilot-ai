import { FormEvent, useEffect, useState } from "react";
import { getRepositories, indexRepository, Repository, Source, streamChat } from "./api";

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
      await streamChat(repositoryId, prompt, (token) => setMessages((items) => items.map((item, index) => index === items.length - 1 ? { ...item, content: item.content + token } : item)), (sources) => setMessages((items) => items.map((item, index) => index === items.length - 1 ? { ...item, sources } : item)));
      setStatus("Ready");
    } catch (e) { setError(e instanceof Error ? e.message : "Chat failed"); }
    finally { setBusy(false); }
  }

  return <div className="app-shell">
    <header><div><span className="eyebrow">DEVPILOT AI</span><h1>Agentic engineering workspace</h1></div><span className="status-dot">{status}</span></header>
    <main>
      <aside className="panel">
        <h2>Repository</h2>
        <label>Indexed repositories<select value={repositoryId} onChange={(e) => setRepositoryId(e.target.value)}><option value="">Select a repository</option>{repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label>
        <label>Local path<input value={rootPath} onChange={(e) => setRootPath(e.target.value)} /></label>
        <button onClick={handleIndex} disabled={busy || !rootPath}>{busy ? "Working…" : "Index repository"}</button>
        <p className="hint">Ollama is used locally for embeddings and chat.</p>
      </aside>
      <section className="chat panel"><div className="chat-header"><div><h2>Code assistant</h2><p>Ask about your indexed repository.</p></div><span className="badge">LOCAL AI</span></div><div className="messages">{messages.length === 0 && <div className="empty"><strong>What should we explore?</strong><span>Ask about architecture, functions, bugs, or tests.</span></div>}{messages.map((message, index) => <article className={`message ${message.role}`} key={index}><span className="role">{message.role === "user" ? "YOU" : "DEVPILOT"}</span><div className="content">{message.content || (busy && index === messages.length - 1 ? "Thinking…" : "")}</div>{message.sources?.length ? <div className="sources"><strong>Sources</strong>{message.sources.map((source) => <span key={source.id}>{source.path}:{source.startLine}-{source.endLine}</span>)}</div> : null}</article>)}</div><form onSubmit={handleChat}><input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about your code…" disabled={busy || !repositoryId} /><button type="submit" disabled={busy || !repositoryId || !question.trim()}>Send</button></form></section>
    </main>
    {error && <div className="error">{error}</div>}
  </div>;
}
