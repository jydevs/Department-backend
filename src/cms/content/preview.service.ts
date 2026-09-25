import { randomBytes } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { Clock } from "../../common/clock/clock";
import type { ContentKind } from "../entities/content-document.entity";
import type { PreviewTokenResponseDto } from "./content.dto";

const TTL_SECONDS = 60 * 60;
const AUDIENCE = "content-preview";

/** Short-lived (1 h) HS256 tokens that let the storefront read ONE document's draft. */
@Injectable()
export class PreviewService {
  private readonly logger = new Logger(PreviewService.name);
  private readonly secret: Uint8Array;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly clock: Clock,
  ) {
    const configured = env.PREVIEW_TOKEN_SECRET;
    if (configured) {
      this.secret = Buffer.from(configured, "utf8");
    } else {
      if (env.NODE_ENV === "production") throw new Error("PREVIEW_TOKEN_SECRET is required in production");
      this.logger.warn("PREVIEW_TOKEN_SECRET not set; using ephemeral secret (dev only, tokens die on restart)");
      this.secret = randomBytes(32);
    }
  }

  async sign(kind: ContentKind, key: string): Promise<PreviewTokenResponseDto> {
    const iat = Math.floor(this.clock.now().getTime() / 1000);
    const exp = iat + TTL_SECONDS;
    const token = await new SignJWT({ kind, key }).setAudience(AUDIENCE).setProtectedHeader({ alg: "HS256" }).setIssuedAt(iat).setExpirationTime(exp).sign(this.secret);
    const url = new URL("/api/preview", this.env.STOREFRONT_URL);
    url.searchParams.set("token", token);
    return { token, url: url.toString(), expiresAt: new Date(exp * 1000) };
  }

  /** True only for a valid, unexpired token issued for exactly this document. */
  async verify(token: string, kind: ContentKind, key: string): Promise<boolean> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: ["HS256"],
        audience: AUDIENCE,
        requiredClaims: ["exp"],
        currentDate: this.clock.now(),
      });
      return payload.kind === kind && payload.key === key;
    } catch {
      return false;
    }
  }
}
