import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { GithubConnectionRow, WatchedRepoRow, SignalRow } from '@/lib/db/types'
import releaseValidFixture from './__fixtures__/github/release-valid.json'
import malformedReleaseFixture from './__fixtures__/github/malformed-release.json'

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@sentry/nextjs', () => ({
  withMonitor: vi.fn().mockImplementation((_slug: string, fn: () => unknown) => fn()),
  captureException: vi.fn(),
}))

const mockListConnectionsReadyForPoll = vi.hoisted(() => vi.fn())
const mockClaimGithubConnectionForPoll = vi.hoisted(() => vi.fn())
const mockCompleteGithubConnectionPoll = vi.hoisted(() => vi.fn())
const mockDeactivateGithubConnection = vi.hoisted(() => vi.fn())
const mockRecordGithubConnectionRateLimited = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/github-connections', () => ({
  listConnectionsReadyForPoll: mockListConnectionsReadyForPoll,
  claimGithubConnectionForPoll: mockClaimGithubConnectionForPoll,
  completeGithubConnectionPoll: mockCompleteGithubConnectionPoll,
  deactivateGithubConnection: mockDeactivateGithubConnection,
  recordGithubConnectionRateLimited: mockRecordGithubConnectionRateLimited,
}))

const mockListActiveWatchedReposForConnection = vi.hoisted(() => vi.fn())
const mockUpdateWatchedRepoPollCursor = vi.hoisted(() => vi.fn())
const mockDeactivateWatchedRepo = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/watched-repos', () => ({
  listActiveWatchedReposForConnection: mockListActiveWatchedReposForConnection,
  updateWatchedRepoPollCursor: mockUpdateWatchedRepoPollCursor,
  deactivateWatchedRepo: mockDeactivateWatchedRepo,
}))

const mockListSignalsForWatchedRepo = vi.hoisted(() => vi.fn())
const mockInsertSignal = vi.hoisted(() => vi.fn())
const mockUpdateSignalContent = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/signals', () => ({
  listSignalsForWatchedRepo: mockListSignalsForWatchedRepo,
  insertSignal: mockInsertSignal,
  updateSignalContent: mockUpdateSignalContent,
}))

const mockMintInstallationToken = vi.hoisted(() => vi.fn())
const mockGetReleases = vi.hoisted(() => vi.fn())
vi.mock('./github-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./github-client')>()
  return { ...actual, mintInstallationToken: mockMintInstallationToken, getReleases: mockGetReleases }
})

const mockUpsertScoredCandidate = vi.hoisted(() => vi.fn())
vi.mock('./score', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./score')>()
  return { ...actual, upsertScoredCandidate: mockUpsertScoredCandidate }
})

import { runSignalsTick } from './orchestrator'
import { GithubClientError } from './github-client'
import * as Sentry from '@sentry/nextjs'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const releaseValid = (releaseValidFixture as { body: unknown[] }).body[0]

function makeConnection(overrides: Partial<GithubConnectionRow> = {}): GithubConnectionRow {
  return {
    id: 'conn-1',
    business_id: 'biz-1',
    installation_id: 111,
    account_login: 'acme',
    is_active: true,
    connected_by: null,
    connected_at: '2026-07-01T00:00:00Z',
    last_poll_started_at: '2026-08-06T10:00:00Z',
    last_poll_completed_at: null,
    last_poll_status: null,
    rate_limited_until: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  }
}

function makeRepo(overrides: Partial<WatchedRepoRow> = {}): WatchedRepoRow {
  return {
    id: 'repo-1',
    business_id: 'biz-1',
    connection_id: 'conn-1',
    repo_id: 999,
    owner: 'acme',
    name: 'widgets',
    is_active: true,
    releases_etag: null,
    last_polled_at: '2026-08-05T10:00:00Z',
    weight: 10,
    added_by: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  }
}

function makeSignalRow(overrides: Partial<SignalRow> = {}): SignalRow {
  return {
    id: 'sig-1',
    business_id: 'biz-1',
    watched_repo_id: 'repo-1',
    source: 'github',
    kind: 'release',
    external_id: 'github:release:111111',
    title: 'v1.2.0 — Faster exports' as SignalRow['title'],
    body: "## What's new\n\n- Faster CSV export\n- Fixed a timezone bug" as SignalRow['body'],
    body_truncated: false,
    html_url: 'https://github.com/acme/widgets/releases/tag/v1.2.0',
    occurred_at: '2026-07-01T12:00:00Z',
    is_prerelease: false,
    author_is_bot: false,
    ingested_via: 'poll',
    // Verified byte-for-byte against live Postgres's
    // encode(sha256(title::bytea || '\x00'::bytea || body::bytea), 'hex')
    // for this exact title/body pair before this test was written.
    content_hash: 'c504df91dc0cec8779ccbc10c2ac3abe9097417dcc1cb0fa71f2b09c4d14295e',
    created_at: '2026-07-01T12:00:00Z',
    updated_at: '2026-07-01T12:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockListActiveWatchedReposForConnection.mockResolvedValue([])
  mockListSignalsForWatchedRepo.mockResolvedValue([])
  mockCompleteGithubConnectionPoll.mockResolvedValue(undefined)
  mockUpsertScoredCandidate.mockResolvedValue({ id: 'cand-1' })
})

describe('runSignalsTick — SIGNAL-TICK-OBSERVABLE (ADR §4.6)', () => {
  it('logs exactly ONE console.log per invocation with every §4.6 field present', async () => {
    mockListConnectionsReadyForPoll.mockResolvedValue([])
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runSignalsTick({ triggeredBy: 'qstash' })

    expect(logSpy).toHaveBeenCalledTimes(1)
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string)
    const expectedFields = [
      'kind', 'tick', 'triggeredBy', 'durationMs', 'connectionsClaimed', 'reposPolled',
      'notModified', 'signalsIngested', 'signalsUpdated', 'duplicates', 'candidatesUpserted',
      'revoked', 'rateLimited', 'notFound', 'malformed', 'failed',
    ]
    for (const field of expectedFields) expect(parsed).toHaveProperty(field)
    expect(parsed.kind).toBe('signals.tick')
    logSpy.mockRestore()
  })
})

describe('runSignalsTick — SIGNAL-FAILURE-ISOLATED (ADR §4.5/L-11)', () => {
  it('an unexpected (unclassified) error minting for one business does not prevent the next business from being polled, and is counted', async () => {
    const connA = makeConnection({ id: 'conn-a', business_id: 'biz-a', installation_id: 111 })
    const connB = makeConnection({ id: 'conn-b', business_id: 'biz-b', installation_id: 222 })
    mockListConnectionsReadyForPoll.mockResolvedValue([connA, connB])
    mockClaimGithubConnectionForPoll.mockImplementation(async (id: string) =>
      id === 'conn-a' ? connA : connB,
    )
    mockMintInstallationToken.mockImplementation(async (installationId: number) => {
      if (installationId === connA.installation_id) throw new Error('boom — unexpected bug')
      return { token: 'tok-b', expiresAt: '2026-08-06T11:00:00Z' }
    })

    const summary = await runSignalsTick({ triggeredBy: 'secret' })

    expect(summary.failed).toBe(1)
    expect(summary.connectionsClaimed).toBe(2)
    // business B still got its own mint attempt despite A's crash.
    expect(mockMintInstallationToken).toHaveBeenCalledTimes(2)
    expect(Sentry.captureException).toHaveBeenCalled()
  })
})

describe('runSignalsTick — the §4.5 failure table, row by row', () => {
  it('revoked (401 on mint): deactivates the connection and counts revoked', async () => {
    const conn = makeConnection()
    mockListConnectionsReadyForPoll.mockResolvedValue([conn])
    mockClaimGithubConnectionForPoll.mockResolvedValue(conn)
    mockMintInstallationToken.mockRejectedValue(new GithubClientError('revoked', 'installation revoked'))

    const summary = await runSignalsTick({ triggeredBy: 'secret' })

    expect(summary.revoked).toBe(1)
    expect(mockDeactivateGithubConnection).toHaveBeenCalledWith('biz-1', 'revoked')
    expect(Sentry.captureException).toHaveBeenCalled()
  })

  it('404 on mint (installation gone): treated as revoked, same containment', async () => {
    const conn = makeConnection()
    mockListConnectionsReadyForPoll.mockResolvedValue([conn])
    mockClaimGithubConnectionForPoll.mockResolvedValue(conn)
    mockMintInstallationToken.mockRejectedValue(new GithubClientError('not_found', 'installation not found'))

    const summary = await runSignalsTick({ triggeredBy: 'secret' })

    expect(summary.revoked).toBe(1)
    expect(mockDeactivateGithubConnection).toHaveBeenCalledWith('biz-1', 'revoked')
  })

  it('rate limited (403 + Retry-After on mint): sets rate_limited_until, no deactivation, counts rateLimited', async () => {
    const conn = makeConnection()
    mockListConnectionsReadyForPoll.mockResolvedValue([conn])
    mockClaimGithubConnectionForPoll.mockResolvedValue(conn)
    mockMintInstallationToken.mockRejectedValue(new GithubClientError('rate_limited', 'rate limited', 120))

    const summary = await runSignalsTick({ triggeredBy: 'secret' })

    expect(summary.rateLimited).toBe(1)
    expect(mockRecordGithubConnectionRateLimited).toHaveBeenCalledTimes(1)
    expect(mockRecordGithubConnectionRateLimited.mock.calls[0][0]).toBe('biz-1')
    expect(mockDeactivateGithubConnection).not.toHaveBeenCalled()
  })

  it('5xx (transient) on mint: counts failed, no state change', async () => {
    const conn = makeConnection()
    mockListConnectionsReadyForPoll.mockResolvedValue([conn])
    mockClaimGithubConnectionForPoll.mockResolvedValue(conn)
    mockMintInstallationToken.mockRejectedValue(new GithubClientError('transient', 'GitHub 500'))

    const summary = await runSignalsTick({ triggeredBy: 'secret' })

    expect(summary.failed).toBe(1)
    expect(mockDeactivateGithubConnection).not.toHaveBeenCalled()
    expect(mockRecordGithubConnectionRateLimited).not.toHaveBeenCalled()
  })

  it('404 fetching one repo: deactivates that repo, counts notFound, other repos unaffected', async () => {
    const conn = makeConnection()
    const repoA = makeRepo({ id: 'repo-a', name: 'gone' })
    const repoB = makeRepo({ id: 'repo-b', name: 'still-here' })
    mockListConnectionsReadyForPoll.mockResolvedValue([conn])
    mockClaimGithubConnectionForPoll.mockResolvedValue(conn)
    mockMintInstallationToken.mockResolvedValue({ token: 'tok', expiresAt: '2026-08-06T11:00:00Z' })
    mockListActiveWatchedReposForConnection.mockResolvedValue([repoA, repoB])
    mockGetReleases.mockImplementation(async (_token: string, _owner: string, repo: string) => {
      if (repo === 'gone') throw new GithubClientError('not_found', 'repo gone')
      return { status: 'not_modified' }
    })

    const summary = await runSignalsTick({ triggeredBy: 'secret' })

    expect(summary.notFound).toBe(1)
    expect(mockDeactivateWatchedRepo).toHaveBeenCalledWith('repo-a', 'biz-1')
    // Second repo still attempted — one repo's 404 doesn't abort the loop.
    expect(mockGetReleases).toHaveBeenCalledTimes(2)
    expect(summary.notModified).toBe(1)
  })

  it("403 fetching a repo (mid-connection rate limit): stops the rest of this connection's repos", async () => {
    const conn = makeConnection()
    const repoA = makeRepo({ id: 'repo-a' })
    const repoB = makeRepo({ id: 'repo-b' })
    mockListConnectionsReadyForPoll.mockResolvedValue([conn])
    mockClaimGithubConnectionForPoll.mockResolvedValue(conn)
    mockMintInstallationToken.mockResolvedValue({ token: 'tok', expiresAt: '2026-08-06T11:00:00Z' })
    mockListActiveWatchedReposForConnection.mockResolvedValue([repoA, repoB])
    mockGetReleases.mockRejectedValue(new GithubClientError('rate_limited', 'rate limited', 60))

    const summary = await runSignalsTick({ triggeredBy: 'secret' })

    expect(summary.rateLimited).toBe(1)
    // The shared installation budget means repoB is never attempted.
    expect(mockGetReleases).toHaveBeenCalledTimes(1)
    expect(mockCompleteGithubConnectionPoll).not.toHaveBeenCalled()
  })

  it('5xx fetching a repo: counts failed, continues to the next repo in the same connection', async () => {
    const conn = makeConnection()
    const repoA = makeRepo({ id: 'repo-a', name: 'flaky' })
    const repoB = makeRepo({ id: 'repo-b', name: 'fine' })
    mockListConnectionsReadyForPoll.mockResolvedValue([conn])
    mockClaimGithubConnectionForPoll.mockResolvedValue(conn)
    mockMintInstallationToken.mockResolvedValue({ token: 'tok', expiresAt: '2026-08-06T11:00:00Z' })
    mockListActiveWatchedReposForConnection.mockResolvedValue([repoA, repoB])
    mockGetReleases.mockImplementation(async (_token: string, _owner: string, repo: string) => {
      if (repo === 'flaky') throw new GithubClientError('transient', 'GitHub 500')
      return { status: 'not_modified' }
    })

    const summary = await runSignalsTick({ triggeredBy: 'secret' })

    expect(summary.failed).toBe(1)
    expect(mockGetReleases).toHaveBeenCalledTimes(2)
    expect(summary.notModified).toBe(1)
    expect(mockCompleteGithubConnectionPoll).toHaveBeenCalledWith('conn-1', 'biz-1', 'ok')
  })

  it('malformed release: skips the item, counts malformed, Sentry gets the repo id and issues, never the raw body', async () => {
    const conn = makeConnection()
    const repo = makeRepo()
    mockListConnectionsReadyForPoll.mockResolvedValue([conn])
    mockClaimGithubConnectionForPoll.mockResolvedValue(conn)
    mockMintInstallationToken.mockResolvedValue({ token: 'tok', expiresAt: '2026-08-06T11:00:00Z' })
    mockListActiveWatchedReposForConnection.mockResolvedValue([repo])
    mockGetReleases.mockResolvedValue({ status: 'ok', releases: [malformedReleaseFixture], etag: 'e1' })

    const summary = await runSignalsTick({ triggeredBy: 'secret' })

    expect(summary.malformed).toBe(1)
    expect(Sentry.captureException).toHaveBeenCalled()
    const call = vi.mocked(Sentry.captureException).mock.calls.find(
      (c) => (c[1] as { tags?: Record<string, unknown> })?.tags?.repo_id === String(repo.repo_id),
    )
    expect(call).toBeDefined()
    const context = call?.[1] as { extra?: { issues?: string[] } }
    const serializedExtra = JSON.stringify(context.extra ?? {})
    // The malformed fixture's body text must never appear in the Sentry payload.
    expect(serializedExtra).not.toContain('This payload is missing')
  })
})

describe('runSignalsTick — SIGNAL-POLL-CONDITIONAL (ADR §4.4)', () => {
  it('a 304 increments notModified and performs no writes', async () => {
    const conn = makeConnection()
    const repo = makeRepo()
    mockListConnectionsReadyForPoll.mockResolvedValue([conn])
    mockClaimGithubConnectionForPoll.mockResolvedValue(conn)
    mockMintInstallationToken.mockResolvedValue({ token: 'tok', expiresAt: '2026-08-06T11:00:00Z' })
    mockListActiveWatchedReposForConnection.mockResolvedValue([repo])
    mockGetReleases.mockResolvedValue({ status: 'not_modified' })

    const summary = await runSignalsTick({ triggeredBy: 'secret' })

    expect(summary.notModified).toBe(1)
    expect(mockListSignalsForWatchedRepo).not.toHaveBeenCalled()
    expect(mockUpdateWatchedRepoPollCursor).not.toHaveBeenCalled()
    expect(mockInsertSignal).not.toHaveBeenCalled()
  })
})

describe('runSignalsTick — SIGNAL-INGEST-IDEMPOTENT, app half (ADR §4.3)', () => {
  it('a genuinely new external_id is inserted and scored', async () => {
    const conn = makeConnection()
    const repo = makeRepo()
    mockListConnectionsReadyForPoll.mockResolvedValue([conn])
    mockClaimGithubConnectionForPoll.mockResolvedValue(conn)
    mockMintInstallationToken.mockResolvedValue({ token: 'tok', expiresAt: '2026-08-06T11:00:00Z' })
    mockListActiveWatchedReposForConnection.mockResolvedValue([repo])
    mockGetReleases.mockResolvedValue({ status: 'ok', releases: [releaseValid], etag: 'e2' })
    mockListSignalsForWatchedRepo.mockResolvedValue([])
    mockInsertSignal.mockResolvedValue({ status: 'inserted', signal: makeSignalRow() })

    const summary = await runSignalsTick({ triggeredBy: 'secret' })

    expect(summary.signalsIngested).toBe(1)
    expect(summary.duplicates).toBe(0)
    expect(mockUpsertScoredCandidate).toHaveBeenCalledTimes(1)
    expect(summary.candidatesUpserted).toBe(1)
    expect(mockUpdateWatchedRepoPollCursor).toHaveBeenCalledWith('repo-1', 'biz-1', 'e2')
  })

  it("a retried delivery's INSERT hitting 23505 (via insertSignal's duplicate result) counts as duplicates, not signalsIngested", async () => {
    const conn = makeConnection()
    const repo = makeRepo()
    mockListConnectionsReadyForPoll.mockResolvedValue([conn])
    mockClaimGithubConnectionForPoll.mockResolvedValue(conn)
    mockMintInstallationToken.mockResolvedValue({ token: 'tok', expiresAt: '2026-08-06T11:00:00Z' })
    mockListActiveWatchedReposForConnection.mockResolvedValue([repo])
    mockGetReleases.mockResolvedValue({ status: 'ok', releases: [releaseValid], etag: 'e3' })
    // Not yet visible to this tick's pre-read (the concurrent deliverer's
    // row hadn't committed when we listed), so the app-layer diff also
    // thinks it's new — the INSERT itself is what discovers the race.
    mockListSignalsForWatchedRepo.mockResolvedValue([])
    mockInsertSignal.mockResolvedValue({ status: 'duplicate' })

    const summary = await runSignalsTick({ triggeredBy: 'secret' })

    expect(summary.duplicates).toBe(1)
    expect(summary.signalsIngested).toBe(0)
    expect(mockUpsertScoredCandidate).not.toHaveBeenCalled()
  })

  it('an unchanged release (same external_id, identical title/body) is a duplicate — no write, no re-score', async () => {
    const conn = makeConnection()
    const repo = makeRepo()
    mockListConnectionsReadyForPoll.mockResolvedValue([conn])
    mockClaimGithubConnectionForPoll.mockResolvedValue(conn)
    mockMintInstallationToken.mockResolvedValue({ token: 'tok', expiresAt: '2026-08-06T11:00:00Z' })
    mockListActiveWatchedReposForConnection.mockResolvedValue([repo])
    mockGetReleases.mockResolvedValue({ status: 'ok', releases: [releaseValid], etag: 'e4' })
    // Existing row's content_hash matches what release-valid.json's exact
    // title/body hashes to (verified against live Postgres, see
    // makeSignalRow's comment) — an overlapping run over the SAME content.
    mockListSignalsForWatchedRepo.mockResolvedValue([makeSignalRow()])

    const summary = await runSignalsTick({ triggeredBy: 'secret' })

    expect(summary.duplicates).toBe(1)
    expect(summary.signalsUpdated).toBe(0)
    expect(mockUpdateSignalContent).not.toHaveBeenCalled()
    expect(mockInsertSignal).not.toHaveBeenCalled()
    expect(mockUpsertScoredCandidate).not.toHaveBeenCalled()
  })

  it('an edited release (same external_id, different content) updates in place and re-scores', async () => {
    const conn = makeConnection()
    const repo = makeRepo()
    mockListConnectionsReadyForPoll.mockResolvedValue([conn])
    mockClaimGithubConnectionForPoll.mockResolvedValue(conn)
    mockMintInstallationToken.mockResolvedValue({ token: 'tok', expiresAt: '2026-08-06T11:00:00Z' })
    mockListActiveWatchedReposForConnection.mockResolvedValue([repo])
    mockGetReleases.mockResolvedValue({ status: 'ok', releases: [releaseValid], etag: 'e5' })
    // A DIFFERENT stored hash than what release-valid.json actually hashes
    // to — simulating a prior version of this release with different text.
    mockListSignalsForWatchedRepo.mockResolvedValue([
      makeSignalRow({ content_hash: 'deadbeef00000000000000000000000000000000000000000000000000000' }),
    ])
    mockUpdateSignalContent.mockResolvedValue(makeSignalRow())

    const summary = await runSignalsTick({ triggeredBy: 'secret' })

    expect(summary.signalsUpdated).toBe(1)
    expect(summary.duplicates).toBe(0)
    expect(mockUpdateSignalContent).toHaveBeenCalledTimes(1)
    expect(mockUpsertScoredCandidate).toHaveBeenCalledTimes(1)
  })
})

describe('runSignalsTick — SIGNAL-REVOCATION-DETECTED (ADR §2.5)', () => {
  it('a 401 while minting flips is_active false via deactivateGithubConnection', async () => {
    const conn = makeConnection()
    mockListConnectionsReadyForPoll.mockResolvedValue([conn])
    mockClaimGithubConnectionForPoll.mockResolvedValue(conn)
    mockMintInstallationToken.mockRejectedValue(new GithubClientError('revoked', 'revoked'))

    await runSignalsTick({ triggeredBy: 'secret' })

    expect(mockDeactivateGithubConnection).toHaveBeenCalledWith('biz-1', 'revoked')
  })
})
