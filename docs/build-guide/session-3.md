# Session 3 — The SocialProvider Abstraction

> **Goal:** Build the abstraction that decouples SŌSH from any specific social platform. Postiz is the only implementation at launch. Future native providers plug in without touching business logic.
> **Time:** 3–5 hours including correction pass
> **Models:** Architect (Opus 4.7) → Builder (Sonnet 4.6) → Reviewer (Opus 4.7) → optional Correction (Sonnet 4.6)
> **Session structure:** Three separate Claude Code sessions with `/exit` between each. Plus an expected correction pass (Session 3D) after the reviewer surfaces issues.

---

## Why three sessions remain mandatory here

Session 2 demonstrated this pattern works — the reviewer surfaced 8 high-severity issues that single-session work would have shipped. SocialProvider is the same level of consequential. If wrong, every social feature is wrong. Three sessions, mandatory pause after Architect.

---

## Pre-session checklist

- [ ] Session 2 fully complete — all reviewer findings resolved through corrections (2D, 2E)
- [ ] All 9 tables visible in Supabase Table Editor
- [ ] `npx vitest run` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `/lib/supabase/service.ts` exists with `createServiceRoleClient()` and `serverOnly()` guard
- [ ] `current-phase.md` reflects Session 2 closure
- [ ] You skimmed https://docs.postiz.com (10 min) — what you're integrating with

---

## Part A — Architect Session (Opus 4.7)

### How to run

1. `claude` in terminal
2. `/model` → **Claude Opus 4.7**
3. Paste Primer
4. List planned decisions, wait for approval
5. Paste Architect Prompt
6. **Type one confirmation line and `/exit`** — the Architect's last action

### Primer

```
Read CLAUDE.md, /docs/current-phase.md, AGENTS.md,
/docs/decisions/0001-database-schema.md.
Skim /lib/db/social-accounts.ts and /lib/db/types.ts so 
you know what already exists.

Session 3 Part A — SocialProvider Architecture. Architect role.

ARCHITECT BOUNDARY (strict, learned from Session 2):
- Your only output is /docs/decisions/0002-social-provider.md
- No SQL files. No TypeScript files. No code beyond TypeScript 
  interface signatures inside the markdown document.
- Your last action is a single confirmation line. Then I /exit.
- Do not attempt to "kick off" the Builder.

Use the architect ECC agent mindset:
1. List your key design decisions and any ambiguities
2. Wait for me to approve / override / clarify
3. Only then write the document
4. Call out any reversals of earlier decisions explicitly so 
   they don't get buried in the ADR (Session 2 had the Vault 
   reversal and the engagement inbox inclusion — flag these 
   types of changes prominently)

Acknowledge, list your planned decisions, wait for my approval.
```

### Architect Prompt (after you approve their decision list)

> **Note:** This prompt incorporates the decisions confirmed during the actual Session 3A run. The Architect's decision list was approved with the specific answers below. These are locked — do not re-open them.

```
Design the SocialProvider abstraction for SŌSH. Save as 
/docs/decisions/0002-social-provider.md

The following decisions are already confirmed. Design to these 
exactly — do not re-propose alternatives.

CONFIRMED DECISIONS

Interface methods (flat, no sub-interfaces):
- publish(input): Promise<PublishResult>
- fetchPostMetrics(input): Promise<PostMetrics | null> — STUB in PostizProvider (throws NotImplementedError)
- fetchEngagement(input): Promise<EngagementItem[]> — STUB in PostizProvider (throws NotImplementedError)
- getOAuthAuthorizeUrl(input): string
- exchangeOAuthCode(input): Promise<TokenSet>
- refreshAccessToken(input): Promise<TokenSet>
- revokeAccessToken(input): Promise<void>

Provider scope:
- Phase 1: single PostizProvider handles all 5 platforms
- Dispatch table (get(platform)) exists for Phase 2 native providers
- get(platform) always returns PostizProvider in Phase 1 — no routing logic yet

PostizProvider implements:
- getOAuthAuthorizeUrl, exchangeOAuthCode, refreshAccessToken, 
  revokeAccessToken, publish
- fetchPostMetrics and fetchEngagement: throw NotImplementedError
- MockProvider: implements all 7 methods with synthetic success responses

Token handling:
- Provider methods accept socialAccountId, NOT raw tokens
- Provider reads vault.decrypted_secrets internally via lazy-imported 
  createServiceRoleClient() — raw tokens never leave /lib/social/
REVERSAL (flag prominently in ADR): earlier sketches passed raw tokens 
into provider methods. Reversed — provider owns the vault read. 
Rationale: matches CLAUDE.md rule that rest of codebase sees only 
opaque vault IDs.

OAuth flow:
- /lib/social/oauth/ holds platform-agnostic state token 
  generation/verification
- State token: signed JWT using OAUTH_STATE_SECRET env var 
  (NOT the Supabase JWT secret — separate concerns, separate 
  rotation schedules). Short-TTL, includes business_id, platform, nonce.
- OAuth callback contract is documented in this ADR (request shape, 
  vault write sequence, social_accounts insert, error cases) 
  but the actual route is NOT written here — that is Part B Builder work

Token refresh:
- Lazy refresh: before any call needing a valid token, check 
  token_expires_at; if within 5-minute skew window, refresh in place
- No background refresh worker in Phase 1
- Concurrent refresh race: accepted as low-risk, documented as 
  Phase 2 tech debt with note: "consider distributed lock if volume 
  becomes a problem"

Error model — discriminated union SocialProviderError with codes:
TOKEN_EXPIRED, TOKEN_REVOKED, RATE_LIMITED (includes retry_after_seconds, 
surfaced to caller — provider does NOT absorb internally), 
PLATFORM_REJECTED, NETWORK, NOT_IMPLEMENTED, PROVIDER_NOT_CONFIGURED 
(thrown by constructor when POSTIZ_BASE_URL or POSTIZ_API_KEY missing), 
UNKNOWN

Configuration — add to /lib/config.ts as required server-only vars:
POSTIZ_BASE_URL, POSTIZ_API_KEY, OAUTH_STATE_SECRET

Out of scope for this ADR:
- Publishing worker / Vercel Cron wiring
- Metrics worker implementation
- Engagement webhook ingestion endpoint
- Per-platform character limits / media validation
- Image upload pipeline (Phase 2)

The design document must cover:

1. REVERSALS SECTION (top of document, prominent)
   The raw-token reversal described above. Any others you identify.

2. CORE INTERFACE
   SocialProvider TypeScript interface with all 7 methods above.
   Include full input/output type signatures as inline code blocks.

3. SUPPORTING TYPES
   - Platform: string literal union matching DB CHECK 
     (linkedin | twitter | instagram | facebook | threads)
   - PublishInput, PublishResult (platformPostId, publishedAt, url?)
   - PostMetrics: every metric nullable (null = not exposed, not zero)
   - EngagementItem shape
   - TokenSet, OAuthAuthorizeInput, ExchangeCodeInput
   - SocialProviderError discriminated union with all codes above

4. PROVIDER REGISTRY
   - ProviderRegistry interface: get(platform), register(platform, provider)
   - Single default provider pattern
   - Per-platform override map for Phase 2

5. POSTIZ PROVIDER SPECIFICATION
   - Which methods are implemented vs stubbed
   - For each implemented method: which Postiz API endpoint(s) 
     it maps to (reference real Postiz docs where possible)
   - Constructor throws PROVIDER_NOT_CONFIGURED if env vars missing
   - Vault read pattern: lazy-import createServiceRoleClient(), 
     read from vault.decrypted_secrets view

6. MOCK PROVIDER SPECIFICATION
   - Implements all 7 methods with synthetic success responses
   - Constructor accepts FailureConfig: { platform?, errorCode }
   - Zero network calls
   - Used in all tests and in dev when POSTIZ_BASE_URL unset

7. OAUTH FLOW CONTRACT
   Document (not implement) the callback route contract:
   - Request shape (state param, code param)
   - Validation sequence (verify JWT state, extract business_id/platform)
   - On success: vault.create_secret for access + refresh tokens, 
     insert social_accounts row with vault IDs
   - On failure: error codes and redirect targets
   - Why OAUTH_STATE_SECRET is separate from Supabase JWT secret

8. TOKEN REFRESH LIFECYCLE
   - Lazy refresh logic and 5-minute skew window
   - In-place Vault secret update (update_secret, not create new)
   - token_expires_at bump on social_accounts row
   - Concurrent refresh race: documented acceptance and Phase 2 plan

9. SINGLETON FACTORY
   getRegistry() in /lib/social/index.ts:
   - POSTIZ_BASE_URL set → PostizProvider as default
   - POSTIZ_BASE_URL unset → MockProvider as default
   - Memoized singleton
   - ONLY public import surface from /lib/social/

10. FUTURE NATIVE PROVIDER PROOF
    Show how LinkedInNativeProvider would implement the same 7 methods 
    using LinkedIn's native API. Proves interface holds without Postiz 
    semantics leaking.

11. TESTING STRATEGY (documented, not implemented)
    - Unit tests against MockProvider
    - PostizProvider tests use fake fetch / msw — no live Postiz in CI
    - Integration tests gated on POSTIZ_BASE_URL being set

Save as /docs/decisions/0002-social-provider.md.

CRITICAL — ARCHITECT BOUNDARY:
- Do NOT create any .ts files
- Do NOT create any .sql files
- Do NOT run any commands
- Do NOT install any packages
- TypeScript signatures appear as code blocks INSIDE the markdown only
- If you find yourself about to create a file or run a command, 
  stop and output only: "Stopping — architect boundary."
After saving the markdown, write exactly one line:
"ADR 0002 complete. Architect session done."
Then stop. Do nothing else. Do not suggest next steps.
```

### After Part A

- [ ] `/docs/decisions/0002-social-provider.md` exists
- [ ] Reversals section at the top (raw-token reversal flagged)
- [ ] All 7 interface methods defined with correct names (`publish` not `publishPost`)
- [ ] `fetchPostMetrics` and `fetchEngagement` marked as stubs
- [ ] `PROVIDER_NOT_CONFIGURED` code in error taxonomy
- [ ] `retry_after_seconds` surfaced on `RATE_LIMITED` (not absorbed)
- [ ] OAuth state token uses `OAUTH_STATE_SECRET` (not Supabase JWT secret)
- [ ] Vault read uses lazy-import `createServiceRoleClient()`
- [ ] Singleton factory pattern documented
- [ ] Future native provider proof included
- [ ] Architect did NOT write any `.ts` or `.sql` files
- [ ] Architect's final line was the confirmation phrase

```
git add docs/decisions/0002-social-provider.md
git commit -m "Session 3A: SocialProvider design"
git push
```

**→ Paste the ADR to Claude.ai. Mandatory pause. Do NOT start Part B without sign-off.**

---

## Part B — Builder Session (Sonnet 4.6)

> Wait for Claude.ai to confirm the ADR before starting.

### Primer

```
Read CLAUDE.md, /docs/current-phase.md, AGENTS.md,
/docs/decisions/0002-social-provider.md.
List the contents of /lib/social/ and /lib/supabase/ so 
you know what exists.

Session 3 Part B — SocialProvider Implementation. Builder role.

The ADR is your single source of truth. It overrides anything 
in this primer or earlier discussion.

ECC workflow (use the prefix /everything-claude-code: not /ecc:):
- /everything-claude-code:plan before each prompt
- /everything-claude-code:tdd for all TypeScript
- /everything-claude-code:verify after each prompt — do not 
  proceed if it fails
- Stop and ask if anything in the ADR is ambiguous — do not 
  invent

Patterns from CLAUDE.md to follow strictly:
- No code outside /lib/social/ imports postiz-provider or 
  mock-provider directly. /lib/social/index.ts is the only 
  public import surface.
- Tokens are read from Vault using lazy-imported 
  createServiceRoleClient() — never store raw tokens
- All list functions have limit parameters with defaults
- All list functions have explicit ORDER BY
- Use formatISO() from date-fns for timestamps, not 
  new Date().toISOString()

Confirm:
1. You've read the ADR
2. List the files you'll create in /lib/social/
3. Confirm the public import surface pattern
Then wait for Prompt 1.
```

### Builder Prompt 1 — Types and errors

```
/everything-claude-code:plan "Create SocialProvider type system 
and error hierarchy"

Following TDD:

Step 1: Create /lib/social/types.ts with all types from the ADR.
Pure types only — no logic, no imports of runtime code. 
Includes Platform, PostContent, PublishResult, MetricsResult, 
ConnectionResult, TokenRefreshResult, ConnectionStatus, 
PlatformCapabilities.

Step 2: Create /lib/social/errors.ts with the error class 
hierarchy. Each class has code: string literal type, 
optional cause?: Error. Specific fields per the ADR 
(e.g. RateLimitedError.retryAfterMs, ContentRejectedError.reason).

Step 3: Create /lib/social/provider.ts with the SocialProvider 
interface. Imports from types.ts and errors.ts.

Step 4: Create /lib/social/types.test.ts with type-level 
assertions confirming the shapes are correct (no any leakage, 
all required fields present).

Run npx tsc --noEmit — must be zero errors.

/everything-claude-code:verify
```

### Builder Prompt 2 — MockProvider

```
/everything-claude-code:tdd "MockProvider implementing 
SocialProvider for tests and dev"

Create /lib/social/mock-provider.ts:
- Implements SocialProvider fully
- Constructor accepts optional FailureConfig
- All methods return synthetic successful results by default
- publish() returns { platformPostId: 'mock_post_<random>', 
  publishedAt: new Date(), url: undefined }
- getPostMetrics() returns randomized realistic metrics
- getCapabilities() returns full capabilities for all platforms
- No network calls — verify by reviewing the code, no fetch 
  or external imports

Create /lib/social/mock-provider.test.ts covering:
- Default success for each method on each platform
- Failure config triggers correctly per platform
- testConnection returns ok by default, error when configured
- All 5 launch platforms supported

Run npx vitest run — all tests must pass.

/everything-claude-code:verify
```

### Builder Prompt 3 — PostizProvider

```
/everything-claude-code:tdd "PostizProvider via Postiz API 
with Vault token integration"

Create /lib/social/postiz-provider.ts:
- Implements SocialProvider
- Reads POSTIZ_API_URL and POSTIZ_API_KEY from /lib/config.ts
- Constructor throws ProviderNotConfiguredError if either missing
- All HTTP calls use native fetch (no axios)
- Validates Postiz responses with Zod before returning
- Maps Postiz HTTP errors to our taxonomy:
  401 → AuthExpiredError
  429 → RateLimitedError (parse Retry-After header → retryAfterMs)
  4xx other → ContentRejectedError with reason from response body
  5xx → PlatformDownError
  Network failure → NetworkError
- For methods needing tokens, uses lazy-imported 
  createServiceRoleClient() to read from vault.decrypted_secrets 
  view (per ADR 0002 Vault integration section)
- Never logs tokens, headers containing tokens, or sensitive 
  request bodies
- Never returns tokens in error messages

Create /lib/social/postiz-provider.test.ts:
- Mark integration tests with .skipIf(!process.env.POSTIZ_API_URL)
- Unit tests use mocked fetch and verify error mapping
- Test that error messages don't contain token strings
- Test that constructor throws when env vars missing

Run npx vitest run — all unit tests pass, integration tests 
skipped in dev.

/everything-claude-code:verify
```

### Builder Prompt 4 — Registry, index, and consumer guard

```
/everything-claude-code:plan "Provider registry and public 
import surface"

Create /lib/social/registry.ts:
- ProviderRegistry class implementing the ADR interface
- Constructor takes defaultProvider: SocialProvider
- get(platform): returns override if registered, else default
- register(platform, provider): sets override
- Test: /lib/social/registry.test.ts

Create /lib/social/index.ts — the ONLY public import surface:
- Re-exports types from types.ts
- Re-exports error classes from errors.ts
- Re-exports SocialProvider interface from provider.ts
- Exports getRegistry() singleton factory:
  · If POSTIZ_API_URL set: registry with PostizProvider default
  · If unset: registry with MockProvider default
  · Memoized — same registry returned across calls in same 
    process
- Does NOT export PostizProvider or MockProvider directly

After creating these, search the codebase for any import 
of 'postiz-provider' or 'mock-provider' from outside 
/lib/social/. There should be zero hits. Report findings.

/everything-claude-code:verify
```

### Builder Prompt 5 — Health check route

```
Create /app/api/_health/social/route.ts (GET):
- Only accessible if NODE_ENV === 'development' OR
  request header 'x-healthcheck-token' matches 
  config.server.HEALTHCHECK_TOKEN (otherwise 404)
- Calls getRegistry() from /lib/social/index.ts
- Calls testConnection on the default provider
- Returns: { provider: string, status: 'ok'|'error', 
  platform_count: number, env: string }
- Never includes tokens, env vars, or internal error 
  details in response

Add HEALTHCHECK_TOKEN as optional server-only var to 
/lib/config.ts.

Test it: npm run dev → curl http://localhost:3000/api/_health/social
With MockProvider active: 
{ provider: 'mock', status: 'ok', platform_count: 5, 
  env: 'development' }

In production without HEALTHCHECK_TOKEN: 404.

/everything-claude-code:verify
```

### Builder Prompt 6 — Update current-phase

```
Update /docs/current-phase.md:
- Add Session 3B to "What's done"
- Update "What's in progress" to Session 3C (Reviewer)
- Add any decisions made during the build (e.g. specific 
  Postiz endpoints chosen, error mapping nuances)
- Add any open gotchas discovered

Also update CLAUDE.md if any pattern emerged that future 
sessions should know about.
```

### Part B Test Checklist

- [ ] Files in `/lib/social/`: types.ts, errors.ts, provider.ts, mock-provider.ts, postiz-provider.ts, registry.ts, index.ts (plus all `.test.ts`)
- [ ] `npx tsc --noEmit` passes
- [ ] `npx vitest run` passes
- [ ] Health check returns `{ provider: 'mock', status: 'ok' }` when POSTIZ_API_URL unset
- [ ] Zero imports of `postiz-provider` or `mock-provider` outside `/lib/social/`
- [ ] No raw tokens in any string anywhere

```
git add .
git commit -m "Session 3B: SocialProvider implementation"
git push
```

`/exit` Claude Code.

---

## Part C — Reviewer Session (Opus 4.7)

### Primer

```
Read CLAUDE.md, /docs/current-phase.md, AGENTS.md,
/docs/decisions/0002-social-provider.md.
Read every file in /lib/social/ and the health check route.

Session 3 Part C — SocialProvider Review.

You will run typescript-reviewer and security-reviewer ECC 
agents in parallel, then synthesize into one report.

Independent review. You did not write this code. Do not 
modify any files. Report only.

Acknowledge when ready.
```

### Reviewer Prompt

```
Run /everything-claude-code:typescript-reviewer and 
/everything-claude-code:security-reviewer in parallel. 
Synthesize one structured report.

SECTION A — INTERFACE FIDELITY
- All 7 SocialProvider methods present with correct signatures?
- All types from ADR implemented?
- Error hierarchy matches ADR exactly?
- PlatformCapabilities includes all required fields?
- No deviations from ADR? Any deviation = ⚠️

SECTION B — ABSTRACTION INTEGRITY (most critical)
Search the entire codebase (excluding /lib/social/ itself):
- Any import of postiz-provider? (❌ if found)
- Any import of mock-provider? (❌ if found)  
- Any import from /lib/social/<anything>.ts that is not index.ts? 
  (❌ if found)
Report every result with file path.

SECTION C — VAULT INTEGRATION
- Does PostizProvider use createServiceRoleClient with lazy import?
- Is the service-role client only used for vault reads, never 
  exposed beyond the function that needs it?
- Token refresh updates secrets in place (not create new)?
- Disconnect coordinates vault secret deletion correctly?

SECTION D — TOKEN SAFETY (security-reviewer)
- Are tokens ever logged? (search for console.log, console.error 
  near token usage)
- Are tokens ever included in error messages? (search error 
  construction sites)
- Are tokens ever returned in API responses or thrown error 
  bodies?
- Headers containing tokens redacted in logs?

SECTION E — POSTIZ PROVIDER
- Postiz API key only sent via Authorization header (not URL)?
- Zod validation on every Postiz response before returning data?
- All HTTP error codes mapped to our taxonomy?
- Constructor throws on missing config (fail fast)?
- 5xx responses don't leak Postiz internals?

SECTION F — MOCK PROVIDER
- Implements SocialProvider fully without type casting?
- Failure config triggers per-platform errors correctly?
- Zero network calls (verify code review, not just tests)?

SECTION G — REGISTRY AND FACTORY
- Singleton memoization correct (same registry returned)?
- MockProvider used in dev/test, PostizProvider in production?
- register() override works without modifying the singleton 
  module?

SECTION H — TYPESCRIPT QUALITY (typescript-reviewer)
- Any 'any' types in /lib/social/? (CLAUDE.md: forbidden)
- All errors properly typed with code as string literal?
- No type casting (as) where a discriminated union would work?
- Test files use proper Vitest patterns?

SECTION I — HEALTH CHECK SECURITY
- Production path without HEALTHCHECK_TOKEN returns 404 (not 
  401, not 403, not error response)?
- Response body never includes env vars or tokens?
- Token comparison uses constant-time compare? (If not, ⚠️)

SECTION J — CONVENTIONS
- date-fns for timestamps, not new Date().toISOString()?
- No process.env outside config.ts?
- No console.log left behind?
- Comments explain non-obvious decisions?

Report format: markdown table 
(Section / Check / Status ✅❌⚠️ / File:Line / Recommended fix)
After table: every ❌ with exact fix instructions
After that: every ⚠️ with recommendation

Add a final "Verdict" section listing:
- Blockers before Session 4
- Blockers before first user
- Tech debt acceptable to defer
```

### After Part C

```
git add .
git commit -m "Session 3C: SocialProvider review complete"
git push
```

`/exit` Claude Code.

**Paste the full report to Claude.ai.** I'll evaluate severity and write the correction prompts for Session 3D if needed.

---

## Part D — Correction Pass (only if reviewer finds issues)

> If the reviewer reports zero ❌ and only minor ⚠️, skip to Report Back.

This pass mirrors Session 2D/2E. Fresh Sonnet session, fix what's listed, nothing more.

When you paste the reviewer report to Claude.ai, I'll send back batched correction prompts grouped by severity. You run them, verify, commit:

```
git add .
git commit -m "Session 3D: Correction pass after review"
git push
```

---

## Report Back to Claude.ai

```
Session 3 complete.

Files in /lib/social/: [list]
Tests passing: [yes/no — paste vitest summary]
Health check returns: [paste JSON]
Abstraction leaks: [count of imports outside /lib/social/]

Reviewer report:
[paste full report]

Correction pass needed: [yes/no]
Remaining ❌: [list or "none"]
⚠️ deferred: [list or "none"]

Repo: [GitHub URL]
```

---

## Common gotchas

**Postiz isn't running** — expected. MockProvider is your default in dev. Don't install Postiz yet.

**Abstraction leak in routes** — if you ever see Server Components or Server Actions importing `postiz-provider` directly, that's a CLAUDE.md violation. Fix immediately.

**Token in error message** — easy to introduce, hard to spot. The reviewer specifically checks for this. If you find one in production code, treat as a security incident.

**Circular imports types ↔ provider** — keep types.ts as pure types only. provider.ts imports from types.ts but never vice versa.

**Vault RPC name** — Supabase Vault RPC names can vary by version. If `vault_delete_secret` doesn't exist, check `vault.delete_secret` or use the SQL function directly via `client.rpc(...)`.

**Architect tries to build** — if it happens (it did in Session 2), stop immediately, paste "Stop. Architect role only. Confirm and exit." then `/exit` and start fresh Builder.
