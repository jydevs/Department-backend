import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { IS_PUBLIC } from "../../common/auth/decorators";
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

    // Load actor with staff info
    try {
      const user = await this.authService.getUserWithPermissions(payload.sub);
      const actor: Actor = {
        kind: "staff",
        staffId: user.id,
        roles: [user.role],
        permissions: new Set(user.permissions),
      };

      req.actor = actor;
      RequestContextStore.setActor(actor);
      return true;
    } catch {
      throw AppException.unauthorized("User not found or inactive");
    }
  }
}
