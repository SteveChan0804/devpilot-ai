ALTER TABLE "agent_approvals" ADD COLUMN IF NOT EXISTS "task_id" uuid;
DO $$ BEGIN
  ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "agent_tasks"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
