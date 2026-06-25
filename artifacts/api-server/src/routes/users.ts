import { Router } from "express";
import { db, appUsersTable } from "@workspace/db";
import { eq, ne, and } from "drizzle-orm";
import { randomBytes } from "crypto";
import { hashPassword } from "../auth/password.js";
import { logger } from "../lib/logger.js";

const router = Router();

type UserRow = typeof appUsersTable.$inferSelect;

function sanitize(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    totpEnabled: u.totpEnabled,
    mustSetupTotp: u.mustSetupTotp,
    mustChangePw: u.mustChangePw,
    failedAttempts: u.failedAttempts,
    lockedUntil: u.lockedUntil?.toISOString() ?? null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt?.toISOString() ?? null,
    createdBy: u.createdBy,
  };
}

// GET /api/users
router.get("/users", async (req, res): Promise<void> => {
  const users = await db.select().from(appUsersTable).orderBy(appUsersTable.id);
  res.json(users.map(sanitize));
});

// POST /api/users — create new user (admin only)
router.post("/users", async (req, res): Promise<void> => {
  const { username, email, role = "viewer" } = req.body as {
    username?: string;
    email?: string;
    role?: string;
  };
  if (!username || !email) {
    return void res.status(400).json({ error: "username and email are required." });
  }
  if (!["admin", "viewer"].includes(role)) {
    return void res.status(400).json({ error: "role must be admin or viewer." });
  }

  const tempPassword = randomBytes(8).toString("base64url");
  const hash = await hashPassword(tempPassword);

  try {
    const [user] = await db
      .insert(appUsersTable)
      .values({
        username: username.trim(),
        email: email.trim().toLowerCase(),
        passwordHash: hash,
        role,
        mustSetupTotp: true,
        mustChangePw: true,
        createdBy: req.session?.username ?? "admin",
      })
      .returning();
    logger.info({ username }, "New user created by admin");
    res.json({ ok: true, user: sanitize(user!), tempPassword });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique")) {
      return void res.status(409).json({ error: "Username or email already exists." });
    }
    throw err;
  }
});

// PATCH /api/users/:id
router.patch("/users/:id", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  const body = req.body as {
    role?: string;
    isActive?: boolean;
  };
  if (isNaN(id)) return void res.status(400).json({ error: "Invalid id." });

  // Prevent last-admin demotion/deactivation
  if (body.role === "viewer" || body.isActive === false) {
    const me = req.session?.userId;
    if (me === id) {
      return void res.status(403).json({ error: "You cannot demote or deactivate your own account." });
    }
    // Ensure at least one other active admin remains
    const admins = await db
      .select({ id: appUsersTable.id })
      .from(appUsersTable)
      .where(and(eq(appUsersTable.role, "admin"), eq(appUsersTable.isActive, true), ne(appUsersTable.id, id)));
    if (admins.length === 0) {
      return void res.status(403).json({ error: "Cannot remove the last active admin." });
    }
  }

  const updates: Partial<typeof appUsersTable.$inferInsert> = {};
  if (body.role !== undefined) updates.role = body.role;
  if (body.isActive !== undefined) updates.isActive = body.isActive;

  await db.update(appUsersTable).set(updates).where(eq(appUsersTable.id, id));
  res.json({ ok: true });
});

// POST /api/users/:id/reset-totp
router.post("/users/:id/reset-totp", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) return void res.status(400).json({ error: "Invalid id." });
  await db
    .update(appUsersTable)
    .set({ totpSecretEnc: null, totpEnabled: false, mustSetupTotp: true })
    .where(eq(appUsersTable.id, id));
  res.json({ ok: true });
});

// POST /api/users/:id/force-pw-reset
router.post("/users/:id/force-pw-reset", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) return void res.status(400).json({ error: "Invalid id." });

  const tempPassword = randomBytes(8).toString("base64url");
  const hash = await hashPassword(tempPassword);
  await db
    .update(appUsersTable)
    .set({ passwordHash: hash, mustChangePw: true, failedAttempts: 0, lockedUntil: null })
    .where(eq(appUsersTable.id, id));
  res.json({ ok: true, tempPassword });
});

// POST /api/users/:id/unlock
router.post("/users/:id/unlock", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) return void res.status(400).json({ error: "Invalid id." });
  await db
    .update(appUsersTable)
    .set({ lockedUntil: null, failedAttempts: 0 })
    .where(eq(appUsersTable.id, id));
  res.json({ ok: true });
});

export default router;
