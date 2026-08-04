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
  // ── telegram_config: create from scratch (new installs) ─────────────────────
  // Uses INTEGER PRIMARY KEY, not serial, so the PK constraint is always explicit.
  {
    label: "telegram_config: create table with full schema",
    sql: `
      CREATE TABLE IF NOT EXISTS telegram_config (
        id                        integer PRIMARY KEY DEFAULT 1,
        bot_token_enc             text        NOT NULL DEFAULT '',
        bot_username              varchar(100),
        enabled                   boolean     NOT NULL DEFAULT true,
        whitelist_enabled         boolean     NOT NULL DEFAULT false,
        require_approval          boolean     NOT NULL DEFAULT true,
        session_expiry_days       integer     NOT NULL DEFAULT 30,
        max_failed_attempts       integer     NOT NULL DEFAULT 5,
        lockout_minutes           integer     NOT NULL DEFAULT 60,
        max_commands_per_minute   integer     NOT NULL DEFAULT 10,
        max_registrations_per_day integer     NOT NULL DEFAULT 3,
        updated_at                timestamptz          DEFAULT NOW(),
        updated_by                varchar(100),
        CONSTRAINT telegram_config_singleton CHECK (id = 1)
      )
    `,
  },

  // ── telegram_config: repair PRIMARY KEY on existing installs ─────────────────
  // Old drizzle-kit migrations may have created the table without a PK, which
  // causes ON CONFLICT (id) to fail with "no unique or exclusion constraint".
  {
    label: "telegram_config: repair — ensure PRIMARY KEY on id",
    sql: `
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_name = 'telegram_config' AND constraint_type = 'PRIMARY KEY'
        ) THEN
          -- Remove duplicate rows first (keep the one with the largest id value)
          DELETE FROM telegram_config a
          USING telegram_config b
          WHERE a.ctid < b.ctid AND a.id = b.id;
          -- Drop the old serial sequence default if present
          ALTER TABLE telegram_config ALTER COLUMN id DROP DEFAULT;
          -- Add the primary key
          ALTER TABLE telegram_config ADD PRIMARY KEY (id);
          RAISE NOTICE 'Added PRIMARY KEY to telegram_config.id';
        END IF;
      END $$
    `,
  },

  // ── telegram_config: add singleton CHECK constraint if missing ───────────────
  {
    label: "telegram_config: ensure singleton CHECK constraint",
    sql: `
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_name = 'telegram_config'
            AND constraint_name = 'telegram_config_singleton'
        ) THEN
          ALTER TABLE telegram_config
            ADD CONSTRAINT telegram_config_singleton CHECK (id = 1);
        END IF;
      END $$
    `,
  },

  // ── telegram_config: column additions ────────────────────────────────────────
  {
    label: "telegram_config: add bot_token_enc column",
    sql: `ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS bot_token_enc text NOT NULL DEFAULT ''`,
  },
  {
    label: "telegram_config: drop legacy bot_token column",
    sql: `ALTER TABLE IF EXISTS telegram_config DROP COLUMN IF EXISTS bot_token`,
  },
  {
    label: "telegram_config: add whitelist_enabled",
    sql: `ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS whitelist_enabled boolean NOT NULL DEFAULT false`,
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
    sql: `ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS require_approval boolean NOT NULL DEFAULT true`,
  },
  {
    label: "telegram_config: add session_expiry_days",
    sql: `ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS session_expiry_days integer NOT NULL DEFAULT 30`,
  },
  {
    label: "telegram_config: add max_failed_attempts",
    sql: `ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS max_failed_attempts integer NOT NULL DEFAULT 5`,
  },
  {
    label: "telegram_config: add lockout_minutes",
    sql: `ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS lockout_minutes integer NOT NULL DEFAULT 60`,
  },
  {
    label: "telegram_config: add max_commands_per_minute",
    sql: `ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS max_commands_per_minute integer NOT NULL DEFAULT 10`,
  },
  {
    label: "telegram_config: add max_registrations_per_day",
    sql: `ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS max_registrations_per_day integer NOT NULL DEFAULT 3`,
  },
  {
    label: "telegram_config: add updated_by",
    sql: `ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS updated_by varchar(100)`,
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
        id          bigserial   PRIMARY KEY,
        telegram_id bigint,
        username    varchar(100),
        command     varchar(200),
        args        text,
        result      varchar(50),
        detail      text,
        created_at  timestamptz NOT NULL DEFAULT NOW()
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
        id                serial      PRIMARY KEY,
        telegram_username varchar(100) UNIQUE NOT NULL,
        added_by          varchar(100),
        added_at          timestamptz DEFAULT NOW(),
        note              text
      )
    `,
  },

  // ── app_users ────────────────────────────────────────────────────────────────
  {
    label: "create app_users table",
    sql: `
      CREATE TABLE IF NOT EXISTS app_users (
        id              serial       PRIMARY KEY,
        username        varchar(100) UNIQUE NOT NULL,
        email           varchar(200) UNIQUE NOT NULL,
        password_hash   text         NOT NULL,
        role            varchar(20)  NOT NULL DEFAULT 'viewer',
        totp_secret_enc text,
        totp_enabled    boolean      NOT NULL DEFAULT false,
        must_setup_totp boolean      NOT NULL DEFAULT true,
        must_change_pw  boolean      NOT NULL DEFAULT false,
        is_active       boolean      NOT NULL DEFAULT true,
        failed_attempts integer      NOT NULL DEFAULT 0,
        locked_until    timestamptz,
        last_login_at   timestamptz,
        created_at      timestamptz  DEFAULT NOW(),
        created_by      varchar(100)
      )
    `,
  },

  // ── app_user_sessions ─────────────────────────────────────────────────────
  {
    label: "create app_user_sessions table",
    sql: `
      CREATE TABLE IF NOT EXISTS app_user_sessions (
        id            serial    PRIMARY KEY,
        user_id       integer   NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        session_token text      UNIQUE NOT NULL,
        ip_address    varchar(100),
        user_agent    text,
        created_at    timestamptz DEFAULT NOW(),
        expires_at    timestamptz NOT NULL,
        revoked       boolean   NOT NULL DEFAULT false
      )
    `,
  },

  // ── app_login_audit ───────────────────────────────────────────────────────
  {
    label: "create app_login_audit table",
    sql: `
      CREATE TABLE IF NOT EXISTS app_login_audit (
        id         bigserial   PRIMARY KEY,
        username   varchar(100),
        result     varchar(30),
        ip_address varchar(100),
        created_at timestamptz DEFAULT NOW()
      )
    `,
  },
  {
    label: "app_login_audit: index on created_at",
    sql: `CREATE INDEX IF NOT EXISTS idx_app_login_audit_time ON app_login_audit(created_at DESC)`,
  },

  // ── settings: add excluded_orgs column ───────────────────────────────────────
  {
    label: "settings: add excluded_orgs column",
    sql: `ALTER TABLE settings ADD COLUMN IF NOT EXISTS excluded_orgs text`,
  },

  // ── settings: add fallback contacts (no sheet match) ─────────────────────────
  {
    label: "settings: add fallback_sms_numbers column",
    sql: `ALTER TABLE settings ADD COLUMN IF NOT EXISTS fallback_sms_numbers text`,
  },
  {
    label: "settings: add fallback_email_to column",
    sql: `ALTER TABLE settings ADD COLUMN IF NOT EXISTS fallback_email_to text`,
  },
  {
    label: "settings: add fallback_email_cc column",
    sql: `ALTER TABLE settings ADD COLUMN IF NOT EXISTS fallback_email_cc text`,
  },

  // ── settings: add immediate intervention threshold + column routing ──────────
  {
    label: "settings: add threshold_immediate column",
    sql: `ALTER TABLE settings ADD COLUMN IF NOT EXISTS threshold_immediate integer NOT NULL DEFAULT 1`,
  },
  {
    label: "settings: add immediate_sms_cols column",
    sql: `ALTER TABLE settings ADD COLUMN IF NOT EXISTS immediate_sms_cols text`,
  },
  {
    label: "settings: add immediate_email_to_cols column",
    sql: `ALTER TABLE settings ADD COLUMN IF NOT EXISTS immediate_email_to_cols text`,
  },
  {
    label: "settings: add immediate_email_cc_cols column",
    sql: `ALTER TABLE settings ADD COLUMN IF NOT EXISTS immediate_email_cc_cols text`,
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
      // Ignore "already exists" — migration already ran on this DB.
      if (
        msg.includes("already exists") ||
        msg.includes("duplicate column")
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
