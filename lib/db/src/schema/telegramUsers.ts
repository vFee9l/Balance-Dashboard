import { pgTable, serial, bigint, varchar, timestamp, integer, index } from "drizzle-orm/pg-core";

export const telegramUsersTable = pgTable("telegram_users", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).unique().notNull(),
  telegramUsername: varchar("telegram_username", { length: 100 }),
  name: varchar("name", { length: 200 }).notNull(),
  email: varchar("email", { length: 200 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  role: varchar("role", { length: 20 }).notNull().default("viewer"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: varchar("reviewed_by", { length: 100 }),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspendedReason: varchar("suspended_reason", { length: 500 }),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  sessionExpiresAt: timestamp("session_expires_at", { withTimezone: true }),
}, (t) => [
  index("idx_telegram_users_status").on(t.status),
]);

export type TelegramUser = typeof telegramUsersTable.$inferSelect;
