import fs from "node:fs/promises";
import { Client } from "pg";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL ?? "postgres://steve:password@localhost:5432/devpilot";
const client = new Client({ connectionString });
const migrations = ["0003_repository_vectors.sql", "0004_agent_approvals.sql", "0005_index_jobs.sql", "0006_agent_tasks.sql", "0005_agent_approval_tasks.sql", "0007_document_languages.sql"];

try {
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS devpilot_migrations (
      name text PRIMARY KEY,
      applied_at timestamp DEFAULT now() NOT NULL
    )
  `);
  for (const file of migrations) {
    const applied = await client.query("SELECT 1 FROM devpilot_migrations WHERE name = $1", [file]);
    if (applied.rowCount) continue;
    const migration = await fs.readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(migration);
      await client.query("INSERT INTO devpilot_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  console.log("DevPilot database migrations are up to date.");
} finally {
  await client.end().catch(() => undefined);
}
