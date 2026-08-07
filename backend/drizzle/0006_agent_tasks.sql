CREATE TABLE IF NOT EXISTS "agent_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "repository_id" uuid NOT NULL,
  "task" text NOT NULL,
  "provider" text NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "result" jsonb,
  "error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp,
  CONSTRAINT "agent_tasks_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE
);
