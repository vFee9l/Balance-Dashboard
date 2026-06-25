import { Router } from "express";
import { db, appLoginAuditTable } from "@workspace/db";
import { desc, gte, lte, eq, and, type SQL } from "drizzle-orm";

const router = Router();

// GET /api/audit/login?page=1&pageSize=50&username=&result=&from=&to=
router.get("/audit/login", async (req, res): Promise<void> => {
  const page = Math.max(1, Number(req.query["page"] ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(req.query["pageSize"] ?? 50)));
  const offset = (page - 1) * pageSize;

  const filters: SQL[] = [];
  if (req.query["username"])
    filters.push(eq(appLoginAuditTable.username, String(req.query["username"])));
  if (req.query["result"])
    filters.push(eq(appLoginAuditTable.result, String(req.query["result"])));
  if (req.query["from"])
    filters.push(gte(appLoginAuditTable.createdAt, new Date(String(req.query["from"]))));
  if (req.query["to"])
    filters.push(lte(appLoginAuditTable.createdAt, new Date(String(req.query["to"]))));

  const where = filters.length ? and(...filters) : undefined;

  const rows = await db
    .select()
    .from(appLoginAuditTable)
    .where(where)
    .orderBy(desc(appLoginAuditTable.createdAt))
    .limit(pageSize)
    .offset(offset);

  res.json({
    rows: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt?.toISOString() ?? null,
    })),
    page,
    pageSize,
  });
});

export default router;
