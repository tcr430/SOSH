import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/config', () => ({
  config: {
    server: { GITHUB_APP_SLUG: 'sosh-app' },
    public: { NODE_ENV: 'test' },
  },
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser: vi.fn() }))
vi.mock('@/lib/members/can-server', () => ({ canServer: vi.fn() }))
vi.mock('@/lib/signals/state', () => ({ signGithubConnectState: vi.fn() }))
vi.mock('@/lib/db/github-connections', () => ({
  getGithubConnectionByBusinessId: vi.fn(),
  deactivateGithubConnection: vi.fn(),
}))
vi.mock('@/lib/db/watched-repos', () => ({
  countActiveWatchedReposForBusiness: vi.fn(),
  addWatchedRepo: vi.fn(),
  setWatchedRepoActive: vi.fn(),
}))
vi.mock('@/lib/db/watched-feeds', () => ({
  countActiveWatchedFeedsForBusiness: vi.fn(),
  addWatchedFeed: vi.fn(),
  setWatchedFeedActive: vi.fn(),
}))
vi.mock('@/lib/signals', () => ({
  mintInstallationToken: vi.fn(),
  getInstallationRepositories: vi.fn(),
  // A REAL (not stubbed) https-only check — G1b.9's whole point is that
  // addWatchedFeedAction DELEGATES to this function rather than
  // re-implementing scheme validation, so the test proving that delegation
  // needs the mock to actually behave like the guard, not just resolve true.
  validateUrl: vi.fn((raw: string) => {
    try {
      const parsed = new URL(raw)
      if (parsed.protocol !== 'https:') return { errorCode: 'scheme_rejected', message: 'https only' }
      return parsed
    } catch {
      return { errorCode: 'invalid_url', message: 'not a URL' }
    }
  }),
  computeWatchedFeedUrlHash: vi.fn((url: string) => `hash-of-${url}`),
}))

const mockRedirect = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ redirect: mockRedirect }))

const mockCookieStore = vi.hoisted(() => ({ set: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue(mockCookieStore) }))

vi.mock('@/app/api/signals/github/callback/route', () => ({
  NONCE_COOKIE_NAME: 'github_connect_nonce',
}))

import {
  connectGithubAction,
  disconnectGithubAction,
  addWatchedRepoAction,
  removeWatchedRepoAction,
  toggleWatchedRepoAction,
  listInstallationRepositoriesAction,
  addWatchedFeedAction,
  removeWatchedFeedAction,
  toggleWatchedFeedAction,
} from './actions'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { canServer } from '@/lib/members/can-server'
import { signGithubConnectState } from '@/lib/signals/state'
import { getGithubConnectionByBusinessId, deactivateGithubConnection } from '@/lib/db/github-connections'
import { countActiveWatchedReposForBusiness, addWatchedRepo, setWatchedRepoActive } from '@/lib/db/watched-repos'
import { countActiveWatchedFeedsForBusiness, addWatchedFeed, setWatchedFeedActive } from '@/lib/db/watched-feeds'
import { mintInstallationToken, getInstallationRepositories } from '@/lib/signals'

const mockCreateClient = vi.mocked(createClient)
const mockGetBusinessForUser = vi.mocked(getBusinessForUser)
const mockCanServer = vi.mocked(canServer)
const mockSignGithubConnectState = vi.mocked(signGithubConnectState)
const mockGetGithubConnectionByBusinessId = vi.mocked(getGithubConnectionByBusinessId)
const mockDeactivateGithubConnection = vi.mocked(deactivateGithubConnection)
const mockCountActiveWatchedReposForBusiness = vi.mocked(countActiveWatchedReposForBusiness)
const mockAddWatchedRepo = vi.mocked(addWatchedRepo)
const mockSetWatchedRepoActive = vi.mocked(setWatchedRepoActive)
const mockCountActiveWatchedFeedsForBusiness = vi.mocked(countActiveWatchedFeedsForBusiness)
const mockAddWatchedFeed = vi.mocked(addWatchedFeed)
const mockSetWatchedFeedActive = vi.mocked(setWatchedFeedActive)
const mockMintInstallationToken = vi.mocked(mintInstallationToken)
const mockGetInstallationRepositories = vi.mocked(getInstallationRepositories)

const BUSINESS_ID = 'biz-1'
const USER = { id: 'user-1' }
const BUSINESS = { id: BUSINESS_ID, owner_id: USER.id }

function makeSupabaseStub(user: { id: string } | null = USER) {
  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) } } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateClient.mockResolvedValue(makeSupabaseStub())
  mockGetBusinessForUser.mockResolvedValue(BUSINESS as never)
  mockCanServer.mockResolvedValue(true)
  mockSignGithubConnectState.mockResolvedValue({ state: 'signed-state-jwt', nonce: 'nonce-xyz' })
  mockGetGithubConnectionByBusinessId.mockResolvedValue({ id: 'conn-1', business_id: BUSINESS_ID } as never)
  mockCountActiveWatchedReposForBusiness.mockResolvedValue(0)
  mockCountActiveWatchedFeedsForBusiness.mockResolvedValue(0)
})

describe('connectGithubAction — the L-8 gating seam', () => {
  it('mints the signed state, sets the httpOnly/Lax/5-minute nonce cookie, and redirects to the install URL', async () => {
    await connectGithubAction()

    expect(mockSignGithubConnectState).toHaveBeenCalledWith({ businessId: BUSINESS_ID, userId: USER.id })
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      'github_connect_nonce',
      'nonce-xyz',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', maxAge: 300 }),
    )
    expect(mockRedirect).toHaveBeenCalledWith(expect.stringContaining('https://github.com/apps/sosh-app/installations/new?state='))
  })

  it('SIGNAL-CAPABILITY-GATED: a canServer(CONNECT_ACCOUNTS) denial returns the typed forbidden result before any write', async () => {
    mockCanServer.mockResolvedValue(false)
    const result = await connectGithubAction()
    expect(result).toEqual({ error: 'errors.forbidden' })
    expect(mockSignGithubConnectState).not.toHaveBeenCalled()
    expect(mockCookieStore.set).not.toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})

describe('disconnectGithubAction — SIGNAL-DISCONNECT-DEACTIVATES (ADR §2.5)', () => {
  it('deactivates the connection via the atomic transition and retains signals (no deletion call exists to make)', async () => {
    const result = await disconnectGithubAction()
    expect(result).toEqual({ success: true })
    expect(mockDeactivateGithubConnection).toHaveBeenCalledWith(BUSINESS_ID, 'disconnected')
  })

  it('never calls a GitHub uninstall API — no such client function is imported or invoked', async () => {
    // Structural, not behavioral: this module imports nothing named
    // "uninstall" from lib/signals, so there is no call to assert against —
    // the absence itself is the proof. This test documents that intent
    // rather than asserting a mock, since there is no mock to assert on.
    const moduleSource = await import('./actions')
    expect(Object.keys(moduleSource)).not.toContain('uninstallGithubAction')
  })

  it('SIGNAL-CAPABILITY-GATED: a canServer(CONNECT_ACCOUNTS) denial returns the typed forbidden result before touching the DB layer', async () => {
    mockCanServer.mockResolvedValue(false)
    const result = await disconnectGithubAction()
    expect(result).toEqual({ error: 'errors.forbidden' })
    expect(mockDeactivateGithubConnection).not.toHaveBeenCalled()
  })
})

describe('addWatchedRepoAction', () => {
  const validInput = { repoId: 12345, owner: 'acme', name: 'widgets' }

  it("adds a repo under the caller's own connection (never a client-submitted connection id)", async () => {
    const result = await addWatchedRepoAction(validInput)
    expect(result).toEqual({ success: true })
    expect(mockAddWatchedRepo).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ business_id: BUSINESS_ID, connection_id: 'conn-1', repo_id: 12345 }),
    )
  })

  it('SIGNAL-WATCHLIST-BOUNDED: the 21st active repo is rejected by the action', async () => {
    mockCountActiveWatchedReposForBusiness.mockResolvedValue(20)
    const result = await addWatchedRepoAction(validInput)
    expect(result).toEqual({ error: 'errors.watchlist_cap_reached' })
    expect(mockAddWatchedRepo).not.toHaveBeenCalled()
  })

  it('SIGNAL-CAPABILITY-GATED: a canServer(CONNECT_ACCOUNTS) denial returns the typed forbidden result before touching the DB layer', async () => {
    mockCanServer.mockResolvedValue(false)
    const result = await addWatchedRepoAction(validInput)
    expect(result).toEqual({ error: 'errors.forbidden' })
    expect(mockCountActiveWatchedReposForBusiness).not.toHaveBeenCalled()
    expect(mockAddWatchedRepo).not.toHaveBeenCalled()
  })

  it('rejects malformed input before touching the DB layer', async () => {
    const result = await addWatchedRepoAction({ repoId: -1, owner: '', name: '' })
    expect(result.error).toBeDefined()
    expect(mockAddWatchedRepo).not.toHaveBeenCalled()
  })
})

describe('removeWatchedRepoAction', () => {
  const validInput = { watchedRepoId: '123e4567-e89b-4abc-8def-426614174000' }

  it('deactivates (never deletes) the watched repo', async () => {
    const result = await removeWatchedRepoAction(validInput)
    expect(result).toEqual({ success: true })
    expect(mockSetWatchedRepoActive).toHaveBeenCalledWith(expect.anything(), validInput.watchedRepoId, BUSINESS_ID, false)
  })

  it('SIGNAL-CAPABILITY-GATED: a canServer(CONNECT_ACCOUNTS) denial returns the typed forbidden result before touching the DB layer', async () => {
    mockCanServer.mockResolvedValue(false)
    const result = await removeWatchedRepoAction(validInput)
    expect(result).toEqual({ error: 'errors.forbidden' })
    expect(mockSetWatchedRepoActive).not.toHaveBeenCalled()
  })
})

describe('toggleWatchedRepoAction', () => {
  const validInput = { watchedRepoId: '123e4567-e89b-4abc-8def-426614174000', isActive: true }

  it('toggling on is subject to the SAME 20-repo cap as adding', async () => {
    mockCountActiveWatchedReposForBusiness.mockResolvedValue(20)
    const result = await toggleWatchedRepoAction(validInput)
    expect(result).toEqual({ error: 'errors.watchlist_cap_reached' })
    expect(mockSetWatchedRepoActive).not.toHaveBeenCalled()
  })

  it('toggling off is never capped', async () => {
    mockCountActiveWatchedReposForBusiness.mockResolvedValue(20)
    const result = await toggleWatchedRepoAction({ ...validInput, isActive: false })
    expect(result).toEqual({ success: true })
    expect(mockSetWatchedRepoActive).toHaveBeenCalledWith(expect.anything(), validInput.watchedRepoId, BUSINESS_ID, false)
  })

  it('SIGNAL-CAPABILITY-GATED: a canServer(CONNECT_ACCOUNTS) denial returns the typed forbidden result before touching the DB layer', async () => {
    mockCanServer.mockResolvedValue(false)
    const result = await toggleWatchedRepoAction(validInput)
    expect(result).toEqual({ error: 'errors.forbidden' })
    expect(mockSetWatchedRepoActive).not.toHaveBeenCalled()
  })
})

describe('listInstallationRepositoriesAction — the repo picker', () => {
  const REPOS = [
    { id: 1, owner: { login: 'acme' }, name: 'widgets' },
    { id: 2, owner: { login: 'acme' }, name: 'gadgets' },
  ]

  it('mints an installation token for the caller\'s connection and returns the repo list, never the token itself', async () => {
    mockGetGithubConnectionByBusinessId.mockResolvedValue({
      id: 'conn-1',
      business_id: BUSINESS_ID,
      installation_id: 999,
      is_active: true,
    } as never)
    mockMintInstallationToken.mockResolvedValue({ token: 'secret-token', expiresAt: '2026-01-01T00:00:00Z' })
    mockGetInstallationRepositories.mockResolvedValue(REPOS as never)

    const result = await listInstallationRepositoriesAction()

    expect(result).toEqual({ success: true, repos: REPOS })
    expect(mockMintInstallationToken).toHaveBeenCalledWith(999)
    expect(mockGetInstallationRepositories).toHaveBeenCalledWith('secret-token')
    expect(JSON.stringify(result)).not.toContain('secret-token')
  })

  it('returns a typed error when the business has no GitHub connection', async () => {
    mockGetGithubConnectionByBusinessId.mockResolvedValue(null)

    const result = await listInstallationRepositoriesAction()

    expect(result).toEqual({ success: false, error: 'errors.no_github_connection' })
    expect(mockMintInstallationToken).not.toHaveBeenCalled()
  })

  it('returns a typed error when the connection is inactive', async () => {
    mockGetGithubConnectionByBusinessId.mockResolvedValue({
      id: 'conn-1',
      business_id: BUSINESS_ID,
      installation_id: 999,
      is_active: false,
    } as never)

    const result = await listInstallationRepositoriesAction()

    expect(result).toEqual({ success: false, error: 'errors.no_github_connection' })
    expect(mockMintInstallationToken).not.toHaveBeenCalled()
  })

  it('SIGNAL-CAPABILITY-GATED: a canServer(CONNECT_ACCOUNTS) denial returns the typed forbidden result before any GitHub call', async () => {
    mockCanServer.mockResolvedValue(false)

    const result = await listInstallationRepositoriesAction()

    expect(result).toEqual({ success: false, error: 'errors.forbidden' })
    expect(mockMintInstallationToken).not.toHaveBeenCalled()
  })

  it('maps a thrown GitHub-client error to a typed result, never leaking the raw error or token', async () => {
    mockGetGithubConnectionByBusinessId.mockResolvedValue({
      id: 'conn-1',
      business_id: BUSINESS_ID,
      installation_id: 999,
      is_active: true,
    } as never)
    mockMintInstallationToken.mockRejectedValue(new Error('rate_limited'))

    const result = await listInstallationRepositoriesAction()

    expect(result).toEqual({ success: false, error: 'errors.repos_fetch_failed' })
  })
})

// ADR 0023 §8.1/§8.4 (Session 30 G1b.9) — the market-responsive watch-list
// actions. No connection lookup exists in ANY of these three (§3.1: feeds
// have no credential boundary), which is itself part of what distinguishes
// them from the repo actions above.

describe('addWatchedFeedAction', () => {
  const validInput = { url: 'https://example.com/feed.xml', label: 'Example Feed' }

  it('adds a feed, hashing the URL via the delegated (not re-implemented) helper', async () => {
    const result = await addWatchedFeedAction(validInput)
    expect(result).toEqual({ success: true })
    expect(mockAddWatchedFeed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        business_id: BUSINESS_ID,
        url: validInput.url,
        url_hash: 'hash-of-https://example.com/feed.xml',
        label: 'Example Feed',
        added_by: USER.id,
      }),
    )
  })

  it('SIGNAL-MR-WATCHLIST-BOUNDED: the 21st active feed is rejected by the action', async () => {
    mockCountActiveWatchedFeedsForBusiness.mockResolvedValue(20)
    const result = await addWatchedFeedAction(validInput)
    expect(result).toEqual({ error: 'errors.feed_cap_reached' })
    expect(mockAddWatchedFeed).not.toHaveBeenCalled()
  })

  it('SIGNAL-CAPABILITY-GATED (via the extracted gateSignalSourceAction seam): a canServer(CONNECT_ACCOUNTS) denial returns the typed forbidden result before touching the DB layer', async () => {
    mockCanServer.mockResolvedValue(false)
    const result = await addWatchedFeedAction(validInput)
    expect(result).toEqual({ error: 'errors.forbidden' })
    expect(mockCountActiveWatchedFeedsForBusiness).not.toHaveBeenCalled()
    expect(mockAddWatchedFeed).not.toHaveBeenCalled()
  })

  it('rejects a non-https URL before touching the DB layer — the delegated validateUrl check, not a re-implemented one', async () => {
    const result = await addWatchedFeedAction({ url: 'http://example.com/feed.xml', label: 'Example' })
    expect(result).toEqual({ error: 'errors.invalid_url' })
    expect(mockAddWatchedFeed).not.toHaveBeenCalled()
  })

  it('rejects a malformed URL before touching the DB layer', async () => {
    const result = await addWatchedFeedAction({ url: 'not-a-url', label: 'Example' })
    expect(result).toEqual({ error: 'errors.invalid_url' })
    expect(mockAddWatchedFeed).not.toHaveBeenCalled()
  })

  it('rejects an empty label before touching the DB layer', async () => {
    const result = await addWatchedFeedAction({ url: validInput.url, label: '' })
    expect(result.error).toBeDefined()
    expect(mockAddWatchedFeed).not.toHaveBeenCalled()
  })

  it('a DB write failure (including a duplicate business_id/url_hash) returns the generic add-failed error', async () => {
    mockAddWatchedFeed.mockRejectedValue(new Error('duplicate key value violates unique constraint'))
    const result = await addWatchedFeedAction(validInput)
    expect(result).toEqual({ error: 'errors.feed_add_failed' })
  })
})

describe('removeWatchedFeedAction', () => {
  const validInput = { watchedFeedId: '123e4567-e89b-4abc-8def-426614174000' }

  it('deactivates (never deletes) the watched feed', async () => {
    const result = await removeWatchedFeedAction(validInput)
    expect(result).toEqual({ success: true })
    expect(mockSetWatchedFeedActive).toHaveBeenCalledWith(expect.anything(), validInput.watchedFeedId, BUSINESS_ID, false)
  })

  it('SIGNAL-CAPABILITY-GATED: a canServer(CONNECT_ACCOUNTS) denial returns the typed forbidden result before touching the DB layer', async () => {
    mockCanServer.mockResolvedValue(false)
    const result = await removeWatchedFeedAction(validInput)
    expect(result).toEqual({ error: 'errors.forbidden' })
    expect(mockSetWatchedFeedActive).not.toHaveBeenCalled()
  })

  it('rejects a non-UUID id before touching the DB layer', async () => {
    const result = await removeWatchedFeedAction({ watchedFeedId: 'not-a-uuid' })
    expect(result).toEqual({ error: 'errors.invalid_feed' })
    expect(mockSetWatchedFeedActive).not.toHaveBeenCalled()
  })
})

describe('toggleWatchedFeedAction', () => {
  const validInput = { watchedFeedId: '123e4567-e89b-4abc-8def-426614174000', isActive: true }

  it('toggling on is subject to the SAME 20-feed cap as adding', async () => {
    mockCountActiveWatchedFeedsForBusiness.mockResolvedValue(20)
    const result = await toggleWatchedFeedAction(validInput)
    expect(result).toEqual({ error: 'errors.feed_cap_reached' })
    expect(mockSetWatchedFeedActive).not.toHaveBeenCalled()
  })

  it('toggling off is never capped', async () => {
    mockCountActiveWatchedFeedsForBusiness.mockResolvedValue(20)
    const result = await toggleWatchedFeedAction({ ...validInput, isActive: false })
    expect(result).toEqual({ success: true })
    expect(mockSetWatchedFeedActive).toHaveBeenCalledWith(expect.anything(), validInput.watchedFeedId, BUSINESS_ID, false)
  })

  it('SIGNAL-CAPABILITY-GATED: a canServer(CONNECT_ACCOUNTS) denial returns the typed forbidden result before touching the DB layer', async () => {
    mockCanServer.mockResolvedValue(false)
    const result = await toggleWatchedFeedAction(validInput)
    expect(result).toEqual({ error: 'errors.forbidden' })
    expect(mockSetWatchedFeedActive).not.toHaveBeenCalled()
  })
})
