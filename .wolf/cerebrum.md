# Cerebrum

> OpenWolf's learning memory. Updated automatically as the AI learns from interactions.
> Do not edit manually unless correcting an error.
> Last updated: 2026-04-29

## User Preferences

<!-- How the user likes things done. Code style, tools, patterns, communication. -->

## Key Learnings

- **updateSession() return shape:** `lib/supabase/middleware.ts` was updated to return `{ response, user }` (previously just `response`). Any code importing `updateSession` must destructure accordingly.
- **VaultSecretId branded type:** `vault_access_token_id` and `vault_refresh_token_id` on `SocialAccountRow`/`SocialAccountInsert` are now `VaultSecretId`, not plain `string`. Test fixtures and callers must cast: `'vault-uuid' as VaultSecretId`.
- **TrialStatePublicRow:** `getTrialState()` returns `TrialStatePublicRow` (omits `trial_card_fingerprint`). Use `getTrialStateForBilling()` (service-role) for the full row.
- **SocialProvider abstraction:** All social platform code lives in `/lib/social/`. Consumers import only from `/lib/social/index.ts` — never from `postiz-provider` or `mock-provider` directly. ESLint enforces this via `no-restricted-imports`.
- **Registry pattern:** `getRegistry()` in `lib/social/registry.ts` returns the active `SocialProvider` singleton. Set `SOCIAL_PROVIDER=mock` to inject `MockProvider`. Tests reset state with `_resetRegistry()` between cases.
- **OAuth state is a signed JWT:** `signOAuthState` / `verifyOAuthState` in `lib/social/oauth/state.ts` use HMAC-SHA256 via `OAUTH_STATE_SECRET` env var. Tests must set this env var or mock the module.
- **Vault helpers via Supabase RPC:** Migration 24 adds `vault_create_secret`, `vault_update_secret`, `vault_delete_secret` RPC wrappers callable via service-role client. Direct `vault.secrets` table writes are not used.
- **vitest `lib/` pattern picks up ECC tests:** Running `npx vitest run lib/` also matches `everything-claude-code/**/tests/lib/` files which use `process.exit()` and fail under Vitest. Always target `npx vitest run lib/db lib/social` for SOSH-only runs.



- **Project:** SOSH
- **shadcn/ui version:** v4 (4.6.0) uses base-nova preset. Does NOT support `--style` or `--base-color` CLI flags. The `form` component is not in the registry for this preset — create it manually with react-hook-form + @radix-ui/react-slot.
- **Stone base color:** Applied via oklch CSS variables with chroma ~0.002–0.005 and hue 75. Pure neutral uses chroma=0; Stone adds a warm undertone.

## Do-Not-Repeat

- [2026-05-03] Do NOT add a top-level `import { createServiceRoleClient } from '@/lib/supabase/service'` in lib/db/ files. `service.ts` imports `config.ts` which runs Zod env validation at module load — this crashes all tests in that file because env vars are not set in the test environment. Instead, use `const { createServiceRoleClient } = await import('@/lib/supabase/service')` inside the function body (lazy dynamic import).



<!-- Mistakes made and corrected. Each entry prevents the same mistake recurring. -->
<!-- Format: [YYYY-MM-DD] Description of what went wrong and what to do instead. -->

- [2026-04-29] Do NOT use `asChild` on the `Button` component. This project's Button uses `@base-ui/react/button`, not Radix — it has no `asChild` prop. For button-styled links, import `buttonVariants` and apply it to a `<Link className={cn(buttonVariants({ ... }))}>` instead.

## Decision Log

<!-- Significant technical decisions with rationale. Why X was chosen over Y. -->
