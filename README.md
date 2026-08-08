# DevPilot AI

DevPilot AI is a repository-aware engineering assistant. It scans a workspace, chunks source files, generates Ollama embeddings, stores them in PostgreSQL with pgvector, retrieves relevant context, and uses local or cloud LLMs for chat and approval-controlled agent tasks.

## Architecture

```text
Repository → Scanner → Chunker → Embeddings → PostgreSQL/pgvector
                                              ↓
                                      Hybrid retrieval
                                              ↓
                              Chat or approval-controlled agent
```

## Run locally

1. Start PostgreSQL and pgvector:

   ```powershell
   docker compose up -d postgres
   ```

2. Start Ollama and install the required models:

   ```powershell
   ollama serve
   ollama pull nomic-embed-text
   ollama pull llama3.2
   ```

3. Configure `backend/.env` using the values in `backend/.env.example`. Keep `HOST=127.0.0.1` for local-only use. If you expose the API on a network interface, set a strong `API_KEY` as well.

4. Start the backend:

   ```powershell
   cd backend
   npm install
   npm run migrate:local
   npm run doctor
   npm run dev
   ```

5. Start the frontend:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

6. Install the VS Code extension from `extension/devpilot-ai-0.1.0.vsix`.

## Agent safety

Agent tasks use read-only tools automatically. File writes and development commands require explicit approval. Before a file write, DevPilot shows a proposed diff. After an approved write, it runs available typecheck/build validation and reports failures. `.env`, credentials, keys, certificates, `.git`, and dependency folders are blocked from agent access.

## Verification

```powershell
cd backend
npm run typecheck
npm test
npm run test:integration

cd ..\frontend
npm run build

cd ..\extension
npm run package
```

See [RELEASE.md](RELEASE.md) for versioning and GitHub release steps.
