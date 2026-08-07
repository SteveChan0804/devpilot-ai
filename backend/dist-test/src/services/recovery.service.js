import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { indexJobs, repositories } from "../db/schema.js";
export async function recoverInterruptedJobs() {
    const recovered = await db.update(indexJobs)
        .set({ status: "failed", error: "Interrupted by backend restart", completedAt: new Date() })
        .where(inArray(indexJobs.status, ["pending", "indexing"]))
        .returning({ id: indexJobs.id });
    await db.update(repositories).set({ status: "failed" }).where(eq(repositories.status, "indexing"));
    return recovered.length;
}
