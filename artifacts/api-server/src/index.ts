import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler, startBalanceCacheRefresher } from "./lib/scheduler";
import { db } from "@workspace/db";
import { telegramConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { startBot } from "./telegram/bot.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startScheduler();
  startBalanceCacheRefresher();

  try {
    const [cfg] = await db
      .select()
      .from(telegramConfigTable)
      .where(eq(telegramConfigTable.enabled, true));
    if (cfg?.botToken) {
      await startBot(cfg.botToken);
      logger.info({ botUsername: cfg.botUsername }, "Telegram bot started on startup");
    }
  } catch (err) {
    logger.warn({ err }, "Could not start Telegram bot on startup");
  }
});
