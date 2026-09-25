import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { QueryFailedError } from "typeorm";
import { ZodValidationException } from "nestjs-zod";
import { ZodError } from "zod";

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
  413: "Payload Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

const DEFAULT_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  429: "RATE_LIMITED",
  503: "SERVICE_UNAVAILABLE",
};

/** PostgreSQL SQLSTATE → client error. Anything not listed is a 500. */
const PG: Record<string, [status: number, code: string, message: string]> = {
  "23505": [409, "CONFLICT", "A record with these values already exists"],
  "23503": [409, "CONFLICT", "The record is referenced by, or references, another record"],
  "23502": [400, "VALIDATION_ERROR", "The data violates a database constraint"],
  "23514": [400, "VALIDATION_ERROR", "The data violates a database constraint"],
  "22P02": [400, "BAD_REQUEST", "Malformed value in request"], // invalid_text_representation (bad uuid…)
  "22001": [400, "VALIDATION_ERROR", "A value is too long"],
  "22003": [400, "VALIDATION_ERROR", "A number is out of range"],
  "40001": [409, "CONCURRENT_UPDATE", "The resource was modified concurrently, please retry"],
  "40P01": [409, "CONCURRENT_UPDATE", "The resource was modified concurrently, please retry"],
  "55P03": [409, "CONCURRENT_UPDATE", "The resource is locked by another operation, please retry"],
  "57014": [503, "SERVICE_UNAVAILABLE", "The request took too long"], // statement_timeout
};

/** Error shape thrown by express / body-parser / http-errors (413, 415, aborted, bad JSON…). */
interface HttpLikeError {
  status?: number;
  statusCode?: number;
  expose?: boolean;
  type?: string;
  message?: string;
}

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
      // sanitized: no SQL, no bound parameters, no query string (tokens/PII can live there)
      this.logger.error({ failure: this.safeError(exception), requestId, method: req.method, path: req.path }, "Unhandled error");
    }

    if (res.headersSent) return;
    res.status(body.statusCode).json(body);
  }

  private safeError(e: unknown) {
    if (e instanceof QueryFailedError) {
      const d = e.driverError as { code?: string; constraint?: string; table?: string; message?: string } | undefined;
      // the PG message names the problem ("syntax error at or near…") but never carries bound values
      return { type: "QueryFailedError", pgCode: d?.code, pgMessage: d?.message, constraint: d?.constraint, table: d?.table };
    }
    if (e instanceof Error) return { type: e.name, message: e.message, stack: e.stack };
    return { type: typeof e };
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError();
      if (zodError instanceof ZodError) {
        const issues = zodError.issues.map((i) => ({ path: i.path.join("."), message: i.message, code: i.code }));
        return this.build(400, "VALIDATION_ERROR", "Request validation failed", issues);
      }
      return this.build(400, "VALIDATION_ERROR", "Request validation failed");
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // never echo framework text for 5xx: it can carry internals
      if (status >= 500 && !(exception as { code?: unknown }).code) {
        return this.build(status, DEFAULT_CODES[status] ?? "INTERNAL_ERROR", status === 503 ? "Service temporarily unavailable" : "Internal server error");
      }
      const payload = exception.getResponse();
      const message =
        typeof payload === "string"
          ? payload
          : Array.isArray((payload as { message?: unknown }).message)
            ? (payload as { message: string[] }).message.join("; ")
            : ((payload as { message?: string }).message ?? exception.message);
      const code = (payload as { code?: string }).code ?? DEFAULT_CODES[status] ?? (status >= 500 ? "INTERNAL_ERROR" : "ERROR");
      const details = (payload as { details?: unknown }).details;
      return this.build(status, code, message, details);
    }

    if (exception instanceof QueryFailedError) {
      const pg = PG[(exception.driverError as { code?: string } | undefined)?.code ?? ""];
      if (pg) {
        this.logger.warn({ ...this.safeError(exception) }, "Database error mapped to client error");
        return this.build(pg[0], pg[1], pg[2]);
      }
    }

    // body-parser / http-errors: malformed JSON, payload too large, wrong content type, aborted request
    const http = exception as HttpLikeError;
    const status = http?.status ?? http?.statusCode;
    if (typeof status === "number" && status >= 400 && status < 500 && http.expose !== false) {
      const message =
        status === 413 ? "Request body is too large" : status === 415 ? "Unsupported content type" : http.type === "entity.parse.failed" ? "Malformed JSON body" : "Bad request";
      return this.build(status, DEFAULT_CODES[status] ?? "BAD_REQUEST", message);
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
}
