# Balance Alert System

A real-time SMS credit balance monitoring and alert system that reads from Grafana dashboards and sends notifications via SMS, SMTP, and Telegram when client balances drop below configurable thresholds.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/balance-alerts run dev` — run the frontend (port 24672)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS + shadcn/ui + wouter
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `lib/db/src/schema/` — DB schema: contacts.ts, settings.ts, alertHistory.ts, clientDailyConsumption.ts
- `artifacts/api-server/src/routes/` — Express routes: contacts, settings, grafana, alertHistory
- `artifacts/api-server/src/lib/scheduler.ts` — Scheduled alert runner
- `artifacts/balance-alerts/src/` — React frontend

## Architecture decisions

- Grafana data is fetched via `/api/ds/query` using the MSSQL datasource `af0fc2y09shdsd` (RICH-PRIMERY-133-Support) which reads from `reportag4-25` database
- Dashboard UID for Clients Consumption: `mo5lfpf`
- OTP is stored in the `settings` table (default: `123456`) — change via the Settings page after unlocking
- Alert thresholds: <20 days → staff+managers+MD (warning), <15 days → managers+MD (critical), <5 days → MD only (emergency)
- Settings page is OTP-gated; the OTP is a simple string stored in the DB (not TOTP)
- The scheduler runs daily at the configured hour and triggers the same logic as the manual trigger

## Product

- **Dashboard**: Real-time view of all client SMS credit balances pulled from Grafana, with severity status (OK/Warning/Critical/Emergency) and summary stats
- **Contacts**: Full CRUD roster for staff/manager/MD contacts who receive alerts
- **History**: Log of all past alert sends (channel, recipients, success/fail)
- **Settings (OTP-protected)**: Configure Grafana connection, SMS API, SMTP, Telegram, schedule, and thresholds

## User preferences

- No database link — reads from Grafana dashboards only for balance data
- Contacts stored in local DB (contacts table) instead of Google Sheets
- Settings page requires OTP access (default OTP: 123456)
- Both scheduled (daily) and manual alert triggers

## Security / Auth

- The whole dashboard requires TOTP login when `totpEnabled = true` in settings
- Login flow: `/api/auth/check` → if `requiresAuth && !authenticated` → show login page
- After entering TOTP → session cookie set (8 h TTL) → full access granted
- Logout button in sidebar clears the session
- Settings page still has a separate TOTP gate for making changes
- All API routes except `/api/healthz` and `/api/auth/*` are protected when TOTP is enabled
- Session secret from `SESSION_SECRET` env var

## Dashboard Features

- **Auto-refresh**: dropdown selector (Off / 30s / 1 min / 5 min / 10 min) with last-updated timestamp
- **Manual refresh**: refresh button next to the auto-refresh selector
- **Org filter**: search box to filter clients by name
- **Status filter**: dropdown (All / OK / Warning / Critical / Emergency)
- **Live severity counts**: Warning / Critical / Emergency cards now show the current live count from balance data, not historical alert history
- **Daily Δ column**: day-over-day % change badge (yesterday vs day-before-yesterday); red = consumption up, green = down; hover for full consumption study breakdown
- **Est. Days tooltip**: hover the Est. Days value to compare prev-month rate vs last-7-day rate side by side
- **Click-to-chart**: clicking any client row opens a consumption history dialog (bar chart, current month vs previous month same period)
- **DB snapshot**: each balance fetch upserts yesterday's consumption + % change into `client_daily_consumption` table, building a rolling monthly history per client

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `lib/api-spec/openapi.yaml`
- The Grafana API key is stored masked (shown as `***`) — re-enter it to update
- SMS/Telegram credentials are masked on read; re-enter to update
- The `daysRemaining` for clients with zero balance will show 0 days (EMERGENCY) — this is correct behavior

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Grafana datasource UID: `af0fc2y09shdsd` (MSSQL, database: `reportag4-25`)
