import { Router } from "express";
import { db } from "@workspace/db";
import {
  telegramConfigTable,
  telegramUsersTable,
  telegramAuditLogTable,
  telegramWhitelistTable,
} from "@workspace/db";
import { eq, count, desc, and, gte, lte, ilike, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { startBot, stopBot, getBotStatus, sendMessageToUser, invalidateConfigCache } from "../telegram/bot.js";
import { encrypt, decrypt } from "../lib/cryptoUtils.js";

const router = Router();

// ─── Helper: load or create config row ───────────────────────────────────────
async function getOrCreateConfig() {
  // Always select first — avoids the duplicate-key error on self-hosted installs
  // where the table already has a row from a previous run.
  const rows = await db.select().from(telegramConfigTable).limit(1);
  if (rows.length > 0) return rows[0]!;

  // Table is empty — insert seed row using upsert so concurrent requests don't race.
  await db
    .insert(telegramConfigTable)
    .values({ id: 1 })
    .onConflictDoNothing();

  // Re-select after upsert (handles the case where another request won the race).
  const [row] = await db.select().from(telegramConfigTable).limit(1);
  return row!;
}

// ─── Serialize user dates ─────────────────────────────────────────────────────
function serializeUser(u: typeof telegramUsersTable.$inferSelect) {
  return {
    ...u,
    requestedAt: u.requestedAt?.toISOString() ?? null,
    reviewedAt: u.reviewedAt?.toISOString() ?? null,
    suspendedAt: u.suspendedAt?.toISOString() ?? null,
    lockedUntil: u.lockedUntil?.toISOString() ?? null,
    lastActiveAt: u.lastActiveAt?.toISOString() ?? null,
    sessionExpiresAt: u.sessionExpiresAt?.toISOString() ?? null,
  };
}

// ─── Bot token / connection ───────────────────────────────────────────────────

router.put("/settings/telegram", async (req, res): Promise<void> => {
  const { bot_token, enabled } = req.body as { bot_token?: string; enabled?: boolean };

  // Toggle disable without changing token
  if (enabled === false) {
    stopBot();
    await db.update(telegramConfigTable).set({ enabled: false, updatedAt: new Date() }).where(eq(telegramConfigTable.id, 1));
    invalidateConfigCache();
    res.json({ ok: true, connected: false });
    return;
  }
  if (enabled === true && !bot_token) {
    // Re-enable with existing stored token
    const cfg = await getOrCreateConfig();
    if (!cfg.botTokenEnc) { res.status(400).json({ error: "No stored token. Please provide a bot_token." }); return; }
    try {
      const token = decrypt(cfg.botTokenEnc);
      const { username } = await startBot(token);
      await db.update(telegramConfigTable).set({ enabled: true, botUsername: username, updatedAt: new Date() }).where(eq(telegramConfigTable.id, 1));
      invalidateConfigCache();
      res.json({ ok: true, connected: true, botUsername: username });
    } catch (err) {
      res.status(400).json({ error: "Failed to start bot: " + (err instanceof Error ? err.message : String(err)) });
    }
    return;
  }

  if (!bot_token || typeof bot_token !== "string" || !bot_token.trim()) {
    res.status(400).json({ error: "bot_token is required" });
    return;
  }

  const token = bot_token.trim();
  try {
    const { username } = await startBot(token);
    const enc = encrypt(token);
    const cfg = await getOrCreateConfig();
    if (cfg) {
      await db.update(telegramConfigTable).set({ botTokenEnc: enc, botUsername: username, enabled: true, updatedAt: new Date() }).where(eq(telegramConfigTable.id, 1));
    } else {
      await db.insert(telegramConfigTable).values({ id: 1, botTokenEnc: enc, botUsername: username, enabled: true });
    }
    invalidateConfigCache();
    res.json({ ok: true, connected: true, botUsername: username });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAuth = msg.includes("401") || msg.toLowerCase().includes("unauthorized");
    res.status(400).json({
      error: isAuth ? "Invalid bot token — please check it in BotFather." : `Failed to connect: ${msg}`,
    });
  }
});

router.get("/settings/telegram/status", async (_req, res): Promise<void> => {
  const status = getBotStatus();
  const cfg = await getOrCreateConfig();
  res.json({
    connected: status.connected,
    botUsername: status.botUsername ?? cfg.botUsername ?? null,
    enabled: cfg.enabled,
    hasToken: !!cfg.botTokenEnc,
    whitelistEnabled: cfg.whitelistEnabled,
    requireApproval: cfg.requireApproval,
    sessionExpiryDays: cfg.sessionExpiryDays,
    maxFailedAttempts: cfg.maxFailedAttempts,
    lockoutMinutes: cfg.lockoutMinutes,
    maxCommandsPerMinute: cfg.maxCommandsPerMinute,
    maxRegistrationsPerDay: cfg.maxRegistrationsPerDay,
  });
});

router.delete("/settings/telegram/token", async (_req, res): Promise<void> => {
  stopBot();
  await db.update(telegramConfigTable).set({ botTokenEnc: "", enabled: false, updatedAt: new Date() }).where(eq(telegramConfigTable.id, 1));
  invalidateConfigCache();
  res.json({ ok: true });
});

router.put("/settings/telegram/config", async (req, res): Promise<void> => {
  const body = req.body as {
    whitelistEnabled?: boolean;
    requireApproval?: boolean;
    sessionExpiryDays?: number;
    maxFailedAttempts?: number;
    lockoutMinutes?: number;
    maxCommandsPerMinute?: number;
    maxRegistrationsPerDay?: number;
  };
  await getOrCreateConfig();
  await db.update(telegramConfigTable).set({ ...body, updatedAt: new Date() }).where(eq(telegramConfigTable.id, 1));
  invalidateConfigCache();
  res.json({ ok: true });
});

// ─── User management ──────────────────────────────────────────────────────────

router.get("/telegram/users", async (_req, res): Promise<void> => {
  const users = await db.select().from(telegramUsersTable).orderBy(desc(telegramUsersTable.requestedAt));
  res.json(users.map(serializeUser));
});

router.get("/telegram/users/pending/count", async (_req, res): Promise<void> => {
  const [row] = await db.select({ count: count() }).from(telegramUsersTable).where(eq(telegramUsersTable.status, "pending"));
  res.json({ count: row?.count ?? 0 });
});

router.patch("/telegram/users/:id/approve", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const cfg = await getOrCreateConfig();
  const expiresAt = new Date(Date.now() + cfg.sessionExpiryDays * 86_400_000);
  const [user] = await db
    .update(telegramUsersTable)
    .set({ status: "approved", reviewedAt: new Date(), reviewedBy: "admin", failedAttempts: 0, lockedUntil: null, sessionExpiresAt: expiresAt })
    .where(eq(telegramUsersTable.id, id))
    .returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  await sendMessageToUser(Number(user.telegramId), "✅ Your account has been approved. You may now use /alerts and /checkbalance.");
  res.json({ ok: true, user: serializeUser(user) });
});

router.patch("/telegram/users/:id/reject", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [user] = await db
    .update(telegramUsersTable)
    .set({ status: "rejected", reviewedAt: new Date(), reviewedBy: "admin" })
    .where(eq(telegramUsersTable.id, id))
    .returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  await sendMessageToUser(Number(user.telegramId), "❌ Your registration was not approved. Contact your administrator for details.");
  res.json({ ok: true, user: serializeUser(user) });
});

router.patch("/telegram/users/:id/role", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { role } = req.body as { role?: string };
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!["viewer", "operator", "admin"].includes(role ?? "")) { res.status(400).json({ error: "Invalid role. Must be viewer, operator, or admin." }); return; }
  const [user] = await db.update(telegramUsersTable).set({ role: role! }).where(eq(telegramUsersTable.id, id)).returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  await sendMessageToUser(Number(user.telegramId), `ℹ️ Your account role has been updated to <b>${role}</b>.`);
  res.json({ ok: true, user: serializeUser(user) });
});

router.patch("/telegram/users/:id/suspend", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { reason } = req.body as { reason?: string };
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [user] = await db
    .update(telegramUsersTable)
    .set({ status: "suspended", suspendedAt: new Date(), suspendedReason: reason?.slice(0, 500) ?? null })
    .where(eq(telegramUsersTable.id, id))
    .returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  await sendMessageToUser(Number(user.telegramId), "Your account has been suspended. Please contact your administrator.");
  res.json({ ok: true, user: serializeUser(user) });
});

router.patch("/telegram/users/:id/unlock", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [user] = await db
    .update(telegramUsersTable)
    .set({ lockedUntil: null, failedAttempts: 0 })
    .where(eq(telegramUsersTable.id, id))
    .returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ ok: true, user: serializeUser(user) });
});

router.patch("/telegram/users/:id/reset-session", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [user] = await db
    .update(telegramUsersTable)
    .set({ status: "pending", sessionExpiresAt: null })
    .where(eq(telegramUsersTable.id, id))
    .returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  await sendMessageToUser(Number(user.telegramId), "Your session has been reset. Please /register again to request access.");
  res.json({ ok: true, user: serializeUser(user) });
});

// ─── Whitelist ────────────────────────────────────────────────────────────────

router.get("/telegram/whitelist", async (_req, res): Promise<void> => {
  const rows = await db.select().from(telegramWhitelistTable).orderBy(desc(telegramWhitelistTable.addedAt));
  res.json(rows.map((r) => ({ ...r, addedAt: r.addedAt?.toISOString() ?? null })));
});

router.post("/telegram/whitelist", async (req, res): Promise<void> => {
  const { username, note } = req.body as { username?: string; note?: string };
  if (!username?.trim()) { res.status(400).json({ error: "username is required" }); return; }
  const clean = username.trim().replace(/^@/, "").toLowerCase();
  try {
    const [row] = await db
      .insert(telegramWhitelistTable)
      .values({ telegramUsername: clean, addedBy: "admin", note: note?.slice(0, 500) ?? null })
      .returning();
    res.status(201).json({ ...row, addedAt: row.addedAt?.toISOString() ?? null });
  } catch {
    res.status(409).json({ error: "Username already in whitelist" });
  }
});

router.delete("/telegram/whitelist/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(telegramWhitelistTable).where(eq(telegramWhitelistTable.id, id));
  res.json({ ok: true });
});

// ─── Audit log ────────────────────────────────────────────────────────────────

router.get("/telegram/audit", async (req, res): Promise<void> => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, parseInt(req.query.limit as string) || 50);
  const offset = (page - 1) * pageSize;

  const { telegramId: qId, command: qCmd, result: qRes, from: qFrom, to: qTo } = req.query as Record<string, string>;

  const conditions = [];
  if (qId) conditions.push(eq(telegramAuditLogTable.telegramId, parseInt(qId)));
  if (qCmd) conditions.push(ilike(telegramAuditLogTable.command, `%${qCmd}%`));
  if (qRes) conditions.push(eq(telegramAuditLogTable.result, qRes));
  if (qFrom) conditions.push(gte(telegramAuditLogTable.createdAt, new Date(qFrom)));
  if (qTo) conditions.push(lte(telegramAuditLogTable.createdAt, new Date(qTo)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db
    .select({ count: count() })
    .from(telegramAuditLogTable)
    .where(where);

  const logs = await db
    .select()
    .from(telegramAuditLogTable)
    .where(where)
    .orderBy(desc(telegramAuditLogTable.createdAt))
    .limit(pageSize)
    .offset(offset);

  res.json({
    logs: logs.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
    total: totalRow?.count ?? 0,
    page,
    pageSize,
  });
});

router.get("/telegram/audit/export", async (req, res): Promise<void> => {
  const { telegramId: qId, command: qCmd, result: qRes, from: qFrom, to: qTo } = req.query as Record<string, string>;

  const conditions = [];
  if (qId) conditions.push(eq(telegramAuditLogTable.telegramId, parseInt(qId)));
  if (qCmd) conditions.push(ilike(telegramAuditLogTable.command, `%${qCmd}%`));
  if (qRes) conditions.push(eq(telegramAuditLogTable.result, qRes));
  if (qFrom) conditions.push(gte(telegramAuditLogTable.createdAt, new Date(qFrom)));
  if (qTo) conditions.push(lte(telegramAuditLogTable.createdAt, new Date(qTo)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const logs = await db.select().from(telegramAuditLogTable).where(where).orderBy(desc(telegramAuditLogTable.createdAt)).limit(10_000);

  const headers = ["id", "telegramId", "username", "command", "args", "result", "detail", "createdAt"];
  const csvRows = [headers.join(",")];
  for (const l of logs) {
    csvRows.push(headers.map((h) => {
      const val = String((l as Record<string, unknown>)[h] ?? "");
      return val.includes(",") || val.includes('"') || val.includes("\n") ? `"${val.replace(/"/g, '""')}"` : val;
    }).join(","));
  }

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="telegram-audit-${Date.now()}.csv"`);
  res.send(csvRows.join("\n"));
});

export default router;
