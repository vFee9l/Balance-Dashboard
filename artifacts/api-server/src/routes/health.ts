import { Router, type IRouter } from "express";
import os from "os";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db, alertHistoryTable } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { getGrafanaHealth } from "../lib/healthTracker.js";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * GET /api/health/alert-failures?hours=N
 * No auth required. Returns failed sends from alert history.
 */
router.get("/health/alert-failures", async (req, res): Promise<void> => {
  const hours = Math.min(Math.max(parseInt(String(req.query.hours ?? "24"), 10) || 24, 1), 720);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const [failures, totals] = await Promise.all([
    db
      .select({
        id:           alertHistoryTable.id,
        metric:       alertHistoryTable.metric,
        severity:     alertHistoryTable.severity,
        channel:      alertHistoryTable.channel,
        sentAt:       alertHistoryTable.sentAt,
        errorMessage: alertHistoryTable.errorMessage,
      })
      .from(alertHistoryTable)
      .where(and(eq(alertHistoryTable.success, false), gte(alertHistoryTable.sentAt, since)))
      .orderBy(sql`${alertHistoryTable.sentAt} DESC`),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(alertHistoryTable)
      .where(gte(alertHistoryTable.sentAt, since)),
  ]);

  const totalSends = totals[0]?.count ?? 0;

  res.json({
    status: failures.length === 0 ? "ok" : "degraded",
    checked_at: new Date().toISOString(),
    window_hours: hours,
    failure_count: failures.length,
    total_sends: totalSends,
    failures,
  });
});

/**
 * GET /api/health/nagios?hours=24
 *
 * Nagios-compatible health endpoint. No auth required.
 * Returns HTTP 200 when all checks pass, 503 when any check is degraded.
 *
 * Checks:
 *   - process memory (RSS < 500 MB = OK, < 1 GB = WARNING, else CRITICAL)
 *   - grafana data source (last fetch success, consecutive failures, staleness)
 *   - notification failures (failed SMS/email sends in the lookback window)
 *
 * Use with Nagios check_http plugin:
 *   check_http -H your.host -u /api/health/nagios -s '"overall":"ok"'
 */
router.get("/health/nagios", async (req, res): Promise<void> => {
  const hours = Math.min(Math.max(parseInt(String(req.query.hours ?? "24"), 10) || 24, 1), 720);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  // ── 1. Process memory ──────────────────────────────────────────────────────
  const mem = process.memoryUsage();
  const rssBytes = mem.rss;
  const heapUsedBytes = mem.heapUsed;
  const rssMb = Math.round(rssBytes / 1024 / 1024);
  const heapMb = Math.round(heapUsedBytes / 1024 / 1024);
  const memStatus = rssMb < 500 ? "ok" : rssMb < 1024 ? "warning" : "critical";

  // ── 2. System load ─────────────────────────────────────────────────────────
  const loadAvg = os.loadavg(); // [1m, 5m, 15m]
  const cpuCount = os.cpus().length;
  const load1m = Math.round((loadAvg[0] / cpuCount) * 100) / 100; // normalized 0-1 per core

  // ── 3. Process uptime ──────────────────────────────────────────────────────
  const uptimeSeconds = Math.floor(process.uptime());

  // ── 4. Grafana datasource ──────────────────────────────────────────────────
  const grafana = getGrafanaHealth();
  const grafanaStatus =
    grafana.lastAttemptAt === null
      ? "unknown"                              // never fetched since startup
      : grafana.consecutiveFailures >= 3
      ? "critical"
      : grafana.consecutiveFailures >= 1
      ? "warning"
      : (grafana.staleMinutes ?? 0) > 120      // >2 h since last attempt
      ? "warning"
      : "ok";

  // ── 5. Notification failures ───────────────────────────────────────────────
  const [smsFailures, emailFailures, totals] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(alertHistoryTable)
      .where(and(eq(alertHistoryTable.success, false), eq(alertHistoryTable.channel, "sms"), gte(alertHistoryTable.sentAt, since))),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(alertHistoryTable)
      .where(and(eq(alertHistoryTable.success, false), eq(alertHistoryTable.channel, "email"), gte(alertHistoryTable.sentAt, since))),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(alertHistoryTable)
      .where(gte(alertHistoryTable.sentAt, since)),
  ]);

  const smsFailCount = smsFailures[0]?.count ?? 0;
  const emailFailCount = emailFailures[0]?.count ?? 0;
  const totalSends = totals[0]?.count ?? 0;
  const notifStatus = (smsFailCount + emailFailCount) === 0 ? "ok" : "warning";

  // ── 6. Overall status ──────────────────────────────────────────────────────
  const statuses = [memStatus, grafanaStatus, notifStatus];
  const overall =
    statuses.includes("critical") ? "critical" :
    statuses.includes("warning")  ? "warning"  :
    statuses.some(s => s === "unknown") ? "unknown" :
    "ok";

  const httpStatus = overall === "critical" ? 503 : overall === "warning" ? 200 : 200;

  // Nagios performance data string (for check_http --expect + -s flag)
  const perfdata = [
    `memory_rss_mb=${rssMb};500;1024`,
    `memory_heap_mb=${heapMb}`,
    `load_1m_norm=${load1m}`,
    `uptime_seconds=${uptimeSeconds}`,
    `grafana_consecutive_failures=${grafana.consecutiveFailures}`,
    `sms_failures_${hours}h=${smsFailCount}`,
    `email_failures_${hours}h=${emailFailCount}`,
    `total_sends_${hours}h=${totalSends}`,
  ].join(" ");

  res.status(httpStatus).json({
    overall,
    checked_at: new Date().toISOString(),
    window_hours: hours,
    perfdata,
    checks: {
      memory: {
        status: memStatus,
        rss_mb: rssMb,
        heap_mb: heapMb,
      },
      system_load: {
        load_1m: loadAvg[0],
        load_5m: loadAvg[1],
        load_15m: loadAvg[2],
        cpu_count: cpuCount,
        load_1m_normalized: load1m,
      },
      process: {
        uptime_seconds: uptimeSeconds,
        uptime_human: formatUptime(uptimeSeconds),
        pid: process.pid,
      },
      grafana: {
        status: grafanaStatus,
        last_attempt_at: grafana.lastAttemptAt?.toISOString() ?? null,
        last_success_at: grafana.lastSuccessAt?.toISOString() ?? null,
        last_error: grafana.lastError,
        consecutive_failures: grafana.consecutiveFailures,
        stale_minutes: grafana.staleMinutes,
      },
      notifications: {
        status: notifStatus,
        window_hours: hours,
        sms_failures: smsFailCount,
        email_failures: emailFailCount,
        total_sends: totalSends,
      },
    },
  });
});

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

export default router;
