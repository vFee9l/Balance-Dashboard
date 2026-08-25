import { logger } from "./logger.js";

export type TelegramChannelSettings = {
  telegramBotToken?: string | null;
  telegramChatId?: string | null;
};

type TelegramApiResponse = {
  ok?: boolean;
  error_code?: number;
  description?: string;
};

export async function sendTelegramMessage(
  message: string,
  settings: TelegramChannelSettings,
): Promise<{ ok: boolean; error?: string }> {
  if (!settings.telegramBotToken || settings.telegramBotToken === "***") {
    return { ok: false, error: "Telegram bot token is not configured." };
  }
  if (!settings.telegramChatId) {
    return { ok: false, error: "Telegram channel ID is not configured." };
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: settings.telegramChatId,
          text: message,
          parse_mode: "HTML",
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    const responseBody = await response.text().catch(() => "");
    let data: TelegramApiResponse = {};
    try {
      data = JSON.parse(responseBody) as TelegramApiResponse;
    } catch {
      // Preserve the HTTP error below when Telegram does not return JSON.
    }

    if (!response.ok || data.ok !== true) {
      const apiCode = data.error_code ?? response.status;
      const reason = data.description || responseBody || `HTTP ${response.status}`;
      const error = `Telegram API ${apiCode}: ${reason}`;
      logger.warn({ status: response.status, apiCode, chatId: settings.telegramChatId, reason }, "Telegram message failed");
      return { ok: false, error };
    }

    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn({ err: error, chatId: settings.telegramChatId }, "Telegram message request failed");
    return { ok: false, error: `Unable to reach the Telegram API: ${reason}` };
  }
}