import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { AppException } from "../../common/errors/app-exception";

/** Reads the mandatory `X-Cart-Token` header (32 bytes base64url = 43 chars). */
export const CartToken = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const raw = ctx.switchToHttp().getRequest<Request>().headers["x-cart-token"];
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{20,128}$/.test(raw)) {
    throw AppException.badRequest("CART_TOKEN_REQUIRED", "The X-Cart-Token header is required");
  }
  return raw;
});
