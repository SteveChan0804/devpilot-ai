import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { recoverInterruptedJobs } from "./services/recovery.service.js";
const app = buildApp();
try {
    const recovered = await recoverInterruptedJobs();
    if (recovered)
        console.log(`Recovered ${recovered} interrupted indexing jobs`);
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    console.log(`DevPilot API running at http://localhost:${env.PORT}`);
}
catch (error) {
    app.log.error(error);
    process.exit(1);
}
let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
