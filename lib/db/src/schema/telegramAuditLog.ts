import { pgTable, bigserial, bigint, varchar, text, timestamp, index } from "drizzle-orm/pg-core";

export const telegramAuditLogTable = pgTable("telegram_audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }),
  username: varchar("username", { length: 100 }),
  command: varchar("command", { length: 200 }),
  args: text("args"),
  result: varchar("result", { length: 50 }),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_telegram_audit_id").on(t.telegramId),
  index("idx_telegram_audit_time").on(t.createdAt),
]);

export type TelegramAuditLog = typeof telegramAuditLogTable.$inferSelect;
