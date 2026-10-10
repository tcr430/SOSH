import type { SupabaseClient } from '@supabase/supabase-js'
import {
  BUSINESS_A_ID,
  BUSINESS_B_ID,
  FIXTURE_ACCOUNTS,
  FIXTURE_BUSINESSES,
  FIXTURE_CAMPAIGNS,
  FIXTURE_MEMBERS,
  FIXTURE_POSTS,
  FIXTURE_POST_DIMENSIONS,
  FIXTURE_POST_METRICS,
  FIXTURE_POST_OUTCOMES,
  OTHER_ADMIN_USER_ID,
  USER_ID,
  VIEWER_USER_ID,
} from './portfolio'

// Session 37 O2.2 — loads lib/analytics/__fixtures__/portfolio.ts into a LIVE Postgres for Tier 1 (the "worker
// isolation seed", ADR 0031 §12.1 item 9 / constraint 27). The same rows drive the Tier-2 aggregation tests as plain
// data, so a number a Tier-2 test asserts is the number a Tier-1 test can find in the database.
//
// SERVICE-ROLE ONLY: the caller passes `createServiceRoleClient()` (the Tier-1 files already do). Idempotent: it
// removes the fixture's own rows first, so a run that crashed before its afterAll cannot poison the next one.
//
// post_dimensions rows are NOT inserted here. The AFTER INSERT tagging trigger writes one per AI snapshot, deriving
// role from posts.role, format from the snapshot, origin_mode from the CAMPAIGN, hook_type from payload.hookType and
// platform from the post; the fixture's dimensions are built to match that derivation exactly, and the seed test
// asserts they do (so the fixture cannot drift from the trigger).

export const SEED_PASSWORD = 'TestPass123!'

const USERS = [
  { id: USER_ID, email: 'portfolio-owner@integration.test' },
  { id: OTHER_ADMIN_USER_ID, email: 'portfolio-admin2@integration.test' },
  { id: VIEWER_USER_ID, email: 'portfolio-viewer@integration.test' },
] as const

export const SEED_OWNER_EMAIL = USERS[0].email

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`seedPortfolio: ${what}: ${result.error.message}`)
  return result.data as T
}

async function insertAll(admin: SupabaseClient, table: string, rows: readonly object[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await admin.from(table).insert(rows.slice(i, i + 100) as object[])
    if (error) throw new Error(`seedPortfolio: insert ${table}: ${error.message}`)
  }
}

export async function cleanPortfolio(admin: SupabaseClient): Promise<void> {
  // Businesses first: every child table cascades from them, and owner_id -> auth.users is RESTRICT.
  for (const id of [BUSINESS_A_ID, BUSINESS_B_ID]) {
    const { error } = await admin.from('businesses').delete().eq('id', id)
    if (error) throw new Error(`cleanPortfolio: businesses ${id}: ${error.message}`)
  }
  for (const u of USERS) {
    // A missing user is fine (first run); anything else is not swallowed.
    const { error } = await admin.auth.admin.deleteUser(u.id)
    if (error && !/not found/i.test(error.message)) throw new Error(`cleanPortfolio: user ${u.id}: ${error.message}`)
  }
}

export async function seedPortfolio(admin: SupabaseClient): Promise<void> {
  await cleanPortfolio(admin)

  for (const u of USERS) {
    const { error } = await admin.auth.admin.createUser({
      id: u.id,
      email: u.email,
      password: SEED_PASSWORD,
      email_confirm: true,
    })
    if (error) throw new Error(`seedPortfolio: user ${u.email}: ${error.message}`)
  }

  await insertAll(
    admin,
    'businesses',
    FIXTURE_BUSINESSES.map((b) => ({ ...b, onboarding_completed: true })),
  )

  // The ensure_owner_membership trigger has already made USER_ID an active admin of BOTH businesses, with the auth
  // email. Re-point those two rows at the fixture's member emails, and insert every other member.
  for (const m of FIXTURE_MEMBERS.filter((x) => x.user_id === USER_ID)) {
    must(
      await admin.from('business_members').update({ email: m.email }).eq('business_id', m.business_id).eq('user_id', USER_ID).select('id'),
      `owner member ${m.email}`,
    )
  }
  await insertAll(
    admin,
    'business_members',
    FIXTURE_MEMBERS.filter((x) => x.user_id !== USER_ID).map((m) => ({ ...m, invited_by: USER_ID })),
  )

  await insertAll(
    admin,
    'social_accounts',
    FIXTURE_ACCOUNTS.map((a) => ({ ...a, connected_at: '2026-01-01T00:00:00Z' })),
  )

  await insertAll(
    admin,
    'campaigns',
    FIXTURE_CAMPAIGNS.map((c) => ({
      id: c.id,
      business_id: c.business_id,
      name: c.name,
      objective: 'Fixture objective',
      platforms: ['twitter', 'linkedin'],
      frequency: 'weekly',
      posts_per_week: 1,
      start_date: '2026-01-01',
      origin: c.origin,
      status: c.status,
    })),
  )

  await insertAll(
    admin,
    'posts',
    FIXTURE_POSTS.map((p) => ({ ...p, hashtags: [] })),
  )

  await insertAll(
    admin,
    'post_ai_originals',
    FIXTURE_POST_DIMENSIONS.map((d) => ({
      id: d.ai_original_id,
      business_id: d.business_id,
      post_id: d.post_id,
      campaign_id: d.campaign_id,
      revision: 1,
      generation_kind: 'initial',
      format: d.format,
      payload: d.hook_type ? { content: 'x', hookType: d.hook_type } : { content: 'x' },
      rendered_content: 'x',
      hashtags: [],
      schema_version: 1,
    })),
  )

  await insertAll(admin, 'post_metrics', FIXTURE_POST_METRICS)
  await insertAll(admin, 'post_outcomes', FIXTURE_POST_OUTCOMES)
}
