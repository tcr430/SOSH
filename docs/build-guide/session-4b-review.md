# Session 4B — Reviewer Report (Auth & Onboarding)

**Date:** 2026-05-10
**Scope:** Session 4A code — auth flows, onboarding wizard (steps 1–4), email validator, dashboard shell, business context, middleware
**Reviewers (parallel):** `security-reviewer` + `typescript-reviewer`
**Reviewer mode:** Read-only. No files modified. Independent of the Builder.

`tsc --noEmit --skipLibCheck`: 0 SOSH errors (10 ECC remotion errors are pre-existing, unrelated).
ESLint: 0 errors in audited files; only test-file warnings (pre-existing).

---

## Summary table — all checks

| Section | Check | Status | File:Line | Notes |
|---|---|---|---|---|
| **A — Auth security** | A1 Server Actions use anon client | ✅ | `(auth)/*/actions.ts` | Service-role only used for post-signup `createBusiness` (justified, lazy-import) |
| | A2 Raw passwords never logged/stored | ✅ | — | No password values appear in state, errors, or logs |
| | A3 CSRF default protection intact | ✅ | — | No `allowedOrigins` override; no header tampering |
| | A4 Login error message generic | ⚠️ | `login/actions.ts:62` | Generic "invalid" — but unconfirmed-email branch is a side-channel oracle (M-01) |
| | A5 Forgot-password constant response | ✅ | `forgot-password/actions.ts:27` | Returns `{ sent: true }` even on Zod failure |
| | A6 Cookie defaults preserved | ✅ | `middleware.ts:23` | Forwards Supabase SSR cookies verbatim |
| | A7 Reset-password verifies code | ✅ | `reset-password/actions.ts:55` | `exchangeCodeForSession` before `updateUser` |
| **B — Email validator** | B1 Plus addressing rejected | ✅ | `email.ts` | `lastIndexOf('@')` extracts domain correctly |
| | B2 Capital letters rejected | ✅ | `email.ts:33` | `.toLowerCase()` applied |
| | B3 Subdomains rejected | ✅ | `email.ts:47` | `endsWith('.' + blocked)` covers `x.gmail.com` |
| | B4 Unicode homoglyph | ❌ | `email.ts:30–52` | No NFKC / `toASCII` normalization (M-02) |
| | B5 Trailing whitespace | ✅ | `email.ts:31,33` | `.trim()` applied |
| | B6 Multiple `@` chars | ✅ | `email.ts` | Zod `.email()` rejects upstream |
| **C — Multi-tenant isolation** | C1 Business creation via `lib/db/` | ✅ | `signup/actions.ts:85` | `createBusiness(serviceClient, …)` |
| | C2 `owner_id` from session, not form | ✅ | `signup/actions.ts:74` | `authData.user?.id` |
| | C3 Dashboard layout via `lib/db/` | ✅ | `(dashboard)/layout.tsx:4-6` | `getBusinessByOwner`, `getBrandVoice` |
| | C4 `useActiveBusiness` throws outside provider | ✅ | `business-context.tsx:30` | Throws `Error` if `ctx` is null |
| | C5 URL/form params manipulable | ❌ | `step-1/actions.ts:37`, `step-2/actions.ts:9` | **IDOR**: client-supplied `businessId` accepted (B-01) |
| **D — Data integrity** | D1 Zod before every DB call | ❌ | `step-2/actions.ts` | No Zod schema; raw casts; unguarded `JSON.parse` (B-02, B-03) |
| | D2 Signup partial-failure visible | ⚠️ | `signup/actions.ts:81-97` | Silently bounces user signup ↔ onboarding (M-03) |
| | D3 `onboarding_completed` via service-role | ✅ | `lib/db/businesses.ts:81-89` | Lazy `import('@/lib/supabase/service')` |
| | D4 `trial_state` trigger present | ✅ | `migrations/…_trial_state.sql:37-53` | `SECURITY DEFINER` + `ON CONFLICT DO NOTHING` |
| **E — Redirects & routing** | E1 Auth-guarded redirect to login | ✅ | `middleware.ts:33-37` + `layout.tsx:19-20` | Two-layer guard |
| | E2 No-business edge case handled | ✅ | `layout.tsx:22-23` | Redirect to signup |
| | E3 Onboarding loop | ✅ | step-4 stays on page on error | Not infinite |
| | E4 `?redirect=` sanitised | ⚠️ | `login/actions.ts:33-39` | Local-only check works, but no URL decoding (L-03) |
| **F — Code quality (TS)** | F1 No `any` | ✅ | — | All audited files clean |
| | F2 No hardcoded English in JSX | ✅ | — | All visible text via `t()` |
| | F3 All keys in en/pt/es | ❌ | `step-1/actions.ts:11` | `errors.onboarding.name_required` missing in all three locales (B-04) |
| | F4 Direct Supabase outside `lib/db/` | ✅ | — | Only `auth.*` calls (allowed) |
| | F5 `process.env` outside `lib/config.ts` | ✅ | — | One test-only use, acceptable |
| | F6 `'use server'` on all Server Actions | ✅ | — | All six `actions.ts` files |
| | F7 No `console.log` | ⚠️ | `signup/actions.ts:95` | `console.error` with `userId` (L-02) |
| | F8 Zod parse before DB call | ❌ | `step-2/actions.ts` | Missing entirely (B-02) |
| | F9 No unused imports | ✅ | — | — |
| | F10 No `any` leakage from Supabase | ⚠️ | `lib/db/businesses.ts:17,31,44,59,76,78` | `as BusinessRow` casts (M-04) |
| **G — UX** | G1 Loading state on submit | ❌ | `Step2Form.tsx:178` | Uses `action={saveStep2Action}` directly — no pending state (B-05) |
| | G1 Skip buttons pending state | ⚠️ | `Step1Form.tsx:95`, `Step2Form.tsx:163` | No disabled/pending indicator (M-05) |
| | G2 Inline validation errors | ❌ | `Step1Form.tsx:48` | Renders field label, not error message (B-06) |
| | G2 Step 2 has no error UI at all | ❌ | `Step2Form.tsx` | No `useActionState`; server errors invisible (B-05) |
| | G3 Mid-onboarding refresh resumes | ✅ | `onboarding/page.tsx:23-32` | Reads filled fields and routes to next step |
| | G4 Form fields preserve values on error | ❌ | `login/page.tsx:49,66`, `forgot-password/page.tsx:55`, `signup/page.tsx` | No `defaultValue` from state (M-06) |
| **H — Conventions** | H1 `formatISO` for DB timestamps | ✅ | `lib/db/businesses.ts:97` | Used in `softDeleteBusiness` |
| | H2 shadcn primitives only | ✅ | — | `Button`, `Input`, `Label`, `Textarea`, `Badge` from shadcn |
| | H3 File structure matches CLAUDE.md | ✅ | — | All new files in declared paths |
| | H4 `useActiveBusiness` guard | ✅ | `business-context.tsx:30` | — |
| | H5 No duplicate client fetch | ✅ | `(dashboard)/layout.tsx:37` | Server fetches once, passes into `<BusinessProvider>` |

---

## Findings — by severity

### BLOCKING (must fix before Session 5)

#### B-01 — Insecure Direct Object Reference: client-supplied `businessId` trusted in step-1 and step-2
**Files:** `app/[locale]/(dashboard)/onboarding/step-1/actions.ts:37–45`, `step-2/actions.ts:9,27–35`
**What's wrong:** Both Server Actions read `businessId` from a hidden `<input>` (FormData) and pass it directly to `updateBusiness` / `upsertBrandVoice`. There is no server-side ownership assertion. RLS at the DB layer (`businesses_update_own`: `owner_id = auth.uid()`) is the only thing preventing a cross-tenant overwrite — a defense-in-depth failure.
**Why it matters:** Any RLS misconfiguration (now or in a future migration) instantly becomes a tenant-data-overwrite vulnerability. Pattern is inconsistent with `completeOnboardingAction` and `skipOnboardingAction`, which already do this correctly.
**Fix:** After `createClient()` and `auth.getUser()`, call `getBusinessByOwner(client, user.id)` and use that business's `id`. Remove `businessId` from the form, schema, and FormData read.

#### B-02 — `saveStep2Action` has no Zod schema
**File:** `app/[locale]/(dashboard)/onboarding/step-2/actions.ts:7–36`
**What's wrong:** Eight FormData fields are extracted with raw `as string` casts and sent directly to `upsertBrandVoice`. No schema, no `safeParse`, no length caps, no field whitelist.
**Why it matters:** Violates the project's "Zod for all input validation" rule (CLAUDE.md). A malformed or malicious client can inject arbitrary content (subject only to DB column types). Inconsistent with every other Server Action in the codebase.
**Fix:** Add `step2Schema` modelled on `step1Schema`. Use `safeParse`. Treat tone, target_audience, keywords, avoid_words, unique_value_prop as optional strings; locale as `z.enum(['en','pt','es'])`.

#### B-03 — `JSON.parse(toneRaw)` is unguarded
**File:** `step-2/actions.ts:12`
**What's wrong:** A tampered or empty hidden field produces an uncaught `SyntaxError` and a 500-class server error — the user sees nothing useful.
**Why it matters:** Trivially weaponisable to spam the error log; degrades UX for any client-side serialisation glitch.
**Fix:** Wrap `JSON.parse` in try/catch and treat malformed input as `[]`, or — preferred — validate via `z.array(z.string()).safeParse(JSON.parse(...))` after a try/catch.

#### B-04 — Locale key `errors.onboarding.name_required` does not exist
**Files referenced:** `step-1/actions.ts:11` (sets the key) — missing from `i18n/{en,pt,es}/common.json` and `auth.json`
**What's wrong:** Zod sets this string as an error message; next-intl renders the raw key at runtime.
**Why it matters:** User sees the literal string `errors.onboarding.name_required` in the UI on a blank-name submit.
**Fix:** Add the key to all three locale files (en, pt, es) under the existing `errors.onboarding` namespace (or wherever the i18n root for these errors lives). Also confirm any other Zod-set message keys are present in all three locales.

#### B-05 — `Step2Form` is missing `useActionState`, loading state, and error rendering
**File:** `app/[locale]/(dashboard)/onboarding/step-2/Step2Form.tsx:91,178`
**What's wrong:** Form uses `action={saveStep2Action}` directly. No pending indicator on the submit Button (user can double-submit). No mechanism to display any server-side error back to the user.
**Why it matters:** UX hole + reliability issue. If `saveStep2Action` ever returns an error, the user has no idea why nothing happened.
**Fix:** Refactor to mirror Step 1: define a `Step2State` type, change `saveStep2Action` to `(state, formData) => Promise<Step2State>`, wrap the form with `useActionState`, render errors inline, and disable the submit button while pending.

#### B-06 — Step 1 inline error renders the field label, not the validation message
**File:** `app/[locale]/(dashboard)/onboarding/step-1/Step1Form.tsx:48`
**What's wrong:** The error paragraph reads `{t('step1.fields.name')}` — this is the field label string, not the error from `state.errors.name`.
**Why it matters:** The Zod validation message is silently discarded; the user sees the field name repeated instead of "Business name is required."
**Fix:** Render the localised message keyed by `state.errors.name` (after B-04 lands), or read the message from `state.errors.name`.

---

### HIGH (fix in Session 4-D, no later)

#### H-01 — `forgot-password` reset URL built from spoofable `x-forwarded-host`
**File:** `app/[locale]/(auth)/forgot-password/actions.ts:34–37`
**What's wrong:** The `redirectTo` URL passed to `resetPasswordForEmail` is constructed from `x-forwarded-host` / `x-forwarded-proto` headers with a fallback to `host`. On any infrastructure that doesn't strip/override these headers, an attacker-supplied header makes the email's reset link point to `https://evil.com/...`.
**Why it matters:** Vercel sets `x-forwarded-host` from the verified host so this is mitigated in production today, but it is infrastructure-dependent and would silently break security on a different deployment target. Supabase's allowlist on `redirectTo` is the only backstop.
**Fix:** Replace with a hardcoded value from `lib/config.ts` (e.g. `config.server.APP_URL`). Reject any client header influence on email-link origins.

#### H-02 — `resetPasswordAction` reads passwords with unsafe casts before Zod
**File:** `app/[locale]/(auth)/reset-password/actions.ts:31–36`
**What's wrong:** `formData.get('password') as string` and `as string` for `confirm` happen before Zod validation. If either field is missing, casting `null` to `string` produces unexpected runtime values, and the `password !== confirm` check operates on un-validated input.
**Why it matters:** Type-safety hole + potential confusing error path. Not exploitable today but violates the "validate at the boundary" rule.
**Fix:** Either: (a) move the mismatch check into Zod via `.superRefine` on a schema that includes `password` and `confirm`; or (b) use `String(formData.get('password') ?? '')` and run mismatch check only after `parsed.success`.

---

### MEDIUM (track for later; defer-acceptable)

#### M-01 — Unconfirmed-email branch in login is an email-existence oracle
**File:** `app/[locale]/(auth)/login/actions.ts:62–63`
**What's wrong:** Logging in with a registered-but-unconfirmed email returns `{ unconfirmedEmail: email }`; an unregistered email returns `{ errors: { _form: 'errors.login.invalid' } }`. These are distinguishable.
**Why it matters:** Allows account-existence enumeration. The resend-confirmation UX requires this state, so removing it is a UX trade-off.
**Fix options:** Document as accepted trade-off, OR show the resend-confirmation banner on any login attempt without echoing the email back in state.

#### M-02 — Unicode homoglyph bypass in email blocklist
**File:** `lib/validation/email.ts:30–52`
**What's wrong:** `gmaіl.com` (Cyrillic `і` U+0456) passes both Zod `.email()` and `FREE_EMAIL_PROVIDERS` lookup.
**Fix:** Apply `domain.normalize('NFKC')` (or `punycode.toASCII()`) to the extracted domain before the blocklist check.

#### M-03 — Signup partial-failure has no recovery path for the user
**File:** `app/[locale]/(auth)/signup/actions.ts:81–97`
**What's wrong:** If `auth.signUp` succeeds but `createBusiness` throws, the user is silently redirected to `/onboarding`, which redirects to `/signup`. On retry they hit `errors.signup.email_taken` with no explanation.
**Fix:** In the catch block, return an error state pointing the user to login + a "complete setup" banner, or to a manual-recovery link.

#### M-04 — `as BusinessRow` casts mask Supabase response types
**File:** `lib/db/businesses.ts:17,31,44,59,76,78`
**What's wrong:** Casts suppress the Supabase-generated `unknown` rather than using a generated schema type.
**Fix (future):** Run `supabase gen types typescript` and use generated row types. Not a current bug.

#### M-05 — Skip buttons have no pending/disabled state
**Files:** `Step1Form.tsx:95`, `Step2Form.tsx:163`
**What's wrong:** Nested `<form action={skipOnboardingAction}>` skip buttons offer no loading feedback.
**Fix:** Wrap with a small client component that uses `useFormStatus` to disable the button while pending.

#### M-06 — Auth form fields do not preserve values on validation error
**Files:** `login/page.tsx:49,66`, `forgot-password/page.tsx:55`, `signup/page.tsx`
**What's wrong:** Inputs lack `defaultValue` bound to the previous state. After a server error the user must retype every field — especially painful for signup (4 fields).
**Fix:** Have each Server Action return submitted (non-secret) values in its state; Client form binds `defaultValue={state.values?.email}` etc. Never echo passwords.

---

### LOW (style/nits, optional)

| ID | File:Line | Issue |
|---|---|---|
| L-01 | `reset-password/actions.ts:31–36` | Mismatch check runs before Zod; minor ordering inconsistency |
| L-02 | `signup/actions.ts:95` | `console.error('[signup] Post-auth setup failed for user', userId, err)` — logs `userId` (PII-adjacent). Replace with proper logger when added; for now leave (acceptable per CLAUDE.md "console.error for genuine error logging is acceptable until proper logger lands") |
| L-03 | `login/actions.ts:33–39` | `isSafeRedirect` does not URL-decode before checks; double-encoded paths could bypass the guard |
| L-04 | `step-3/page.tsx:59–63` | Continue `<Link>` duplicates inline button styles instead of using `cn(buttonVariants({…}))` |

---

## Recommended fix order for Session 4-D correction pass

Fix in this order — each builds on the previous and the early ones unblock testability of the later ones.

1. **B-01** — Derive `businessId` server-side in `step-1/actions.ts` and `step-2/actions.ts` via `getBusinessByOwner(client, user.id)`. Remove `businessId` from forms, schemas, and FormData reads. (IDOR closure is the highest-priority correctness fix.)
2. **B-02 + B-03** — Add `step2Schema` to `saveStep2Action`; wrap `JSON.parse(toneRaw)` in try/catch + Zod array parse. (Same file as B-01 step-2 fix; do them together.)
3. **B-05** — Refactor `Step2Form` to use `useActionState` with a `Step2State` type; this is needed to surface the new Zod errors from B-02. Add submit-button pending state.
4. **B-04** — Add `errors.onboarding.name_required` (and any other Zod-message keys discovered while doing B-02/B-05) to en/pt/es. Run a quick `diff` on the three locale files as part of this step.
5. **B-06** — Fix `Step1Form.tsx:48` to render `state.errors.name` rather than the field label. (After B-04 so the keys exist.)
6. **H-01** — Replace `x-forwarded-host` construction in `forgot-password/actions.ts` with `config.server.APP_URL`. May require adding `APP_URL` to `lib/config.ts` if not already present.
7. **H-02** — Move password mismatch into Zod `.superRefine` in `reset-password/actions.ts`, eliminating the unsafe pre-Zod casts.
8. **M-03** — Improve signup partial-failure UX (return an error state instead of redirect).
9. **M-06** — Preserve form field values on validation error in login, signup, forgot-password (echo non-secret values via state).
10. **M-05** — Add `useFormStatus` wrapper for skip buttons.
11. Defer to backlog: **M-01** (decision required), **M-02** (NFKC normalize), **M-04** (`supabase gen types`), and all **L-***.

Verification gates after the correction pass:
- `npx tsc --noEmit --skipLibCheck` clean
- `npx vitest run lib/db lib/social lib/validation` all green (add Step 2 schema tests if practical)
- Manual smoke: signup → step-1 (blank name → see localised error) → step-2 (submit pending → success) → step-3 → step-4 → campaigns. Repeat with a tampered hidden `businessId` to confirm IDOR is closed (server should ignore it).

---

awaiting your decision on which fixes to prioritize before Session 4-D correction pass.
