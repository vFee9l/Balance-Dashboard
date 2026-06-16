---
name: Telegram Bot integration
description: Architecture and separation between the interactive bot and the broadcast channel
---

The system has two separate Telegram integrations:

1. **Broadcast channel** (`settings.telegramBotToken` + `settings.telegramChatId`) — sends one-way alert messages to a group/channel. Controlled via the "Telegram Channel" card on the Settings page.

2. **Interactive bot** (`telegram_config` table) — two-way bot with user registration, /checkbalance, /alerts commands. Controlled via the "Telegram Bot" card on Settings page (PUT /api/settings/telegram).

**Why:** The admin may want the same or different tokens. Keeping them separate avoids coupling the broadcast notification flow with the interactive bot lifecycle.

**How to apply:** When the admin saves a bot token via Settings → Telegram Bot card, the server calls `startBot(token)` which validates via `getMe()`, stores the result in `telegram_config`, and starts polling. On server restart, `index.ts` reads `telegram_config` and auto-starts the bot if enabled.

**Balance cache:** `artifacts/api-server/src/lib/balanceCache.ts` — populated by the `/api/grafana/balances` route handler after each fetch. The bot's `/checkbalance` reads from this cache; if empty (no dashboard load yet), tells the user to open the dashboard first.

**Tables:** `telegram_config` (single row, id=1), `telegram_users` (registrations, status: pending/approved/rejected), `telegram_sessions` (conversation state machine).

**Frontend:** Bot Users page at `/bot-users`, pending count badge polls `/api/telegram/users/pending/count` every 30s.
