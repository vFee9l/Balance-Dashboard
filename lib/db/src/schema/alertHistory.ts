import { pgTable, text, serial, timestamp, boolean, integer, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const alertHistoryTable = pgTable("alert_history", {
  id: serial("id").primaryKey(),
  metric: text("metric").notNull(),
  daysRemaining: doublePrecision("days_remaining").notNull(),
  severity: text("severity").notNull(),
  channel: text("channel").notNull(),
  recipientCount: integer("recipient_count").notNull().default(0),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"),
});

export const insertAlertHistorySchema = createInsertSchema(alertHistoryTable).omit({ id: true, sentAt: true });
export type InsertAlertHistory = z.infer<typeof insertAlertHistorySchema>;
export type AlertHistory = typeof alertHistoryTable.$inferSelect;
