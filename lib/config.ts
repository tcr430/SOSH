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
  STRIPE_SECRET_KEY: z.string().min(20).startsWith('sk_'),
  STRIPE_WEBHOOK_SECRET: z.string().min(20).startsWith('whsec_'),
  STRIPE_PRICE_ID_PLUS: z.string().min(10).startsWith('price_'),
  STRIPE_PRICE_ID_PRO: z.string().min(10).startsWith('price_'),
  RESEND_API_KEY: z.string().default(""),
  OAUTH_STATE_SECRET: z.string().min(32, "OAUTH_STATE_SECRET must be at least 32 characters"),
  SOCIAL_PROVIDER_MODE: z.string().default(""),
  HEALTHCHECK_TOKEN: z.string().default(""),
  APP_URL: z.string().url().default("http://localhost:3000"),
  AI_PROVIDER: z.enum(["anthropic", "mock"]).default("anthropic"),
  AI_RATE_LIMIT_BRAND_VOICE_PER_MIN: z.coerce.number().int().positive().default(10),
  AI_RATE_LIMIT_POST_GENERATION_PER_MIN: z.coerce.number().int().positive().default(30),
  AI_TRIAL_BRAND_VOICE_ATTEMPTS: z.coerce.number().int().positive().default(3),
  AI_TRIAL_POST_CAP: z.coerce.number().int().positive().default(50),
  AI_TRIAL_CAMPAIGN_CAP: z.coerce.number().int().positive().default(1),
  AI_WEBSITE_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  AI_WEBSITE_FETCH_MAX_BYTES: z.coerce.number().int().positive().default(512000),
  POST_GENERATION_POLL_MAX_SECONDS: z.coerce.number().int().positive().default(120),
  PUBLISH_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  CRON_SECRET: z.string().superRefine((val, ctx) => {
    if (process.env.NODE_ENV === 'production' && val.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CRON_SECRET must be at least 32 characters in production',
      })
    }
  }).default(''),
  PUBLISH_BATCH_SIZE: z.coerce.number().int().positive().default(25),
  PUBLISH_RETRY_BACKOFF_SECONDS: z.coerce.number().int().positive().default(60),
  PUBLISH_STUCK_MINUTES: z.coerce.number().int().positive().default(10),
  METRICS_SYNC_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  METRICS_STALE_MINUTES: z.coerce.number().int().positive().default(360),
  METRICS_MAX_AGE_DAYS: z.coerce.number().int().positive().default(90),
  POST_GENERATION_SESSION_STALE_MINUTES: z.coerce.number().int().positive().default(15),
  LINKEDIN_CLIENT_ID: z.string().default(''),
  LINKEDIN_CLIENT_SECRET: z.string().default(''),
  X_CLIENT_ID: z.string().default(''),
  X_CLIENT_SECRET: z.string().default(''),
  META_APP_ID: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
});

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_URL is required"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(20).startsWith('pk_'),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

// ─── Parsed values ───────────────────────────────────────────────────────────

const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
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
    STRIPE_PRICE_ID_PLUS: process.env.STRIPE_PRICE_ID_PLUS,
    STRIPE_PRICE_ID_PRO: process.env.STRIPE_PRICE_ID_PRO,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    OAUTH_STATE_SECRET: process.env.OAUTH_STATE_SECRET,
    SOCIAL_PROVIDER_MODE: process.env.SOCIAL_PROVIDER_MODE,
    HEALTHCHECK_TOKEN: process.env.HEALTHCHECK_TOKEN,
    APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_RATE_LIMIT_BRAND_VOICE_PER_MIN: process.env.AI_RATE_LIMIT_BRAND_VOICE_PER_MIN,
    AI_RATE_LIMIT_POST_GENERATION_PER_MIN: process.env.AI_RATE_LIMIT_POST_GENERATION_PER_MIN,
    AI_TRIAL_BRAND_VOICE_ATTEMPTS: process.env.AI_TRIAL_BRAND_VOICE_ATTEMPTS,
    AI_TRIAL_POST_CAP: process.env.AI_TRIAL_POST_CAP,
    AI_TRIAL_CAMPAIGN_CAP: process.env.AI_TRIAL_CAMPAIGN_CAP,
    AI_WEBSITE_FETCH_TIMEOUT_MS: process.env.AI_WEBSITE_FETCH_TIMEOUT_MS,
    AI_WEBSITE_FETCH_MAX_BYTES: process.env.AI_WEBSITE_FETCH_MAX_BYTES,
    POST_GENERATION_POLL_MAX_SECONDS: process.env.POST_GENERATION_POLL_MAX_SECONDS,
    PUBLISH_MAX_ATTEMPTS: process.env.PUBLISH_MAX_ATTEMPTS,
    CRON_SECRET: process.env.CRON_SECRET,
    PUBLISH_BATCH_SIZE: process.env.PUBLISH_BATCH_SIZE,
    PUBLISH_RETRY_BACKOFF_SECONDS: process.env.PUBLISH_RETRY_BACKOFF_SECONDS,
    PUBLISH_STUCK_MINUTES: process.env.PUBLISH_STUCK_MINUTES,
    POST_GENERATION_SESSION_STALE_MINUTES: process.env.POST_GENERATION_SESSION_STALE_MINUTES,
    LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID,
    LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET,
    X_CLIENT_ID: process.env.X_CLIENT_ID,
    X_CLIENT_SECRET: process.env.X_CLIENT_SECRET,
    META_APP_ID: process.env.META_APP_ID,
    META_APP_SECRET: process.env.META_APP_SECRET,
    METRICS_SYNC_BATCH_SIZE: process.env.METRICS_SYNC_BATCH_SIZE,
    METRICS_STALE_MINUTES: process.env.METRICS_STALE_MINUTES,
    METRICS_MAX_AGE_DAYS: process.env.METRICS_MAX_AGE_DAYS,
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
    get STRIPE_PRICE_ID_PLUS() {
      return serverOnly("STRIPE_PRICE_ID_PLUS", () => server().STRIPE_PRICE_ID_PLUS);
    },
    get STRIPE_PRICE_ID_PRO() {
      return serverOnly("STRIPE_PRICE_ID_PRO", () => server().STRIPE_PRICE_ID_PRO);
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
    get APP_URL() {
      return serverOnly("APP_URL", () => server().APP_URL);
    },
    get AI_PROVIDER() {
      return serverOnly("AI_PROVIDER", () => server().AI_PROVIDER);
    },
    get AI_RATE_LIMIT_BRAND_VOICE_PER_MIN() {
      return serverOnly("AI_RATE_LIMIT_BRAND_VOICE_PER_MIN", () => server().AI_RATE_LIMIT_BRAND_VOICE_PER_MIN);
    },
    get AI_RATE_LIMIT_POST_GENERATION_PER_MIN() {
      return serverOnly("AI_RATE_LIMIT_POST_GENERATION_PER_MIN", () => server().AI_RATE_LIMIT_POST_GENERATION_PER_MIN);
    },
    get AI_TRIAL_BRAND_VOICE_ATTEMPTS() {
      return serverOnly("AI_TRIAL_BRAND_VOICE_ATTEMPTS", () => server().AI_TRIAL_BRAND_VOICE_ATTEMPTS);
    },
    get AI_TRIAL_POST_CAP() {
      return serverOnly("AI_TRIAL_POST_CAP", () => server().AI_TRIAL_POST_CAP);
    },
    get AI_TRIAL_CAMPAIGN_CAP() {
      return serverOnly("AI_TRIAL_CAMPAIGN_CAP", () => server().AI_TRIAL_CAMPAIGN_CAP);
    },
    get AI_WEBSITE_FETCH_TIMEOUT_MS() {
      return serverOnly("AI_WEBSITE_FETCH_TIMEOUT_MS", () => server().AI_WEBSITE_FETCH_TIMEOUT_MS);
    },
    get AI_WEBSITE_FETCH_MAX_BYTES() {
      return serverOnly("AI_WEBSITE_FETCH_MAX_BYTES", () => server().AI_WEBSITE_FETCH_MAX_BYTES);
    },
    get POST_GENERATION_POLL_MAX_SECONDS() {
      return serverOnly("POST_GENERATION_POLL_MAX_SECONDS", () => server().POST_GENERATION_POLL_MAX_SECONDS);
    },
    get PUBLISH_MAX_ATTEMPTS() {
      return serverOnly("PUBLISH_MAX_ATTEMPTS", () => server().PUBLISH_MAX_ATTEMPTS);
    },
    get CRON_SECRET() {
      return serverOnly("CRON_SECRET", () => server().CRON_SECRET);
    },
    get PUBLISH_BATCH_SIZE() {
      return serverOnly("PUBLISH_BATCH_SIZE", () => server().PUBLISH_BATCH_SIZE);
    },
    get PUBLISH_RETRY_BACKOFF_SECONDS() {
      return serverOnly("PUBLISH_RETRY_BACKOFF_SECONDS", () => server().PUBLISH_RETRY_BACKOFF_SECONDS);
    },
    get PUBLISH_STUCK_MINUTES() {
      return serverOnly("PUBLISH_STUCK_MINUTES", () => server().PUBLISH_STUCK_MINUTES);
    },
    get POST_GENERATION_SESSION_STALE_MINUTES() {
      return serverOnly("POST_GENERATION_SESSION_STALE_MINUTES", () => server().POST_GENERATION_SESSION_STALE_MINUTES);
    },
    get LINKEDIN_CLIENT_ID() {
      return serverOnly("LINKEDIN_CLIENT_ID", () => server().LINKEDIN_CLIENT_ID);
    },
    get LINKEDIN_CLIENT_SECRET() {
      return serverOnly("LINKEDIN_CLIENT_SECRET", () => server().LINKEDIN_CLIENT_SECRET);
    },
    get X_CLIENT_ID() {
      return serverOnly("X_CLIENT_ID", () => server().X_CLIENT_ID);
    },
    get X_CLIENT_SECRET() {
      return serverOnly("X_CLIENT_SECRET", () => server().X_CLIENT_SECRET);
    },
    get META_APP_ID() {
      return serverOnly("META_APP_ID", () => server().META_APP_ID);
    },
    get META_APP_SECRET() {
      return serverOnly("META_APP_SECRET", () => server().META_APP_SECRET);
    },
    get METRICS_SYNC_BATCH_SIZE() {
      return serverOnly("METRICS_SYNC_BATCH_SIZE", () => server().METRICS_SYNC_BATCH_SIZE);
    },
    get METRICS_STALE_MINUTES() {
      return serverOnly("METRICS_STALE_MINUTES", () => server().METRICS_STALE_MINUTES);
    },
    get METRICS_MAX_AGE_DAYS() {
      return serverOnly("METRICS_MAX_AGE_DAYS", () => server().METRICS_MAX_AGE_DAYS);
    },
  },

  public: {
    SUPABASE_URL: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    APP_URL: publicEnv.NEXT_PUBLIC_APP_URL,
    STRIPE_PUBLISHABLE_KEY: publicEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NODE_ENV: publicEnv.NODE_ENV,
  },
} as const;
