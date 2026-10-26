import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

function getDerivedKey(): Buffer {
  const secret =
    process.env.LOCAL_ENCRYPTION_SECRET ||
    "safereply-default-local-only-key-do-not-expose";
  return crypto.scryptSync(secret, "safereply-mtproto-salt-v1", 32);
}

/**
 * Encrypts sensitive strings (MTProto StringSession, api_hash) using AES-256-GCM
 * before storing in the local database.
 */
export function encryptSecret(plainText: string): string {
  if (!plainText) return "";
  const key = getDerivedKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts AES-256-GCM encrypted strings strictly inside server-side memory.
 * Never return the decrypted output to API responses.
 */
export function decryptSecret(cipherText?: string | null): string {
  if (!cipherText) return "";
  try {
    const parts = cipherText.split(":");
    if (parts.length !== 3) return "";
    const [ivHex, authTagHex, encryptedHex] = parts;
    const key = getDerivedKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const encrypted = Buffer.from(encryptedHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Masks a phone number for safe display in the UI (e.g., +998 90 *** ** 45)
 */
export function maskPhone(phone?: string | null): string {
  if (!phone) return "Not linked";
  const cleaned = phone.trim();
  if (cleaned.length <= 5) return "****";
  return `${cleaned.slice(0, 6)} ••• •• ${cleaned.slice(-2)}`;
}
