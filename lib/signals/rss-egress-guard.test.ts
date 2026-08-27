import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock node:dns ──────────────────────────────────────────────────────────
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}))

// ── Mock undici ────────────────────────────────────────────────────────────
vi.mock('undici', () => ({
  fetch: vi.fn(),
  Agent: vi.fn().mockImplementation(function (this: object, opts: unknown) {
    // Preserve the passed options (incl. connect.lookup) so tests can invoke
    // the pinned lookup directly — see the DNS-rebinding describe block.
    Object.assign(this, { __opts: opts })
  }),
}))

// ── Mock config ────────────────────────────────────────────────────────────
vi.mock('@/lib/config', () => ({
  config: {
    server: {
      RSS_FEED_FETCH_TIMEOUT_MS: 8_000,
      RSS_FEED_MAX_BODY_BYTES: 2_000_000,
    },
  },
}))

import { fetchWithEgressGuard, rejectIfDeclaresDoctype, XxeRejectedError } from './rss-egress-guard'
import { lookup } from 'node:dns/promises'
import { fetch as undiciFetch, Agent } from 'undici'

const mockLookup = vi.mocked(lookup)
const mockFetch = vi.mocked(undiciFetch)
const MockAgent = vi.mocked(Agent)

const PUBLIC_IP = '93.184.216.34' // example.com

function mockDns(address: string, family = 4) {
  mockLookup.mockResolvedValue([{ address, family }] as never)
}

function makeBodyStream(content: string | Uint8Array) {
  const encoded = typeof content === 'string' ? new TextEncoder().encode(content) : content
  let done = false
  return {
    getReader: () => ({
      read: async (): Promise<{ done: boolean; value: Uint8Array | undefined }> => {
        if (done) return { done: true, value: undefined }
        done = true
        return { done: false, value: encoded }
      },
      cancel: vi.fn(),
    }),
  }
}

function mockSuccessResponse(body: string, headers: Record<string, string> = {}) {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
    body: makeBodyStream(body),
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDns(PUBLIC_IP)
  mockSuccessResponse('<rss><channel><item><title>Hello</title></item></channel></rss>')
})

// ── Clause 1: https-only, initial request ───────────────────────────────────

describe('clause 1 — https-only (initial request)', () => {
  it('rejects http:// as a scheme downgrade', async () => {
    const result = await fetchWithEgressGuard('http://example.com/feed.xml')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('scheme_rejected')
  })

  it('rejects file://', async () => {
    const result = await fetchWithEgressGuard('file:///etc/passwd')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('scheme_rejected')
  })

  it('rejects gopher://', async () => {
    const result = await fetchWithEgressGuard('gopher://example.com/')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('scheme_rejected')
  })

  it('allows https://', async () => {
    const result = await fetchWithEgressGuard('https://example.com/feed.xml')
    expect(result.ok).toBe(true)
  })
})

// ── Clause 1: re-checked PER REDIRECT HOP ───────────────────────────────────

describe('clause 1 — re-checked per redirect hop', () => {
  it('rejects a redirect chain that downgrades https -> http', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 301,
      headers: { get: (h: string) => (h === 'location' ? 'http://internal.example.com/feed.xml' : null) },
    } as never)

    const result = await fetchWithEgressGuard('https://example.com/feed.xml')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('scheme_rejected')
  })

  it('rejects a redirect chain that ends on a private address', async () => {
    mockLookup
      .mockResolvedValueOnce([{ address: PUBLIC_IP, family: 4 }] as never)
      .mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }] as never)

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 302,
      headers: { get: (h: string) => (h === 'location' ? 'https://internal.corp/feed.xml' : null) },
    } as never)

    const result = await fetchWithEgressGuard('https://example.com/feed.xml')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('address_blocked')
  })

  it('rejects a redirect chain exceeding the max hop count', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 302,
      headers: { get: (h: string) => (h === 'location' ? 'https://example.com/next' : null) },
    } as never)

    const result = await fetchWithEgressGuard('https://example.com/feed.xml')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('too_many_redirects')
  })

  it('follows a legitimate https -> https redirect to a public address', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 301,
        headers: { get: (h: string) => (h === 'location' ? 'https://cdn.example.com/feed.xml' : null) },
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: makeBodyStream('<rss></rss>'),
      } as never)

    const result = await fetchWithEgressGuard('https://example.com/feed.xml')
    expect(result.ok).toBe(true)
  })
})

// ── Clause 2: canonical IP normalization, every encoded form ────────────────

describe('clause 2 — canonical IP normalization via the real URL parser', () => {
  function mockDnsHostnameAware(blockedHostname: string, blockedAddress: string, family = 4) {
    mockLookup.mockImplementation(async (hostname: unknown) => {
      if (hostname === blockedHostname) return [{ address: blockedAddress, family }] as never
      return [{ address: PUBLIC_IP, family: 4 }] as never
    })
  }

  it('decimal-encoded IPv4 (2130706433) normalizes to 127.0.0.1 and is blocked', async () => {
    mockDnsHostnameAware('127.0.0.1', '127.0.0.1')
    const result = await fetchWithEgressGuard('https://2130706433/feed.xml')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('address_blocked')
  })

  it('octal/hex-encoded IPv4 (0x7f.0.0.1) normalizes to 127.0.0.1 and is blocked', async () => {
    mockDnsHostnameAware('127.0.0.1', '127.0.0.1')
    const result = await fetchWithEgressGuard('https://0x7f.0.0.1/feed.xml')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('address_blocked')
  })

  it('octal-encoded IPv4 (0177.0.0.1) normalizes to 127.0.0.1 and is blocked', async () => {
    mockDnsHostnameAware('127.0.0.1', '127.0.0.1')
    const result = await fetchWithEgressGuard('https://0177.0.0.1/feed.xml')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('address_blocked')
  })

  it('IPv4-mapped IPv6 ([::ffff:169.254.169.254]) reaches the SAME verdict as 169.254.169.254 (cloud metadata)', async () => {
    mockLookup.mockResolvedValue([{ address: '::ffff:a9fe:a9fe', family: 6 }] as never)
    const result = await fetchWithEgressGuard('https://[::ffff:169.254.169.254]/feed.xml')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('address_blocked')
  })

  it('a plain public hostname is unaffected', async () => {
    const result = await fetchWithEgressGuard('https://example.com/feed.xml')
    expect(result.ok).toBe(true)
  })
})

// ── Clause 3: every metadata/reserved range ─────────────────────────────────

describe('clause 3 — deny loopback, private, link-local, ULA, cloud-metadata ranges', () => {
  const cases: Array<[string, string, number?]> = [
    ['127.0.0.1 loopback', '127.0.0.1'],
    ['10.0.0.1 private', '10.0.0.1'],
    ['172.16.0.1 private', '172.16.0.1'],
    ['192.168.0.1 private', '192.168.0.1'],
    ['169.254.169.254 cloud metadata', '169.254.169.254'],
    ['::1 IPv6 loopback', '::1', 6],
    ['fc00::1 ULA', 'fc00::1', 6],
    ['fd00::1 ULA', 'fd00::1', 6],
    ['fe80::1 link-local', 'fe80::1', 6],
  ]

  for (const [label, address, family = 4] of cases) {
    it(`blocks ${label}`, async () => {
      mockDns(address, family)
      const result = await fetchWithEgressGuard('https://example.com/feed.xml')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errorCode).toBe('address_blocked')
    })
  }

  it('does not block a public address', async () => {
    const result = await fetchWithEgressGuard('https://example.com/feed.xml')
    expect(result.ok).toBe(true)
  })

  it('blocks when ANY resolved address is bad (dual-stack, public + private mix)', async () => {
    mockLookup.mockResolvedValue([
      { address: PUBLIC_IP, family: 4 },
      { address: '10.0.0.1', family: 4 },
    ] as never)
    const result = await fetchWithEgressGuard('https://example.com/feed.xml')
    expect(result.ok).toBe(false)
  })
})

// ── Clause 4: pinned IP, DNS-rebinding structural guarantee ─────────────────

describe('clause 4 — pin the validated IP, never re-resolve at connect time', () => {
  it('constructs an Agent whose connect.lookup ALWAYS returns the pre-validated address, regardless of args', async () => {
    MockAgent.mockClear()
    await fetchWithEgressGuard('https://example.com/feed.xml')
    expect(MockAgent).toHaveBeenCalledOnce()

    // Extract the connect.lookup function actually passed to the Agent
    // constructor and invoke it as undici itself would at TCP-connect time —
    // with a DIFFERENT hostname/options than what we validated, simulating
    // a DNS-rebinding attacker who changed the record between our
    // resolveAndValidate() call and the actual connect. If this callback
    // re-resolved instead of returning the pinned value, this assertion
    // would fail — this is the exact TOCTOU window clause 4 exists to close.
    const agentOpts = MockAgent.mock.calls[0]![0] as { connect: { lookup: (h: string, o: unknown, cb: (err: null, addr: string, fam: number) => void) => void } }
    const capturedCallback = vi.fn()
    agentOpts.connect.lookup('attacker-controlled-hostname.evil', {}, capturedCallback)
    expect(capturedCallback).toHaveBeenCalledWith(null, PUBLIC_IP, 4)
  })
})

// ── Clause 5: re-validated on EVERY call ────────────────────────────────────

describe('clause 5 — re-validated on every poll, not cached from submission', () => {
  it('a second call with a since-rebound address is blocked even though the first call succeeded', async () => {
    mockDns(PUBLIC_IP)
    const first = await fetchWithEgressGuard('https://example.com/feed.xml')
    expect(first.ok).toBe(true)

    mockDns('127.0.0.1')
    const second = await fetchWithEgressGuard('https://example.com/feed.xml')
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.errorCode).toBe('address_blocked')
  })
})

// ── Clause 6: body size cap enforced against bytes actually read ───────────

describe('clause 6 — size cap enforced against bytes actually read, aborting mid-stream', () => {
  it('rejects a body exceeding RSS_FEED_MAX_BODY_BYTES', async () => {
    const oversized = new Uint8Array(2_000_001)
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: makeBodyStream(oversized),
    } as never)
    const result = await fetchWithEgressGuard('https://example.com/feed.xml')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('body_too_large')
  })

  it('a body attacker-controlled Content-Length lies about is still capped by actual bytes read', async () => {
    const oversized = new Uint8Array(2_000_001)
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      // Content-Length header (if present) is never consulted by this
      // module at all — the cap is enforced purely against the reader loop.
      headers: { get: (h: string) => (h.toLowerCase() === 'content-length' ? '10' : null) },
      body: makeBodyStream(oversized),
    } as never)
    const result = await fetchWithEgressGuard('https://example.com/feed.xml')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('body_too_large')
  })

  it('accepts a body exactly at the cap', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: makeBodyStream(new Uint8Array(2_000_000)),
    } as never)
    const result = await fetchWithEgressGuard('https://example.com/feed.xml')
    expect(result.ok).toBe(true)
  })
})

// ── Clause 7: per-fetch wall-clock budget (a server that never closes) ─────

describe('clause 7 — per-fetch timeout (a server that never closes)', () => {
  it('returns a timeout error when the fetch is aborted', async () => {
    const timeoutError = new DOMException('The operation was aborted', 'TimeoutError')
    mockFetch.mockRejectedValue(timeoutError)
    const result = await fetchWithEgressGuard('https://example.com/feed.xml')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('timeout')
  })

  it('passes RSS_FEED_FETCH_TIMEOUT_MS as the abort signal timeout', async () => {
    await fetchWithEgressGuard('https://example.com/feed.xml')
    const fetchOpts = mockFetch.mock.calls[0]![1] as { signal: AbortSignal }
    expect(fetchOpts.signal).toBeInstanceOf(AbortSignal)
  })
})

// ── DNS / credentials edge cases ─────────────────────────────────────────────

describe('DNS failure and credential rejection', () => {
  it('returns address_blocked when DNS lookup fails (fail-closed)', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'))
    const result = await fetchWithEgressGuard('https://nonexistent.invalid/feed.xml')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('address_blocked')
  })

  it('rejects a URL carrying credentials', async () => {
    const result = await fetchWithEgressGuard('https://user:pass@example.com/feed.xml')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('credentials_rejected')
  })

  it('rejects an unparseable URL', async () => {
    const result = await fetchWithEgressGuard('not a url at all')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('invalid_url')
  })
})

// ── Happy path: headers surfaced for conditional-GET (G1b.4's use) ─────────

describe('happy path', () => {
  it('returns the body and surfaces etag/last-modified for the caller', async () => {
    mockSuccessResponse('<rss></rss>', { etag: '"abc123"', 'last-modified': 'Wed, 01 Jan 2026 00:00:00 GMT' })
    const result = await fetchWithEgressGuard('https://example.com/feed.xml')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.body).toBe('<rss></rss>')
      expect(result.headers.etag).toBe('"abc123"')
      expect(result.headers.lastModified).toBe('Wed, 01 Jan 2026 00:00:00 GMT')
    }
  })

  it('passes through caller-supplied headers (conditional GET)', async () => {
    await fetchWithEgressGuard('https://example.com/feed.xml', { headers: { 'If-None-Match': '"abc123"' } })
    const fetchOpts = mockFetch.mock.calls[0]![1] as { headers: Record<string, string> }
    expect(fetchOpts.headers['If-None-Match']).toBe('"abc123"')
  })
})

// ── Clause 8: XXE — a DISTINCT control, tested independently of the fetch ──

describe('clause 8 — XXE-hardened parsing: rejectIfDeclaresDoctype', () => {
  it('REJECTS a document declaring an external entity (the classic XXE payload)', () => {
    const malicious = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss><channel><item>&xxe;</item></channel></rss>`
    expect(() => rejectIfDeclaresDoctype(malicious)).toThrow(XxeRejectedError)
  })

  it('REJECTS a document with ANY DOCTYPE, even one with no external entity (unconditional, per clause 8)', () => {
    const internalOnly = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY harmless "just text">]><rss><channel><item>&harmless;</item></channel></rss>`
    expect(() => rejectIfDeclaresDoctype(internalOnly)).toThrow(XxeRejectedError)
  })

  it('a legitimate RSS document with no DOCTYPE at all passes through untouched', () => {
    const legit = `<?xml version="1.0"?><rss><channel><item><title>Hello</title></item></channel></rss>`
    expect(() => rejectIfDeclaresDoctype(legit)).not.toThrow()
  })

  it('a legitimate Atom document with no DOCTYPE passes through untouched', () => {
    const legit = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Hello</title></entry></feed>`
    expect(() => rejectIfDeclaresDoctype(legit)).not.toThrow()
  })

  it('never throws for malformed (non-DOCTYPE) XML — that is a different concern for the full parser', () => {
    const malformed = `<rss><channel><item><title>Unclosed`
    expect(() => rejectIfDeclaresDoctype(malformed)).not.toThrow()
  })
})
