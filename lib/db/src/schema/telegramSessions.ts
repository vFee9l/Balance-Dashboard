import { pgTable, bigint, varchar, jsonb, timestamp } from "drizzle-orm/pg-core";

export const telegramSessionsTable = pgTable("telegram_sessions", {
  telegramId: bigint("telegram_id", { mode: "number" }).primaryKey(),
  state: varchar("state", { length: 50 }).notNull().default("idle"),
  context: jsonb("context"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type TelegramSession = typeof telegramSessionsTable.$inferSelect;
