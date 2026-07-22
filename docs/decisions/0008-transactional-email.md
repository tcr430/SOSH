# ADR 0008 — Transactional Email

**Status:** Accepted
**Date:** 2026-06-06
**Session:** 14 (Architect)
**Supersedes:** none
**Related:** ADR 0001 (schema), ADR 0005 (publishing worker + QStash Amendment 1), ADR 0006 (metrics worker), ADR 0007 (launch hardening — §3.3 redaction, §4 middleware, Sentry monitors), Session 11A (Stripe billing + `billing_events`)

---

## 1. Headline decision

**SOSH sends transactional email through two cooperating layers that share one sender identity but hold separate reliability contracts: (1) a `lib/email/` provider abstraction draining a durable `email_outbox` table for the five product emails the application owns, and (2) Supabase Auth reconfigured to relay its own auth emails through Resend SMTP.** Product email is decoupled, retryable, deduped, and audited — an enqueue is a database row, not a network call, and a separate every-minute drainer cron performs the actual send. Auth email stays inside Supabase Auth (no outbox, no `lib/email/` involvement) because Supabase already owns the token lifecycle, signature, and one-time-use semantics that we must not reimplement. Both layers emit from `hello@mail.sosh.app`, reply to `support@sosh.app`, and render against the same visual system — so the customer sees one brand — but the product layer is a ledger-backed queue while the auth layer is fire-and-forget SMTP delegated to a vendor.

The unifying constraint is **shared identity, separate contracts**: a single DNS-authenticated subdomain and a single visual layer, but the product layer guarantees at-least-once delivery with idempotent dedupe, and the auth layer inherits Supabase's own delivery guarantees unchanged.

### Why outbox over inline send

The rejected alternative is calling Resend synchronously at the trigger site (inside the trial-warning scan loop, inside the Stripe dispatch tail, inside `runPublishTick`). Inline send couples the trigger's latency and success to Resend's availability: a Resend 5xx during a publish tick would either fail the tick or silently drop the activation email; there would be no row to retry and no audit of what we tried to send. The outbox pays for itself with three properties inline cannot offer — **decoupling** (the trigger commits a row and returns; Resend being down delays delivery, it does not fail the trigger), **retry semantics** (a transient send failure leaves the row `pending` with a future `next_attempt_at`, drained next minute), and a **ledger** (every intended send is a queryable row with status, attempts, and last error). The cost is one extra table, one extra cron, and up-to-60s added latency on the happy path — acceptable for transactional email that is never user-blocking.

---

## 2. Scope boundaries

**In scope (this ADR, Session 14 build):**
- `lib/email/` provider abstraction (Resend + Mock, registry, ESLint boundary, error taxonomy) — mirrors `lib/social/` (ADR 0002 §shape).
- `email_outbox`, `email_suppressions`, `email_webhook_events` tables + RLS + migrations.
- `businesses.total_posts_published` counter column (new) for first-post detection.
- Five product EmailKinds (L1) with React Email templates, EN/PT/ES copy, and Zod props.
- Two new crons: `/api/cron/drain-email-outbox` (every minute), `/api/cron/trial-warnings` (daily 09:00 UTC) — both under ADR 0005 §12 + Amendment 1.
- Enqueue wiring into the Stripe webhook dispatch tail and `runPublishTick`.
- Resend inbound webhook (`/api/webhooks/resend`) → suppressions.
- Supabase Auth → Resend SMTP relay (dashboard config, documented here; no code).

**Out of scope (deferred — see §18):**
- Dunning sequences. `payment-failed-courtesy` is a single email (L8; ADR 0007 deferred dunning to Phase 3).
- Engagement-event email (reply/DM notifications) — Phase 2.
- Multi-locale auth email (auth is EN-only at launch — L2).
- In-app email history UI, A/B testing, marketing/broadcast email.
- Customer-local-time trial warnings (we send at a fixed 09:00 UTC — L5).

---

## 3. Email kind catalogue

| EmailKind | Trigger source | Dedupe key (unique constraint) | Owner file / route |
|---|---|---|---|
| `trial-warning-t3` | `/api/cron/trial-warnings`, daily 09:00 UTC | `(business_id, kind)` | `app/api/cron/trial-warnings/route.ts` → `lib/email/triggers/trial-warnings.ts` |
| `trial-warning-t1` | `/api/cron/trial-warnings`, daily 09:00 UTC | `(business_id, kind)` | same |
| `welcome-to-plan` | Stripe `checkout.session.completed` (after state writes) | `(business_id, kind, dedupe_token=stripe_event_id)` | `lib/stripe/webhook.ts` dispatch tail via `after()` |
| `payment-failed-courtesy` | Stripe `invoice.payment_failed` (after state writes) | `(business_id, kind, dedupe_token=stripe_event_id)` | same |
| `first-post-published` | `runPublishTick`, business-level 0→1 | `(business_id, kind)` | `lib/publishing/orchestrator.ts` |

Dedupe key shape is reconciled in §5 (one nullable `dedupe_token` column; the unique index covers `(business_id, kind, coalesce(dedupe_token,''))`).

**`trial-warning-t3` / `trial-warning-t1`** — fire when a trial business is 3 days / 1 day from expiry (T-3 / T-1 scan windows, §10). Carries: business name, days remaining, expiry date (formatted in the snapshot locale), plan-upgrade CTA URL. Subject counts *down* to expiry; CTA → `/billing`. Matters because trial→paid conversion is the entire Phase-1 revenue mechanism; the warning is the single highest-leverage conversion touch SOSH has. Dedupe is `(business_id, kind)` — each business gets exactly one T-3 and one T-1 for the lifetime of the row, enforced by the unique constraint, so a cron that runs twice in a day (retry, manual trigger) cannot double-send.

**`welcome-to-plan`** — fires once the subscription is durable (after `updateBillingFromSubscription` commits in the `checkout.session.completed` branch). Carries: business name, plan name, what the plan unlocks (platform list, post quota), link to dashboard. Subject confirms the upgrade; CTA → dashboard. Matters for activation: it converts a Stripe receipt into a SOSH onboarding moment. Deduped on `stripe_event_id` so a Stripe webhook replay does not re-welcome.

**`payment-failed-courtesy`** — fires on `invoice.payment_failed`. A *single* empathetic email with one recovery path (update payment method via billing portal). Carries: business name, the fact that a charge failed, billing-portal CTA. Subject is calm, not alarming; CTA → billing portal. Matters because involuntary churn is recoverable churn, but L8/ADR 0007 deliberately scope this to one courtesy email — no dunning chain, no escalation. Deduped on `stripe_event_id`.

**`first-post-published`** — fires the first time *any* post for the business reaches `published` (business-level 0→1, §12). Carries: business name, the platform the post went to, link to the campaign/posts view. Subject celebrates the milestone; CTA → posts view. Matters because the first successful publish is the activation event that proves SOSH works for that customer; reinforcing it builds the publish habit. Deduped on `(business_id, kind)` — it can only ever fire once per business.

**Auth emails are not in this catalogue.** `signup-confirm`, `password-reset`, `change-email`, and `magic-link` (if enabled) are owned by Supabase Auth (L2), relayed through Resend SMTP (§13), EN-only at launch, and never create an `email_outbox` row. They have no EmailKind value because the application never enqueues, renders, or sends them.

**Deferred kinds (Phase 2+):** engagement notifications (new comment / DM), dunning steps 2–N, weekly digest, metrics milestone, seat-invite (agency tier). Listed in §18.

---

## 4. Provider abstraction — `lib/email/`

Mirrors `lib/social/` exactly (ADR 0002): a typed interface, a Resend implementation, a Mock implementation with failure injection, a registry selected by env, a single `index.ts` public surface, and an ESLint boundary keeping the `resend` npm import inside `resend-provider.ts`. No consumer imports `resend-provider` or `mock-provider` directly.

### Why mirror `lib/social/` rather than call Resend ad hoc

The rejected alternative is a thin `sendEmail()` helper that imports `resend` wherever convenient. That repeats the mistake the `SocialProvider` abstraction exists to prevent: vendor lock-in scattered across the codebase, no seam for the Mock provider that the entire test pyramid depends on (§16), and no single place to enforce redaction or error typing. The provider shape costs one extra file (the registry) but buys a swappable vendor, a test double, and one ESLint rule that makes the boundary mechanical rather than aspirational.

### Interface

```typescript
// lib/email/types.ts
export type EmailKind =
  | 'trial-warning-t3'
  | 'trial-warning-t1'
  | 'welcome-to-plan'
  | 'payment-failed-courtesy'
  | 'first-post-published'

export type EmailLocale = 'en' | 'pt' | 'es'

export interface SendEmailInput {
  to: string
  subject: string
  html: string
  text: string                 // separately authored plain-text, not tag-stripped HTML (§8b)
  replyTo: string              // support@sosh.app
  idempotencyKey: string       // outbox row id (§9, D7) — passed to provider
  tags?: Record<string, string> // e.g. { kind, business_id } for provider-side filtering
}

export interface SendEmailResult {
  providerMessageId: string
}

export interface EmailProvider {
  send(input: SendEmailInput): Promise<SendEmailResult>
}
```

### Error taxonomy

```typescript
// lib/email/errors.ts
import { REDACTED_KEYS } from '@/lib/observability/sentry-scrub' // ADR 0007 §3.3 — do not redefine

export type EmailProviderErrorCode =
  | 'invalid_recipient'      // malformed / rejected address → terminal (failed)
  | 'provider_rate_limit'    // Resend 429 → transient (retry)
  | 'provider_unavailable'   // Resend 5xx / network → transient (retry)
  | 'template_render_failed' // Zod props mismatch / React Email throw → terminal (failed)
  | 'unknown'                // unclassified → terminal (failed), captured to Sentry

export class EmailProviderError extends Error {
  constructor(
    public readonly code: EmailProviderErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly retryAfterSeconds?: number, // populated for provider_rate_limit
  ) {
    super(message)
    this.name = 'EmailProviderError'
  }
}
```

**`suppressed` is not a provider error code.** Suppression is an outbox-status transition enforced at the drainer level (§9 D3): the drainer re-checks `email_suppressions` before calling the provider, and a suppressed row moves directly to `status = 'suppressed'` without invoking the provider at all. Because the provider is never called for a suppressed recipient, no `EmailProviderError` is produced. `suppressed` is an outbox-state concept, not a provider-layer error concept; the union intentionally has five codes.

`EmailProviderError.details` is redacted with the **same recursive redactor and `REDACTED_KEYS` set** that `lib/social/errors.ts` already imports from `lib/observability/sentry-scrub.ts` (ADR 0007 §3.3). The redaction logic is not re-implemented here; `lib/email/errors.ts` imports it. Recipient email addresses are scrubbed at the Sentry boundary, not stored in `details` (§17).

The mapping from each code to a terminal-vs-transient outcome is the drainer's responsibility (§9); the table above states the contract.

### Registry + boundary

```typescript
// lib/email/registry.ts
import { config } from '@/lib/config'
import type { EmailProvider } from './types'

let cached: EmailProvider | null = null

export function getEmailProvider(): EmailProvider {
  if (cached) return cached
  cached = config.server.EMAIL_PROVIDER === 'mock'
    ? new MockEmailProvider()       // lib/email/mock-provider.ts
    : new ResendEmailProvider()     // lib/email/resend-provider.ts
  return cached
}
```

```jsonc
// .eslintrc — no-restricted-imports (mirrors the stripe/ and social/ boundary rules)
// Ban the 'resend' package everywhere except lib/email/resend-provider.ts.
// Exact-package match per the eslint-no-restricted-imports-exact-package pattern.
```

`MockEmailProvider` captures sends into an in-memory array and supports failure injection keyed by `EmailProviderErrorCode` (used across the unit pyramid, §16) — identical pattern to `MockProvider` in `lib/social/`.

---

## 5. Outbox table — `email_outbox`

Resolves **D1** (drain-time render, props-only storage), **D3** (enqueue + drain enforcement), **D8** (status machine).

### D1 — drain-time render, store props only

The row stores `props` (jsonb) and the snapshot `locale`; it does **not** store rendered `html`/`text`. The drainer renders fresh from template+props on each attempt. The rejected alternative — snapshotting rendered HTML at enqueue — gives bit-for-bit reproducibility of exactly what was sent, but it freezes copy: a typo fix or accessibility correction deployed after enqueue would not reach any row already queued, and it bloats every row with two large text blobs. Drain-time render lets a copy fix deployed at 09:05 reach a trial-warning row enqueued at 09:00 and not yet drained. The risk it introduces — a schema change that makes old props fail validation — is converted into a *loud* failure: the Zod props schema (§8) runs at render time, and a mismatch routes the row to `failed` with `template_render_failed` rather than silently sending garbage. We accept lost reproducibility for live-correctable copy, because transactional copy fixes are more common than the need to forensically replay a byte-exact past send.

### D8 — status machine

```
                        ┌─────────────────────────────────────────┐
                        │                                          │
   enqueue              │  claim (SKIP LOCKED)      transient err  │
  ───────────▶ pending ─┼────────────▶ sending ────────────────────┘
                  ▲     │                 │
                  │     │   suppressed at  │  send ok
   next_attempt_at│     │   enqueue-check  │
   in future,     │     │   (D3)           ▼
   attempts < MAX │     │              ┌─ sent          (terminal)
                  └─────┘              │
                                       ├─ failed        (terminal: terminal err,
                                       │                 or attempts >= MAX)
                                       │
                        drain re-check │
                        finds recipient├─ suppressed    (terminal: drain-time
                        now suppressed │                 suppression hit, D3)
                                       │
              enqueue-check finds      │
              recipient suppressed  ───┘  (row created directly as suppressed,
                                          never claimed — see §6)
```

Edges, every one labelled:
- **enqueue → pending** — normal path; row created with `next_attempt_at = now()`, `attempts = 0`.
- **enqueue → suppressed (direct)** — enqueue-time suppression check (D3) finds the recipient already suppressed; row is written `suppressed` and never claimed (audit-only).
- **pending → sending** — drainer claims via `FOR UPDATE SKIP LOCKED` on the partial index.
- **sending → sent** — provider returns a message id.
- **sending → failed** — terminal error code (`invalid_recipient`, `template_render_failed`, `unknown`) **or** transient error with `attempts + 1 >= EMAIL_MAX_ATTEMPTS`.
- **sending → pending** — transient error (`provider_rate_limit`, `provider_unavailable`) with attempts remaining; sets `next_attempt_at = now() + backoff` (exponential with jitter, mirroring ADR 0005 §NETWORK), `attempts += 1`.
- **sending → suppressed** — **drain re-check (D3)**: after claim, before send, the drainer re-queries suppressions; a bounce/complaint that landed *after* enqueue moves the claimed row to `suppressed` without sending.

No separate `retry-scheduled` state: a retrying row is simply `pending` with a future `next_attempt_at` and `attempts > 0`. This is the exact requeue model the publishing worker already uses (ADR 0005 — `requeueScheduledPost` bumps `scheduled_at`); introducing a fifth state would duplicate what `next_attempt_at` already encodes and force the partial index to enumerate two "drainable" states instead of one. `suppressed` is kept distinct from `failed` because "we intentionally did not send because the recipient bounced" is operationally different from "we tried and could not" — conflating them would pollute failure dashboards and hide deliverability problems.

### Migration

```sql
-- email_outbox: durable queue for the five product EmailKinds (ADR 0008 §5)
CREATE TABLE public.email_outbox (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  kind            text        NOT NULL
                    CHECK (kind IN ('trial-warning-t3','trial-warning-t1',
                                    'welcome-to-plan','payment-failed-courtesy',
                                    'first-post-published')),
  recipient       text        NOT NULL,           -- snapshot at enqueue
  locale          text        NOT NULL            -- snapshot of businesses.language (D2)
                    CHECK (locale IN ('en','pt','es')),
  props           jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- D1: props, not rendered html
  dedupe_token    text,                           -- stripe_event_id for Stripe kinds; NULL otherwise
  status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sending','sent','failed','suppressed')),
  attempts        int         NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,                           -- redacted message (ADR 0007 §3.3)
  provider_message_id text,                       -- Resend id on success
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);

-- Idempotency: one row per (business, kind, dedupe_token). NULL tokens collapse to ''
-- so trial/first-post kinds are deduped on (business_id, kind) alone.
CREATE UNIQUE INDEX email_outbox_dedupe_uq
  ON public.email_outbox (business_id, kind, coalesce(dedupe_token, ''));

-- Drainer scan target: only drainable rows, ordered by readiness. Partial index
-- keeps the index small (sent/failed/suppressed rows drop out).
CREATE INDEX email_outbox_drainable_idx
  ON public.email_outbox (next_attempt_at)
  WHERE status = 'pending';

CREATE TRIGGER trg_email_outbox_updated_at
  BEFORE UPDATE ON public.email_outbox
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
-- Operational queue: all writes are service-role (crons, webhook tail, worker).
-- Authenticated users MAY read their own business's rows (future in-app history, §18);
-- no INSERT/UPDATE/DELETE policy for authenticated → service-role only.
CREATE POLICY email_outbox_select_own
  ON public.email_outbox FOR SELECT TO authenticated
  USING (business_id IN (SELECT get_user_business_ids()));
```

The `email_outbox_dedupe_uq` constraint is the single source of idempotency for enqueue: a duplicate enqueue (Stripe replay, cron double-run, concurrent publish) raises `23505` and is swallowed as a no-op (caught with the `postgres-error-type-guard` pattern). The `23505`-as-success convention matches the `billing_events` model (Session 11A; CLAUDE.md "Webhook handlers").

---

## 6. Suppressions table — `email_suppressions`

Resolves **D3** enforcement points.

A suppression is a hard signal from Resend (bounce or spam complaint) that we must never email this address again. Suppressions are operational data with no tenant — keyed by email address, service-role only.

```sql
-- email_suppressions: addresses we must not send to (ADR 0008 §6)
CREATE TABLE public.email_suppressions (
  email           text        PRIMARY KEY,        -- the suppressed address (lowercased)
  reason          text        NOT NULL
                    CHECK (reason IN ('bounce','complaint','manual')),
  source_event_id text,                            -- Resend event id that created it
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;
-- No authenticated policy at all: suppressions are service-role only.
-- They are not tenant-scoped (an address may belong to many businesses) and
-- exposing them would leak deliverability state across tenants.
```

### D3 — enforce at BOTH enqueue and drain

- **Enqueue-check:** before inserting an outbox row, the trigger/tail/worker queries `email_suppressions` by recipient. If suppressed, it writes the row directly as `suppressed` (audit) rather than `pending`, so it is never claimed. This prevents needless `pending` churn for addresses we already know are dead.
- **Drain-check:** after the drainer claims a `pending` row (`sending`), it re-queries suppressions before calling the provider. A bounce that arrived *between* enqueue and drain moves the row `sending → suppressed`.

The rejected single-point alternatives: enqueue-only misses every bounce that lands after enqueue (the common case for a row sitting in the queue across a backoff window); drain-only wastes outbox rows and a claim cycle on addresses we already know are suppressed, and pays the lookup on every drain regardless. Doing both costs one indexed PK lookup at enqueue and one at drain — both O(1) against a `text PRIMARY KEY` — and closes the race in the direction that matters (never send to a suppressed address).

---

## 7. Locale resolution

**Resolution: reuse the existing `businesses.language` column. No new column, no backfill.**

Your §7 instruction was conditional — add `businesses.preferred_locale` *only if* the signup locale is not already persisted somewhere queryable. It is: `businesses.language text NOT NULL DEFAULT 'en' CHECK (language IN ('en','pt','es'))` already exists (`20260430120003_businesses.sql:20`), is set during onboarding, and is the column the AI layer already reads for native-language generation. Adding a `preferred_locale` column would create two competing locale sources of truth for the same business and an inevitable drift bug. The architecturally correct move is to make `businesses.language` the single locale authority for email too.

Consequences:
- **No migration** for locale, and **no backfill wart** — because `language` is `NOT NULL DEFAULT 'en'` it is already populated for every existing row, and PT/ES users who completed onboarding already carry their real locale. (Had we added a fresh `preferred_locale`, every existing PT/ES business would have been wrongly backfilled to `'en'`; reusing `language` avoids that entirely.)
- **D2 — snapshot at enqueue.** The enqueue path copies `businesses.language` into `email_outbox.locale` at row-creation time. The drainer renders against the row's snapshot locale, never re-reading `businesses.language`.

### D2 — why snapshot, not read-live

The rejected alternative reads `businesses.language` live at drain time. Consider a trial business that receives `trial-warning-t3` in Portuguese, then switches the account to Spanish before T-1: read-live would deliver the second warning of the same sequence in a different language — a jarring, seemingly-broken experience. Snapshotting locks each enqueued email to the language in effect when the trigger fired, so a sequence stays internally consistent. The cost — a row drained days later might be in a now-stale language if the customer changed preference in between — is acceptable and arguably correct: the email reflects the intent at the moment it was triggered.

---

## 8. Template strategy

React Email components rendered server-side, with copy supplied by next-intl `getTranslations` (not the client `useTranslations`), keyed per kind per locale. Each kind is one file under `lib/email/templates/`; all share `lib/email/templates/_layout.tsx` for the visual identity (logo header, footer, type scale, dark-mode meta — §8b). Rendering produces HTML; a separately authored plain-text body is generated alongside (§8b).

Props are validated with Zod **at render time**, inside the drainer, before the provider call:

```typescript
// lib/email/templates/<kind>.tsx — each kind exports its props schema
export const welcomeToPlanProps = z.object({
  businessName: z.string().min(1),
  planName: z.enum(['plus', 'pro']),
  dashboardUrl: z.string().url(),
})
export type WelcomeToPlanProps = z.infer<typeof welcomeToPlanProps>
```

Validating at render (not enqueue) is the loud-failure mechanism that makes D1's props-only storage safe: a row whose stored `props` no longer match the current schema fails with `template_render_failed` → `failed`, visible in the failure dashboard, rather than rendering a half-empty email.

### 8a — Copy deliverable (Builder transcribes to i18n JSON)

Subjects are < 60 chars (Gmail truncation). Preheader is the hidden preview line. PT/ES run 20–30% longer than EN — Builder must verify subjects still fit after translation and may shorten idiomatically rather than translate literally. Trial framing counts *down to expiry*, never *up from start*. `payment-failed-courtesy` is empathetic with exactly one recovery path.

**`trial-warning-t3`**
- **EN subject:** `3 days left in your SOSH trial`
- **Preheader:** `Keep your campaigns running — pick a plan before your trial ends.`
- **Body skeleton:** Lead — "Your SOSH trial ends in 3 days." · Support — one line on what they lose at expiry (campaigns pause, no new posts generated) and what a plan unlocks. · **CTA:** `Choose your plan`
- **Locale notes:** PT "Faltam 3 dias no teu período de teste SOSH" / ES "Te quedan 3 días de prueba en SOSH" — both ~25% longer; keep subject under truncation. Use the *remaining-days* framing in all three. Avoid "trial expires" alarmism — frame as continuity.

**`trial-warning-t1`**
- **EN subject:** `Last day of your SOSH trial`
- **Preheader:** `Your trial ends tomorrow — choose a plan to keep going.`
- **Body skeleton:** Lead — "Your SOSH trial ends tomorrow." · Support — concrete: which campaigns/posts pause, and that picking a plan keeps everything as-is. · **CTA:** `Choose your plan`
- **Locale notes:** PT "Último dia do teu período de teste SOSH" / ES "Último día de tu prueba en SOSH". Heightened urgency vs T-3 but same calm register; same countdown framing.

**`welcome-to-plan`**
- **EN subject:** `Welcome to SOSH {planName}`
- **Preheader:** `Your plan is active — here's what's unlocked.`
- **Body skeleton:** Lead — "You're on SOSH {planName}." · Support — bullet what the plan unlocks (platforms, post volume, analytics tier) drawn from `getPlanCapabilities`. · **CTA:** `Go to your dashboard`
- **Locale notes:** PT "Bem-vindo ao SOSH {planName}" / ES "Te damos la bienvenida a SOSH {planName}". Keep plan name un-translated (proper noun). Warm, congratulatory.

**`payment-failed-courtesy`**
- **EN subject:** `A quick note about your SOSH payment`
- **Preheader:** `We couldn't process your latest payment — here's how to fix it.`
- **Body skeleton:** Lead — "We weren't able to process your most recent payment." · Support — reassure (no immediate loss of access), one clear instruction to update the card. · **CTA:** `Update payment method`
- **Locale notes:** PT "Uma nota rápida sobre o teu pagamento SOSH" / ES "Una nota sobre tu pago en SOSH". Empathetic, never punitive; no threats, no deadlines, one recovery path (billing portal). Single email — no follow-up sequence (L8).

**`first-post-published`**
- **EN subject:** `Your first post is live 🎉`
- **Preheader:** `SOSH just published your first post to {platform}.`
- **Body skeleton:** Lead — "Your first post is live on {platform}." · Support — one line reinforcing the loop (review more drafts, keep the cadence going). · **CTA:** `View your posts`
- **Locale notes:** PT "A tua primeira publicação está no ar 🎉" / ES "Tu primera publicación ya está publicada 🎉". Emoji optional per locale; celebratory. `{platform}` is a brand name — never translate.

### 8b — Accessibility (HTML-email WCAG subset — required)

- **Contrast:** body text ≥ 4.5:1 against background; large text (≥ 18.66px bold / 24px) ≥ 3:1 (WCAG 1.4.3). The Stone palette already used in error boundaries (ADR 0007 §B7) meets this; verify the CTA button's text-on-fill ratio specifically.
- **Logo alt text:** the header logo `<img>` carries `alt="SOSH"` — meaningful, not empty, not "logo" (WCAG 1.1.1).
- **CTA is a semantic `<a>`** styled as a button (padding, background, radius). Never a `<div>`/`<table>` cell acting as a button (WCAG 4.1.2). One CTA per email.
- **Descriptive link text** matching the destination — "Choose your plan", "Update payment method", "View your posts" — never "click here" (WCAG 2.4.4).
- **200% zoom legibility:** fluid widths, `max-width: 600px` body, no fixed typography below 14px (WCAG 1.4.4).
- **Dark-mode survivability:** include `<meta name="color-scheme" content="light dark">` and `<meta name="supported-color-schemes" content="light dark">` in `_layout`; set explicit `background-color` on the outer wrapper and explicit `color` on text so Apple Mail's dark-mode auto-inversion does not produce unreadable combinations. Test the logo on both backgrounds (transparent PNG with adequate contrast both ways, or a dark-mode swap).
- **Separate plain-text part:** the `text` field is authored from the copy in §8a, **not** generated by stripping HTML tags. Required for text-preferring screen readers and a meaningful contributor to deliverability/spam scoring.

---

## 9. Drainer cron — `/api/cron/drain-email-outbox`

Every minute (L6). Follows ADR 0005 §12 + Amendment 1: QStash dual-mode auth (`CRON_TRIGGER` hard-branch — GET+Bearer in `secret` mode, POST+QStash signature in `qstash` mode), always-200, one canonical JSON log line per tick, `triggeredBy` threaded through, route thin / orchestrator in `lib/email/orchestrator.ts`. These are not exceptions (L4).

**Claim query** — atomic, race-free across overlapping ticks:

```sql
-- Claim a batch of drainable rows; SKIP LOCKED lets concurrent ticks not collide.
UPDATE public.email_outbox
   SET status = 'sending', updated_at = now()
 WHERE id IN (
   SELECT id FROM public.email_outbox
    WHERE status = 'pending' AND next_attempt_at <= now()
    ORDER BY next_attempt_at
    FOR UPDATE SKIP LOCKED
    LIMIT $1   -- EMAIL_DRAIN_BATCH_SIZE
 )
RETURNING *;
```

Exposed as a service-role `claim_email_outbox(batch_size int)` SECURITY DEFINER RPC with `REVOKE ... FROM public; GRANT EXECUTE ... TO service_role`, identical to `claim_posts_for_publishing` (ADR 0005 §). The partial index `email_outbox_drainable_idx` is the scan target.

**Per-row flow** (`runEmailDrainTick`):
1. Drain-check suppressions (D3) → if suppressed, `sending → suppressed`, continue.
2. Load template for `kind`, validate `props` with the kind's Zod schema → on failure, `template_render_failed` → `failed`, continue.
3. Render HTML + select plain-text in row's `locale` (`getTranslations`).
4. `getEmailProvider().send({ ..., idempotencyKey: row.id })` — **D7**: the outbox row id is the Resend `Idempotency-Key`.
5. Success → `sent`, store `provider_message_id`, `sent_at`. Transient error → `pending` with backoff + `attempts++` (or `failed` if `attempts+1 >= EMAIL_MAX_ATTEMPTS`). Terminal error → `failed`.

**Tick budget:** `EMAIL_DRAIN_BATCH_SIZE` rows per tick (default 50); a tick processes its claimed batch and returns. Backlog drains over subsequent minutes. Claimed-but-not-completed rows (process crash mid-tick) sit in `sending`; a stuck-row reaper analogous to ADR 0005's `reapStuckScheduledPosts` returns `sending` rows older than `EMAIL_SENDING_STUCK_MINUTES` to `pending` — folded into the existing janitor tick (ADR 0005 §11), not a new cron.

### D7 — both idempotency layers

We pass Resend an `Idempotency-Key` (the outbox row id) **and** keep outbox-row dedupe (§5 unique constraint). They defend different failure modes: the outbox unique constraint stops *our* side from creating a duplicate intent; the Resend idempotency key stops *Resend's* retry machinery (and our own at-step-4 retry after a timeout where the send actually succeeded) from delivering twice for the same row. Using only outbox dedupe leaves the "we timed out, retried, but the first send had landed" window open; using only the provider key leaves duplicate *intents* (two rows for one logical email) possible. Both, together, close both windows. The row id is a stable, deterministic key — a retry of the same row reuses it automatically.

---

## 10. Trial-warning cron — `/api/cron/trial-warnings`

Daily 09:00 UTC (L5). ADR 0005 §12 + Amendment 1 conventions (L4).

**UTC, not customer-local — deliberate (L5).** The rejected alternative computes each customer's local 09:00 from `businesses.timezone` and sends per-timezone. That requires either 24 hourly cron passes with per-row timezone filtering or a per-customer scheduler — real complexity for a marginal open-rate gain on a once-per-trial email. A single 09:00 UTC pass lands mid-morning to early-afternoon across EU (our B2B-SaaS ICP's core timezones) and is acceptable for the Americas. We revisit if open-rate data justifies it (§18).

**Scan windows.** Trial expiry is derived from trial state (ADR 0001 / trial_state schema — read in-place when building). T-3 selects trial businesses whose expiry falls in `[now+2d, now+3d)`; T-1 selects `[now+1d, now+2d)` (day-granular, adjacent to T-3 with no gap; a once-daily run catches each business exactly once as it crosses each threshold). The `[now+1d, now+2d)` window ensures the "ends tomorrow" copy is accurate — expiry is at least 24 hours away at send time — and keeps the two scan windows adjacent with no ambiguous day between them. Exact boundary arithmetic is the Builder's, against the trial-state expiry field.

**Plan-exclusion filter.** Skip any business where `plan != 'trial'` — a business that already upgraded must never receive a trial warning. Filtered in the scan query, not post-hoc.

**Enqueue + self-idempotency.** For each matched business, enqueue with the snapshot locale (§7) and `dedupe_token = NULL`. The `email_outbox_dedupe_uq` constraint on `(business_id, kind, '')` means a second run the same day (retry, manual trigger, overlapping window) raises `23505` and is swallowed — each business gets exactly one T-3 and one T-1 ever. No separate "already warned" bookkeeping column is needed; the unique constraint *is* the bookkeeping.

---

## 11. Stripe webhook integration

Resolves **D4**.

**Decision: enqueue via `after()` with Sentry capture on failure — option (a).**

Enqueue for `welcome-to-plan` (`checkout.session.completed`) and `payment-failed-courtesy` (`invoice.payment_failed`) is scheduled with Next.js `after()` in the route, *after* `dispatchWebhookEvent` returns its outcome and the route has committed the `billing_events` outcome and returned 200. The enqueue runs detached from the response.

### Why not the synchronous 500-retry option I first proposed

The original proposal — enqueue synchronously inside dispatch, let an enqueue failure bubble to a 500 so Stripe retries — does not actually recover the email, and you caught why. The route pre-records `billing_events` with the event id as PK *before* dispatch (Session 11A; CLAUDE.md "Webhook handlers"). On Stripe's retry, the `23505` duplicate path returns 200 immediately **without re-running `dispatchWebhookEvent`**. So the retry never re-reaches the enqueue site; the 500 burns a retry that bails at the idempotency guard. The recovery is illusory. Restructuring the duplicate path to re-check the outbox and re-enqueue (option c) would work but means the idempotency anchor stops being a clean short-circuit — every "duplicate" now has to reconstruct and compare outbox state, coupling billing idempotency to email state. Rejected as over-coupling for Phase 1.

### Chosen failure mode — stated explicitly

With `after()`, an enqueue failure occurs *after* the 200 is sent. **Stripe never learns and never retries. The email is silently dropped** — the only trace is the Sentry capture emitted in the `after()` callback's catch. We accept this because the two affected kinds have independent backstops:
- `welcome-to-plan` — the post-checkout success page already confirms the upgrade in-app (Session 11A §B8), so the customer is not left uninformed; the email is reinforcement, not the sole signal.
- `payment-failed-courtesy` — is by definition a single courtesy email with no dunning (L8); losing it on a rare enqueue failure degrades gracefully to the billing portal and the in-app plan state, and the Sentry alert lets us follow up manually if it ever fires.

The conversion-critical path — trial→paid — does **not** depend on this at all: it is covered by the trial-warning cron (§10), which is a pull from a durable scan, not a push from a webhook. So the one place silent-drop would actually cost revenue is structurally immune to it.

**Idempotency.** The enqueue passes `dedupe_token = event.id` (the Stripe event id). A Stripe webhook replay that *does* re-run dispatch (e.g. the first delivery 500'd before `billing_events` was written) and reaches the enqueue again collides on `email_outbox_dedupe_uq` → `23505` → no-op. The webhook stays idempotent; `billing_events` remains the billing-state anchor and the outbox unique constraint is the email anchor — two independent idempotency keys for two independent concerns.

---

## 12. Publishing worker integration

Resolves **D5**.

**Decision: business-level counter 0→1 on a new `businesses.total_posts_published` column** (verified absent today — it exists only on `campaigns`, §preamble). Following existing naming convention (`campaigns.total_posts_published`), the new column is `businesses.total_posts_published int NOT NULL DEFAULT 0`.

```sql
ALTER TABLE public.businesses
  ADD COLUMN total_posts_published int NOT NULL DEFAULT 0;

-- Atomic increment-and-return; the RETURNING value is the post-increment count.
-- Mirrors increment_published_count_for_campaign (ADR 0005 §, migration 20260525100000).
CREATE OR REPLACE FUNCTION public.increment_business_published_count(p_business_id uuid)
RETURNS int
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.businesses
     SET total_posts_published = total_posts_published + 1
   WHERE id = p_business_id
  RETURNING total_posts_published;
$$;
REVOKE ALL ON FUNCTION public.increment_business_published_count(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.increment_business_published_count(uuid) TO service_role;
```

**Where the detection lives.** In `runPublishTick`, at each successful publish — the points where the orchestrator already calls `incrementPublishedCountForCampaign` (`orchestrator.ts:123` happy path and `:202` token-refresh-retry path). At each of those sites, the worker also calls `increment_business_published_count(business_id)`; **iff the returned value === 1, it enqueues `first-post-published`** (dedupe key `(business_id, kind)`, snapshot locale). This is a single new enqueue at the 0→1 transition — the worker's publish logic is otherwise unchanged.

### D5 — race-freedom argument, and why not the alternatives

The `UPDATE ... SET n = n + 1 ... RETURNING n` runs as a single atomic statement holding a row lock on the `businesses` row. Two posts for the same business published concurrently (two rows in the same claimed batch, or two overlapping ticks) serialize on that row lock: one transaction returns `1`, the next returns `2`. Exactly one observes `RETURNING = 1`, so exactly one enqueue is attempted — and even if logic elsewhere double-fired, the `(business_id, 'first-post-published')` unique constraint is the backstop. The rejected alternatives: a `SELECT count(*) FROM posts WHERE status='published'` immediately before enqueue races — two concurrent publishes can both read 0 and both enqueue; a Postgres `AFTER UPDATE` trigger on `posts.status` is race-free but moves the decision out of the application into a trigger that the test pyramid (§16) cannot exercise with the Mock provider, and couples email enqueue to a raw status write with no visibility. The counter-RETURNING approach is race-free *and* testable from `runPublishTick` with the existing mock infrastructure.

---

## 13. Supabase Auth SMTP relay

Auth emails are configured in the **Supabase dashboard** (Authentication → Email → SMTP settings), not in application code (L2).

- **SMTP host/port:** Resend SMTP (`smtp.resend.com`, port 465 TLS / 587 STARTTLS), authenticated with a Resend SMTP credential.
- **Sender identity:** `From: hello@mail.sosh.app`, matching the product layer (L7) so all SOSH email shares one authenticated subdomain and one brand.
- **Template re-styling scope:** Supabase's built-in templates (confirm signup, reset password, change email, magic link) are re-styled to approximate the product visual identity within Supabase's template constraints (it is not React Email — it is Supabase's own Go-template HTML). Scope is "on-brand and legible," not "pixel-identical to product email."
- **Single-locale wart (launch):** Supabase Auth templates are single-template — they do not switch on a per-user locale. At launch, **auth emails are EN-only** regardless of the user's `businesses.language`. A PT/ES customer receives a Portuguese/Spanish *product* experience but English *auth* emails (confirm, reset). This is an accepted launch wart; the fix (§18) is either Supabase's newer per-locale template support or webhook-intercept.

**Why not intercept auth email via webhook into `lib/email/` at launch.** Supabase can emit an auth-email webhook ("send email" hook) that we could catch and render through our own multi-locale templates. We decline at launch because it means reimplementing the security-sensitive parts Supabase owns — the one-time token, its expiry, single-use invalidation, and the exact link format Supabase's verify endpoint expects — with no margin for error (a bug means users cannot confirm or reset). The SMTP relay keeps Supabase fully in control of the token lifecycle and only swaps the transport. Multi-locale auth is a Phase-2 enhancement (§18), not a launch blocker.

---

## 14. Resend webhook — `/api/webhooks/resend`

Resolves **D6**.

**Decision: a dedicated `email_webhook_events` table mirroring `billing_events`.**

```sql
CREATE TABLE public.email_webhook_events (
  id              text        PRIMARY KEY,   -- svix delivery id (idempotency anchor)
                                             -- The svix-id header is stable across Resend retries
                                             -- and is preferred over payload.data.email_id which
                                             -- may be absent on non-delivery events.
  event_type      text        NOT NULL       -- normalised before insert: known Resend types stored
                    CHECK (event_type IN (   -- as-is; unrecognised types (email.sent,
                      'email.bounced',       -- email.delivery_delayed, email.failed, etc.)
                      'email.complained',    -- mapped to 'other' to avoid 23514 on the CHECK.
                      'email.delivered',     -- Dispatch in the route keys on payload.type (not
                      'email.opened',        -- event_type) so bounce/complaint still resolve.
                      'email.clicked',
                      'other'
                    )),
  payload         jsonb       NOT NULL,      -- full Resend payload; recipient email extracted
                                             -- from payload.data.to[0] at dispatch time (no
                                             -- separate email column — avoids schema drift if
                                             -- Resend changes payload shape)
  received_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.email_webhook_events ENABLE ROW LEVEL SECURITY;
-- No authenticated policy: service-role only.
```

The rejected alternative is `ON CONFLICT DO NOTHING` against `email_suppressions` keyed on `(email, source_event_id)`, with no separate event table. It is simpler — no new table — but it discards the audit row for the `delivered`/`opened`/`clicked` events we choose to ignore, and it conflates "we received this Resend event" with "this address is suppressed." A dedicated event table is consistent with the `billing_events` model (Session 11A), gives a clean replay-rejection point (Resend event id as PK; `23505` → 200), and keeps an audit trail independent of whether the event mutated suppressions. The cost is one more small table; worth it for parity with the billing webhook and a real audit log.

**Flow** (mirrors CLAUDE.md "Webhook handlers" exactly):
1. Read raw body first (signature needs the unmodified string).
2. Verify the Resend webhook signature (svix-style headers). Invalid → 400 (no retry).
3. Normalise `event_type`: map the raw `payload.type` to `'other'` if it is not in the CHECK set (prevents `23514` on `email.sent` / `email.delivery_delayed` / `email.failed`). Pre-record into `email_webhook_events` using the **svix delivery id** (`svix-id` header) as PK. `23505` → duplicate → 200 immediately, no reprocessing.
4. Dispatch by type:
   - `email.bounced`, `email.complained` → upsert `email_suppressions` (`reason = 'bounce' | 'complaint'`, `source_event_id`).
   - `email.delivered`, `email.opened`, `email.clicked`, others → explicit no-op (Resend dashboard is the source of truth for delivery telemetry, §17; we do not duplicate it).
5. Return 200 on success; unhandled dispatch error → 500 (Resend retries).

---

## 15. Config surface

Every new env var the Builder adds to `/lib/config.ts` (typed object; never `process.env` directly outside that file — CLAUDE.md):

```typescript
// Server-only (config.server.*)
RESEND_API_KEY: string                 // Resend REST key (used by resend-provider.ts only)
RESEND_WEBHOOK_SECRET: string          // verifies /api/webhooks/resend signatures
EMAIL_PROVIDER: 'resend' | 'mock'      // registry selector; 'mock' in tests (default 'resend')
EMAIL_FROM: string                     // 'hello@mail.sosh.app' (L7)
EMAIL_REPLY_TO: string                 // 'support@sosh.app' (L7)
EMAIL_DRAIN_BATCH_SIZE: number         // default 50 (§9 tick budget)
EMAIL_MAX_ATTEMPTS: number             // default 5 (§5/§9 transient retry cap)
EMAIL_RETRY_BACKOFF_SECONDS: number    // default 60 (§9 exponential base)
EMAIL_SENDING_STUCK_MINUTES: number    // default 10 (§9 stuck-row reaper, janitor)

// Reused, not new: CRON_SECRET, CRON_TRIGGER, QSTASH_* (ADR 0005 Amendment 1) cover
// both new crons. EMAIL_PROVIDER mirrors SOCIAL_PROVIDER / AI_PROVIDER naming.
```

---

## 16. Testing strategy

Per the testing pyramid; every error path tested (CLAUDE.md — no fixed coverage number, but no untested error branch). Targeted runs per the project convention (`npx vitest run lib/email lib/db ...`).

**Unit (many, fast):**
- Render every kind in every locale (5 × 3 = 15) without throwing; snapshot subject/preheader presence.
- Each kind's Zod props schema rejects malformed shapes (`template_render_failed` path).
- `MockEmailProvider` capture assertions + failure injection per `EmailProviderErrorCode`.
- Suppression enqueue-check: suppressed recipient → row written `suppressed`, never `pending`.
- Locale capture invariant: enqueue snapshots `businesses.language`; later `language` change does not alter a queued row's `locale`.
- `EmailProviderError.details` redaction uses the shared `REDACTED_KEYS` (reference-equality test, mirroring ADR 0007 §A1).

**Integration (some, medium):**
- Drainer route under QStash dual-mode auth (L4): claim, transient→`pending`-with-backoff, terminal→`failed`, attempts-exhausted→`failed`, drain-time suppression→`suppressed`, tick-budget exhaustion leaves backlog.
- Trial-warnings cron: T-3 and T-1 window detection at boundaries, `plan != 'trial'` exclusion, same-day double-run dedupe via `23505`.
- Resend webhook: signature verify (valid/invalid/missing), event dedupe (`23505`→200), bounce/complaint→suppressions write, delivered/opened/clicked→no-op.
- First-post: `increment_business_published_count` RETURNING=1 enqueues exactly once; RETURNING=2 does not; concurrent-publish dedupe backstop.

**Manual smoke (few, high-confidence, pre-launch):**
- Resend sandbox sends for all 5 kinds visible in the Resend dashboard, rendered + dark-mode checked in a real client.
- Bounce simulation (Resend test address) propagates to `email_suppressions`.
- Manually triggered trial-warnings cron produces a real T-3 and T-1 email.
- Auth-email roundtrip via Supabase Auth: confirm-signup, password-reset, change-email all relay through Resend SMTP and arrive.

---

## 17. Observability

Three canonical JSON log lines (one-line-per-event convention, ADR 0005 Amendment 1):
- `email.enqueue` — `{ kind, business_id, locale, deduped: boolean }` (deduped=true when `23505` swallowed).
- `email.drain.tick` — `{ triggeredBy, claimed, sent, failed, retried, suppressed, durationMs }` — one per drain tick.
- `email.webhook` — `{ type, deduped, suppressedWritten: boolean }` — one per Resend webhook.

**Sentry:** errors only — `template_render_failed`, `unknown`, the `after()` enqueue-failure capture (§11), exhausted-retry `failed` rows. Recipient addresses are scrubbed at the Sentry boundary via the ADR 0007 §3.3 scrubber; they never reach Sentry in clear. The two new crons are wrapped in `Sentry.withMonitor` (slug `drain-email-outbox`, `trial-warnings`) exactly as `publish-tick`/`janitor-cron`/`metrics-sync-tick` are (ADR 0005, ADR 0006, ADR 0007 §3.5).

**Resend dashboard is the source of truth for delivery telemetry** (sends, opens, clicks, bounce rate). We do not duplicate per-message delivery state into our DB — `email_outbox` records *our intent and our send attempt*, Resend records *what happened to the message after handoff*. Bounce/complaint is the only delivery signal we pull back, and only because it feeds suppressions (§14).

---

## 18. Open follow-ups

- **Engagement-event email** (new comment / DM notifications) — Phase 2, new EmailKinds + triggers.
- **Dunning sequence** — escalating payment-failure emails beyond the single courtesy email (L8); Phase 3.
- **Multi-locale Supabase Auth** — remove the EN-only auth wart (§13) via Supabase per-locale templates or webhook-intercept into `lib/email/`.
- **In-app email history UI** — the `email_outbox_select_own` RLS policy (§5) already permits a customer to read their business's rows; surface a "notifications sent" view.
- **A/B testing** — subject-line / CTA variants on trial warnings once volume supports significance.
- **Generic `webhook_events` consolidation** — `billing_events` and `email_webhook_events` are structurally identical; a single polymorphic table with a `source` column is a future consolidation (deferred — premature now).
- **Bounce / complaint-rate alerting** — threshold alerts off the suppressions write rate (deliverability-reputation guard).
- **Customer-local-time trial warnings** — revisit §10's UTC choice if open-rate data justifies per-timezone scheduling.

---

## 19. Launch-checklist patch

> **Builder:** apply the following additions to `docs/launch-checklist.md`. Place the DNS/Resend/Supabase rows in the infrastructure section and the smoke tests in the verification section, matching the existing table format. Do not duplicate rows that already exist.

```markdown
### Transactional Email (ADR 0008)

#### DNS / sender authentication (mail.sosh.app)
- [ ] Resend domain `mail.sosh.app` added and verified
- [ ] SPF record published for `mail.sosh.app`
- [ ] DKIM record(s) published for `mail.sosh.app`
- [ ] DMARC policy published for the root domain
- [ ] `From: hello@mail.sosh.app` and `Reply-To: support@sosh.app` confirmed in a live send

#### Supabase Auth SMTP relay
- [ ] Supabase Auth custom SMTP configured to Resend (host, port, credential)
- [ ] Auth sender set to `hello@mail.sosh.app`
- [ ] Auth templates re-styled on-brand (confirm-signup, password-reset, change-email)
- [ ] NOTE: auth emails are EN-only at launch (accepted wart — ADR 0008 §13)

#### Resend webhook
- [ ] Resend webhook endpoint registered → `/api/webhooks/resend`
- [ ] `RESEND_WEBHOOK_SECRET` set in Vercel env (production)
- [ ] Signature verification confirmed (invalid signature → 400)

#### Data preconditions
- [ ] `email_suppressions` table empty pre-launch (no stale suppressions)
- [ ] `businesses.total_posts_published` column present (migration applied)

#### Env vars (production)
- [ ] `RESEND_API_KEY`
- [ ] `RESEND_WEBHOOK_SECRET`
- [ ] `EMAIL_PROVIDER=resend`
- [ ] `EMAIL_FROM=hello@mail.sosh.app`
- [ ] `EMAIL_REPLY_TO=support@sosh.app`
- [ ] `EMAIL_DRAIN_BATCH_SIZE`, `EMAIL_MAX_ATTEMPTS`, `EMAIL_RETRY_BACKOFF_SECONDS`, `EMAIL_SENDING_STUCK_MINUTES` (or accept defaults)

#### QStash schedules (ADR 0005 Amendment 1)
- [ ] `/api/cron/drain-email-outbox` scheduled every minute (`* * * * *`)
- [ ] `/api/cron/trial-warnings` scheduled daily 09:00 UTC (`0 9 * * *`)

#### Smoke tests — product email (6)
- [ ] `trial-warning-t3` renders + sends (sandbox), visible in Resend dashboard
- [ ] `trial-warning-t1` renders + sends
- [ ] `welcome-to-plan` renders + sends
- [ ] `payment-failed-courtesy` renders + sends
- [ ] `first-post-published` renders + sends
- [ ] Bounce simulation propagates to `email_suppressions`

#### Smoke tests — auth email (3)
- [ ] Signup-confirm relays via Resend SMTP and arrives
- [ ] Password-reset relays and arrives
- [ ] Change-email relays and arrives
```

---

## Amendment 1 — Retry-After extraction and event-type normalisation

> **Status:** Implemented in Session 15 (2026-06-10). Closes open items A9 and D3 from the original bug log.

### A9 — Retry-After header extraction and backoff cap

**Problem.** When Resend returns HTTP 429, the response carries a `Retry-After` header (delta-seconds or HTTP-date format). The original `computeBackoff` ignored this and fell through to exponential jitter, which could schedule retries too early (hammering the rate limit) or too late (unnecessary delay when Resend says "retry in 30 s").

**Decision.** `computeBackoff(attempts, retryAfterSeconds?)`:
- If `retryAfterSeconds` is provided, use it directly — no jitter added, because the provider's directive is authoritative.
- Cap the result at **3600 s** (one hour) in both paths to bound worst-case delay.
- `resend-provider.ts` extracts the header via `parseRetryAfterHeader`, sets `err.retryAfterSeconds` on the thrown `EmailProviderError`, and the drain orchestrator passes `err.retryAfterSeconds` as the second argument to `computeBackoff`.

**Consequences.** Retry intervals honour provider guidance. The 3600 s cap prevents unbounded delay on pathological Retry-After values. Resend SDK v6 exposes `Response<T>.headers` (verified in Session 15; `parseRetryAfterHeader` path is live). No Amendment 2 required.

### D3 — Unknown event-type normalisation

**Problem.** Resend may emit event types not listed in `EmailWebhookEventType` (the DB `CHECK` constraint). Inserting an unknown string raises Postgres error `23514`, the webhook returns 500, and Resend retries — causing a retry storm for every novel event type Resend introduces.

**Decision.** The Resend inbound webhook handler normalises any unknown `event.type` value to `'other'` before the DB insert. The `'other'` value is included in the `CHECK` constraint. A Sentry breadcrumb records the original unknown value for observability.

**Consequences.** Novel Resend event types land as `other` rows without causing constraint violations. The original value is preserved in Sentry. No schema migration is needed when Resend adds event types.
