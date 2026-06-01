import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db, alertHistoryTable } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * GET /api/health/alert-failures?hours=24
 *
 * Returns all failed email/SMS sends within the requested lookback window.
 * No authentication required — safe to poll from external monitors.
 *
 * Response shape:
 * {
 *   status: "ok" | "degraded",
 *   checked_at: ISO string,
 *   window_hours: number,
 *   failure_count: number,
 *   total_sends: number,
 *   failures: [{ id, metric, severity, channel, sentAt, errorMessage }]
 * }
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
      .where(
        and(
          eq(alertHistoryTable.success, false),
          gte(alertHistoryTable.sentAt, since)
        )
      )
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

export default router;
