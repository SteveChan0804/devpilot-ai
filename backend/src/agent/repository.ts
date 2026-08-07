import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { repositories } from "../db/schema.js";

export async function getRepositoryRoot(repositoryId: string) {
  const row = await db.select({ rootPath: repositories.rootPath }).from(repositories).where(eq(repositories.id, repositoryId));
  if (!row[0]) throw new Error("Repository not found");
  return row[0].rootPath;
}
