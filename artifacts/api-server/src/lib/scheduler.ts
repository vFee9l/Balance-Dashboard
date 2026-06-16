import { db, settingsTable } from "@workspace/db";
import { logger } from "./logger";
import { runAlertChecks, refreshBalanceCache } from "../routes/grafana";

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
let balanceCacheTimer: ReturnType<typeof setInterval> | null = null;

const CACHE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

async function runBalanceCacheRefresh() {
  try {
    await refreshBalanceCache();
    logger.info("Balance cache refreshed");
  } catch (err) {
    logger.warn({ err }, "Balance cache refresh failed");
  }
}

export function startBalanceCacheRefresher() {
  // Run immediately on startup, then every hour
  void runBalanceCacheRefresh();
  balanceCacheTimer = setInterval(() => void runBalanceCacheRefresh(), CACHE_INTERVAL_MS);
  logger.info({ intervalMs: CACHE_INTERVAL_MS }, "Balance cache auto-refresh started");
}

export function stopBalanceCacheRefresher() {
  if (balanceCacheTimer) {
    clearInterval(balanceCacheTimer);
    balanceCacheTimer = null;
  }
}

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
