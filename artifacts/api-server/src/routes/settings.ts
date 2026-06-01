import { Router } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateSettingsBody, VerifyOtpBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { generateSecret, generateURI, verify, generate } from "otplib";
import QRCode from "qrcode";

const router = Router();
const APP_NAME = "BalanceAlert";

async function getOrCreateSettings() {
  const rows = await db.select().from(settingsTable).limit(1);
  if (rows.length > 0) return rows[0];
  const [created] = await db.insert(settingsTable).values({}).returning();
  return created;
}

function maskSensitive(settings: typeof settingsTable.$inferSelect) {
  return {
    ...settings,
    smtpPassword: settings.smtpPassword ? "***" : null,
    grafanaApiKey: settings.grafanaApiKey ? "***" : null,
    telegramBotToken: settings.telegramBotToken ? "***" : null,
    totpSecret: settings.totpSecret ? "***" : null,
  };
}

router.get("/settings", async (req, res): Promise<void> => {
  const settings = await getOrCreateSettings();
  res.json(maskSensitive(settings));
});

router.patch("/settings", async (req, res): Promise<void> => {
  const body = UpdateSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const existing = await getOrCreateSettings();
  const updateData: Record<string, unknown> = { ...body.data };
  if (updateData.smtpPassword === "***") delete updateData.smtpPassword;
  if (updateData.grafanaApiKey === "***") delete updateData.grafanaApiKey;
  if (updateData.telegramBotToken === "***") delete updateData.telegramBotToken;
  if (updateData.totpSecret === "***") delete updateData.totpSecret;

  const [updated] = await db
    .update(settingsTable)
    .set(updateData)
    .where(eq(settingsTable.id, existing.id))
    .returning();
  res.json(maskSensitive(updated));
});

router.get("/settings/totp-setup", async (req, res): Promise<void> => {
  const settings = await getOrCreateSettings();

  let secret = settings.totpSecret;
  if (!secret) {
    secret = generateSecret();
    await db
      .update(settingsTable)
      .set({ totpSecret: secret })
      .where(eq(settingsTable.id, settings.id));
  }

  const otpAuthUrl = generateURI({ label: "admin", issuer: APP_NAME, secret, type: "totp" });
  const qrCodeUrl = await QRCode.toDataURL(otpAuthUrl);

  res.json({ secret, qrCodeUrl, otpAuthUrl });
});

router.get("/settings/totp-status", async (req, res): Promise<void> => {
  const settings = await getOrCreateSettings();
  res.json({ required: !!(settings.totpEnabled && settings.totpSecret) });
});

router.post("/settings/verify-otp", async (req, res): Promise<void> => {
  const body = VerifyOtpBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const settings = await getOrCreateSettings();

  if (!settings.totpEnabled || !settings.totpSecret) {
    logger.info("TOTP not enabled — granting settings access without code");
    res.json({ success: true, token: Buffer.from(`settings-${Date.now()}`).toString("base64") });
    return;
  }

  const result = await verify({ token: body.data.otp, secret: settings.totpSecret, type: "totp" });
  if (!result.valid) {
    req.log.warn("Invalid TOTP attempt");
    res.status(401).json({ error: "Invalid code. Please try again." });
    return;
  }

  logger.info("Settings TOTP verified successfully");
  res.json({ success: true, token: Buffer.from(`settings-${Date.now()}`).toString("base64") });
});

export default router;
