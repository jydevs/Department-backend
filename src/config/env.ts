import { z } from "zod";

const bool = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .default(fallback ? "true" : "false")
    .transform((v) => v === "true" || v === "1");

const csv = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );

/**
 * Every environment variable the API reads. Validated once at boot: a missing or
 * malformed value stops the process with a readable list instead of failing later.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  /** postgres://user:pass@host:5432/db */
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  /** managed Postgres (Neon, Supabase, Railway…) usually requires TLS */
  DATABASE_SSL: bool(false),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  /** comma separated list of allowed browser origins (storefront + admin) */
  CORS_ORIGINS: csv("http://localhost:3000,http://localhost:3001"),
  PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  STOREFRONT_URL: z.string().url().default("http://localhost:3000"),
  ADMIN_URL: z.string().url().default("http://localhost:3001"),

  /** set behind a reverse proxy / load balancer so req.ip is the real client */
  TRUST_PROXY: bool(false),
  /** Swagger UI + /docs-json. On by default outside production. */
  DOCS_ENABLED: z.enum(["true", "false", "1", "0"]).optional(),

  THROTTLE_TTL_MS: z.coerce.number().int().min(1000).default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().min(1).default(120),

  /** injected by CI / deploy, shown by /version */
  GIT_SHA: z.string().optional(),
});

export type Env = Omit<z.infer<typeof schema>, "DOCS_ENABLED"> & { DOCS_ENABLED: boolean };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  const data = parsed.data;
  const docs =
    data.DOCS_ENABLED === undefined ? data.NODE_ENV !== "production" : data.DOCS_ENABLED === "true" || data.DOCS_ENABLED === "1";
  return { ...data, DOCS_ENABLED: docs };
}

/** Load `.env` (if present) into process.env. Real environment variables always win. */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    /* no .env file: rely on the real environment */
  }
}
