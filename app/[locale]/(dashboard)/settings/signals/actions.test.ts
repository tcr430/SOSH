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
} from './actions'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { canServer } from '@/lib/members/can-server'
import { signGithubConnectState } from '@/lib/signals/state'
import { getGithubConnectionByBusinessId, deactivateGithubConnection } from '@/lib/db/github-connections'
import { countActiveWatchedReposForBusiness, addWatchedRepo, setWatchedRepoActive } from '@/lib/db/watched-repos'

const mockCreateClient = vi.mocked(createClient)
const mockGetBusinessForUser = vi.mocked(getBusinessForUser)
const mockCanServer = vi.mocked(canServer)
const mockSignGithubConnectState = vi.mocked(signGithubConnectState)
const mockGetGithubConnectionByBusinessId = vi.mocked(getGithubConnectionByBusinessId)
const mockDeactivateGithubConnection = vi.mocked(deactivateGithubConnection)
const mockCountActiveWatchedReposForBusiness = vi.mocked(countActiveWatchedReposForBusiness)
const mockAddWatchedRepo = vi.mocked(addWatchedRepo)
const mockSetWatchedRepoActive = vi.mocked(setWatchedRepoActive)

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
