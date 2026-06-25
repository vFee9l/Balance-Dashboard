import bcrypt from "bcrypt";
import { db, appUsersTable } from "@workspace/db";
import { or, eq } from "drizzle-orm";

const SALT_ROUNDS = 12;
const MAX_FAILED = 5;
const LOCKOUT_MINUTES = 30;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Look up user by username OR email, enforce lockout/active checks. */
export async function findAndVerifyUser(
  identifier: string,
  password: string,
): Promise<
  | { ok: true; user: typeof appUsersTable.$inferSelect }
  | { ok: false; reason: "not_found" | "inactive" | "locked" | "bad_password" }
> {
  const [user] = await db
    .select()
    .from(appUsersTable)
    .where(or(eq(appUsersTable.username, identifier), eq(appUsersTable.email, identifier)))
    .limit(1);

  if (!user) return { ok: false, reason: "not_found" };
  if (!user.isActive) return { ok: false, reason: "inactive" };
  if (user.lockedUntil && user.lockedUntil > new Date()) return { ok: false, reason: "locked" };

  const match = await verifyPassword(password, user.passwordHash);
  if (!match) {
    const newAttempts = user.failedAttempts + 1;
    const lockedUntil =
      newAttempts >= MAX_FAILED
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
        : null;
    await db
      .update(appUsersTable)
      .set({ failedAttempts: newAttempts, ...(lockedUntil ? { lockedUntil } : {}) })
      .where(eq(appUsersTable.id, user.id));
    return { ok: false, reason: "bad_password" };
  }

  // Reset lockout on success
  await db
    .update(appUsersTable)
    .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(appUsersTable.id, user.id));

  return { ok: true, user };
}
