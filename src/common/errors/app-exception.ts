import { HttpException } from "@nestjs/common";

/** Stable machine-readable codes the clients (storefront, admin) can switch on. Extend per phase. */
export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "CONCURRENT_UPDATE"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "IDEMPOTENCY_KEY_REUSED"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "INSUFFICIENT_STOCK"
  | "PAYMENT_FAILED"
  | "INVALID_CREDENTIALS"
  | "TWO_FACTOR_REQUIRED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR"
  | (string & {}); // phases may add their own domain codes

/**
 * The only exception feature code should throw for expected failures.
 * Carries a stable `code` + optional `details`; the filter renders it uniformly.
 */
export class AppException extends HttpException {
  constructor(
    status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super({ code, message, ...(details !== undefined ? { details } : {}) }, status);
  }

  static badRequest(code: ErrorCode, message: string, details?: unknown) {
    return new AppException(400, code, message, details);
  }
  static unauthorized(message = "Authentication required", code: ErrorCode = "UNAUTHORIZED") {
    return new AppException(401, code, message);
  }
  static forbidden(message = "You do not have permission to do this", details?: unknown) {
    return new AppException(403, "FORBIDDEN", message, details);
  }
  static notFound(what = "Resource") {
    return new AppException(404, "NOT_FOUND", `${what} not found`);
  }
  static conflict(code: ErrorCode, message: string, details?: unknown) {
    return new AppException(409, code, message, details);
  }
  static unavailable(message = "Service temporarily unavailable") {
    return new AppException(503, "SERVICE_UNAVAILABLE", message);
  }
}
