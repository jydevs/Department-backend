import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { Actor } from "../../common/auth/actor";
import { PERMISSIONS } from "../../common/auth/decorators";
import { AppException } from "../../common/errors/app-exception";
import { Reflector } from "@nestjs/core";

/**
 * Enforce @RequirePermissions decorator: actor must have ALL listed permissions.
 * If no permissions are required, being authenticated is sufficient.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context.switchToHttp().getRequest<Request & { actor?: Actor }>();
    const actor = req.actor;

    // No permissions required: being authenticated is enough
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    // Must be a staff actor
    if (!actor || actor.kind !== "staff") {
      throw AppException.forbidden("You do not have permission to access this resource");
    }

    // Check if actor has ALL required permissions
    for (const permission of requiredPermissions) {
      if (!actor.permissions.has(permission)) {
        throw AppException.forbidden("You do not have permission to access this resource", {
          missing: permission,
        });
      }
    }

    return true;
  }
}
