import { pgTable, text, serial, boolean, varchar, timestamp } from "drizzle-orm/pg-core";

export const telegramConfigTable = pgTable("telegram_config", {
  id: serial("id").primaryKey(),
  botToken: text("bot_token").notNull(),
  botUsername: varchar("bot_username", { length: 100 }),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  updatedBy: varchar("updated_by", { length: 100 }),
});

export type TelegramConfig = typeof telegramConfigTable.$inferSelect;
