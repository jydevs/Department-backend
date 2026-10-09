import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { SignJWT, jwtVerify } from "jose";
import { Clock } from "../../common/clock/clock";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";

export const CUSTOMER_AUDIENCE = "storefront";
export const CUSTOMER_TOKEN_TYPE = "customer";
const ACCESS_TTL_SECONDS = 15 * 60;

/**
 * Customer access tokens: JWT HS256, aud "storefront", typ "customer", 15 min.
 * Signed with CUSTOMER_JWT_SECRET (never the staff secret), so neither kind of token opens the other's routes.
 */
@Injectable()
export class CustomerTokenService {
  private readonly logger = new Logger(CustomerTokenService.name);
  private readonly secret: Uint8Array;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly clock: Clock,
  ) {
    const configured = this.env.CUSTOMER_JWT_SECRET;
    if (configured) {
      this.secret = Buffer.from(configured, "utf8");
    } else if (this.env.NODE_ENV === "production") {
      throw new Error("CUSTOMER_JWT_SECRET is required in production");
    } else {
      this.logger.warn("CUSTOMER_JWT_SECRET not set; using an ephemeral secret (dev only, sessions die on restart)");
      this.secret = randomBytes(32);
    }
  }

  async sign(customerId: string): Promise<{ token: string; expiresIn: number }> {
    const iat = Math.floor(this.clock.now().getTime() / 1000);
    const token = await new SignJWT({ typ: CUSTOMER_TOKEN_TYPE })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(customerId)
      .setAudience(CUSTOMER_AUDIENCE)
      .setIssuedAt(iat)
      .setExpirationTime(iat + ACCESS_TTL_SECONDS)
      .sign(this.secret);
    return { token, expiresIn: ACCESS_TTL_SECONDS };
  }

  /** Returns the customer id, or null for anything invalid (wrong alg, audience, type, expired, tampered). */
  async verify(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: ["HS256"],
        audience: CUSTOMER_AUDIENCE,
        requiredClaims: ["exp", "sub"],
        currentDate: this.clock.now(),
      });
      if (payload.typ !== CUSTOMER_TOKEN_TYPE || typeof payload.sub !== "string") return null;
      return payload.sub;
    } catch {
      return null;
    }
  }

  /** Opaque 32-byte token (base64url) and its sha256 hex: only the hash is stored. Used for refresh, reset and verification. */
  generateOpaque(): { token: string; hash: string } {
    const token = randomBytes(32).toString("base64url");
    return { token, hash: this.hashOpaque(token) };
  }

  hashOpaque(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
