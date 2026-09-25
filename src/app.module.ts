import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_PIPE } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { ZodValidationPipe } from "nestjs-zod";
import { ClockModule } from "./common/clock/clock";
import { StorefrontThrottlerGuard } from "./common/throttle/storefront-throttler.guard";
import { AllExceptionsFilter } from "./common/errors/all-exceptions.filter";
import { AppConfigModule, ENV } from "./config/config.module";
import type { Env } from "./config/env";
import { DatabaseModule } from "./database/database.module";
import { AuditModule } from "./audit/audit.module";
import { AuthGuard } from "./identity/auth/auth.guard";
import { PermissionsGuard } from "./identity/auth/permissions.guard";
import { IdentityModule } from "./identity/identity.module";
import { HealthModule } from "./health/health.module";

/** Accept a caller-supplied request id only if it is short and made of safe characters. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,100}$/;

@Module({
  imports: [
    AppConfigModule,

    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          genReqId: (req, res) => {
            const incoming = req.headers["x-request-id"];
            const id = typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
            res.setHeader("x-request-id", id);
            return id;
          },
          // credentials never reach the logs
          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              'req.headers["x-api-key"]',
              'req.headers["x-storefront-key"]',
              'req.headers["x-event-checksum"]',
              'res.headers["set-cookie"]',
            ],
            censor: "[redacted]",
          },
          // never log the query string (tokens, emails) — path only
          serializers: {
            req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: (req.url ?? "").split("?")[0] }),
          },
          // health probes are noise
          autoLogging: { ignore: (req) => ["/health", "/ready"].includes(req.url ?? "") },
          transport: env.NODE_ENV === "development" ? { target: "pino-pretty", options: { singleLine: true } } : undefined,
        },
      }),
    }),

    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => [{ name: "default", ttl: env.THROTTLE_TTL_MS, limit: env.THROTTLE_LIMIT }],
    }),

    ClockModule,
    DatabaseModule,
    HealthModule,
    AuditModule,
    IdentityModule,
  ],
  providers: [
    // every request body/query/params is validated with Zod (DTOs from createZodDto)
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // order matters: throttle first (cheap), then who you are, then what you may do
    { provide: APP_GUARD, useClass: StorefrontThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
