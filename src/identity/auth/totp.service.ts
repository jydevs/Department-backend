import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { TOTP } from "otplib";
import { ScureBase32Plugin, NobleCryptoPlugin } from "otplib";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";

/**
 * TOTP setup and verification with AES-256-GCM encryption.
 * Secrets are encrypted in the database; in dev without ENCRYPTION_KEY, stored with 'plain:' prefix.
 */
@Injectable()
export class TOTPService {
  private readonly totp: TOTP;
  private readonly encryptionKey: Buffer | null;

  constructor(@Inject(ENV) private readonly env: Env) {
    // Initialize TOTP with otplib v13 using scure-base32 and noble crypto
    const base32Plugin = new ScureBase32Plugin();
    const cryptoPlugin = new NobleCryptoPlugin();

    this.totp = new TOTP({
      crypto: cryptoPlugin,
      base32: base32Plugin,
    });

    // Setup encryption key (32 bytes for AES-256)
    const keyStr = env.ENCRYPTION_KEY;
    this.encryptionKey = keyStr ? Buffer.from(keyStr, "base64") : null;
  }

  /**
   * Generate a new TOTP secret and otpauth URI.
   * Returns: { secret (encrypted), uri }
   */
  generateSecret(email: string, issuer = "Department"): { secret: string; uri: string } {
    const secret = this.totp.generateSecret();
    const encrypted = this.encryptSecret(secret);
    return { secret: encrypted, uri: this.uriFor(encrypted, email, issuer) };
  }

  /** otpauth URI of an already stored (encrypted) secret: lets /auth/2fa/setup hand out the same pending secret again. */
  uriFor(encryptedSecret: string, email: string, issuer = "Department"): string {
    return this.totp.toURI({ secret: this.decryptSecret(encryptedSecret), label: email, issuer });
  }

  /**
   * Verify a TOTP code against a stored (encrypted) secret.
   * Returns true if valid, false otherwise.
   */
  async verifyCode(code: string, encryptedSecret: string): Promise<boolean> {
    return (await this.verifyStep(code, encryptedSecret)) !== null;
  }

  /**
   * Like `verifyCode`, but returns the matched time step and rejects steps <= `afterStep` (replay protection).
   * The caller must store the step atomically (see AuthService.verifyTotpOnce).
   */
  async verifyStep(code: string, encryptedSecret: string, afterStep?: number | null): Promise<number | null> {
    try {
      const secret = this.decryptSecret(encryptedSecret);
      const result = await this.totp.verify(code, { secret, ...(afterStep != null ? { afterTimeStep: afterStep } : {}) });
      return result.valid ? result.timeStep : null;
    } catch {
      return null;
    }
  }

  /**
   * Get the decrypted secret for a user (used internally for recovery codes, etc.).
   */
  decryptSecret(encryptedSecret: string): string {
    if (encryptedSecret.startsWith("plain:")) {
      if (this.env.NODE_ENV === "production") throw new Error("Unencrypted 2FA secret refused in production");
      return encryptedSecret.slice(6);
    }

    if (!this.encryptionKey) {
      throw new Error("ENCRYPTION_KEY not configured");
    }

    const parts = encryptedSecret.split(":") as [string, string, string];
    if (parts.length !== 3) {
      throw new Error("Invalid encrypted secret format");
    }

    const [ivHex, authTagHex, ciphertextHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const ciphertext = Buffer.from(ciphertextHex, "hex");

    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, undefined, "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  /**
   * Encrypt a secret using AES-256-GCM.
   * Format: iv:authTag:ciphertext (all hex).
   * Falls back to 'plain:' prefix in dev if no encryption key.
   */
  private encryptSecret(secret: string): string {
    if (!this.encryptionKey) {
      // Development fallback: no encryption, just mark as plain text
      return `plain:${secret}`;
    }

    const iv = randomBytes(12); // 96 bits for GCM
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);

    let encrypted = cipher.update(secret, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag();

    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
  }
}
