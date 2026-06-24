/**
 * Idempotent database migration script.
 * Safe to run multiple times — every statement uses IF EXISTS / IF NOT EXISTS guards.
 * Usage: pnpm --filter @workspace/scripts run migrate
 */

import pg from "pg";

const { Client } = pg;

if (!process.env["DATABASE_URL"]) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  process.exit(1);
}

const client = new Client({ connectionString: process.env["DATABASE_URL"] });

const migrations: Array<{ label: string; sql: string }> = [
  // ── telegram_config ─────────────────────────────────────────────────────────
  {
    label: "telegram_config: add bot_token_enc column",
    sql: `ALTER TABLE IF EXISTS telegram_config ADD COLUMN IF NOT EXISTS bot_token_enc text NOT NULL DEFAULT ''`,
  },
  {
    label: "telegram_config: drop legacy bot_token column",
    sql: `ALTER TABLE IF EXISTS telegram_config DROP COLUMN IF EXISTS bot_token`,
  },
  {
    label: "telegram_config: add whitelist_enabled",
    sql: `ALTER TABLE IF EXISTS telegram_config ADD COLUMN IF NOT EXISTS whitelist_enabled boolean NOT NULL DEFAULT false`,
  },
  {
    label: "telegram_config: fix whitelist_enabled type (non-boolean → boolean)",
    sql: `
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'telegram_config'
            AND column_name = 'whitelist_enabled'
            AND data_type NOT IN ('boolean')
        ) THEN
          ALTER TABLE telegram_config
            ALTER COLUMN whitelist_enabled TYPE boolean
            USING whitelist_enabled::boolean;
        END IF;
      END $$
    `,
  },
  {
    label: "telegram_config: add require_approval",
    sql: `ALTER TABLE IF EXISTS telegram_config ADD COLUMN IF NOT EXISTS require_approval boolean NOT NULL DEFAULT true`,
  },
  {
    label: "telegram_config: add session_expiry_days",
    sql: `ALTER TABLE IF EXISTS telegram_config ADD COLUMN IF NOT EXISTS session_expiry_days integer NOT NULL DEFAULT 30`,
  },
  {
    label: "telegram_config: add max_failed_attempts",
    sql: `ALTER TABLE IF EXISTS telegram_config ADD COLUMN IF NOT EXISTS max_failed_attempts integer NOT NULL DEFAULT 5`,
  },
  {
    label: "telegram_config: add lockout_minutes",
    sql: `ALTER TABLE IF EXISTS telegram_config ADD COLUMN IF NOT EXISTS lockout_minutes integer NOT NULL DEFAULT 60`,
  },
  {
    label: "telegram_config: add max_commands_per_minute",
    sql: `ALTER TABLE IF EXISTS telegram_config ADD COLUMN IF NOT EXISTS max_commands_per_minute integer NOT NULL DEFAULT 10`,
  },
  {
    label: "telegram_config: add max_registrations_per_day",
    sql: `ALTER TABLE IF EXISTS telegram_config ADD COLUMN IF NOT EXISTS max_registrations_per_day integer NOT NULL DEFAULT 3`,
  },
  {
    label: "telegram_config: add updated_by",
    sql: `ALTER TABLE IF EXISTS telegram_config ADD COLUMN IF NOT EXISTS updated_by varchar(100)`,
  },

  // ── telegram_users ───────────────────────────────────────────────────────────
  {
    label: "telegram_users: add role column",
    sql: `ALTER TABLE IF EXISTS telegram_users ADD COLUMN IF NOT EXISTS role varchar(20) NOT NULL DEFAULT 'viewer'`,
  },
  {
    label: "telegram_users: add suspended_at",
    sql: `ALTER TABLE IF EXISTS telegram_users ADD COLUMN IF NOT EXISTS suspended_at timestamptz`,
  },
  {
    label: "telegram_users: add suspended_reason",
    sql: `ALTER TABLE IF EXISTS telegram_users ADD COLUMN IF NOT EXISTS suspended_reason varchar(500)`,
  },
  {
    label: "telegram_users: add failed_attempts",
    sql: `ALTER TABLE IF EXISTS telegram_users ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0`,
  },
  {
    label: "telegram_users: add locked_until",
    sql: `ALTER TABLE IF EXISTS telegram_users ADD COLUMN IF NOT EXISTS locked_until timestamptz`,
  },
  {
    label: "telegram_users: add last_active_at",
    sql: `ALTER TABLE IF EXISTS telegram_users ADD COLUMN IF NOT EXISTS last_active_at timestamptz`,
  },
  {
    label: "telegram_users: add session_expires_at",
    sql: `ALTER TABLE IF EXISTS telegram_users ADD COLUMN IF NOT EXISTS session_expires_at timestamptz`,
  },
  {
    label: "telegram_users: create status index",
    sql: `CREATE INDEX IF NOT EXISTS idx_telegram_users_status ON telegram_users(status)`,
  },

  // ── telegram_audit_log ───────────────────────────────────────────────────────
  {
    label: "create telegram_audit_log table",
    sql: `
      CREATE TABLE IF NOT EXISTS telegram_audit_log (
        id        bigserial PRIMARY KEY,
        telegram_id bigint,
        username  varchar(100),
        command   varchar(200),
        args      text,
        result    varchar(50),
        detail    text,
        created_at timestamptz NOT NULL DEFAULT NOW()
      )
    `,
  },
  {
    label: "telegram_audit_log: index on telegram_id",
    sql: `CREATE INDEX IF NOT EXISTS idx_telegram_audit_id ON telegram_audit_log(telegram_id)`,
  },
  {
    label: "telegram_audit_log: index on created_at",
    sql: `CREATE INDEX IF NOT EXISTS idx_telegram_audit_time ON telegram_audit_log(created_at)`,
  },

  // ── telegram_rate_limits ─────────────────────────────────────────────────────
  {
    label: "create telegram_rate_limits table",
    sql: `
      CREATE TABLE IF NOT EXISTS telegram_rate_limits (
        telegram_id  bigint      NOT NULL,
        bucket       varchar(50) NOT NULL,
        count        integer     NOT NULL DEFAULT 0,
        window_start timestamptz NOT NULL DEFAULT NOW(),
        PRIMARY KEY (telegram_id, bucket)
      )
    `,
  },

  // ── telegram_whitelist ───────────────────────────────────────────────────────
  {
    label: "create telegram_whitelist table",
    sql: `
      CREATE TABLE IF NOT EXISTS telegram_whitelist (
        id                serial PRIMARY KEY,
        telegram_username varchar(100) UNIQUE NOT NULL,
        added_by          varchar(100),
        added_at          timestamptz DEFAULT NOW(),
        note              text
      )
    `,
  },
];

async function main(): Promise<void> {
  await client.connect();
  console.log("✔ Connected to database. Applying migrations…\n");

  let applied = 0;
  let skipped = 0;

  for (const { label, sql } of migrations) {
    try {
      await client.query(sql.trim());
      console.log(`  ✓  ${label}`);
      applied++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Ignore "already exists" type errors — they mean the migration already ran
      if (
        msg.includes("already exists") ||
        msg.includes("duplicate column") ||
        msg.includes("does not exist")
      ) {
        console.log(`  –  ${label} (skipped: ${msg.split("\n")[0]})`);
        skipped++;
      } else {
        console.error(`  ✗  ${label}\n     ${msg}`);
        await client.end();
        process.exit(1);
      }
    }
  }

  await client.end();
  console.log(`\n✔ Done — ${applied} applied, ${skipped} already up-to-date.`);
}

main();
