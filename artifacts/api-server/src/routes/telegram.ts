import { Router } from "express";
import { db } from "@workspace/db";
import { telegramConfigTable, telegramUsersTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { startBot, stopBot, getBotStatus, sendMessageToUser } from "../telegram/bot.js";

const router = Router();

router.put("/settings/telegram", async (req, res): Promise<void> => {
  const { bot_token, enabled } = req.body as { bot_token?: string; enabled?: boolean };

  if (enabled === false) {
    stopBot();
    await db
      .update(telegramConfigTable)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(telegramConfigTable.id, 1));
    res.json({ ok: true, connected: false });
    return;
  }

  if (!bot_token || typeof bot_token !== "string" || bot_token.trim() === "") {
    res.status(400).json({ error: "bot_token is required" });
    return;
  }

  const token = bot_token.trim();

  try {
    const { username } = await startBot(token);

    const existing = await db.select().from(telegramConfigTable).where(eq(telegramConfigTable.id, 1));
    if (existing.length > 0) {
      await db.update(telegramConfigTable).set({
        botToken: token,
        botUsername: username,
        enabled: true,
        updatedAt: new Date(),
      }).where(eq(telegramConfigTable.id, 1));
    } else {
      await db.insert(telegramConfigTable).values({
        id: 1,
        botToken: token,
        botUsername: username,
        enabled: true,
      });
    }

    res.json({ ok: true, connected: true, botUsername: username });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "Failed to start Telegram bot with provided token");
    const isAuth = msg.includes("401") || msg.toLowerCase().includes("unauthorized");
    res.status(400).json({
      error: isAuth
        ? "Invalid bot token. Please check it in BotFather and try again."
        : `Failed to connect: ${msg}`,
    });
  }
});

router.get("/settings/telegram/status", async (_req, res): Promise<void> => {
  const status = getBotStatus();
  if (status.connected) {
    res.json({ connected: true, botUsername: status.botUsername, enabled: true });
    return;
  }
  const [cfg] = await db.select().from(telegramConfigTable).where(eq(telegramConfigTable.id, 1));
  res.json({
    connected: false,
    botUsername: cfg?.botUsername ?? null,
    enabled: cfg?.enabled ?? false,
  });
});

router.get("/telegram/users", async (_req, res): Promise<void> => {
  const users = await db
    .select()
    .from(telegramUsersTable)
    .orderBy(telegramUsersTable.requestedAt);

  res.json(
    users.map((u) => ({
      ...u,
      requestedAt: u.requestedAt?.toISOString() ?? null,
      reviewedAt: u.reviewedAt?.toISOString() ?? null,
    }))
  );
});

router.get("/telegram/users/pending/count", async (_req, res): Promise<void> => {
  const [row] = await db
    .select({ count: count() })
    .from(telegramUsersTable)
    .where(eq(telegramUsersTable.status, "pending"));
  res.json({ count: row?.count ?? 0 });
});

router.patch("/telegram/users/:id/approve", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [user] = await db
    .update(telegramUsersTable)
    .set({ status: "approved", reviewedAt: new Date(), reviewedBy: "admin" })
    .where(eq(telegramUsersTable.id, id))
    .returning();

  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  await sendMessageToUser(
    Number(user.telegramId),
    "✅ Your account has been approved! You can now use /alerts and /checkbalance."
  );

  res.json({ ok: true, user: { ...user, reviewedAt: user.reviewedAt?.toISOString() ?? null, requestedAt: user.requestedAt?.toISOString() ?? null } });
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

  await sendMessageToUser(
    Number(user.telegramId),
    "❌ Your registration request was rejected. Please contact your administrator."
  );

  res.json({ ok: true, user: { ...user, reviewedAt: user.reviewedAt?.toISOString() ?? null, requestedAt: user.requestedAt?.toISOString() ?? null } });
});

export default router;
