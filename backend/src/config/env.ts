import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).default("postgresql://steve:password@localhost:5432/devpilot"),
  OLLAMA_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_EMBEDDING_MODEL: z.string().min(1).default("nomic-embed-text"),
  EMBEDDING_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  OLLAMA_CHAT_MODEL: z.string().min(1).default("llama3.2"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().min(1).default("openai/gpt-4o-mini"),
  INDEX_ROOT: z.string().min(1).default("."),
  API_KEY: z.string().min(16).optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
});

export const env = envSchema.parse(process.env);
