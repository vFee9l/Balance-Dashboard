import { randomBytes } from "crypto";
import { db, appUsersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { hashPassword } from "./password.js";
import { logger } from "../lib/logger.js";

export async function seedAdminIfEmpty(): Promise<void> {
  try {
    const countResult = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app_users`);
    const count = Number((countResult.rows[0] as { n: number }).n);
    if (count > 0) return;

    const password = randomBytes(12).toString("base64url"); // ~16 printable chars
    const email = process.env["DEFAULT_ADMIN_EMAIL"] ?? "admin@localhost";
    const hash = await hashPassword(password);

    await db.insert(appUsersTable).values({
      username: "admin",
      email,
      passwordHash: hash,
      role: "admin",
      mustSetupTotp: true,
      isActive: true,
      createdBy: "system",
    });

    logger.info(
      "\n================================================" +
      "\n  DEFAULT ADMIN ACCOUNT CREATED" +
      "\n  Username : admin" +
      `\n  Email    : ${email}` +
      `\n  Password : ${password}` +
      "\n  Log in and change this password immediately." +
      "\n================================================",
    );
  } catch (err) {
    logger.error({ err }, "[STARTUP] Failed to seed default admin account");
  }
}
