import { Client } from "pg";
import { env } from "../dist/config/env.js";

let failed = false;
function report(name, ok, detail) {
  console.log(`${ok ? "[ok]" : "[!!]"} ${name}: ${detail}`);
  if (!ok) failed = true;
}

const client = new Client({ connectionString: env.DATABASE_URL });
try {
  await client.connect();
  await client.query("select 1");
  report("PostgreSQL", true, "reachable");
  const vector = await client.query("select exists (select 1 from pg_extension where extname = 'vector') as installed");
  report("pgvector", vector.rows[0]?.installed === true, vector.rows[0]?.installed ? "extension installed" : "extension missing; run Docker Compose with pgvector");
} catch (error) {
  report("PostgreSQL", false, error instanceof Error ? error.message : String(error));
} finally {
  await client.end().catch(() => undefined);
}

try {
  const response = await fetch(`${env.OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const names = (payload.models ?? []).map((model) => model.name ?? "");
  const hasModel = (model) => names.some((name) => name === model || name.startsWith(`${model}:`));
  report("Ollama", true, `${names.length} model(s) available`);
  report("Embedding model", hasModel(env.OLLAMA_EMBEDDING_MODEL), env.OLLAMA_EMBEDDING_MODEL);
  report("Chat model", hasModel(env.OLLAMA_CHAT_MODEL), env.OLLAMA_CHAT_MODEL);
} catch (error) {
  report("Ollama", false, error instanceof Error ? error.message : String(error));
}

if (failed) {
  console.error("DevPilot is not ready. Fix the failed checks and run npm run doctor again.");
  process.exitCode = 1;
} else {
  console.log("DevPilot local dependencies are ready.");
}
