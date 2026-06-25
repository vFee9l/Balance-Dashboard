import { pgTable, serial, integer, text, varchar, boolean, timestamp } from "drizzle-orm/pg-core";
import { appUsersTable } from "./appUsers";

export const appUserSessionsTable = pgTable("app_user_sessions", {
  id:           serial("id").primaryKey(),
  userId:       integer("user_id").notNull().references(() => appUsersTable.id, { onDelete: "cascade" }),
  sessionToken: text("session_token").unique().notNull(),
  ipAddress:    varchar("ip_address", { length: 100 }),
  userAgent:    text("user_agent"),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow(),
  expiresAt:    timestamp("expires_at", { withTimezone: true }).notNull(),
  revoked:      boolean("revoked").notNull().default(false),
});

export type AppUserSession = typeof appUserSessionsTable.$inferSelect;
