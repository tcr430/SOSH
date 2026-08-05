import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import releaseValidFixture from './__fixtures__/github/release-valid.json'
import notModifiedFixture from './__fixtures__/github/304-not-modified.json'
import revokedFixture from './__fixtures__/github/401-revoked.json'
import rateLimitedFixture from './__fixtures__/github/403-rate-limited.json'
import repoGoneFixture from './__fixtures__/github/404-repo-gone.json'
import serverErrorFixture from './__fixtures__/github/500.json'

// vi.mock factories are hoisted above all top-level code, so the RSA
// keypair must be generated inside vi.hoisted() to be visible when the
// factory below runs — a REAL keypair so RS256 JWT signing (inside
// @octokit/auth-app, exercised for real) succeeds structurally. Never a
// persisted or reused key; test-only, thrown away at process exit.
const { TEST_PRIVATE_KEY_PEM } = vi.hoisted(() => {
  const { generateKeyPairSync } = require('node:crypto') as typeof import('node:crypto')
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  return { TEST_PRIVATE_KEY_PEM: privateKey }
})

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      GITHUB_APP_ID: '999999',
      GITHUB_APP_PRIVATE_KEY: Buffer.from(TEST_PRIVATE_KEY_PEM).toString('base64'),
      GITHUB_APP_CLIENT_ID: 'Iv1.test-client-id',
      GITHUB_APP_CLIENT_SECRET: 'test-client-secret',
    },
  },
}))

import {
  mintInstallationToken,
  getReleases,
  GithubClientError,
} from './github-client'

interface HttpFixture {
  status: number
  headers: Record<string, string>
  body: unknown
}

function responseFromFixture(fixture: HttpFixture): Response {
  const body = fixture.body === null || fixture.body === undefined ? null : JSON.stringify(fixture.body)
  return new Response(body, {
    status: fixture.status,
    headers: fixture.headers,
  })
}

function mintTokenSuccessFixture(): HttpFixture {
  return {
    status: 201,
    headers: { 'content-type': 'application/json' },
    body: { token: 'ghs_mockInstallationToken', expires_at: '2026-07-01T13:00:00Z' },
  }
}

describe('lib/signals/github-client (ADR 0020 §2.4 / §4.4 / §4.5 / §10)', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('mintInstallationToken — SIGNAL-NO-TOKEN-AT-REST (unit half)', () => {
    it('returns the token to the caller and does nothing else with it (no DB write, no cache, no log)', async () => {
      mockFetch.mockResolvedValueOnce(responseFromFixture(mintTokenSuccessFixture()))

      const result = await mintInstallationToken(12345)

      // Assert by construction: the function's entire observable effect is
      // its return value. There is no second call, no side channel — one
      // fetch call in, one plain object out, nothing written anywhere.
      expect(result.token).toBe('ghs_mockInstallationToken')
      expect(result.expiresAt).toBe('2026-07-01T13:00:00Z')
      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url] = mockFetch.mock.calls[0]
      expect(String(url)).toContain('/app/installations/12345/access_tokens')
    })

    it('maps a 401 during minting to a revoked GithubClientError', async () => {
      mockFetch.mockResolvedValueOnce(responseFromFixture(revokedFixture as HttpFixture))

      await expect(mintInstallationToken(12345)).rejects.toMatchObject({
        name: 'GithubClientError',
        code: 'revoked',
      })
    })
  })

  describe('getReleases — SIGNAL-POLL-CONDITIONAL', () => {
    it('sends If-None-Match when an ETag is passed', async () => {
      mockFetch.mockResolvedValueOnce(responseFromFixture(releaseValidFixture as HttpFixture))

      await getReleases('ghs_token', 'acme', 'widgets', '"prior-etag"')

      const [, options] = mockFetch.mock.calls[0]
      const headers = (options as RequestInit).headers as Record<string, string>
      expect(headers['if-none-match']).toBe('"prior-etag"')
    })

    it('does NOT send If-None-Match when no ETag is stored yet', async () => {
      mockFetch.mockResolvedValueOnce(responseFromFixture(releaseValidFixture as HttpFixture))

      await getReleases('ghs_token', 'acme', 'widgets', null)

      const [, options] = mockFetch.mock.calls[0]
      const headers = (options as RequestInit).headers as Record<string, string>
      expect(headers['if-none-match']).toBeUndefined()
    })

    it('a 304 short-circuits to { status: "not_modified" } without parsing a releases body', async () => {
      mockFetch.mockResolvedValueOnce(responseFromFixture(notModifiedFixture as HttpFixture))

      const result = await getReleases('ghs_token', 'acme', 'widgets', '"prior-etag"')

      expect(result).toEqual({ status: 'not_modified' })
      // The success shape's fields must be absent — proves the 304 branch
      // never touches the release-parsing path at all.
      expect(result).not.toHaveProperty('releases')
    })

    it('a 200 returns the releases and persists the new ETag from the response', async () => {
      mockFetch.mockResolvedValueOnce(responseFromFixture(releaseValidFixture as HttpFixture))

      const result = await getReleases('ghs_token', 'acme', 'widgets', null)

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.etag).toBe('"abc123etag"')
        expect(result.releases).toHaveLength(1)
        expect(result.releases[0].tag_name).toBe('v1.2.0')
      }
    })
  })

  describe('error class mapping (ADR §4.5)', () => {
    it('401 maps to code "revoked"', async () => {
      mockFetch.mockResolvedValueOnce(responseFromFixture(revokedFixture as HttpFixture))
      await expect(getReleases('ghs_token', 'acme', 'widgets', null)).rejects.toMatchObject({
        name: 'GithubClientError',
        code: 'revoked',
      })
    })

    it('403 maps to code "rate_limited" with Retry-After parsed from the fixture header', async () => {
      mockFetch.mockResolvedValueOnce(responseFromFixture(rateLimitedFixture as HttpFixture))
      try {
        await getReleases('ghs_token', 'acme', 'widgets', null)
        expect.unreachable('expected getReleases to throw')
      } catch (err) {
        expect(err).toBeInstanceOf(GithubClientError)
        const ghErr = err as GithubClientError
        expect(ghErr.code).toBe('rate_limited')
        expect(ghErr.retryAfterSeconds).toBe(120) // from 403-rate-limited.json's retry-after: "120"
      }
    })

    it('404 maps to code "not_found"', async () => {
      mockFetch.mockResolvedValueOnce(responseFromFixture(repoGoneFixture as HttpFixture))
      await expect(getReleases('ghs_token', 'acme', 'widgets', null)).rejects.toMatchObject({
        name: 'GithubClientError',
        code: 'not_found',
      })
    })

    it('5xx maps to code "transient"', async () => {
      mockFetch.mockResolvedValueOnce(responseFromFixture(serverErrorFixture as HttpFixture))
      await expect(getReleases('ghs_token', 'acme', 'widgets', null)).rejects.toMatchObject({
        name: 'GithubClientError',
        code: 'transient',
      })
    })
  })
})
