CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "path" text NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "repositories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "root_path" text NOT NULL UNIQUE,
  "status" text DEFAULT 'idle' NOT NULL,
  "last_indexed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

INSERT INTO "repositories" ("name", "root_path")
SELECT 'legacy repository', '.'
WHERE EXISTS (SELECT 1 FROM "documents")
  AND NOT EXISTS (SELECT 1 FROM "repositories");

ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "repository_id" uuid;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "content_hash" text;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "language" text;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;

UPDATE "documents" SET "repository_id" = (SELECT "id" FROM "repositories" LIMIT 1)
WHERE "repository_id" IS NULL AND EXISTS (SELECT 1 FROM "repositories");

ALTER TABLE "documents" ALTER COLUMN "repository_id" SET NOT NULL;
ALTER TABLE "documents" ALTER COLUMN "content_hash" SET DEFAULT '';
UPDATE "documents" SET "content_hash" = md5("content") WHERE "content_hash" IS NULL;
ALTER TABLE "documents" ALTER COLUMN "content_hash" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "documents_repository_path_idx" ON "documents" ("repository_id", "path");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_repository_id_fk') THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_repository_id_fk"
      FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "path" text NOT NULL,
  "chunk_index" integer NOT NULL,
  "start_line" integer NOT NULL,
  "end_line" integer NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "document_id" uuid;
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "content_hash" text;
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "embedding" vector(768);
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "embedding_model" text;

UPDATE "chunks" c SET "document_id" = d."id"
FROM "documents" d
WHERE c."document_id" IS NULL AND c."path" = d."path";
UPDATE "chunks" SET "content_hash" = md5("content") WHERE "content_hash" IS NULL;
DELETE FROM "chunks" WHERE "document_id" IS NULL;
ALTER TABLE "chunks" ALTER COLUMN "document_id" SET NOT NULL;
ALTER TABLE "chunks" ALTER COLUMN "content_hash" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "chunks_document_index_idx" ON "chunks" ("document_id", "chunk_index");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chunks_document_id_fk') THEN
    ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_fk"
      FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "chunks_embedding_cosine_idx"
  ON "chunks" USING hnsw ("embedding" vector_cosine_ops);
