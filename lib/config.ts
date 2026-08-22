import { z } from "zod";

// ─── Schemas ────────────────────────────────────────────────────────────────

export const serverSchema = z.object({
  SENTRY_ORG: z.string().default(''),
  SENTRY_PROJECT: z.string().default(''),
  CSP_ENFORCE: z.coerce.boolean().default(false),
  AUTH_RATE_LIMIT_ENABLED: z.coerce.boolean().default(true),
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
  RESEND_WEBHOOK_SECRET: z.string().default(''),
  EMAIL_PROVIDER: z.enum(['resend', 'mock']).default(process.env.NODE_ENV === 'test' ? 'mock' : 'resend'),
  EMAIL_FROM: z.string().email().default('hello@mail.sosh.app'),
  EMAIL_REPLY_TO: z.string().email().default('support@sosh.app'),
  EMAIL_DRAIN_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  EMAIL_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  EMAIL_RETRY_BACKOFF_SECONDS: z.coerce.number().int().positive().default(60),
  EMAIL_SENDING_STUCK_MINUTES: z.coerce.number().int().positive().default(10),
  OAUTH_STATE_SECRET: z.string().min(32, "OAUTH_STATE_SECRET must be at least 32 characters"),
  INVITE_TOKEN_SECRET: z.string().min(32, "INVITE_TOKEN_SECRET must be at least 32 characters"),
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
  // ADR 0022 §3.4 (Session 29, F1b.3) — promote's claim staleness window.
  // Unlike POST_GENERATION_SESSION_STALE_MINUTES (which spans an LLM call),
  // the claim only has to outlive createCampaign (one INSERT) and the
  // write-back (one guarded UPDATE) — no LLM call sits inside this window;
  // assembleBrief runs AFTER the write-back and does not need to fit here.
  // Worst-case latency for two sequential Postgres round-trips, even under
  // connection-pool contention or a retried request, is low single-digit
  // seconds. 5 minutes is a two-orders-of-magnitude margin over that.
  PROMOTE_CLAIM_STALE_MINUTES: z.coerce.number().int().positive().default(5),
  DELETION_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  DELETION_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  DELETION_RETRY_BACKOFF_BASE_MINUTES: z.coerce.number().int().positive().default(60),
  // ADR 0018 §9.5 (C2.8) — the learning capture tick's tunables, matching
  // this file's <DOMAIN>_BATCH_SIZE / <DOMAIN>_MAX_ATTEMPTS /
  // <DOMAIN>_RETRY_BACKOFF_SECONDS naming convention.
  LEARNING_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  LEARNING_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LEARNING_RETRY_BACKOFF_SECONDS: z.coerce.number().int().positive().default(300),
  LEARNING_SUMMARY_MIN_SIGNALS: z.coerce.number().int().positive().default(20),
  LEARNING_SUMMARY_MIN_INTERVAL_DAYS: z.coerce.number().int().positive().default(7),
  LEARNING_SUMMARY_MAX_INPUT_TOKENS: z.coerce.number().int().positive().default(12000),
  LEARNING_SUMMARY_MAX_MONTHLY_CALLS_PER_BUSINESS: z.coerce.number().int().positive().default(8),
  // ADR 0021 §3.1 (Session 28 E5.3) — Mode 3 triage's daily cost ceiling.
  // 5 x 22c worst case = 110c, so the full TRIAGE_SHORTLIST_PER_TICK shortlist
  // fits with headroom and the cap binds only on pathology (§3.1).
  TRIAGE_DAILY_CAP_CENTS: z.coerce.number().int().positive().default(125),
  LINKEDIN_CLIENT_ID: z.string().default(''),
  LINKEDIN_CLIENT_SECRET: z.string().default(''),
  X_CLIENT_ID: z.string().default(''),
  X_CLIENT_SECRET: z.string().default(''),
  META_APP_ID: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
  CRON_TRIGGER: z.enum(['qstash', 'secret']).default('secret'),
  QSTASH_CURRENT_SIGNING_KEY: z.string().min(1).optional(),
  QSTASH_NEXT_SIGNING_KEY: z.string().min(1).optional(),
  // ADR 0020 §2.2 — GitHub App credentials for Mode 3 signal ingestion.
  // [Session 27-D / A-4 amendment, MAJOR-3] The four load-bearing fields
  // below (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_CLIENT_ID,
  // GITHUB_APP_CLIENT_SECRET) are now `.optional()`, NOT unconditionally
  // required. The prior E2.3 shape (bare `z.string().min(1)`, no
  // superRefine) made every environment lacking all four boot-fail —
  // exactly what reddened both Session 27 CI jobs at the range head, fixed
  // only outside the audited range by pasting dummy values into two
  // workflow YAMLs. That coupled every unrelated CI job, preview deploy and
  // contributor checkout to an opt-in feature no tenant uses. The
  // superRefine below restores fail-fast where it actually belongs:
  // required TOGETHER in production, and an error in EVERY environment if
  // only some of the four are set (a partial paste is never a supported
  // mode). GITHUB_APP_SLUG is NOT part of this co-required set — it stays
  // independently optional via its own default(''), unchanged: it is
  // cosmetic (a human-facing install URL), never a security boundary, and
  // requiring it alongside the other four would make a fully-configured
  // deployment that simply never set a slug fail parse for no reason.
  GITHUB_APP_ID: z.string().min(1, "GITHUB_APP_ID is required").optional(),
  GITHUB_APP_SLUG: z.string().default(''),
  // [sec-MEDIUM-5] — validated AT PARSE TIME, not first use, WHENEVER a
  // value is present. This contract is unconditional and survives the
  // optionality amendment above untouched: `.optional()` short-circuits
  // Zod validation only for `undefined`, so a present-but-malformed key
  // still fails parse in every environment, including development. Without
  // it, a truncated or mis-pasted key fails at the FIRST POLLER TICK, up to
  // an hour later, inside a background cron whose only output is one
  // structured log line — exactly the silent failure L-11 forbids.
  // Validating here preserves parseServerEnv()'s existing fail-fast
  // contract instead of deferring the decode into lib/signals/.
  //
  // BASE64-ENCODED, not a raw multi-line PEM. Two losers, both recorded:
  //   - Raw multi-line PEM as the env var value: no multi-line/PEM
  //     precedent exists anywhere in this file (every entry above is a
  //     single-line scalar), and PEM newlines surviving through .env files,
  //     shell exports, and platform env-var UIs (which often collapse or
  //     escape newlines) is a well-known operational trap.
  //   - Deferring the decode/validation into lib/signals/ (validate at
  //     first poller use instead of here): breaks parseServerEnv()'s
  //     fail-fast contract — see [sec-MEDIUM-5] above.
  GITHUB_APP_PRIVATE_KEY: z.string().min(1, "GITHUB_APP_PRIVATE_KEY is required").refine((val) => {
    // [NIT-1] Buffer.from(val, 'base64') never throws on malformed input —
    // Node silently discards invalid characters instead of raising, so a
    // try/catch here has nothing to catch. Rejection is carried entirely by
    // the PEM regex below.
    const decoded = Buffer.from(val, 'base64').toString('utf8')
    return /-----BEGIN (RSA )?PRIVATE KEY-----/.test(decoded)
  }, {
    message: 'GITHUB_APP_PRIVATE_KEY must be base64-encoded and decode to a PEM private key matching -----BEGIN (RSA )?PRIVATE KEY-----',
  }).optional(),
  GITHUB_APP_CLIENT_ID: z.string().min(1, "GITHUB_APP_CLIENT_ID is required").optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().min(1, "GITHUB_APP_CLIENT_SECRET is required").optional(),
}).superRefine((data, ctx) => {
  if (
    data.CRON_TRIGGER === 'qstash' &&
    process.env.NODE_ENV === 'production' &&
    (!data.QSTASH_CURRENT_SIGNING_KEY || !data.QSTASH_NEXT_SIGNING_KEY)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY are both required when CRON_TRIGGER=qstash in production',
    })
  }
  if (
    data.EMAIL_PROVIDER === 'resend' &&
    process.env.NODE_ENV === 'production' &&
    (!data.RESEND_API_KEY || !data.RESEND_WEBHOOK_SECRET)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'RESEND_API_KEY and RESEND_WEBHOOK_SECRET are both required when EMAIL_PROVIDER=resend in production',
    })
  }
  // ADR 0020 §2.2 amendment (Session 27-D / A-4, MAJOR-3) — the four
  // load-bearing GITHUB_APP_* credentials. Required together in
  // production; a partial set (some present, some absent) is an error in
  // EVERY environment, since 1-of-4 present is always a mis-paste, never a
  // supported mode.
  const githubAppKeys = [
    'GITHUB_APP_ID',
    'GITHUB_APP_CLIENT_ID',
    'GITHUB_APP_CLIENT_SECRET',
    'GITHUB_APP_PRIVATE_KEY',
  ] as const
  const presentGithubAppKeys = githubAppKeys.filter((key) => data[key] !== undefined)
  if (presentGithubAppKeys.length > 0 && presentGithubAppKeys.length < githubAppKeys.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `GITHUB_APP_ID, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET and GITHUB_APP_PRIVATE_KEY must be set together — partial GitHub App configuration (${presentGithubAppKeys.length} of ${githubAppKeys.length} present) is not valid in any environment`,
    })
  } else if (presentGithubAppKeys.length === 0 && process.env.NODE_ENV === 'production') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'GITHUB_APP_ID, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET and GITHUB_APP_PRIVATE_KEY are all required when NODE_ENV=production',
    })
  }
});

const publicSchema = z.object({
  NEXT_PUBLIC_SENTRY_DSN: z.string().default(''),
  SENTRY_ENVIRONMENT: z.string().default(''),
  VERCEL_GIT_COMMIT_SHA: z.string().default(''),
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
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? '',
  VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
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
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_REPLY_TO: process.env.EMAIL_REPLY_TO,
    EMAIL_DRAIN_BATCH_SIZE: process.env.EMAIL_DRAIN_BATCH_SIZE,
    EMAIL_MAX_ATTEMPTS: process.env.EMAIL_MAX_ATTEMPTS,
    EMAIL_RETRY_BACKOFF_SECONDS: process.env.EMAIL_RETRY_BACKOFF_SECONDS,
    EMAIL_SENDING_STUCK_MINUTES: process.env.EMAIL_SENDING_STUCK_MINUTES,
    OAUTH_STATE_SECRET: process.env.OAUTH_STATE_SECRET,
    INVITE_TOKEN_SECRET: process.env.INVITE_TOKEN_SECRET,
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
    PROMOTE_CLAIM_STALE_MINUTES: process.env.PROMOTE_CLAIM_STALE_MINUTES,
    DELETION_RETENTION_DAYS: process.env.DELETION_RETENTION_DAYS,
    DELETION_MAX_ATTEMPTS: process.env.DELETION_MAX_ATTEMPTS,
    DELETION_RETRY_BACKOFF_BASE_MINUTES: process.env.DELETION_RETRY_BACKOFF_BASE_MINUTES,
    LEARNING_BATCH_SIZE: process.env.LEARNING_BATCH_SIZE,
    LEARNING_MAX_ATTEMPTS: process.env.LEARNING_MAX_ATTEMPTS,
    LEARNING_RETRY_BACKOFF_SECONDS: process.env.LEARNING_RETRY_BACKOFF_SECONDS,
    LEARNING_SUMMARY_MIN_SIGNALS: process.env.LEARNING_SUMMARY_MIN_SIGNALS,
    LEARNING_SUMMARY_MIN_INTERVAL_DAYS: process.env.LEARNING_SUMMARY_MIN_INTERVAL_DAYS,
    LEARNING_SUMMARY_MAX_INPUT_TOKENS: process.env.LEARNING_SUMMARY_MAX_INPUT_TOKENS,
    LEARNING_SUMMARY_MAX_MONTHLY_CALLS_PER_BUSINESS: process.env.LEARNING_SUMMARY_MAX_MONTHLY_CALLS_PER_BUSINESS,
    TRIAGE_DAILY_CAP_CENTS: process.env.TRIAGE_DAILY_CAP_CENTS,
    LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID,
    LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET,
    X_CLIENT_ID: process.env.X_CLIENT_ID,
    X_CLIENT_SECRET: process.env.X_CLIENT_SECRET,
    META_APP_ID: process.env.META_APP_ID,
    META_APP_SECRET: process.env.META_APP_SECRET,
    METRICS_SYNC_BATCH_SIZE: process.env.METRICS_SYNC_BATCH_SIZE,
    METRICS_STALE_MINUTES: process.env.METRICS_STALE_MINUTES,
    METRICS_MAX_AGE_DAYS: process.env.METRICS_MAX_AGE_DAYS,
    SENTRY_ORG: process.env.SENTRY_ORG,
    SENTRY_PROJECT: process.env.SENTRY_PROJECT,
    CSP_ENFORCE: process.env.CSP_ENFORCE,
    AUTH_RATE_LIMIT_ENABLED: process.env.AUTH_RATE_LIMIT_ENABLED,
    CRON_TRIGGER: process.env.CRON_TRIGGER,
    QSTASH_CURRENT_SIGNING_KEY: process.env.QSTASH_CURRENT_SIGNING_KEY,
    QSTASH_NEXT_SIGNING_KEY: process.env.QSTASH_NEXT_SIGNING_KEY,
    GITHUB_APP_ID: process.env.GITHUB_APP_ID,
    GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
    GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
    GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
    GITHUB_APP_CLIENT_SECRET: process.env.GITHUB_APP_CLIENT_SECRET,
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
    get RESEND_WEBHOOK_SECRET() {
      return serverOnly("RESEND_WEBHOOK_SECRET", () => server().RESEND_WEBHOOK_SECRET);
    },
    get EMAIL_PROVIDER() {
      return serverOnly("EMAIL_PROVIDER", () => server().EMAIL_PROVIDER);
    },
    get EMAIL_FROM() {
      return serverOnly("EMAIL_FROM", () => server().EMAIL_FROM);
    },
    get EMAIL_REPLY_TO() {
      return serverOnly("EMAIL_REPLY_TO", () => server().EMAIL_REPLY_TO);
    },
    get EMAIL_DRAIN_BATCH_SIZE() {
      return serverOnly("EMAIL_DRAIN_BATCH_SIZE", () => server().EMAIL_DRAIN_BATCH_SIZE);
    },
    get EMAIL_MAX_ATTEMPTS() {
      return serverOnly("EMAIL_MAX_ATTEMPTS", () => server().EMAIL_MAX_ATTEMPTS);
    },
    get EMAIL_RETRY_BACKOFF_SECONDS() {
      return serverOnly("EMAIL_RETRY_BACKOFF_SECONDS", () => server().EMAIL_RETRY_BACKOFF_SECONDS);
    },
    get EMAIL_SENDING_STUCK_MINUTES() {
      return serverOnly("EMAIL_SENDING_STUCK_MINUTES", () => server().EMAIL_SENDING_STUCK_MINUTES);
    },
    get OAUTH_STATE_SECRET() {
      return serverOnly("OAUTH_STATE_SECRET", () => server().OAUTH_STATE_SECRET);
    },
    get INVITE_TOKEN_SECRET() {
      return serverOnly("INVITE_TOKEN_SECRET", () => server().INVITE_TOKEN_SECRET);
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
    get PROMOTE_CLAIM_STALE_MINUTES() {
      return serverOnly("PROMOTE_CLAIM_STALE_MINUTES", () => server().PROMOTE_CLAIM_STALE_MINUTES);
    },
    get DELETION_RETENTION_DAYS() {
      return serverOnly("DELETION_RETENTION_DAYS", () => server().DELETION_RETENTION_DAYS);
    },
    get DELETION_MAX_ATTEMPTS() {
      return serverOnly("DELETION_MAX_ATTEMPTS", () => server().DELETION_MAX_ATTEMPTS);
    },
    get DELETION_RETRY_BACKOFF_BASE_MINUTES() {
      return serverOnly("DELETION_RETRY_BACKOFF_BASE_MINUTES", () => server().DELETION_RETRY_BACKOFF_BASE_MINUTES);
    },
    get LEARNING_BATCH_SIZE() {
      return serverOnly("LEARNING_BATCH_SIZE", () => server().LEARNING_BATCH_SIZE);
    },
    get LEARNING_MAX_ATTEMPTS() {
      return serverOnly("LEARNING_MAX_ATTEMPTS", () => server().LEARNING_MAX_ATTEMPTS);
    },
    get LEARNING_RETRY_BACKOFF_SECONDS() {
      return serverOnly("LEARNING_RETRY_BACKOFF_SECONDS", () => server().LEARNING_RETRY_BACKOFF_SECONDS);
    },
    get LEARNING_SUMMARY_MIN_SIGNALS() {
      return serverOnly("LEARNING_SUMMARY_MIN_SIGNALS", () => server().LEARNING_SUMMARY_MIN_SIGNALS);
    },
    get LEARNING_SUMMARY_MIN_INTERVAL_DAYS() {
      return serverOnly("LEARNING_SUMMARY_MIN_INTERVAL_DAYS", () => server().LEARNING_SUMMARY_MIN_INTERVAL_DAYS);
    },
    get LEARNING_SUMMARY_MAX_INPUT_TOKENS() {
      return serverOnly("LEARNING_SUMMARY_MAX_INPUT_TOKENS", () => server().LEARNING_SUMMARY_MAX_INPUT_TOKENS);
    },
    get LEARNING_SUMMARY_MAX_MONTHLY_CALLS_PER_BUSINESS() {
      return serverOnly("LEARNING_SUMMARY_MAX_MONTHLY_CALLS_PER_BUSINESS", () => server().LEARNING_SUMMARY_MAX_MONTHLY_CALLS_PER_BUSINESS);
    },
    get TRIAGE_DAILY_CAP_CENTS() {
      return serverOnly("TRIAGE_DAILY_CAP_CENTS", () => server().TRIAGE_DAILY_CAP_CENTS);
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
    get SENTRY_ORG() {
      return serverOnly("SENTRY_ORG", () => server().SENTRY_ORG);
    },
    get SENTRY_PROJECT() {
      return serverOnly("SENTRY_PROJECT", () => server().SENTRY_PROJECT);
    },
    get CSP_ENFORCE() {
      return serverOnly("CSP_ENFORCE", () => server().CSP_ENFORCE);
    },
    get AUTH_RATE_LIMIT_ENABLED() {
      return serverOnly("AUTH_RATE_LIMIT_ENABLED", () => server().AUTH_RATE_LIMIT_ENABLED);
    },
    get CRON_TRIGGER() {
      return serverOnly("CRON_TRIGGER", () => server().CRON_TRIGGER);
    },
    get QSTASH_CURRENT_SIGNING_KEY() {
      return serverOnly("QSTASH_CURRENT_SIGNING_KEY", () => server().QSTASH_CURRENT_SIGNING_KEY);
    },
    get QSTASH_NEXT_SIGNING_KEY() {
      return serverOnly("QSTASH_NEXT_SIGNING_KEY", () => server().QSTASH_NEXT_SIGNING_KEY);
    },
    get GITHUB_APP_ID() {
      return serverOnly("GITHUB_APP_ID", () => server().GITHUB_APP_ID);
    },
    get GITHUB_APP_SLUG() {
      return serverOnly("GITHUB_APP_SLUG", () => server().GITHUB_APP_SLUG);
    },
    get GITHUB_APP_PRIVATE_KEY() {
      return serverOnly("GITHUB_APP_PRIVATE_KEY", () => server().GITHUB_APP_PRIVATE_KEY);
    },
    get GITHUB_APP_CLIENT_ID() {
      return serverOnly("GITHUB_APP_CLIENT_ID", () => server().GITHUB_APP_CLIENT_ID);
    },
    get GITHUB_APP_CLIENT_SECRET() {
      return serverOnly("GITHUB_APP_CLIENT_SECRET", () => server().GITHUB_APP_CLIENT_SECRET);
    },
  },

  public: {
    SUPABASE_URL: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    APP_URL: publicEnv.NEXT_PUBLIC_APP_URL,
    STRIPE_PUBLISHABLE_KEY: publicEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NODE_ENV: publicEnv.NODE_ENV,
    SENTRY_DSN: publicEnv.NEXT_PUBLIC_SENTRY_DSN,
    SENTRY_ENVIRONMENT: publicEnv.SENTRY_ENVIRONMENT,
    VERCEL_GIT_COMMIT_SHA: publicEnv.VERCEL_GIT_COMMIT_SHA,
  },
} as const;
