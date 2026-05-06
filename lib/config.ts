import { z } from "zod";

// ─── Schemas ────────────────────────────────────────────────────────────────

const serverSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  // Direct Postgres connection string — required for migration scripts.
  // Found in: Supabase Dashboard → Project Settings → Database → Connection string (URI).
  DATABASE_URL: z.string().default(""),
  POSTIZ_BASE_URL: z.string().default(""),
  POSTIZ_API_KEY: z.string().default(""),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  RESEND_API_KEY: z.string().default(""),
  OAUTH_STATE_SECRET: z.string().min(32, "OAUTH_STATE_SECRET must be at least 32 characters"),
  SOCIAL_PROVIDER_MODE: z.string().default(""),
  HEALTHCHECK_TOKEN: z.string().default(""),
});

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_URL is required"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

// ─── Parsed values ───────────────────────────────────────────────────────────

const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NODE_ENV: process.env.NODE_ENV,
});

// Server env is only parsed on the server. On the client this object is never
// accessed — the getters below throw before Zod ever runs.
function parseServerEnv() {
  return serverSchema.parse({
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
    POSTIZ_BASE_URL: process.env.POSTIZ_BASE_URL,
    POSTIZ_API_KEY: process.env.POSTIZ_API_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    OAUTH_STATE_SECRET: process.env.OAUTH_STATE_SECRET,
    SOCIAL_PROVIDER_MODE: process.env.SOCIAL_PROVIDER_MODE,
    HEALTHCHECK_TOKEN: process.env.HEALTHCHECK_TOKEN,
  });
}

// ─── Client-side guard ───────────────────────────────────────────────────────

function serverOnly<T>(key: string, getValue: () => T): T {
  if (typeof window !== "undefined") {
    throw new Error(
      `config.server.${key} was accessed in browser code. ` +
        `Server-only environment variables must not be read client-side.`
    );
  }
  return getValue();
}

// Parsed once per server process (cached at module level after first access).
let _server: z.infer<typeof serverSchema> | undefined;
function server() {
  if (!_server) _server = parseServerEnv();
  return _server;
}

// ─── Exported config ─────────────────────────────────────────────────────────

export const config = {
  server: {
    get ANTHROPIC_API_KEY() {
      return serverOnly("ANTHROPIC_API_KEY", () => server().ANTHROPIC_API_KEY);
    },
    get SUPABASE_SERVICE_ROLE_KEY() {
      return serverOnly(
        "SUPABASE_SERVICE_ROLE_KEY",
        () => server().SUPABASE_SERVICE_ROLE_KEY
      );
    },
    get DATABASE_URL() {
      return serverOnly("DATABASE_URL", () => server().DATABASE_URL);
    },
    get POSTIZ_BASE_URL() {
      return serverOnly("POSTIZ_BASE_URL", () => server().POSTIZ_BASE_URL);
    },
    get POSTIZ_API_KEY() {
      return serverOnly("POSTIZ_API_KEY", () => server().POSTIZ_API_KEY);
    },
    get STRIPE_SECRET_KEY() {
      return serverOnly(
        "STRIPE_SECRET_KEY",
        () => server().STRIPE_SECRET_KEY
      );
    },
    get STRIPE_WEBHOOK_SECRET() {
      return serverOnly(
        "STRIPE_WEBHOOK_SECRET",
        () => server().STRIPE_WEBHOOK_SECRET
      );
    },
    get RESEND_API_KEY() {
      return serverOnly("RESEND_API_KEY", () => server().RESEND_API_KEY);
    },
    get OAUTH_STATE_SECRET() {
      return serverOnly("OAUTH_STATE_SECRET", () => server().OAUTH_STATE_SECRET);
    },
    get SOCIAL_PROVIDER_MODE() {
      return serverOnly("SOCIAL_PROVIDER_MODE", () => server().SOCIAL_PROVIDER_MODE);
    },
    get HEALTHCHECK_TOKEN() {
      return serverOnly("HEALTHCHECK_TOKEN", () => server().HEALTHCHECK_TOKEN);
    },
  },

  public: {
    SUPABASE_URL: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    APP_URL: publicEnv.NEXT_PUBLIC_APP_URL,
    NODE_ENV: publicEnv.NODE_ENV,
  },
} as const;
