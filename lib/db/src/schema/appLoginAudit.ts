import { pgTable, bigserial, varchar, timestamp } from "drizzle-orm/pg-core";

export const appLoginAuditTable = pgTable("app_login_audit", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  username:  varchar("username", { length: 100 }),
  result:    varchar("result", { length: 30 }),
  ipAddress: varchar("ip_address", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type AppLoginAudit = typeof appLoginAuditTable.$inferSelect;
