import TelegramBot from "node-telegram-bot-api";
import { db } from "@workspace/db";
import {
  telegramUsersTable,
  telegramSessionsTable,
  telegramAuditLogTable,
  telegramRateLimitsTable,
  telegramWhitelistTable,
  telegramConfigTable,
  alertHistoryTable,
} from "@workspace/db";
import type { TelegramUser, TelegramConfig } from "@workspace/db";
import { eq, and, desc, ne } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { getBalanceCache } from "../lib/balanceCache.js";
import { decrypt, encrypt } from "../lib/cryptoUtils.js";
import { sanitizeTelegramSetting } from "../lib/telegram.js";

// ─── Bot instance state ───────────────────────────────────────────────────────
let bot: TelegramBot | null = null;
let _botUsername: string | null = null;
let _connected = false;
let _restartTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Config cache (30 s TTL to avoid per-message DB round-trips) ─────────────
let _cfgCache: { data: TelegramConfig | null; expiresAt: number } | null = null;

function getTokenDiagnostics(token: string) {
  return {
    tokenLength: token.length,
    tokenPrefix: token.slice(0, 4),
    tokenSuffix: token.slice(-4),
    tokenFormatValid: /^\d+:[A-Za-z0-9_-]+$/.test(token),
  };
}

async function getConfig(): Promise<TelegramConfig | null> {
  const now = Date.now();
  if (_cfgCache && _cfgCache.expiresAt > now) return _cfgCache.data;
  const [cfg] = await db.select().from(telegramConfigTable).where(eq(telegramConfigTable.id, 1));
  _cfgCache = { data: cfg ?? null, expiresAt: now + 30_000 };
  return cfg ?? null;
}

export function invalidateConfigCache() {
  _cfgCache = null;
}

// ─── Public API ───────────────────────────────────────────────────────────────
export async function startBot(token: string): Promise<{ username: string }> {
  const sanitizedToken = sanitizeTelegramSetting(token);
  if (!sanitizedToken) {
    throw new Error("bot_token is required");
  }
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(sanitizedToken)) {
    throw new Error("Invalid bot token format. Expected digits, one colon, then letters, digits, hyphens, or underscores.");
  }

  await stopBot();
  // Give Telegram's servers 2 s to release the previous getUpdates session,
  // otherwise we get a 409 Conflict on the very next poll.
  await new Promise<void>((r) => setTimeout(r, 2000));

  const probe = new TelegramBot(sanitizedToken, { polling: false });
  logger.info(
    {
      ...getTokenDiagnostics(sanitizedToken),
      tokenSanitized: token !== sanitizedToken,
    },
    "Testing interactive Telegram bot token with getMe",
  );
  const me = await probe.getMe();
  _botUsername = me.username ?? null;
  bot = new TelegramBot(sanitizedToken, {
    polling: { interval: 300, autoStart: true, params: { timeout: 10 } },
  });
  _connected = true;
  registerHandlers(bot);
  logger.info({ username: _botUsername }, "Telegram bot started");
  return { username: me.username ?? "" };
}

export async function stopBot(): Promise<void> {
  if (_restartTimer) { clearTimeout(_restartTimer); _restartTimer = null; }
  if (bot) {
    try { await bot.stopPolling(); } catch (_) { /* ignore */ }
    bot = null;
    _connected = false;
    _botUsername = null;
    logger.info("Telegram bot stopped");
  }
}

export async function sendMessageToUser(telegramId: number, text: string): Promise<void> {
  if (!bot) return;
  try { await bot.sendMessage(telegramId, text, { parse_mode: "HTML" }); }
  catch (err) { logger.warn({ err, telegramId }, "Failed to send Telegram message to user"); }
}

export function getBotStatus(): { connected: boolean; botUsername: string | null } {
  return { connected: _connected, botUsername: _botUsername };
}

// Auto-start from DB encrypted token on server startup
export async function tryAutoStart(): Promise<void> {
  try {
    const [cfg] = await db.select().from(telegramConfigTable).where(eq(telegramConfigTable.id, 1));
    if (cfg?.enabled && cfg.botTokenEnc) {
      const decryptedToken = decrypt(cfg.botTokenEnc);
      const token = sanitizeTelegramSetting(decryptedToken);
      if (!token) {
        throw new Error("Stored bot token is empty after sanitization");
      }
      await startBot(decryptedToken);
      if (token !== decryptedToken) {
        await db
          .update(telegramConfigTable)
          .set({ botTokenEnc: encrypt(token), updatedAt: new Date() })
          .where(eq(telegramConfigTable.id, cfg.id));
        invalidateConfigCache();
        logger.warn("Removed invisible characters from stored interactive Telegram bot token");
      }
      logger.info({ botUsername: cfg.botUsername }, "Telegram bot auto-started from stored token");
    }
  } catch (err) {
    logger.warn({ err }, "Could not auto-start Telegram bot");
  }
}

// ─── Input sanitization ───────────────────────────────────────────────────────
function sanitize(input: string, maxLen: number): string {
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLen);
}

function hasInvalidChars(s: string): boolean {
  return /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/.test(s);
}

// ─── Audit log ────────────────────────────────────────────────────────────────
async function audit(
  telegramId: number | null | undefined,
  username: string | undefined,
  command: string,
  args: string,
  result: string,
  detail: string
): Promise<void> {
  try {
    await db.insert(telegramAuditLogTable).values({
      telegramId: telegramId ?? null,
      username: username ?? null,
      command,
      args: args.slice(0, 500),
      result,
      detail: detail.slice(0, 1000),
    });
  } catch (err) {
    logger.warn({ err }, "Failed to write audit log");
  }
}

// ─── Rate limiting (fixed-window) ─────────────────────────────────────────────
async function checkRateLimit(
  telegramId: number,
  bucket: string,
  maxCount: number,
  windowSecs: number
): Promise<boolean> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowSecs * 1000);
  const [row] = await db
    .select()
    .from(telegramRateLimitsTable)
    .where(
      and(
        eq(telegramRateLimitsTable.telegramId, telegramId),
        eq(telegramRateLimitsTable.bucket, bucket)
      )
    );
  if (!row || row.windowStart < cutoff) {
    await db
      .insert(telegramRateLimitsTable)
      .values({ telegramId, bucket, count: 1, windowStart: now })
      .onConflictDoUpdate({
        target: [telegramRateLimitsTable.telegramId, telegramRateLimitsTable.bucket],
        set: { count: 1, windowStart: now },
      });
    return false;
  }
  if (row.count >= maxCount) return true;
  await db
    .update(telegramRateLimitsTable)
    .set({ count: row.count + 1 })
    .where(
      and(
        eq(telegramRateLimitsTable.telegramId, telegramId),
        eq(telegramRateLimitsTable.bucket, bucket)
      )
    );
  return false;
}

// ─── Role helper ──────────────────────────────────────────────────────────────
const ROLE_LEVEL: Record<string, number> = { viewer: 0, operator: 1, admin: 2 };

function hasRole(user: TelegramUser | null, minRole: "viewer" | "operator" | "admin"): boolean {
  if (!user || user.status !== "approved") return false;
  return (ROLE_LEVEL[user.role] ?? 0) >= (ROLE_LEVEL[minRole] ?? 0);
}

// ─── Security middleware ───────────────────────────────────────────────────────
// Returns { ok: true, user } if the request should proceed, { ok: false } if rejected.
async function runMiddleware(
  instance: TelegramBot,
  chatId: number,
  telegramId: number,
  username: string | undefined,
  command: string,
  args: string,
  opts: { skipAuthCheck?: boolean } = {}
): Promise<{ ok: boolean; user: TelegramUser | null }> {
  const cfg = await getConfig();

  // 1. Whitelist check — silent generic rejection
  if (cfg?.whitelistEnabled) {
    if (!username) {
      await audit(telegramId, username, command, args, "denied", "whitelist:no_username");
      await instance.sendMessage(chatId, "This bot is not available.");
      return { ok: false, user: null };
    }
    const [wl] = await db
      .select()
      .from(telegramWhitelistTable)
      .where(eq(telegramWhitelistTable.telegramUsername, username));
    if (!wl) {
      await audit(telegramId, username, command, args, "denied", "whitelist:not_listed");
      await instance.sendMessage(chatId, "This bot is not available.");
      return { ok: false, user: null };
    }
  }

  const user = await getUser(telegramId);

  // 2. Lockout check
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    await audit(telegramId, username, command, args, "denied", "locked");
    await instance.sendMessage(chatId, "Your account is temporarily locked. Please try again later.");
    return { ok: false, user: null };
  }

  // 3. Suspension check
  if (user?.status === "suspended") {
    await audit(telegramId, username, command, args, "denied", "suspended");
    await instance.sendMessage(chatId, "Your account has been suspended. Please contact your administrator.");
    return { ok: false, user: null };
  }

  // 4. Session expiry check (only for approved users, skip during registration flow)
  if (!opts.skipAuthCheck && user?.sessionExpiresAt && user.sessionExpiresAt < new Date() && user.status === "approved") {
    await db
      .update(telegramUsersTable)
      .set({ status: "pending", sessionExpiresAt: null })
      .where(eq(telegramUsersTable.telegramId, telegramId));
    await clearSession(telegramId);
    await audit(telegramId, username, command, args, "denied", "session_expired");
    await instance.sendMessage(chatId, "Your session has expired. Please /register again to request access.");
    return { ok: false, user: null };
  }

  // 5. Rate limit check (command bucket)
  const maxCpm = cfg?.maxCommandsPerMinute ?? 10;
  const limited = await checkRateLimit(telegramId, "command", maxCpm, 60);
  if (limited) {
    await audit(telegramId, username, command, args, "rate_limited", "command_bucket");
    await instance.sendMessage(chatId, "You are sending commands too quickly. Please wait a moment.");
    // Increment failed_attempts on repeated rate limit hits
    if (user) {
      await db
        .update(telegramUsersTable)
        .set({ failedAttempts: user.failedAttempts + 1 })
        .where(eq(telegramUsersTable.telegramId, telegramId));
    }
    return { ok: false, user: null };
  }

  // Touch last_active_at
  if (user) {
    await db
      .update(telegramUsersTable)
      .set({ lastActiveAt: new Date() })
      .where(eq(telegramUsersTable.telegramId, telegramId));
  }

  return { ok: true, user };
}

// Helper: increment failed_attempts and lock if threshold exceeded
async function handleFailedAttempt(user: TelegramUser, cfg: TelegramConfig | null): Promise<void> {
  const maxAttempts = cfg?.maxFailedAttempts ?? 5;
  const lockoutMins = cfg?.lockoutMinutes ?? 60;
  const newCount = user.failedAttempts + 1;
  const lockedUntil = newCount >= maxAttempts
    ? new Date(Date.now() + lockoutMins * 60_000)
    : null;
  await db
    .update(telegramUsersTable)
    .set({ failedAttempts: newCount, lockedUntil: lockedUntil ?? undefined })
    .where(eq(telegramUsersTable.telegramId, user.telegramId));
}

// ─── Message handler ──────────────────────────────────────────────────────────
function registerHandlers(instance: TelegramBot): void {
  instance.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id;
    if (!telegramId || msg.chat.type !== "private") return;

    const rawText = (msg.text ?? "").trim();

    // Reject messages with dangerous chars before anything else
    if (hasInvalidChars(rawText)) return;

    try {
      const session = await getSession(telegramId);

      // ── Registration state machine (partial middleware — skip auth check) ──
      if (session.state === "awaiting_name") {
        const mw = await runMiddleware(instance, chatId, telegramId, msg.from?.username, "input:name", "", { skipAuthCheck: true });
        if (!mw.ok) return;
        await handleAwaitingName(instance, chatId, telegramId, msg.from?.username, rawText);
        return;
      }
      if (session.state === "awaiting_email") {
        const mw = await runMiddleware(instance, chatId, telegramId, msg.from?.username, "input:email", "", { skipAuthCheck: true });
        if (!mw.ok) return;
        await handleAwaitingEmail(instance, chatId, telegramId, rawText, session.context as Record<string, string> | null);
        return;
      }

      // ── Parse command ──
      const parts = rawText.split(/\s+/);
      const cmd = (parts[0] ?? "").toLowerCase().replace(/@\S+$/, "");
      const args = parts.slice(1).join(" ");

      // /help is always available — no middleware
      if (cmd === "/help") {
        await handleHelp(instance, chatId, telegramId, msg.from?.username);
        return;
      }

      // /start or /register: partial middleware
      if (cmd === "/start" || cmd === "/register") {
        const mw = await runMiddleware(instance, chatId, telegramId, msg.from?.username, cmd, args, { skipAuthCheck: true });
        if (!mw.ok) return;
        await handleRegister(instance, chatId, telegramId, msg.from?.username, mw.user);
        return;
      }

      // /status: light auth — only need to be registered (any status)
      if (cmd === "/status") {
        const mw = await runMiddleware(instance, chatId, telegramId, msg.from?.username, cmd, args);
        if (!mw.ok) return;
        await handleStatus(instance, chatId, mw.user);
        return;
      }

      // /alerts: viewer role or higher
      if (cmd === "/alerts") {
        const mw = await runMiddleware(instance, chatId, telegramId, msg.from?.username, cmd, args);
        if (!mw.ok) return;
        if (!hasRole(mw.user, "viewer")) {
          await audit(telegramId, msg.from?.username, cmd, args, "denied", "insufficient_role");
          await instance.sendMessage(chatId, "❌ You are not authorized to use this command.");
          if (mw.user) await handleFailedAttempt(mw.user, await getConfig());
          return;
        }
        await audit(telegramId, msg.from?.username, cmd, args, "success", "");
        await handleAlerts(instance, chatId);
        return;
      }

      // /checkbalance: operator role or higher
      if (cmd === "/checkbalance") {
        const mw = await runMiddleware(instance, chatId, telegramId, msg.from?.username, cmd, args);
        if (!mw.ok) return;
        if (!hasRole(mw.user, "operator")) {
          await audit(telegramId, msg.from?.username, cmd, args, "denied", "insufficient_role");
          await instance.sendMessage(chatId, "❌ You are not authorized to use this command.");
          if (mw.user) await handleFailedAttempt(mw.user, await getConfig());
          return;
        }
        const q = sanitize(args, 100) || null;
        await audit(telegramId, msg.from?.username, cmd, q ?? "", "success", "");
        await handleCheckBalance(instance, chatId, telegramId, q);
        return;
      }

      // Unknown command
      await instance.sendMessage(chatId, "Use /help to see available commands.");
    } catch (err) {
      logger.error({ err, telegramId }, "Bot message handler error");
    }
  });

  instance.on("callback_query", async (query) => {
    const telegramId = query.from.id;
    const chatId = query.message?.chat.id;
    if (!chatId) return;
    try {
      await instance.answerCallbackQuery(query.id);
      const data = query.data ?? "";
      if (data.startsWith("balance:")) {
        const user = await getUser(telegramId);
        if (!hasRole(user, "operator")) {
          await instance.sendMessage(chatId, "❌ Not authorized.");
          return;
        }
        const metric = data.slice("balance:".length);
        await sendClientBalance(instance, chatId, telegramId, metric);
      }
    } catch (err) {
      logger.error({ err, telegramId }, "Bot callback_query handler error");
    }
  });

  instance.on("polling_error", (err) => {
    logger.error({ err }, "Telegram bot polling error — will retry in 60 s");
    if (_restartTimer) return;
    _restartTimer = setTimeout(async () => {
      _restartTimer = null;
      if (bot === instance && _connected) {
        try {
          await instance.startPolling({ restart: true });
          logger.info("Telegram bot polling restarted");
        } catch (e) {
          logger.error({ e }, "Failed to restart Telegram bot polling");
        }
      }
    }, 60_000);
  });
}

// ─── Command handlers ─────────────────────────────────────────────────────────
async function handleRegister(
  instance: TelegramBot,
  chatId: number,
  telegramId: number,
  username: string | undefined,
  existingUser: TelegramUser | null
) {
  if (existingUser?.status === "approved") {
    await instance.sendMessage(chatId, "✅ You are already registered and approved. Use /help to see available commands.");
    return;
  }
  if (existingUser?.status === "pending") {
    await instance.sendMessage(chatId, "⏳ Your registration is pending admin review. You will be notified once approved.");
    return;
  }

  // Registration rate limit (3 per day)
  const cfg = await getConfig();
  const maxReg = cfg?.maxRegistrationsPerDay ?? 3;
  const regLimited = await checkRateLimit(telegramId, "register", maxReg, 86400);
  if (regLimited) {
    await audit(telegramId, username, "/register", "", "rate_limited", "register_bucket");
    await instance.sendMessage(chatId, "You have exceeded the maximum registration attempts for today. Please try again tomorrow.");
    return;
  }

  await setSession(telegramId, "awaiting_name", username ? { username } : {});
  await instance.sendMessage(chatId, "👋 Welcome! Let's get you registered.\n\nWhat is your full name?");
}

async function handleAwaitingName(
  instance: TelegramBot,
  chatId: number,
  telegramId: number,
  username: string | undefined,
  rawName: string
) {
  if (!rawName) {
    await instance.sendMessage(chatId, "Please enter your full name.");
    return;
  }
  const name = sanitize(rawName, 200);
  if (!name) {
    await instance.sendMessage(chatId, "Name contains invalid characters. Please try again.");
    return;
  }
  await setSession(telegramId, "awaiting_email", { name, username: username ?? "" });
  await instance.sendMessage(chatId, `Thanks, ${h(name)}! What is your work email address?`);
}

async function handleAwaitingEmail(
  instance: TelegramBot,
  chatId: number,
  telegramId: number,
  rawEmail: string,
  context: Record<string, string> | null
) {
  const email = sanitize(rawEmail, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    await instance.sendMessage(chatId, "That doesn't look like a valid email address. Please try again.");
    return;
  }
  const name = context?.name ?? "Unknown";
  const username = context?.username || undefined;

  await db
    .insert(telegramUsersTable)
    .values({ telegramId, telegramUsername: username ?? null, name, email, status: "pending" })
    .onConflictDoUpdate({
      target: telegramUsersTable.telegramId,
      set: { telegramUsername: username ?? null, name, email, status: "pending", requestedAt: new Date() },
    });

  await clearSession(telegramId);
  await audit(telegramId, username, "/register", email, "success", "registration_submitted");
  await instance.sendMessage(
    chatId,
    "✅ Registration request submitted!\n\nAn administrator will review your request and you'll be notified here once approved."
  );
}

async function handleAlerts(instance: TelegramBot, chatId: number) {
  const { entries } = getBalanceCache();
  const active = entries.filter((e) => e.severity !== "ok").slice(0, 10);

  if (active.length === 0) {
    await instance.sendMessage(chatId, "✅ All client balances are currently OK.");
    return;
  }

  const lines = active.map((e) => {
    const emoji = { warning: "🟡", critical: "🔴", emergency: "🚨" }[e.severity] ?? "⚠️";
    return `${emoji} <b>${h(e.metric)}</b>\nBalance: ${h(fmtBalance(e.remainingBalance))}\nEst. Days: ${h(e.daysRemaining >= 0 ? e.daysRemaining.toFixed(1) : "—")}\nStatus: <b>${h(e.severity.toUpperCase())}</b>`;
  });

  await instance.sendMessage(chatId, lines.join("\n\n"), { parse_mode: "HTML" });
}

async function handleCheckBalance(
  instance: TelegramBot,
  chatId: number,
  telegramId: number,
  clientName: string | null
) {
  const { entries, lastUpdated } = getBalanceCache();

  if (entries.length === 0) {
    await instance.sendMessage(chatId, "⚠️ Balance data is not yet loaded. Check back in a moment.");
    return;
  }

  if (clientName) {
    const q = clientName.toLowerCase();
    const matches = entries.filter((e) => e.metric.toLowerCase().includes(q));
    if (matches.length === 0) {
      await instance.sendMessage(chatId, `No client found matching <code>${h(clientName)}</code>. Use /checkbalance without arguments to browse all clients.`, { parse_mode: "HTML" });
      return;
    }
    if (matches.length === 1) {
      await sendClientBalance(instance, chatId, telegramId, matches[0].metric);
      return;
    }
    const keyboard = chunkArray(matches, 2).map((row) =>
      row.map((m) => ({ text: m.metric.slice(0, 30), callback_data: `balance:${m.metric.slice(0, 55)}` }))
    );
    await instance.sendMessage(chatId, `Found ${matches.length} matches. Select one:`, {
      reply_markup: { inline_keyboard: keyboard },
    });
    return;
  }

  // No argument — paginated inline keyboard
  const PAGE_SIZE = 8;
  const page1 = entries.slice(0, PAGE_SIZE);
  const keyboard = chunkArray(page1, 2).map((row) =>
    row.map((m) => ({ text: m.metric.slice(0, 30), callback_data: `balance:${m.metric.slice(0, 55)}` }))
  );
  const suffix = entries.length > PAGE_SIZE ? `\n\nShowing ${PAGE_SIZE} of ${entries.length} clients. Search by name: /checkbalance {name}` : "";
  await instance.sendMessage(chatId, `Select a client to check balance:${suffix}`, {
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function sendClientBalance(
  instance: TelegramBot,
  chatId: number,
  telegramId: number,
  metric: string
) {
  const { entries, lastUpdated } = getBalanceCache();
  const entry = entries.find((e) => e.metric === metric || e.metric.startsWith(metric));
  await clearSession(telegramId);

  if (!entry) {
    await instance.sendMessage(chatId, `No balance data found for <code>${h(metric)}</code>.`, { parse_mode: "HTML" });
    return;
  }

  const updatedStr = lastUpdated
    ? lastUpdated.toLocaleString("en-SA", { timeZone: "Asia/Riyadh" })
    : "Unknown";
  const emoji = { ok: "🟢", warning: "🟡", critical: "🔴", emergency: "🚨" }[entry.severity] ?? "⚪";
  const days = entry.daysRemaining >= 0 ? entry.daysRemaining.toFixed(1) : "—";

  await instance.sendMessage(
    chatId,
    `${emoji} <b>${h(entry.metric)}</b>\nBalance: ${h(fmtBalance(entry.remainingBalance))}\nEst. Days: ${h(days)}\nStatus: <b>${h(entry.severity.toUpperCase())}</b>\nLast updated: ${h(updatedStr)}`,
    { parse_mode: "HTML" }
  );
}

async function handleStatus(instance: TelegramBot, chatId: number, user: TelegramUser | null) {
  if (!user) {
    await instance.sendMessage(chatId, "You are not registered. Use /register to request access.");
    return;
  }
  const expiry = user.sessionExpiresAt
    ? user.sessionExpiresAt.toLocaleDateString("en-SA", { timeZone: "Asia/Riyadh" })
    : "N/A";
  const lastActive = user.lastActiveAt
    ? timeAgo(user.lastActiveAt)
    : "Never";
  const statusEmoji = { approved: "✅", pending: "⏳", rejected: "❌", suspended: "🚫" }[user.status] ?? "❓";
  await instance.sendMessage(
    chatId,
    `${statusEmoji} <b>Account Status</b>\n\nName: ${h(user.name)}\nRole: <b>${h(user.role)}</b>\nStatus: <b>${h(user.status)}</b>\nSession expires: ${h(expiry)}\nLast active: ${h(lastActive)}`,
    { parse_mode: "HTML" }
  );
}

async function handleHelp(
  instance: TelegramBot,
  chatId: number,
  telegramId: number,
  username?: string
) {
  const user = await getUser(telegramId);
  const cmds: string[] = ["/register — Request access", "/status — View your account status", "/help — Show this message"];
  if (hasRole(user, "viewer")) cmds.push("/alerts — View active balance alerts");
  if (hasRole(user, "operator")) cmds.push("/checkbalance — Check a client's balance\n/checkbalance {name} — Search by client name");
  await instance.sendMessage(chatId, `📋 <b>Available Commands</b>\n\n${cmds.join("\n")}`, { parse_mode: "HTML" });
}

// ─── Session helpers ──────────────────────────────────────────────────────────
async function getSession(telegramId: number) {
  const [row] = await db
    .select()
    .from(telegramSessionsTable)
    .where(eq(telegramSessionsTable.telegramId, telegramId));
  return row ?? { telegramId, state: "idle", context: null, updatedAt: new Date() };
}

async function setSession(telegramId: number, state: string, context?: Record<string, string>) {
  await db
    .insert(telegramSessionsTable)
    .values({ telegramId, state, context: context ?? null, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: telegramSessionsTable.telegramId,
      set: { state, context: context ?? null, updatedAt: new Date() },
    });
}

async function clearSession(telegramId: number) {
  await setSession(telegramId, "idle");
}

async function getUser(telegramId: number): Promise<TelegramUser | null> {
  const [row] = await db
    .select()
    .from(telegramUsersTable)
    .where(eq(telegramUsersTable.telegramId, telegramId));
  return row ?? null;
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 24) return `${Math.floor(h / 24)}d ago`;
  if (h > 0) return `${h}h ${m}m ago`;
  return `${m}m ago`;
}

function fmtBalance(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)} K`;
  return n.toFixed(0);
}

function h(text: string): string {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
