import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { cleanupOpenApiDoc } from "nestjs-zod";
import { AppModule } from "./app.module";
import { ENV } from "./config/config.module";
import { Env, loadDotEnv } from "./config/env";

/** Global prefix for the versioned API. Ops endpoints stay at the root. */
export const API_PREFIX = "api/v1";
const UNPREFIXED = ["health", "ready", "version"];

async function bootstrap() {
  loadDotEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const env = app.get<Env>(ENV);
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();

  if (env.TRUST_PROXY) app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // Swagger UI needs inline scripts; the JSON API itself has no use for a CSP.
  app.use(helmet({ contentSecurityPolicy: env.DOCS_ENABLED ? false : undefined }));

  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id"],
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
