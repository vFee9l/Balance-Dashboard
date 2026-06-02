import { Router } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateSettingsBody, VerifyOtpBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import nodemailer from "nodemailer";
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

router.post("/settings/test-sms", async (req, res): Promise<void> => {
  const { to } = req.body as { to?: string };
  if (!to) {
    res.status(400).json({ success: false, error: "A recipient phone number is required." });
    return;
  }

  const settings = await getOrCreateSettings();
  const { smsApiUrl, smsBodyTemplate } = settings;

  if (!smsApiUrl) {
    res.status(400).json({ success: false, error: "SMS API URL is not configured." });
    return;
  }

  const testMessage = "BalanceAlert test SMS — your SMS configuration is working correctly.";

  function buildBody(template: string | null | undefined, phone: string, message: string): string {
    if (!template) return JSON.stringify({ to: phone, message });
    return template
      .replace(/\{phone\}/g, phone)
      .replace(/\{to\}/g, phone)
      .replace(/\{number\}/g, phone)
      .replace(/\{message\}/g, message)
      .replace(/\{text\}/g, message);
  }

  const rawBody = buildBody(smsBodyTemplate, to, testMessage);
  let parsedBody: unknown;
  try { parsedBody = JSON.parse(rawBody); } catch { parsedBody = rawBody; }
  const isJson = typeof parsedBody === "object";
  const outgoingBody = isJson ? JSON.stringify(parsedBody) : rawBody;

  try {
    const resp = await fetch(smsApiUrl, {
      method: "POST",
      headers: { "Content-Type": isJson ? "application/json" : "text/plain" },
      body: outgoingBody,
      signal: AbortSignal.timeout(10000),
    });

    const responseText = await resp.text().catch(() => "");
    if (resp.ok) {
      logger.info({ to }, "Test SMS sent successfully");
      res.json({ success: true, sentBody: outgoingBody });
    } else {
      logger.warn({ status: resp.status, to, responseBody: responseText, sentBody: outgoingBody }, "Test SMS failed");
      res.status(500).json({ success: false, error: `SMS API returned ${resp.status}: ${responseText}`, sentBody: outgoingBody });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, to }, "Test SMS request failed");
    res.status(500).json({ success: false, error: msg, sentBody: outgoingBody });
  }
});

router.post("/settings/test-email", async (req, res): Promise<void> => {
  const { to } = req.body as { to?: string };
  if (!to || !to.includes("@")) {
    res.status(400).json({ success: false, error: "A valid recipient email address is required." });
    return;
  }

  const settings = await getOrCreateSettings();
  const { smtpHost, smtpPort, smtpTls, smtpUser, smtpPassword, smtpFrom } = settings;

  if (!smtpHost || !smtpUser || !smtpFrom) {
    res.status(400).json({ success: false, error: "SMTP is not fully configured (host, username and from address are required)." });
    return;
  }

  try {
    const port = smtpPort ?? 587;
    // Only use direct SSL/TLS when explicitly enabled; never infer from port.
    const secure = smtpTls === true;
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port,
      secure,
      auth: { user: smtpUser, pass: smtpPassword ?? "" },
    });
    await transporter.sendMail({
      from: smtpFrom,
      to,
      subject: "BalanceAlert — SMTP Test",
      text: `This is a test email from the BalanceAlert system.\n\nIf you received this, your SMTP configuration is working correctly.\n\nSMTP host: ${smtpHost}:${port} (TLS: ${secure})`,
    });
    logger.info({ to }, "Test email sent successfully");
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, to }, "Test email failed");
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
