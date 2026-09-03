'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import {
  getGithubConnectionByBusinessId,
  deactivateGithubConnection,
} from '@/lib/db/github-connections'
import {
  countActiveWatchedReposForBusiness,
  addWatchedRepo,
  setWatchedRepoActive,
} from '@/lib/db/watched-repos'
import {
  countActiveWatchedFeedsForBusiness,
  addWatchedFeed,
  setWatchedFeedActive,
} from '@/lib/db/watched-feeds'
import { canServer } from '@/lib/members/can-server'
import { CAPABILITIES } from '@/lib/members/capabilities'
import { signGithubConnectState } from '@/lib/signals/state'
import {
  mintInstallationToken,
  getInstallationRepositories,
  validateUrl,
  computeWatchedFeedUrlHash,
  type GithubRepoSummary,
} from '@/lib/signals'
import { config } from '@/lib/config'
import { NONCE_COOKIE_NAME } from '@/app/api/signals/github/callback/route'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { BusinessRow } from '@/lib/db/types'

export interface ActionState {
  success?: boolean
  error?: string
}

// ADR 0020 §3.2 — the watch-list cap; SIGNAL-WATCHLIST-BOUNDED. A DB CHECK
// cannot see sibling rows, so this is enforced here, in the action — the
// small TOCTOU window between this count and the write is accepted because
// this is a UX/cost guardrail, not a security boundary.
const MAX_ACTIVE_WATCHED_REPOS = 20

// ADR 0023 §8.4 (Session 30 G1b.9) — same precedent, same disclaimer,
// verbatim: a UX/cost guardrail, NOT a security boundary. Must never be
// relied on as a security control (§6.6's own MAX_ACTIVE_WATCHED_REPOS
// disclaimer, restated for the second source rather than assumed to carry
// over silently).
const MAX_ACTIVE_WATCHED_FEEDS = 20

async function requireBusiness(client: SupabaseClient): Promise<{ user: User; business: BusinessRow }> {
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const business = await getBusinessForUser(client, user.id)
  if (!business) throw new Error('No business')
  return { user, business }
}

// ADR 0023 §8.1 (Session 30 G1b.9) — THE extracted L-8 gating seam.
// SIGNAL-GATING-SEAM-NAMED is AMENDED: its subject moves from
// connectGithubAction to THIS function, and its count is restated as every
// call site below (nine, at the time of writing) rather than six. A future
// entitlement/plan check goes HERE and nowhere else — this is the SAME
// reserved location the original comment on connectGithubAction described,
// just extracted so it stays true that there is exactly ONE such location
// once a feed source (with no OAuth install flow to attach a comment to)
// exists alongside GitHub's. A second reserved location (e.g. a
// connectFeedAction carrying its own copy of this comment) is explicitly
// REJECTED by the ADR: "a single named seam that becomes two named seams
// has quietly stopped being the thing the constraint asserts." SIGNAL-MR-
// GATING-SEAM. Per SHARED-FUNCTION CALLERS, every caller below is listed in
// this step's commit message with the test that exercises it.
async function gateSignalSourceAction(client: SupabaseClient, business: BusinessRow, userId: string): Promise<boolean> {
  return canServer(client, business, userId, CAPABILITIES.CONNECT_ACCOUNTS)
}

export async function connectGithubAction(): Promise<ActionState> {
  const client = await createClient()
  let user: User, business: BusinessRow
  try {
    ;({ user, business } = await requireBusiness(client))
  } catch {
    return { error: 'errors.forbidden' }
  }

  if (!(await gateSignalSourceAction(client, business, user.id))) {
    return { error: 'errors.forbidden' }
  }

  const { state, nonce } = await signGithubConnectState({ businessId: business.id, userId: user.id })

  // §8.3 step 3 — httpOnly, SameSite=Lax, 5-minute single-use nonce cookie.
  // Lax (not Strict) is required and sufficient: it survives the top-level
  // GET navigation GitHub's own redirect back to the callback performs,
  // which Strict would drop.
  const cookieStore = await cookies()
  cookieStore.set(NONCE_COOKIE_NAME, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.public.NODE_ENV === 'production',
    maxAge: 300,
    path: '/',
  })

  const slug = config.server.GITHUB_APP_SLUG
  const installUrl = `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`
  redirect(installUrl)
}

// ADR §2.5 — disconnect. Three properties, all deliberate:
//   (1) an ATOMIC conditional UPDATE (CLAUDE.md's state-transition pattern),
//       WHERE is_active = true — never a read-then-write.
//   (2) poller exclusion is already structural from E2.7 (the claim query
//       filters is_active = true); nothing here needs to "tell" the poller.
//   (3) already-ingested signals are RETAINED. Delete-on-disconnect is the
//       named loser: surprising data loss, and a reconnect would silently
//       re-ingest the same history from scratch.
// SOSH never calls GitHub's uninstall API — uninstalling is a WRITE against
// the customer's OWN GitHub account, and L-5 is read-only, forever. The UI
// deep-links to the customer's own installation settings instead.
export async function disconnectGithubAction(): Promise<ActionState> {
  const client = await createClient()
  let user: User, business: BusinessRow
  try {
    ;({ user, business } = await requireBusiness(client))
  } catch {
    return { error: 'errors.forbidden' }
  }

  if (!(await gateSignalSourceAction(client, business, user.id))) {
    return { error: 'errors.forbidden' }
  }

  await deactivateGithubConnection(business.id, 'disconnected')
  return { success: true }
}

const addRepoSchema = z.object({
  repoId: z.coerce.number().int().positive(),
  owner: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
})

export async function addWatchedRepoAction(input: unknown): Promise<ActionState> {
  const parsed = addRepoSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'errors.invalid_repo' }
  }

  const client = await createClient()
  let user: User, business: BusinessRow
  try {
    ;({ user, business } = await requireBusiness(client))
  } catch {
    return { error: 'errors.forbidden' }
  }

  if (!(await gateSignalSourceAction(client, business, user.id))) {
    return { error: 'errors.forbidden' }
  }

  // Never trust a client-submitted connection id — the caller's OWN
  // connection (UNIQUE(business_id): at most one) is looked up server-side,
  // which structurally rules out attaching a watched repo to a connection
  // belonging to a different business.
  const connection = await getGithubConnectionByBusinessId(client, business.id)
  if (!connection) {
    return { error: 'errors.no_github_connection' }
  }

  const activeCount = await countActiveWatchedReposForBusiness(client, business.id)
  if (activeCount >= MAX_ACTIVE_WATCHED_REPOS) {
    return { error: 'errors.watchlist_cap_reached' }
  }

  try {
    await addWatchedRepo(client, {
      business_id: business.id,
      connection_id: connection.id,
      repo_id: parsed.data.repoId,
      owner: parsed.data.owner,
      name: parsed.data.name,
      added_by: user.id,
    })
  } catch {
    return { error: 'errors.watchlist_add_failed' }
  }

  return { success: true }
}

const watchedRepoIdSchema = z.object({ watchedRepoId: z.string().uuid() })

export async function removeWatchedRepoAction(input: unknown): Promise<ActionState> {
  const parsed = watchedRepoIdSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'errors.invalid_repo' }
  }

  const client = await createClient()
  let user: User, business: BusinessRow
  try {
    ;({ user, business } = await requireBusiness(client))
  } catch {
    return { error: 'errors.forbidden' }
  }

  if (!(await gateSignalSourceAction(client, business, user.id))) {
    return { error: 'errors.forbidden' }
  }

  // §3.5 — "unwatching is is_active = false", never a DELETE (no DELETE
  // policy exists on watched_repos).
  await setWatchedRepoActive(client, parsed.data.watchedRepoId, business.id, false)
  return { success: true }
}

const toggleRepoSchema = z.object({ watchedRepoId: z.string().uuid(), isActive: z.boolean() })

export async function toggleWatchedRepoAction(input: unknown): Promise<ActionState> {
  const parsed = toggleRepoSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'errors.invalid_repo' }
  }

  const client = await createClient()
  let user: User, business: BusinessRow
  try {
    ;({ user, business } = await requireBusiness(client))
  } catch {
    return { error: 'errors.forbidden' }
  }

  if (!(await gateSignalSourceAction(client, business, user.id))) {
    return { error: 'errors.forbidden' }
  }

  if (parsed.data.isActive) {
    // Toggling back ON is subject to the SAME cap re-activating would
    // otherwise let a customer bypass entirely (add 20, deactivate all,
    // reactivate 20 more, repeat).
    const activeCount = await countActiveWatchedReposForBusiness(client, business.id)
    if (activeCount >= MAX_ACTIVE_WATCHED_REPOS) {
      return { error: 'errors.watchlist_cap_reached' }
    }
  }

  await setWatchedRepoActive(client, parsed.data.watchedRepoId, business.id, parsed.data.isActive)
  return { success: true }
}

export type ListRepositoriesResult =
  | { success: true; repos: GithubRepoSummary[] }
  | { success: false; error: string }

// The repo picker's data source. A token is minted PER CALL (never
// persisted, per lib/signals/github-client.ts's SIGNAL-NO-TOKEN-AT-REST) and
// used exactly once, in memory, for the GET /installation/repositories call
// below — it never appears in the returned result or in any log statement.
export async function listInstallationRepositoriesAction(): Promise<ListRepositoriesResult> {
  const client = await createClient()
  let user: User, business: BusinessRow
  try {
    ;({ user, business } = await requireBusiness(client))
  } catch {
    return { success: false, error: 'errors.forbidden' }
  }

  if (!(await gateSignalSourceAction(client, business, user.id))) {
    return { success: false, error: 'errors.forbidden' }
  }

  const connection = await getGithubConnectionByBusinessId(client, business.id)
  if (!connection || !connection.is_active) {
    return { success: false, error: 'errors.no_github_connection' }
  }

  try {
    const { token } = await mintInstallationToken(connection.installation_id)
    const repos = await getInstallationRepositories(token)
    return { success: true, repos }
  } catch {
    return { success: false, error: 'errors.repos_fetch_failed' }
  }
}

// ── ADR 0023 §8.2/§8.4 (Session 30 G1b.9) — the market-responsive (RSS/Atom)
// watch-list. No connection, no installation, no OAuth flow: §3.1 — "there
// is no credential boundary, the egress guard IS the whole security
// boundary" — so, unlike the repo actions above, there is no
// getGithubConnectionByBusinessId-equivalent lookup here at all. ───────────

const addFeedSchema = z.object({
  // §8.4 — URL validation DELEGATED to G1b.3's validator (validateUrl),
  // never re-implemented here: a bare z.string().url() would accept
  // http://, credentials-in-URL, or any scheme z.string().url() considers
  // well-formed, none of which the egress guard itself would ever accept.
  url: z.string().refine((raw) => !('errorCode' in validateUrl(raw)), { message: 'errors.invalid_url' }),
  label: z.string().min(1).max(100),
})

export async function addWatchedFeedAction(input: unknown): Promise<ActionState> {
  const parsed = addFeedSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'errors.invalid_feed' }
  }

  const client = await createClient()
  let user: User, business: BusinessRow
  try {
    ;({ user, business } = await requireBusiness(client))
  } catch {
    return { error: 'errors.forbidden' }
  }

  if (!(await gateSignalSourceAction(client, business, user.id))) {
    return { error: 'errors.forbidden' }
  }

  const activeCount = await countActiveWatchedFeedsForBusiness(client, business.id)
  if (activeCount >= MAX_ACTIVE_WATCHED_FEEDS) {
    return { error: 'errors.feed_cap_reached' }
  }

  try {
    await addWatchedFeed(client, {
      business_id: business.id,
      url: parsed.data.url,
      // §8.2 — UNIQUE(business_id, url_hash) is the idempotency arbiter;
      // computed via the SAME normalize-then-hash algorithm §3.4 already
      // established for item-dedup, never re-implemented here.
      url_hash: computeWatchedFeedUrlHash(parsed.data.url),
      label: parsed.data.label,
      added_by: user.id,
    })
  } catch {
    // Covers both a genuine write failure AND a duplicate (business_id,
    // url_hash) — the same generic-catch shape addWatchedRepoAction already
    // uses for its own unique constraint, rather than a special-cased
    // "already watching this feed" branch this step does not need.
    return { error: 'errors.feed_add_failed' }
  }

  return { success: true }
}

const watchedFeedIdSchema = z.object({ watchedFeedId: z.string().uuid() })

export async function removeWatchedFeedAction(input: unknown): Promise<ActionState> {
  const parsed = watchedFeedIdSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'errors.invalid_feed' }
  }

  const client = await createClient()
  let user: User, business: BusinessRow
  try {
    ;({ user, business } = await requireBusiness(client))
  } catch {
    return { error: 'errors.forbidden' }
  }

  if (!(await gateSignalSourceAction(client, business, user.id))) {
    return { error: 'errors.forbidden' }
  }

  // §7.6 — "unwatching is is_active = false", never a DELETE (no DELETE
  // policy exists on watched_feeds), mirroring removeWatchedRepoAction.
  await setWatchedFeedActive(client, parsed.data.watchedFeedId, business.id, false)
  return { success: true }
}

const toggleFeedSchema = z.object({ watchedFeedId: z.string().uuid(), isActive: z.boolean() })

export async function toggleWatchedFeedAction(input: unknown): Promise<ActionState> {
  const parsed = toggleFeedSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'errors.invalid_feed' }
  }

  const client = await createClient()
  let user: User, business: BusinessRow
  try {
    ;({ user, business } = await requireBusiness(client))
  } catch {
    return { error: 'errors.forbidden' }
  }

  if (!(await gateSignalSourceAction(client, business, user.id))) {
    return { error: 'errors.forbidden' }
  }

  if (parsed.data.isActive) {
    // Toggling back ON is subject to the SAME cap re-activating would
    // otherwise let a customer bypass entirely, mirroring
    // toggleWatchedRepoAction's identical reasoning.
    const activeCount = await countActiveWatchedFeedsForBusiness(client, business.id)
    if (activeCount >= MAX_ACTIVE_WATCHED_FEEDS) {
      return { error: 'errors.feed_cap_reached' }
    }
  }

  await setWatchedFeedActive(client, parsed.data.watchedFeedId, business.id, parsed.data.isActive)
  return { success: true }
}
