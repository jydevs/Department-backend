import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { QueryFailedError } from "typeorm";
import { ZodValidationException } from "nestjs-zod";
import type { ZodError } from "zod";

/** Uniform error body for every failure. Never leaks stack traces or SQL. */
export interface ErrorBody {
  statusCode: number;
  error: string;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

/** PostgreSQL SQLSTATE codes we translate into client errors. */
const PG_UNIQUE_VIOLATION = "23505";
const PG_FOREIGN_KEY_VIOLATION = "23503";
const PG_NOT_NULL_VIOLATION = "23502";
const PG_CHECK_VIOLATION = "23514";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Exceptions");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string | number }>();
    const requestId = req.id !== undefined ? String(req.id) : undefined;

    const body = this.toBody(exception);
    body.requestId = requestId;

    if (body.statusCode >= 500) {
      this.logger.error({ err: exception, requestId, path: req.url }, "Unhandled error");
    }

    if (res.headersSent) return;
    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError() as ZodError;
      const issues = zodError.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
        code: i.code,
      }));
      return this.build(400, "VALIDATION_ERROR", "Request validation failed", issues);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message =
        typeof payload === "string"
          ? payload
          : Array.isArray((payload as { message?: unknown }).message)
            ? ((payload as { message: string[] }).message).join("; ")
            : ((payload as { message?: string }).message ?? exception.message);
      const code = (payload as { code?: string }).code ?? this.defaultCode(status);
      const details = (payload as { details?: unknown }).details;
      return this.build(status, code, message, details);
    }

    if (exception instanceof QueryFailedError) {
      const pgCode = (exception.driverError as { code?: string } | undefined)?.code;
      switch (pgCode) {
        case PG_UNIQUE_VIOLATION:
          return this.build(409, "CONFLICT", "A record with these values already exists");
        case PG_FOREIGN_KEY_VIOLATION:
          return this.build(409, "CONFLICT", "The record is referenced by, or references, another record");
        case PG_NOT_NULL_VIOLATION:
        case PG_CHECK_VIOLATION:
          return this.build(400, "VALIDATION_ERROR", "The data violates a database constraint");
        default:
          break;
      }
    }

    return this.build(500, "INTERNAL_ERROR", "Internal server error");
  }

  private build(statusCode: number, code: string, message: string, details?: unknown): ErrorBody {
    return {
      statusCode,
      error: STATUS_TEXT[statusCode] ?? HttpStatus[statusCode] ?? "Error",
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    };
  }

  private defaultCode(status: number): string {
    switch (status) {
      case 400:
        return "BAD_REQUEST";
      case 401:
        return "UNAUTHORIZED";
      case 403:
        return "FORBIDDEN";
      case 404:
        return "NOT_FOUND";
      case 409:
        return "CONFLICT";
      case 429:
        return "RATE_LIMITED";
      default:
        return status >= 500 ? "INTERNAL_ERROR" : "ERROR";
    }
  }
}
