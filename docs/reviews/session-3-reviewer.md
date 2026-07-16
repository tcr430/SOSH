Session 3C — SocialProvider Review (Synthesized Report)                                                                       
                                                                                                                                
  Two independent agents reviewed in parallel. Both passed Section A (interface fidelity) and Section B (abstraction integrity)   cleanly. The bulk of findings concern naming drift, missing Zod validation, shallow redaction, and a constant-time comparison 
  miss in the health route.                                                                                                                                                                                                                                     
  Findings table                                                                                                                

  ┌──────┬────────────────────────────────────┬──────┬──────────────────────────┬──────────────────────────────────────────┐
  │ Sect │               Check                │ Stat │        File:Line         │                   Fix                    │    
  │ ion  │                                    │  us  │                          │                                          │    
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤    
  │ A    │ 7-method SocialProvider interface, │ ✅   │ lib/social/types.ts:114- │ —                                        │    
  │      │  signatures match ADR              │      │ 128                      │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │      │ Old method names (connect/disconne │      │                          │                                          │
  │ A    │ ct/testConnection/getCapabilities) │ ✅   │ —                        │ —                                        │
  │      │  absent                            │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ A    │ Platform union (5 platforms, no    │ ✅   │ lib/db/types.ts:27       │ —                                        │
  │      │ Reddit)                            │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ A    │ OAuthAuthorizeInput has 5 fields;  │ ⚠️    │ lib/social/types.ts:21-2 │ Document platform+state additions in ADR │
  │      │ ADR §2 specifies 3                 │      │ 7                        │  open follow-ups                         │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ A    │ TokenSet identity fields optional  │ ✅   │ lib/social/types.ts:40-4 │ —                                        │
  │      │                                    │      │ 2                        │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ A    │ SocialProviderError: single class, │ ✅   │ lib/social/errors.ts:6-2 │ —                                        │
  │      │  retryAfterSeconds, frozen details │      │ 9                        │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ A    │ All 8 error codes present as       │ ✅   │ lib/social/types.ts:7-15 │ —                                        │
  │      │ string-literal union               │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ B    │ No external imports of             │ ✅   │ —                        │ —                                        │
  │      │ postiz-provider / mock-provider    │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ B    │ Only public surface used           │ ✅   │ app/api/_health/social/r │ —                                        │
  │      │ externally (from '@/lib/social')   │      │ oute.ts:3                │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ C    │ vault.ts is shared module with     │ ✅   │ lib/social/vault.ts:14   │ —                                        │
  │      │ lazy service-role import           │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ C    │ readAccessToken checks is_active   │ ✅   │ lib/social/vault.ts:57   │ —                                        │
  │      │ and vault id                       │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ C    │ readRefreshToken does NOT check    │ ❌   │ lib/social/vault.ts:68-8 │ Add !account.is_active to the guard —    │
  │      │ is_active                          │      │ 3                        │ see Fix #2                               │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ C    │ In-place vault.update_secret on    │ ✅   │ lib/social/postiz-provid │ —                                        │
  │      │ refresh                            │      │ er.ts:211,218            │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ C    │ Tests cover skew at 299s and 301s  │ ✅   │ __tests__/vault.test.ts: │ —                                        │
  │      │                                    │      │ 187,213                  │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ C    │ Exact 300s boundary not tested     │ ❌   │ __tests__/vault.test.ts  │ Add boundary test (<= means 300s should  │
  │      │                                    │      │                          │ refresh)                                 │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │      │ signOAuthState/verifyOAuthState    │      │ oauth/state.ts:1,12,29-3 │                                          │
  │ D    │ use OAUTH_STATE_SECRET + jose      │ ✅   │ 1                        │ —                                        │
  │      │ HS256, 600s TTL                    │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ D    │ nonce uses Web Crypto instead of   │ ⚠️    │ oauth/state.ts:25        │ CSPRNG either way — align with ADR or    │
  │      │ node:crypto.randomBytes            │      │                          │ document                                 │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ D    │ Expired-token verification test    │ ❌   │ __tests__/oauth-state.te │ Add expired-exp test case                │
  │      │ missing                            │      │ st.ts                    │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ D    │ Malformed-JWT test covers only     │ ⚠️    │ __tests__/oauth-state.te │ Add zero-dot and two-segment cases       │
  │      │ 5-segment input                    │      │ st.ts:67                 │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ E    │ No console.* leaks of token-shaped │ ✅   │ —                        │ —                                        │
  │      │  variables                         │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ E    │ Tokens never embedded in error     │ ✅   │ —                        │ —                                        │
  │      │ messages                           │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ E    │ Authorization: Bearer always in    │ ✅   │ postiz-provider.ts:270-2 │ —                                        │
  │      │ headers, never URL                 │      │ 74                       │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ E    │ revokeAccessToken reads token then │ ✅   │ postiz-provider.ts:250-2 │ —                                        │
  │      │  discards                          │      │ 65                       │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │      │ SocialProviderError redaction is   │      │ lib/social/errors.ts:24- │ Recursively redact, or sanitize body     │
  │ E    │ shallow only — top-level keys      │ ❌   │ 29; sinks at postiz-prov │ before passing to                        │
  │      │                                    │      │ ider.ts:82,200,299       │ details.platform_message                 │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ E    │ Redaction test does not include    │ ❌   │ __tests__/errors.test.ts │ Add token_secret to test fixture and     │
  │      │ token_secret key                   │      │ :27-47                   │ assert redaction                         │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ E    │ refreshAccessToken returns raw     │ ⚠️    │ postiz-provider.ts:230-2 │ Tension with ADR §1 Reversal 1 — flag    │
  │      │ TokenSet on the public interface   │      │ 35                       │ for architecture review                  │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │      │ Env var named POSTIZ_API_URL       │      │ lib/config.ts:13;        │ Rename to POSTIZ_BASE_URL everywhere OR  │
  │ F    │ everywhere; ADR says               │ ❌   │ registry.ts:34,47,52;    │ amend ADR                                │
  │      │ POSTIZ_BASE_URL                    │      │ route.ts:31              │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │      │ Constructor throws                 │      │                          │                                          │
  │ F    │ PROVIDER_NOT_CONFIGURED on         │ ✅   │ postiz-provider.ts:29-43 │ —                                        │
  │      │ missing/invalid config; no I/O     │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ F    │ fetchPostMetrics/fetchEngagement   │ ✅   │ postiz-provider.ts:135-1 │ —                                        │
  │      │ throw NOT_IMPLEMENTED              │      │ 48                       │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │      │ HTTP→error code mapping (401/403,  │      │ postiz-provider.ts:278-2 │                                          │
  │ F    │ 429+Retry-After, 4xx, 5xx, fetch   │ ✅   │ 99,122-128               │ —                                        │
  │      │ fail)                              │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │      │ No Zod validation on Postiz        │      │ postiz-provider.ts:313-3 │ Define PostizCallbackResponse /          │
  │ F    │ responses — raw as casts           │ ❌   │ 25                       │ PostizRefreshResponse zod schemas;       │
  │      │                                    │      │                          │ .parse() before normalisation            │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │      │                                    │      │ (no lib/social/__integra │ Create guarded *.integration.test.ts     │
  │ F    │ Integration test directory missing │ ❌   │ tion__/)                 │ with describe.skipIf(!process.env.POSTIZ │
  │      │                                    │      │                          │ _INTEGRATION_TEST_ENABLED)               │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │      │ MockProvider implements 7 methods, │      │                          │                                          │
  │ G    │  FailureConfig, calls, reset(), no │ ✅   │ mock-provider.ts:21-144  │ —                                        │
  │      │  network                           │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ G    │ fetchPostMetrics returns full      │ ✅   │ mock-provider.ts:108-127 │ —                                        │
  │      │ object; fetchEngagement returns [] │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ H    │ Singleton memoised; selection rule │ ✅   │ registry.ts:22-54        │ —                                        │
  │      │  (mock → Postiz → mock+warn)       │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ H    │ register() persists; default       │ ✅   │ registry.ts:13-19        │ —                                        │
  │      │ fallback works                     │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ I    │ TOKEN_REFRESH_SKEW_SECONDS = 300 + │ ✅   │ constants.ts:1-33        │ —                                        │
  │      │  scope arrays                      │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │      │ OAUTH_STATE_SECRET declared with   │      │                          │                                          │
  │ I    │ .default("") (not required at      │ ⚠️    │ lib/config.ts:18         │ Switch to .min(32) to fail fast          │
  │      │ boot)                              │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ I    │ HEALTHCHECK_TOKEN,                 │ ✅   │ lib/config.ts:19-20      │ —                                        │
  │      │ SOCIAL_PROVIDER_MODE present       │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ J    │ No any in production files         │ ✅   │ —                        │ —                                        │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ J    │ SocialProviderErrorCode is literal │ ✅   │ types.ts:7-15            │ —                                        │
  │      │  union (not enum)                  │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ J    │ Unnecessary as casts in            │ ❌   │ postiz-provider.ts:315-3 │ Resolves with Zod fix (#3)               │
  │      │ normalizeTokenSet                  │      │ 23                       │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ J    │ Vault RPC casts after manual       │ ⚠️    │ vault.ts:35,48           │ Acceptable; could z.string().parse() for │
  │      │ guards                             │      │                          │  robustness                              │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ K    │ Production missing token → 404     │ ✅   │ route.ts:18-19           │ —                                        │
  │      │ with empty body                    │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ K    │ Response body excludes             │ ✅   │ route.ts:43-48           │ —                                        │
  │      │ secrets/stack traces               │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ K    │ Token comparison is !== (not       │ ❌   │ route.ts:18              │ Use crypto.timingSafeEqual on            │
  │      │ constant-time)                     │      │                          │ equal-length hashed buffers              │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ K    │ Empty HEALTHCHECK_TOKEN            │ ⚠️    │ route.ts:12-19           │ Behaviour correct; add explicit test     │
  │      │ short-circuits to 404              │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ L    │ formatISO/date-fns used in         │ ✅   │ —                        │ —                                        │
  │      │ production                         │      │                          │                                          │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │      │ process.env.NODE_ENV direct access │      │                          │ Route through /lib/config.ts (add        │
  │ L    │  in /lib/social/                   │ ❌   │ registry.ts:43           │ NODE_ENV to public schema or             │
  │      │                                    │      │                          │ isProduction getter)                     │
  ├──────┼────────────────────────────────────┼──────┼──────────────────────────┼──────────────────────────────────────────┤
  │ L    │ No stray console.log (console.warn │ ✅   │ registry.ts:51           │ —                                        │
  │      │  fallback is intentional)          │      │                          │                                          │
  └──────┴────────────────────────────────────┴──────┴──────────────────────────┴──────────────────────────────────────────┘

  ---
  ❌ Required fixes (numbered)

  1. POSTIZ_BASE_URL ↔ POSTIZ_API_URL naming. Pick one and apply across lib/config.ts:13, registry.ts:34/47/52,
  app/api/_health/social/route.ts:31. ADR-canonical name is POSTIZ_BASE_URL. If keeping POSTIZ_API_URL, update ADR §5/§8/§9/§11.  2. readRefreshToken missing is_active check at lib/social/vault.ts:68-83. Disconnected accounts can still leak refresh tokens.   Add !account.is_active to the guard, mirroring readAccessToken.
  3. No Zod validation on Postiz responses at postiz-provider.ts:313-325. Define schemas for callback and refresh response
  shapes; call .parse() and on failure throw SocialProviderError({ code: 'PLATFORM_REJECTED', ... }).
  4. Shallow redaction in SocialProviderError — details.platform_message: body at postiz-provider.ts:82,200,299 stores raw
  Postiz response objects. Either (a) make the constructor's redactor walk plain-object values recursively, or (b) sanitise body   at each call site with a helper that applies SENSITIVE_KEY_PATTERN to nested keys.
  5. Health-check timing oracle at app/api/_health/social/route.ts:18. Replace token !== expectedToken with
  crypto.timingSafeEqual on hashed equal-length buffers.
  6. process.env.NODE_ENV direct access at lib/social/registry.ts:43. Add NODE_ENV (or isProduction) to lib/config.ts and
  reference it instead.
  7. Missing test: verifyOAuthState rejects expired tokens in __tests__/oauth-state.test.ts. Sign a JWT with past exp and assert   it throws.
  8. Missing test: 300s exact-boundary refresh in __tests__/vault.test.ts. Boundary uses <= so 300s should refresh; current
  tests only cover 299s/301s.
  9. Missing redaction-test coverage for token_secret key in __tests__/errors.test.ts. Add it to the fixture and assert
  '[REDACTED]'.
  10. Missing integration test directory lib/social/__integration__/. Create at minimum a guarded placeholder
  postiz-provider.integration.test.ts with describe.skipIf(!process.env.POSTIZ_INTEGRATION_TEST_ENABLED).

  ⚠️  Recommendations (numbered)

  A. OAuthAuthorizeInput has platform and state not in ADR §2. Builder elaborations are reasonable; document in ADR open
  follow-ups.

  B. OAUTH_STATE_SECRET: z.string().default("") at lib/config.ts:18. Switch to .min(32) to fail fast at boot.

  C. nonce uses Web Crypto, ADR specifies node:crypto.randomBytes at oauth/state.ts:25. Cryptographically equivalent; align or
  document.

  D. Malformed-JWT test only covers 5-segment input at __tests__/oauth-state.test.ts:67. Add zero-segment and two-segment cases.
  E. refreshAccessToken returns raw TokenSet on the public interface — tension with ADR §1 Reversal 1. Internal-only consumption   pattern; consider Promise<void> if no external caller actually needs the value.

  F. Vault RPC as casts at vault.ts:35,48. Acceptable after manual guards; tighten with z.string().parse() if desired.

  G. Empty HEALTHCHECK_TOKEN 404 behaviour is correct but untested. Add explicit test so guard-order regressions are caught.

  H. registry.ts:51 console.warn fallback is intentional but write production-boot guard (mentioned in ADR §9) — Builder should
  add an explicit prod-env check that throws when mock fallback is active.

  ---
  Verdict

  Blockers before Session 4 (publishing worker)

  1. Fix #1 (POSTIZ_BASE_URL naming) — Session 4 worker reads from config; needs the canonical name pinned.
  2. Fix #2 (readRefreshToken is_active check) — worker calls withFreshToken which depends on this; revoked-account behaviour is   currently broken.
  3. Fix #3 (Zod on Postiz responses) — worker depends on PublishResult/TokenSet being trustworthy; silent undefined as string
  in Vault is a data-corruption risk.
  4. Fix #6 (NODE_ENV via config) — convention violation that compounds if more files copy the pattern.

  Blockers before first user

  5. Fix #4 (recursive redaction) — high-likelihood production log leak the moment Postiz returns an error body containing
  token-shaped fields.
  6. Fix #5 (constant-time health check) — exposed in production with HEALTHCHECK_TOKEN set; remediate before public deploy.
  7. Fix #7, #8, #9 (missing tests) — coverage gaps on security-critical paths; required to trust the redaction and OAuth state
  invariants.

  Acceptable to defer

  - Fix #10 (integration test scaffold) — placeholder file is enough; real integration tests can wait until Postiz instance is
  provisioned.
  - All ⚠️  recommendations except B (OAUTH_STATE_SECRET.min(32)) — that one is cheap and worth doing alongside Fix #1.
  - Recommendation E (refreshAccessToken return type) — log as ADR follow-up, do not refactor mid-phase.

  Net assessment: Foundation is sound. Interface fidelity (A) and abstraction integrity (B) — the two hardest things to retrofit   — are clean. Remaining work is concentrated in three buckets: a single env-var rename, response-validation hardening, and
  small test gaps. A correction pass (Session 3-D) of ~1–2 hours should clear all Session 4 blockers.