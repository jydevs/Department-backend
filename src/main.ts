import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { cleanupOpenApiDoc } from "nestjs-zod";
import { AppModule } from "./app.module";
import { ENV } from "./config/config.module";
import { requestContextMiddleware } from "./common/context/request-context";
import { Env, loadDotEnv } from "./config/env";

/** Global prefix for the versioned API. Ops endpoints stay at the root. */
export const API_PREFIX = "api/v1";
const UNPREFIXED = ["health", "ready", "version", "media/*path", "webhooks/*path"];

async function bootstrap() {
  loadDotEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true });
  const env = app.get<Env>(ENV);
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();

  if (env.NODE_ENV === "production" && !env.REQUIRE_STAFF_2FA) {
    logger.warn("REQUIRE_STAFF_2FA=false in production: owners/admins can operate the panel WITHOUT two-factor authentication. Leave it unset (default true) unless this is deliberate.");
  }

  if (env.TRUST_PROXY !== false) app.set("trust proxy", env.TRUST_PROXY);
  app.useBodyParser("json", { limit: "1mb" });
  app.use(requestContextMiddleware);
  app.disable("x-powered-by");

  // Swagger UI needs inline scripts: relax the CSP only on /docs, keep it strict everywhere else.
  const strict = helmet();
  const relaxed = helmet({ contentSecurityPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) => (env.DOCS_ENABLED && req.path.startsWith("/docs") ? relaxed : strict)(req, res, next));

  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id", "Idempotency-Key", "If-Match", "X-Cart-Token", "X-Quote-Email"],
    exposedHeaders: ["X-Request-Id", "Retry-After", "ETag"],
    maxAge: 600,
  });

  app.setGlobalPrefix(API_PREFIX, { exclude: UNPREFIXED });

  if (env.DOCS_ENABLED) {
    const config = new DocumentBuilder()
      .setTitle("Daregular Dept. API")
      .setDescription("Storefront (público) y Admin (personal con permisos). Ver docs/PLAN.md.")
      .setVersion("0.1.0")
      .addBearerAuth()
      .build();
    const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
    SwaggerModule.setup("docs", app, document, { jsonDocumentUrl: "docs-json" });
  }

  await app.listen(env.PORT);
  logger.log(`API listening on ${env.PUBLIC_URL} (env=${env.NODE_ENV}, docs=${env.DOCS_ENABLED ? "on" : "off"})`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
