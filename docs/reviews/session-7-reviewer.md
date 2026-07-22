Session 7B — Campaign Builder Review (Synthesized)

  ┌─────────┬────────────────────────────┬────────┬──────────────────────────────────────┬──────────────────────────────────────────────────────────┐
  │ Section │           Check            │ Status │              File:Line               │                           Fix                            │  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ A1      │ businessId from session,   │ ✅     │ new/actions.ts:75-78                 │ —                                                        │  │         │ not form                   │        │                                      │                                                          │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ A2      │ pause/resume/delete via    │ ✅     │ campaigns/actions.ts:19-28,          │ —                                                        │
  │         │ anon+RLS                   │        │ campaigns.ts:77-91                   │                                                          │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ A3      │ Unowned campaign clean     │ ⚠️      │ [id]/page.tsx:40-41                  │ Use notFound() instead of redirect                       │
  │         │ redirect                   │        │                                      │                                                          │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ A4      │ Selected platforms         │ ❌     │ new/actions.ts:97-110                │ Cross-check parsed.data.platforms against                │
  │         │ verified as connected      │        │                                      │ listActiveSocialAccounts                                 │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ B1      │ Trial cap before write     │ ✅     │ new/actions.ts:81-87                 │ —                                                        │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ B2      │ Starter cap before write   │ ✅     │ enforcement.ts:24-29                 │ —                                                        │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ B3      │ Atomic col = col + 1       │ ✅     │ migration …180000.sql:11-14          │ —                                                        │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ B4      │ trial_state read via anon  │ ⚠️      │ enforcement.ts:16-21                 │ Verify SELECT RLS policy on trial_state; null-fallback   │
  │         │ (RLS)                      │        │                                      │ to 0 hides missing policy                                │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ B5      │ Concurrent-bypass on       │ ⚠️      │ enforcement.ts:24-29                 │ Defer — acceptable Phase 1 risk                          │
  │         │ starter                    │        │                                      │                                                          │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ C1      │ Zod before DB              │ ✅     │ all action files                     │ —                                                        │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ C2      │ Returns campaignId, no     │ ✅     │ new/actions.ts:122                   │ —                                                        │
  │         │ redirect                   │        │                                      │                                                          │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ C3      │ Dates → date column (not   │ ⚠️      │ lib/db/types.ts:169,                 │ Confirm migration column type is date                    │
  │         │ timestamptz)               │        │ new/actions.ts:105-106               │                                                          │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ C4      │ totalPostsPlanned          │ ✅     │ validation/campaign.ts:13,           │ —                                                        │
  │         │ NaN/negative guards        │        │ new/actions.ts:31                    │                                                          │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ C5      │ Soft delete sets           │ ✅     │ campaigns.ts:109-123                 │ —                                                        │
  │         │ deleted_at                 │        │                                      │                                                          │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ C6      │ Delete only                │ ✅     │ campaigns.ts:117                     │ —                                                        │
  │         │ draft/completed (server)   │        │                                      │                                                          │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ C7      │ Zod edge cases             │ ⚠️      │ validation/campaign.ts:22-27         │ endDate === startDate slips through (refine uses >)      │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ D1      │ No any                     │ ✅     │ all files                            │ —                                                        │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ D2      │ i18n keys in en/pt/es      │ ✅     │ all common.json                      │ —                                                        │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ D3      │ 'use server' directive     │ ✅     │ both action files L1                 │ —                                                        │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ D4      │ Direct Supabase outside    │ ✅     │ grep clean                           │ —                                                        │
  │         │ lib/                       │        │                                      │                                                          │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ D5      │ process.env outside config │ ✅     │ grep clean                           │ —                                                        │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ D6      │ formatISO for dates        │ ❌     │ CampaignForm.tsx:38                  │ Replace new Date().toISOString().slice(0,10) with        │
  │         │                            │        │                                      │ formatISO(new Date(), { representation: 'date' })        │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ E1      │ Platforms server-fetched   │ ✅     │ new/page.tsx:25                      │ —                                                        │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ E2      │ Coming-soon platforms      │ ✅     │ CampaignForm.tsx:159,195-199         │ —                                                        │
  │         │ selectable                 │        │                                      │                                                          │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ E3      │ Generate Posts button      │ ✅     │ CampaignDetailActions.tsx:79-89      │ —                                                        │
  │         │ (placeholder)              │        │                                      │                                                          │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ E4      │ Empty state                │ ✅     │ campaigns/page.tsx:30-47             │ —                                                        │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ E5      │ Helpful limit messages     │ ⚠️      │ CampaignForm.tsx:281-285             │ Dead errors.campaign.limit_* keys vs                     │
  │         │                            │        │                                      │ campaigns.new.limit.* actually used                      │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ Extra   │ CampaignUpdate excludes    │ ❌     │ lib/db/types.ts:198                  │ Add 'business_id' to the Omit                            │
  │         │ business_id                │        │                                      │                                                          │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │ Extra   │ Resume button missing on   │ ❌     │ CampaignDetailActions.tsx            │ Paused-state danger zone has no Resume action —          │
  │         │ detail page                │        │                                      │ resumeCampaignAction is unused                           │
  ├─────────┼────────────────────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────────────────────────┤
  │         │ Unguarded                  │        │                                      │ Remove or unexport; force callers to                     │
  │ Extra   │ softDeleteCampaign         │ ⚠️      │ campaigns.ts:66-75                   │ softDeleteCampaignGuarded                                │
  │         │ exported                   │        │                                      │                                                          │
  └─────────┴────────────────────────────┴────────┴──────────────────────────────────────┴──────────────────────────────────────────────────────────┘

  ---
  ❌ Failures — exact fixes

  A4 — Platform selection not verified server-side (HIGH)

  createCampaignAction accepts any Zod-valid platform names; client UI gating is bypassable. Add after Step 3 (get business):

  import { listActiveSocialAccounts } from '@/lib/db/social-accounts'

  const connectedAccounts = await listActiveSocialAccounts(client, business.id)
  const connected = new Set(connectedAccounts.map(a => a.platform))
  const invalid = parsed.data.platforms.filter(p => !connected.has(p))
  if (invalid.length > 0) {
    return { errors: { platforms: 'errors.campaign.platform_not_connected' } }
  }
  Add errors.campaign.platform_not_connected to en/pt/es.

  D6 — todayISO() violates date-fns rule

  CampaignForm.tsx:38:
  import { formatISO } from 'date-fns'  // already imported
  function todayISO(): string {
    return formatISO(new Date(), { representation: 'date' })
  }

  CampaignUpdate includes business_id (CLAUDE.md violation)

  lib/db/types.ts:198:
  export type CampaignUpdate = Partial<Omit<CampaignRow,
    'id' | 'created_at' | 'deleted_at' | 'business_id'>>

  Resume button missing on detail page

  CampaignDetailActions.tsx — for status === 'paused', render a Resume button invoking resumeCampaignAction, mirroring the Pause flow already present
  for status === 'active'. Without this, users have no in-UI path to un-pause from the detail page (only from the list card).

  ---
  ⚠️  Recommendations

  - A3 — Use notFound() instead of redirect('/campaigns') on missing campaign — semantic 404, avoids DB-error/not-found ambiguity from the swallowed
  catch.
  - B4 — Verify trial_state SELECT RLS policy lets the owner read its row. If missing, getTrialStateMaybe returns null → count ?? 0 → enforcement always   passes for trial. Add an integration test and warn-log when plan === 'trial' && trialState === null.
  - B5 — TOCTOU on starter cap; both concurrent requests read count=1 and both create. Defer to Phase 2 with SELECT … FOR UPDATE or a partial unique
  constraint.
  - C3 — Confirm start_date/end_date columns are date (not timestamptz) in migration SQL to avoid TZ off-by-one.
  - C7 — Change refine in validation/campaign.ts:22 so endDate > startDate strictly (currently equal dates pass and yield totalPostsPlanned =
  postsPerWeek for a zero-duration campaign).
  - E5 — Dead i18n keys: errors.campaign.limit_trial / limit_starter exist in all three locales but are never read; components use
  campaigns.new.limit.*. Remove the unused set.
  - softDeleteCampaign — Remove the unguarded export or mark internal; only softDeleteCampaignGuarded should be reachable.

  ---
  Verdict

  Blockers before Session 8 (post-generation depends on platform integrity):
  - ❌ A4 — Platform connected-check (AI worker will run on platforms with no token otherwise)
  - ❌ D6 — formatISO fix (small, but Session 8 will introduce more date code; don't carry the violation forward)

  Blockers before first user:
  - ❌ CampaignUpdate excludes business_id (constitution violation, defense-in-depth)
  - ❌ Resume button on detail page (paused campaigns have no recovery path)
  - ⚠️  B4 verification — confirm trial_state SELECT RLS policy exists

  Acceptable to defer:
  - A3 (notFound() over redirect), B5 (TOCTOU on starter cap), C3 (column-type confirmation, no code change), C7 (equal-date edge case, harmless count),   E5 (dead i18n keys), unguarded softDeleteCampaign cleanup.