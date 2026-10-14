import { z } from "zod";

const boolish = z
  .enum(["1", "0", "true", "false"])
  .transform((v) => v === "1" || v === "true");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(2567),
    HOST: z.string().default("0.0.0.0"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    /** Set to 1 only when running behind a trusted reverse proxy (so client IPs and rate limits are correct). */
    TRUST_PROXY: boolish.default(false),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    /** Comma-separated list of browser origins allowed to call the API / open WebSockets. */
    ALLOWED_ORIGINS: z
      .string()
      .default("http://localhost:5173")
      .transform((v) =>
        v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),

    // --- Authentication -----------------------------------------------------
    /** e.g. https://<project>.supabase.co/auth/v1 — JWTs are verified against its JWKS. */
    SUPABASE_JWT_ISSUER: z.string().url().optional(),
    SUPABASE_JWKS_URL: z.string().url().optional(),
    SUPABASE_JWT_AUDIENCE: z.string().default("authenticated"),

    /** Local development / test only. Must be unset in production. */
    DEV_AUTH: boolish.default(false),
    DEV_AUTH_SECRET: z.string().min(32).optional(),

    // --- Gameplay timing ----------------------------------------------------
    TURN_TIMEOUT_SECONDS: z.coerce.number().int().min(5).default(60),
    RECONNECT_GRACE_SECONDS: z.coerce.number().int().min(5).default(60),
    PRIVATE_ROOM_IDLE_MINUTES: z.coerce.number().int().min(1).default(15),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production") {
      if (env.DEV_AUTH) {
        ctx.addIssue({ code: "custom", path: ["DEV_AUTH"], message: "DEV_AUTH must be disabled in production" });
      }
      if (!env.SUPABASE_JWT_ISSUER || !env.SUPABASE_JWKS_URL) {
        ctx.addIssue({
          code: "custom",
          path: ["SUPABASE_JWKS_URL"],
          message: "SUPABASE_JWT_ISSUER and SUPABASE_JWKS_URL are required in production",
        });
      }
      if (env.ALLOWED_ORIGINS.some((o) => o === "*")) {
        ctx.addIssue({ code: "custom", path: ["ALLOWED_ORIGINS"], message: "wildcard origins are not allowed in production" });
      }
    }
    if (env.DEV_AUTH && !env.DEV_AUTH_SECRET) {
      ctx.addIssue({ code: "custom", path: ["DEV_AUTH_SECRET"], message: "DEV_AUTH_SECRET (>=32 chars) is required when DEV_AUTH is on" });
    }
    if (!env.DEV_AUTH && !(env.SUPABASE_JWT_ISSUER && env.SUPABASE_JWKS_URL)) {
      ctx.addIssue({
        code: "custom",
        path: ["SUPABASE_JWKS_URL"],
        message: "configure Supabase JWT verification (SUPABASE_JWT_ISSUER + SUPABASE_JWKS_URL) or enable DEV_AUTH for local development",
      });
    }
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
