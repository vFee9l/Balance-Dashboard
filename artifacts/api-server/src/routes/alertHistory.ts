import { Router } from "express";
import { db, alertHistoryTable } from "@workspace/db";
import { desc, count, sql } from "drizzle-orm";

const router = Router();

router.get("/alerts/history", async (req, res): Promise<void> => {
  const history = await db
    .select()
    .from(alertHistoryTable)
    .orderBy(desc(alertHistoryTable.sentAt))
    .limit(100);

  res.json(history.map((h) => ({
    ...h,
    sentAt: h.sentAt.toISOString(),
  })));
});

router.get("/alerts/summary", async (req, res): Promise<void> => {
  const [totalRow] = await db.select({ total: count() }).from(alertHistoryTable);
  const totalAlertsSent = totalRow?.total ?? 0;

  const severityCounts = await db
    .select({
      severity: alertHistoryTable.severity,
      cnt: count(),
    })
    .from(alertHistoryTable)
    .groupBy(alertHistoryTable.severity);

  const bySeverity: Record<string, number> = {};
  for (const row of severityCounts) {
    bySeverity[row.severity] = row.cnt;
  }

  const [lastRow] = await db
    .select({ sentAt: alertHistoryTable.sentAt })
    .from(alertHistoryTable)
    .orderBy(desc(alertHistoryTable.sentAt))
    .limit(1);

  res.json({
    totalAlertsSent,
    clientsInWarning: bySeverity["warning"] ?? 0,
    clientsInCritical: bySeverity["critical"] ?? 0,
    clientsInEmergency: bySeverity["emergency"] ?? 0,
    lastRunAt: lastRow?.sentAt?.toISOString() ?? null,
  });
});

export default router;
