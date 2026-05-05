# Current Phase

**Phase:** 1 — MVP
**Goal:** First paying customer
**Status:** Session 3B complete — Session 3C (Reviewer) pending

## What's done
- Session 0: Environment setup complete
- Session 1: Next.js 16 initialized, Tailwind, shadcn/ui,
  next-intl (EN/PT/ES), Supabase clients, typed config
- Session 2A: Database schema ADR complete and approved
  (docs/decisions/0001-database-schema.md)
- Session 2B: All 23 database migrations authored
  (supabase/migrations/ 001–013 base + 014–015 placeholders + 016–023 fixes)
- Session 2C: Reviewer audit — database schema and security review passed
- Session 2D: All lib/db/ query modules complete with full TypeScript types
  (businesses, brand-voices, campaigns, posts, post-metrics, social-accounts,
  engagement, trial-state, ai-usage)
- Session 2E: Final correction pass — all warnings resolved
  - Test suite: 96/96 passing; tsc --noEmit clean
- Session 3A: SocialProvider ADR authored (docs/decisions/0002-social-provider.md)
- Session 3B: Full SocialProvider abstraction implemented (/lib/social/)
  - types.ts — SocialProvider interface + all OAuth/token types
  - errors.ts — SocialProviderError with typed error codes
  - constants.ts — Required OAuth scopes per platform
  - vault.ts — readAccessToken, readRefreshToken, withFreshToken (service-role)
  - oauth/state.ts — signOAuthState / verifyOAuthState (HMAC-SHA256 JWT)
  - mock-provider.ts — MockProvider with configurable failure injection
  - postiz-provider.ts — PostizProvider (Postiz API wrapper)
  - registry.ts — getRegistry() singleton; SOCIAL_PROVIDER=mock for tests
  - index.ts — single public export surface for all consumers
  - ESLint rule: no direct imports of postiz-provider or mock-provider outside lib/social/
  - Migration 24: vault RPC helpers (vault_create_secret, vault_update_secret, vault_delete_secret)
  - Test suite: 66/66 passing (7 test files in lib/social); full suite 162/162
  - lib/social/types.test.ts — type-level assertions for all exported types
  - app/api/_health/social/route.ts — health check endpoint (HEALTHCHECK_TOKEN gated)
  - HEALTHCHECK_TOKEN added to /lib/config.ts as optional server var
  - vitest.config.ts: testTimeout bumped to 15000ms (vault module-reset slowness)

## What's in progress
- Session 3C: Reviewer session (Opus 4.7) — not yet run
  Use primer from docs/build-guide/session-3.md Part C

## What's next
- Session 3C: Run reviewer (Opus 4.7) + parallel typescript-reviewer + security-reviewer
- Session 3D: Correction pass (if reviewer finds issues — expected)
- Session 4: Authentication & Onboarding Foundation
  - Supabase Auth integration (email + magic link)
  - Signup flow with work-email validation
  - Business creation on first login
  - Trial state initialization
  - Protected route middleware

## Key decisions (Session 3B)
- SocialProvider abstraction enforced at ESLint level (no-restricted-imports rule)
- Vault access is always service-role; lib/social/ layer owns all vault I/O
- MockProvider injected via SOCIAL_PROVIDER env var (no test-only DI plumbing)
- OAuth state signed as HMAC-SHA256 JWT (stateless, no DB round-trip)
- Vault helpers exposed as Supabase RPC (not direct vault.secrets writes)

## Open gotchas
- ECC commands use /everything-claude-code: prefix not /ecc:
- `npx vitest run lib/` picks up ECC tests that call process.exit(); always use
  `npx vitest run lib/db lib/social` for SOSH-only test runs
- npm run db:migrate requires Docker (local) or network access (remote Supabase);
  migrations are authored and verified structurally but not yet applied to a live DB
- Migration 24 vault helpers not yet applied to live Supabase project (awaiting db:migrate)
