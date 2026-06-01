import { pgTable, text, serial, timestamp, doublePrecision, date, unique } from "drizzle-orm/pg-core";

export const clientDailyConsumptionTable = pgTable(
  "client_daily_consumption",
  {
    id: serial("id").primaryKey(),
    metric: text("metric").notNull(),
    date: date("date").notNull(),
    consumption: doublePrecision("consumption").notNull(),
    percentChange: doublePrecision("percent_change"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("client_daily_consumption_metric_date_unique").on(table.metric, table.date),
  ]
);

export type ClientDailyConsumption = typeof clientDailyConsumptionTable.$inferSelect;
