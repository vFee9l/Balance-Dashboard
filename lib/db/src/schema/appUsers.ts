import { pgTable, serial, varchar, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const appUsersTable = pgTable("app_users", {
  id:             serial("id").primaryKey(),
  username:       varchar("username", { length: 100 }).unique().notNull(),
  email:          varchar("email", { length: 200 }).unique().notNull(),
  passwordHash:   text("password_hash").notNull(),
  role:           varchar("role", { length: 20 }).notNull().default("viewer"),
  totpSecretEnc:  text("totp_secret_enc"),
  totpEnabled:    boolean("totp_enabled").notNull().default(false),
  mustSetupTotp:  boolean("must_setup_totp").notNull().default(true),
  mustChangePw:   boolean("must_change_pw").notNull().default(false),
  isActive:       boolean("is_active").notNull().default(true),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil:    timestamp("locked_until", { withTimezone: true }),
  lastLoginAt:    timestamp("last_login_at", { withTimezone: true }),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow(),
  createdBy:      varchar("created_by", { length: 100 }),
});

export type AppUser = typeof appUsersTable.$inferSelect;
