import app from "./app.js";
import { logger } from "./lib/logger.js";
import { startScheduler, startBalanceCacheRefresher } from "./lib/scheduler.js";
import { tryAutoStart } from "./telegram/bot.js";
import { seedAdminIfEmpty } from "./auth/seedAdmin.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function checkSchema(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT constraint_type
      FROM information_schema.table_constraints
      WHERE table_name = 'telegram_config' AND constraint_type = 'PRIMARY KEY'
    `);
    if (result.rows.length === 0) {
      logger.error(
        "[STARTUP] telegram_config table is missing its PRIMARY KEY constraint. " +
        "Bot token saves will fail. Fix: run  pnpm --filter @workspace/scripts run migrate",
      );
    }
  } catch (err) {
    logger.warn({ err }, "[STARTUP] Could not verify telegram_config schema");
  }
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  await checkSchema();
  await seedAdminIfEmpty();
  startScheduler();
  startBalanceCacheRefresher();
  await tryAutoStart();
});
