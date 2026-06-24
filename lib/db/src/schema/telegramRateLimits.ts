import { pgTable, bigint, varchar, integer, timestamp, primaryKey } from "drizzle-orm/pg-core";

export const telegramRateLimitsTable = pgTable("telegram_rate_limits", {
  telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
  bucket: varchar("bucket", { length: 50 }).notNull(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.telegramId, t.bucket] }),
]);

export type TelegramRateLimit = typeof telegramRateLimitsTable.$inferSelect;
