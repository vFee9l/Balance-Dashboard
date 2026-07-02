import { pgTable, text, serial, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  smsEnabled: boolean("sms_enabled").notNull().default(false),
  smsApiUrl: text("sms_api_url"),
  smsBodyTemplate: text("sms_body_template"),
  smtpEnabled: boolean("smtp_enabled").notNull().default(false),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpTls: boolean("smtp_tls").notNull().default(false),
  smtpUser: text("smtp_user"),
  smtpPassword: text("smtp_password"),
  smtpFrom: text("smtp_from"),
  telegramEnabled: boolean("telegram_enabled").notNull().default(false),
  telegramBotToken: text("telegram_bot_token"),
  telegramChatId: text("telegram_chat_id"),
  grafanaUrl: text("grafana_url").notNull().default("https://grafana.t2.sa"),
  grafanaApiKey: text("grafana_api_key"),
  grafanaDashboardUid: text("grafana_dashboard_uid"),
  scheduleEnabled: boolean("schedule_enabled").notNull().default(true),
  scheduleHour: integer("schedule_hour").notNull().default(8),
  scheduleCron: text("schedule_cron"),
  thresholdStaff: integer("threshold_staff").notNull().default(20),
  thresholdManager: integer("threshold_manager").notNull().default(15),
  thresholdMd: integer("threshold_md").notNull().default(5),
  totpSecret: text("totp_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  googleSheetUrl: text("google_sheet_url"),
  warningSmsCols: text("warning_sms_cols").default("F,H"),
  warningEmailToCols: text("warning_email_to_cols").default("G,I"),
  warningEmailCcCols: text("warning_email_cc_cols").default("K"),
  criticalSmsCols: text("critical_sms_cols").default("F,H,J"),
  criticalEmailToCols: text("critical_email_to_cols").default("K"),
  criticalEmailCcCols: text("critical_email_cc_cols").default("G,I,M"),
  emergencySmsCols: text("emergency_sms_cols").default("F,H,J,L"),
  emergencyEmailToCols: text("emergency_email_to_cols").default("M"),
  emergencyEmailCcCols: text("emergency_email_cc_cols").default("G,I,K"),
  excludedOrgs: text("excluded_orgs"),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ id: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
