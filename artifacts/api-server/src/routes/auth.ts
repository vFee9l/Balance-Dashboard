import { Router } from "express";
import { db, settingsTable } from "@workspace/db";
import { verify } from "otplib";
import { logger } from "../lib/logger";

const router = Router();

router.get("/auth/check", async (req, res): Promise<void> => {
  const rows = await db.select().from(settingsTable).limit(1);
  const settings = rows[0];
  const requiresAuth = settings?.totpEnabled ?? false;
  const authenticated = !requiresAuth || req.session.authenticated === true;
  res.json({ authenticated, requiresAuth });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const { otp } = req.body as { otp?: string };
  if (!otp) {
    res.status(400).json({ error: "OTP required" });
    return;
  }

  const rows = await db.select().from(settingsTable).limit(1);
  const settings = rows[0];

  if (!settings?.totpEnabled || !settings?.totpSecret) {
    req.session.authenticated = true;
    res.json({ success: true });
    return;
  }

  const result = await verify({ token: otp, secret: settings.totpSecret });
  if (!result.valid) {
    logger.warn("Invalid dashboard login attempt");
    res.status(401).json({ error: "Invalid code. Please try again." });
    return;
  }

  req.session.authenticated = true;
  logger.info("Dashboard login successful");
  res.json({ success: true });
});

router.post("/auth/logout", (req, res): void => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

export default router;
