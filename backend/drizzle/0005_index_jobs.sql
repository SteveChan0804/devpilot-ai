CREATE TABLE IF NOT EXISTS "index_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "repository_id" uuid NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "total_files" integer DEFAULT 0 NOT NULL,
  "total_chunks" integer DEFAULT 0 NOT NULL,
  "embedded_chunks" integer DEFAULT 0 NOT NULL,
  "removed_files" integer DEFAULT 0 NOT NULL,
  "error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "started_at" timestamp,
  "completed_at" timestamp,
  CONSTRAINT "index_jobs_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE
);
