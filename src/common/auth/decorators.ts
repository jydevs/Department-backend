import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Request } from "express";
import type { Actor } from "./actor";

export const IS_PUBLIC = "auth:public";
export const PERMISSIONS = "auth:permissions";

/**
 * Deny-by-default: every route requires an authenticated actor unless marked @Public().
 * Public means "anyone, including anonymous visitors" (storefront reads, health, login).
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Require ALL listed permissions, e.g. @RequirePermissions("products:write"). Enforced by the guard (Phase 1). */
export const RequirePermissions = (...perms: string[]) => SetMetadata(PERMISSIONS, perms);

/** Inject the authenticated actor into a handler. */
export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<Request & { actor?: Actor }>();
  return req.actor ?? { kind: "anonymous" };
});
