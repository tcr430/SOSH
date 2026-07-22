# Session 14 — Transactional Email (Resend)

> **Goal:** Ship the email surface that turns trial signups into paying customers. Two cooperating layers: (a) `lib/email/` + `email_outbox` + a drainer cron own *product* email end-to-end — idempotent, retryable, audited; (b) Supabase Auth, reconfigured to relay via Resend SMTP, owns *auth* email — outside our outbox but using the same sender identity so the customer sees one consistent SOSH brand. Templates render server-side via React Email + next-intl in EN/PT/ES with plain-text fallbacks. Triggers wire into Stripe webhook, a new daily trial-warning cron, the publishing worker (first-post activation), and a Resend bounce/complaint webhook for suppression hygiene.
> **Time:** 6–8 hours including correction pass
> **Models:** Architect (Opus 4.7) → Builder (Sonnet 4.6) → Reviewer (Opus 4.7) → optional Correction
> **Plugins:** ECC throughout, claude-mem automatic, `impeccable-design-and-taste` for templates
> **Skills consulted by Claude while drafting this guide** (so Architect inherits their posture without having to invoke them itself): `engineering:architecture` (Options Considered + trade-off framing at every contested decision), `design:ux-copy` (per-kind copy as a real deliverable, localisation notes), `design:accessibility-review` (HTML-email WCAG subset called out explicitly), `engineering:testing-strategy` (pyramid mapping in §16). These are skill libraries available in this drafting environment; the Architect session itself does not need to invoke them.
> **Session structure:** Architect runs first and stops. Builder and Reviewer prompts are intentionally held back — drafted only after ADR 0008 is reviewed end-to-end.

---

## Why an Architect session

The Resend SDK call is one line. The non-obvious decisions are:

- **Outbox vs fire-and-forget.** Inline `after()` sends inside the Stripe webhook couple email reliability to webhook latency and fail silently on Resend hiccups; an outbox decouples them at the cost of one table and one cron schedule. Once a Builder writes the first inline call the pattern propagates everywhere.
- **Idempotency key shape across four trigger surfaces.** Supabase Auth, Stripe webhook retries, daily trial cron re-runs, publish worker. A free-form scheme drifts; a single `(business_id, kind, dedupe_key)` convention does not.
- **Supabase Auth SMTP relay is the right call for first impression but bypasses `lib/email/`.** The ADR must be explicit that auth flows are owned by Supabase config (templates + SMTP) while product flows go through the outbox. Otherwise the Builder will route password-reset through `lib/email/`.
- **Locale resolution at send time** needs a column that doesn't exist yet, plus a decision about whether to capture at enqueue (snapshot) or read live at drain.
- **Bounces/complaints without a webhook handler** burn Resend quota and domain reputation on the first hard-bounce loop.

ADR 0008 locks these so the Builder invents nothing. The Architect proposes the schemas, contracts, and status machines from the constraints below — this guide does not pre-write them.

---

## What this session builds and what it doesn't

**Builds:**

- **ADR 0008** — Transactional Email (Architect output, markdown only)
- Three migrations: `email_outbox`, `email_suppressions`, `businesses.preferred_locale` (Architect specs the shape; Builder writes the SQL)
- `lib/email/` — provider abstraction mirroring `lib/social/` and `lib/ai/runner.ts` (Resend + Mock providers, registry, ESLint boundary, recursive redaction reusing ADR 0007 §3.3 `REDACTED_KEYS`)
- React Email templates per kind + `i18n/{en,pt,es}/email.json` namespace
- Two new QStash crons: `/api/cron/drain-email-outbox` and `/api/cron/trial-warnings`
- `/api/webhooks/resend` — signature-verified bounce/complaint handler
- Stripe webhook + publishing worker extended to enqueue (additive; existing logic untouched)
- Supabase Auth → Resend SMTP relay (dashboard configuration, not code) + re-themed auth templates
- `lib/config.ts` additions for Resend + email tunables
- `docs/launch-checklist.md` email section
- `docs/runbooks/resend-setup.md`

**Defers (named here so we don't argue mid-Builder):**

- Marketing emails, drip sequences, nurture flows
- In-app email history UI
- Per-user transactional preferences / unsubscribe centre (transactional is exempt)
- Dunning sequence — single courtesy email on `invoice.payment_failed`, no retry, no grace period (Phase 3 per ADR 0007 deferral)
- Engagement-event emails — Phase 2 with engagement inbox
- Daily digest / every-post-published — only first-post-published ships
- Email analytics dashboard — Resend's own dashboard suffices
- A/B testing on subject lines — Phase 2+
- Attachments / inline images beyond a logo
- Supabase Auth wording overhaul — re-style only at launch; per-locale auth emails deferred

---

## Pre-session checklist

- [ ] Session 13.5D complete; current-phase.md reflects QStash dual-mode auth live
- [ ] Resend account; `mail.sosh.app` DNS verified (MX, SPF, DKIM, DMARC) — propagation done **before** Architect starts
- [ ] Resend API key (for `lib/email/`) and separate Resend SMTP credential (for Supabase Auth relay) issued
- [ ] Resend webhook signing secret obtained
- [ ] Decision locked: from = `hello@mail.sosh.app`, reply-to = `support@sosh.app`
- [ ] `npx tsc --noEmit --skipLibCheck` clean; full test suite green
- [ ] claude-mem running

---

## Part A — Architect Session (Opus 4.7)

### How to run

1. `claude` → `/model` → **Claude Opus 4.7**
2. Paste Primer
3. Architect lists planned ADR sections and the kind catalogue; **wait for explicit approval**
4. Paste Architect Prompt
5. Architect writes ADR 0008
6. Type confirmation line and `/exit`
7. **STOP.** Read the ADR end-to-end. Push back in a fresh chat before Builder/Reviewer prompts are drafted.

### Primer

```
/resume-session

Read /CLAUDE.md, /docs/current-phase.md, /AGENTS.md.

Read /lib/stripe/webhook.ts — the dispatch function. You'll
extend it with email enqueues AFTER state writes commit. You
don't rewrite the existing logic.

Read /lib/publishing/orchestrator.ts — runPublishTick. You'll
spec a single enqueue at the 0→1 first-published transition.
You don't rewrite the worker.

That's the full primer. For anything else — ADR conventions,
the QStash dual-mode cron pattern, the lib/social provider
shape, the REDACTED_KEYS source of truth, the trial_state
schema, the lib/config.ts shape — read the relevant ADR or
file IN-PLACE when you reach the section that needs it.
Cross-reference by section number; do not restate.

You are the Architect. Output is ONE markdown file:
/docs/decisions/0008-transactional-email.md. No .ts, no .sql,
no .tsx, no migration files, no config edits. Schemas, contracts,
and code shapes appear as fenced blocks INSIDE the ADR. A
launch-checklist patch appears as a fenced markdown block at
the end of the ADR — the Builder applies it.
```

### Architect Prompt

```
You are the Architect for SOSH Session 14 — Transactional Email.

DELIVERABLE: /docs/decisions/0008-transactional-email.md

Match the voice and density of ADR 0005, 0006, 0007. Cross-
reference prior ADRs by section number rather than restating
their content. Lead with a single headline decision.

POSTURE — read before writing:

This is a design ADR, not a transcription job. At every
contested decision below, you state the alternative considered
and the reason for the choice. "Outbox over inline" is not a
fact — it's a trade-off with a named loser (latency-coupling,
silent failure on Resend hiccups, no audit row) and a winner
(decoupling, retry semantics, ledger). Use the same pattern
throughout. If you find yourself writing a column list without
having named what would have been different had we chosen
otherwise, stop and add the alternatives paragraph.

ORDER OF OPERATIONS:

1. Before writing the ADR body, output:
   (a) the planned section list with one-line summaries
   (b) the EmailKind catalogue table (locked: 5 product kinds
       plus auth-owned-by-Supabase; see "Locked constraints"
       below)
   (c) the list of contested decisions you'll resolve, with
       your proposed answer for each
   Wait for explicit user approval before writing the ADR
   body.

LOCKED CONSTRAINTS (do not re-litigate; these were decided
upstream of this session):

L1. Five product EmailKinds, owned by lib/email/ + outbox:
    - trial-warning-t3
    - trial-warning-t1
    - welcome-to-plan
    - payment-failed-courtesy  (single email, no dunning)
    - first-post-published     (0→1 transition only)

L2. Auth emails (signup-confirm, password-reset, change-email,
    magic-link if used) are owned by Supabase Auth, reconfigured
    to relay through Resend SMTP. They are NOT EmailKind values.
    They do NOT flow through the outbox. Single-locale (EN) at
    launch.

L3. Provider abstraction shape: lib/email/ mirrors lib/social/.
    Resend + Mock providers, registry, ESLint boundary keeping
    the 'resend' npm import inside resend-provider.ts only.
    EmailProviderError reuses the recursive redaction set from
    ADR 0007 §3.3 — import REDACTED_KEYS, do not redefine.

L4. Crons follow ADR 0005 §12 + Amendment 1 (QStash dual-mode
    auth, always-200, single canonical JSON log line per tick,
    triggeredBy threaded through, orchestrator-in-lib/route-
    thin). The two new crons are not exceptions.

L5. Trial-warning cron schedule: daily, 09:00 UTC. Choice of
    UTC (not customer-local) is deliberate.

L6. Drainer cron schedule: every minute.

L7. Subdomain: mail.sosh.app. From: hello@mail.sosh.app.
    Reply-to: support@sosh.app.

L8. Stripe payment-failed is a single courtesy email, not a
    dunning chain. ADR 0007 deferred dunning to Phase 3 and
    this ADR honours that.

CONTESTED DECISIONS — you propose answers with named
alternatives:

D1. RENDER TIMING: enqueue-time vs drain-time.
    Frame: enqueue-time snapshots the rendered HTML on the
    outbox row. Drain-time renders fresh from template +
    props every drain attempt. Trade-off: enqueue-time gives
    bit-for-bit reproducibility but freezes copy fixes;
    drain-time picks up copy fixes for pending rows but a
    schema change can fail validation. Decide and justify.
    (Implication for outbox schema: do you store rendered
    html/text, or only props?)

D2. LOCALE CAPTURE: snapshot at enqueue vs read live at drain.
    Frame: capture-at-enqueue means a customer who changes
    locale between T-3 and T-1 receives the warnings in two
    different languages. Read-live-at-drain means a queued
    row drifts to whatever the customer's preferred_locale
    column says at drain time. Decide.

D3. SUPPRESSION ENFORCEMENT POINTS: enqueue-only, drain-only,
    or both?
    Frame: enqueue-check prevents needless outbox rows but
    misses bounces that arrive after enqueue. Drain-check
    catches races but every drain pays a suppression lookup.
    Decide.

D4. STRIPE WEBHOOK COUPLING: synchronous enqueue inside the
    webhook handler vs Next.js after() vs separate outbound
    queue.
    Frame: sync enqueue means the webhook returns after the
    outbox row is durable; an enqueue failure surfaces as a
    webhook error and triggers Stripe retry. after() detaches
    enqueue from the response; an enqueue failure is invisible
    to Stripe (no retry) and only surfaces in Sentry. Decide.
    Constraint: the webhook MUST stay idempotent — Stripe will
    retry on non-2xx, and the existing billing_events table
    is the idempotency anchor (ADR / Session 11A).

D5. FIRST-POST-PUBLISHED DETECTION: counter column 0→1 vs
    SELECT-COUNT race vs trigger-on-status-change.
    Frame: a SELECT count(*) right before enqueue races with
    concurrent publishes. A counter column UPDATE … RETURNING
    new_value=1 is race-free if the counter is incremented in
    the same transaction as the status flip. A Postgres
    trigger removes the application's involvement entirely
    but is harder to test. Decide. (Read /lib/db/businesses.ts
    and the orchestrator to see what's already there.)

D6. RESEND WEBHOOK IDEMPOTENCY: separate email_webhook_events
    table mirroring billing_events vs ON CONFLICT DO NOTHING
    against (email, source_event_id) on email_suppressions.
    Frame: a dedicated event table is consistent with billing_
    events and gives a clear audit trail. ON CONFLICT against
    suppressions is simpler — no new table — but loses the
    audit row for delivered/opened/clicked events we ignore
    (which is fine if we genuinely never want those events
    stored). Decide.

D7. PROVIDER-LEVEL IDEMPOTENCY KEY: pass an Idempotency-Key
    header to Resend on each send call, or rely solely on
    outbox-row-level dedupe?
    Frame: Resend supports idempotency keys; passing one
    defends against provider-side retries duplicating sends
    (their retries re-hit our drain after we already marked
    'sent'). Outbox-level dedupe prevents OUR side from
    re-sending. They protect against different failure modes.
    Decide whether to do both (recommended) or just one.

D8. OUTBOX STATUS MACHINE — explicit terminal states.
    What statuses exist? Propose the full set. Standard
    starting point: pending, sending, sent, failed. Argue for
    or against an intermediate retry-scheduled state, or
    against a separate suppressed terminal (vs lumping into
    failed with a reason field).

ADR SECTIONS (use these headings in this order; you choose the
internal structure of each based on the decisions above):

1. HEADLINE DECISION — one paragraph naming the two cooperating
   layers (lib/email/ + outbox for product email; Supabase
   Auth SMTP relay for auth email) and the unifying constraint
   (shared sender identity, shared visual system, separate
   reliability contracts).

2. SCOPE BOUNDARIES — in/out lists matching the session
   preamble.

3. EMAIL KIND CATALOGUE
   Table: kind → trigger source → dedupe key shape → owner
   file/route. One paragraph per kind covering when it fires,
   what data it carries, what the customer sees (one-sentence
   subject + CTA summary), and why it matters for conversion
   or activation. Plus the auth-emails-out-of-catalogue note
   and the Phase 2+ deferred kinds list.

4. PROVIDER ABSTRACTION — lib/email/
   Interface, error taxonomy (typed codes; you propose the
   union — examples: invalid_recipient, suppressed,
   provider_rate_limit, provider_unavailable, template_
   render_failed, unknown), recursive redaction reusing
   ADR 0007 §3.3, ESLint boundary, registry. Code shapes
   as fenced TypeScript blocks.

5. OUTBOX TABLE — email_outbox
   Resolve D1, D3, D8 here. Spec columns, indexes (call out
   the unique constraint that enforces idempotency and the
   partial index that the drainer scans), RLS, status
   machine with every edge labelled. Migration as a fenced
   SQL block.

6. SUPPRESSIONS TABLE — email_suppressions
   Columns, RLS (service-role only — operational data),
   enforcement points (resolves D3). Migration fenced.

7. LOCALE RESOLUTION
   The businesses.preferred_locale migration. Backfill
   strategy — check whether signup locale is currently
   persisted anywhere queryable; if not, backfill to 'en'
   and note the resulting wart for existing PT/ES users.
   Resolves D2.

8. TEMPLATE STRATEGY
   React Email + next-intl getTranslations. Per-kind file
   layout. Shared _layout.tsx for visual identity. Props
   schema validation (Zod) at render time so stale rows
   fail loudly.

   8a. COPY DELIVERABLE — for each of the 5 kinds, produce:
       - English subject (under 60 chars; Gmail truncates)
       - One-line English preview/preheader text
       - English body skeleton (lead sentence + supporting
         detail + single CTA label)
       - Localisation notes per locale (PT and ES typically
         run 20–30% longer than EN; idioms to avoid; T-3 /
         T-1 framing — count down to expiry, not up from
         start; payment-failed-courtesy tone — empathetic,
         not punitive, single recovery path)
       This is a real deliverable in the ADR, not "Builder
       will figure out copy." Builder transcribes to JSON.

   8b. ACCESSIBILITY (HTML-email WCAG subset; required, not
       optional):
       - Body text contrast ≥ 4.5:1 against background; large
         text ≥ 3:1 (WCAG 1.4.3)
       - Logo image carries meaningful alt text (1.1.1) —
         spec the exact alt string
       - Single semantic <a> styled as button for the CTA;
         no styled <div>s acting as buttons (4.1.2)
       - Link text descriptive of the destination —
         "Upgrade your plan", not "click here" (2.4.4)
       - Layout legible at 200% zoom (1.4.4) — fluid widths,
         max body width 600px, no fixed-pixel typography
         below 14px
       - Dark-mode survivability: React Email's default
         inline styles can break in Apple Mail dark mode;
         spec the meta tags (color-scheme, supported-color-
         schemes) and the dark-mode CSS approach
       - Plain-text alternative is rendered separately (not
         tag-stripped HTML); required for screen readers
         configured to prefer text and for deliverability
         scoring

9. DRAINER CRON — /api/cron/drain-email-outbox
   Claim query (FOR UPDATE SKIP LOCKED on the partial
   index), tick budget, per-row flow, orchestrator/route
   separation. Resolves D7.

10. TRIAL-WARNING CRON — /api/cron/trial-warnings
    Scan windows for T-3 and T-1, plan-exclusion filter
    (skip plan != 'trial'), enqueue, self-idempotency via
    the unique constraint.

11. STRIPE WEBHOOK INTEGRATION
    Resolves D4. Where the enqueue lives in dispatch flow,
    behaviour on enqueue failure, dedupe with stripe_event_id.

12. PUBLISHING WORKER INTEGRATION
    Resolves D5. Where the 0→1 detection lives, race-freedom
    argument, dedupe.

13. SUPABASE AUTH SMTP RELAY
    Dashboard configuration (not code): SMTP host/port,
    sender identity, template re-styling scope. The single-
    locale auth wart at launch. Why we're not intercepting
    via webhook into lib/email/ at launch.

14. RESEND WEBHOOK
    Resolves D6. Signature verification, event handling
    (bounced, complained → suppressions; delivered, opened,
    clicked → no-op), observability.

15. CONFIG SURFACE
    Fenced TypeScript listing every new env var Builder
    adds to /lib/config.ts.

16. TESTING STRATEGY
    Map test type to component per the testing pyramid:
    - Unit (many, fast): render every kind in every locale
      without throwing; props Zod schema rejects bad shapes;
      mock provider capture + failure injection; suppression
      enqueue no-op; locale capture invariant
    - Integration (some, medium): drainer cron route under
      QStash auth (claim, retry-on-transient, fatal-to-failed,
      suppression-skip, tick-budget exhaustion); trial-warnings
      cron (T-3/T-1 window detection, plan exclusion, daily
      dedupe); Resend webhook (signature verify, dedupe,
      suppressions write)
    - Manual smoke (few, high confidence, pre-launch):
      Resend sandbox sends visible in dashboard; bounce
      simulation propagates to suppressions; manually triggered
      trial-warning cron produces a real email; auth-email
      roundtrip via Supabase Auth — confirm-signup, password-
      reset, change-email all relay correctly
    Coverage targets: per CLAUDE.md conventions (no specific
    number, but every error path tested).

17. OBSERVABILITY
    Three canonical log lines (email.enqueue, email.drain.tick,
    email.webhook). What goes to Sentry (errors only, recipient
    addresses locally-scrubbed per ADR 0007 §3.3). Resend
    dashboard is the source of truth for delivery telemetry —
    we don't duplicate.

18. OPEN FOLLOW-UPS
    Phase 2 engagement-event emails, dunning sequence, multi-
    locale Supabase Auth, in-app email history UI, A/B
    testing, generic webhook_events consolidation table,
    bounce/complaint-rate alerting.

19. LAUNCH-CHECKLIST PATCH
    Fenced markdown block describing the rows to add to
    docs/launch-checklist.md (DNS records, Supabase SMTP
    configured, Resend webhook registered, suppressions table
    empty pre-launch, six product-email smoke tests, three
    auth-email smoke tests, new env vars). Builder applies
    the patch.

────────────────────────────────────────────────────────────

ARCHITECT BOUNDARY:
- No .ts, .tsx, .sql files
- No edits to /lib/config.ts, /lib/stripe/webhook.ts, or
  /lib/publishing/orchestrator.ts
- No package installs
- No write to docs/launch-checklist.md — the patch lives in
  the ADR
- SQL and TypeScript signatures appear as fenced code blocks
  INSIDE the ADR markdown only
- If you find yourself about to create a file or run a
  command, stop and output only: "Stopping — architect
  boundary."

When you have written the ADR, output exactly:
"ADR 0008 complete. Architect session done."
Then stop. Do not suggest next steps.
```

---

## Part B — Builder Session

**Held back.** Drafted only after ADR 0008 is reviewed and reconciled. Anticipated prompts in order: deps + migrations 032/033/034; `lib/email/` scaffold; templates + i18n (per ux-copy deliverable in §8a); drainer cron; trial-warning cron; Stripe webhook + publishing worker integration; Resend webhook; Supabase Auth SMTP runbook; launch-checklist patch apply.

## Part C — Reviewer Session

**Held back.** Drafted after Builder commit. Anticipated review surface below.

---

## Anti-patterns to flag during review (drafted now while context is fresh)

- **Builder routes auth emails through lib/email/.** No — Supabase owns auth via SMTP relay. Five kinds in the catalogue; auth is not one.
- **Inline send inside Stripe webhook bypassing the outbox.** Defeats idempotency and retry; couples webhook latency to Resend health.
- **A new `auth-confirm` EmailKind appears.** Push back to ADR §3.
- **Resend SDK imported outside lib/email/resend-provider.ts.** ESLint boundary violation.
- **Plain-text generated by stripping HTML tags from React output.** Render the template twice with the plainText flag; stripped HTML is unreadable to screen readers.
- **Recipient email unredacted in a Sentry event.** Local-part scrubbing per ADR 0007 §3.3.
- **The drainer cron uses a third trigger mode (not QStash, not Bearer).** Reuse the existing dual-mode helper.
- **template_props rendered without Zod validation.** Stale rows from before a template change must fail loudly to 'failed', not silently render with `undefined` interpolations.
- **email_suppressions is RLS-readable by authenticated users.** Service-role only.
- **Builder skips businesses.preferred_locale migration.** The cron has no locale source without it.
- **Dunning chain on payment_failed.** Single courtesy email. ADR 0007 deferred dunning to Phase 3.
- **first-post-published enqueued on every published post.** Only the 0→1 transition.
- **MAX_SEND_ATTEMPTS hardcoded.** Reads from /lib/config.ts.
- **HTML-email CTA built as a styled <div>.** Must be a semantic `<a>` styled as button (WCAG 4.1.2). Screen readers don't announce div-buttons as actionable.
- **Logo alt text is "logo" or empty.** Must be the brand name as it would be read aloud (e.g. "SŌSH" — confirm pronunciation choice in the ADR).
- **Body text below 14px.** Fails 200% zoom legibility on most clients.
- **Dark mode broken in Apple Mail.** Spec the color-scheme + supported-color-schemes meta tags up front.
- **REDACTED_KEYS redefined instead of imported.** Drift target — ADR 0007 §3.3 is the single source of truth.

---

## What this unlocks

After Session 14, trial users get T-3 and T-1 warnings in their language with a clear upgrade path. New paying customers get a branded welcome. The first publish is acknowledged — activation reinforced, not silent. Payment failures get one courtesy notification (recoverable, no loop). Supabase Auth emails arrive from the SOSH brand identity instead of Supabase defaults. Bounces and complaints auto-suppress so domain reputation stays clean. Every product email is auditable in the outbox and in Resend.

Phase 1 launch-eligibility: the email gap closes. Remaining: landing page, legal pages, engineering-debt cleanup.
