import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler, startBalanceCacheRefresher } from "./lib/scheduler";
import { tryAutoStart } from "./telegram/bot.js";
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

/**
 * Verify that critical DB tables have the expected constraints.
 * Logs a loud warning (not fatal) so the server still starts, but the
 * operator knows they need to run migrations.
 */
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
        "Bot token saves will fail. Fix: run  pnpm --filter @workspace/scripts run migrate"
      );
    }
  } catch (err) {
    logger.warn({ err }, "[STARTUP] Could not verify telegram_config schema — DB may not be reachable yet");
  }
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  await checkSchema();
  startScheduler();
  startBalanceCacheRefresher();
  await tryAutoStart();
});
