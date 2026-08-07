CREATE TABLE IF NOT EXISTS "agent_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "repository_id" uuid NOT NULL,
  "tool" text NOT NULL,
  "args" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  "resolved_at" timestamp,
  CONSTRAINT "agent_approvals_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE
);
