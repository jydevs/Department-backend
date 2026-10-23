import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { ALLOW_PENDING, IS_PUBLIC, type PendingStep } from "../../common/auth/decorators";
import type { Actor } from "../../common/auth/actor";
import { RequestContextStore } from "../../common/context/request-context";
import { AppException } from "../../common/errors/app-exception";
import { Reflector } from "@nestjs/core";
import { AuthService } from "./auth.service";

/**
 * Validate Bearer tokens and load actor into RequestContextStore.
 * Respects @Public() to allow unauthenticated access.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { actor?: Actor }>();

    // Check if route is public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      req.actor = { kind: "anonymous" };
      RequestContextStore.setActor({ kind: "anonymous" });
      return true;
    }

    // Extract Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw AppException.unauthorized("Missing or invalid authorization header");
    }

    const token = authHeader.slice(7);

    // Verify token
    const payload = await this.authService.verifyAccessToken(token);
    if (!payload) {
      throw AppException.unauthorized("Invalid or expired token");
    }

    // Load actor with staff info (a database failure must surface as 5xx, not sign the admin out)
    const user = await this.authService.getUserWithPermissions(payload.sub);
    const actor: Actor = {
      kind: "staff",
      staffId: user.id,
      roles: [user.role],
      permissions: new Set(user.permissions),
    };

    // Pending security steps: a temporary password must be replaced, and owners/admins must have 2FA (REQUIRE_STAFF_2FA).
    // Only the routes marked @AllowWhilePending(...) stay reachable until the step is done.
    const pending = (step: PendingStep) =>
      this.reflector.getAllAndOverride<PendingStep[] | undefined>(ALLOW_PENDING, [context.getHandler(), context.getClass()])?.includes(step) ?? false;
    if (user.mustChangePassword && !pending("password")) {
      throw new AppException(403, "PASSWORD_CHANGE_REQUIRED", "You must change your temporary password before continuing");
    }
    if (user.twoFactorSetupRequired && !pending("2fa")) {
      throw new AppException(403, "TWO_FACTOR_SETUP_REQUIRED", "Two-factor authentication must be enabled before continuing");
    }

    req.actor = actor;
    RequestContextStore.setActor(actor);
    return true;
  }
}
