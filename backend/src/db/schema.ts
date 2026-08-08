import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  customType,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(768)";
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    return String(value).slice(1, -1).split(",").map(Number);
  },
});

export const repositories = pgTable("repositories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  rootPath: text("root_path").notNull(),
  status: text("status").notNull().default("idle"),
  lastIndexedAt: timestamp("last_indexed_at"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
}, (table) => [uniqueIndex("repositories_root_path_idx").on(table.rootPath)]);

export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  content: text("content").notNull(),
  contentHash: text("content_hash").notNull(),
  language: text("language"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
}, (table) => [uniqueIndex("documents_repository_path_idx").on(table.repositoryId, table.path)]);

export const chunks = pgTable("chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  startLine: integer("start_line").notNull(),
  endLine: integer("end_line").notNull(),
  content: text("content").notNull(),
  contentHash: text("content_hash").notNull(),
  embedding: vector("embedding", { dimensions: 768 }),
  embeddingModel: text("embedding_model"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
}, (table) => [
  uniqueIndex("chunks_document_index_idx").on(table.documentId, table.chunkIndex),
  index("chunks_embedding_cosine_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
]);

export const agentApprovals = pgTable("agent_approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id").references(() => agentTasks.id, { onDelete: "cascade" }),
  repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
  tool: text("tool").notNull(),
  args: jsonb("args").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  resolvedAt: timestamp("resolved_at"),
});

export const indexJobs = pgTable("index_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  totalFiles: integer("total_files").default(0).notNull(),
  totalChunks: integer("total_chunks").default(0).notNull(),
  embeddedChunks: integer("embedded_chunks").default(0).notNull(),
  removedFiles: integer("removed_files").default(0).notNull(),
  error: text("error"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

export const agentTasks = pgTable("agent_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
  task: text("task").notNull(),
  provider: text("provider").notNull(),
  status: text("status").notNull().default("running"),
  result: jsonb("result"),
  error: text("error"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  completedAt: timestamp("completed_at"),
});
