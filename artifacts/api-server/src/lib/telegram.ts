import { logger } from "./logger.js";

const INVISIBLE_UNICODE_RE =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g;

export function sanitizeTelegramSetting(value: string | null | undefined): string | null | undefined {
  return value?.replace(INVISIBLE_UNICODE_RE, "").trim();
}

export type TelegramChannelSettings = {
  id?: number;
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
  const botToken = sanitizeTelegramSetting(settings.telegramBotToken);
  const channelId = sanitizeTelegramSetting(settings.telegramChatId);

  if (!botToken || botToken === "***") {
    return { ok: false, error: "Telegram bot token is not configured." };
  }
  if (!channelId) {
    return { ok: false, error: "Telegram channel ID is not configured." };
  }

  try {
    logger.info(
      {
        settingsId: settings.id,
        channelId,
        channelIdLength: channelId.length,
        channelIdUtf8Hex: Buffer.from(channelId, "utf8").toString("hex"),
        channelIdSanitized: settings.telegramChatId !== channelId,
        tokenLength: botToken.length,
        tokenSanitized: settings.telegramBotToken !== botToken,
      },
      "Sending Telegram channel message",
    );

    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: channelId,
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
      logger.warn({ status: response.status, apiCode, channelId, reason }, "Telegram message failed");
      return { ok: false, error };
    }

    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn({ err: error, channelId }, "Telegram message request failed");
    return { ok: false, error: `Unable to reach the Telegram API: ${reason}` };
  }
}