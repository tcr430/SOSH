Combined Findings Table
  ┌─────────┬────────────────────────────────────────────────────────────────────────┬────────┬────────────────────────────────────────────────────┬────────┐
  │ Section │                                 Check                                  │ Status │                     File:Line                      │ Source │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ A1      │ State param checked before everything else                             │ ✅     │ callback/route.ts:48–50                            │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ A1      │ verifyOAuthState() called before ownership check                       │ ✅     │ callback/route.ts:55 → 70                          │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ A1      │ Signature + expiry + platform-match all enforced                       │ ✅     │ oauth/state.ts:35; callback:60–62                  │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ A1      │ Missing state → redirect (not 500)                                     │ ✅     │ callback/route.ts:48–51                            │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ A1      │ businessId UUID-validated                                              │ ✅     │ callback/route.ts:63–65                            │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ A2      │ Ownership check uses server (anon, RLS) client                         │ ✅     │ callback/route.ts:68–73                            │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ A2      │ getBusinessById typed to require RLS client                            │ ⚠️      │ callback/route.ts:70                               │ ts     │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ A3      │ Vault create(access) before DB insert                                  │ ✅     │ callback/route.ts:98–107                           │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ A3      │ Refresh vault fail → access deleted                                    │ ✅     │ callback/route.ts:120–123                          │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ A3      │ DB insert fail → BOTH secrets deleted                                  │ ✅     │ callback/route.ts:162–170                          │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ A3      │ ON CONFLICT reconnect → prior secrets deleted                          │ ✅     │ callback/route.ts:174–189                          │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ A3      │ Cleanup errors logged (currently silent)                               │ ⚠️      │ callback/route.ts:121–123, 163–169                 │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ A3      │ Reconnect via xmax RETURNING (TOCTOU race)                             │ ⚠️      │ callback/route.ts:128–133                          │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ A4      │ /api/social/accounts returns no vault columns                          │ ✅     │ social-accounts.ts:136–138;                        │ sec/ts │
  │         │                                                                        │        │ SocialAccountPublic:4–11                           │        │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ A4      │ No raw tokens / vault IDs in responses or errors                       │ ✅     │ callback/route.ts (fixed-string codes)             │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ A5      │ Redirects are fixed internal paths                                     │ ⚠️      │ callback/route.ts:31, 193                          │ sec/ts │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ A5      │ Error codes from whitelist                                             │ ✅     │ accounts/page.tsx:12–25                            │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ A6      │ DELETE /disconnect auth-gated; SameSite cookies                        │ ✅     │ disconnect/route.ts:27–36                          │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ A7      │ Instagram/Facebook/Threads scopes exclude publish                      │ ✅     │ platforms/config.ts:29,37,44                       │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ A7      │ publishingAvailable: false for Meta platforms                          │ ✅     │ platforms/config.ts:32,41,48                       │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ A8      │ oauth_denied / expired JWT / replay handled                            │ ✅     │ callback/route.ts:54–57, 76–78                     │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ B1      │ [platform] runtime-validated → 404 on unknown                          │ ✅     │ connect:7–13; callback:10–16; disconnect:7–13      │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ B1      │ VALID_PLATFORMS duplicated in 3 files; no isPlatform guard             │ ⚠️      │ connect/callback/disconnect routes                 │ ts     │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ B2      │ Service-role via lazy import; ownership via anon                       │ ✅     │ callback:82; social-accounts.ts:85                 │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ B3      │ listByBusiness explicit column list (no vault)                         │ ✅     │ social-accounts.ts:136–138                         │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ B3      │ listAllSocialAccounts/listActiveSocialAccounts use select('*') (leaks  │ ❌     │ social-accounts.ts:20, 33                          │ sec    │
  │         │ vault IDs)                                                             │        │                                                    │        │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ B3      │ null as unknown as VaultSecretId defeats brand                         │ ❌     │ social-accounts.ts:94                              │ ts     │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ B4      │ coming_soon platforms render active Connect button → orphan-account UX │ ❌     │ PlatformConnectionCard.tsx:119;                    │ sec    │
  │         │                                                                        │        │ connection-status.ts:17–18                         │        │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ B4      │ EXPIRY_WARNING_DAYS = 7                                                │ ✅     │ connection-status.ts:12                            │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ B4      │ Exact 7-day boundary test missing                                      │ ⚠️      │ connection-status.test.ts                          │ ts     │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ B5      │ No any/as any in scope                                                 │ ✅     │ —                                                  │ ts     │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ B6      │ i18n key parity en/pt/es                                               │ ✅     │ i18n/{en,pt,es}/common.json                        │ ts     │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ B6      │ connect_failed error code not whitelisted + key missing                │ ❌     │ connect/route.ts:60; accounts/page.tsx:12–21       │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ B7      │ formatISO used in scope                                                │ ✅     │ callback/route.ts:151                              │ sec/ts │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ B8      │ No process.env outside config.ts in scope                              │ ✅     │ grep clean                                         │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ C1      │ PlatformConnectionCard shared (variant union)                          │ ✅     │ PlatformConnectionCard.tsx:26–34                   │ sec/ts │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ C2      │ AlertDialog disconnect confirm                                         │ ✅     │ PlatformConnectionCard.tsx:120–143                 │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ C2      │ AlertDialogAction variant="destructive" — needs visual QC              │ ⚠️      │ PlatformConnectionCard.tsx:138                     │ ts     │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ C3      │ Step-3 Continue disabled until ≥1 connected                            │ ✅     │ Step3Client.tsx:46–49, 154–162                     │ sec/ts │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ C4      │ Dashboard banner present when no accounts                              │ ✅     │ DashboardShell.tsx:62, 139–155                     │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ C4      │ ESLint react-hooks/set-state-in-effect ERROR                           │ ❌     │ DashboardShell.tsx:53–55                           │ ts     │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ C4      │ sessionStorage vs localStorage dismissal                               │ ⚠️      │ DashboardShell.tsx:36                              │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ C5      │ ?connected= / ?error= typed + whitelisted                              │ ✅     │ accounts/page.tsx:21–25, 56–70                     │ sec/ts │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ D1      │ Named volumes, healthchecks, no hardcoded creds                        │ ✅     │ infra/docker-compose.yml                           │ sec    │
  ├─────────┼────────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────────────┼────────┤
  │ D2      │ infra/README.md covers local + Hetzner                                 │ ✅     │ infra/README.md                                    │ sec    │
  └─────────┴────────────────────────────────────────────────────────────────────────┴────────┴────────────────────────────────────────────────────┴────────┘

  ---
  ❌ Required fixes

  1. ESLint error — DashboardShell.tsx:53–55 (react-hooks/set-state-in-effect)

  This is an error-level lint finding, will fail any CI gate. Pattern itself is intentional (hydration-safe sessionStorage read).
  Fix: Add a targeted disable comment:
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe sessionStorage read
    setBannerDismissed(sessionStorage.getItem(BANNER_KEY) === '1')
  }, [])

  2. null as unknown as VaultSecretId — lib/db/social-accounts.ts:94

  Branded type silenced by double cast.
  Fix: Update SocialAccountUpdate type in lib/db/types.ts so vault_access_token_id and vault_refresh_token_id are VaultSecretId | null. Remove both double casts   in deactivateSocialAccount.

  3. select('*') leaks vault IDs — lib/db/social-accounts.ts:20, 33

  listAllSocialAccounts and listActiveSocialAccounts fetch vault UUIDs into every consumer (including dashboard/layout.tsx).
  Fix: Replace both .select('*') calls with explicit column lists matching SocialAccountPublic (omit vault_*_id columns). Keep getSocialAccountById's
  select('*') since it is service-role internal only.

  4. coming_soon Connect button is functional → orphan-account trap — PlatformConnectionCard.tsx:119 + connection-status.ts:17–18

  Users can connect Instagram/Facebook/Threads today; once connected, getConnectionStatus keeps returning coming_soon (publish-availability check fires before
  is_active), so Disconnect never renders. Live DB rows with no UI management path.
  Fix: In PlatformConnectionCard, gate the Connect <Link> on status !== 'coming_soon' and render a disabled button instead. Also reorder getConnectionStatus so
  an active account on a coming_soon platform surfaces connected (or a dedicated connected_publishing_soon) state with a Disconnect affordance. Decide which:
  blocking connection is simpler.

  5. connect_failed error code not whitelisted + i18n key missing — connect/route.ts:60; accounts/page.tsx:12–21

  Any connect-path exception silently downgrades to the wrong message.
  Fix:
  - Add 'connect_failed' to ERROR_KEYS in accounts/page.tsx.
  - Add settings.accounts.error.connect_failed to all three locale files (en/pt/es).

  ---
  ⚠️  Recommendations

  - A2 — Strengthen getBusinessById signature to a typed RLS-client wrapper (currently any SupabaseClient).
  - A3 silent cleanup — Replace bare catch {} blocks with logger calls once the project logger lands.
  - A3 TOCTOU — ADR §7 Step 4d specifies returning prior vault IDs from the upsert; current implementation pre-queries social_accounts separately.
  Low-probability race; track as ADR deviation.
  - A5 / 6 — errorRedirect and success redirect at callback/route.ts:31, 193 hardcode /en/. PT/ES users land on the English page after OAuth. Embed locale in
  the state JWT claims (sign at connect/route.ts:20, consume in callback).
  - B1 — Extract isPlatform(x): x is Platform to a single module; replace the three duplicated VALID_PLATFORMS sets.
  - B4 — Add exact 7-day boundary test to connection-status.test.ts.
  - C2 — Visual QC AlertDialogAction variant="destructive" (compiles, may not render red styling depending on shadcn primitive impl).
  - C4 — Switch banner dismissal from sessionStorage to localStorage (UX only).