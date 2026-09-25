import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";

export interface JWTPayload extends Record<string, unknown> {
  sub: string; // staffUserId
  role: string;
  pv?: number; // passwordVersion (optional, validated against DB)
}

/**
 * JWT access tokens (HS256, 15 min) and opaque refresh tokens (sha256, 30 days).
 * Refresh tokens are stored as hash only and rotated on use.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private accessSecret: Uint8Array | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.initAccessSecret();
  }

  private initAccessSecret(): void {
    const secret = this.env.JWT_ACCESS_SECRET;
    if (!secret) {
      if (this.env.NODE_ENV === "production") {
        throw new Error("JWT_ACCESS_SECRET is required in production");
      }
      // Ephemeral secret in development
      const ephemeral = randomBytes(32).toString("hex");
      this.logger.warn("JWT_ACCESS_SECRET not set; using ephemeral secret (dev only)");
      this.accessSecret = Buffer.from(ephemeral, "hex");
      return;
    }
    this.accessSecret = Buffer.from(secret, "utf8");
  }

  async generateAccessToken(payload: JWTPayload): Promise<{ token: string; expiresIn: number }> {
    if (!this.accessSecret) {
      throw new Error("Access secret not initialized");
    }

    const expiresIn = 15 * 60 * 1000; // 15 minutes in milliseconds
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 15 * 60;

    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(this.accessSecret);

    return { token, expiresIn };
  }

  async verifyAccessToken(token: string): Promise<JWTPayload | null> {
    if (!this.accessSecret) return null;

    try {
      const { payload } = await jwtVerify(token, this.accessSecret, { algorithms: ["HS256"], requiredClaims: ["exp", "sub"] });
      return typeof payload.sub === "string" ? { ...payload, sub: payload.sub, role: String(payload.role ?? "") } : null;
    } catch {
      return null;
    }
  }

  /**
   * Generate an opaque refresh token (32 bytes base64url).
   * Returns both the raw token (to send to client) and its sha256 hash (to store in DB).
   */
  generateRefreshToken(): { token: string; hash: string } {
    const raw = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(raw).digest("hex");
    return { token: raw, hash };
  }

  /**
   * Hash a refresh token for comparison with stored hash.
   */
  hashRefreshToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
