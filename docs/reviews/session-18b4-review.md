# Session 18B-4 — Reviewer Report

**Scope:** B18-060 (login account-enumeration oracle) + B18-025 (middleware.ts → proxy.ts rename).
**Commits reviewed:** `410c1d1` (B18-060), `6c4ba56` (B18-025).
**Lenses:** security-reviewer (load-bearing) + typescript/regression.
**Method:** read the diff and every changed file in full, not the commit messages. No code modified.

## Counts

| Tier | Count |
|------|-------|
| **B (blocker)** | 0 |
| **H (high)** | 0 |
| **M (medium)** | 1 |
| **L (low)** | 3 |

**Verdict: PASS.** The enumeration oracle is genuinely closed on both the login and resend paths, the proxy rename is behaviour-preserving, and the signup-enumeration vector (B18-086) was checked and filed with evidence rather than silently skipped. One medium and three low cleanup notes follow — none block.

---

## LENS 1 — Security (load-bearing)

### S1 — Login indistinguishability ✅ CLOSED
All three failure inputs collapse to the identical response. In `login/actions.ts`:
- **Zod validation failure** (incl. malformed email) → `{ errors: { _form: 'errors.login.invalid' } }` (line 43–46).
- **`signInWithPassword` error** — covers unregistered email, wrong password, **and** unconfirmed email (Supabase returns an error for "Email not confirmed", caught by the single `if (error)`) → `errors.login.invalid` (line 59–62).
- **Null `userId` fallback** → `errors.login.invalid` (line 65–67).

Same key, same shape (`{ errors: { _form }, values: { email } }`), same HTTP semantics (Server Action returns state, no redirect, no status divergence). The old `error.message.includes('email not confirmed')` branch and the `unconfirmedEmail` field are deleted. A future/unmapped Supabase error code cannot leak — there is no `default`/passthrough branch; **every** error hits the generic return. Verified.

### S2 — No raw provider message leak ✅
Grepped the login and resend paths: no `error.message` reaches any user-facing string. Login no longer references `error.message` at all. Resend ignores the `resend()` result entirely. (The only surviving `error.message.includes(...)` in the auth tree is `signup/actions.ts:87` — that is B18-086, out of scope, see S9.)

### S3 — Resend indistinguishability ✅ CLOSED
`resend-confirmation/actions.ts` returns `{ sent: true }` for: real-unconfirmed, real-confirmed, and nonexistent email. `client.auth.resend()` is awaited but its result/error is never inspected (line 46), so "user already confirmed" / "user not found" cannot alter the client-visible outcome. Zod failure also returns `{ sent: true }` (line 39–41). Mirrors the `forgot-password` posture exactly.

### S4 — Conditional-render check ✅
The login page's resend affordance is now an **unconditional** `<Link>` to `/resend-confirmation` (page.tsx:78–84), rendered for every visitor regardless of state. The old conditional amber banner gated on `loginState.unconfirmedEmail` is removed. The resend page itself renders the form unconditionally and the success screen only after submit — neither branches on detected account state. No UI-level oracle.

### S5 — Rate-limit doesn't leak ✅
`resend-confirmation` keys on `ip:<ip>` and `email:<email>` (rate-limit.ts:17, 56–63), independent of whether the account exists. The limit-exceeded response is the generic `errors.rate_limit`. Same email hit repeatedly is throttled identically for registered and unregistered addresses — no existence signal. The rate-limit branch differs from the `sent:true` branch only by attempt frequency, which is orthogonal to registration status.

### S6 — Canonicalization consistency ✅
`resend-confirmation` canonicalizes via the same `canonicalizeEmail` preprocessor in its Zod schema (actions.ts:9–14) used by `login` and `forgot-password`. The email handed to `resend()` and to the rate-limiter is canonical. No mismatch.

### S7 — URL source ✅
No URL in the resend path is derived from request headers (H-01 posture intact). `resend()` is called without `emailRedirectTo`, so the destination falls back to the server-configured Supabase Site URL — not a header. No SSRF/host-injection surface introduced. (See L2 for a parity note.)

### S8 — Residual timing oracle → **M1**
Good: the Builder did **not** attempt an app-layer constant-time hack that would give false assurance. However, the residual timing oracle (Supabase `signInWithPassword` may return faster for a nonexistent user than for a registered-user-wrong-password, depending on GoTrue's dummy-hash behaviour) is **not documented** — neither in a code comment nor in the triage closure note. The response-shape oracle (the actual finding) is fully closed, so this is informational, but per S8 a known residual should be recorded rather than silently dropped. See M1.

### S9 — Signup enumeration check ✅ (NOT skipped)
The Builder performed the Step 0b check and filed **B18-086** in `session-18-triage.md` with concrete evidence: `signup/actions.ts:87–88` returns a field-level `{ errors: { email: 'errors.signup.email_taken' } }` for the "already registered" branch vs. generic `{ errors: { _form } }` elsewhere — a genuine enumeration oracle of the same class as B18-060. Correctly scoped out (report-only) and tiered for a future auth session. This satisfies S9 — no silent skip, so no H.

---

## LENS 2 — TypeScript / regression (proxy rename)

### R1 — Proxy rename behaviour ✅
- **`config.matcher` byte-identical** — diffed the regex string between `6c4ba56^:middleware.ts` and `6c4ba56:proxy.ts`: identical character-for-character.
- **`x-pathname` STILL SET** — proxy.ts:49–50 sets `x-pathname` on `requestHeaders`, which is threaded into `NextResponse.next({ request: { headers: requestHeaders } })` at line 73. The onboarding guard's `headers().get('x-pathname')` contract is preserved. (Unchanged: the i18n-redirect early return at :54–58 does not carry `requestHeaders`, but that is a redirect response — no Server Component renders — and matches pre-rename behaviour.)
- **Export name** `proxy` matches the Next.js 16 convention recorded in the Step 0a recon. Auth-redirect logic (:32–45), locale detection (:34), and nonce/CSP injection (:60–77) are unchanged.

### R2 — No stale references ✅
Tree grep for `middleware.ts` returns exactly one hit: `lib/supabase/middleware.ts` — the legitimate Supabase session-refresh helper, explicitly named in CLAUDE.md's three-client table and unrelated to the renamed root file. Zero stale references to the old root `middleware.ts`. `launch-checklist.md` §8 grep commands and the `current-phase.md` gotcha were updated **in the same commit** (`6c4ba56`). CLAUDE.md already names `proxy.ts`.

### R3 — CLAUDE.md baseline ✅
New files (`resend-confirmation/actions.ts`, `resend-confirmation/page.tsx`) and `proxy.ts`: no `any`, no `console.*`, no `process.env` outside `lib/config.ts` (proxy reads `appConfig` from `@/lib/config`). The `state.errors._form as Parameters<typeof t>[0]` cast in the resend page is a narrow type assertion (not `any`) consistent with existing auth pages.

### R4 — i18n completeness ✅ (with L1)
`resend_confirmation_link` + the `resend_confirmation.{title,subtitle,cta,sent_if_needs,back_to_login}` block were added to **all three** locales (en/pt/es) with matching key sets. Every key referenced by the new pages resolves in all locales. No referenced-but-missing orphan (no H). See L1 for the inverse (present-but-unreferenced) cleanup.

### R5 — Scope discipline ✅
No signup-path edit (`signup/actions.ts` was read-only — B18-086 report-only). All changes fall within B18-060/B18-025. The only incidental change is a cosmetic whitespace realignment of the `reset-password` row in `rate-limit.ts` (L3).

---

## M — Medium

**M1 — Residual login timing oracle is undocumented (S8).**
The app-layer response oracle is closed, but `signInWithPassword` can still leak account existence via response *timing* at the GoTrue layer. The Builder correctly avoided a fake constant-time fix, but left no record of the residual.
*Recommendation:* add a one-line comment at `login/actions.ts:59–61` noting the residual timing oracle is a known, accepted GoTrue-layer limitation, and add a sentence to the B18-060 triage closure. Documentation only — no code behaviour change.

## L — Low

**L1 — Orphaned i18n keys.** `login.resend_confirmation` and `errors.login.confirm_email` are no longer referenced by any `.ts`/`.tsx` file (both were used only by the removed amber banner) yet remain in all three locale files. Dead keys — remove in a future cleanup pass.

**L2 — Resend `emailRedirectTo` left implicit.** Unlike `forgot-password` (which sets `redirectTo: ${config.server.APP_URL}/...`), the resend path calls `resend({ type: 'signup', email })` with no `emailRedirectTo`, relying on the Supabase-dashboard Site URL. This **matches the existing `signup` flow** (which also omits it), so it is consistent rather than a regression — but in preview/staging environments the confirmation link will point at the configured Site URL, not `config.server.APP_URL`. Consider setting `emailRedirectTo` explicitly for env-parity if multi-environment confirmation links matter.

**L3 — Cosmetic whitespace.** `rate-limit.ts` realigned the `reset-password` row when adding `resend-confirmation`. Harmless, in-scope.

---

## Locked-design conformance

The triage records the chosen approach as **Option 3 — collapse all `signInWithPassword` failures to generic `errors.login.invalid`**. The implementation matches Option 3 exactly (single generic return, `unconfirmedEmail` removed, dedicated `/resend-confirmation` route, `resend-confirmation` added to `AuthAction` + `RATE_LIMITS` + `PUBLIC_SEGMENTS`). No deviation. (Note: `docs/session-18.md` was not present in the tree; `session-18-triage.md` is the authoritative closure record and confirms the design.)

**STOP.**

---

## Elective correction pass — 18B-4D (2026-06-19)

Reviewer returned B 0 / H 0 / M 1 / L 3 — a PASS. 18B-4D was an elective documentation + dead-key pass to clear M1 and L1 before they calcified. Zero behavioural change.

| Finding | Resolution |
|---------|-----------|
| **M1** — `/resend-confirmation` locale keys missing from `common.json` | Keys backfilled in `i18n/en/common.json`, `i18n/pt/common.json`, `i18n/es/common.json`. |
| **L1** — orphaned `unconfirmedEmail` i18n keys | Removed from all three `auth.json` files (en, pt, es). |
| **L2 / L3** | Accepted — no behavioural risk; not pursued. |
