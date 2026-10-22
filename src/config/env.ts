import { z } from "zod";

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

/** Express `trust proxy`: a hop count ("1", "2"…), a CIDR/IP list, or "false". Never a blanket "true". */
const trustProxy = z
  .string()
  .default("false")
  .transform((v): false | number | string => {
    if (v === "false" || v === "0") return false;
    if (/^\d+$/.test(v)) return Number(v);
    return v;
  })
  .refine((v) => v !== ("true" as unknown), "TRUST_PROXY=true would trust every client-supplied X-Forwarded-For; use a hop count or an IP/CIDR list");

const secret = (min: number) => z.string().min(min).optional();

/**
 * Every environment variable the API reads. Validated once at boot: a missing or
 * malformed value stops the process with a readable list instead of failing later.
 * Secrets are optional in development and REQUIRED in production (see superRefine).
 */
const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

    /** postgres://user:pass@host:5432/db  — TLS is configured with DATABASE_SSL, never with ?sslmode= */
    DATABASE_URL: z
      .string()
      .min(1, "DATABASE_URL is required")
      .refine((v) => !/sslmode=/i.test(v), "Remove ?sslmode= from DATABASE_URL and use DATABASE_SSL instead"),
    /** disable = plain TCP (local) · require = encrypted, cert not verified · verify-full = verified chain + hostname */
    DATABASE_SSL: z.enum(["disable", "require", "verify-full"]).default("disable"),
    /** PEM of the CA (only for verify-full when the host isn't signed by a system CA, e.g. Supabase) */
    DATABASE_CA_CERT: z.string().optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    /** comma separated list of allowed browser origins (storefront + admin) */
    CORS_ORIGINS: csv("http://localhost:3000,http://localhost:3001"),
    PUBLIC_URL: z.string().url().default("http://localhost:4000"),
    STOREFRONT_URL: z.string().url().default("http://localhost:3000"),
    ADMIN_URL: z.string().url().default("http://localhost:3001"),

    /** number of trusted proxy hops (Railway = 1, Cloudflare + Railway = 2) or an IP/CIDR list */
    TRUST_PROXY: trustProxy,
    /** Swagger UI + /docs-json. On by default outside production. */
    DOCS_ENABLED: z.enum(["true", "false", "1", "0"]).optional(),

    THROTTLE_TTL_MS: z.coerce.number().int().min(1000).default(60_000),
    /** dev only: login attempts/min/IP (read at import time by the controllers); production must keep 5 */
    AUTH_THROTTLE_LIMIT: z.coerce.number().int().min(1).max(1000).optional(),
    THROTTLE_LIMIT: z.coerce.number().int().min(1).default(120),

    /** injected by CI / deploy, shown by /version */
    GIT_SHA: z.string().optional(),

    /** where uploaded media is stored by the local-disk driver */
    UPLOAD_DIR: z.string().default("./uploads"),

    /* ── secrets used by later phases: optional in dev, required in production ── */
    JWT_ACCESS_SECRET: secret(32),
    /** base64 of 32 random bytes: encrypts stored third-party secrets (payment keys…) */
    ENCRYPTION_KEY: z.string().optional(),
    PREVIEW_TOKEN_SECRET: secret(32),
    /** shared with the storefront: signs the cache-revalidation webhook */
    STOREFRONT_REVALIDATE_SECRET: secret(32),
    /** the Next.js SERVER presents this so the API can rate-limit the real visitor IP, not the Next host */
    STOREFRONT_SERVER_KEY: secret(32),
    WOMPI_EVENTS_SECRET: z.string().optional(),
    WOMPI_PUBLIC_KEY: z.string().optional(),
    WOMPI_INTEGRITY_SECRET: z.string().optional(),
    WOMPI_API_URL: z.string().url().default("https://sandbox.wompi.co/v1"),
    /** `mock` never talks to a payment gateway (dev/test only); production must use `wompi` */
    PAYMENT_PROVIDER: z.enum(["mock", "wompi"]).default("mock"),
    /** e-mail: `log` records messages in the outbox only (dev/test); production must use `smtp` */
    MAIL_TRANSPORT: z.enum(["log", "smtp"]).default("log"),
    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default("Daregular Dept. <no-reply@daregulardept.com>"),
    /** customer JWT (separate from the staff one) */
    CUSTOMER_JWT_SECRET: secret(32),

    /** the mock payment provider can approve orders without paying: must be turned on explicitly, never in production */
    MOCK_PAYMENTS_ENABLED: z
      .enum(["true", "false", "1", "0"])
      .default("false")
      .transform((v) => v === "true" || v === "1"),

    /** how long an unpaid order keeps its stock reserved */
    ORDER_RESERVATION_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),

    /** on boot, create the default CMS documents (site settings, menus, templates, pages) that do not exist yet; never overwrites edits */
    SEED_DEFAULT_CONTENT: z
      .enum(["true", "false", "1", "0"])
      .default("true")
      .transform((v) => v === "true" || v === "1"),

    /* ── bootstrap: owner creation ── */
    OWNER_EMAIL: z.string().email().optional(),
    OWNER_PASSWORD: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });

    // every CORS entry must be a bare origin (scheme://host[:port])
    for (const origin of env.CORS_ORIGINS) {
      try {
        if (new URL(origin).origin !== origin) issue("CORS_ORIGINS", `"${origin}" must be an origin without path or trailing slash`);
      } catch {
        issue("CORS_ORIGINS", `"${origin}" is not a valid origin`);
      }
    }

    if (env.ENCRYPTION_KEY !== undefined && Buffer.from(env.ENCRYPTION_KEY, "base64").length !== 32) {
      issue("ENCRYPTION_KEY", "must be base64 of exactly 32 bytes (openssl rand -base64 32)");
    }

    if (env.NODE_ENV !== "production") return;

    // production must never boot with development settings
    for (const key of ["PUBLIC_URL", "STOREFRONT_URL", "ADMIN_URL"] as const) {
      if (!env[key].startsWith("https://")) issue(key, "must be an https:// URL in production");
    }
    for (const origin of env.CORS_ORIGINS) {
      if (!origin.startsWith("https://")) issue("CORS_ORIGINS", `"${origin}" must be https:// in production`);
    }
    if (env.AUTH_THROTTLE_LIMIT !== undefined && env.AUTH_THROTTLE_LIMIT !== 5) issue("AUTH_THROTTLE_LIMIT", "must be unset (or 5) in production");
    if (env.DOCS_ENABLED === "true" || env.DOCS_ENABLED === "1") issue("DOCS_ENABLED", "must not be enabled in production (it publishes the whole admin API surface); leave it unset");
    if (env.MOCK_PAYMENTS_ENABLED) issue("MOCK_PAYMENTS_ENABLED", "must be false in production");
    if (env.MAIL_TRANSPORT !== "smtp") issue("MAIL_TRANSPORT", "must be smtp in production");
    if (!env.SMTP_URL) issue("SMTP_URL", "is required in production");
    if (!env.CUSTOMER_JWT_SECRET) issue("CUSTOMER_JWT_SECRET", "is required in production");
    if (env.PAYMENT_PROVIDER !== "wompi") issue("PAYMENT_PROVIDER", "must be wompi in production");
    for (const key of ["WOMPI_PUBLIC_KEY", "WOMPI_INTEGRITY_SECRET", "WOMPI_EVENTS_SECRET"] as const) {
      if (!env[key]) issue(key, "is required in production");
    }
    // a sandbox/test Wompi setup in production would mark real orders as paid with test cards
    if (env.WOMPI_PUBLIC_KEY && !env.WOMPI_PUBLIC_KEY.startsWith("pub_prod_")) issue("WOMPI_PUBLIC_KEY", "must be a production key (pub_prod_...) in production");
    if (env.WOMPI_API_URL.toLowerCase().includes("sandbox")) issue("WOMPI_API_URL", "must not point to the sandbox in production (https://production.wompi.co/v1)");
    if (env.DATABASE_SSL === "disable") issue("DATABASE_SSL", "must be require or verify-full in production");
    if (env.TRUST_PROXY === false) issue("TRUST_PROXY", "must be set in production (proxy hop count), otherwise req.ip is the proxy's");
    for (const key of [
      "JWT_ACCESS_SECRET",
      "ENCRYPTION_KEY",
      "PREVIEW_TOKEN_SECRET",
      "STOREFRONT_REVALIDATE_SECRET",
      "STOREFRONT_SERVER_KEY",
    ] as const) {
      if (!env[key]) issue(key, "is required in production");
    }
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

/** Load `.env` into process.env. A missing file is fine; any other failure is real and must surface. */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
