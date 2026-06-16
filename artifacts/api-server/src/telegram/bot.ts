import TelegramBot from "node-telegram-bot-api";
import { db } from "@workspace/db";
import {
  telegramUsersTable,
  telegramSessionsTable,
  alertHistoryTable,
} from "@workspace/db";
import { eq, desc, ne } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { getBalanceCache } from "../lib/balanceCache.js";

let bot: TelegramBot | null = null;
let _botUsername: string | null = null;
let _connected = false;
let _restartTimer: ReturnType<typeof setTimeout> | null = null;

export async function startBot(token: string): Promise<{ username: string }> {
  stopBot();

  const probe = new TelegramBot(token, { polling: false });
  const me = await probe.getMe();
  _botUsername = me.username ?? null;

  bot = new TelegramBot(token, {
    polling: { interval: 300, autoStart: true, params: { timeout: 10 } },
  });
  _connected = true;

  registerHandlers(bot);
  logger.info({ username: _botUsername }, "Telegram bot started");
  return { username: me.username ?? "" };
}

export function stopBot(): void {
  if (_restartTimer) { clearTimeout(_restartTimer); _restartTimer = null; }
  if (bot) {
    try { bot.stopPolling(); } catch (_) { /* ignore */ }
    bot = null;
    _connected = false;
    _botUsername = null;
    logger.info("Telegram bot stopped");
  }
}

export async function sendMessageToUser(telegramId: number, text: string): Promise<void> {
  if (!bot) return;
  try {
    await bot.sendMessage(telegramId, text);
  } catch (err) {
    logger.warn({ err, telegramId }, "Failed to send Telegram message to user");
  }
}

export function getBotStatus(): { connected: boolean; botUsername: string | null } {
  return { connected: _connected, botUsername: _botUsername };
}

function registerHandlers(instance: TelegramBot): void {
  instance.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id;
    if (!telegramId || msg.chat.type !== "private") return;

    const text = (msg.text ?? "").trim();
    try {
      const session = await getSession(telegramId);

      if (session.state === "awaiting_name") {
        await handleAwaitingName(instance, chatId, telegramId, msg.from?.username, text);
        return;
      }
      if (session.state === "awaiting_email") {
        await handleAwaitingEmail(instance, chatId, telegramId, text, session.context as Record<string, string> | null);
        return;
      }

      const cmd = text.split(" ")[0]?.toLowerCase() ?? "";
      if (cmd === "/start" || cmd === "/register") {
        await handleRegister(instance, chatId, telegramId, msg.from?.username);
      } else if (cmd === "/alerts") {
        await handleAlerts(instance, chatId, telegramId);
      } else if (cmd === "/checkbalance") {
        const arg = text.slice("/checkbalance".length).trim();
        await handleCheckBalance(instance, chatId, telegramId, arg || null);
      } else if (cmd === "/help") {
        await handleHelp(instance, chatId);
      } else {
        await instance.sendMessage(chatId, "I didn't understand that. Use /help to see available commands.");
      }
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

async function getUser(telegramId: number) {
  const [row] = await db
    .select()
    .from(telegramUsersTable)
    .where(eq(telegramUsersTable.telegramId, telegramId));
  return row ?? null;
}

async function handleRegister(instance: TelegramBot, chatId: number, telegramId: number, username?: string) {
  const user = await getUser(telegramId);
  if (user?.status === "approved") {
    await instance.sendMessage(chatId, "You are already registered. Use /help to see available commands.");
    return;
  }
  if (user?.status === "pending") {
    await instance.sendMessage(chatId, "⏳ Your registration is still pending admin approval.");
    return;
  }
  await setSession(telegramId, "awaiting_name", username ? { username } : {});
  await instance.sendMessage(chatId, "Welcome! Let's get you registered.\n\nWhat is your full name?");
}

async function handleAwaitingName(instance: TelegramBot, chatId: number, telegramId: number, username: string | undefined, name: string) {
  if (!name) {
    await instance.sendMessage(chatId, "Please enter your full name.");
    return;
  }
  await setSession(telegramId, "awaiting_email", { name, username: username ?? "" });
  await instance.sendMessage(chatId, `Thanks, ${name}! What is your email address?`);
}

async function handleAwaitingEmail(instance: TelegramBot, chatId: number, telegramId: number, email: string, context: Record<string, string> | null) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    await instance.sendMessage(chatId, "That doesn't look like a valid email. Please try again.");
    return;
  }
  const name = context?.name ?? "Unknown";
  const username = context?.username ?? undefined;

  await db
    .insert(telegramUsersTable)
    .values({ telegramId, telegramUsername: username || null, name, email, status: "pending" })
    .onConflictDoUpdate({
      target: telegramUsersTable.telegramId,
      set: { telegramUsername: username || null, name, email, status: "pending", requestedAt: new Date() },
    });

  await clearSession(telegramId);
  await instance.sendMessage(
    chatId,
    "✅ Registration request submitted! An admin will review your request and you'll be notified here once approved."
  );
}

async function handleAlerts(instance: TelegramBot, chatId: number, telegramId: number) {
  const user = await getUser(telegramId);
  if (user?.status !== "approved") {
    await instance.sendMessage(chatId, "❌ You are not authorized. Please /register first.");
    return;
  }

  const alerts = await db
    .select()
    .from(alertHistoryTable)
    .where(ne(alertHistoryTable.severity, "ok"))
    .orderBy(desc(alertHistoryTable.sentAt))
    .limit(20);

  if (alerts.length === 0) {
    await instance.sendMessage(chatId, "✅ No active balance alerts right now.");
    return;
  }

  const seen = new Set<string>();
  const unique = alerts.filter((a) => {
    if (seen.has(a.metric)) return false;
    seen.add(a.metric);
    return true;
  }).slice(0, 10);

  const lines = unique.map((a) =>
    `🔔 *${esc(a.metric)}* — ${a.severity.toUpperCase()}\nDays remaining: ${a.daysRemaining != null ? a.daysRemaining.toFixed(1) : "N/A"}\nLast alerted: ${timeAgo(a.sentAt)}`
  );

  await instance.sendMessage(chatId, lines.join("\n\n"), { parse_mode: "Markdown" });
}

async function handleCheckBalance(instance: TelegramBot, chatId: number, telegramId: number, clientName: string | null) {
  const user = await getUser(telegramId);
  if (user?.status !== "approved") {
    await instance.sendMessage(chatId, "❌ You are not authorized. Please /register first.");
    return;
  }

  const { entries, lastUpdated } = getBalanceCache();

  if (entries.length === 0) {
    await instance.sendMessage(
      chatId,
      "⚠️ Balance data is not yet cached. Open the dashboard to load balance data, then try again."
    );
    return;
  }

  if (clientName) {
    const q = clientName.toLowerCase();
    const matches = entries.filter((e) => e.metric.toLowerCase().includes(q));
    if (matches.length === 0) {
      await instance.sendMessage(chatId, `No client found matching '${clientName}'. Try /checkbalance without arguments to see all clients.`);
      return;
    }
    if (matches.length === 1) {
      await sendClientBalance(instance, chatId, telegramId, matches[0].metric);
      return;
    }
    await instance.sendMessage(chatId, "Multiple clients found. Select one:", {
      reply_markup: {
        inline_keyboard: matches.map((m) => [{ text: m.metric, callback_data: `balance:${m.metric.slice(0, 55)}` }]),
      },
    });
    return;
  }

  await clearSession(telegramId);
  await setSession(telegramId, "selecting_client");
  await instance.sendMessage(chatId, "Select a client to check balance:", {
    reply_markup: {
      inline_keyboard: entries.map((e) => [{ text: e.metric, callback_data: `balance:${e.metric.slice(0, 55)}` }]),
    },
  });
}

async function sendClientBalance(instance: TelegramBot, chatId: number, telegramId: number, metric: string) {
  const { entries, lastUpdated } = getBalanceCache();
  const entry = entries.find((e) => e.metric === metric || e.metric.startsWith(metric));
  await clearSession(telegramId);

  if (!entry) {
    await instance.sendMessage(chatId, `No balance data found for '${metric}'.`);
    return;
  }

  const updatedStr = lastUpdated ? lastUpdated.toLocaleString("en-SA", { timeZone: "Asia/Riyadh" }) : "Unknown";
  const statusEmoji = { ok: "🟢", warning: "🟡", critical: "🔴", emergency: "🚨" }[entry.severity] ?? "⚪";

  const days = entry.daysRemaining >= 0 ? entry.daysRemaining.toFixed(1) : "—";
  await instance.sendMessage(
    chatId,
    `${statusEmoji} <b>${h(entry.metric)}</b>\nBalance: ${h(fmtBalance(entry.remainingBalance))}\nEst. Days: ${h(days)}\nStatus: ${h(entry.severity.toUpperCase())}\nLast updated: ${h(updatedStr)}`,
    { parse_mode: "HTML" }
  );
}

async function handleHelp(instance: TelegramBot, chatId: number) {
  await instance.sendMessage(
    chatId,
    "📋 <b>Available Commands</b>\n\n/register — Request access to the bot\n/alerts — View recent balance alerts\n/checkbalance — Check a client's current balance\n/checkbalance {name} — Check a specific client by name\n/help — Show this message",
    { parse_mode: "HTML" }
  );
}

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 24) return `${Math.floor(h / 24)}d ago`;
  if (h > 0) return `${h}h ago`;
  return `${m}m ago`;
}

function fmtBalance(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)} K`;
  return n.toFixed(0);
}

function esc(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

function h(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
