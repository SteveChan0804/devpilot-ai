import fs from "node:fs/promises";
import { Client } from "pg";

const connectionString = process.env.DATABASE_URL ?? "postgres://steve:password@localhost:5432/devpilot";
const client = new Client({ connectionString });

try {
  await client.connect();
for (const file of ["0003_repository_vectors.sql", "0004_agent_approvals.sql", "0005_index_jobs.sql", "0006_agent_tasks.sql", "0005_agent_approval_tasks.sql"]) {
    const migration = await fs.readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    await client.query(migration);
  }
  console.log("DevPilot database migration applied.");
} finally {
  await client.end().catch(() => undefined);
}
