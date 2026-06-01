import { db, settingsTable } from "@workspace/db";
import { logger } from "./logger";
import { runAlertChecks } from "../routes/grafana";

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;

function msUntilNextRun(hour: number): number {
  const now = new Date();
  const next = new Date();
  next.setHours(hour, 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

async function runScheduledAlerts() {
  logger.info("Running scheduled alert checks");
  try {
    const result = await runAlertChecks();
    logger.info({ notificationsSent: result.notificationsSent, clientsChecked: result.clientsChecked }, "Scheduled alert run complete");
  } catch (err) {
    logger.error({ err }, "Scheduled alert run failed");
  }
  scheduleNext();
}

async function scheduleNext() {
  const [settings] = await db.select().from(settingsTable).limit(1);
  if (!settings?.scheduleEnabled) {
    logger.info("Scheduler is disabled, not scheduling next run");
    return;
  }
  const hour = settings.scheduleHour ?? 8;
  const delay = msUntilNextRun(hour);
  logger.info({ nextRunInMs: delay, hour }, "Scheduling next alert run");
  schedulerTimer = setTimeout(runScheduledAlerts, delay);
}

export function startScheduler() {
  logger.info("Alert scheduler starting");
  scheduleNext().catch((err) => logger.error({ err }, "Failed to start scheduler"));
}

export function stopScheduler() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
    logger.info("Alert scheduler stopped");
  }
}
