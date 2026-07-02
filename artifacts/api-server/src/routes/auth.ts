import { Router } from "express";
import { db, appUsersTable, appUserSessionsTable, appLoginAuditTable } from "@workspace/db";
import { eq, and, not } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { findAndVerifyUser, hashPassword } from "../auth/password.js";
import {
  generateTotpSecret,
  encryptSecret,
  verifyTotpCode,
  generateQrDataUrl,
} from "../auth/totpAuth.js";

const router = Router();

declare module "express-session" {
  interface SessionData {
    authenticated: boolean;
    userId: number;
    role: string;
    username: string;
    pendingUserId: number;
    pendingNeedsSetup: boolean;
    pendingTotpEnc: string;
  }
}

// ─── Helper: record login audit ─────────────────────────────────────────────
async function audit(
  username: string | null,
  result: string,
  ip: string | null,
) {
  try {
    await db.insert(appLoginAuditTable).values({
      username: username ?? undefined,
      result,
      ipAddress: ip ?? undefined,
    });
  } catch { /* best-effort */ }
}

// ─── GET /api/auth/check ─────────────────────────────────────────────────────
router.get("/auth/check", async (req, res): Promise<void> => {
  if (req.session.userId) {
    res.json({
      authenticated: true,
      requiresAuth: true,
      role: req.session.role,
      username: req.session.username,
    });
    return;
  }
  if (req.session.pendingUserId) {
    res.json({
      authenticated: false,
      requiresAuth: true,
      step: req.session.pendingNeedsSetup ? "totp_setup" : "totp_verify",
    });
    return;
  }
  res.json({ authenticated: false, requiresAuth: true });
});

// ─── POST /api/auth/login  (step 1: password) ────────────────────────────────
router.post("/auth/login", async (req, res): Promise<void> => {
  const { identifier, password } = req.body as { identifier?: string; password?: string };
  const ip = req.ip ?? null;

  if (!identifier || !password) {
    res.status(400).json({ error: "identifier and password are required" });
    return;
  }

  const result = await findAndVerifyUser(identifier, password);

  if (!result.ok) {
    const genericMsg = "Invalid username or password.";
    await audit(identifier, result.reason, ip);
    if (result.reason === "inactive")
      return void res.status(403).json({ error: "This account has been deactivated. Contact your administrator." });
    if (result.reason === "locked")
      return void res.status(403).json({ error: "Account temporarily locked. Try again later." });
    return void res.status(401).json({ error: genericMsg });
  }

  const { user } = result;

  // If TOTP is fully disabled for this user, log in directly
  if (!user.totpEnabled && !user.mustSetupTotp) {
    await issueSession(req, user);
    await audit(user.username, "success", ip);
    await logSessionToDb(req, user.id);
    res.json({ ok: true, role: user.role, username: user.username });
    return;
  }

  // TOTP required — store pending state
  req.session.pendingUserId = user.id;
  req.session.pendingNeedsSetup = user.mustSetupTotp;

  if (user.mustSetupTotp) {
    // Generate + store (temporarily in session) a new TOTP secret for setup
    const secret = generateTotpSecret();
    const enc = encryptSecret(secret);
    req.session.pendingTotpEnc = enc;
    const qrDataUrl = await generateQrDataUrl(secret, user.username);
    res.json({ step: "totp_setup", qrDataUrl, manualKey: secret });
  } else {
    res.json({ step: "totp_verify" });
  }
});

// ─── POST /api/auth/totp/confirm-setup  (first-time TOTP enrollment) ─────────
router.post("/auth/totp/confirm-setup", async (req, res): Promise<void> => {
  const { code } = req.body as { code?: string };
  const ip = req.ip ?? null;

  if (!req.session.pendingUserId || !req.session.pendingNeedsSetup) {
    return void res.status(400).json({ error: "No pending TOTP setup." });
  }
  if (!code || !/^\d{6}$/.test(code)) {
    return void res.status(400).json({ error: "A 6-digit code is required." });
  }

  const enc = req.session.pendingTotpEnc;
  if (!enc) return void res.status(400).json({ error: "No TOTP secret in session." });

  if (!verifyTotpCode(code, enc)) {
    await audit(null, "totp_failed", ip);
    return void res.status(401).json({ error: "Invalid code. Please try again." });
  }

  const userId = req.session.pendingUserId;
  await db
    .update(appUsersTable)
    .set({ totpSecretEnc: enc, totpEnabled: true, mustSetupTotp: false })
    .where(eq(appUsersTable.id, userId));

  const [user] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, userId));
  if (!user) return void res.status(500).json({ error: "User not found after setup." });

  await issueSession(req, user);
  await audit(user.username, "success", ip);
  await logSessionToDb(req, user.id);

  res.json({ ok: true, role: user.role, username: user.username });
});

// ─── POST /api/auth/totp/verify  (returning user TOTP) ───────────────────────
router.post("/auth/totp/verify", async (req, res): Promise<void> => {
  const { code } = req.body as { code?: string };
  const ip = req.ip ?? null;

  if (!req.session.pendingUserId) {
    return void res.status(400).json({ error: "No pending TOTP verification." });
  }
  if (!code || !/^\d{6}$/.test(code)) {
    return void res.status(400).json({ error: "A 6-digit code is required." });
  }

  const [user] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.id, req.session.pendingUserId));
  if (!user || !user.totpSecretEnc) {
    return void res.status(400).json({ error: "TOTP not configured for this account." });
  }

  if (!verifyTotpCode(code, user.totpSecretEnc)) {
    const newAttempts = user.failedAttempts + 1;
    const lockedUntil = newAttempts >= 5 ? new Date(Date.now() + 30 * 60 * 1000) : null;
    await db
      .update(appUsersTable)
      .set({ failedAttempts: newAttempts, ...(lockedUntil ? { lockedUntil } : {}) })
      .where(eq(appUsersTable.id, user.id));
    await audit(user.username, "totp_failed", ip);
    return void res.status(401).json({ error: "Invalid code. Please try again." });
  }

  await db
    .update(appUsersTable)
    .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(appUsersTable.id, user.id));

  await issueSession(req, user);
  await audit(user.username, "success", ip);
  await logSessionToDb(req, user.id);

  res.json({ ok: true, role: user.role, username: user.username });
});

// ─── POST /api/auth/logout ───────────────────────────────────────────────────
router.post("/auth/logout", async (req, res): Promise<void> => {
  const sessionId = req.sessionID;
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
  // Mark session revoked in DB (best-effort)
  try {
    await db
      .update(appUserSessionsTable)
      .set({ revoked: true })
      .where(eq(appUserSessionsTable.sessionToken, sessionId));
  } catch { /* ignore */ }
});

// ─── POST /api/auth/logout-all  (revoke all other sessions) ──────────────────
router.post("/auth/logout-all", async (req, res): Promise<void> => {
  if (!req.session.userId) return void res.status(401).json({ error: "Not authenticated" });
  const currentToken = req.sessionID;
  await db
    .update(appUserSessionsTable)
    .set({ revoked: true })
    .where(
      and(
        eq(appUserSessionsTable.userId, req.session.userId),
        not(eq(appUserSessionsTable.sessionToken, currentToken)),
      ),
    );
  res.json({ ok: true });
});

// ─── POST /api/auth/change-password ──────────────────────────────────────────
router.post("/auth/change-password", async (req, res): Promise<void> => {
  if (!req.session.userId) return void res.status(401).json({ error: "Not authenticated" });
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return void res.status(400).json({ error: "currentPassword and newPassword (min 8 chars) are required." });
  }

  const [user] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, req.session.userId));
  if (!user) return void res.status(404).json({ error: "User not found." });

  const { verifyPassword, hashPassword: hp } = await import("../auth/password.js");
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return void res.status(401).json({ error: "Current password is incorrect." });
  }
  const newHash = await hp(newPassword);
  await db
    .update(appUsersTable)
    .set({ passwordHash: newHash, mustChangePw: false })
    .where(eq(appUsersTable.id, req.session.userId));

  res.json({ ok: true });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function issueSession(
  req: import("express").Request,
  user: typeof appUsersTable.$inferSelect,
): Promise<void> {
  delete req.session.pendingUserId;
  delete req.session.pendingNeedsSetup;
  delete req.session.pendingTotpEnc;
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.username = user.username;
  req.session.authenticated = true;
}

async function logSessionToDb(
  req: import("express").Request,
  userId: number,
): Promise<void> {
  try {
    await db.insert(appUserSessionsTable).values({
      userId,
      sessionToken: req.sessionID,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
    });
  } catch { /* best-effort */ }
}

export default router;
