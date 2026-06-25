import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import { encrypt, decrypt } from "../lib/cryptoUtils.js";

export function generateTotpSecret(): string {
  return generateSecret();
}

export function encryptSecret(secret: string): string {
  return encrypt(secret);
}

export function decryptSecret(enc: string): string {
  return decrypt(enc);
}

export async function generateQrDataUrl(
  secret: string,
  username: string,
  issuer = "BalanceAlert",
): Promise<string> {
  const uri = generateURI({ issuer, label: `${issuer}:${username}`, secret });
  return QRCode.toDataURL(uri);
}

export function verifyTotpCode(token: string, encryptedSecret: string): boolean {
  try {
    const secret = decryptSecret(encryptedSecret);
    const result = verifySync({ token, secret });
    return result.valid;
  } catch {
    return false;
  }
}
