# AI Layer Review — Session 5 Part C

**Date:** 2026-05-15
**Reviewer scope:** independent security-reviewer + typescript-reviewer + cost-aware-llm-pipeline synthesis against ADR 0003.
**Scope of files reviewed:** `/lib/ai/**`, `/lib/db/ai-usage.ts`, `/lib/db/trial-state.ts`, `/lib/config.ts`, `eslint.config.mjs`, onboarding step-1/step-2/infer-brand-voice actions and `Step2Form.tsx`.

---

## Summary table

| Section | Check | Status | File:Line | Fix |
|---|---|---|---|---|
| **A. Architecture** | All ADR §3 files present | ✅ | `lib/ai/*` | — |
| A | `Prompt<TInput,TOutput>` matches ADR | ✅ | `prompts/types.ts:5` | — |
| A | `index.ts` public surface matches ADR §3 | ✅ | `lib/ai/index.ts` | — |
| A | Runner 7-step flow ordering | ⚠️ | `runner.ts:48-186` | Order ok; step 8 (counter increment) happens before step 7 (ai_usage write in finally). Outcome correct but step labels in code don't match ADR numbering |
| A | `getAnthropicClient` not exported from index | ✅ | `index.ts` | — |
| A | ESLint guard on `@anthropic-ai/sdk` | ✅ | `eslint.config.mjs:46-63` | — |
| A | Mock provider via `AI_PROVIDER=mock` | ✅ | `client.ts:29-48` | — |
| A | Mock keyed by `model` not `prompt_id` (ADR §18 says fixtures keyed by prompt_id) | ⚠️ | `client.ts:34-44` | Minor deviation: fixtures stored as `${model}.json`. Acceptable for Session 5 (one prompt per model), but bumps a real Phase-2 problem when two prompts share a model |
| **B. Trial enforcement** | Trial check is the very first action in `runPrompt` | ✅ | `runner.ts:54-61` | — |
| B | Throws synchronously, no SDK fetch initiated when capped | ✅ | `runner.ts:55-60` | — |
| B | Counter incremented only on success | ✅ | `runner.ts:152-162` | — |
| B | Increment uses service-role via lazy import | ✅ | `lib/db/trial-state.ts:36-49` | — |
| B | **Cap bypass via missing `trial_state` row during onboarding** | ❌ **CRITICAL** | `context.ts:58-69`, migration `20260430120008_social_accounts_trial_trigger.sql` | Trial row is created by trigger on first social account connection (per CLAUDE.md). Brand-voice inference fires from `step-1/actions.ts:53` (`after(() => inferBrandVoiceAction())`) — **before** any social account is connected. Therefore `trialStateRow === null` → `trialState = null` → runner skips the cap. A trial user can call inference an unbounded number of times before connecting a social account. Fix: either (a) backfill `trial_state` on business creation, or (b) treat `trialStateRow === null` as `isTrial: true` until paid plan is explicitly established (`businesses.plan === 'starter'/'pro'`) |
| B | Read-then-update increment is racy under concurrency | ⚠️ | `lib/db/trial-state.ts:38-48` | Two parallel requests will both read `n`, both write `n+1`, losing one increment. With `after()` fire-and-forget per-form-submit it's unlikely but possible. Replace with `update().eq().select()` + RPC `trial_state_increment_brand_voice` or an atomic SQL `UPDATE … SET col = col + 1` |
| B | TOCTOU on cap check (context fetched once, increment after SDK) | ⚠️ | `runner.ts:54-61` | Trial state read in `buildCustomerContext` is reused. N parallel calls all see "remaining=3" and all pass. After SDK, all increment. User can spend N attempts with cap=3 if they fire enough requests. Acceptable risk for brand-voice (UI gates retries via polling), but flag for post-generation |
| B | Bypass via direct `/lib/ai/` usage outside runner | ✅ | `index.ts` | `getAnthropicClient` not exported. Callers can only invoke `runPrompt` which enforces caps |
| **C. SSRF** | Scheme allow-list (F-1) | ✅ | `website-fetcher.ts:69` | — |
| C | 127.0.0.0/8, 10/8, 172.16/12, 192.168/16, 169.254/16 blocked | ✅ | `website-fetcher.ts:23-32` | — |
| C | IPv6 `::1`, `fc00::/7` blocked | ✅ | `website-fetcher.ts:39-45` | — |
| C | **DNS `lookup()` returns only the first IP, not all A/AAAA records** | ❌ **HIGH** | `website-fetcher.ts:50` | A host with multiple A records (one public, one private) returns only the first. Fix: `lookup(hostname, { all: true })` and check **every** address in the array, reject if any matches a blocked range |
| C | **TOCTOU: DNS check then `fetch(url)` re-resolves** | ❌ **HIGH** | `website-fetcher.ts:50,119` | ADR §12 explicitly requires "custom dispatcher that overrides connection target so the connect-time host matches the pre-resolved IP". Current code resolves, then calls `fetch(url, …)` which resolves again — a DNS-rebind attacker (low-TTL switch between checks) reaches a private IP. Fix: build undici `Agent` with `connect: { lookup: (host, opts, cb) => cb(null, preResolvedIp, family) }` and pass via `dispatcher` |
| C | **IPv4-mapped IPv6 (`::ffff:127.0.0.1`) bypasses both checks** | ❌ **HIGH** | `website-fetcher.ts:48-58` | `family === 6` so `isBlockedIPv4` is skipped; `::ffff:127.0.0.1` is not `::1` or `fc00::/7` so `isBlockedIPv6` returns false. Fix: when address contains `::ffff:`, extract embedded IPv4 octets and pass through `isBlockedIPv4` |
| C | IPv6 link-local `fe80::/10` not blocked | ⚠️ | `website-fetcher.ts:37-46` | ADR §10 F-7 only lists `::1` and `fc00::/7`; ADR-compliant but defense-in-depth gap. Recommend adding `fe80::/10` |
| C | Multicast / 0.0.0.0/8 / 224/4 / 255.255.255.255 not blocked | ⚠️ | `website-fetcher.ts:15-35` | Not in ADR. Recommend adding `0.0.0.0/8` (could route to localhost on some kernels) |
| C | Redirects re-resolved on each hop, max 2 | ✅ | `website-fetcher.ts:133-194` | — |
| C | 5s timeout (F-10) | ✅ | `website-fetcher.ts:112-115` | — |
| C | 500KB body cap (F-11) | ⚠️ | `website-fetcher.ts:197-198` | Cap is enforced AFTER reading full body. A malicious server can stream gigabytes before the cap check fires. Fix: read in chunks via `response.body.getReader()` and abort once `maxBytes` exceeded |
| C | `User-Agent` header (F-12) | ✅ | `website-fetcher.ts:122` | — |
| C | No cookies (F-13) | ✅ | `website-fetcher.ts:124` | Setting `Cookie: ''` is the standard "don't send cookies" idiom for `undici.fetch` (fetch has no cookie jar by default; this is belt-and-braces) |
| C | Credentials in URL rejected (F-14) | ✅ | `website-fetcher.ts:70-71` | — |
| **D. Prompt injection** | User-controlled input in user message, not system | ✅ | `brand-voice-inference.ts:47-75` | — |
| D | System sets "treat as data" framing | ✅ | `brand-voice-inference.ts:30` | Explicit `[DATA]` tag instruction |
| D | `JSON.stringify(context)` in user role | ✅ | `runner.ts:87,94` | Includes user-controllable `business.name`, `business.description` — placed in user message, good |
| D | `business.language` interpolated into system prompt | ⚠️ | `brand-voice-inference.ts:44` | Constrained by DB enum to `en\|pt\|es` per CLAUDE.md. Safe given constraint, but worth a comment noting the constraint |
| **E. Token & credential safety** | `ANTHROPIC_API_KEY` only via config | ✅ | `client.ts:68` | — |
| E | API key never logged | ✅ | grep clean | — |
| E | API key never in error messages | ✅ | `runner.ts:24-30`, `errors.ts` | `mapSdkError` includes `err.message` from SDK — Anthropic SDK does not echo the key, but recommend adding a redactor as Phase-2 hardening |
| E | Client-side bundle exposure | ✅ | `client.ts:7-11`, `config.ts:77-85` | `assertServer()` + `serverOnly()` getters double-protect. No `'use client'` file imports `@/lib/ai` |
| **F. Cost** | `ai_usage` written on every billable outcome | ✅ | `runner.ts:166-185` (`finally`) | — |
| F | `recordUsage` uses service-role | ✅ | `ai-usage.ts:4-17` | — |
| F | `calculateCostCents` matches `MODELS` | ✅ | `models.ts:26-38` | — |
| F | Brand voice → Opus, post-gen → Sonnet, classify → Haiku | ✅ | `brand-voice-inference.ts:24`, ADR mapping | — |
| F | **ADR §10: `ai_usage.input_tokens` should store raw total `(input_tokens + cache_read_input_tokens)`** | ❌ | `runner.ts:175` | Currently stores `response.usage.input_tokens` only. Cache-read tokens accounted for in `cost_cents` but lost in `input_tokens`. Fix: `input_tokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0)` |
| F | **Per-prompt rate limit (ADR §9) is global, not per-prompt** | ❌ | `runner.ts:68-74`, `ai-usage.ts:19-32` | `countRecentCalls` does `SELECT COUNT(*) ... WHERE business_id = $1` with no `prompt_id` filter. All prompts share the same 60s bucket. The brand-voice cap of 10/min would also count post-generation calls. Fix: add `prompt_id` parameter to `countRecentCalls` and `.eq('prompt_id', promptId)` |
| F | `AI_RATE_LIMIT_POST_GENERATION_PER_MIN` not defined in config | ⚠️ | `config.ts:23`, `runner.ts:71` | Runner hardcodes `60` as fallback rate limit for non-brand-voice prompts; ADR §20 lists this env var. Add to `config.ts` |
| F | Trial cap not just for inference — also for posts/campaigns | ⚠️ | `runner.ts:58-60` | Runner only handles brand-voice and posts. Campaign-objective-parse will need wiring. Deferred-acceptable for Session 5 |
| **G. Errors** | SDK errors mapped via `mapSdkError` | ✅ | `runner.ts:24-30` | — |
| G | 429 retried, 5xx retried, 4xx not retried | ✅ | `runner.ts:32-46` | — |
| G | 200-with-invalid-body NOT retried | ✅ | `runner.ts:132-141` | — |
| G | `recordAiUsage` failure does not propagate | ✅ | `runner.ts:182-184` | `try/catch` around the `finally` write, logs to `console.error` |
| G | User-facing errors safe (no API key/internal details) | ✅ | `errors.ts`, action layer | i18n keys translate; raw `err.message` only reaches `console.error` |
| G | **`fetch_failed` AiErrorCode declared but never thrown** | ⚠️ | `errors.ts:8`, `website-fetcher.ts` | `fetchWebsiteText` returns `null` on all failures (per ADR §12) and never throws. Dead enum value. Either remove or document it as reserved for future caller-opt-in mode |
| **H. TypeScript** | No `any` in `/lib/ai/` | ✅ | — | — |
| H | No direct `@anthropic-ai/sdk` imports outside `/lib/ai/` | ✅ | grep clean + ESLint rule | — |
| H | No direct Supabase calls in `context.ts` (uses `/lib/db/`) | ✅ | `context.ts:2-7` | — |
| H | Service-role via lazy import | ✅ | `context.ts:31`, `runner.ts:64`, `metrics.ts:2,26`, `ai-usage.ts:7`, `trial-state.ts:37,53` | — |
| H | Zod schemas strict | ✅ | `brand-voice-inference.ts:5-12` | — |
| H | `(error as { message: string }).message` cast | ⚠️ | `ai-usage.ts:14,30,44`, `trial-state.ts:16,30,77`, `metrics.ts:15,37` | Violates `unknown`-narrowing rule in coding-style.md. Replace with `error instanceof Error ? error.message : String(error)`. Low severity but project rule says no force-casts |
| H | `(response.usage as { cache_read_input_tokens?: number })` cast | ⚠️ | `runner.ts:148` | Pre-existing SDK type gap; use a narrow helper instead of inline cast |
| H | `lookup` result cast `as { address: string; family: number }` | ⚠️ | `website-fetcher.ts:51` | `node:dns/promises` already returns `LookupAddress` — cast unnecessary, remove |
| **I. Onboarding integration** | Polling has max attempts (POLL_MAX=30s) | ✅ | `Step2Form.tsx:23` | — |
| I | User edits during polling stop polling | ⚠️ | `Step2Form.tsx:262-310` | Polling only stops on `'ready'` or `'timeout'`. Skeleton replaces the form entirely while polling, so user can't edit. Safe |
| I | Late results don't overwrite user input | ✅ | `Step2Form.tsx:281-310` | `stopped` guard + single state transition to `'ready'` |
| I | Failed inference falls back to empty form | ✅ | `Step2Form.tsx:333-336` | `inference_failed` translated subtitle, empty form rendered |
| I | i18n keys exist in all three locales | ❓ | not verified | grep for `step2.analyzing`, `step2.inference_failed`, `step2.ai_suggested`, `step2.fields.*_hint` across en/pt/es common.json — please verify before shipping |
| I | **`errors.ai.*` keys per ADR §14** | ❌ | i18n files | ADR §14 says errors map to `errors.ai.*`. `inferBrandVoiceAction` silently swallows the error and returns `{success:false}`; no UI surfacing of quota_exceeded vs provider_error. After 3 inference attempts, user just sees "inference failed" with no explanation. Fix: surface `err.code` to a UI state and translate via `errors.ai.{quota_exceeded\|rate_limited\|provider_error\|invalid_response}` |
| **J. Conventions** | `formatISO` from date-fns for timestamps | ⚠️ | `metrics.ts:13`, `ai-usage.ts:24` | Uses raw `Date.toISOString()` / `new Date().setUTCDate(1)`. CLAUDE.md says "Never `new Date().toISOString()` directly when comparing or formatting — use `formatISO()` from date-fns". Low severity |
| J | No `process.env` outside config.ts | ✅ | grep clean in `lib/ai/` | — |
| J | No `console.log` left behind | ✅ | only `console.error` for genuine failures | — |

---

## ❌ Critical / High issues — exact fixes

### ❌ B-trial-bypass (CRITICAL, business)
**Where:** `lib/ai/context.ts:58-69` + migration `20260430120008_social_accounts_trial_trigger.sql`
**What:** `trial_state` row is created by trigger on first social account connection. Onboarding step-1 fires `inferBrandVoiceAction()` before any social account exists → `trialStateRow === null` → `trialState = null` → cap bypassed.
**Fix (choose one):**

```ts
// Option A — recommended: create trial_state on business creation
// In whichever code creates the businesses row (likely signup), also insert:
//   INSERT INTO trial_state (business_id, ...) VALUES (newBusiness.id, ...)
// then drop or repurpose the social-account trigger.

// Option B — runtime guard in context.ts
if (trialStateRow === null) {
  const business = await getBusinessById(client, businessId)
  if (business.plan === 'trial' || business.plan === null) {
    trialState = {
      isTrial: true,
      postsRemaining: TRIAL_POST_CAP,
      campaignsRemaining: TRIAL_CAMPAIGN_CAP,
      brandVoiceAttemptsRemaining: config.server.AI_TRIAL_BRAND_VOICE_ATTEMPTS,
    }
  } else {
    trialState = null
  }
}
```
Option A is correct per CLAUDE.md ("trial clock starts on first social account connection") — keep the trigger semantics for the clock, but ensure the row exists with `trial_started_at = NULL` until the first connection.

### ❌ C-dns-all (HIGH, security)
**Where:** `lib/ai/website-fetcher.ts:50`
**Fix:**
```ts
const addresses = await lookup(hostname, { all: true })
for (const { address, family } of addresses) {
  const blocked = family === 6 ? isBlockedIPv6(address) : isBlockedIPv4(address)
  if (blocked) return true
}
return false
```

### ❌ C-toctou (HIGH, security)
**Where:** `lib/ai/website-fetcher.ts:104-130`
**Fix:** pin the resolved IP via `undici.Agent` with a custom `connect.lookup`, then pass `dispatcher` into `fetch`. Reuse the first resolved address from the all-addresses lookup, and keep the same dispatcher across redirects (re-pinning per hop).

### ❌ C-mapped-ipv6 (HIGH, security)
**Where:** `lib/ai/website-fetcher.ts:37-46`
**Fix:**
```ts
function isBlockedIPv6(address: string): boolean {
  const lower = address.toLowerCase()
  if (lower === '::1') return true
  // IPv4-mapped IPv6 — extract and re-check as IPv4
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isBlockedIPv4(mapped[1])
  const firstByte = parseInt(lower.split(':')[0].padStart(4, '0').slice(0, 2), 16)
  return !isNaN(firstByte) && (firstByte & 0xfe) === 0xfc
}
```

### ❌ F-cache-tokens-not-stored
**Where:** `runner.ts:175`
**Fix:**
```ts
input_tokens:
  (response?.usage.input_tokens ?? 0) +
  ((response?.usage as { cache_read_input_tokens?: number } | undefined)?.cache_read_input_tokens ?? 0),
```
(per ADR §10: store the raw total in `input_tokens`; cache savings reflected only in `cost_cents`.)

### ❌ F-rate-limit-not-per-prompt
**Where:** `lib/db/ai-usage.ts:19-32` + `runner.ts:68-74`
**Fix:** add a `promptId` parameter:
```ts
export async function countRecentCalls(
  client: SupabaseClient, businessId: string, windowSeconds: number, promptId?: string,
): Promise<number> {
  const q = client.from('ai_usage').select('id', { count: 'exact', head: true })
    .eq('business_id', businessId).gte('created_at', new Date(Date.now() - windowSeconds*1000).toISOString())
  const { count, error } = promptId ? await q.eq('prompt_id', promptId) : await q
  if (error) throw new Error(error.message)
  return count ?? 0
}
```
Then `runner.ts:68`: `await countRecentCalls(serviceClient, context.business.id, 60, prompt.id)`.

### ❌ I-i18n-ai-errors
**Where:** `inferBrandVoiceAction` and `Step2Form`
**Fix:** propagate `err.code` to a new poll-state value (`'quota_exceeded'`, `'provider_error'`, etc.) and surface via `t(\`errors.ai.${code}\`)`. Add `errors.ai.{quota_exceeded,rate_limited,provider_error,invalid_response,timeout}` to en/pt/es common.json.

---

## ⚠️ Recommendations (non-blocking)

- **C-body-stream:** stream body in chunks and abort once `maxBytes` exceeded (current code accepts arbitrarily large transfer before rejecting).
- **C-extra-ranges:** add `0.0.0.0/8`, `fe80::/10`, multicast.
- **B-race:** convert `incrementBrandVoiceAttempts` / `incrementPostsGenerated` to atomic `UPDATE trial_state SET col = col + 1 WHERE business_id = $1` via SQL or RPC.
- **H-casts:** replace `(error as {message:string}).message` with `error instanceof Error ? error.message : String(error)` across `lib/db/*.ts` and `lib/ai/metrics.ts`.
- **H-lookup-cast:** drop the cast on `node:dns/promises` `lookup` result.
- **A-fixture-key:** fixtures keyed by `model` will collide when two prompts share a model — key by `prompt_id` per ADR §18 once a second prompt exists.
- **F-config-post-gen:** add `AI_RATE_LIMIT_POST_GENERATION_PER_MIN` to `config.ts`.
- **G-dead-enum:** remove `'fetch_failed'` from `AiErrorCode` (or document it as reserved).
- **J-date-fns:** route timestamp formatting through `formatISO()` from date-fns.
- **E-redactor:** add an SDK-error redactor before placing `err.message` into log/error strings (defense-in-depth).

---

## Verdict

### Blockers before Session 6 (next foundational session)
1. **B-trial-bypass** — onboarding inference is uncapped today. Without this fix, "trial cap on brand voice = 3" is not enforced for real users.
2. **C-dns-all + C-toctou + C-mapped-ipv6** — three independent SSRF gaps in the website fetcher. ADR §10/§12 requirements not met; security-reviewer rejects any single one.
3. **F-cache-tokens-not-stored** — ADR §10 contract on `ai_usage.input_tokens`. Cheap one-liner.
4. **F-rate-limit-not-per-prompt** — semantic mismatch with ADR §9; brand-voice and post-gen will mutually starve in production.
5. **I-i18n-ai-errors** — user sees "inference failed" for both "quota exceeded" and "provider down". Required before first user.

### Blockers before first paying user
6. **B-race** — atomic increment for trial counters.
7. **C-body-stream** — true 500 KB cap, not post-hoc.

### Tech debt acceptable to defer
- A-fixture-key (single prompt today)
- C extra IP ranges beyond ADR §10
- H casts / J formatISO consistency
- E SDK-error redactor
- G fetch_failed dead enum value
- F missing `AI_RATE_LIMIT_POST_GENERATION_PER_MIN` until post-generation lands

**Overall:** Architecture and TypeScript discipline are strong. Trial enforcement and SSRF have shipping-blocker defects that map directly to ADR-named constraints (C-1, C-6). Recommend a Session 5D correction pass before declaring Session 5 closed.
