# Session 17 — Legal Surface: ADR 0010 (Architect only)

> **Goal:** Produce (a) `docs/evidence/0010-legal-evidence.md` — an **Evidence Pack** derived from the repo with file-and-line citations for every claim the legal copy will make, then (b) **ADR 0010 — Legal Surface**, locking the full prose of `/terms`, `/privacy`, a public `/subprocessors` page, and a Data Processing Agreement reference (DPA), with every prose claim citing an Evidence-Pack section. The Architect produces both, in that order, with a **mandatory stop** between them so you can verify reality before any prose is written. The Builder session that transcribes the locked prose into MDX is Session 17B and is **not drafted until you have reviewed ADR 0010 end-to-end**.
> **Time:** 30–45 min Phase 0 (Evidence Pack) + Tiago review + 90–120 min Phase 1 (ADR 0010). Two stops.
> **Models:** Architect (Opus 4.7). No Builder, no Reviewer in this session.
> **Plugins:** `claude-mem` (context resumption) and ECC `/everything-claude-code:plan` (decision-tree laydown). **No** `/tdd`, **no** `/verify`, **no** `impeccable-design-and-taste` — this session produces locked prose, not code or UI. Reflects your scope-discipline principle: skills earn their keep or stay out.
> **Hard precondition:** Inputs §0 below must be filled in **by you, in chat, before the Architect prompt is pasted**. The Architect will refuse to proceed without them — they are facts only you can supply (legal entity, addresses, working privacy email, DPO decision, jurisdiction confirmation).
> **Drift-prevention contract:** Every claim in `/terms`, `/privacy`, and `/subprocessors` must cite an Evidence-Pack reference (`E1`–`En`). Claims without evidence don't ship. This is the structural defence against the "Privacy Policy says X, code does Y" failure mode.

---

## Why no Builder in this session

ADR 0009 §6 locked every marketing string verbatim in the ADR and Session 16's Builder did pure transcription. Same pattern here: legal prose is decision-dense, must be reviewed by a lawyer before going live, and benefits from being a single reviewable artefact rather than scattered across MDX files. The ADR ships locked prose in fenced blocks; the Builder later transcribes character-for-character into `content/legal/*.en.mdx`. No creative latitude downstream.

## What this session produces

- `docs/evidence/0010-legal-evidence.md` — the **Evidence Pack** (Phase 0 deliverable; see §0.5 below). Read-only ground truth that all prose cites. Produced *before* any ADR prose, reviewed by Tiago, then frozen as the basis for ADR 0010.
- `docs/decisions/0010-legal-surface.md` containing:
  - The cross-cutting position stack (controller/processor split, AI training posture, retention map, subprocessor change mechanism, jurisdiction, DPA delivery mechanism, cookie posture, breach-notification commitment).
  - Verbatim EN prose for: **Terms of Service**, **Privacy Policy**, **Subprocessor List**, **Data Processing Agreement (referenced standard form)**, plus a short **Acceptable Use** section embedded in the ToS (no separate AUP file at launch — fold into ToS §X to keep the surface small).
  - File-layout decision (which file gets which prose; which routes exist; footer link patch).
  - A **lawyer-ratification gate** added to `docs/launch-checklist.md` — live mode flip blocked until counsel signs off.
- A short Amendment block in ADR 0009 §7 noting that ADR 0010 supersedes the stub-sentence model.

## What this session does **not** produce

- Builder transcription into MDX (that is Session 17B, drafted after you review ADR 0010).
- PT/ES legal copy (post-launch localization session — same posture as marketing copy per ADR 0009 §10).
- Lawyer-vetted final prose. ADR 0010 ships counsel-ready, not counsel-approved.
- A separate `Acceptable Use Policy` route — folded into ToS.
- DPO appointment (decision yes/no captured; DPO operations are out of scope at this scale).
- Cookie consent banner implementation (the *posture* is decided here — "essential cookies only, no banner" vs "banner with reject-non-essential default" — implementation, if any, is its own session).

---

## §0 — Required inputs from you (before the Architect prompt)

The Architect will block until these are answered. Fill them in **in the chat, not in this file**, then paste the prompt.

1. **Legal entity.** Full registered name, form (e.g. *Sosh, Lda* / *Sosh Unipessoal Lda* / *Sosh, S.A.*), Portuguese registration number (NIPC / CRC), registered address.
2. **Privacy contact email.** Working address that will be monitored daily by you. Recommendation: `privacy@sosh.app` (separate from `support@`).
3. **General/legal contact email.** For commercial inquiries and notices under the ToS. Recommendation: `legal@sosh.app` or `hello@sosh.app`.
4. **DPO appointment.** Yes/No. *At your scale and current processing activities, the answer is almost certainly No* — GDPR Art. 37 only mandates a DPO when core activity is large-scale monitoring or large-scale special-category processing, neither of which applies. Confirm "No" so the ADR can record the basis.
5. **Jurisdiction & governing law.** Portugal? Confirm. If you intend EU-wide ToS with Portuguese governing law and Lisbon courts as forum, say so.
6. **Stripe Tax status.** Is Stripe Tax enabled? Are you VAT-registered in Portugal? This affects the billing/refund language and whether you collect VAT IDs from EU business customers.
7. **AI training posture pick (the one I flagged in chat).** Choose ONE:
   - **(A) Off by default; opt-in via account setting.** Recommended for B2B trust. We do not use customer content to improve models unless they toggle it on.
   - **(B) On by default with pseudonymization; opt-out via account setting.** More aggressive; harder to defend to enterprise customers later.
   - **(C) Aggregated telemetry only; never use content for model improvement.** Most conservative; closes off a future product axis.
   I will assume **(A)** unless you say otherwise — it preserves option value while being the easiest to defend in a B2B sales conversation.
8. **Refund posture.** Two options:
   - **(R1) No refunds outside the 14-day trial; cancellation stops next renewal.** Industry-standard SaaS, aligns with Stripe Customer Portal behaviour.
   - **(R2) Pro-rated refund on mid-period cancellation.** Friendlier; harder to operate.
   I will assume **(R1)**.
9. **Hosting & data-location facts** for the Privacy Policy / Subprocessor list. From the project I have:
   - Supabase (Postgres + Auth + Vault). Confirm region (Frankfurt? Dublin?).
   - Vercel (app hosting). Confirm region(s).
   - Postiz self-hosted on **Hetzner VPS**. Confirm region (Helsinki / Falkenstein / Nuremberg).
   - Resend (transactional email). US-based provider — needs SCC language.
   - Stripe (billing). US-based — needs SCC language.
   - Sentry (error monitoring). Confirm self-hosted vs SaaS, and region.
   - Upstash QStash (cron trigger). Confirm region.
   - AI provider (Anthropic? OpenAI? Both?). State the provider(s) and that prompts/outputs route through them.
10. **Anything you want explicitly excluded from the Privacy Policy** that the Architect might otherwise include (e.g. you do *not* want to commit to a status page; you do *not* want to commit to encryption-at-rest specifics; etc.).

---

## §0.5 — Evidence Pack (Phase 0 deliverable, drift defence)

**The problem this section exists to solve.** Privacy policies and ToS drift from code. Six months in, the policy says "we use Sentry; we set no analytics cookies" — but you turned on Sentry Session Replay and it sets `_sentryReplaySession`. Or the subprocessor list names OpenAI when you actually call Anthropic. Or you say "tokens deleted on disconnect" but step 3 of the disconnect contract silently regressed. Every one of these is a regulator-grade misstatement with a corresponding line of code. The way to prevent it is to **derive prose from code, not the other way around**.

**The contract.** Before writing one line of ADR 0010 prose, the Architect produces `docs/evidence/0010-legal-evidence.md` — a read-only ground-truth document grounded in file paths and line numbers from the repo. Every section of ADR 0010 then cites Evidence-Pack sections (`E1`, `E2`, …). A prose claim with no E-ref is a claim that doesn't ship.

**Shape of the Evidence Pack.** Sections, with what each one contains:

- **E1 — Subprocessors actually in use.** Grep `package.json` for dependencies that imply a third-party service; grep `lib/config.ts` for env vars that point to external hosts. For each, record: vendor, file/line where it appears, declared purpose, and region (filled from §0 item 9). Flag any vendor not on the §0 list — that's a drift the Architect must resolve before writing the Subprocessor prose.
- **E2 — Personal-data columns across all tables.** Grep `supabase/migrations/*.sql` for column definitions on every table the app writes to. Categorize each column: identity, profile, content, OAuth credentials, billing, telemetry, derived. This is the input to the §5 retention map. Flag columns that look like PII but aren't documented anywhere (e.g. a `phone_number` column nobody mentioned).
- **E3 — OAuth scopes requested.** Read `lib/social/constants.ts` and list the actual scopes per platform. The Privacy Policy can only claim to access what the scopes grant. If scopes grant write but not read, "we read your posts" is a false claim.
- **E4 — Cookies set anywhere in the app.** Three sources: (a) Supabase Auth cookie names from `@supabase/ssr` defaults, (b) `middleware.ts` and any `cookies().set(...)` call, (c) third-party libraries (`@sentry/nextjs` init config, Vercel Analytics docs). For Sentry specifically, check whether Session Replay is enabled — that's the load-bearing decision for the cookie posture in ADR 0010 §10. Mark unverified items `[VERIFY]` and ask Tiago.
- **E5 — Disconnect contract: does it actually do all three steps?** Find the disconnect action (likely `app/[locale]/(dashboard)/settings/social/actions.ts` or similar). Verify each of the three steps is present and reachable: `is_active = false`, vault columns nulled, vault.delete RPC called. If any step is missing or guarded behind a condition, flag it — the Privacy Policy claim about token deletion is only defensible if all three execute.
- **E6 — Retention: which claimed periods have actual deletion jobs?** Grep `app/api/cron/` and `lib/*/orchestrator.ts` for delete/janitor code. For each retention claim ADR 0010 will make, the Evidence Pack records whether a deletion job exists. No job ⇒ either add one (Builder) or change the claim. The `ai_usage` table is the most likely gap.
- **E7 — AI training opt-in: does the schema support the chosen posture?** If §0 item 7 = (A) opt-in, the `businesses` table needs an `ai_training_opt_in` column (or equivalent). Confirm presence; if absent, ADR 0010 §17 (Builder hand-off) gains a migration item. If the column doesn't exist and Builder won't add it in 17B, the Policy text must say "we do not currently use customer content for model improvement" — not "off by default" (the latter implies a switch exists).
- **E8 — Email categories actually sent.** Enumerate every template under `lib/email/templates/` (or equivalent). Categorize each: transactional, trial-warning, billing-notice, marketing. The Privacy Policy can only claim categories that match the actual templates. If a "newsletter" template exists, it's not "transactional only."
- **E9 — Data-location facts (cross-checked with §0 item 9).** For each subprocessor in E1, the configured region from env vars / dashboard / package config. If `SUPABASE_URL` points at `eu-central-1`, the Privacy Policy can claim Frankfurt. If unknown, mark `[VERIFY]` and ask Tiago.
- **E10 — Third-party platform compliance.** LinkedIn API ToS and X API ToS impose constraints on what SOSH can store and for how long. The Evidence Pack flags the specific scopes/endpoints used so the ToS §9 (Third-party platforms) cross-reference is grounded.

**`[VERIFY]` markers.** The Architect cannot resolve every fact from the repo alone. Anything that needs Tiago's confirmation gets a `[VERIFY: question]` marker. The stop-point review surfaces all of them; Tiago answers; the Architect updates the Pack before moving to ADR 0010.

**Why this is in the Architect session and not its own session.** The Pack is small (15–30 minutes of Opus reading the repo with `view` and `grep`). Splitting it into a separate session adds ceremony for no benefit. The two-stop structure inside one Architect session is the right shape.

---

## Pre-session checklist

- [ ] All 10 items in §0 answered in chat.
- [ ] `current-phase.md` reflects Session 16 Reviewer state.
- [ ] ADR 0009 read by the Architect (it locks the legal-route infrastructure ADR 0010 sits on top of).
- [ ] `claude-mem` running.
- [ ] No Claude Code edits in flight on `content/legal/*` or `components/marketing/LegalPage.tsx`.

---

## Part A — Architect Session (Opus 4.7)

### How to run — two stops

This session has **two stop points**, not one. The first is non-negotiable: do not let the Architect skip ahead.

1. `claude` → `/model` → **Claude Opus 4.7**.
2. Paste Primer.
3. Paste Architect Prompt — **Phase 0 (Evidence Pack)**.
4. Architect runs `/everything-claude-code:plan` → present the Pack scaffold → you approve → Architect walks the repo and writes `docs/evidence/0010-legal-evidence.md`.
5. **STOP 1.** Read the Pack end-to-end. Answer all `[VERIFY]` markers in chat. Push back on anything that looks wrong — wrong subprocessor, wrong scope reading, missing retention job. Architect updates the Pack until you sign off.
6. Paste Architect Prompt — **Phase 1 (ADR 0010)**.
7. Architect writes `docs/decisions/0010-legal-surface.md` in one pass, every section citing E-refs from the now-frozen Pack.
8. **STOP 2.** Do not draft the Builder prompt in this session. Read ADR 0010 end-to-end; expect 1–2 redirect cycles on the AI-training section, the retention map, and the DPA delivery mechanism. The Evidence Pack stays frozen during these redirects — if a redirect requires changing the Pack (e.g. you decide to add a deletion job), it goes on the Builder backlog, not back into Phase 0.

### Primer

```
/resume-session

Read /CLAUDE.md, /docs/current-phase.md, /AGENTS.md.

Read /docs/decisions/0009-landing-page-positioning.md, focusing on:
- §2 Defers (legal copy explicitly deferred)
- §7 Legal page infrastructure (MDX wrapper, frontmatter schema, file layout —
  this is the surface ADR 0010 fills)
- §6.15 Legal stub (the sentence we are replacing)
- §10 i18n posture (EN-only at launch is the precedent ADR 0010 inherits)

Read /docs/launch-checklist.md to understand which checklist rows ADR 0010 patches.

Read CLAUDE.md sections on:
- GDPR three-step disconnect (vault row + is_active + null columns) — Privacy
  Policy must accurately reflect this
- Plan pricing (Plus €99, Pro €199, 14-day trial, work email enforced) —
  the ToS billing/refund section must match

You are the Architect for Session 17. This session runs in TWO PHASES with a
mandatory stop between them:

  Phase 0 — Evidence Pack (docs/evidence/0010-legal-evidence.md). You walk
  the repo and produce a ground-truth fact sheet covering subprocessors in
  use, personal-data columns, OAuth scopes, cookies set, the disconnect
  contract, retention jobs that actually exist, AI-training-flag presence,
  email categories, data locations, and third-party platform compliance.
  Every fact is cited to a file path and line number.

  Phase 1 — ADR 0010. Locked prose for /terms, /privacy, /subprocessors,
  DPA reference. Every section cites Evidence-Pack refs (E1–En). Claims
  without evidence do not ship.

You do NOT start Phase 1 until Tiago has reviewed the Evidence Pack and
explicitly told you to proceed. You will receive two separate prompts.

You do NOT speculate about the legal entity, the privacy email, the DPO
decision, the AI-training posture pick, the refund posture, the data-location
facts, or any other §0 input. If any §0 input is missing from the conversation,
stop and ask for it before writing. Do not write "[INSERT COMPANY NAME]"
placeholders into committed prose. The Evidence Pack may contain `[VERIFY: …]`
markers for facts only Tiago can confirm — those are expected and resolved
during STOP 1.

Confirm you have read these files and are ready for the Phase 0 prompt.
```

### Architect Prompt — Phase 0 (Evidence Pack)

```
Produce docs/evidence/0010-legal-evidence.md.

This is a ground-truth fact sheet. You are reading the repo and writing
down what is actually there, with file paths and line numbers. You are
not making legal claims, recommending postures, or drafting prose.

Sections to produce, in this order:

E1 — Subprocessors actually in use.
  Method: read package.json (every dependency that implies an external
  service), grep lib/config.ts for env vars pointing at external hosts,
  grep the codebase for SDK client construction (createClient, new Stripe,
  new Resend, Sentry.init, etc.). For each vendor: name, evidence
  (file:line), declared purpose in our codebase, region (cross-ref §0
  item 9; if not provided, mark [VERIFY: region for <vendor>]).
  Flag any vendor present in code but NOT in §0 item 9 — that is a drift
  Tiago must resolve.

E2 — Personal-data columns across all tables.
  Method: read every file in supabase/migrations/*.sql, list every column
  on every table the app writes to. Categorize each column as one of:
  identity, profile, content, OAuth credential, billing, telemetry,
  derived, system (created_at/updated_at/id). Flag anything that looks
  like PII but doesn't fit a category — those need explanation.

E3 — OAuth scopes requested per platform.
  Method: read lib/social/constants.ts (or wherever REQUIRED_SCOPES lives
  per ADR 0002). For each platform: the literal scope strings, and a
  one-line plain-English read of what each scope grants. The Privacy
  Policy will be constrained by what these scopes actually permit.

E4 — Cookies set anywhere in the app.
  Method: (a) read the Supabase SSR client config to find auth cookie
  names; (b) grep middleware.ts and the codebase for cookies().set(...)
  and Response.cookies.set(...); (c) check Sentry init config for
  replaysSessionSampleRate / replaysOnErrorSampleRate (if either is > 0,
  Sentry Session Replay is on and sets cookies — this is load-bearing
  for ADR 0010 §10); (d) confirm Vercel Analytics is cookieless per its
  docs. List each cookie: name, source, purpose, lifetime, essential vs
  non-essential. Mark [VERIFY] anything you cannot resolve from the repo.

E5 — Disconnect contract: does it actually do all three steps?
  Method: find the social-account disconnect Server Action (likely under
  app/[locale]/(dashboard)/settings/social/ or accounts/). Verify each of
  the three steps: is_active = false; vault_*_id columns nulled;
  service-role vault.delete RPC called. Record the file:line for each.
  If any step is missing, conditional, or behind a flag, say so —
  the Privacy Policy claim is only defensible if all three execute.

E6 — Retention: which claimed periods have actual deletion jobs?
  Method: list every cron route under app/api/cron/ and every orchestrator
  under lib/*/orchestrator.ts. For each, identify what it deletes/expires.
  Then list every personal-data category from E2 and check whether a job
  deletes it. Most likely gap: ai_usage table — confirm or deny.
  Output a small table: category → deletion mechanism (or "none").
  This is the input to ADR 0010 §5 (retention map).

E7 — AI training opt-in: does the schema support the chosen posture?
  Method: per §0 item 7 (assume A unless Tiago specified otherwise), the
  businesses table should have an ai_training_opt_in column (or similar).
  Grep supabase/migrations/ to confirm presence/absence. If absent and
  Tiago has said (A), record: "Schema does not currently support the
  chosen posture. Either ADR 0010 §17 adds a migration to the Builder
  hand-off, OR the Policy claim shifts to 'we do not currently use
  customer content for model improvement; if this changes we will obtain
  consent before doing so.'"

E8 — Email categories actually sent.
  Method: list every template under lib/email/templates/ (or wherever
  React Email templates live per ADR 0008). Categorize each: transactional
  (auth, billing receipt, trial-end), trial-warning, security, marketing.
  The Privacy Policy can only claim categories that match templates.

E9 — Data-location facts.
  Method: for each subprocessor in E1, the configured region from env
  vars (lib/config.ts), package config, or dashboard (mark [VERIFY] for
  the latter). Cross-check against §0 item 9. Surface mismatches.

E10 — Third-party platform compliance facts.
  Method: from E3 (scopes) and lib/social/postiz-provider.ts, identify
  which LinkedIn/X endpoints we call and what data we receive/send. The
  ToS §9 cross-reference will be grounded in this.

Style rules for the Evidence Pack:
- Every fact has a file:line citation. No memory-based claims.
- `[VERIFY: <question>]` is the only allowed placeholder. Use it freely.
- Numbered lists, not prose. This is a fact sheet, not an essay.
- Do not editorialize. Do not draft policy language. Do not recommend
  postures. Phase 1 does that.
- If you find drift between code and Tiago's §0 inputs (e.g. §0 says
  "we use OpenAI" but code uses Anthropic), surface it loudly. That is
  the most important thing this Phase produces.

Run /everything-claude-code:plan first: present the section scaffold and
list any §0 inputs still missing from the conversation. Then walk the
repo and write the Pack. Commit when done.

After commit, STOP. Tiago reads the Pack, answers [VERIFY] markers,
flags anything wrong. You do not start Phase 1 until told.
```

### Architect Prompt — Phase 1 (ADR 0010)

> Paste this only after Tiago has signed off on the Evidence Pack and answered every `[VERIFY]` marker.

```
Produce ADR 0010 — Legal Surface.

Phase 0 (docs/evidence/0010-legal-evidence.md) is now frozen and reviewed.
Every factual claim in this ADR — every subprocessor named, every retention
period quoted, every cookie described, every scope referenced — must cite
an Evidence-Pack section (E1, E2, …) inline. A claim with no E-ref is a
claim that does not ship. If you need to make a claim the Evidence Pack
does not support, stop and ask Tiago — do not invent the underlying fact.

The ADR must cover, in this order:

§1 Headline decision — one paragraph stating that ADR 0010 ships counsel-ready
   (not counsel-approved) EN prose for /terms, /privacy, /subprocessors, and a
   referenced standard DPA, and that a lawyer-ratification gate blocks Stripe
   live-mode flip. Identify the four ADR-level losers/winners (cf. ADR 0009 §1
   pattern): single-ADR vs split-ADR; counsel-ready vs counsel-required;
   ToS-embedded AUP vs separate AUP route; click-through DPA at signup vs
   downloadable-on-request DPA.

§2 Scope boundaries — Builds / Defers in the ADR 0009 §2 shape. Defers:
   - PT/ES legal copy (post-launch).
   - Cookie consent banner UI (only the posture is decided here).
   - Status page / uptime commitments.
   - DPO operations (the decision is captured; operations are not in scope).

§3 Controller / Processor split — Crisp boundary. SOSH as Controller for:
   account identity (email, name, business profile), billing data (via Stripe),
   support correspondence, telemetry. SOSH as Processor for: customer-authored
   content (posts, campaigns), brand voice profiles, AI-generated content
   acting on customer instructions, social-account OAuth tokens used to publish
   on the customer's behalf. State the LinkedIn/X token handling explicitly —
   SOSH holds these in Supabase Vault under the documented three-step disconnect
   contract, and uses them only to publish content the customer has approved.
   The DPA standard form (§9) governs Processor-role processing.

§4 Lawful bases (GDPR Art. 6) — Per processing purpose, list the basis:
   - Account creation/maintenance → Contract performance (Art. 6(1)(b)).
   - Billing → Contract performance + Legal obligation (tax retention).
   - Service operation (storing/generating content) → Contract performance.
   - Transactional email → Contract performance.
   - Trial-warning email → Contract performance (it is part of the trial flow).
   - Aggregated product telemetry (no content, no identifiers) → Legitimate
     interest (Art. 6(1)(f)), balancing test recorded internally.
   - Content-derived AI improvement → Per the §0 item-7 pick. If (A): consent
     (Art. 6(1)(a)), opt-in via account setting. If (B): legitimate interest
     with opt-out. If (C): not performed.
   - Security/abuse monitoring (Sentry, auth logs) → Legitimate interest.
   - Cookies — see §10.

§5 Data inventory & retention map — Table form. Each row: category, examples,
   lawful basis, retention period, justification. At minimum:
   - Identity (email, name) — lifetime of account + 30 days after deletion request.
   - Business profile (company, industry, description) — same.
   - Brand voice profile — same.
   - Campaigns + posts + generated content — same.
   - Social-account OAuth tokens — until disconnect (three-step contract);
     vault row deleted, columns nulled, is_active=false.
   - Billing records — 10 years (Portuguese tax law) per Stripe records.
   - Auth/security logs — 12 months max.
   - Sentry error events — per Sentry default (90 days), confirm.
   - AI usage records (ai_usage table) — 24 months (justifies metered billing
     audit window; confirm).
   - Support correspondence — 24 months from last contact.
   - Email outbox / suppressions — outbox 30 days post-final-status;
     suppressions indefinite (suppression integrity).

§6 Data subject rights — Disclose the seven GDPR rights (access,
   rectification, erasure, restriction, portability, objection, withdraw
   consent), the privacy email as the contact channel, the 30-day response
   commitment, and the supervisory authority (CNPD — Comissão Nacional de
   Proteção de Dados, www.cnpd.pt). Note that erasure honours the three-step
   disconnect, anonymizes ai_usage rows (keeps aggregates, drops identifiers),
   and retains billing records under the tax exception.

§7 International transfers — Identify which subprocessors transfer to outside
   the EEA (likely Stripe, Resend, Anthropic/OpenAI, possibly Sentry/Vercel).
   For each, cite Standard Contractual Clauses (Module 2 or 3 as applicable)
   and any active EU adequacy reference (US DPF for US-based vendors, where
   applicable). Do not invent SCC versions you cannot verify.

§8 Subprocessor list — A locked table for the public /subprocessors route.
   Columns: vendor, purpose, data categories, region, transfer mechanism.
   Include exactly the vendors confirmed in §0 item 9. Add a paragraph on
   subprocessor change notification: 30 days advance notice via email to
   account owners and update to the /subprocessors page, with a right to
   object during the notice window (standard DPA term).

§9 Data Processing Agreement — Decision on delivery mechanism. The ADR 0010
   recommendation is: ToS includes a clause stating that, where customer
   uses the Service to process personal data of which customer is Controller,
   the standard DPA (linked PDF) is deemed accepted upon Service use, and a
   signed copy is available on request to legal@sosh.app. The DPA itself is
   a standard SCC-aligned form — the ADR specifies its required clauses
   (subject-matter, duration, nature/purpose, types of data, categories of
   data subjects, controller/processor obligations, subprocessor consent,
   data subject request handling, breach notification within 48 hours from
   processor to controller, deletion/return at end, audit rights with 30-day
   notice and reasonable scope). The full DPA prose may live in a separate
   ADR 0010 appendix or be deferred to a counsel-drafted PDF — pick one and
   justify.

§10 Cookies — State the posture. Default recommendation: essential cookies
    only (Supabase auth, CSRF, locale preference). No analytics cookies
    (Vercel Analytics is cookieless per its docs). No third-party tracking.
    Therefore no cookie banner is required under the ePrivacy Directive
    interpretation for strictly necessary cookies. The Privacy Policy lists
    each cookie, its purpose, and lifetime. If Sentry session replay is on
    and sets cookies, declare it and reconsider the banner posture — flag
    this as a check the Builder must perform during transcription.

§11 Security posture (Privacy Policy disclosure level) — Disclose, at the
    level appropriate for a public Privacy Policy (not the threat model):
    TLS in transit; encryption at rest (Supabase default); OAuth token
    storage in Supabase Vault (encrypted, key-managed); access controls
    (RLS); incident response with 72-hour notification commitment under
    GDPR Art. 33/34. Do not promise specifics you cannot defend (e.g. no
    "SOC 2 certified" claim; no specific cipher suite claims).

§12 ToS prose — Locked verbatim. Sections, in order:
    1. Parties and acceptance
    2. The Service (descriptive, not promissory)
    3. Eligibility (B2B, 18+, work email)
    4. Account, authentication, security
    5. Subscriptions, billing, trial, cancellation, refunds (per §0 item 8)
    6. Customer content and licence (customer owns content; SOSH licence
       limited to operating the Service)
    7. AI-generated outputs (customer owns outputs subject to the AI
       provider's general restrictions; outputs may be similar across
       customers; no warranty of accuracy; customer responsible for
       reviewing before publishing)
    8. Acceptable Use (embedded, not separate route — what users may not
       post; LinkedIn/X platform compliance; spam/harassment/illegal
       content; reverse engineering prohibition)
    9. Third-party platforms (LinkedIn/X — customer's responsibility to
       maintain accounts in good standing; SOSH not responsible for
       platform actions; rate limits and content policies disclosure)
    10. Intellectual property (SOSH retains rights to the Service; customer
        retains rights to their content)
    11. Confidentiality (mutual, standard)
    12. Warranties and disclaimers ("AS IS" with EU consumer-rights caveats
        if applicable to non-business buyers — but reaffirm B2B-only)
    13. Limitation of liability (cap at 12 months of fees paid; carve-outs
        for fraud, wilful misconduct, and items that cannot be limited under
        Portuguese law)
    14. Indemnification (mutual; customer indemnifies for content that
        breaches §8 Acceptable Use)
    15. Term and termination (subscription term, for-cause termination,
        effect of termination)
    16. Data protection (cross-reference to DPA and Privacy Policy)
    17. Governing law and forum (per §0 item 5)
    18. Changes to these Terms (30-day notice for material changes, via
        email and in-app notice)
    19. Contact

§13 Privacy Policy prose — Locked verbatim. Standard GDPR Art. 13/14 layout:
    Who we are; what data we collect; why; lawful basis (cross-ref §4);
    sources of data; sharing (subprocessors §8); transfers (§7); retention
    (§5); your rights (§6); cookies (§10); security (§11); contact;
    supervisory authority; changes to this policy.

§14 Subprocessor List prose — Locked verbatim. Public-facing version of
    the §8 table, with the change-notification paragraph and the
    last-updated date.

§15 Footer link patch — Confirm the existing footer set from ADR 0009 §3.3
    plus the new /subprocessors link. Specify the EN string ("Subprocessors"
    or "Sub-processors" — pick) and its placement order.

§16 Lawyer-ratification gate — Concrete checklist row added to
    /docs/launch-checklist.md: "Counsel review of ADR 0010 prose complete;
    any redlines incorporated; signed-off version is what ships in
    content/legal/." Blocks Stripe live-mode flip. State that the Builder
    session may proceed transcribing the ADR-locked prose into MDX before
    counsel ratification, on the understanding that counsel redlines come
    back as a follow-up correction PR.

§17 Builder hand-off — What the next session must do (transcribe each
    §12/§13/§14 fenced block into the corresponding .en.mdx; update the
    frontmatter lastUpdated to the ADR 0010 date; add /subprocessors route
    + page.tsx; add footer link; run prose-only smoke test that the routes
    return 200 and the H1 matches the frontmatter title).

Constraints on your output:
- Every factual claim cites an Evidence-Pack reference (E1–E10) inline,
  in parentheses, e.g. "We use Supabase for database, authentication, and
  encrypted token storage (E1)." This is the drift-prevention contract.
- Every fenced "verbatim" block is what will be shipped. Treat it as code:
  no placeholder brackets, no "[your company]" markers, no TBD inside the
  prose. If you do not have a fact, stop and ask for it before writing.
- Cite GDPR articles where you reference them (Art. 6, Art. 13, Art. 33).
- Do not over-promise (no specific uptime, no encryption-cipher specifics,
  no certification claims you cannot back).
- Plain English over legalese where the meaning is preserved. Where local
  legal-form conventions matter (limitation of liability, jurisdiction),
  use the conventional phrasing.
- Present a short decision tree before writing the ADR body — which §0
  inputs map to which ADR sections; which Evidence-Pack findings forced
  the prose in a particular direction; expected redirect axes. Then await
  approval before writing.
- Reflect Tiago's principle: when scope creeps (e.g. an AUP route, a
  status-page commitment, a SOC 2 promise), push back explicitly with the
  pre-launch / post-launch / requires-data categorization.
- If Phase 0 surfaced any drift between code and §0 inputs that remains
  unresolved at this point, refuse to proceed and ask Tiago. Do not paper
  over drift with prose.

§17 (Builder hand-off) must include, in addition to the transcription
items: any schema migrations forced by the Evidence Pack (e.g. the AI
training opt-in column from E7 if §0 item 7 = A); any deletion jobs
forced by the retention map vs E6 gap; a frontmatter `evidenceRef` field
on each .en.mdx file carrying the commit hash of the Evidence Pack so
future PRs can detect drift.

Confirm you have re-read the Evidence Pack and are ready to write.
```

### Stop points

**STOP 1 (after Phase 0 / Evidence Pack):** Read the Pack end-to-end. Answer every `[VERIFY]` marker in chat. Push back on anything that contradicts what you thought was true. The most likely surprises: a subprocessor in `package.json` you forgot about; an OAuth scope that's broader than you remembered; a retention claim with no deletion job; the AI-training opt-in column not existing. Once the Pack is right, tell the Architect to proceed to Phase 1.

**STOP 2 (after Phase 1 / ADR 0010):** Read the ADR end-to-end before opening Session 17B (Builder transcription). Expect to redirect on:
- §4 / §7-item-7 if the AI-training posture pick needs sharpening — and whether the Builder hand-off needs to add a schema migration.
- §5 retention map (the 24-month `ai_usage` window in particular).
- §6 retention-vs-deletion-jobs gaps from E6 — either accept the prose ("retained for service lifetime") or commit Builder to adding deletion jobs.
- §9 DPA delivery mechanism — counsel will have opinions; the ADR's recommendation may need to flex.
- §10 cookies if E4 shows Sentry Session Replay sets cookies (this is the one fact most likely to flip the no-banner posture).

The Evidence Pack stays frozen during STOP 2 redirects. If a redirect requires changing the Pack (e.g. you decide to add a deletion job that doesn't exist yet), it lands on the Builder backlog, not back in Phase 0.

Once ADR 0010 is committed and reviewed, ping me and I'll draft the Session 17B Builder guide (transcription + any forced migrations/deletion jobs from the Evidence Pack: ~45–60-minute Sonnet 4.6 run, no Reviewer required because the prose is locked).

---

## Open questions answered before you ask

**Q: Why not have the Architect write the MDX files directly?**
A: Same reason ADR 0009 §6 locked marketing strings in the ADR rather than letting the Builder write them — review surface. Legal prose must be reviewable as one document, not as four scattered MDX files. Builder transcription is mechanical; counsel review happens against the ADR, not the MDX.

**Q: Should /subprocessors be its own route or part of /privacy?**
A: Architect decides in §1 / §15. Recommendation embedded in the prompt: separate route. B2B sales conversations frequently ask "do you have a subprocessor list?" — having a clean URL to send is operationally cheaper than "see section X of the privacy policy."

**Q: Why no PT/ES legal copy at launch?**
A: Same wart precedent as marketing copy (ADR 0009 §10). EN-only is acceptable for B2B SaaS at this stage. PT/ES is a post-launch localization session, and notably it requires a *Portuguese lawyer's* drafting of the PT version (legal translation is not just translation).

**Q: What if counsel redlines a substantial portion?**
A: A correction PR ("Session 17C") amends ADR 0010 with the redlines and re-transcribes the affected MDX. The launch-checklist gate (§16) means redlines block live mode but do not block staging deploy of the unredlined prose.

**Q: How do we keep the policy aligned with the code after launch?**
A: Three layers, escalating in cost:
1. *Frontmatter `evidenceRef` hash* on every legal MDX (Builder ships this in 17B). PRs touching `content/legal/*.mdx` without bumping the hash are visible at review time.
2. *Quarterly re-verification.* A reminder in your calendar (or a row in `docs/launch-checklist.md` under a "recurring" section) to re-run Phase 0 against the live repo every 90 days and diff against the prose. 15-minute task if nothing's drifted; otherwise a small correction PR. **This is the minimum.**
3. *CI drift script* — `scripts/check-legal-drift.ts` that fails CI when (a) a new third-party dependency appears, (b) `lib/social/constants.ts` scopes change, or (c) a new email template appears under `lib/email/templates/` without a corresponding MDX change in the same PR. **Skip until multiple people are touching the code** — for now, layer 2 is enough.

The Evidence Pack itself is the long-term artefact, not just an input to ADR 0010. Re-running it is how you check yourself.

**Q: Is the Architect prompt too long?**
A: It is dense by design. Legal copy is decision-dense and the Architect needs to see every required section in one place rather than drift on later turns. Compare ADR 0009 §6 — same density, same reason.

# Session 17B — Legal Surface: Builder transcription + infra (Builder only)

> **Goal:** Transcribe the locked prose from ADR 0010 §12/§13/§14 into MDX, with Amendment A1 deltas applied at transcription time. Create the `business_deletion_requests` migration (table only; in-app delete-account UI is **out of scope**, backlog). Create `/subprocessors` route. Update footer i18n. Fix the vault-deletion Sentry capture. Extend the launch checklist with the rows A1 demands. No new prose. No new decisions.
> **Time:** 60–90 minutes Builder only.
> **Model:** Builder (Sonnet 4.6). No Architect, no Reviewer this session — prose is locked, infra changes are mechanical.
> **Plugins:** `claude-mem` (context resumption) and ECC `/everything-claude-code:verify` (post-implementation sanity sweep — route smoke test, schema migration applies, ESLint passes). **No** `/plan` (no design surface), **no** `/tdd` (no test design beyond the existing smoke test pattern).
> **Out of scope, named explicitly:**
> - In-app Delete Account UI / Settings flow (separate backlog session before live mode)
> - 30-day purge cron job (waits on UI session)
> - `auth_rate_limits` TTL purge cron (waits with the above)
> - Postiz code removal from `lib/social/` (separate engineering workstream — only the *legal copy* reflection of the removal is in scope here)
> - PT/ES translations of new prose (post-launch)

---

## Why no Architect / Reviewer in this session

ADR 0010 is locked. Amendment A1 is locked. Every prose decision was adjudicated in Session 17. The Builder reads two files (ADR 0010 + Evidence Pack) and produces deterministic output: prose into MDX, one migration, one Sentry-capture one-liner, one new route, footer i18n, checklist edits. ECC `/verify` is the closing pass; if anything diverges it's a small correction, not a Reviewer cycle.

## What this session produces

- `content/legal/terms.en.mdx` — ADR §12 prose with A1.3 refund clause applied, A1 §9 (Third-party platforms) reflecting direct LinkedIn/X integration
- `content/legal/privacy.en.mdx` — ADR §13 prose with A1.2 Path A wording, A1.7 Anthropic DPF paragraph, A1.8 email-webhook-events bullet, A1.9 security contact, and (the override Tiago confirmed in chat) §9 Erasure using **email-based** wording, not in-app
- `content/legal/subprocessors.en.mdx` — ADR §14 prose with A1.1 Postiz row removed, A1.7 Anthropic region fixed, A1.11 Svix client-verify-only note added
- `supabase/migrations/YYYYMMDDHHMMSS_business_deletion_requests.sql` — table per A1.5 spec (table only; no cron, no UI)
- `app/[locale]/(marketing)/subprocessors/page.tsx` — new route, identical pattern to `terms/page.tsx`
- `i18n/{en,pt,es}/common.json` — `footer.legal.subprocessors` key in all three locales (PT/ES with `_todo` sentinel per ADR 0009 §10)
- Sentry capture replacing the silent `catch {}` for vault secret deletion
- `docs/launch-checklist.md` — new rows for: T1 Postiz removal (granular set from Tiago's 2026-06-13 expansion), T4 deletion-cron-must-exist (placeholder for the backlog session), T7 Anthropic DPF verification, T10 cookie inventory, T11 vault Sentry alert deployed, T12 Svix client-verify, plus `[LEGAL ENTITY]` substitution from §16
- `CLAUDE.md` — one-line addition under a "Legal pages" section stating any PR touching `content/legal/*.mdx` must verify the `evidenceRef` frontmatter is current or bump it

## What this session does *not* produce

See "Out of scope" in the goal box. If the Builder finds itself building anything in that list, **stop** and surface it — that's an Architect-side scope expansion, not a Builder decision.

---

## Pre-session checklist — Tiago tasks before pasting the prompt

1. **Cookie inventory inspection (A1.10).** Run the app against staging Supabase. Open devtools → Application → Cookies. Confirm:
   - Exactly one cookie family is set: `sb-<project-ref>-auth-token` (possibly split into `.0` / `.1` for long JWTs)
   - **No** `_sentry…` cookies
   - **No** `_vercel…` cookies (Analytics + Speed Insights are cookieless)
   - **No** `NEXT_LOCALE` or other next-intl cookie
   - **No** anything else

   Answer in chat before running 17B: "Cookies confirmed: only `sb-…-auth-token`" or list what else you see. If anything unexpected appears, **do not start 17B** — flag it and we adjust the cookie table prose before transcription.

2. **Confirm vault-deletion file path.** A1.4 references `lib/social/social-accounts.ts`. Evidence Pack E5 references `lib/db/social-accounts.ts`. One of them has a typo. Builder will grep, but if you already know which exists, tell it in chat.

3. **Confirm direct-API publishing state.** A1.1 reflects "Postiz being replaced with direct LinkedIn and X." For §12 ToS §9 transcription, the Builder needs to write language consistent with end-state ("we connect via OAuth and publish through the platforms' official APIs"). Confirm this is the wording you want, or supply a preference. Default: yes, this wording.

4. **Confirm the §13 Privacy Policy §9 Erasure override.** As we discussed, the Amendment A1.5 prose claims in-app Delete Account; the in-app flow is backlog. **17B transcribes §9 Erasure as email-based** — *"To request deletion of your account and all associated data, email privacy@sosh.app. We will verify your request, confirm by email, and permanently delete your data within 30 days. Billing records required by Portuguese tax law are retained for 10 years per §7."* — and notes in the launch checklist that when the in-app feature lands, an Amendment A2 swaps the wording in. Confirm.

5. **Pre-session tooling state:**
   - `claude-mem` running
   - `current-phase.md` reflects Session 17 Architect complete
   - No Claude Code edits in flight on `content/legal/`, `app/[locale]/(marketing)/`, `supabase/migrations/`, or `lib/db/social-accounts.ts` / `lib/social/social-accounts.ts`

---

## How to run

1. `claude` → `/model` → **Claude Sonnet 4.6**.
2. Paste Primer.
3. Paste Builder Prompt.
4. Builder works through the checklist top-to-bottom. Expect one or two clarification turns on the file-path discrepancy (item 2) and possibly on locale-file structure if your repo's i18n layout has drifted.
5. Builder runs `/everything-claude-code:verify` as its closing pass.
6. Builder commits.
7. **STOP.** Read the diff. Tier-1 items to spot-check:
   - §13 Privacy Policy §9 Erasure says "email privacy@sosh.app", **not** "Settings → Delete Account"
   - §13 Privacy Policy §5 (Lawful basis table) has no `ai_training_opt_in` row
   - `/subprocessors` MDX has no Postiz row, Anthropic shows "US (EU-US DPF)", Svix carries the client-verify note
   - Launch checklist has the T1 Postiz-granular rows, T4 deletion-cron row, T11 Svix row
   - `business_deletion_requests` migration creates the table only — no triggers, no functions, no cron

---

## Primer

```
/resume-session

Read /CLAUDE.md, /docs/current-phase.md, /AGENTS.md.

Read /docs/decisions/0010-legal-surface.md end-to-end. The locked prose
is in §12 (ToS), §13 (Privacy Policy), §14 (Subprocessors). The
Amendment A1 block at the end of the file is binding and supersedes
specific clauses of §12/§13/§14 — you must apply A1 deltas AS YOU
TRANSCRIBE, not before, not after.

Read /docs/evidence/0010-legal-evidence.md as supporting context.
Cross-reference any E-ref cited in ADR or Amendment.

Read /docs/decisions/0009-landing-page-positioning.md §7 (MDX
infrastructure, LegalPage wrapper, frontmatter schema) — this is the
surface you transcribe into. Read §10 (i18n posture, _todo sentinel
convention) — applies to footer key additions.

Read /docs/launch-checklist.md — you extend this in a closing step.

You are the Builder for Session 17B. This session is a transcription
+ simple-infra session. You write deterministic output: prose into
MDX, one table migration, one new route, footer i18n, one Sentry
capture call, launch-checklist row additions. You do not design.
You do not draft new prose. You do not implement the in-app Delete
Account feature — that is explicitly backlog (Tiago confirmed
2026-06-13). The `business_deletion_requests` migration creates the
TABLE ONLY; no cron, no triggers, no UI.

CRITICAL TRANSCRIPTION RULE: Amendment A1 contains deltas that
override specific clauses of the locked §12/§13/§14 prose. For each
MDX file you produce, walk Amendment A1 (sections A1.1 through A1.11)
in order, identify every section that targets that file, and apply
the delta as you transcribe. Do NOT transcribe the pre-amendment
prose verbatim and "patch it later" — apply patches at write time.

ONE EXPLICIT OVERRIDE from chat (Tiago, 2026-06-13): Amendment A1.5
specifies an in-app "Delete Account in Settings" prose for §13
Privacy Policy §9 Erasure. The in-app feature is backlog, not
17B scope. §13 §9 transcribes as email-based:

  "To request deletion of your account and all associated data,
   email privacy@sosh.app. We will verify your request, confirm by
   email, and permanently delete your data within 30 days. Billing
   records required by Portuguese tax law are retained for 10
   years per §7."

When the in-app feature ships, Amendment A2 swaps the wording. A
launch-checklist row tracks this swap-pending state.

Confirm you have read these files and are ready for the Builder
Prompt.
```

---

## Builder Prompt

```
Execute Session 17B in the order below. Each step is independently
committable; commit in logical groups (transcription, migration,
route+i18n, code fix, checklist).

================================================================
STEP 1 — Pre-checks and grep
================================================================

a) Grep for the vault-deletion file: which exists, `lib/db/social-accounts.ts`
   or `lib/social/social-accounts.ts`? Report the actual path and the
   exact line numbers of the two `catch {}` blocks in the vault secret
   deletion flow (E5 references lines ~105–117).

b) Confirm `content/legal/terms.en.mdx` and `content/legal/privacy.en.mdx`
   currently exist with the ADR 0009 §6.15 stub sentence. Read them.

c) Confirm `app/[locale]/(marketing)/terms/page.tsx` exists. Read it —
   the `/subprocessors` page will mirror this exactly.

d) Confirm the i18n locale files `i18n/en/common.json`, `i18n/pt/common.json`,
   `i18n/es/common.json` exist and follow the structure documented in
   ADR 0009 §10. Read the existing `footer.legal.*` keys.

Report findings before proceeding to Step 2.

================================================================
STEP 2 — terms.en.mdx
================================================================

Transcribe ADR 0010 §12 into `content/legal/terms.en.mdx`. Walk
Amendment A1 in order; apply each delta that targets §12 as you
transcribe.

A1 deltas affecting §12:
- A1.1: §12 §9 (Third-party platforms) — rewrite to reflect direct
  LinkedIn/X API integration. No intermediary publishing layer
  language. Wording (use as-is or close paraphrase per ADR voice):
    "SOSH connects to social platforms (LinkedIn and X) via the
     platforms' official OAuth and APIs. You authorise SOSH to
     publish content on your behalf when you connect a social
     account. SOSH is not affiliated with these platforms; you
     remain bound by their terms of service. We are not
     responsible for actions taken by these platforms, including
     content removal, account suspension, or API access changes."
- A1.3: §12 §8 (Changes to this agreement / subprocessor objection
  remedy) — termination remedy is end-of-current-billing-period
  only, no pro-rata refund. Use the exact language from A1.3:
    "You may terminate your subscription effective at the end of
     the current billing period. No pro-rata refund will be
     issued. Your access continues until the billing period ends."
  Remove any "pro-rata refund" language from §12 wherever it
  appears.

Frontmatter (lock these values):
---
title: "Terms of Service"
lastUpdated: "2026-06-13"
locale: "en"
evidenceRef: "<COMMIT_HASH_OF_LATEST_EVIDENCE_PACK>"
---

Keep `[LEGAL ENTITY]` placeholders verbatim — these are gated at
§16 for counsel ratification (A1.6).

================================================================
STEP 3 — privacy.en.mdx
================================================================

Transcribe ADR 0010 §13 into `content/legal/privacy.en.mdx`. Walk
Amendment A1 in order; apply each delta that targets §13.

A1 deltas affecting §13 (all must be applied):
- A1.2 (Path A): §3 "How we use your information" — REMOVE any
  opt-in row referencing AI training. ADD the paragraph after
  the table:
    "We do not use your content or personal data to train AI
     models. The AI we use (Anthropic Claude) is called via API
     under Anthropic's data usage policy, which does not use API
     inputs for model training. See our Subprocessors list for
     details."
- A1.2 (Path A): §5 "Lawful basis" table — REMOVE the
  `ai_training_opt_in` row entirely.
- A1.2 (Path A): §6 "Your rights — Withdrawal of consent" —
  REMOVE the AI-training-consent withdrawal paragraph. Keep the
  general Art. 7(3) right intact (rectification / objection /
  etc. unaffected).
- A1.7 (Anthropic DPF): §10 "International transfers" — ADD:
    "Anthropic (our AI provider) is based in the United States.
     We rely on the EU-US Data Privacy Framework as the transfer
     mechanism for data processed by Anthropic. You can verify
     Anthropic's current certification at dataprivacyframework.gov."
- A1.8 (email webhook events): §2 "What we collect" — under
  "Service data", ADD the bullet:
    "Email engagement events (delivery status, open events,
     bounce and complaint signals) received from our email
     provider (Resend) as webhooks. These are used to manage
     your subscription communications and suppress future emails
     where required by anti-spam law."
- A1.9 (security contact): §11 "Contact" — ADD:
    "To report a security vulnerability, contact security@sosh.app."

CRITICAL OVERRIDE (Tiago, chat 2026-06-13) — §9 Erasure must read:
  "To request deletion of your account and all associated data,
   email privacy@sosh.app. We will verify your request, confirm
   by email, and permanently delete your data within 30 days.
   Billing records required by Portuguese tax law are retained
   for 10 years per §7."

Do NOT use the Amendment A1.5 in-app "Delete account in Settings"
language. The in-app feature is backlog.

Frontmatter:
---
title: "Privacy Policy"
lastUpdated: "2026-06-13"
locale: "en"
evidenceRef: "<COMMIT_HASH_OF_LATEST_EVIDENCE_PACK>"
---

================================================================
STEP 4 — subprocessors.en.mdx (new file)
================================================================

Create `content/legal/subprocessors.en.mdx`. Transcribe ADR 0010
§14, with A1 deltas:

- A1.1 (Postiz removed): no Postiz row. No "Note on publishing
  infrastructure" paragraph.
- A1.7 (Anthropic): Region cell = "US (EU-US DPF)" — no [VERIFY]
  marker.
- A1.11 (Svix): Svix row includes the note "Client-verify mode
  only — webhook payloads are not stored by Svix."
- A1.3 (refund): the subprocessor objection clause uses
  end-of-billing-period termination, no pro-rata refund. Match
  the language used in §12 §8.

Frontmatter:
---
title: "Subprocessors"
lastUpdated: "2026-06-13"
locale: "en"
evidenceRef: "<COMMIT_HASH_OF_LATEST_EVIDENCE_PACK>"
---

================================================================
STEP 5 — /subprocessors route
================================================================

a) Create `app/[locale]/(marketing)/subprocessors/page.tsx`,
   mirroring `app/[locale]/(marketing)/terms/page.tsx` exactly.
   Only the MDX import and frontmatter wiring differ.

b) Add `/subprocessors` to `sitemap.ts` across all three locales,
   matching the pattern used for `/terms` and `/privacy`.

================================================================
STEP 6 — Footer i18n
================================================================

Add `footer.legal.subprocessors` to all three locale files SIMULTANEOUSLY
(per CLAUDE.md):

- `i18n/en/common.json`: `"subprocessors": "Subprocessors"`
- `i18n/pt/common.json`: `"subprocessors": "Subprocessadores"` + `_todo`
  sentinel per ADR 0009 §10
- `i18n/es/common.json`: `"subprocessors": "Subprocesadores"` + `_todo`
  sentinel per ADR 0009 §10

Wire the key into the footer component. Position: after Terms of
Service, before any other legal links.

================================================================
STEP 7 — business_deletion_requests migration
================================================================

Create `supabase/migrations/<NEW_TIMESTAMP>_business_deletion_requests.sql`.
TABLE ONLY — no cron, no triggers, no functions, no UI.

Exact schema (from A1.5):

  CREATE TABLE public.business_deletion_requests (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id   uuid NOT NULL REFERENCES public.businesses(id),
    requested_at  timestamptz NOT NULL DEFAULT now(),
    verified_at   timestamptz,
    scheduled_purge_at timestamptz,
    purged_at     timestamptz
  );

RLS:
  - Enable RLS.
  - SELECT policy: owner (auth.uid() matches businesses.owner_id via
    business_id FK).
  - INSERT/UPDATE policies: NONE at this stage — the in-app delete
    flow (backlog) will add these. Service-role bypasses RLS.
  - DELETE policy: NONE.

Add a comment to the migration noting that the cron (30-day purge),
the UI (Settings → Delete Account), and the auth_rate_limits TTL
purge are in a separate session before live mode.

Verify the migration applies cleanly against a clean local Supabase
(`supabase db reset`).

================================================================
STEP 8 — Vault deletion Sentry capture
================================================================

In the file confirmed in Step 1 (`lib/db/social-accounts.ts` or
`lib/social/social-accounts.ts`), replace the two silent `catch {}`
blocks around vault RPC deletion with:

  catch (err) {
    captureException(err, { tags: { operation: 'vault_delete_secret' } })
  }

Import `captureException` from `@sentry/nextjs`. Do not change the
disconnect flow's overall outcome — the catch still swallows the
operational failure (disconnect is still considered successful from
the user's perspective); the alert exists so orphaned vault secrets
become visible in Sentry.

================================================================
STEP 9 — Launch checklist additions
================================================================

Open `docs/launch-checklist.md`. Add the following rows under §9
(or the closest equivalent section). Group by Amendment reference
for traceability.

From A1.1 (Postiz removal — granular set, per Tiago 2026-06-13):
  [ ] `lib/social/postiz-provider.ts` deleted from the repo.
  [ ] `POSTIZ_BASE_URL` and `POSTIZ_API_KEY` removed from
      `lib/config.ts`, `.env.local.example`, and Vercel/Supabase
      production env vars.
  [ ] `lib/social/registry.ts` confirmed to route exclusively to
      direct LinkedIn and X providers; no Postiz code path
      reachable.
  [ ] ESLint `no-restricted-imports` rule for `postiz-provider`
      removed once the file is gone.
  [ ] Integration test `POSTIZ_INTEGRATION_TEST_ENABLED` gate and
      any associated tests removed.
  [ ] `current-phase.md` and `CLAUDE.md` references to Postiz
      archived or removed.
  [ ] `grep -r postiz` against the repo returns no matches outside
      `/docs/decisions/` historical ADRs.

From A1.2 (Path A):
  [ ] Confirmed: no `ai_training_opt_in` column exists in production
      schema (no migration required at launch).

From A1.4 / T4 (deletion infrastructure):
  [ ] 30-day hard-delete cron for `business_deletion_requests`
      deployed and executing on schedule in production. (Pending —
      backlog session.)
  [ ] `auth_rate_limits` TTL purge cron deployed and executing on
      schedule in production. (Pending — backlog session.)
  [ ] In-app Delete Account flow (Settings → Delete Account)
      shipped, with email-verification round-trip, writing into
      `business_deletion_requests`. (Pending — backlog session.)
  [ ] Amendment A2 to ADR 0010 swapping §13 §9 Erasure prose from
      email-based to in-app-based wording, applied after the in-app
      flow is live.

From A1.7 (Anthropic DPF):
  [ ] Anthropic PBC's current EU-US DPF certification verified at
      dataprivacyframework.gov within 30 days of go-live.

From A1.10 (Cookie inventory):
  [ ] Cookie inventory inspection: confirmed only `sb-<ref>-auth-token`
      is set in staging; no banner needed.

From A1.11 (Svix):
  [ ] Svix SDK configured in client-verify mode only;
      `SVIX_CLIENT_VERIFY=true` (or equivalent SDK flag) confirmed
      in production environment.

From §16 (entity gate):
  [ ] All `[LEGAL ENTITY]` placeholders in `content/legal/*.mdx`
      replaced with the actual incorporated legal entity name.

From A1.4 (vault deletion alert — completed in this session):
  [X] Vault deletion failures captured via Sentry — silent `catch {}`
      replaced with `captureException` (Session 17B).

================================================================
STEP 10 — CLAUDE.md "Legal pages" rule
================================================================

Add a short section to `CLAUDE.md` (under Architectural conventions
or a new "Legal pages" subsection):

  ### Legal pages

  Any PR touching `content/legal/*.mdx` must either:
  - Confirm the `evidenceRef` frontmatter still matches the current
    `docs/evidence/0010-legal-evidence.md` commit, OR
  - Bump `evidenceRef` to a new Evidence Pack commit covering the
    change.

  Drift between code reality and legal prose is a counsel-grade
  failure mode. The Evidence Pack is the long-term artefact; the
  MDX is its rendering.

================================================================
STEP 11 — Run /everything-claude-code:verify
================================================================

Closing pass. The verify must check:
- `pnpm typecheck` passes
- `pnpm lint` passes (with no `console.*`, no `any`, no `process.env`
  outside `lib/config.ts` — standard CLAUDE.md gates)
- `pnpm build` succeeds; the new `/subprocessors` route is in the
  build output
- `supabase db reset` re-applies the migration cleanly
- Route smoke test (if one exists from ADR 0009 Builder session):
  /en/terms → 200, H1 = "Terms of Service"
  /en/privacy → 200, H1 = "Privacy Policy"
  /en/subprocessors → 200, H1 = "Subprocessors"
- Footer on `/en` contains link "Subprocessors" resolving to
  `/en/subprocessors`

================================================================
Hard rules — what you must NOT do
================================================================

- Do NOT implement the in-app Delete Account UI, Settings flow, or
  email-verification round-trip. Backlog.
- Do NOT implement the 30-day purge cron. Backlog.
- Do NOT implement the `auth_rate_limits` TTL purge. Backlog.
- Do NOT remove Postiz code from `lib/social/`. Separate workstream
  (the launch-checklist rows track it).
- Do NOT write PT or ES translations of the new MDX. Post-launch.
- Do NOT replace `[LEGAL ENTITY]` placeholders. §16 gate.
- Do NOT transcribe Amendment A1.5's in-app Delete Account wording
  into §13 §9. Use the email-based override from chat.
- Do NOT draft any new prose. Every line in the MDX must trace to
  the locked §12/§13/§14 (with A1 deltas applied) or to a
  Tiago-chat override explicitly named in this prompt.
- Do NOT touch ADR 0009, 0010, or the Evidence Pack — those are
  locked artefacts.

If you find yourself doing any of the above, STOP and surface it.
Out-of-scope work is an Architect-side decision, not a Builder
override.

Confirm you have read the Primer files and are ready to execute.
Report findings from Step 1 (file-path grep, existing file
inventory) before proceeding to Step 2.
```

---

## After-session review

Spot-check, in order (5–10 minutes):

1. **Open `content/legal/privacy.en.mdx` and search for "Delete account"** — must NOT match. Search for "privacy@sosh.app" in the Erasure section — must match.
2. **Search `privacy.en.mdx` for "ai_training_opt_in" or "AI model improvement (opt-in)"** — must NOT match. Search for "do not use your content or personal data to train" — must match.
3. **Open `content/legal/subprocessors.en.mdx`** — confirm no Postiz row, Anthropic shows "US (EU-US DPF)", Svix shows the client-verify-only note.
4. **Open the new migration file** — confirm `CREATE TABLE public.business_deletion_requests` only. No `CREATE FUNCTION`, no `CREATE TRIGGER`, no `pg_cron` schedule, no cron route under `app/api/cron/`.
5. **Open `docs/launch-checklist.md`** — confirm the T1 Postiz-granular rows exist (seven items), T4 deletion-cron rows exist as pending, A2-swap row exists.
6. **Open the vault-deletion file** — confirm two `captureException` calls replace the previous silent catches; the disconnect flow still returns success on RPC failure.
7. **Run `pnpm build` locally** — `/en/subprocessors` must appear in the route manifest.

If any of these fail, the Builder ran ahead of the locked spec. A small correction PR fixes it; do not re-run the whole session.

Once verified, ping me and we'll plan two things in parallel:
- The Postiz code-removal session (engineering, separate workstream)
- The Delete Account feature session (mini-Architect + Builder, before live mode)