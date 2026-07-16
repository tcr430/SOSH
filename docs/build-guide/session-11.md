# Session 11 — Stripe Billing

> **Goal:** Take money. Trial users hit a paywall; they choose Starter (€99) or Pro (€199) on a pricing page, complete Stripe Checkout, and land back in the app on a plan with the trial cap lifted. A webhook handler keeps `businesses.plan` / `stripe_subscription_id` truthful as subscriptions are created, updated, cancelled, or fall into payment failure. A plan-enforcement helper centralises "can this customer use this feature?" so feature gates don't drift across the codebase.
> **Time:** 4–6 hours including correction pass
> **Models:** Builder (Sonnet 4.6) → Reviewer (Opus 4.7, security-focused) → optional Correction (Sonnet 4.6)
> **Plugins:** ECC throughout, claude-mem automatic, frontend-design auto-activates for the pricing page
> **Session structure:** Single Builder session + Reviewer. No Architect — Stripe Checkout + webhook + plan enforcement are well-trodden patterns. The security surface (signature verification, idempotency, replay protection) is the Reviewer's job, not an ADR's. Expect a Session 11C correction pass.

---

## Why no Architect session

Stripe Checkout, Customer Portal, and webhook signature verification are public, documented, and stable. The data model is already specified in ADR 0001:

- `businesses.plan` (`trial | starter | pro | agency`) — already present
- `businesses.stripe_customer_id` — already present, with the unique partial index for webhook lookup
- `businesses.stripe_subscription_id` — already present, with its unique partial index
- `trial_state.trial_card_fingerprint` — already present (anti-abuse, populated by webhook)

Plan limits are documented in CLAUDE.md ("Locked strategic decisions") and already enforced piecewise — campaign caps in `/lib/campaigns/enforcement.ts` (Session 7), AI cost caps in `/lib/ai/runner.ts` (Session 5), platform availability in `/lib/social/platforms/config.ts` (Session 6). What's missing is the *upgrade path* and the *single source of truth* for "what does the current plan permit?".

This session adds both, plus the webhook that keeps the plan field truthful. No novel architecture. Reviewer + correction pass is sufficient because the bugs that would hurt here are security and idempotency bugs — exactly what `security-reviewer` is for.

---

## What this session builds and what it doesn't

**Builds:**
- `lib/stripe/client.ts` — singleton Stripe SDK client, lazy import, server-only guard
- `lib/stripe/products.ts` — single source of truth mapping Starter/Pro to Stripe Product + Price IDs (env-driven)
- `lib/stripe/checkout.ts` — `createCheckoutSession(businessId, plan)`, `createBillingPortalSession(businessId)`
- `lib/stripe/webhook.ts` — `parseWebhookEvent(rawBody, signature)` (signature verification helper), and a per-event-type handler dispatcher
- `lib/stripe/plan.ts` — `getPlanCapabilities(plan)`: the single source of truth for "Starter allows X, Pro allows Y" used by feature gates everywhere
- `lib/db/billing-events.ts` + migration — append-only `billing_events` table for webhook idempotency (idempotency key = Stripe `event.id`)
- `lib/db/businesses.ts` additions — service-role helpers `updateBillingFromSubscription`, `clearBillingOnCancellation`, `findBusinessByStripeCustomerId`
- `app/api/stripe/webhook/route.ts` — the webhook handler, raw-body, signature-verified, idempotent
- `app/[locale]/(dashboard)/billing/page.tsx` — pricing cards (Starter / Pro), current plan banner, "Manage billing" → Customer Portal
- `app/[locale]/(dashboard)/billing/actions.ts` — `startCheckoutAction`, `openBillingPortalAction`
- `app/[locale]/(dashboard)/billing/success/page.tsx` — post-checkout landing, polls until webhook has flipped the plan
- Plan-gate UX in two places that already exist: the campaign limit error in `/lib/campaigns/enforcement.ts` (Session 7) now offers an "Upgrade" link; the trial banner in the dashboard shell gains a CTA → `/billing`
- i18n keys in a new `billing.*` namespace (EN/PT/ES)

**Defers (explicit non-goals):**
- Annual billing toggle (Phase 2 — only monthly at launch)
- Tax handling beyond Stripe Tax's defaults (Phase 2; rely on Stripe Tax automatic for now)
- Proration UX (Stripe Customer Portal handles it; we don't replicate)
- Per-seat / team plans (Agency tier deferred to Phase 4 per CLAUDE.md)
- Coupons / promo codes (deferred)
- Dunning emails (Phase 2 — Stripe sends its own; ours come later via Resend)
- The `trial_card_fingerprint` anti-abuse *check* — we record the fingerprint via webhook so the data exists, but the "block second business with same card" enforcement is deferred to a later session
- Per-business analytics on MRR / churn — separate concern, future dashboard
- Currency switching — EUR only at launch

---

## Pre-session checklist

- [ ] Session 10 fully complete — publishing worker live, 10D corrections applied, current-phase.md reflects "Session 10D complete"
- [ ] Stripe account in **test mode** with at least one product configured (or be ready to create them in Prompt B1)
- [ ] `STRIPE_SECRET_KEY` (test, starts `sk_test_`), `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PUBLISHABLE_KEY` all available
- [ ] `stripe` CLI installed locally for webhook forwarding (`brew install stripe/stripe-cli/stripe` or equivalent) — verify `stripe --version` works
- [ ] `npx tsc --noEmit --skipLibCheck` passes
- [ ] `npx vitest run lib/campaigns lib/ai lib/db lib/social lib/publishing` passes
- [ ] claude-mem running at http://localhost:37777
- [ ] You skimmed [Stripe's webhook signing docs](https://docs.stripe.com/webhooks/signatures) for 10 min — what you're integrating with. In particular note the raw-body requirement.
- [ ] APP_URL set correctly in `.env.local` — Checkout success/cancel URLs build from it

---

## Part A — Builder Session (Sonnet 4.6)

### How to run

1. `claude` in terminal
2. `/model` → **Claude Sonnet 4.6**
3. Paste Primer
4. claude-mem injects previous session context — review before Prompt B1
5. Run prompts in order — do NOT `/clear` between them

### Primer

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md, AGENTS.md.
Read /docs/decisions/0001-database-schema.md §B.1 (businesses
table — note plan enum, stripe_customer_id, stripe_subscription_id,
and the two unique partial indexes from §E) and §B.8 (trial_state,
note trial_card_fingerprint).

Read /lib/db/businesses.ts, /lib/db/trial-state.ts,
/lib/db/types.ts, /lib/supabase/service.ts (lazy-import pattern),
/lib/config.ts (typed env var surface — your new STRIPE_* vars
go here), /lib/campaigns/enforcement.ts (Session 7 — your
"Upgrade" link plugs in here).

Skim /app/[locale]/(dashboard)/layout.tsx (dashboard shell —
billing nav item goes here) and components/layout/DashboardShell.tsx.
Skim /app/api/cron/publish/route.ts (Session 10 — pattern for
service-role-bypass-RLS routes, raw-secret comparison, structured
JSON logging — your webhook route follows the same shape).

Session 11 — Stripe Billing. Builder role.

There is no ADR for this session. The "contract" you are
implementing is:
  1. CLAUDE.md "Locked strategic decisions" — Starter €99,
     Pro €199, EUR-only, monthly-only at launch.
  2. ADR 0001 §B.1 — the existing businesses columns are the
     write target; do NOT add new ones.
  3. Stripe's documented Checkout + webhook patterns.

If any of those three is ambiguous, stop and ask. Do not
improvise architecture for a billing surface.

ECC workflow (prefix: /everything-claude-code: not /ecc:):
- /everything-claude-code:plan before each prompt — confirm
  before implementing
- /everything-claude-code:tdd for ALL TypeScript (especially
  the webhook handler — test fixtures before implementation)
- /everything-claude-code:verify after each prompt — do not
  proceed if it fails

Patterns from CLAUDE.md that this session MUST follow:
- All Stripe SDK calls go through /lib/stripe/. No `Stripe(...)`
  instantiation outside that directory.
- Service-role for ALL webhook DB writes — via lazy import.
- The webhook route is service-role-only; the anon client must
  not appear in it.
- All env vars accessed through /lib/config.ts. No
  process.env.STRIPE_* outside that file.
- /lib/db/ only for any DB access — never direct Supabase in
  the webhook route or Server Actions.
- formatISO from date-fns for every timestamp write.
- No console.* except the single structured JSON summary line
  per webhook event (mirrors the publishing-worker logging
  pattern from Session 10).
- No `any` types — Stripe SDK has full types; use them.
  Where you must accept an opaque event payload, type as
  Stripe.Event then narrow with `event.type === '...'`.
- Atomic state transitions: any UPDATE to businesses.plan must
  use a conditional WHERE (e.g. matching stripe_customer_id)
  rather than a read-then-write.
- i18n: every new user-facing string goes in EN/PT/ES
  simultaneously, natural translations, never placeholders.

Confirm:
1. You've read the existing businesses + trial_state columns
   so you understand which fields you are writing, not which
   you are adding.
2. The list of files you'll create/modify in this session.
3. The next available migration number (read /supabase/migrations/
   — Session 10B used 030; you'll use 031).
4. That the webhook route returns the raw body to Stripe's
   verifier — you will NOT JSON.parse before signature check.

Wait for Prompt B1.
```

---

### Prompt B1 — Config and the Stripe client

```
/everything-claude-code:plan "Stripe env config + singleton SDK client"

Following /tdd:

1. /lib/config.ts additions (server section):
   STRIPE_SECRET_KEY:       z.string().min(20).startsWith('sk_')
   STRIPE_WEBHOOK_SECRET:   z.string().min(20).startsWith('whsec_')
   STRIPE_PRICE_ID_STARTER: z.string().min(10).startsWith('price_')
   STRIPE_PRICE_ID_PRO:     z.string().min(10).startsWith('price_')

   Public section:
   STRIPE_PUBLISHABLE_KEY:  z.string().min(20).startsWith('pk_')

   All four server vars REQUIRED — boot fails fast if missing.
   This is intentional: a half-configured billing stack is worse
   than a clearly-failed one.

   Update .env.local.example with comments pointing at the
   Stripe Dashboard URL for each.

2. /lib/stripe/client.ts:
   - import Stripe from 'stripe'
   - Module-level singleton: `let _stripe: Stripe | null = null`
   - export getStripeClient(): Stripe — instantiates on first
     call with apiVersion pinned to the SDK's TypeScript default
     (don't override unless you have a reason; pinning to an
     older version silently disables typed properties)
   - Top of file: serverOnly() guard (same pattern as
     /lib/supabase/service.ts). If somehow imported into a
     client bundle, throw at module load.
   - No env reads — pull from config.server.STRIPE_SECRET_KEY.
   - Add to ESLint: no-restricted-imports rule blocking
     `from 'stripe'` outside /lib/stripe/ (mirrors the existing
     /lib/social/ and /lib/ai/ guards).

3. /lib/stripe/products.ts:
   Single source of truth mapping plan tier → Stripe price.

   export type PaidPlan = 'starter' | 'pro'
   export const PLAN_TO_PRICE_ID: Record<PaidPlan, string> = {
     starter: config.server.STRIPE_PRICE_ID_STARTER,
     pro:     config.server.STRIPE_PRICE_ID_PRO,
   }
   export const PRICE_ID_TO_PLAN: Record<string, PaidPlan>
     // inverted at module load
   export function planForPriceId(priceId: string): PaidPlan | null
     // null if unknown — the webhook handler treats unknown as
     // a no-op, NOT a crash (a price added in the Dashboard but
     // not yet wired into env shouldn't 500 the webhook).

4. Tests in /lib/stripe/products.test.ts:
   - planForPriceId returns 'starter' for the starter ID
   - planForPriceId returns 'pro' for the pro ID
   - planForPriceId returns null for an unknown ID

No Stripe SDK calls in this prompt — just the surface.

/everything-claude-code:verify
```

---

### Prompt B2 — Plan capabilities (the gate)

```
/everything-claude-code:plan "Plan capability map — single source of truth"

This is the file every feature gate reads from. If a gate is
written without going through getPlanCapabilities(), the
reviewer should flag it.

Create /lib/stripe/plan.ts:

  export type Plan = 'trial' | 'starter' | 'pro' | 'agency'

  export interface PlanCapabilities {
    plan: Plan
    /** UI-displayed label, NOT internationalised (i18n is the
     *  caller's job — this is the canonical key). */
    displayKey: string
    /** Total monthly post-generation cap. null = unlimited. */
    postsPerMonth: number | null
    /** Concurrent active campaign cap. null = unlimited. */
    activeCampaigns: number | null
    /** Trial-only "max campaigns ever created" cap. null on
     *  paid plans (use activeCampaigns instead). */
    lifetimeCampaigns: number | null
    /** Which platforms this plan is allowed to publish to.
     *  Reads from /lib/social/platforms/config.ts indirectly —
     *  see implementation. */
    allowedPlatforms: ReadonlyArray<Platform>
    /** Phase 1 product flags. */
    engagementInbox: boolean
    advancedAnalytics: boolean
  }

  export function getPlanCapabilities(plan: Plan): PlanCapabilities

Values from CLAUDE.md "Locked strategic decisions":

  trial:    lifetimeCampaigns=1, postsPerMonth=50,
            allowedPlatforms=['linkedin','twitter'],
            engagementInbox=false, advancedAnalytics=false
  starter:  activeCampaigns=2,    postsPerMonth=30,
            allowedPlatforms=['linkedin','twitter'],
            engagementInbox=false, advancedAnalytics=false
  pro:      activeCampaigns=null, postsPerMonth=null,
            allowedPlatforms=['linkedin','twitter','instagram',
                              'facebook','threads'],
            engagementInbox=true,  advancedAnalytics=true
  agency:   same as pro for Phase 1; reserved for Phase 4

(Note: CLAUDE.md says Starter is 30 posts/month and Pro is
unlimited. The 50-post trial cap is total, not monthly — it's
the lifetime trial budget. Read CLAUDE.md again if this looks
off; do not invent values.)

Tests in /lib/stripe/plan.test.ts:
  - Every Plan value returns a non-null PlanCapabilities
  - trial's lifetimeCampaigns === 1
  - starter's activeCampaigns === 2
  - pro's activeCampaigns === null
  - pro's allowedPlatforms has length 5
  - getPlanCapabilities('agency') matches getPlanCapabilities('pro')
    (Phase 1 only)

Do NOT modify /lib/campaigns/enforcement.ts in this prompt —
that comes in B7 after the rest of the billing surface lands.

/everything-claude-code:verify
```

---

### Prompt B3 — Migration: billing_events idempotency table

```
/everything-claude-code:plan "Migration 031 — billing_events idempotency table"

The webhook handler is idempotent by storing every Stripe event
ID as it arrives. Duplicate deliveries (Stripe retries on any
non-2xx, sometimes >5 times) are then no-ops at the DB layer.

The table is also append-only — useful for replay/debugging.

Migration file: /supabase/migrations/<timestamp>_billing_events.sql
(confirm timestamp format from existing migrations).

Schema:

  CREATE TABLE public.billing_events (
    -- Stripe's event ID is the PK. Re-inserting the same event
    -- raises a unique violation, which the application catches
    -- as "already processed" with no further action.
    id                text         PRIMARY KEY,
    type              text         NOT NULL,
    business_id       uuid         NULL
                      REFERENCES public.businesses(id) ON DELETE SET NULL,
    stripe_customer_id text        NULL,
    payload           jsonb        NOT NULL,
    processed_at      timestamptz  NOT NULL DEFAULT now(),
    -- The processed_outcome is a short label, not a free-form
    -- error message — it's for grepping ("how many checkout
    -- completions succeeded last week"). Stash error detail in
    -- payload if you need it.
    processed_outcome text         NOT NULL,
    CHECK (processed_outcome IN (
      'applied',
      'ignored_unknown_price',
      'ignored_no_business',
      'ignored_duplicate',
      'error'
    ))
  );

  CREATE INDEX billing_events_business_idx
    ON public.billing_events (business_id, processed_at DESC)
    WHERE business_id IS NOT NULL;

  CREATE INDEX billing_events_type_idx
    ON public.billing_events (type, processed_at DESC);

  ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

  -- SELECT scoped to owning business (so customers can see
  -- their own billing history in a future UI).
  CREATE POLICY "billing_events_select_own"
    ON public.billing_events
    FOR SELECT TO authenticated
    USING (
      business_id IS NOT NULL
      AND business_id = ANY (get_user_business_ids())
    );

  -- No INSERT/UPDATE/DELETE policies. Service-role only.

No trigger for updated_at — billing_events is immutable.

After writing the migration, apply it manually to your Supabase
project (the existing `npm run db:migrate` flow per CLAUDE.md /
current-phase.md) and confirm the table exists.

/everything-claude-code:verify
```

---

### Prompt B4 — DB helpers (service-role)

```
/everything-claude-code:plan "Service-role billing DB helpers"

These run from the webhook route only. All use the lazy-import
pattern: `const { createServiceRoleClient } = await import(...)`.

1. /lib/db/billing-events.ts:

   export interface RecordedBillingEvent {
     id: string
     type: string
     business_id: string | null
     processed_outcome: BillingEventOutcome
   }

   export type BillingEventOutcome =
     | 'applied' | 'ignored_unknown_price' | 'ignored_no_business'
     | 'ignored_duplicate' | 'error'

   export async function recordBillingEvent(input: {
     id: string                  // Stripe event.id
     type: string                // Stripe event.type
     businessId: string | null
     stripeCustomerId: string | null
     payload: unknown            // The full Stripe.Event object
     outcome: BillingEventOutcome
   }): Promise<{ duplicate: boolean }>
     // Inserts into billing_events. On unique violation
     // (duplicate event), returns { duplicate: true } without
     // throwing — the caller treats this as a no-op success.

   Tests:
   - First insert returns { duplicate: false }
   - Re-insert of same id returns { duplicate: true } and does
     NOT mutate the existing row's processed_outcome
     (the original outcome wins)

2. /lib/db/businesses.ts additions (service-role section):

   export async function findBusinessByStripeCustomerId(
     stripeCustomerId: string
   ): Promise<BusinessRow | null>
     // SELECT via the unique partial index. NULL on miss.

   export async function updateBillingFromSubscription(input: {
     stripeCustomerId: string
     stripeSubscriptionId: string
     plan: PaidPlan            // from /lib/stripe/products.ts
   }): Promise<BusinessRow | null>
     // Atomic UPDATE:
     //   UPDATE businesses
     //   SET plan = $plan,
     //       stripe_subscription_id = $sub,
     //       updated_at = now()
     //   WHERE stripe_customer_id = $cust
     //     AND deleted_at IS NULL
     //   RETURNING *
     // Returns null if no row matched (deleted, or never
     // linked — the webhook handler then records
     // 'ignored_no_business').

   export async function clearBillingOnCancellation(input: {
     stripeCustomerId: string
   }): Promise<BusinessRow | null>
     // Atomic UPDATE:
     //   UPDATE businesses
     //   SET plan = 'trial',
     //       stripe_subscription_id = NULL,
     //       updated_at = now()
     //   WHERE stripe_customer_id = $cust
     //     AND deleted_at IS NULL
     //   RETURNING *
     // Cancellation drops back to 'trial', NOT a deleted plan
     // state — keeps the existing trial-cap enforcement engaged
     // for downgraded users.

   export async function setStripeCustomerId(input: {
     businessId: string
     stripeCustomerId: string
   }): Promise<void>
     // Atomic UPDATE with WHERE business_id = $id AND
     // (stripe_customer_id IS NULL OR
     //  stripe_customer_id = $stripeCustomerId).
     // Idempotent: re-setting the same ID is a no-op.
     // Setting a DIFFERENT ID on a business that already has
     // one throws — this should never happen and indicates a
     // serious bug (one business → one Stripe customer for
     // the entire Phase 1 lifecycle).

3. /lib/db/trial-state.ts addition:

   export async function recordTrialCardFingerprint(input: {
     businessId: string
     fingerprint: string
   }): Promise<void>
     // Atomic UPDATE setting trial_card_fingerprint.
     // Set-once: WHERE trial_card_fingerprint IS NULL.
     // Subsequent calls silently no-op (the trial card is
     // captured once at first checkout).

Tests for all three modules. The Stripe-customer-id mismatch
case in setStripeCustomerId is important — it's the canary for
a double-write race.

/everything-claude-code:verify
```

---

### Prompt B5 — Checkout + Customer Portal

```
/everything-claude-code:plan "Stripe Checkout + Customer Portal session helpers"

1. /lib/stripe/checkout.ts:

   export async function createCheckoutSession(input: {
     businessId: string
     plan: PaidPlan
     successPath: string      // app-relative, e.g. '/en/billing/success'
     cancelPath:  string      // app-relative, e.g. '/en/billing'
   }): Promise<{ url: string }>

   Steps:
   a. Load the business via /lib/db/businesses.ts using
      service-role (the caller is a Server Action that has
      already verified ownership; this helper does NOT re-check).
   b. If business.stripe_customer_id is null:
        - Create a new Stripe Customer:
            stripe.customers.create({
              email: <auth user email>,
              metadata: { business_id: business.id },
            })
        - Persist via setStripeCustomerId(...).
      Else: reuse it.
   c. Call stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: <customer id>,
        line_items: [{ price: PLAN_TO_PRICE_ID[plan], quantity: 1 }],
        success_url: APP_URL + successPath + '?session_id={CHECKOUT_SESSION_ID}',
        cancel_url:  APP_URL + cancelPath,
        // Critical: lets the webhook tie the event back to a
        // business even if customer creation and the webhook
        // arrive out of order.
        client_reference_id: business.id,
        subscription_data: {
          metadata: { business_id: business.id },
        },
        // Automatic tax (Stripe Tax handles VAT for EU).
        automatic_tax: { enabled: true },
        // Required for VAT in the EU.
        customer_update: { address: 'auto', name: 'auto' },
        // Phase 1: monthly only, EUR only — Price object
        // configuration in Stripe enforces both. No need to
        // pass currency.
        // Trial-card fingerprint capture is automatic — Stripe
        // attaches the payment method to the customer and we
        // read it in the webhook.
        // 14-day app-side trial is independent of Stripe trial
        // — we do NOT set subscription_data.trial_period_days.
        // Reason: our trial gates the product (post-generation,
        // campaign count), not the billing. The clock starts
        // on social connect, not on signup.
      })
   d. Return { url: session.url! }
      (session.url is guaranteed non-null when mode is
      'subscription' and no other URL flags are passed; assert
      with a clear error if null.)

2. createBillingPortalSession(input: { businessId, returnPath }):

   Loads the business, requires non-null stripe_customer_id
   (throw a typed error if missing — UI must hide the "Manage
   billing" link for businesses without a customer ID), and
   calls stripe.billingPortal.sessions.create(...).
   Returns { url }.

3. /lib/stripe/checkout.test.ts — mock the Stripe SDK
   (Stripe types make `vi.mocked()` straightforward):
   - Creates a customer when stripe_customer_id is null,
     and persists it via setStripeCustomerId
   - Reuses the existing stripe_customer_id when present
   - Passes the right price ID for 'starter' vs 'pro'
   - client_reference_id matches the business id
   - Subscription metadata contains business_id
   - Throws on createBillingPortalSession with no customer id

/everything-claude-code:verify
```

---

### Prompt B6 — Webhook handler (the security-critical piece)

```
/everything-claude-code:plan "Webhook signature verification + event dispatcher"

Implementation order: signature verifier first, dispatcher
second, route handler third. Test each layer before moving on.

1. /lib/stripe/webhook.ts:

   export interface VerifiedEvent {
     event: Stripe.Event
   }

   export class WebhookSignatureError extends Error {}

   export function parseWebhookEvent(
     rawBody: string,
     signatureHeader: string | null
   ): Stripe.Event {
     // - Throws WebhookSignatureError on missing header.
     // - Calls stripe.webhooks.constructEvent(rawBody,
     //   signatureHeader, config.server.STRIPE_WEBHOOK_SECRET).
     //   This is Stripe's tested signature verifier (HMAC-SHA256
     //   over the timestamped payload). Do NOT re-implement.
     // - On Stripe.errors.StripeSignatureVerificationError: rethrow
     //   as WebhookSignatureError with no detail (don't leak
     //   timing info or which check failed).
   }

   Tests with the Stripe SDK's documented HMAC fixture (or a
   captured real signed payload from `stripe trigger`):
   - Valid signature parses
   - Empty signature header throws WebhookSignatureError
   - Tampered body throws WebhookSignatureError
   - Wrong secret throws WebhookSignatureError
   - Signature from a 6-minute-old payload throws (Stripe SDK
     enforces a 5-minute tolerance by default; we accept that
     default)

2. Event dispatcher in the same file:

   export type WebhookOutcome = {
     outcome: BillingEventOutcome
     businessId: string | null
   }

   export async function dispatchWebhookEvent(
     event: Stripe.Event
   ): Promise<WebhookOutcome>

   Phase 1 handles these event types. Everything else returns
   { outcome: 'applied', businessId: null } and is recorded as
   such — the row is the audit trail; no work happens.

   Handled types:

   a. checkout.session.completed
      - Pull customer (string id) and subscription (string id)
        from event.data.object.
      - business_id resolution priority:
          (1) event.data.object.client_reference_id (Phase 1
              checkout sessions always set this)
          (2) findBusinessByStripeCustomerId(customer) fallback
        If neither resolves: outcome='ignored_no_business'.
      - Look up the subscription to read its first item's
        price.id (the checkout session itself doesn't expose
        the line item price reliably; fetch the subscription).
      - planForPriceId(priceId). If null:
          outcome='ignored_unknown_price'.
      - updateBillingFromSubscription({ stripeCustomerId,
          stripeSubscriptionId, plan }).
        Null return → outcome='ignored_no_business'.
      - If the session has a payment_intent or
        setup_intent.payment_method, fetch the PaymentMethod
        and call recordTrialCardFingerprint({ businessId,
        fingerprint: pm.card?.fingerprint }) — wrapped in try/catch,
        a failure here is non-fatal and never blocks the plan
        upgrade. Log via the structured summary.
      - outcome='applied'.

   b. customer.subscription.updated
      - Read customer (string id) and items.data[0].price.id.
      - planForPriceId → if null: 'ignored_unknown_price'.
      - If event.data.object.status is in
        ('canceled','unpaid','incomplete_expired'):
          clearBillingOnCancellation(...) → outcome='applied'.
        Else (active, trialing, past_due, paused):
          updateBillingFromSubscription(...) → outcome='applied'
          (or 'ignored_no_business' on null return).
        Note: past_due keeps the paid plan — Stripe handles
        dunning and will issue cancellation events if it
        ultimately fails. We don't pre-downgrade.

   c. customer.subscription.deleted
      - clearBillingOnCancellation(...) → 'applied' or
        'ignored_no_business'.

   d. invoice.payment_failed
      - Phase 1: record-only. Outcome='applied', no DB
        mutation. (The eventual subscription.updated /
        subscription.deleted is what flips the plan.)

   Other event types: outcome='applied', businessId=null,
   no DB work. They land in billing_events for audit.

3. /app/api/stripe/webhook/route.ts:

   import { headers } from 'next/headers'
   export const dynamic = 'force-dynamic'
   export const runtime = 'nodejs'
   // (Edge runtime does not support Stripe's signature
   //  verifier — Stripe SDK uses Node crypto.)
   export const maxDuration = 30

   export async function POST(req: Request): Promise<Response> {
     // 1. Read the raw body. CRITICAL: do NOT call req.json() —
     //    Stripe signs the raw bytes. Use req.text().
     // 2. Read 'stripe-signature' header.
     // 3. parseWebhookEvent(rawBody, signature) — on
     //    WebhookSignatureError, return 400 with NO body
     //    detail (avoid timing/info leaks).
     // 4. Pre-record idempotency: call recordBillingEvent
     //    with outcome='ignored_duplicate' if the insert
     //    returns { duplicate: true } and respond 200
     //    immediately — Stripe retries on non-2xx; a 200 on
     //    a duplicate is correct.
     //    BUT: do this AFTER dispatch, not before — see step 5.
     //    [Drop this comment; the actual order is below.]
     // 5. Actual order:
     //    a. Try to recordBillingEvent first with a placeholder
     //       outcome of 'applied'. If duplicate=true: log JSON
     //       summary and return 200.
     //    c. Otherwise call dispatchWebhookEvent(event), then
     //       UPDATE the billing_events row's outcome to the
     //       real outcome (requires a small update helper —
     //       service-role).
     //    Rationale: the duplicate check must be the FIRST
     //    write to short-circuit retries; the outcome update
     //    is a secondary detail for audit.
     //
     //    Add: updateBillingEventOutcome(id, outcome) to
     //    /lib/db/billing-events.ts (service-role, atomic
     //    UPDATE).
     // 6. On any unhandled exception from dispatch:
     //    - Update the event row's outcome to 'error', with
     //      the exception message stored in payload.error.
     //    - Return 500. Stripe will retry; the idempotency
     //      pre-record means the retry hits the duplicate path
     //      AFTER our state is correct, which is fine — but
     //      ONLY if the state was correctly written. If the
     //      state write itself failed, the retry retries the
     //      whole flow. Don't try to be clever about this.
     // 7. Success: respond 200 with a minimal body
     //    (`{ received: true }`).
     // 8. ALL paths log exactly one structured JSON summary
     //    line:
     //    console.log(JSON.stringify({
     //      kind: 'stripe_webhook',
     //      eventId, eventType, businessId, outcome,
     //      durationMs, signatureOk: true,
     //    }))
     //    For 400 (signature failure): signatureOk=false,
     //    eventId/eventType=null.
   }

4. /app/api/stripe/webhook/route.test.ts:
   - 400 on missing signature
   - 400 on bad signature (mutate body, keep signature)
   - 200 on valid checkout.session.completed with a known
     price ID → businesses.plan flipped
   - 200 on duplicate event ID → no second update to
     businesses.plan
   - 200 on unknown price ID → billing_events outcome is
     'ignored_unknown_price', businesses.plan unchanged
   - 200 on customer.subscription.deleted → plan reverts
     to 'trial', stripe_subscription_id NULL
   - 500 on internal error in dispatch → row outcome='error',
     and retry of the same event ID processes idempotently

Use the Stripe SDK's documented webhook fixture utilities
(`stripe.webhooks.generateTestHeaderString`) — that's how
the SDK itself tests; pull the pattern from their docs.

/everything-claude-code:verify
```

---

### Prompt B7 — Plug-in gate: campaign enforcement with upgrade hint

```
/everything-claude-code:plan "Hook plan capabilities into existing gates"

Two minimal changes — do not refactor existing code beyond
adding the new export.

1. /lib/campaigns/enforcement.ts:
   The existing CampaignEnforcementReason union ('trial_campaign_limit',
   'starter_campaign_limit') stays. Add a single helper:

   export function upgradeCtaTargetFor(
     reason: CampaignEnforcementReason
   ): '/billing' | null {
     switch (reason) {
       case 'trial_campaign_limit':
       case 'starter_campaign_limit':
         return '/billing'
       default:
         return null
     }
   }

   No other changes — Session 7's tests must continue passing.

2. Cross-check: anywhere getPlanCapabilities() should be
   called but isn't.
   Search the codebase for hardcoded values that match a
   capability (e.g. literal `'pro'` or literal `2` in plan
   contexts).
   Expected: a few existing locations (the trial campaign cap,
   the Starter cap, the platform allow-list) hardcode their
   limits. DO NOT refactor them in this prompt — flag them in
   the /learn-eval summary as backlog. Refactoring touches
   Sessions 5/6/7 surface and belongs in a dedicated cleanup
   pass after billing is shipped.

/everything-claude-code:verify
```

---

### Prompt B8 — Pricing page + Server Actions + success page

```
/everything-claude-code:plan "Billing UI — pricing cards, success polling, portal"

Frontend-design is active for this prompt. SŌSH aesthetic:
refined minimal, professional, purposeful. Pricing pages are
where confidence shows — clear hierarchy, generous whitespace,
no clutter. Tier comparison is a table, not a feature wall.

1. /app/[locale]/(dashboard)/billing/page.tsx — Server Component

   Reads:
   - the authenticated user
   - the active business (via getBusinessByOwner)
   - getPlanCapabilities(business.plan)

   Layout:
   - Top: current plan banner.
     * 'trial': "You're on the 14-day trial. Pick a plan to
       keep going." Show days remaining (computed from
       trial_started_at + 14 days; if trial_started_at is null
       — they haven't connected a social account yet — show
       "trial not started").
     * paid: "You're on {planName}. Manage billing →"
       (the link opens the Customer Portal via Server Action).
   - Two pricing cards side by side (responsive — stack on
     mobile): Starter €99, Pro €199.
     * Each card: plan name, monthly price, "Most popular"
       badge on Pro, feature bullet list (use
       getPlanCapabilities to derive the bullets — do not
       hardcode), "Upgrade to {plan}" button.
     * If the user is already on a paid plan and they're on
       the same card's plan: the button reads "Current plan"
       and is disabled.
     * If they're on a paid plan and viewing the OTHER card:
       the button reads "Switch to {plan}" — same Server
       Action, Stripe handles the proration via the Customer
       Portal flow. (Alternative: redirect to Portal directly
       for switches. Phase 1 simplification: send them to
       Checkout for the new plan; Stripe will detect the
       existing subscription and offer a switch flow. If this
       doesn't feel right end-to-end during smoke test, swap
       to Portal — note the choice in /learn-eval.)

2. /app/[locale]/(dashboard)/billing/actions.ts:

   'use server'

   export async function startCheckoutAction(
     plan: 'starter' | 'pro'
   ): Promise<{ url?: string; error?: 'auth' | 'no_business' | 'unknown' }>
     // - Auth check
     // - getBusinessByOwner
     // - createCheckoutSession({ businessId, plan,
     //     successPath: `/${locale}/billing/success`,
     //     cancelPath:  `/${locale}/billing` })
     // - Return the URL — the client redirects via
     //   window.location (Server Action can't redirect to an
     //   external host from a useActionState flow).

   export async function openBillingPortalAction(
   ): Promise<{ url?: string; error?: 'auth' | 'no_business' | 'no_customer' }>
     // - Auth check; getBusinessByOwner
     // - If business.stripe_customer_id is null: error='no_customer'
     // - createBillingPortalSession({ businessId,
     //     returnPath: `/${locale}/billing` })

3. /app/[locale]/(dashboard)/billing/success/page.tsx —
   Client Component (polling).

   Reads ?session_id=... from the URL.
   Polls a small API route (GET
   /app/api/billing/session-status/route.ts) every 1.5s for
   up to 15s. The route is the only new API endpoint here —
   it reads the current authenticated user's business plan
   and returns { plan, planUpdated: business.plan !== 'trial' }.

   States:
   - Polling: "Activating your plan…" with a spinner
   - Resolved (planUpdated): "You're on {plan}! Redirecting…"
     then router.push(`/${locale}/campaigns`) after 2s.
   - Timed out: a fallback message "This is taking longer than
     usual. Your plan will activate shortly — refresh in a
     minute. If it doesn't, contact support." Provide a manual
     "Check again" button.

   The success page never trusts the URL params for plan info;
   it asks the server. (The Stripe success_url's session_id is
   for our analytics/debug only.)

4. /app/api/billing/session-status/route.ts:
   - Auth required (anon client with RLS — this is a session-
     scoped read, not a service-role write)
   - Returns { plan, planUpdated } as above
   - No Stripe calls — just a businesses read. The webhook is
     the source of truth; the success page just polls until
     the webhook has done its work.

5. DashboardShell.tsx: add "Billing" nav item (cog icon, low
   in the nav, above Logout). Link to /[locale]/billing.

6. The trial banner from Session 6 ("Connect a social account
   to start publishing") — add a sibling banner shown when
   business.plan === 'trial' AND a social account IS connected
   (the trial clock is ticking): "Your trial ends in {N} days
   — pick a plan →" linking to /billing. Dismissible per
   browser session like the other one. Show only once
   social-connected — do not double-banner.

7. i18n keys in new billing.json (EN/PT/ES) — real
   translations, not placeholders. Structure:
     billing.title, billing.subtitle
     billing.current.trial, billing.current.paid (variable: plan)
     billing.current.days_remaining
     billing.current.manage
     billing.tiers.starter.name, .price, .cadence, .features.*
     billing.tiers.pro.name, .price, .cadence, .features.*
     billing.tiers.pro.popular
     billing.cta.upgrade (variable: plan)
     billing.cta.switch  (variable: plan)
     billing.cta.current
     billing.success.activating
     billing.success.activated (variable: plan)
     billing.success.timeout
     billing.success.check_again
     billing.banner.trial_active (variable: days)
     errors.billing.auth, .no_business, .no_customer, .generic

/everything-claude-code:verify
```

---

### Prompt B9 — Final verification

```
Run these in order. Stop on first failure. Do not auto-fix.

1. npx tsc --noEmit --skipLibCheck
2. npx vitest run lib/stripe lib/db lib/campaigns app
3. npx eslint . --max-warnings 0
   (the no-restricted-imports rule for 'stripe' should be
    active — confirm by importing 'stripe' directly in a test
    file outside /lib/stripe/ and watching ESLint fail, then
    revert)
4. npm run dev

Once dev is running, smoke test:

A. Webhook setup
   - In one terminal: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
     Copy the displayed webhook signing secret into .env.local
     STRIPE_WEBHOOK_SECRET=whsec_... and restart dev.

B. Pricing page
   - Navigate to /[locale]/billing as a trial user
   - Cards render, current-plan banner shows "trial" with
     days-remaining if trial_started_at is set, or "trial not
     started" if not
   - Click "Upgrade to Starter" → redirected to Stripe Checkout
     (test mode)
   - Complete with test card 4242 4242 4242 4242

C. Webhook + success flow
   - The stripe-listen terminal shows checkout.session.completed
     and customer.subscription.created arriving
   - Your dev console shows the structured JSON summary line
     for each
   - /billing/success polls, then redirects to /campaigns
   - In Supabase, businesses row shows plan='starter',
     stripe_subscription_id populated, stripe_customer_id
     populated
   - trial_state.trial_card_fingerprint populated

D. Idempotency
   - In a fresh terminal: `stripe events resend evt_...` for
     the checkout event from the previous step
   - Webhook responds 200, billing_events row count for that
     event ID stays at 1 (single row), businesses table
     unchanged

E. Cancellation
   - In Stripe Dashboard (test mode), cancel the subscription
     immediately
   - Webhook receives customer.subscription.deleted
   - businesses.plan reverts to 'trial', stripe_subscription_id
     null
   - Re-load /billing — banner shows trial state again

F. Signature failure
   - curl -X POST http://localhost:3000/api/stripe/webhook \
       -d 'malicious payload' -H 'stripe-signature: fake'
   - 400 response, response body has NO detail about why
   - billing_events table is unchanged (no row created — the
     handler aborts before recordBillingEvent on bad signature)

If any of A–F fails, paste the failing terminal output to
Claude.ai before moving on.

/everything-claude-code:verify
```

---

### Prompt B10 — Update current-phase + save session

```
Update /docs/current-phase.md:

Add a Session 11A section under "What's done" capturing:
- The Stripe surface (client.ts, products.ts, plan.ts,
  checkout.ts, webhook.ts)
- Migration 031 — billing_events table
- The plan-capabilities single source of truth and the
  hardcoded gate values still to migrate to it
  (backlog item from B7)
- Webhook idempotency model (event.id as PK in billing_events)
- New env vars (4 server + 1 public)
- New i18n namespace billing.*
- The Phase 1 limitation: Checkout is for new subscriptions;
  plan switches use the Customer Portal (note your B8
  decision either way)
- Any deferred items surfaced during smoke test

Update "What's in progress" → Session 11B Reviewer.

Append to backlog: the cross-file capability-hardcoding sweep
flagged in B7. Note the files that still hardcode plan limits
(/lib/campaigns/enforcement.ts, /lib/ai/runner.ts trial caps
if any, /lib/social/platforms/config.ts platform allow-lists).

If any pattern emerged during the webhook implementation that
future sessions should follow (e.g. raw-body handling, the
idempotency pre-record pattern), add a note in CLAUDE.md
under a new "Webhook handlers" section. Keep it short — 3-5
bullets.

/learn-eval

Summarise:
- What was built in Session 11B
- Any deviations from this guide and why
- Webhook events handled and the explicit no-op list
- Test fixture source (Stripe SDK helpers vs captured payloads)
- The plan-switch UX decision (Checkout vs Portal — your B8
  choice)
- Any open questions for the Reviewer

/save-session
```

`/exit` Claude Code.

### After Part B

```
git add .
git commit -m "Session 11B: Stripe billing implementation"
git push
```

**Pause the publishing-worker cron during the Reviewer pass.** Not strictly necessary, but the Reviewer is going to be reading code while you might be exercising the webhook a few more times in test mode — clean separation makes the audit cleaner.

---

## Part C — Reviewer Session (Opus 4.7, security-focused)

### How to run

1. `/exit` from Builder session
2. `claude` in a fresh terminal
3. `/model` → **Claude Opus 4.7**
4. Paste Reviewer Primer
5. Paste Reviewer Prompt

### Reviewer Primer

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md,
/docs/decisions/0001-database-schema.md §B.1 and §B.8
(businesses + trial_state), §C (RLS standard pattern), §E
(indexes).

Read all Session 11B output:
  /supabase/migrations/<timestamp>_billing_events.sql
  /lib/stripe/client.ts
  /lib/stripe/products.ts
  /lib/stripe/products.test.ts
  /lib/stripe/plan.ts
  /lib/stripe/plan.test.ts
  /lib/stripe/checkout.ts
  /lib/stripe/checkout.test.ts
  /lib/stripe/webhook.ts
  /lib/db/billing-events.ts
  /lib/db/billing-events.test.ts
  /lib/db/businesses.ts (additions only)
  /lib/db/trial-state.ts (additions only)
  /app/api/stripe/webhook/route.ts
  /app/api/stripe/webhook/route.test.ts
  /app/api/billing/session-status/route.ts
  /app/[locale]/(dashboard)/billing/page.tsx
  /app/[locale]/(dashboard)/billing/actions.ts
  /app/[locale]/(dashboard)/billing/success/page.tsx
  /components/layout/DashboardShell.tsx (the nav + banner additions)
  /lib/config.ts (additions)
  /lib/campaigns/enforcement.ts (the upgradeCtaTargetFor addition)
  All three locale billing.json files

Session 11 Part C — Stripe Billing Review. Use
security-reviewer AND typescript-reviewer agents in parallel.
This session is security-critical: a webhook handler talks to
our service-role layer based on data we receive from outside
our trust boundary. Signature verification, idempotency, and
replay protection are non-negotiable.

Report format: markdown table
(Section / Check / Status ✅❌⚠️ / File:Line / Fix)
After table: every ❌ with exact fix instructions.
After that: every ⚠️ with recommendations.
Verdict: blockers before flipping live mode / blockers before
shipping / acceptable to defer.

Acknowledge and list your planned checks. Then run them.
```

### Reviewer Prompt

```
Audit Session 11B against these checks.

SECTION A — WEBHOOK SIGNATURE & TRUST BOUNDARY

A1. The webhook route reads the raw body via req.text() and
    NEVER calls req.json() before signature verification?
    (req.json() would normalise the bytes Stripe signed —
    breaking the signature check.)
A2. Signature verification uses stripe.webhooks.constructEvent
    (Stripe's own helper) — NOT a hand-rolled HMAC?
A3. STRIPE_WEBHOOK_SECRET is read via config.server, not
    process.env directly?
A4. On signature failure the route returns 400 with NO body
    detail about WHY (no "missing header" vs "bad signature"
    distinction leak to the caller)?
A5. The route's runtime is 'nodejs' (not 'edge') — Edge cannot
    run Stripe's signature verifier?
A6. The route's maxDuration is set explicitly so a slow
    handler doesn't get killed mid-update?
A7. No untrusted Stripe.Event field is used for authorization
    decisions without verification. In particular:
    - event.data.object.client_reference_id is trusted as a
      business_id ONLY because it was signed by Stripe — and
      it was set by OUR code in createCheckoutSession. That's
      a closed loop. Verify the closed loop.
    - Customer IDs are looked up by index, not trusted blindly.
A8. The 5-minute signature tolerance is the SDK default —
    no override that loosens it?

SECTION B — IDEMPOTENCY & REPLAY

B1. billing_events.id is the Stripe event.id (text PRIMARY KEY)
    so re-insert raises a unique violation that the application
    interprets as "already processed"?
B2. The duplicate check happens BEFORE the business-state
    mutation (or with a pattern that is provably equivalent —
    e.g. write the placeholder row first, then dispatch, then
    update the outcome — the placeholder write is the
    serialisation point)?
B3. On a duplicate event, the original outcome is preserved
    (not overwritten by the retry)?
B4. The route returns 200 (not 409, not 200-with-error-body)
    on a duplicate — Stripe retries on any non-2xx, so 409
    would cause infinite retries?
B5. Concurrent delivery of the SAME event ID: would two
    parallel handlers both attempt the mutation?
    - The PK unique violation makes this safe in theory.
    - But: if the first request crashes between
      recordBillingEvent (success) and the dispatch (failure),
      the second request sees a duplicate and skips the
      dispatch. Is this handled? (Acceptable as documented
      tech debt — the row outcome would be wrong but state
      is still applied on the FIRST request's pre-record-then-
      dispatch path. Flag if there's a worse failure mode.)
B6. customer.subscription.updated and checkout.session.completed
    can arrive in either order for the same business.
    - Verify the "last write wins" model on businesses.plan is
      correct (both write the same plan derived from the same
      price ID, so order doesn't matter — unless an updated
      event arrives mid-checkout with a stale price). Walk
      through this scenario and confirm.

SECTION C — DB ACCESS BOUNDARY

C1. The webhook route uses service-role for all DB writes
    via the lazy-import pattern?
C2. No /app/api/stripe/webhook/route.ts code imports the anon
    Supabase client?
C3. No /app/[locale]/(dashboard)/billing/* Server Action uses
    service-role for ownership checks — RLS via the anon
    client is the boundary?
C4. RLS on billing_events:
    - SELECT scoped to owning business via
      get_user_business_ids()?
    - No authenticated INSERT/UPDATE/DELETE policy?
    - Service-role bypass is the ONLY mutation path?
C5. setStripeCustomerId throws on attempt to change an
    existing customer ID — i.e. one business → one Stripe
    customer is enforced atomically?
C6. updateBillingFromSubscription and clearBillingOnCancellation
    use atomic conditional UPDATE
    (WHERE stripe_customer_id = $1 AND deleted_at IS NULL),
    not read-then-write?
C7. The unique partial indexes on businesses.stripe_customer_id
    and businesses.stripe_subscription_id are in place (ADR
    0001 §E) — and the webhook handler relies on the customer
    lookup to be O(1)? (No new index is added in this
    migration — confirm by reading the migration file.)

SECTION D — DATA EXPOSURE & PII

D1. No raw Stripe payload (card numbers, names, addresses) is
    written to console.log — only the structured summary
    (kind, eventId, eventType, businessId, outcome,
    durationMs, signatureOk)?
D2. The billing_events.payload column stores the full event,
    which contains PII. RLS scopes SELECT to the owning
    business — but verify the column is NOT returned by any
    /lib/db/ helper that's called from a non-service-role
    path? (i.e. no helper that runs under anon client returns
    billing_events.payload.)
D3. The success_url's session_id query param is treated as
    opaque and is NOT used for authorization on the success
    page — only the authenticated session is?
D4. Error messages returned by Server Actions don't leak
    Stripe error detail to the client (e.g. "Customer X has
    no default payment method" → maps to a generic
    errors.billing.generic key)?
D5. No client-side code imports /lib/stripe/* — the publishable
    key is the only Stripe surface the browser sees? (Verify
    by static check: grep for `from '@/lib/stripe`).

SECTION E — PLAN LIMIT CORRECTNESS

E1. getPlanCapabilities values match CLAUDE.md exactly:
    - trial.lifetimeCampaigns === 1
    - trial.postsPerMonth === 50
    - starter.activeCampaigns === 2
    - starter.postsPerMonth === 30
    - pro.activeCampaigns === null
    - pro.postsPerMonth === null
    - allowedPlatforms matches CLAUDE.md (Starter: LinkedIn+X,
      Pro: all five)
E2. PLAN_TO_PRICE_ID is bijective with PRICE_ID_TO_PLAN
    (no two plans pointing at the same price; no orphan
    price IDs)?
E3. planForPriceId returns null (not throw) for an unknown
    price ID, and the webhook handler maps that to
    'ignored_unknown_price' (not 'error')?
E4. clearBillingOnCancellation sets plan='trial' — and the
    existing trial cap enforcement (Session 7) correctly
    re-engages for a downgraded business?
    (Spot-check: load /lib/campaigns/enforcement.ts and confirm
    'trial' branch is taken from business.plan, not from a
    cached value.)

SECTION F — CHECKOUT FLOW

F1. createCheckoutSession sets client_reference_id =
    business.id (so the webhook can resolve the business
    without a customer lookup race)?
F2. subscription_data.metadata.business_id is also set (belt
    and braces for the customer.subscription.* events)?
F3. The Stripe Customer creation is idempotent — re-running
    createCheckoutSession for the same business with no
    stripe_customer_id yet does NOT create two customers?
    (Acceptable Phase 1 risk: two parallel Server Action
    invocations may each create a customer before
    setStripeCustomerId — flag as ⚠️ unless explicitly
    handled.)
F4. The cancel_url is on our origin (APP_URL), not a Stripe
    URL — so a cancelled Checkout returns the user to /billing
    cleanly?
F5. automatic_tax: enabled is set (Stripe Tax handles VAT for
    EU customers — required for our market)?
F6. The 14-day product trial (CLAUDE.md) is NOT mirrored as
    subscription_data.trial_period_days — the trial is in our
    app, not in Stripe's billing? (Verify by code review.)

SECTION G — SUCCESS PAGE & UI

G1. The success page polls a session-scoped API (not Stripe
    directly) and never trusts query params for plan info?
G2. The poll has a bounded timeout (the spec says 15s) and
    a graceful fallback message?
G3. The "Upgrade" CTAs respect the auth boundary — clicking
    Upgrade as an anonymous user redirects to login, not to
    Stripe?
G4. The "Manage billing" link is HIDDEN, not just disabled,
    for businesses with no stripe_customer_id (a disabled
    link is a tooltip target; hidden is cleaner)?
G5. All visible text comes from billing.* keys in EN/PT/ES,
    with real translations (not English placeholders)?

SECTION H — TYPE SAFETY & CODE QUALITY

H1. No `any` in /lib/stripe/ or the webhook route? (Stripe
    SDK is fully typed; the only legitimate `unknown` is the
    billing_events.payload column.)
H2. Stripe.Event narrowing uses `event.type === '...'`
    discriminator, not type assertions?
H3. formatISO from date-fns for every timestamp written by
    the new code?
H4. No process.env outside /lib/config.ts?
H5. No console.* except the one structured JSON summary line
    per webhook event?
H6. The no-restricted-imports ESLint rule for 'stripe' is
    active and tested?
H7. Comments explain the non-obvious decisions: why raw body,
    why client_reference_id alongside metadata, why the
    duplicate check is the FIRST write, why the 14-day app
    trial is NOT a Stripe trial?

Final Verdict section listing:
- Blockers before flipping Stripe to live mode (this is the
  highest bar — production money is at stake)
- Blockers before shipping any billing UI to users
- Tech debt acceptable to defer to a future ADR
```

### After Part C

```
git add .
git commit -m "Session 11C: Billing review complete"
git push
```

`/exit` Claude Code.

**Paste the full report to Claude.ai.** Severity gets evaluated and correction prompts for Session 11D follow if needed.

---

## Part D — Correction Pass (only if Reviewer finds blockers)

> Skip if the Reviewer reports zero ❌ and only minor ⚠️.

Fresh Sonnet 4.6 session. Fix every ❌ item. Do not change anything the Reviewer marked ✅ or deferred as ⚠️.

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md.
Read the Session 11C Reviewer report (provided below).
Fix all ❌ blockers. List what you'll change before touching
any file.

[paste reviewer report here]

Fix only the listed ❌ items. After each fix run:
  npx tsc --noEmit --skipLibCheck
  npx vitest run lib/stripe lib/db lib/campaigns app

Report: which fixes applied, final tsc + vitest status.

/learn-eval
/save-session
```

```
git add .
git commit -m "Session 11D: Corrections applied, Session 11 complete"
git push
```

---

## Report Back to Claude.ai

```
Session 11 complete.

Implementation decisions confirmed:
- Plan switch UX: [Checkout / Customer Portal]
- Trial fingerprint capture: [working / deferred — why]
- past_due handling: keeps paid plan (Stripe dunning runs)
- Migration number used: [031 / other]

Live smoke test results:
- Stripe test mode keys in place: [yes/no]
- `stripe listen` forward to /api/stripe/webhook: [yes/no]
- Checkout with 4242 card succeeded: [yes/no]
- checkout.session.completed webhook → businesses.plan
  flipped: [yes/no — paste row before/after]
- trial_card_fingerprint captured: [yes/no — paste value or
  "deferred"]
- Duplicate event idempotency (resent event ID):
  expected billing_events row count: 1
  actual: [paste]
- Cancellation flow:
  expected: plan reverts to 'trial', stripe_subscription_id NULL
  actual: [paste row]
- Signature failure: 400 response, no row inserted: [verified yes/no]
- Customer Portal: opens successfully and returns to /billing: [yes/no]
- Pricing page renders correctly in all three locales: [yes/no]

Build:
- tsc clean: [yes/no]
- vitest pass: [yes/no — test count]
- ESLint clean (incl. no-restricted-imports for 'stripe'): [yes/no]

Reviewer report: [paste full report]
Remaining ❌: [list or "none"]
⚠️ deferred: [list or "none"]

Production readiness:
- Stripe live-mode keys: [obtained / not yet]
- Stripe Products/Prices created in live mode: [yes/no]
- Webhook endpoint URL configured in Stripe Dashboard
  (live mode): [yes/no]
- Webhook signing secret captured in Vercel env (production):
  [yes/no]
- EUR + automatic Tax confirmed on both Price objects: [yes/no]

Repo: [GitHub URL]
```

---

## Common gotchas in Session 11

**`req.json()` before signature verification.** The single most common Stripe-webhook bug. Stripe signs the raw bytes. The instant you call `req.json()`, Next.js parses, re-stringifies, and the signature no longer matches the body Stripe signed. Use `req.text()` ONLY, and pass the resulting string to `stripe.webhooks.constructEvent`. If the Reviewer's signature-tampering test passes but real Stripe events fail signature, this is the cause.

**Edge runtime for the webhook route.** Stripe's signature verifier uses Node's `crypto` module. Edge runtime doesn't have it. Set `export const runtime = 'nodejs'` explicitly — the default for App Router routes can drift, and a silent Edge fallback breaks signatures.

**The 14-day trial is OURS, not Stripe's.** Do NOT set `subscription_data.trial_period_days` on Checkout. Our trial gates product features and starts on social-connect (CLAUDE.md). Stripe's trial would charge nothing for 14 days and then auto-charge — confusing and wrong for our model. We charge from day one of the paid subscription.

**Concurrent customer creation.** If a trial user clicks "Upgrade" twice in rapid succession before `setStripeCustomerId` runs, you can create two Stripe Customers. The second `setStripeCustomerId` then throws (atomic guard). The user sees an error but their Stripe account has an orphan customer. Phase 1 acceptable risk — the orphan is harmless and the user retries successfully. If reviewer flags as ❌, the fix is to wrap customer creation in an advisory lock keyed on `business_id` — defer that to a follow-up.

**`automatic_tax: enabled` requires Customer address.** Stripe Tax needs a billing address to compute VAT. We set `customer_update: { address: 'auto', name: 'auto' }` so Checkout asks for it. If you skip this and Stripe Tax is enabled on the account, Checkout fails with a vague error. Confirm during smoke test.

**The Stripe CLI's `whsec_...` is different from the Dashboard's.** When running `stripe listen` locally, it prints a webhook signing secret that is specific to that listen session. Use it for `STRIPE_WEBHOOK_SECRET` while developing. The Dashboard's webhook endpoint has its own secret which is what production uses. Don't mix them.

**Duplicate webhook deliveries are normal.** Stripe retries on any non-2xx, and even on 2xx sometimes (network blip on their side, they didn't see the ACK). Test the duplicate path by literally running `stripe events resend evt_...` and confirming a single mutation. Don't simulate it in a unit test only.

**`getPlanCapabilities` drift.** The plan limits in CLAUDE.md are authoritative. If a Reviewer or future developer changes a limit in CLAUDE.md without updating `plan.ts`, the gates lie. Add a CLAUDE.md note (Webhook handlers section) reminding future sessions to update `plan.ts` whenever they change a number in CLAUDE.md.

**Builder tries to add new columns to businesses.** ADR 0001 §B.1 already has `stripe_customer_id` and `stripe_subscription_id`. The Builder occasionally proposes adding `stripe_price_id` or `plan_renewed_at` "for convenience". Push back — the source of truth is Stripe, not our DB. The webhook keeps `plan` and `stripe_subscription_id` truthful and that's all we need. If `plan_renewed_at` becomes useful (e.g. for showing "your plan renews on X" in /billing), pull it from Stripe at render time, don't denormalise.

**Reviewer attempts to refactor the existing gates.** The B7 prompt explicitly defers the migration of `/lib/campaigns/enforcement.ts` and `/lib/social/platforms/config.ts` to use `getPlanCapabilities`. If the Reviewer wants to do that refactor in 11D, push back — it's a separate session. The Phase-1 risk is that those gates drift; that risk is named and accepted in the backlog.

---

## What this unlocks

After Session 11:
- A new user can sign up, hit the trial cap, click Upgrade, complete Checkout, and continue using SOSH on a paid plan — the full money-taking loop is wired and tested.
- The `businesses.plan` column is the source of truth, kept current by an idempotent webhook handler.
- The `getPlanCapabilities` map gives the rest of the codebase one place to ask "what does this plan allow?", clearing the way for a later sweep to remove hardcoded limits scattered through Sessions 5/6/7.
- The `billing_events` audit table records every webhook delivery, including ignored / duplicate / errored ones — production debugging is just a SQL query away.
- The Customer Portal handles all subscription management (payment method updates, plan switches, cancellations, invoices) so we don't have to.
- Phase 1 MVP is now functionally complete except for the metrics worker (Session 12), email notifications (Resend wiring), and pre-launch polish.

The next session opens with at least one paying customer in test mode, a clean upgrade path, and the option to switch Stripe to live mode whenever the rest of Phase 1 is ready.
