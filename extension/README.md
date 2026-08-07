# DevPilot AI for VS Code

DevPilot AI connects VS Code to the local DevPilot backend for repository indexing, code questions, selection explanations, and a chat sidebar.

## Requirements

- DevPilot backend running at `http://localhost:3000`
- PostgreSQL/pgvector and Ollama available to the backend
- `nomic-embed-text` and `llama3.2` installed in Ollama

## Commands

- `DevPilot: Index Workspace`
- `DevPilot: Ask About Code`
- `DevPilot: Explain Selection`

Configure the backend URL with `devpilot.backendUrl` in VS Code settings.

## Development

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd run build
npm.cmd run package
```
