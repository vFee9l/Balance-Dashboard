import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { logger } from "./logger.js";

const ALG = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

let _key: Buffer | null = null;

function getKey(): Buffer {
  if (_key) return _key;
  const hex = process.env["ENCRYPTION_SECRET"];
  if (!hex) {
    logger.warn(
      "ENCRYPTION_SECRET env var not set. A random in-memory key will be used — " +
        "bot tokens will not survive a server restart. " +
        "Set ENCRYPTION_SECRET to a 64-char hex string (32 bytes) to persist tokens across restarts."
    );
    _key = randomBytes(32);
    return _key;
  }
  if (hex.length < 64) {
    logger.warn("ENCRYPTION_SECRET should be 64 hex chars (32 bytes). Key will be padded.");
  }
  _key = Buffer.from(hex.slice(0, 64).padEnd(64, "0"), "hex");
  return _key;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decrypt(encoded: string): string {
  if (!encoded) throw new Error("Empty encoded string");
  const key = getKey();
  const buf = Buffer.from(encoded, "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) throw new Error("Invalid encrypted data length");
  const iv = buf.subarray(0, IV_LEN);
  const authTag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const encrypted = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
