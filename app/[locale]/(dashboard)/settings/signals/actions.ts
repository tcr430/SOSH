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
import { canServer } from '@/lib/members/can-server'
import { CAPABILITIES } from '@/lib/members/capabilities'
import { signGithubConnectState } from '@/lib/signals/state'
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

async function requireBusiness(client: SupabaseClient): Promise<{ user: User; business: BusinessRow }> {
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const business = await getBusinessForUser(client, user.id)
  if (!business) throw new Error('No business')
  return { user, business }
}

// ADR §8.6 (D-7) — connectGithubAction IS THE NAMED L-8 PLAN-GATING SEAM.
// A future entitlement/plan check goes HERE and nowhere else: gating at
// connect time is the narrowest single place, and it grandfathers existing
// connections on a plan downgrade (the poller's own per-business filter is
// the named loser — gating there would silently stop ingestion with no
// user-visible cause). No entitlement check ships in this step; the seam
// must be locatable by function name, which is why this comment exists.
export async function connectGithubAction(): Promise<ActionState> {
  const client = await createClient()
  let user: User, business: BusinessRow
  try {
    ;({ user, business } = await requireBusiness(client))
  } catch {
    return { error: 'errors.forbidden' }
  }

  if (!(await canServer(client, business, user.id, CAPABILITIES.CONNECT_ACCOUNTS))) {
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

  if (!(await canServer(client, business, user.id, CAPABILITIES.CONNECT_ACCOUNTS))) {
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

  if (!(await canServer(client, business, user.id, CAPABILITIES.CONNECT_ACCOUNTS))) {
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

  if (!(await canServer(client, business, user.id, CAPABILITIES.CONNECT_ACCOUNTS))) {
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

  if (!(await canServer(client, business, user.id, CAPABILITIES.CONNECT_ACCOUNTS))) {
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
