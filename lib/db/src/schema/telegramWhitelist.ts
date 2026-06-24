import { pgTable, serial, varchar, timestamp, text } from "drizzle-orm/pg-core";

export const telegramWhitelistTable = pgTable("telegram_whitelist", {
  id: serial("id").primaryKey(),
  telegramUsername: varchar("telegram_username", { length: 100 }).unique().notNull(),
  addedBy: varchar("added_by", { length: 100 }),
  addedAt: timestamp("added_at", { withTimezone: true }).defaultNow(),
  note: text("note"),
});

export type TelegramWhitelist = typeof telegramWhitelistTable.$inferSelect;
