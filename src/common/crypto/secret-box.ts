import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Env } from "../../config/env";

/**
 * Reversible encryption (AES-256-GCM, `iv:tag:ciphertext` in hex) for the few values that must be read back
 * (e.g. the checkout access token replayed by an idempotent request). Uses ENCRYPTION_KEY; without it (development only,
 * production requires the key) values are stored with a `plain:` prefix.
 */
export function sealSecret(env: Pick<Env, "ENCRYPTION_KEY">, plaintext: string): string {
  if (!env.ENCRYPTION_KEY) return `plain:${plaintext}`;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(env.ENCRYPTION_KEY, "base64"), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`;
}

/** Returns null when the value cannot be opened (wrong key, tampered, `plain:` in production). Never throws. */
export function openSecret(env: Pick<Env, "ENCRYPTION_KEY" | "NODE_ENV">, sealed: string): string | null {
  try {
    if (sealed.startsWith("plain:")) return env.NODE_ENV === "production" ? null : sealed.slice(6);
    if (!env.ENCRYPTION_KEY) return null;
    const [iv, tag, data] = sealed.split(":") as [string, string, string];
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(env.ENCRYPTION_KEY, "base64"), Buffer.from(iv, "hex"));
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(data, "hex")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
