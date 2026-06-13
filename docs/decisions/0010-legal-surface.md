# ADR 0010 — Legal Surface

**Status:** Locked (counsel-ready, not counsel-approved — see §16)  
**Date:** 2026-06-13  
**Session:** 17 (Architect)  
**Evidence:** `docs/evidence/0010-legal-evidence.md` commit `5f7a2e4`  
**Supersedes:** ADR 0009 §6.15 (stub sentence in /terms and /privacy)

---

## §1 Headline decision

ADR 0010 ships counsel-ready (not counsel-approved) EN prose for four legal surfaces: `/terms` (Terms of Service), `/privacy` (Privacy Policy), `/subprocessors` (Subprocessor List), and a standard DPA available on request. The prose is immediately transcribable into MDX by the Builder. A lawyer-ratification gate (§16) blocks the Stripe live-mode flip; the Builder may proceed ahead of ratification on the understanding that counsel redlines come back as a correction PR before go-live.

**Decision log — four axes:**

| Axis | Winner | Loser | Rationale |
|---|---|---|---|
| Single ADR vs split ADR | Single ADR | Split (separate ADRs per surface) | All four surfaces share the same §0 inputs, evidence base, and lawful-basis table; splitting would fragment the audit trail |
| Counsel-ready vs counsel-required | Counsel-ready (ship now, gate before live) | Counsel-required (block Builder on counsel availability) | Blocking the Builder on a legal calendar is a scheduling risk; the ratification gate preserves the quality bar without stalling code |
| ToS-embedded AUP vs separate `/aup` route | Embedded (ToS §8) | Separate route | A separate AUP route adds a navigation surface and an i18n file for two paragraphs. Embed wins on simplicity |
| Click-through DPA at signup vs downloadable-on-request | On request (`legal@sosh.app`) | Click-through at signup | B2B ICP teams typically negotiate DPAs outside the sign-up flow. On-request reduces friction. The ToS §16 clause deems the DPA accepted upon Service use |

---

## §2 Scope boundaries

### Builds in this ADR

- EN prose for `/terms`, `/privacy`, `/subprocessors`, and DPA reference clause
- Lawful-basis table (§4), retention map (§5), rights disclosure (§6), transfers (§7), subprocessor list (§8), cookie posture (§10), security disclosure (§11)
- Builder hand-off spec (§17) including required schema migrations and deletion jobs

### Defers

- **PT/ES legal copy.** Post-launch. EN-only at launch, matching ADR 0008 §13 and ADR 0009 §10 precedents.
- **Cookie consent banner UI.** The posture is decided here — no banner needed (essential cookies only, §10). Banner implementation deferred because the posture decision removes the requirement.
- **Status-page / uptime commitments.** No SLA language in ToS at launch. SLA tiers are a post-launch commercial decision.
- **DPO operations.** Decision captured (none appointed). Art. 38–39 operational procedures are out of scope.
- **Agency-tier DPA clauses.** `agency` plan reserved but not launched (CLAUDE.md). Multi-tenant DPA clauses deferred to Phase 4.

---

## §3 Controller / Processor split

**SOSH as Data Controller** for:
- Account identity: email address, name, business profile (E2 — `businesses`, `auth.users`)
- Billing data: Stripe customer ID, subscription ID, card fingerprint, billing event payloads (E2 — `trial_state`, `billing_events`)
- Support correspondence (email inboxes, outside current codebase)
- Product telemetry: AI usage records, post generation session data, trial counters (E2 — `ai_usage`, `trial_state`, `post_generation_sessions`)
- Security/abuse data: auth rate-limit buckets containing IP addresses and email-based keys (E2 — `auth_rate_limits`)

**SOSH as Data Processor** (acting on customer instructions) for:
- Customer-authored content: campaign briefs, post copy, rejection notes (E2 — `campaigns`, `posts`)
- Brand voice profiles: tone, target audience, keywords, writing examples (E2 — `brand_voices`)
- AI-generated content created in response to customer campaign instructions (E2 — `posts.content`, `posts.ai_generation_metadata`)
- Social-account OAuth tokens used to publish approved content on the customer's behalf (E2 — `social_accounts`; raw tokens in Supabase Vault, E1)

**LinkedIn and X token handling (explicit):** OAuth access tokens for LinkedIn (E3 — scopes: `openid`, `profile`, `email`, `w_member_social`) and X (E3 — scopes: `tweet.read`, `tweet.write`, `users.read`, `offline.access`) are stored exclusively in Supabase Vault as encrypted secrets (E1, E2). The `social_accounts` table holds only opaque vault-pointer UUIDs — no raw token appears in any application column. Tokens are used solely to publish content the customer has reviewed and approved. On disconnect, all three steps execute: `is_active = false`, vault ID columns nulled, vault secrets deleted via RPC (E5). The DPA standard form (§9) governs all Processor-role processing.

**Third-party PII in engagement inbox:** The `engagement_inbox` table stores `author_username`, `author_display_name`, and `content` from third parties who commented on or messaged the customer's social accounts (E2). SOSH processes this as Processor; the customer is Controller. Engagement inbox ingestion is not active at Phase 1 launch (`fetchEngagement` returns `NOT_IMPLEMENTED`, E10).

---

## §4 Lawful bases (GDPR Art. 6)

| Processing purpose | Data categories | Lawful basis | Notes |
|---|---|---|---|
| Account creation and maintenance | Email, name, business profile (E2) | Art. 6(1)(b) — Contract performance | Processing necessary to create and operate the account |
| Billing and subscription management | Stripe IDs, card fingerprint, billing events (E2) | Art. 6(1)(b) + Art. 6(1)(c) — Legal obligation (Portuguese tax law, 10-year retention on fiscal records) | Tax obligation justifies extended billing-record retention |
| Service operation (storing, generating, scheduling, publishing content) | Campaigns, posts, brand voice, OAuth tokens (E2) | Art. 6(1)(b) — Contract performance | Core product function |
| Transactional email | Recipient email, template props (E2 — `email_outbox`) | Art. 6(1)(b) — Contract performance | Necessary to inform the customer of billing and account events |
| Trial-warning email (T-3, T-1) (E8) | Recipient email | Art. 6(1)(b) — Contract performance | Trial expiry warnings are part of the trial contract |
| Aggregated product telemetry (no content, no direct identifiers in rows) | `ai_usage` (E2) | Art. 6(1)(f) — Legitimate interest | Interest: improve product performance and cost management. Balancing: no customer-authored content; `business_id` link is pseudonymous. Balancing test recorded in this ADR. |
| AI model improvement (opt-in) | Customer content where account owner has opted in | Art. 6(1)(a) — Consent | Default: off. Opt-in via account settings. Path B — requires `businesses.ai_training_opt_in` migration (E7, §17-E). Processing does not begin until column and UI exist. |
| Error monitoring and performance tracing | Sentry error events (PII-scrubbed; Session Replay off, E4) | Art. 6(1)(f) — Legitimate interest | Interest: detect and fix defects |
| Security and abuse monitoring | Auth rate-limit buckets: IP addresses, email-based keys (E2 — `auth_rate_limits`) | Art. 6(1)(f) — Legitimate interest | Interest: prevent credential-stuffing and abuse. 30-day retention (§5). |
| Supabase auth session cookie (E4) | Session JWT | Art. 6(1)(b) — Contract performance | Strictly necessary; no consent required under ePrivacy Directive |

---

## §5 Data inventory & retention map

Retention periods are commitments. Builder deletion jobs (§17-F) must implement automated enforcement before go-live. Absence of deletion jobs at time of writing is documented in E6.

| Category | Examples | Tables (E2) | Lawful basis | Retention | Justification |
|---|---|---|---|---|---|
| Account identity | Email, name | `auth.users` (Supabase Auth) | Contract | Lifetime of account + 30 days after verified deletion request | Recovery window |
| Business profile | Company name, website, industry, description, logo, timezone | `businesses` | Contract | Same | Same |
| Brand voice profile | Tone, audience, keywords, writing examples | `brand_voices` | Contract | Same | Same |
| Campaigns and posts (including AI-generated content) | Campaign names, post copy, rejection notes, AI metadata | `campaigns`, `posts` | Contract | Same | Same |
| Social-account OAuth tokens | Vault secrets (encrypted) | `vault.secrets` via `social_accounts` (E1, E2) | Contract | Until disconnect — vault secrets deleted via all three steps of E5 | No time-based expiry needed; tokens deleted immediately on disconnect |
| Social-account metadata | Platform username, display name, platform user ID | `social_accounts` | Contract | Lifetime of account + 30 days | Identity metadata follows account lifecycle |
| Billing records | Stripe event payloads (may contain customer email, E2), customer ID, subscription ID, card fingerprint | `billing_events`, `trial_state` | Legal obligation (Portuguese tax law) | **10 years** from transaction date | CIVA Art. 52 fiscal record retention |
| Auth and security logs | Rate-limit bucket keys (IP addresses, email-based keys) | `auth_rate_limits` | Legitimate interest | **30 days** | Sufficient for abuse investigation; IP addresses are PII under GDPR |
| Sentry error events | Stack traces, request metadata (PII-scrubbed, E4) | External — Sentry | Legitimate interest | 90 days (Sentry platform default) | [VERIFY: confirm Sentry retention setting in project configuration before go-live] |
| AI usage telemetry | Token counts, latency, model, cost — no content | `ai_usage` | Legitimate interest | **24 months** | Metered billing audit window; no customer-authored content |
| Support correspondence | Email threads | External inbox | Contract / Legitimate interest | 24 months from last contact | Standard support lifecycle |
| Email outbox | Queued and sent email records | `email_outbox` | Contract | **30 days** post-final-status | Debugging window; recipient email is PII |
| Email suppressions | Suppressed email addresses (bounces, complaints) | `email_suppressions` | Legitimate interest | **Indefinite** | Suppression list integrity — deleting a suppression would risk re-sending to bounced/unsubscribed addresses |
| Email webhook events | Resend webhook payloads (may contain email) | `email_webhook_events` | Legitimate interest | **30 days** | Debugging window only |
| Engagement inbox (Processor role; third-party PII) | Commenter usernames, display names, message text | `engagement_inbox` | Contract (Processor) | Lifetime of customer account + 30 days | Third-party data subjects' rights exercised through the customer (Controller) per DPA |
| Post metrics | Aggregated likes, comments, reach — no individual user data | `post_metrics` | Contract | Lifetime of associated post + 30 days | Public aggregate data; low sensitivity |

---

## §6 Data subject rights

The seven GDPR rights apply to personal data for which SOSH is Controller (§3). For Processor-role data, data subjects must contact the customer (Controller).

| Right | GDPR article | How SOSH honours it |
|---|---|---|
| Access | Art. 15 | Email `privacy@sosh.app`; 30-day response; data export of Controller-held data |
| Rectification | Art. 16 | Account settings (self-service for profile); email for other fields |
| Erasure | Art. 17 | Email `privacy@sosh.app`; account and cascade deleted within 30 days; billing records retained under tax exception (§5); `ai_usage` rows anonymised (business_id nulled, aggregates preserved); OAuth tokens deleted via E5 three-step contract |
| Restriction | Art. 18 | Email `privacy@sosh.app`; flagged manually pending resolution |
| Portability | Art. 20 | Export of account identity, business profile, campaigns, and posts in JSON; available on request |
| Object | Art. 21 | Applies to legitimate-interest processing (telemetry, security monitoring); email `privacy@sosh.app` |
| Withdraw consent | Art. 7(3) | Applies to AI training opt-in (Art. 6(1)(a)); toggle in account settings; withdrawal does not affect processing performed while consent was active |

**Response commitment:** 30 days from receipt of a verifiable request. Art. 12(3) extension to 60 days available for complex requests; we notify within the first 30 days.

**No DPO appointed.** All data-subject matters: `privacy@sosh.app`.

**Supervisory authority:** Comissão Nacional de Proteção de Dados (CNPD), Av. D. Carlos I, 134 – 1.º, 1200-651 Lisboa, Portugal. www.cnpd.pt.

---

## §7 International transfers

**Starting position:** §0-7 confirmed EU-located subprocessors (E9 [VERIFY] markers resolved by Tiago). Exception: Anthropic.

**Anthropic — EEA → US transfer (E1, E9):**
Every AI generation call sends customer content (post text, brand voice) to Anthropic's US servers. Transfer mechanism: EU-US Data Privacy Framework (DPF). [VERIFY: confirm Anthropic's active DPF participation at www.dataprivacyframework.gov before counsel sign-off.]  
Fallback: if DPF adequacy is challenged or Anthropic's participation lapses, Standard Contractual Clauses Module 2 (controller-to-processor) apply. Anthropic's DPA and SCC package available via their legal portal.

**Stripe — conditional (E1):**
[VERIFY: if Stripe entity is Stripe Payments Europe Ltd (Ireland, EEA), no international transfer. If Stripe Inc. (US), EU-US DPF / SCCs apply. Confirm by checking Stripe merchant account registration.]

**All other subprocessors:** EU-located (E9, §0-7); intra-EEA processing; SCCs not required.

---

## §8 Subprocessor list (locked for /subprocessors route)

Effective date: 2026-06-13. Evidence: E1, E9.

| Vendor | Purpose | Data categories | Region | Transfer mechanism |
|---|---|---|---|---|
| Supabase Inc. | Database, authentication, encrypted OAuth token storage | Account identity, business profile, campaigns, posts, billing references, OAuth vault pointers | EU | Intra-EEA |
| Anthropic PBC | AI post generation and brand voice inference | Campaign briefs, post content, brand voice profiles | United States | EU-US Data Privacy Framework [VERIFY: confirm current participation] |
| Stripe Inc. / Stripe Payments Europe Ltd | Payment processing and subscription management | Billing data, customer email (Stripe-managed checkout) | EU [VERIFY: confirm entity] | Intra-EEA (if EU entity); EU-US DPF / SCCs (if US entity) |
| Resend Inc. | Transactional email delivery | Recipient email addresses, email content | EU | Intra-EEA |
| Functional Software, Inc. (Sentry) | Error monitoring and performance tracing | Anonymised error events (PII-scrubbed per E4) | EU | Intra-EEA |
| Upstash Inc. | Cron job scheduling (QStash) | Endpoint URLs only — no personal data payload | EU | Intra-EEA |
| Vercel Inc. | Application hosting and CDN | Application request data (IP addresses in access logs) | EU | Intra-EEA |
| Svix Inc. | Webhook signature verification (Resend inbound) | Client-side verification only — no data transmitted to Svix servers (E1) | N/A | N/A |

**Note on Postiz:** Self-hosted infrastructure operated by [LEGAL ENTITY] on Hetzner EU servers (E1, E9). Not a third-party sub-processor.

**Subprocessor change notification:** 30 days advance notice by email to account owners + update to /subprocessors page. Right to object during the notice window by emailing `legal@sosh.app`. If objection cannot be resolved, customer may terminate and receive a pro-rata refund of prepaid fees for the unused period following the change.

---

## §9 Data Processing Agreement

**Delivery:** On request to `legal@sosh.app`. No public URL at launch.

**ToS deemed-acceptance clause (§12-§16):** Where a customer uses SOSH to process personal data of which the customer is Controller, the standard DPA terms are deemed accepted upon continued use of the Service. A signed copy is available on request.

**Required DPA clause set (standard SCC-aligned form):**

1. Subject-matter, duration, nature of processing
2. Purpose of processing; types of personal data; categories of data subjects
3. Controller obligations: instruction authority, confidentiality, security cooperation
4. Processor obligations: process only on documented instructions; engage sub-processors only with Controller prior general authorisation (§8 list); assist Controller with DSAR obligations (Art. 15–22); assist with Art. 32–36 compliance; delete or return on contract end; cooperate with audits
5. Sub-processor consent: Controller grants general authorisation for §8 list; 30-day advance notice of changes; right to object
6. Data-subject requests: Processor forwards any DSAR received directly to Controller within 5 business days
7. Breach notification: Processor notifies Controller within **48 hours** of becoming aware of a personal data breach affecting Controller's data
8. Deletion or return: on termination, Processor deletes or returns all personal data within 30 days, except where law requires retention
9. Audit rights: Controller may audit on 30 days' written notice and reasonable scope; Processor may satisfy audit by providing a current third-party audit report

**Full DPA prose:** Deferred to a counsel-drafted PDF. The Builder does not draft DPA prose. The PDF is provided on request. This ADR specifies only the required clause set above.

---

## §10 Cookies

**Posture: essential cookies only. No cookie consent banner required.**

Cookies set (E4):

| Cookie | Set by | Purpose | Type | Lifetime |
|---|---|---|---|---|
| `sb-<project-ref>-auth-token` (two-part) | Supabase SSR (`@supabase/ssr`, E1) | User authentication session — JWT access and refresh tokens | Strictly necessary | Access token: ~1 hour. Refresh token: persistent until logout |

Not set: Sentry replay cookies (Session Replay off; both rates = 0, E4). Vercel Analytics cookies (cookieless, E4). Vercel Speed Insights cookies (cookieless, E4). Locale cookie (URL-prefix routing, E4).

**ePrivacy Directive analysis:** The Supabase auth session cookie is strictly necessary for the Service to function. No consent is required for strictly necessary cookies. No cookie consent banner is required at launch.

**Builder check (§17-D):** Before finalising the Privacy Policy MDX, inspect a logged-in browser session and confirm the cookie inventory matches this table. If any additional cookies are found, stop and raise a correction before transcribing.

---

## §11 Security posture (Privacy Policy disclosure level)

At public Privacy Policy level only. No cipher suites, no certification claims, no uptime guarantees.

- **TLS in transit.** All browser-to-Service and Service-to-subprocessor communication uses TLS.
- **Encryption at rest.** Application data stored in Supabase, which encrypts data at rest by default (E1).
- **OAuth token storage.** Tokens stored in Supabase Vault — encrypted secrets manager with key management separate from application storage. No raw token appears in any application table (E2, E5).
- **Access controls.** Row-Level Security enabled on every application table; each account accesses only its own data (E2).
- **Incident response.** GDPR Art. 33/34: personal data breach notification to affected customers and CNPD within 72 hours of becoming aware.

Do not claim: SOC 2, ISO 27001, specific cipher suites, uptime percentages.

---

## §12 Terms of Service prose

```mdx
# Terms of Service

**Last updated: 13 June 2026**

Please read these Terms of Service ("Terms") carefully before using SOSH. By creating an account or using the Service, you agree to be bound by these Terms. If you do not agree, do not use the Service.

---

## 1. Parties and acceptance

These Terms form a legally binding agreement between **[LEGAL ENTITY]**, a company incorporated under the laws of Portugal ("SOSH", "we", "us", or "our"), and the legal entity or individual acting in a business capacity that creates an account ("you" or "Customer").

Acceptance occurs when you: (a) click "I agree" or a similar button, (b) create an account, or (c) use the Service. If you are accepting on behalf of a company or other legal entity, you represent that you have the authority to bind that entity to these Terms.

---

## 2. The Service

SOSH is an AI-powered social media management platform that helps B2B businesses plan, generate, review, and publish content across social media platforms. Key functions include: campaign management, AI-assisted post generation, human-review and approval workflow, scheduled publishing to connected social accounts, and post performance analytics.

SOSH connects to social platforms (LinkedIn, X, Instagram, Facebook, Threads) through OAuth authorisation that you initiate and control. All content is published only after you review and approve it.

We may update, improve, or discontinue features of the Service. Material reductions in functionality will be communicated with at least 30 days' notice.

---

## 3. Eligibility

To use SOSH you must:

- Be at least 18 years old;
- Use a work email address (free consumer email providers such as gmail.com, outlook.com, and equivalents are not accepted at registration);
- Act in a business or professional capacity, not as a consumer; and
- Comply with all applicable laws in your jurisdiction.

SOSH is a B2B service. EU consumer protection rights and consumer-oriented withdrawal rights do not apply.

---

## 4. Account, authentication, and security

You must register an account to use the Service. You are responsible for:

- Providing accurate, current information at registration;
- Maintaining the confidentiality of your credentials;
- All activity that occurs under your account; and
- Notifying us promptly at support@sosh.app if you suspect unauthorised access.

We are not liable for losses caused by unauthorised account access where you have failed to take reasonable security precautions. We may suspend or terminate accounts that show signs of compromise or abuse.

---

## 5. Subscriptions, billing, trial, cancellation, and refunds

**Trial.** New accounts receive a 14-day free trial. A payment card is required to start the trial. The trial clock starts when you connect your first social account. During the trial you may create one campaign and generate up to 50 posts. After the trial, your card is charged for the plan you selected unless you cancel before trial end.

**Subscriptions.** SOSH is offered on a monthly subscription basis. Current plans and pricing are published at sosh.app/pricing. We may change pricing with 30 days' advance notice; existing subscribers are unaffected until their next renewal after the notice period.

**Billing.** Fees are charged monthly in advance to the payment method on file. Invoices are provided via email and your billing portal. All amounts are in EUR and exclusive of applicable taxes.

**Cancellation.** You may cancel at any time via Settings → Billing → Cancel. Cancellation takes effect at the end of the current billing period; access continues until that date.

**Refunds.** All fees are non-refundable. We do not offer pro-rata refunds for unused portions of a billing period.

**Payment failure.** If a payment fails, we will retry the card and notify you by email. If payment remains outstanding after 7 days, we may suspend access. Access is restored promptly upon payment. Accounts unpaid for more than 30 days may be terminated.

---

## 6. Customer content and licence

"Customer Content" means all text, data, images, campaign information, and other materials that you upload, input, or submit to the Service, including brand voice information, campaign briefs, post copy, and feedback.

**You own your Customer Content.** We claim no ownership over it.

**Licence you grant us.** You grant [LEGAL ENTITY] a limited, non-exclusive, worldwide, royalty-free licence to use, copy, store, transmit, and process your Customer Content solely as necessary to provide and improve the Service for you. This licence ends when you delete the content or terminate your account, except where retention is required by law.

**Your responsibility.** You represent and warrant that you have all rights necessary to provide the Customer Content, that it does not infringe any third-party rights, and that it complies with applicable law and these Terms.

---

## 7. AI-generated outputs

The Service uses AI to generate post drafts, hashtag suggestions, and brand voice analyses ("AI Outputs"). Regarding AI Outputs:

- **You own the AI Outputs** generated for your account, subject to the terms of the underlying AI provider (Anthropic PBC) governing use of their API.
- **Similarity.** AI Outputs may be similar to content generated for other customers. We do not warrant that outputs are unique.
- **No accuracy warranty.** AI Outputs may contain errors or content that does not reflect your brand. You are responsible for reviewing all AI-generated content before approving it for publication.
- **Your responsibility.** You are responsible for ensuring that published content complies with applicable law, platform terms, and your own obligations.

---

## 8. Acceptable use

You may not use the Service to:

- Post content that is unlawful, defamatory, obscene, harassing, or fraudulent;
- Engage in spam, unsolicited bulk messaging, or coordinated inauthentic behaviour on any social platform;
- Violate the terms of service of any connected social platform;
- Impersonate any person or entity, or misrepresent your affiliation with any person or entity;
- Distribute malware, phishing content, or other harmful code;
- Circumvent, disable, or interfere with security features of the Service;
- Reverse-engineer, decompile, or attempt to extract the source code of the Service;
- Access the Service by automated means except through our documented API; or
- Resell, sublicense, or transfer access to the Service without our written consent.

We may suspend or terminate accounts that violate these restrictions without prior notice where necessary to protect the Service or third parties.

---

## 9. Third-party platforms

The Service connects to LinkedIn, X, Instagram, Facebook, and Threads using your OAuth credentials.

- **Your responsibility.** You are responsible for maintaining your accounts on those platforms in good standing and complying with their terms and content policies.
- **Platform actions.** We are not responsible for any action a platform takes against your account, including content removal, account suspension, or API-access changes.
- **Rate limits.** Social platforms impose API rate limits. Publishing may be delayed or refused if limits are reached. We will notify you of publishing failures via the dashboard.
- **Platform changes.** Social platforms change their APIs and permissions. We cannot guarantee uninterrupted access to any specific platform feature.
- **Publishing scope.** At the date of these Terms, publishing is supported for LinkedIn and X. Instagram, Facebook, and Threads account connection is supported; publishing to those platforms is pending additional platform approvals.

---

## 10. Intellectual property

**SOSH's IP.** [LEGAL ENTITY] retains all rights in the Service, including its software, design, trademarks, and documentation. These Terms do not transfer any ownership of the Service to you.

**Your IP.** You retain all rights in your Customer Content and AI Outputs (subject to §7). These Terms do not transfer any ownership of your content to [LEGAL ENTITY].

**Feedback.** If you provide suggestions or feedback about the Service, you grant us a perpetual, irrevocable, royalty-free licence to use that feedback without restriction or compensation.

---

## 11. Confidentiality

Each party may receive confidential information of the other in the course of their relationship. Each party agrees to: (a) hold the other's confidential information in confidence using at least the same care it uses for its own; (b) not disclose it to third parties except as required to fulfil obligations under these Terms; and (c) use it only for the purpose of the relationship under these Terms. This obligation does not apply to information that: is or becomes publicly known through no breach of these Terms; was already known to the receiving party without restriction; is independently developed; or must be disclosed by law (provided the disclosing party gives prior written notice where legally permitted).

---

## 12. Warranties and disclaimers

**We warrant that:** (a) we have the authority to enter into these Terms; and (b) the Service will perform materially in accordance with our published documentation.

**Disclaimer.** TO THE EXTENT PERMITTED BY APPLICABLE LAW, THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE". WE DISCLAIM ALL OTHER WARRANTIES, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE ERROR-FREE, UNINTERRUPTED, OR THAT AI OUTPUTS WILL BE ACCURATE OR SUITABLE FOR ANY PARTICULAR PURPOSE.

Because SOSH is a B2B service (§3), statutory consumer warranties do not apply.

---

## 13. Limitation of liability

TO THE EXTENT PERMITTED BY APPLICABLE LAW:

- NEITHER PARTY SHALL BE LIABLE FOR INDIRECT, INCIDENTAL, CONSEQUENTIAL, SPECIAL, OR PUNITIVE DAMAGES, INCLUDING LOST PROFITS OR LOSS OF DATA, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
- [LEGAL ENTITY]'S TOTAL CUMULATIVE LIABILITY FOR ALL CLAIMS ARISING OUT OF OR RELATED TO THESE TERMS OR THE SERVICE SHALL NOT EXCEED THE FEES YOU PAID TO US IN THE **12 MONTHS** PRECEDING THE EVENT GIVING RISE TO THE CLAIM.

**Exceptions.** These limitations do not apply to: (a) liability for fraud or wilful misconduct (*dolo*); (b) death or personal injury caused by negligence; or (c) any other liability that cannot be excluded or limited under applicable Portuguese law.

---

## 14. Indemnification

**By you.** You will defend, indemnify, and hold [LEGAL ENTITY] and its officers, directors, employees, and agents harmless from claims, damages, losses, and expenses (including reasonable legal fees) arising out of: (a) Customer Content that infringes third-party rights or violates applicable law; (b) your breach of §8 (Acceptable Use); (c) your breach of §9 (Third-party platforms); or (d) your wilful misconduct or negligence.

**By us.** We will defend and hold you harmless from claims alleging that the Service, as provided by us, infringes third-party intellectual property rights, provided the claim does not arise from your use of the Service in violation of these Terms.

**Procedure.** The indemnified party must: (a) give prompt written notice; (b) grant the indemnifying party control of the defence; and (c) reasonably cooperate.

---

## 15. Term and termination

**Term.** These Terms begin when you create an account and continue for each monthly subscription period, renewing automatically until terminated.

**Termination for convenience.** You may terminate at any time by cancelling your subscription and ceasing use. We may terminate at any time with 30 days' written notice.

**Termination for cause.** Either party may terminate immediately upon written notice if the other: (a) materially breaches these Terms and fails to cure within 14 days of notice; (b) becomes insolvent or enters bankruptcy proceedings; or (c) engages in conduct that poses a security or legal risk.

**Effect of termination.** Upon termination: (a) your access ends; (b) we will retain your data for 30 days to allow export, then delete it in accordance with our Privacy Policy; (c) billing records are retained for the period required by law. Sections 10, 11, 13, 14, and 17 survive termination.

---

## 16. Data protection

The processing of personal data in connection with the Service is governed by our Privacy Policy (sosh.app/privacy) and, where applicable, our standard Data Processing Agreement. Where you use the Service to process personal data for which you are the Data Controller, the DPA terms (available on request at legal@sosh.app) apply and are deemed accepted upon your continued use of the Service. For the purposes of the DPA, [LEGAL ENTITY] acts as Data Processor.

---

## 17. Governing law and forum

These Terms are governed by the laws of Portugal, without regard to its conflict of law provisions. Any dispute arising out of or in connection with these Terms shall be submitted to the exclusive jurisdiction of the courts of Portugal. The United Nations Convention on Contracts for the International Sale of Goods does not apply.

---

## 18. Changes to these Terms

We may update these Terms from time to time. For material changes, we will provide at least **30 days' advance notice** by email to your registered address and by in-app notification. Your continued use of the Service after the effective date constitutes acceptance of the revised Terms. If you do not agree to a material change, you may terminate before the effective date.

---

## 19. Contact

**[LEGAL ENTITY]**  
support@sosh.app  
sosh.app
```

---

## §13 Privacy Policy prose

```mdx
# Privacy Policy

**Last updated: 13 June 2026**

This Privacy Policy describes how **[LEGAL ENTITY]** ("SOSH", "we", "us", "our") collects, uses, stores, and shares your personal data when you use SOSH at sosh.app and its subdomains. It is issued pursuant to GDPR Articles 13 and 14.

---

## 1. Who we are

[LEGAL ENTITY] is the Data Controller responsible for personal data collected through SOSH. We are incorporated under the laws of Portugal.

**Contact:** privacy@sosh.app

---

## 2. Data we collect

**Identity data**
- Email address (provided at registration; held by Supabase Auth)
- Name and business profile: company name, website, industry, description, logo
- Social account identifiers: platform username and display name (received from LinkedIn, X, Instagram, Facebook, or Threads when you connect an account)

**Billing data**
- Stripe customer identifier and subscription identifier
- Card fingerprint (a non-reversible partial identifier provided by Stripe; we do not store full card numbers)
- Stripe event payloads received via webhook, which may include your email address as provided to Stripe during checkout

**Content data**
- Brand voice profiles: tone descriptors, target audience, keywords, writing examples, competitor references, unique value proposition
- Campaign information: names, objectives, instructions, scheduling preferences
- Post copy you draft or edit; feedback notes

**AI-generated content**
- Post drafts and hashtag suggestions generated by the AI on your instructions
- Generation metadata: model version, number of regeneration attempts (no prompts or output text stored separately from post records)

**Usage and telemetry data**
- AI usage records: token counts, response times, cost estimates — no content
- Trial counters, post generation counts
- Job execution logs (publish, metrics sync, email delivery)

**Security and operational data**
- Rate-limit records: IP addresses and email-based keys used to enforce access-rate limits
- Error and performance events via Sentry (PII-scrubbed before transmission; Session Replay is disabled)

**Third-party engagement data (Engagement Inbox — not active at launch)**
When the Engagement Inbox feature is available, we may receive public comments, mentions, and direct-message content posted to your connected social accounts by third parties. We process this data as Data Processor on your instructions; you are the Data Controller for that content.

---

## 3. How we use your data

| Purpose | Lawful basis (GDPR Art. 6) |
|---|---|
| Create and maintain your account | Art. 6(1)(b) — Contract performance |
| Provide the Service (generate, store, schedule, and publish content) | Art. 6(1)(b) — Contract performance |
| Process payments and manage subscriptions | Art. 6(1)(b) — Contract; Art. 6(1)(c) — Legal obligation (tax records) |
| Send transactional email (billing confirmations, product notifications) | Art. 6(1)(b) — Contract performance |
| Send trial-period reminders | Art. 6(1)(b) — Contract performance |
| Prevent abuse and enforce rate limits | Art. 6(1)(f) — Legitimate interest: protect the Service and users |
| Monitor errors and service performance | Art. 6(1)(f) — Legitimate interest: maintain service quality |
| Improve SOSH AI models (opt-in only; off by default) | Art. 6(1)(a) — Consent, managed in account settings |

---

## 4. Sources of data

- **Directly from you:** at registration, during onboarding, when managing campaigns and posts.
- **From social platforms:** profile identifiers, usernames, and display names received via OAuth when you connect a social account.
- **From Stripe:** billing events and payment status via webhook.
- **Automatically:** rate-limit records, usage telemetry, error events.

---

## 5. Who we share your data with

We share personal data only with the sub-processors listed at sosh.app/subprocessors. We do not sell your personal data. We do not share it with advertisers or for marketing purposes.

Sub-processors are contractually bound to process your data only as necessary to provide their service to SOSH and in accordance with applicable data protection law.

---

## 6. International transfers

Our sub-processors are primarily located in the European Economic Area. One sub-processor — Anthropic PBC — is based in the United States. When generating content, relevant portions of your business profile and campaign brief are sent to Anthropic's API, hosted in the United States. This transfer is covered by the EU-US Data Privacy Framework, under which Anthropic has certified. You can verify Anthropic's certification at the list maintained by the US Department of Commerce.

Where any sub-processor transfers data outside the EEA in future, we will update sosh.app/subprocessors and ensure appropriate safeguards (Standard Contractual Clauses or an applicable adequacy decision) are in place before the transfer occurs.

---

## 7. How long we keep your data

| Data category | Retention period |
|---|---|
| Account identity and business profile | Lifetime of your account, plus 30 days after a verified deletion request |
| Brand voice profiles, campaigns, and posts | Same |
| Social account OAuth tokens | Deleted immediately on disconnect (access revoked, identifiers removed, vault secret deleted) |
| Social account metadata (username, display name) | Lifetime of account + 30 days |
| Billing records | 10 years from the transaction date (Portuguese tax law) |
| Security and rate-limit records (IP addresses, email keys) | 30 days |
| Error monitoring events | 90 days (Sentry platform default) |
| AI usage telemetry | 24 months |
| Email delivery records | 30 days after final delivery status |
| Email suppression list | Indefinitely (required to honour unsubscribe and bounce requests) |

---

## 8. Your rights

Under GDPR, you have the following rights:

- **Access** (Art. 15) — request a copy of the personal data we hold about you.
- **Rectification** (Art. 16) — ask us to correct inaccurate data.
- **Erasure** (Art. 17) — ask us to delete your data, subject to legal retention obligations (e.g. billing records retained for tax purposes).
- **Restriction** (Art. 18) — ask us to pause processing in certain circumstances.
- **Portability** (Art. 20) — receive your data in a structured, machine-readable format.
- **Object** (Art. 21) — object to processing based on legitimate interest.
- **Withdraw consent** (Art. 7(3)) — where we process data based on your consent (e.g. AI model opt-in), withdraw it at any time via account settings; withdrawal does not affect processing carried out before withdrawal.

To exercise any right, email **privacy@sosh.app**. We will respond within **30 days**. For complex or numerous requests we may extend to 60 days; we will notify you within the first 30 days if so.

We have not appointed a Data Protection Officer. All data-subject requests should be directed to **privacy@sosh.app**.

---

## 9. Cookies

We use one cookie:

| Cookie | Purpose | Type | Lifetime |
|---|---|---|---|
| `sb-[project]-auth-token` | Stores your authentication session | Strictly necessary | Access token: ~1 hour; refresh token: persistent until you log out |

We do not use advertising cookies, tracking pixels, or third-party analytics cookies. Vercel Analytics and Vercel Speed Insights, used for aggregate traffic measurement, are cookieless and collect no personal identifiers. No cookie consent banner is shown because no non-essential cookies are used.

---

## 10. Security

We implement reasonable technical and organisational measures to protect your personal data, including:

- TLS encryption for all data in transit
- Encryption at rest (Supabase platform default)
- OAuth tokens stored in Supabase Vault — an encrypted secrets store with key management separate from application data; no raw token appears in any application database table
- Row-Level Security on all database tables, ensuring each account accesses only its own data
- Incident response aligned with GDPR Art. 33/34: in the event of a personal data breach, we will notify you and the supervisory authority (CNPD) within 72 hours of becoming aware

---

## 11. Contact

**Privacy enquiries and data-subject requests:** privacy@sosh.app  
**Data Processing Agreement requests:** legal@sosh.app

---

## 12. Supervisory authority

If you believe we have not handled your data lawfully, you may lodge a complaint with:

**Comissão Nacional de Proteção de Dados (CNPD)**  
Av. D. Carlos I, 134 – 1.º, 1200-651 Lisboa, Portugal  
www.cnpd.pt

---

## 13. Changes to this policy

We may update this Privacy Policy from time to time. Material changes will be communicated by email to your registered address at least **30 days** before they take effect, and this page will be updated with the new effective date. Continued use of the Service after the effective date constitutes acceptance of the revised policy.
```

---

## §14 Subprocessors List prose

```mdx
# Subprocessors

**Last updated: 13 June 2026**

[LEGAL ENTITY] ("SOSH") uses the following sub-processors to deliver the Service. All sub-processors are contractually bound to process personal data only as instructed and in compliance with applicable data protection law.

| Sub-processor | Purpose | Data categories | Region | Transfer mechanism |
|---|---|---|---|---|
| Supabase Inc. | Database, user authentication, encrypted OAuth token storage | Account identity, business profile, campaigns, posts, billing references | EU | Intra-EEA |
| Anthropic PBC | AI post generation and brand voice inference | Campaign briefs, post content, brand voice profiles | United States | EU-US Data Privacy Framework |
| Stripe Inc. / Stripe Payments Europe Ltd | Payment processing and subscription management | Billing data, customer email | EU | Intra-EEA |
| Resend Inc. | Transactional email delivery | Recipient email addresses, email content | EU | Intra-EEA |
| Functional Software, Inc. (Sentry) | Error monitoring and performance tracing | Anonymised error events (PII-scrubbed) | EU | Intra-EEA |
| Upstash Inc. | Cron job scheduling | Endpoint URLs only | EU | Intra-EEA |
| Vercel Inc. | Application hosting and content delivery network | Application request data | EU | Intra-EEA |

**Note on publishing infrastructure:** Our social media publishing layer (Postiz) is self-hosted by [LEGAL ENTITY] on servers in the EU. It is not a third-party sub-processor.

---

## Sub-processor changes

We will notify you by email at least **30 days** before adding or replacing a sub-processor, and update this page on the same date. During the 30-day notice window you may object by emailing legal@sosh.app. If we cannot resolve the objection, you may terminate your subscription with a pro-rata refund of any prepaid fees for the period after the change takes effect.

For questions about our sub-processors or data processing practices, contact privacy@sosh.app.
```

---

## §15 Footer link patch

ADR 0009 §3.3 established the footer legal link set. Addition required:

**New link:** `Subprocessors` (single word — consistent with industry convention)

**Placement in footer legal links:**
1. Privacy Policy (existing)
2. Terms of Service (existing)
3. **Subprocessors** (new — add after Terms of Service)

**i18n keys to add (all three locale files simultaneously per CLAUDE.md):**
- `footer.legal.subprocessors` (EN) → `"Subprocessors"`
- `footer.legal.subprocessors` (PT) → `"Subprocessadores"` + `_todo` sentinel
- `footer.legal.subprocessors` (ES) → `"Subprocesadores"` + `_todo` sentinel

**Route:** `/[locale]/subprocessors`

---

## §16 Lawyer-ratification gate

Recorded in `/docs/launch-checklist.md` §9. The specific checklist:

- [ ] Counsel has reviewed §12 (ToS), §13 (Privacy Policy), and §14 (Subprocessors) prose.
- [ ] Any redlines have been incorporated as a correction PR to `content/legal/`.
- [ ] Signed-off version is confirmed as what will ship at go-live.
- [ ] All `[LEGAL ENTITY]` placeholders replaced with the actual legal entity name.
- [ ] Anthropic DPF participation confirmed current (§7, §8).
- [ ] Stripe entity confirmed (§8 — EU vs US entity).

**This gate blocks the Stripe live-mode flip (launch-checklist §6).** The Builder may proceed with MDX transcription ahead of ratification; counsel redlines return as a correction PR.

---

## §17 Builder hand-off

Complete the following in order:

### A. MDX transcription

1. Copy §12 verbatim block into `content/legal/terms.en.mdx`. Frontmatter:
   ```yaml
   ---
   title: "Terms of Service"
   lastUpdated: "2026-06-13"
   locale: "en"
   evidenceRef: "5f7a2e4"
   ---
   ```
2. Copy §13 verbatim block into `content/legal/privacy.en.mdx`. Same frontmatter pattern (`title: "Privacy Policy"`).
3. Create `content/legal/subprocessors.en.mdx`. Copy §14 verbatim block. Frontmatter: `title: "Subprocessors"`, same `lastUpdated` and `evidenceRef`.
4. After counsel ratification, replace `[LEGAL ENTITY]` throughout all three files with the confirmed entity name.

### B. New route — /subprocessors

5. Create `app/[locale]/(marketing)/subprocessors/page.tsx`. Follow the identical pattern as `app/[locale]/(marketing)/terms/page.tsx` (Server Component, `LegalPage` wrapper, MDX import).
6. Add `/subprocessors` to `sitemap.ts` across all three locales.

### C. Footer link

7. Add `footer.legal.subprocessors` key to `i18n/en/common.json`, `i18n/pt/common.json`, and `i18n/es/common.json` simultaneously. PT and ES values: translated string + `_todo` sentinel per ADR 0009 §10 convention.
8. Wire the key into the footer component at the position specified in §15 (after Terms of Service).

### D. Cookie inventory check

9. Before finalising Privacy Policy MDX, inspect a logged-in browser session in devtools → Application → Cookies. Confirm the inventory matches §10. If any cookies not in the table appear, stop and raise a correction before transcribing.

### E. Schema migration — AI training opt-in

10. Create `supabase/migrations/YYYYMMDDHHMMSS_businesses_ai_training_opt_in.sql`:
    ```sql
    ALTER TABLE public.businesses
      ADD COLUMN ai_training_opt_in BOOLEAN NOT NULL DEFAULT false;

    COMMENT ON COLUMN public.businesses.ai_training_opt_in IS
      'Customer consent for SOSH to use their content for AI model improvement. Default false. Art. 6(1)(a) lawful basis per ADR 0010 §4.';
    ```
    The opt-in UI (account settings toggle) is a separate task. Do not begin AI model improvement processing until: (a) the column exists, (b) the UI exists, and (c) an actual improvement pipeline exists.

### F. Deletion jobs — E6 gap remediation

Two automated deletion jobs required before the §5 retention map is operationally accurate:

11. **Business hard-delete job.** 30 days after a verified deletion request is recorded (mechanism TBD — a `deletion_requests` table or a flag on `businesses`), hard-delete the `businesses` row. All dependent rows cascade: `brand_voices`, `campaigns`, `posts`, `social_accounts`, `trial_state`, `ai_usage`, `email_outbox`, `post_generation_sessions`, `engagement_inbox`, `post_metrics`. Also delete the `auth.users` row via Supabase Auth admin API (`supabase.auth.admin.deleteUser(uid)`). Billing events: `business_id` SET NULL (FK already configured); do not delete (10-year tax retention).

12. **Rate-limit bucket TTL purge.** Delete `auth_rate_limits` rows where `last_refill < now() - interval '30 days'`. Run as part of the existing publish cron or as a dedicated daily job. This enforces the 30-day retention commitment for IP-address and email-key data.

### G. Vault deletion Sentry alert

13. In `lib/db/social-accounts.ts`, replace the two silent `catch {}` blocks for vault RPC deletion with:
    ```typescript
    catch (err) {
      captureException(err, { tags: { operation: 'vault_delete_secret' } })
    }
    ```
    This makes orphaned vault secrets visible in Sentry without breaking the disconnect flow. Import `captureException` from `@sentry/nextjs`.

### H. Prose-only smoke test

14. After transcription, run the existing route smoke test and assert:
    - `/en/terms` → 200, H1 = "Terms of Service"
    - `/en/privacy` → 200, H1 = "Privacy Policy"
    - `/en/subprocessors` → 200, H1 = "Subprocessors"
    - Footer on `/en` contains link "Subprocessors" resolving to `/en/subprocessors`

### I. evidenceRef on future PRs

15. Any future PR modifying files in `content/legal/` must either: (a) confirm the Evidence Pack commit `5f7a2e4` is still current, or (b) update `evidenceRef` to a new Evidence Pack commit covering the change. Document this requirement in `CLAUDE.md` under "Legal pages" or a dedicated section.

---

## Cross-references

- **Evidence Pack:** `docs/evidence/0010-legal-evidence.md` (commit `5f7a2e4`) — all E-refs point here
- **ADR 0009 §6.15** — superseded stub sentence
- **ADR 0009 §7** — MDX infrastructure, `LegalPage` wrapper, frontmatter schema (unchanged; `evidenceRef` field is additive)
- **ADR 0009 §10** — EN-only at launch precedent (§2 Defers inherits this)
- **ADR 0001** — RLS and Vault architecture (§3, §11)
- **CLAUDE.md** — three-step disconnect contract (§3, §5, §13 of Privacy Policy)
- **Launch checklist §9** — ratification gate and ADR 0010 Builder tasks tracked there
