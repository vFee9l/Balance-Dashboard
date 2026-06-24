import { pgTable, text, serial, boolean, varchar, timestamp, integer } from "drizzle-orm/pg-core";

export const telegramConfigTable = pgTable("telegram_config", {
  id: serial("id").primaryKey(),
  botTokenEnc: text("bot_token_enc").notNull().default(""),
  botUsername: varchar("bot_username", { length: 100 }),
  enabled: boolean("enabled").notNull().default(true),
  whitelistEnabled: boolean("whitelist_enabled").notNull().default(false),
  requireApproval: boolean("require_approval").notNull().default(true),
  sessionExpiryDays: integer("session_expiry_days").notNull().default(30),
  maxFailedAttempts: integer("max_failed_attempts").notNull().default(5),
  lockoutMinutes: integer("lockout_minutes").notNull().default(60),
  maxCommandsPerMinute: integer("max_commands_per_minute").notNull().default(10),
  maxRegistrationsPerDay: integer("max_registrations_per_day").notNull().default(3),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  updatedBy: varchar("updated_by", { length: 100 }),
});

export type TelegramConfig = typeof telegramConfigTable.$inferSelect;
