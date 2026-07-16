# ADR 0003 — AI Layer Architecture (Phase 1 MVP)

**Status:** Accepted
**Date:** 2026-05-12
**Phase:** 1 — MVP
**Scope:** The `/lib/ai/` module — its file layout, public surface, model selection rules, `CustomerContext` shape, the mandatory `runPrompt()` runner with cost accounting, prompt caching strategy, structured-output validation, rate limiting and trial-cap enforcement, the brand-voice inference flow (Session 5A's first consumer), the SSRF-guarded website fetcher, the error taxonomy, the testing strategy, and the read-only observability helpers. Successor to ADR 0001 (database schema, `ai_usage` table) and ADR 0002 (SocialProvider abstraction — provides the architectural pattern this layer mirrors). Prerequisite for Session 5A (brand-voice inference UI) and every later AI-driven session (post generation, engagement classification, campaign-objective parsing).

This document is design-only. No `.ts` or `.sql` files are produced in this session — TypeScript signatures appear in code blocks below as the contract; the Builder session writes the actual files.

---

## 1. Reversals (read first)

None. ADR 0001 and ADR 0002 do not constrain the AI layer beyond two rules this design respects unconditionally:

- `business_id` tenancy on every persisted row (`ai_usage` already has it; RLS already enforces it)
- Service-role usage restricted to trusted server-only modules (`/lib/ai/` is service-role-only)

No earlier decisions need to be unwound.

---

## 2. Named constraints

These are non-negotiable invariants. Each is restated in the relevant section, but listed here so the Reviewer can grep for them.

- **C-1 — Trial-cap-first.** `runPrompt()` checks the trial cap as its **very first action**, before rate limiting, before SDK invocation, before token assembly. A capped trial customer must never reach the Anthropic SDK. (§7)
- **C-2 — Single SDK chokepoint.** `anthropic.messages.create` may be called **only** from `/lib/ai/runner.ts`. Enforced by ESLint `no-restricted-imports` rule on `@anthropic-ai/sdk` outside `/lib/ai/`. (§4)
- **C-3 — Single AI public surface.** Code outside `/lib/ai/` imports only from `/lib/ai/index.ts`. No deep imports into `prompts/`, `client.ts`, `runner.ts`, etc. (§3)
- **C-4 — Model locked at prompt definition.** Callers never pass a model. Switching a prompt's model requires bumping `version` in the same commit. (§5)
- **C-5 — Mandatory cost accounting.** Every SDK call writes one `ai_usage` row before the result is returned to the caller, on success **and** on failure. Failures that consume tokens (4xx with billable input, invalid-JSON parse on a successful 200) record `success=false` with the token counts the SDK reported. (§6)
- **C-6 — SSRF-guarded website fetcher.** The website fetcher in `/lib/ai/website-fetcher.ts` blocks the explicit IP ranges listed in §10 and re-resolves the host on every redirect. (§10)
- **C-7 — No retry on invalid response or 4xx.** Cost protection. One retry only on 429/5xx with 2s backoff. (§6)
- **C-8 — Service-role only.** Every `/lib/ai/` entry point uses the service-role client and is annotated/imported in a way that makes accidental client bundling impossible (lazy `import('@/lib/supabase/service')` inside functions that need it). (§4)

---

## 3. Module structure

A single public surface in `/lib/ai/index.ts`, mirroring `/lib/social/`. Eight files inside `/lib/ai/`:

```
/lib/ai
  index.ts              ← public surface (re-exports only; the only file callers import)
  client.ts             ← Anthropic SDK singleton; lazy service-role import; serverOnly() guard
  models.ts             ← Model constants + per-model token-cost rates
  context.ts            ← buildCustomerContext(businessId): CustomerContext
  runner.ts             ← runPrompt(prompt, context): Promise<TParsed>
  errors.ts             ← AiError class + AiErrorCode enum
  parsers.ts            ← Zod helpers (extractJsonBlock, safeParseOrAiError)
  website-fetcher.ts    ← SSRF-guarded fetch for brand-voice inference
  metrics.ts            ← getCostThisMonth(), getCallVolumeLast24h() — read-only
  prompts/
    index.ts            ← re-exports each prompt
    brand-voice-inference.ts
    post-generation.ts        (later session — declared shape only here)
    engagement-classification.ts (later)
    campaign-objective-parse.ts  (later)
```

Each prompt file exports a single `Prompt<TInput, TOutput>` object — see §8.

### What `index.ts` exports

```typescript
export { runPrompt } from './runner'
export { buildCustomerContext } from './context'
export { brandVoiceInferencePrompt } from './prompts/brand-voice-inference'
export { fetchWebsiteText } from './website-fetcher'
export { AiError, type AiErrorCode } from './errors'
export { getCostThisMonth, getCallVolumeLast24h } from './metrics'
export type { CustomerContext } from './context'
```

Notably **not** exported: the Anthropic client, the cost rates table, prompt internals. Callers cannot bypass `runPrompt()`.

---

## 4. Anthropic SDK access

```typescript
// /lib/ai/client.ts
import { serverOnly } from '@/lib/supabase/service'

let _client: Anthropic | null = null

export function getAnthropicClient(): Anthropic {
  serverOnly('getAnthropicClient')
  if (!_client) {
    _client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })
  }
  return _client
}
```

- Singleton. Lazy. Service-role-only (the `serverOnly()` guard throws if invoked from a bundle that resolved a browser-targeted environment).
- `getAnthropicClient()` is **not** exported from `/lib/ai/index.ts`. Only `runner.ts` calls it.
- ESLint `no-restricted-imports` blocks `@anthropic-ai/sdk` imports anywhere outside `/lib/ai/`.

### Mock provider

To mirror `SOCIAL_PROVIDER=mock` (ADR 0002 §11), an env var `AI_PROVIDER=mock` switches `getAnthropicClient()` to return a `MockAnthropicClient` that replays fixture JSON keyed by `prompt_id`. CI sets `AI_PROVIDER=mock`. Production sets `AI_PROVIDER=anthropic`.

---

## 5. Model selection rules

Models are **locked at prompt definition**, never passed at the call site (C-4). Switching a prompt's model is a code change that bumps `version`.

| Use case | Model | Rationale |
|---|---|---|
| Brand-voice inference (Session 5A) | Opus 4.7 (`claude-opus-4-7`) | One-shot per customer; quality compounds across every later post; ~€0.05–0.15/customer one-time |
| Post generation (later) | Sonnet 4.6 (`claude-sonnet-4-6`) | High volume; default workhorse for creative output |
| Engagement sentiment classification (later) | Haiku 4.5 (`claude-haiku-4-5-20251001`) | Cheap classification |
| Campaign-objective parsing (later) | Haiku 4.5 | Short structured extraction |

`/lib/ai/models.ts` declares both the model IDs and the per-model token-cost rates as constants:

```typescript
export const MODELS = {
  OPUS_4_7:   { id: 'claude-opus-4-7',           inputCostPerMTok: 1500, outputCostPerMTok: 7500 },
  SONNET_4_6: { id: 'claude-sonnet-4-6',         inputCostPerMTok:  300, outputCostPerMTok: 1500 },
  HAIKU_4_5:  { id: 'claude-haiku-4-5-20251001', inputCostPerMTok:  100, outputCostPerMTok:  500 },
} as const

export type ModelKey = keyof typeof MODELS
```

(Cents per 1M tokens — placeholder rates; Builder confirms against current Anthropic pricing in Session 5B and locks them. Reviewer verifies the rate sheet matches Anthropic's published prices at the date of the Builder session.)

---

## 6. The runner — `runPrompt()`

Single chokepoint for every SDK call (C-2). Mandatory ordering:

```
1. Trial-cap check                  (C-1; fail → AiError 'quota_exceeded')
2. Per-business per-minute rate-limit check  (§9; fail → AiError 'rate_limited')
3. Assemble messages (system + cached context + user)
4. anthropic.messages.create()      (one retry on 429/5xx with 2s backoff; C-7)
5. Parse output (Zod via prompts[i].outputSchema; parse failure → AiError 'invalid_response')
6. Compute cost_cents from token counts × MODELS[key] rates (cache-read tokens weighted at 10%)
7. Insert ai_usage row              (success or failure path — always runs in finally)
8. Return parsed output
```

### Signature

```typescript
export interface Prompt<TInput, TOutput> {
  readonly id: string                 // stable identifier, e.g. 'brand-voice-inference'
  readonly version: number            // monotonically bumped on any prompt edit
  readonly modelKey: ModelKey         // locked at definition (C-4)
  readonly outputSchema: z.ZodType<TOutput>
  readonly buildSystemPrompt: (ctx: CustomerContext) => string
  readonly buildUserMessage: (input: TInput, ctx: CustomerContext) => string
}

export async function runPrompt<TInput, TOutput>(
  prompt: Prompt<TInput, TOutput>,
  context: CustomerContext,
  input: TInput,
): Promise<TOutput>
```

### Error path is still billable

If the SDK returns a 200 with a body the prompt's `outputSchema` rejects, the response is in the billing meter. `ai_usage` records `success=false`, `error_code='invalid_response'`, `input_tokens`/`output_tokens` from the SDK response. No retry (C-7).

If the SDK returns 4xx (invalid request), tokens may still be counted by Anthropic — record what the response body reports, default to 0 if absent. No retry.

If the SDK returns 429 or 5xx: one retry, 2s sleep, then fail. On final failure, record `success=false`, `error_code='rate_limit'` or `'provider_error'`, tokens 0.

If the local trial-cap or rate-limit check rejects the call, **no `ai_usage` row is written** (the SDK was never invoked; no cost was incurred). This matters for the Reviewer: a `quota_exceeded` AiError leaves no trace in `ai_usage`. If we later want to count rejected attempts, that is a separate table; do not pollute `ai_usage` with non-billable rows.

---

## 7. Trial-cap-first (Constraint C-1)

`runPrompt()` reads `context.trialState` (§8). If `trialState !== null` (i.e., customer is on trial) and the relevant counter is at zero, throw immediately:

```typescript
if (context.trialState && context.trialState.postsRemaining <= 0) {
  throw new AiError('quota_exceeded', 'Trial post-generation cap reached')
}
```

`runner.ts` does **not** re-query the database for trial state. The caller's `buildCustomerContext()` already fetched it via service-role. Single source of truth per request.

Per-prompt trial caps:

| Prompt | Counter consumed | Trial cap (from CLAUDE.md) |
|---|---|---|
| `brand-voice-inference` | dedicated counter on `trial_state.brand_voice_inference_attempts` (Builder adds column; see §13) | 3 attempts |
| `post-generation` | `trial_state.posts_generated_count` | 50 (CLAUDE.md) |
| `engagement-classification` | none — internal | — |
| `campaign-objective-parse` | `trial_state.campaigns_created_count` | 1 (CLAUDE.md) |

Each prompt declares which counter it consumes. `runPrompt()` reads the relevant field from `context.trialState` before the SDK call and increments the counter atomically (via existing trial-state RPCs in `/lib/db/`) **after** a successful response.

Paid plans: `context.trialState === null`, all caps bypassed.

---

## 8. `CustomerContext` shape

```typescript
export interface CustomerContext {
  business: Pick<
    BusinessRow,
    'id' | 'name' | 'industry' | 'description' | 'language' | 'website'
  >
  brandVoice: BrandVoiceRow | null
  recentCampaigns: Array<
    Pick<CampaignRow, 'id' | 'name' | 'objective' | 'status'>
  > // max 5, ORDER BY created_at DESC
  recentPostPerformance: Array<{
    platform: Platform
    topContent: string
    likes: number
    impressions: number
  }> // max 10, ORDER BY likes DESC
  trialState: {
    isTrial: boolean
    postsRemaining: number      // posts_generated_count cap minus current count
    campaignsRemaining: number  // campaigns_created_count cap minus current count
    brandVoiceAttemptsRemaining: number
  } | null // null = paid plan (caps bypassed)
}
```

### `buildCustomerContext(businessId)`

- Uses service-role client throughout (lazy `await import('@/lib/supabase/service')`).
- Reads `businesses`, `brand_voices`, last 5 `campaigns`, top 10 `post_metrics` rows joined to `posts.body` for the business.
- Reads `trial_state` to populate `trialState`. If no `trial_state` row exists for this business, the business is on a paid plan → `trialState = null`.
- Never accepts client-supplied data. Caller passes only `businessId`.

### Caller-side memoization (Decision E)

`runner.ts` does **not** memoize context. If a Server Action generates 5 posts in one user request, the caller is responsible for building the context once and reusing it. A `withContext()` helper is deferred to YAGNI.

---

## 9. Rate limiting

Per-business per-minute cap, enforced inside `runPrompt()` **after** the trial-cap check. Exact query (constant in `runner.ts`):

```sql
SELECT COUNT(*) FROM ai_usage
WHERE business_id = $1
  AND created_at > now() - interval '60 seconds';
```

If the count is `>= configuredLimit`, throw `AiError('rate_limited')`. No SDK call.

Per-prompt limits (configured via `config.ts`, defaults shown):

| Prompt | Per-business per-minute |
|---|---|
| `brand-voice-inference` | 10 |
| `post-generation` | 30 |
| `engagement-classification` | 60 |
| `campaign-objective-parse` | 10 |

The rate-limit query runs against the same `ai_usage` table that records successful billable calls. Locally rejected calls (`quota_exceeded`, `rate_limited` itself) are **not** in the table (see §6) — they do not consume the per-minute budget, which is the right behaviour: rejected attempts shouldn't compound into a longer lockout.

---

## 10. Prompt caching strategy

Anthropic prompt caching (`cache_control: { type: 'ephemeral' }`) is applied to the system prompt of any prompt whose system block exceeds 1024 tokens.

Message ordering (fixed by `runner.ts`):

1. **System** — stable, large (the prompt's `buildSystemPrompt(ctx)` output). Marked with `cache_control: { type: 'ephemeral' }` when over 1024 tokens.
2. **User message 1** — `CustomerContext` serialized as JSON. Appears after the system block so the system stays cacheable across calls within the same customer session.
3. **User message 2** — the prompt's `buildUserMessage(input, ctx)` output.

### Cost weighting for cache reads

Anthropic reports `cache_read_input_tokens` separately from `input_tokens` on cached calls. `runner.ts` computes cost as:

```
cost_cents = ceil(
    (input_tokens          × MODELS[key].inputCostPerMTok / 1_000_000)
  + (cache_read_input_tokens × MODELS[key].inputCostPerMTok / 1_000_000) × 0.10
  + (output_tokens         × MODELS[key].outputCostPerMTok / 1_000_000)
)
```

`ai_usage.input_tokens` stores the **raw total** (`input_tokens + cache_read_input_tokens`); the weighting is applied to `cost_cents` only. Cache savings are visible at the cost level, not the token level. A separate `cache_read_input_tokens` column on `ai_usage` is **not added in Phase 1** — when the admin UI needs cache-hit telemetry per call, Phase 2 adds it.

---

## 11. Brand-voice inference (Session 5A's consumer)

The first concrete prompt. Defined in `/lib/ai/prompts/brand-voice-inference.ts`.

### Inputs

- `businessId` (via `CustomerContext.business.id`)
- `writingExamples: string[]` — optional, user-pasted raw text (up to 5 examples, ≤5,000 chars total — enforced at the validation layer in `/lib/validation/`)
- `websiteText: string | null` — produced by `fetchWebsiteText()` (§12) if `business.website` is set; otherwise null

### Output schema

```typescript
const BrandVoiceInferredSchema = z.object({
  tone: z.array(z.string()).min(1).max(5),
  targetAudience: z.string().min(10).max(500),
  keywords: z.array(z.string()).min(3).max(20),
  avoidWords: z.array(z.string()).max(20),
  uniqueValueProp: z.string().min(20).max(500),
  competitors: z.array(z.string()).max(10),
})
```

### Flow

1. UI collects website URL (pre-filled from `businesses.website`) and optional writing examples.
2. Server Action calls `fetchWebsiteText(business.website)` if URL present → produces text or null on fetch failure.
3. Server Action calls `runPrompt(brandVoiceInferencePrompt, ctx, { writingExamples, websiteText })`.
4. Result returned to UI for user review/edit (not auto-persisted).
5. On user save, written to `brand_voices` with `inferred_from_url = business.website`.

### Cost estimate

~3K input tokens (system + serialized context + writing examples + website excerpt) + ~800 output tokens at Opus 4.7 rates ≈ €0.10–€0.15 per customer one-time. Cached system prompt on the second invocation by the same customer in the same session further reduces cost.

### Trial cap

3 attempts per business during trial (§7). After 3 attempts, the user falls back to manual entry of brand-voice fields.

---

## 12. Website fetcher — SSRF guard (Constraint C-6)

`/lib/ai/website-fetcher.ts` exports:

```typescript
export async function fetchWebsiteText(url: string): Promise<string | null>
```

Returns plain text (HTML stripped) or `null` on any failure (fetch error, blocked target, body too large, timeout). **Never throws** — brand-voice inference can proceed with `null`.

### Hard constraints (each one reviewer-testable)

| # | Rule | Reviewer test |
|---|---|---|
| F-1 | Scheme allow-list: `http:` and `https:` only | `file:///etc/passwd` → null |
| F-2 | Block loopback `127.0.0.0/8` | `http://127.0.0.1` → null |
| F-3 | Block IPv4 private `10.0.0.0/8` | `http://10.0.0.1` → null |
| F-4 | Block IPv4 private `172.16.0.0/12` | `http://172.20.0.1` → null |
| F-5 | Block IPv4 private `192.168.0.0/16` | `http://192.168.1.1` → null |
| F-6 | Block link-local `169.254.0.0/16` (incl. AWS/GCP metadata `169.254.169.254`) | `http://169.254.169.254` → null |
| F-7 | Block IPv6 loopback `::1` and IPv6 ULA `fc00::/7` | `http://[::1]` → null |
| F-8 | Resolve host to IP **before** request and check each address; reject if any resolved IP matches a blocked range | DNS-rebinding-style host → null |
| F-9 | Re-resolve destination on every redirect (max 2 redirects) | Redirect chain to `127.0.0.1` → null |
| F-10 | 5s connection + read timeout | Slow-loris host → null |
| F-11 | 500 KB response body cap (truncate-and-abort) | 1 MB body → null |
| F-12 | `User-Agent: SOSH-BrandVoice/1.0` header set | — |
| F-13 | No cookies sent or stored | — |
| F-14 | No authentication credentials in URL accepted (reject `http://user:pass@host/`) | `http://a:b@example.com` → null |

Implementation uses `node:dns` for resolution and `undici`'s `fetch` with a custom dispatcher that overrides connection target so the connect-time host matches the pre-resolved IP (eliminates the TOCTOU window between resolution and connection).

### After fetch

HTML → text via a small extraction step (strip `<script>`, `<style>`, comments; collapse whitespace; truncate to 50K chars before passing into the prompt to keep input-token cost predictable).

---

## 13. Schema impact on `trial_state`

A new column is required to enforce the brand-voice attempt cap (§7):

```
trial_state.brand_voice_inference_attempts  int NOT NULL DEFAULT 0
```

The Builder adds this column via a forward-only migration in Session 5B. RLS does not change. Existing rows backfill to 0. The cap (3) is a constant in `config.ts`, not a column.

This is the only schema change `/lib/ai/` requires. `ai_usage` already has every column the runner writes.

---

## 14. Error taxonomy

```typescript
export type AiErrorCode =
  | 'quota_exceeded'      // trial cap hit; no SDK call made
  | 'rate_limited'        // per-business per-minute cap hit; no SDK call made
  | 'invalid_response'    // SDK returned 200 but output failed Zod parse
  | 'provider_error'      // 5xx after retry
  | 'rate_limit'          // 429 after retry
  | 'timeout'             // SDK call exceeded timeout
  | 'fetch_failed'        // website-fetcher could not retrieve (used internally; surfaced only when caller asks)

export class AiError extends Error {
  constructor(public readonly code: AiErrorCode, message: string) { super(message) }
}
```

Mapping to user-facing copy is the UI's job; the i18n keys live under `errors.ai.*` in `/i18n/{en,pt,es}/common.json` (added by the Builder during Session 5A UI work). The AI layer never produces translated strings.

---

## 15. Internationalisation

- System prompts are **English only**.
- Output language is controlled by an explicit instruction inside `buildSystemPrompt`: `Respond in {language}.` where `language` is derived from `context.business.language`.
- Rationale: cheaper, more reliable than maintaining three translated system prompts; Claude is strong at multilingual output and the prompt engineer only maintains one canonical source.
- No fallback table for unsupported languages — `business.language` is constrained at the DB layer to `'en' | 'pt' | 'es'` (per CLAUDE.md), so the runner trusts the value.

---

## 16. Streaming (Decision A)

**Non-streaming only in Session 5.** Brand-voice inference is a single-shot request; the UI shows a spinner. Post generation in a later session will likely benefit from streaming-to-UI; at that point a `runPromptStreaming()` sibling will be added to `/lib/ai/runner.ts` with the same trial-cap-first, rate-limit, cost-accounting guarantees. Deferred.

---

## 17. Retry policy (Decision B, Constraint C-7)

- **One retry**, 2s sleep, on `429` or `5xx` only.
- **Never retry** on `invalid_response`, on any `4xx` other than `429`, or on timeout (a stuck request retried is two stuck requests).
- Retries are accounted for in `ai_usage` as a **single row** representing the final outcome — the retried call is not double-counted. Tokens recorded reflect the response that actually returned (typically the second attempt).

---

## 18. Testing strategy

- `runner.test.ts` injects `MockAnthropicClient` via `AI_PROVIDER=mock`. Fixtures keyed by `prompt_id` live in `lib/ai/__fixtures__/`.
- Each prompt has a unit test asserting (a) `id` and `version` are stable strings/numbers, (b) `outputSchema.parse(fixture)` succeeds, (c) `buildSystemPrompt` and `buildUserMessage` produce strings containing the expected `CustomerContext` fields.
- `website-fetcher.test.ts` verifies each row in the F-1 to F-14 table individually (one test per blocked range and per scheme).
- `runner.test.ts` covers: trial-cap-first ordering (mock denies before rate-limit query is made), rate-limit query, cost computation including cache-read weighting, retry on 429, no-retry on invalid response, `ai_usage` row written on every billable outcome.
- No live Anthropic calls in CI. Reviewer will check that `npx vitest run lib/ai` passes without `ANTHROPIC_API_KEY` set.

---

## 19. Observability

`/lib/ai/metrics.ts` exposes two read-only helpers:

```typescript
export async function getCostThisMonth(businessId: string): Promise<{ cents: number }>
export async function getCallVolumeLast24h(businessId: string): Promise<{ count: number }>
```

Both use the service-role client and query `ai_usage`. They are intended for the admin UI (built in a later session) and for the trial-experience banner that surfaces remaining quota. No alerting, no thresholds, no caps — read-only telemetry. Hard cost ceilings per business per month are explicitly **out of scope** for Phase 1 (Decision F); revisit after post-generation lands and real telemetry exists.

---

## 20. Configuration surface (`/lib/config.ts` additions)

The Builder adds these typed env vars to `lib/config.ts`. None are read directly elsewhere.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | — | SDK auth |
| `AI_PROVIDER` | no | `anthropic` | `'anthropic' \| 'mock'` |
| `AI_RATE_LIMIT_BRAND_VOICE_PER_MIN` | no | `10` | §9 |
| `AI_RATE_LIMIT_POST_GENERATION_PER_MIN` | no | `30` | §9 (used in later session) |
| `AI_TRIAL_BRAND_VOICE_ATTEMPTS` | no | `3` | §7 |
| `AI_WEBSITE_FETCH_TIMEOUT_MS` | no | `5000` | §12, F-10 |
| `AI_WEBSITE_FETCH_MAX_BYTES` | no | `512000` | §12, F-11 |

---

## 21. What this ADR does **not** decide

- The exact wording of `brandVoiceInferencePrompt.buildSystemPrompt`. Prompt copy is iterated empirically during Session 5B and tracked via `version` bumps.
- Whether `getCostThisMonth()` returns `cents` as an integer or a `Money` value object. Builder picks the simplest type that round-trips through `ai_usage.cost_cents`.
- UI copy and i18n key names for AI errors. Owned by Session 5A UI.
- Streaming runner (deferred — §16).
- Per-business monthly cost ceilings (deferred — §19).
- A separate `cache_read_input_tokens` column on `ai_usage` (deferred — §10).
- Extraction of `website-fetcher.ts` to a shared `/lib/scraping/` module (YAGNI, Decision C).

---

ADR 0003 complete. Architect session done.
