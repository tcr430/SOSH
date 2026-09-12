# ADR 0010 — Evidence Pack

**Status:** Amended — Amendment A1 applied 2026-06-13  
**Date:** 2026-06-13 (Amendment A1: 2026-06-13)  
**Session:** 17 (Architect, Phase 0 + Amendment A1)  
**Evidence commit:** [AMENDMENT_HASH] (supersedes 5f7a2e4)  
**Purpose:** Ground-truth fact sheet for ADR 0010 legal pages (/terms, /privacy, /subprocessors, DPA).  
Every claim is cited to a file path and line number. No legal language. No posture recommendations.  
`[VERIFY: …]` marks facts that require Tiago's confirmation.

---

## §0 inputs still missing — required before Phase 1 can begin

Tiago must answer all ten of the following before Phase 1 (ADR 0010 prose) can start.
The Evidence Pack is complete without them; Phase 1 is not.

| # | Input needed | Where it appears in ADR 0010 |
|---|---|---|
| §0-1 | Legal entity name + jurisdiction of incorporation | ToS "Governing law", legal notices, DPA controller identification | Let's skip this for now, but consider portugal for jurisdiction
| §0-2 | Privacy / legal contact email (e.g. `privacy@sosh.app`) | Privacy Policy "Contact us" section | can you with that
| §0-3 | DPO decision — do we designate one? If yes, name/contact | Privacy Policy "Your rights" (GDPR Art. 37–39) | No yet
| §0-4 | AI-training posture choice — see E7 for the schema gap | Privacy Policy "How we use your data" + ADR 0010 §17 | 
| §0-5 | Refund posture — no refunds / pro-rata / 14-day cooling-off | ToS "Billing and refunds" | No refund
| §0-6 | Production domain (e.g. `sosh.app`) | ToS effective URL, DPA reference URL, legal notices | ok for now
| §0-7 | Data-location facts per subprocessor — see E9 for all gaps | Privacy Policy "International transfers" + subprocessor list | EU located
| §0-8 | Support email (`support@sosh.app`) and abuse email (`abuse@…`) confirmed live | Privacy Policy "Contact us", launch checklist §9 | Yes
| §0-9 | Security contact (`security@…` or `.well-known/security.txt` URL) | Privacy Policy "Contact us" | Yes
| §0-10 | DPA delivery method — "available on request" or public URL | Privacy Policy "DPA" reference, subprocessors page |

---

## E1 — Subprocessors actually in use

### Method
`package.json` dependencies + `lib/config.ts` env vars + SDK construction grep.

### Findings

**1. Supabase**
- Evidence: `package.json:31` (`@supabase/ssr: ^0.10.2`), `package.json:32` (`@supabase/supabase-js: ^2.105.1`)
- SDK construction: `lib/supabase/server.ts:10` (`createServerClient`), `lib/supabase/service.ts` (`createServiceRoleClient`)
- Config vars: `NEXT_PUBLIC_SUPABASE_URL` (`lib/config.ts:101`), `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`lib/config.ts:104`), `SUPABASE_SERVICE_ROLE_KEY` (`lib/config.ts:11`)
- Purpose in codebase: PostgreSQL database (all application tables), Supabase Auth (user accounts + session management), Supabase Vault (encrypted OAuth token storage)
- Region: [VERIFY: which region was selected when creating the Supabase project — EU-West, US-East, or other]

**2. Anthropic**
- Evidence: `package.json:19` (`@anthropic-ai/sdk: ^0.91.1`)
- SDK construction: `lib/ai/client.ts` (via `getAnthropicClient()` factory)
- Config var: `ANTHROPIC_API_KEY` (`lib/config.ts:10`)
- Purpose in codebase: AI post generation (`lib/ai/runner.ts`) and brand voice inference (`lib/ai/prompts/brand-voice-inference.ts`). Every call goes through `/lib/ai/` — no direct SDK calls elsewhere (CLAUDE.md constraint, enforced by ESLint `no-restricted-imports` on `@anthropic-ai/sdk`)
- Region: [VERIFY: Anthropic API is US-hosted; confirm whether EU data residency option is used or available]

**3. Stripe**
- Evidence: `package.json:50` (`stripe: ^22.1.1`)
- SDK construction: `lib/stripe/client.ts` (`getStripeClient()` singleton with `serverOnly()` guard)
- Config vars: `STRIPE_SECRET_KEY` (`lib/config.ts:19`), `STRIPE_WEBHOOK_SECRET` (`lib/config.ts:20`), `STRIPE_PRICE_ID_PLUS` (`lib/config.ts:21`), `STRIPE_PRICE_ID_PRO` (`lib/config.ts:22`), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`lib/config.ts:106`)
- Purpose in codebase: subscription billing (checkout, customer portal, webhook event processing). Handles: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed` (`lib/stripe/webhook.ts`)
- Data Stripe receives: customer email (collected during Checkout), card fingerprint (stored in `trial_state.trial_card_fingerprint`)
- Region: [VERIFY: Stripe entity used — Stripe Inc (US) or Stripe Payments Europe Ltd (Ireland)]

**4. Resend**
- Evidence: `package.json:48` (`resend: ^6.12.4`)
- SDK construction: `lib/email/resend-provider.ts` (via Resend SDK `send()` method)
- Config vars: `RESEND_API_KEY` (`lib/config.ts:23`), `RESEND_WEBHOOK_SECRET` (`lib/config.ts:24`), `EMAIL_FROM` default `hello@mail.sosh.app` (`lib/config.ts:26`), `EMAIL_REPLY_TO` default `support@sosh.app` (`lib/config.ts:27`)
- Purpose in codebase: transactional email delivery (5 product email kinds — see E8). Inbound webhook at `app/api/webhooks/resend/` for bounce/complaint suppression
- Data Resend receives: recipient email address, email content (HTML rendered by React Email)
- Region: [VERIFY: Resend region — US or EU]

**5. Sentry**
- Evidence: `package.json:29` (`@sentry/nextjs: ^10.56.0`)
- SDK construction: `sentry.client.config.ts:5` (`Sentry.init`), `sentry.server.config.ts:5` (`Sentry.init`), `sentry.edge.config.ts` (`Sentry.init`)
- Config vars: `NEXT_PUBLIC_SENTRY_DSN` (`lib/config.ts:96`), `SENTRY_ORG` (`lib/config.ts:6`), `SENTRY_PROJECT` (`lib/config.ts:7`)
- Purpose in codebase: error monitoring and performance tracing. PII scrubber active: `beforeSend: scrubEvent` (`sentry.client.config.ts:10`; `sentry.server.config.ts:10`). `sendDefaultPii: false` (`sentry.client.config.ts:13`). Session Replay explicitly disabled: `replaysSessionSampleRate: 0`, `replaysOnErrorSampleRate: 0` (`sentry.client.config.ts:14-15`) — **no Sentry replay cookies set**
- Region: [VERIFY: using sentry.io (US) or EU-hosted Sentry instance]

**~~6. Postiz (self-hosted)~~ — REMOVED (Amendment A1, 2026-06-13)**
Tiago confirmed Postiz is no longer the publishing layer. SOSH is migrating to direct LinkedIn and X API integration. Postiz code still present in codebase as of this amendment (migration WIP — see E10 and launch-checklist blocker). Removed from subprocessor list and legal copy. No DPA treatment required once migration is complete.

**6. Upstash / QStash**
- Evidence: `package.json:33` (`@upstash/qstash: 2.11.0` — pinned exactly per ADR 0005 Amendment 1)
- SDK construction: `lib/cron/qstash-auth.ts` (`Receiver` class from `@upstash/qstash`)
- Config vars: `QSTASH_CURRENT_SIGNING_KEY` (`lib/config.ts:68`), `QSTASH_NEXT_SIGNING_KEY` (`lib/config.ts:69`), `CRON_TRIGGER` (`lib/config.ts:67`)
- Purpose in codebase: cron job scheduling — fires `/api/cron/publish`, `/api/cron/sync-metrics`, `/api/cron/drain-email-outbox`, `/api/cron/trial-warnings` on schedule. Verifies request signatures; does not receive application data beyond the endpoint URL
- Region: [VERIFY: Upstash region for the QStash account — US or EU]

**7. Vercel**
- Evidence: hosting platform — no SDK for core hosting. Analytics SDK: `@vercel/analytics: ^2.0.1` (`package.json:34`); Speed Insights: `@vercel/speed-insights: ^2.0.0` (`package.json:35`)
- Config var: `VERCEL_GIT_COMMIT_SHA` (`lib/config.ts:98`) — auto-provided by Vercel, not set manually
- Purpose: Next.js hosting (compute, edge network, build pipeline), Vercel Analytics (cookieless page-view counting), Vercel Speed Insights (Core Web Vitals)
- Region: [VERIFY: Vercel serverless function region(s) configured for this project]

**8. Svix**
- Evidence: `package.json:51` (`svix: ^1.95.1`)
- Purpose in codebase: webhook signature verification for Resend inbound webhooks — `app/api/webhooks/resend/route.ts` verifies payload signature using Svix `Webhook` class
- Config var: `RESEND_WEBHOOK_SECRET` (`lib/config.ts:24`) — used as Svix signing secret
- Data handled: Svix SDK processes the raw webhook body + headers locally; no data is sent to Svix servers in this usage pattern (client-side verification only)
- [VERIFY: confirm Svix SDK is used in client-verify mode only (no Svix dashboard/API calls)]

**OAuth platforms (not SaaS subprocessors — no DPA required):**

**9. LinkedIn** — `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` (`lib/config.ts:61-62`) — OAuth authorization + post publishing (direct API — migration WIP, see E10)  
**10. X (Twitter)** — `X_CLIENT_ID` / `X_CLIENT_SECRET` (`lib/config.ts:63-64`) — OAuth authorization + post publishing (direct API — migration WIP, see E10)  
**11. Meta (Instagram + Facebook)** — `META_APP_ID` / `META_APP_SECRET` (`lib/config.ts:65-66`) — OAuth authorization (publishing deferred)  
**12. Threads (Meta)** — uses Meta app credentials — OAuth authorization (publishing deferred)

### Drift check
[VERIFY: Tiago to confirm the above 8 SaaS subprocessors are complete — no other external services in use (e.g. Cloudflare, PostHog, Intercom, HubSpot, etc.)]

---

## E2 — Personal-data columns across all tables

### Method
All files in `supabase/migrations/` read sequentially. Tables listed in schema order.

### auth.users (Supabase Auth — not a SOSH migration)
Supabase Auth owns this table. SOSH reads `auth.users.email` via the `find_trial_expiring_between` RPC (`supabase/migrations/20260608090000_find_trial_expiring_between.sql:22`) and `auth.users.id` as a FK in `businesses.owner_id`.
- `email` — **identity** (user's email address — PII, held by Supabase Auth)
- `id` — **system** (UUID, referenced by businesses.owner_id)
- All other columns: Supabase Auth internal — not written by SOSH

### public.businesses (`20260430120003_businesses.sql`)
| Column | Category | Notes |
|---|---|---|
| `id` | system | UUID PK |
| `name` | profile | Business name — customer-authored |
| `website` | profile | Business URL — customer-authored |
| `industry` | profile | Industry category — customer-selected |
| `description` | profile | Business description — customer-authored |
| `logo_url` | profile | Logo URL — customer-supplied |
| `owner_id` | identity | FK → auth.users(id) — links business to user account |
| `plan` | billing | `trial / starter / pro / agency` |
| `stripe_customer_id` | billing | Stripe customer ID (opaque reference) |
| `stripe_subscription_id` | billing | Stripe subscription ID (opaque reference) |
| `language` | profile | Preferred locale — `en / pt / es` |
| `timezone` | profile | Business timezone string |
| `onboarding_completed` | system | Boolean flag |
| `deleted_at` | system | Soft-delete timestamp |
| `created_at / updated_at` | system | Timestamps |
| `total_posts_published` | derived | Counter — added by `20260607130000_businesses_total_posts_published.sql:3` |

### public.brand_voices (`20260430120005_brand_voices.sql`)
| Column | Category | Notes |
|---|---|---|
| `id` | system | UUID PK |
| `business_id` | system | FK → businesses |
| `tone` | content | Array of tone descriptors — customer-authored |
| `target_audience` | content | Audience description — customer-authored |
| `keywords` | content | Brand keywords — customer-authored |
| `avoid_words` | content | Words to avoid — customer-authored |
| `writing_examples` | content | Up to 3 writing samples — customer-authored |
| `competitors` | content | Competitor names — customer-authored |
| `unique_value_prop` | content | UVP text — customer-authored |
| `inferred_from_url` | derived | Source URL used for AI brand-voice inference |
| `created_at / updated_at` | system | Timestamps |

### public.social_accounts (`20260430120006_social_accounts.sql`)
| Column | Category | Notes |
|---|---|---|
| `id` | system | UUID PK |
| `business_id` | system | FK → businesses |
| `platform` | system | Enum: linkedin / twitter / instagram / facebook / threads |
| `platform_user_id` | identity | Platform-side user/account ID — received from platform |
| `platform_username` | identity | Platform handle / username |
| `platform_display_name` | identity | Display name from platform |
| `vault_access_token_id` | OAuth credential | UUID pointer into Supabase Vault only — no raw token stored here |
| `vault_refresh_token_id` | OAuth credential | UUID pointer into Supabase Vault only — no raw token stored here |
| `token_expires_at` | OAuth credential | Token expiry timestamp |
| `is_active` | system | Connection active flag |
| `connected_at` | system | Connection timestamp |
| `created_at / updated_at` | system | Timestamps |

> Raw OAuth tokens live exclusively in Supabase Vault (`vault.secrets`). They are read only by service-role client calls in `lib/social/vault.ts`. No raw token appears in any application table column.

### public.trial_state (`20260430120007_trial_state.sql`)
| Column | Category | Notes |
|---|---|---|
| `id` | system | UUID PK |
| `business_id` | system | FK → businesses (UNIQUE) |
| `trial_started_at` | billing | Timestamp when first social account connected |
| `campaigns_created_count` | telemetry | Counter |
| `posts_generated_count` | telemetry | Counter |
| `work_email_verified` | identity | Boolean — work email domain check result |
| `trial_card_fingerprint` | billing | Partial card fingerprint from Stripe (non-reversible) |
| `created_at / updated_at` | system | Timestamps |

### public.campaigns (`20260430120009_campaigns.sql`)
| Column | Category | Notes |
|---|---|---|
| `id` | system | UUID PK |
| `business_id` | system | FK → businesses |
| `name` | content | Campaign name — customer-authored |
| `objective` | content | Campaign objective — customer-authored |
| `special_instructions` | content | Optional instructions — customer-authored (used as AI prompt input) |
| `platforms` | content | Array of target platforms |
| `frequency / posts_per_week` | content | Scheduling parameters |
| `start_date / end_date` | content | Campaign date range |
| `status` | system | draft / active / paused / completed |
| `total_posts_planned / total_posts_published` | derived | Counters |
| `deleted_at` | system | Soft-delete timestamp |
| `created_at / updated_at` | system | Timestamps |

### public.posts (`20260430120010_posts.sql`)
| Column | Category | Notes |
|---|---|---|
| `id` | system | UUID PK |
| `campaign_id / business_id` | system | FK references |
| `platform` | system | Target platform |
| `content` | content | Post text — AI-generated, sent to social platforms on publish |
| `hashtags` | content | Hashtag array |
| `media_urls` | content | Media URL array (empty in Phase 1) |
| `scheduled_at` | system | Scheduled publish time |
| `published_at` | system | Actual publish timestamp |
| `platform_post_id` | system | Platform-returned post ID after publish |
| `status` | system | draft / approved / scheduled / published / failed / skipped |
| `rejection_note` | content | User feedback note on skip — customer-authored |
| `ai_generation_metadata` | telemetry | JSONB — model version, generation count, previous versions (up to 10) |
| `deleted_at` | system | Soft-delete timestamp |
| `created_at / updated_at` | system | Timestamps |

### public.post_metrics (`20260430120011_post_metrics.sql`)
| Column | Category | Notes |
|---|---|---|
| `id` | system | UUID PK |
| `post_id / business_id` | system | FK references |
| `likes / comments / shares / saves / clicks / reach / impressions` | telemetry | Aggregated public engagement counts — not individual user data |
| `last_synced_at` | system | Last sync timestamp |
| `created_at / updated_at` | system | Timestamps |

### public.engagement_inbox (`20260430120012_engagement_inbox.sql`)
| Column | Category | Notes |
|---|---|---|
| `id` | system | UUID PK |
| `business_id / post_id` | system | FK references |
| `platform` | system | Source platform |
| `type` | system | comment / dm / mention |
| `platform_item_id` | identity | Platform-side item ID for the engagement event |
| `author_username` | identity | **PII — username of the commenter/DM sender (third-party data subject)** |
| `author_display_name` | identity | **PII — display name of the commenter/DM sender** |
| `content` | content | **PII — text of the comment, DM, or mention (third-party data subject's message)** |
| `received_at` | system | Timestamp |
| `sentiment` | derived | AI classification: positive / neutral / negative / urgent |
| `ai_draft_reply` | content | AI-generated draft reply |
| `status` | system | pending / replied / ignored / auto_replied |
| `replied_at` | system | Reply timestamp |
| `created_at / updated_at` | system | Timestamps |

> **Third-party PII flag:** `engagement_inbox.author_username`, `author_display_name`, and `content` contain personal data from individuals who are not SOSH customers — they are followers/commenters on the customer's social accounts. Phase 1 note: `fetchEngagement` is `NOT_IMPLEMENTED` in `lib/social/postiz-provider.ts:177-183`; this table exists but is not populated at launch.

### public.ai_usage (`20260430120013_ai_usage.sql`)
| Column | Category | Notes |
|---|---|---|
| `id` | system | UUID PK |
| `business_id` | system | FK → businesses |
| `prompt_id / prompt_version` | telemetry | Prompt identifier |
| `model` | telemetry | Anthropic model used |
| `input_tokens / output_tokens` | telemetry | Token counts |
| `cost_cents` | telemetry | Computed cost |
| `latency_ms` | telemetry | Response latency |
| `success / error_code` | telemetry | Outcome |
| `created_at` | system | Timestamp (no updated_at — immutable append-only) |

> No direct PII columns. Rows contain no customer-authored text — only usage telemetry. However, `business_id` link means a business owner could be identified indirectly.

### public.billing_events (`20260527200000_billing_events.sql`)
| Column | Category | Notes |
|---|---|---|
| `id` | billing | TEXT PK — Stripe event ID |
| `type` | telemetry | Stripe event type string |
| `business_id` | system | FK → businesses (nullable — SET NULL on business delete) |
| `stripe_customer_id` | billing | Stripe customer ID |
| `payload` | billing | **JSONB — full Stripe webhook payload; may contain customer email address embedded in the Stripe object** |
| `processed_at` | system | Timestamp |
| `processed_outcome` | telemetry | Processing result enum |

> **Flag:** `billing_events.payload` is the raw Stripe webhook body. Stripe `checkout.session.completed` events contain `customer_details.email`. This is customer PII stored in JSONB.

### public.post_generation_sessions (`20260522200000_post_generation_sessions.sql`)
| Column | Category | Notes |
|---|---|---|
| `id / business_id / campaign_id` | system | References |
| `status / error_code` | system | Generation job state |
| `posts_planned / posts_created` | telemetry | Counters |
| `started_at / completed_at / created_at / updated_at` | system | Timestamps |

### public.auth_rate_limits (`20260531120000_auth_rate_limits.sql`)
| Column | Category | Notes |
|---|---|---|
| `bucket_key` | identity | TEXT — IP address or email-based rate-limit key (e.g. `ip:1.2.3.4:signup`) |
| `tokens / last_refill / updated_at` | system | Token-bucket state |

> **PII flag:** `bucket_key` stores IP addresses and email addresses as composite keys (e.g. `email:user@example.com:login`). These are PII under GDPR.

### public.cron_health (`20260531130000_cron_health.sql`)
| Column | Category | Notes |
|---|---|---|
| `cron_slug` | system | Job identifier |
| `last_seen_at` | system | Heartbeat timestamp |

> No personal data.

### public.email_outbox (`20260607100000_email_outbox.sql`)
| Column | Category | Notes |
|---|---|---|
| `id / business_id` | system | References |
| `kind` | content | Email template kind |
| `recipient` | identity | **PII — email address of the recipient** |
| `locale` | content | Locale for rendering |
| `props` | content | JSONB — template props (may include `businessName`, `planName`, `upgradeUrl`) |
| `dedupe_token` | system | Idempotency token |
| `status / attempts / next_attempt_at / last_error / provider_message_id / sent_at` | system | Queue state |
| `created_at / updated_at` | system | Timestamps |

### public.email_suppressions (`20260607110000_email_suppressions.sql`)
| Column | Category | Notes |
|---|---|---|
| `email` | identity | **PII — suppressed email address** |
| `reason` | system | bounce / complaint / manual |
| `source_event_id` | system | Resend webhook event ID |
| `created_at` | system | Timestamp |

### public.email_webhook_events (`20260607120000_email_webhook_events.sql`)
| Column | Category | Notes |
|---|---|---|
| `id` | system | TEXT PK — Svix webhook event ID |
| `event_type` | telemetry | Resend event type |
| `payload` | telemetry | **JSONB — Resend webhook payload; may contain recipient email address** |
| `received_at` | system | Timestamp |

---

## E3 — OAuth scopes requested per platform

### Method
`lib/social/platforms/config.ts` — `PLATFORM_CONFIGS` object.

### LinkedIn (`lib/social/platforms/config.ts:13-18`)
| Scope | Plain-English meaning |
|---|---|
| `openid` | OpenID Connect authentication — establishes identity |
| `profile` | Read member's name, photo, and headline |
| `email` | Read member's primary email address |
| `w_member_social` | Post content to LinkedIn as the member (organic posts only) |

### X / Twitter (`lib/social/platforms/config.ts:19-24`)
| Scope | Plain-English meaning |
|---|---|
| `tweet.read` | Read the user's tweets |
| `tweet.write` | Post tweets on behalf of the user |
| `users.read` | Read the user's profile information |
| `offline.access` | Obtain a refresh token for persistent access without re-authentication |

### Instagram (`lib/social/platforms/config.ts:26-32`)
| Scope | Plain-English meaning |
|---|---|
| `instagram_basic` | Read basic Instagram profile info (username, bio, follower count) |
| `pages_show_list` | List Facebook Pages the user manages (required for Instagram Graph API access) |

> `instagram_content_publish` deferred — requires Meta App Review. Publishing to Instagram not available at launch. `publishingAvailable: false` (`lib/social/platforms/config.ts:31`).

### Facebook (`lib/social/platforms/config.ts:34-40`)
| Scope | Plain-English meaning |
|---|---|
| `pages_show_list` | List Facebook Pages the user manages |
| `pages_read_engagement` | Read engagement metrics (likes, comments, shares) on managed pages |

> `pages_manage_posts` deferred — requires Meta App Review. Publishing to Facebook not available at launch. `publishingAvailable: false` (`lib/social/platforms/config.ts:39`).

### Threads (`lib/social/platforms/config.ts:42-48`)
| Scope | Plain-English meaning |
|---|---|
| `threads_basic` | Read basic Threads profile info (username, bio) |

> `threads_content_publish` deferred. Publishing to Threads not available at launch. `publishingAvailable: false` (`lib/social/platforms/config.ts:47`).

### Publishing availability summary
| Platform | Scopes allow publishing | Publishing active at launch |
|---|---|---|
| LinkedIn | Yes (`w_member_social`) | Yes |
| X (Twitter) | Yes (`tweet.write`) | Yes |
| Instagram | No (publish scope deferred) | No |
| Facebook | No (publish scope deferred) | No |
| Threads | No (publish scope deferred) | No |

---

## E4 — Cookies set anywhere in the app

### Method
(a) Supabase SSR client config; (b) grep for `cookies().set` / `response.cookies.set`; (c) Sentry replay config; (d) next-intl routing config.

### Findings

**1. Supabase Auth session cookie**
- Set by: `@supabase/ssr` library, via `setAll` callback in `lib/supabase/middleware.ts:21-35`
- Also set in: `lib/supabase/server.ts:19-22` (Server Actions / Route Handlers)
- Cookie name: follows `@supabase/ssr` v0.10 convention — `sb-<project-ref>-auth-token` (split across `sb-<ref>-auth-token.0`, `sb-<ref>-auth-token.1` for large JWTs)
- [VERIFY: confirm exact cookie name by inspecting browser devtools on the live app — the project ref is the subdomain segment of `NEXT_PUBLIC_SUPABASE_URL`]
- Purpose: user session (JWT access + refresh token). httpOnly, Secure, SameSite=Lax (defaults set by Supabase SSR)
- Lifetime: access token ~1 hour; refresh token persistent until logout or revocation
- Essential: yes — without this cookie the user cannot access protected routes

**2. Sentry Session Replay**
- Config: `sentry.client.config.ts:14` — `replaysSessionSampleRate: 0`
- Config: `sentry.client.config.ts:15` — `replaysOnErrorSampleRate: 0`
- Session Replay is OFF. No Sentry replay cookies are set.

**3. Vercel Analytics**
- SDK: `@vercel/analytics` (`package.json:34`)
- [VERIFY: Vercel Analytics is documented as cookieless (no cookies set, no fingerprinting). Confirm at vercel.com/docs/analytics/privacy-policy]

**4. Vercel Speed Insights**
- SDK: `@vercel/speed-insights` (`package.json:35`)
- [VERIFY: Speed Insights is documented as cookieless. Confirm at vercel.com/docs/speed-insights]

**5. Direct `cookies().set` grep result**
- No direct `cookies().set(...)` calls in application code outside Supabase SSR `setAll` callback
- All cookie writes go through `lib/supabase/middleware.ts:28-35`
- No application-level cookies are set outside Supabase Auth session management

**6. next-intl locale**
- next-intl v4 uses URL-based locale routing (`/en/`, `/pt/`, `/es/`) — `i18n/routing.ts`
- No locale cookie set
- [VERIFY: inspect browser on app to confirm no `NEXT_LOCALE` or similar cookie appears]

### Cookie summary
| Cookie | Source | Purpose | Lifetime | Essential |
|---|---|---|---|---|
| `sb-<ref>-auth-token` (x2 parts) | Supabase SSR | User authentication session | ~1h access / persistent refresh | Yes |

No non-essential cookies. No tracking cookies. No cookie consent banner required (consistent with ADR 0009 §12).

---

## E5 — Disconnect contract: does it actually execute all three steps?

### Method
`app/api/social/[platform]/disconnect/route.ts` → `lib/db/social-accounts.ts:deactivateSocialAccount`

### Flow
1. `DELETE /api/social/[platform]/disconnect` — `app/api/social/[platform]/disconnect/route.ts:7`
2. Auth check + business ownership verified — `route.ts:19-31`
3. Active account for platform confirmed — `route.ts:30-33`
4. `deactivateSocialAccount(account.id)` called — `route.ts:35`

### Three-step verification (`lib/db/social-accounts.ts:89-118`)

**Step 1 — `is_active = false`**
- Location: `lib/db/social-accounts.ts:97`
- Executed as part of a single UPDATE: `{ is_active: false, vault_access_token_id: null, vault_refresh_token_id: null }`
- Status: always executes

**Step 2 — vault ID columns nulled**
- Location: `lib/db/social-accounts.ts:99-100`
- `vault_access_token_id: null` and `vault_refresh_token_id: null` in the same UPDATE as Step 1
- Status: always executes (atomic with Step 1)

**Step 3 — Vault secret deletion via RPC**
- Access token: `serviceClient.rpc('vault_delete_secret', { secret_id: account.vault_access_token_id })` — `lib/db/social-accounts.ts:106-109`
- Refresh token (if present): `serviceClient.rpc('vault_delete_secret', { secret_id: account.vault_refresh_token_id })` — `lib/db/social-accounts.ts:111-117`
- Status: **best-effort only** — both calls are wrapped in `try {} catch {}` (lines 105–117). If the Vault RPC fails (network error, vault outage), the failure is silently swallowed. The UPDATE (Steps 1+2) has already committed at that point.

### Caveat
Steps 1 and 2 are guaranteed atomic. Step 3 (actual Vault secret deletion) is best-effort. In a failure scenario, orphaned vault secrets may persist in Supabase Vault even though the vault IDs in `social_accounts` are nulled and the tokens are unreachable through normal application code.

[VERIFY: whether to add a Sentry alert for vault deletion failures, or accept the current silent-swallow behaviour before drafting the policy claim]

---

## E6 — Retention: which claimed periods have actual deletion jobs?

### Method
List all cron routes + orchestrators; map personal-data categories from E2 to deletion mechanisms.

### Cron routes
| Route | File | Deletion activity |
|---|---|---|
| `publish` (*/10 * * * *) | `app/api/cron/publish/route.ts` | None — updates post status only |
| `sync-metrics` (0 * * * *) | `app/api/cron/sync-metrics/route.ts` | None — upserts post_metrics rows |
| `drain-email-outbox` (* * * * *) | `app/api/cron/drain-email-outbox/route.ts` | None — marks rows sent/failed |
| `trial-warnings` (0 9 * * *) | `app/api/cron/trial-warnings/route.ts` | None — enqueues emails |

### `METRICS_MAX_AGE_DAYS` (90 days)
- Config: `lib/config.ts:59`
- Used by: `lib/metrics/orchestrator.ts:40` → passed to `listPostsForMetricsSync`
- SQL: `supabase/migrations/20260530120000_metrics_worker_helper.sql:24` — limits which posts are fetched for sync
- **This is a sync-window filter, not a deletion trigger. No rows are deleted when a post ages past 90 days.**

### Retention gap table

| Personal-data category | Table(s) | Deletion mechanism | Gap? |
|---|---|---|---|
| User account | `auth.users` | Supabase Auth account deletion (outside SOSH codebase) | [VERIFY: is there a user-facing "delete account" flow? Not found in repo.] |
| Business profile | `businesses` | Soft-delete only (`deleted_at`). No hard-delete job. | Gap |
| Brand voice | `brand_voices` | CASCADE on business soft-delete only — no hard-delete | Gap |
| OAuth tokens | `vault.secrets` | Deleted on disconnect (best-effort, see E5). No time-based expiry job. | Gap (on disconnect failure) |
| Social account metadata | `social_accounts` | No deletion job. `is_active=false` on disconnect. CASCADE on business delete. | Gap |
| Trial state | `trial_state` | No deletion job. CASCADE on business delete. | Gap |
| Campaigns | `campaigns` | Soft-delete only (`deleted_at`). No hard-delete job. | Gap |
| Posts | `posts` | Soft-delete only (`deleted_at`). No hard-delete job. | Gap |
| Post metrics | `post_metrics` | No deletion job. CASCADE on post delete. | Gap |
| Engagement inbox | `engagement_inbox` | No deletion job. CASCADE on business delete. | Gap — contains third-party PII (see E2) |
| AI usage audit log | `ai_usage` | No deletion job. CASCADE on business delete. Immutable by design. | Gap |
| Billing events | `billing_events` | No deletion job. SET NULL on business delete (row persists). | Gap — payload may contain customer email |
| Rate-limit buckets | `auth_rate_limits` | No deletion job. Old buckets accumulate. | Gap — bucket_key stores IPs and emails |
| Email outbox | `email_outbox` | No deletion job. CASCADE on business delete. | Gap |
| Email suppressions | `email_suppressions` | No deletion job. Not tenant-scoped — no CASCADE. | Gap |
| Email webhook events | `email_webhook_events` | No deletion job. Not tenant-scoped. | Gap |
| Cron health | `cron_health` | No deletion needed — no PII | N/A |
| Post generation sessions | `post_generation_sessions` | No deletion job. CASCADE on business delete. | Minor gap |

> **Summary:** No SOSH-owned scheduled job deletes any personal data. All deletion is either (a) CASCADE triggered by a business hard-delete (which itself has no automated trigger), or (b) the Supabase Auth account-deletion flow (not surfaced in-app). The Privacy Policy cannot claim specific retention periods without implementing jobs to enforce them.

---

## E7 — AI training posture (Amendment A1 — Path A confirmed)

**Confirmed by Tiago 2026-06-13:** Path A. SOSH does not use customer content to train or improve AI models at launch. No schema migration required.

No `ai_training_opt_in` column exists in any migration (confirmed by grep of `supabase/migrations/*.sql` — no matches for `ai_training_opt_in`, `ai_training`, `training_opt`).

Privacy Policy reflects: "We do not currently use customer content to train or improve AI models. If we introduce such processing in future, we will obtain consent and provide 30 days' notice before any such change."

Re-open this section when content-based AI improvement is introduced as a product feature.

---

## E8 — Email categories actually sent

### Method
`lib/email/templates/` directory + Supabase Auth email configuration reference.

### Product emails (React Email templates — `lib/email/templates/`)

| Template file | Kind key | Category | Trigger |
|---|---|---|---|
| `trial-warning-t3.tsx` | `trial-warning-t3` | Trial / lifecycle | T-3 days before trial expiry (`app/api/cron/trial-warnings/route.ts`) |
| `trial-warning-t1.tsx` | `trial-warning-t1` | Trial / lifecycle | T-1 day before trial expiry (`app/api/cron/trial-warnings/route.ts`) |
| `welcome-to-plan.tsx` | `welcome-to-plan` | Billing / transactional | Stripe `checkout.session.completed` webhook |
| `payment-failed-courtesy.tsx` | `payment-failed-courtesy` | Billing / transactional | Stripe `invoice.payment_failed` webhook |
| `first-post-published.tsx` | `first-post-published` | Product milestone | First post published (0→1 counter detection in publishing worker) |

> **Note on `payment-failed-courtesy`:** `invoice.payment_failed` is an explicit no-op at launch in `lib/stripe/webhook.ts` — event is logged but no business logic executes. This template exists but is not currently triggered in production. ADR 0008 deferred dunning logic to Phase 3.

### Auth emails (Supabase Auth SMTP relay — not React Email templates)

These are configured in the Supabase Auth dashboard, not in the SOSH codebase.

| Email | Category | Trigger |
|---|---|---|
| Signup confirmation | Transactional / auth | User clicks "Sign up" |
| Password reset | Transactional / auth / security | User requests reset |
| Email change confirmation | Transactional / auth / security | User changes email address |

> Auth emails are EN-only at launch — accepted per launch checklist §9.

### Categories the Privacy Policy may claim
1. Transactional auth (signup confirmation, password reset, email change)
2. Billing transactional (welcome to plan, payment failed courtesy — see note)
3. Product lifecycle / trial (trial warning T-3, trial warning T-1, first post published)

No marketing, promotional, newsletter, or re-engagement emails are sent.

---

## E9 — Data-location facts

### Method
Config env vars + package origins + known vendor headquarters. All production regions require Tiago's confirmation.

All regions confirmed EU by Tiago (§0-7, 2026-06-13). Postiz removed.

| Subprocessor | Config evidence | Confirmed region |
|---|---|---|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL` (`lib/config.ts:101`) | EU |
| Anthropic | `ANTHROPIC_API_KEY` (`lib/config.ts:10`) | US (DPF transfer — see §7 of ADR 0010) |
| Stripe | `STRIPE_SECRET_KEY` (`lib/config.ts:19`) | EU [VERIFY: confirm Stripe entity — EU entity vs US entity determines transfer mechanism] |
| Resend | `RESEND_API_KEY` (`lib/config.ts:23`) | EU |
| Sentry | `NEXT_PUBLIC_SENTRY_DSN` (`lib/config.ts:96`) | EU |
| Upstash / QStash | `QSTASH_CURRENT_SIGNING_KEY` (`lib/config.ts:68`) | EU |
| Vercel | Auto env var (`lib/config.ts:98`) | EU |

> **Anthropic transfer confirmed:** Tiago confirmed US posture. Transfer mechanism: EU-US Data Privacy Framework. Builder confirms current DPF certification at dataprivacyframework.gov before transcription (ADR 0010 §7, Amendment A1 T7 — [VERIFY] marker removed from ADR prose).

---

## E10 — Third-party platform compliance facts (Amendment A1 — WIP state)

### Migration state as of 2026-06-13

**[VERIFY: WIP — Postiz still the active publishing path in code. Direct LinkedIn/X API integration not started. The following documents the current code state and the expected end-state data flows. Builder must complete migration before launch.]**

Current code files still in place:
- `lib/social/postiz-provider.ts` — Postiz HTTP client (all 5 API calls)
- `lib/social/registry.ts:6,34-52` — routes to `PostizProvider`; requires `POSTIZ_BASE_URL` + `POSTIZ_API_KEY`

No direct-API provider files exist yet (`lib/social/linkedin-provider.ts`, `lib/social/x-provider.ts` — absent as of grep 2026-06-13).

No LinkedIn or X SDK packages in `package.json` (e.g. `linkedin-api-client`, `twitter-api-v2` — absent).

### End-state data flows (legal copy reflects this state)

Regardless of routing (Postiz or direct), the data that leaves SOSH and reaches each platform is identical. The intermediary changes; the data flows do not.

**OAuth token exchange (all platforms):**
- Data sent to platform: `code`, `redirect_uri`, `client_id`, `client_secret`
- Data received from platform: `access_token`, `refresh_token`, `expires_in`, platform user ID, username, display name
- Stored: vault secrets (access + refresh tokens); `social_accounts` (username, display name, platform_user_id — E2)

**Post publishing (LinkedIn, X):**
- Data sent to platform: post text (`posts.content`, E2), hashtags (`posts.hashtags`, E2), platform user ID (as authorisation context)
- Data received: `platform_post_id`, published timestamp, post URL — stored in `posts` (E2)

**Token refresh (LinkedIn, X):**
- Data sent: refresh token (from Vault)
- Data received: new access token, optionally new refresh token — updated in Vault

**Token revocation on disconnect (best-effort):**
- Data sent: access token (from Vault)
- Data received: none (fire-and-forget, E5)

**Account linking only, no publishing (Instagram, Facebook, Threads):**
- Data sent: OAuth code exchange only
- Data received: platform user ID, username, display name — stored in `social_accounts`

### Metrics and engagement (Phase 1)

No post metrics or engagement data are fetched from any platform at launch. The `SocialProvider` interface defines `fetchPostMetrics` and `fetchEngagement`; both currently throw `NOT_IMPLEMENTED` (`lib/social/postiz-provider.ts:169-183` — Builder migrating to direct API must preserve this behaviour until Phase 2).

### Platform-specific compliance items
[VERIFY: before ToS §9 is finalised:]
1. LinkedIn API ToS — confirm `w_member_social` permits automated/scheduled posting via a third-party app; confirm data-use restrictions on `profile` and `email` scope data
2. X API ToS — confirm tier (Free / Basic / Pro) and whether it permits automated posting at the volume planned; confirm display requirements for `tweet.read` data
3. Meta/Instagram API ToS — Instagram basic display data has specific retention restrictions; confirm since publishing is not active
4. Threads API — confirm usage policy for third-party scheduling apps

---

## Summary of open items (Amendment A1 state — 2026-06-13)

### §0 inputs — resolved
All 10 §0 inputs were answered before Phase 1 (ADR 0010) was written. Amendment A1 further resolved:
- AI training posture → Path A (T2): no opt-in, no schema migration required at launch
- Postiz removed as subprocessor (T1): direct LinkedIn/X API integration WIP
- Vault deletion alert → Sentry `captureException` required (T4/T11): launch blocker
- Deletion mechanism → `business_deletion_requests` table spec (T5): Builder task
- Refund posture → no pro-rata refund (T3): aligned with ToS §5

### [VERIFY] markers — status after Amendment A1
| # | Question | Status |
|---|---|---|
| V1 | Supabase project region | ✅ EU (confirmed) |
| V2 | Anthropic EU data residency | ✅ US / EU-US DPF (confirmed T7) |
| V3 | Stripe entity | ✅ EU (confirmed) |
| V4 | Resend region | ✅ EU (confirmed) |
| V5 | Sentry instance | ✅ EU (confirmed) |
| V6 | Postiz / Hetzner | ✅ Closed — Postiz removed (T1) |
| V7 | Upstash QStash region | ✅ EU (confirmed) |
| V8 | Vercel functions region | ✅ EU (confirmed) |
| V9 | Anthropic DPA / SCCs | ⚠ [VERIFY: WIP] — confirm DPF current at dataprivacyframework.gov before go-live |
| V10 | Supabase auth cookie name | ⚠ [VERIFY: WIP] — inspect staging browser devtools before launch |
| V11 | Vercel Analytics / Speed Insights cookieless | ⚠ [VERIFY: WIP] — confirm via Vercel docs; backlog, not launch blocker |
| V12 | next-intl locale cookie | ⚠ [VERIFY: WIP] — confirm none set; backlog, not launch blocker |
| V13 | Svix client-verify mode only | ⚠ [VERIFY: WIP] — launch blocker (T12) |
| V14 | Vault deletion failure posture | ✅ Resolved — Sentry alert required (T4/T11), launch blocker |
| V15 | User-facing "delete my account" flow | ⚠ [VERIFY: WIP] — `business_deletion_requests` table to be built (T5) |
| V16 | `payment-failed-courtesy` email | ✅ Excluded from launch scope; backlog |
| V17 | LinkedIn / X / Meta / Threads API ToS | ⚠ [VERIFY: WIP] — required before ToS §9 finalised; see E10 |
| V18 | Postiz self-hosted DPA posture | ✅ Closed — Postiz removed (T1) |

### Structural gaps — status after Amendment A1
| Gap | Evidence | Status |
|---|---|---|
| No deletion jobs | E6 — no cron deletes personal data | ⚠ Launch blocker (T4): 30-day hard-delete cron + auth_rate_limits TTL purge required |
| AI training schema | E7 — no `ai_training_opt_in` column | ✅ Closed (T2): Path A at launch; no migration needed |
| Vault deletion best-effort | E5 — `try {} catch {}` swallows failures | ⚠ Launch blocker (T4/T11): add `captureException` to `lib/social/social-accounts.ts` |
| `engagement_inbox` third-party PII | E2 — `author_username` / `content` | ✅ Disclosed in Privacy Policy §6; ingestion not active at launch |
| `billing_events.payload` contains customer email | E2 — raw Stripe JSON | ✅ Disclosed in Privacy Policy §2 (T8 email webhook events) |
| `auth_rate_limits.bucket_key` contains IPs + emails | E2 — composite key | ✅ Disclosed in Privacy Policy §2; no expiry job → launch blocker via E6/T4 |
| Postiz → direct API migration | E10 — WIP | ✅ Code-complete (Amendment A2) — see below |

---

## Amendment A2 — Native publishing migration complete in code (2026-09-04)

**Session:** 30.5 (ADR 0028, Track N). **Scope:** E10's migration state only. Nothing else in this
Evidence Pack, Amendment A1, or the ADR 0010 prose is affected. Amendment A1's text above is left
unedited — this amendment updates the record forward, per this file's own append-only house form.

**E10 is superseded.** The migration E10 described as "WIP" is now code-complete:

- `lib/social/postiz-provider.ts` — **deleted**, along with its two test files. No file matching that
  name exists in the repository (`lib/social/__tests__/no-postiz.test.ts` is the executable proof, run in
  CI on every push).
- `lib/social/linkedin-provider.ts` and `lib/social/twitter-provider.ts` — **exist and are registered**
  in `lib/social/registry.ts`, per-platform, independently of each other (ADR 0028 §8.2). No
  `linkedin-api-client` or `twitter-api-v2` package is used — both providers call each platform's REST
  API directly via `fetch`, with no SDK dependency to evidence separately.
- **Production OAuth apps are not yet registered** with either LinkedIn or X (ADR 0028 §14.1). No real
  customer has connected an account through the native flow yet. This is an operational gap, not a code
  gap — §631's platform-specific compliance items (V17: LinkedIn/X/Meta/Threads API ToS confirmation)
  remain **open** and are unaffected by this amendment; they still gate ToS §9 finalisation.
- The end-state data flows §602 already documented (OAuth token exchange, post publishing, token
  refresh, token revocation, account-linking-only for the Meta family) are **unchanged** — native
  providers implement exactly those flows; nothing about what data leaves SOSH or reaches each platform
  changed with the broker's removal, only who initiates the request (SOSH directly, not an intermediary).
- Token revocation is confirmed **more clearly best-effort than under the broker**: LinkedIn has no
  programmatic revocation endpoint for a standard third-party app at all (member-initiated only, via the
  member's own LinkedIn account settings) — `lib/social/linkedin-provider.ts`'s `revokeAccessToken`
  returns early with no network call. X's revocation endpoint exists but its exact request shape for
  SOSH's OAuth2 flow was not conclusively confirmed against vendor documentation (flagged inline in
  `lib/social/twitter-provider.ts`); it remains best-effort and non-blocking either way (§619's posture is
  unchanged).

**Not resolved by this amendment, flagged for counsel-aware follow-up:** this Evidence Pack is the
ground-truth source `content/legal/*.mdx`'s `evidenceRef` frontmatter cites (CLAUDE.md, Legal pages). This
amendment updates the Evidence Pack itself; it does **not** touch `content/legal/*.mdx` or bump any
`evidenceRef`. Whoever next edits a legal page citing E10 or V18 should bump `evidenceRef` to a commit
covering this amendment, per CLAUDE.md's standing rule — not done here because this is a code-removal
session (N2.11), not a legal-copy session, and `[LEGAL ENTITY]` substitution and legal-copy edits stay
gated on counsel ratification regardless.
