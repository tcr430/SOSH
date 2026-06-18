import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock node:dns ──────────────────────────────────────────────────────────
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}))

// ── Mock undici ────────────────────────────────────────────────────────────
vi.mock('undici', () => ({
  fetch: vi.fn(),
  Agent: vi.fn().mockImplementation(function MockAgent() {}),
}))

// ── Mock config ────────────────────────────────────────────────────────────
vi.mock('@/lib/config', () => ({
  config: {
    server: {
      AI_WEBSITE_FETCH_TIMEOUT_MS: 5000,
      AI_WEBSITE_FETCH_MAX_BYTES: 512000,
    },
  },
}))

import { fetchWebsiteText } from './website-fetcher'
import { lookup } from 'node:dns/promises'
import { fetch as undiciFetch, Agent } from 'undici'

const mockLookup = vi.mocked(lookup)
const mockFetch = vi.mocked(undiciFetch)
const MockAgent = vi.mocked(Agent)

// Default: simulate a public IP that resolves cleanly
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

function mockSuccessResponse(body: string) {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    redirected: false,
    url: 'http://example.com',
    headers: { get: () => null },
    body: makeBodyStream(body),
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDns(PUBLIC_IP)
  mockSuccessResponse('<html><body><p>Hello world</p></body></html>')
})

// ── F-1: Scheme allow-list ────────────────────────────────────────────────

describe('F-1 — scheme allow-list', () => {
  it('returns null for file:// scheme', async () => {
    expect(await fetchWebsiteText('file:///etc/passwd')).toBeNull()
  })

  it('returns null for ftp:// scheme', async () => {
    expect(await fetchWebsiteText('ftp://example.com/file')).toBeNull()
  })

  it('allows http:// scheme', async () => {
    expect(await fetchWebsiteText('http://example.com')).not.toBeNull()
  })

  it('allows https:// scheme', async () => {
    expect(await fetchWebsiteText('https://example.com')).not.toBeNull()
  })
})

// ── F-14: Credentials in URL ──────────────────────────────────────────────

describe('F-14 — credentials in URL', () => {
  it('returns null for URL with username and password', async () => {
    expect(await fetchWebsiteText('http://user:pass@example.com')).toBeNull()
  })

  it('returns null for URL with only username', async () => {
    expect(await fetchWebsiteText('http://user@example.com')).toBeNull()
  })
})

// ── F-2: 127.0.0.0/8 loopback ────────────────────────────────────────────

describe('F-2 — 127.x.x.x loopback', () => {
  it('returns null for 127.0.0.1', async () => {
    mockDns('127.0.0.1')
    expect(await fetchWebsiteText('http://127.0.0.1')).toBeNull()
  })

  it('returns null for 127.5.5.5 (boundary)', async () => {
    mockDns('127.5.5.5')
    expect(await fetchWebsiteText('http://127.5.5.5')).toBeNull()
  })

  it('returns null for 127.255.255.255 (boundary)', async () => {
    mockDns('127.255.255.255')
    expect(await fetchWebsiteText('http://127.255.255.255')).toBeNull()
  })
})

// ── F-3: 10.0.0.0/8 private ──────────────────────────────────────────────

describe('F-3 — 10.x.x.x private', () => {
  it('returns null for 10.0.0.1', async () => {
    mockDns('10.0.0.1')
    expect(await fetchWebsiteText('http://10.0.0.1')).toBeNull()
  })

  it('returns null for 10.255.255.255 (boundary)', async () => {
    mockDns('10.255.255.255')
    expect(await fetchWebsiteText('http://10.255.255.255')).toBeNull()
  })
})

// ── F-4: 172.16.0.0/12 private ───────────────────────────────────────────

describe('F-4 — 172.16.0.0/12 private', () => {
  it('returns null for 172.16.0.1', async () => {
    mockDns('172.16.0.1')
    expect(await fetchWebsiteText('http://172.16.0.1')).toBeNull()
  })

  it('returns null for 172.31.255.255 (boundary)', async () => {
    mockDns('172.31.255.255')
    expect(await fetchWebsiteText('http://172.31.255.255')).toBeNull()
  })

  it('does NOT block 172.32.0.1 (outside /12 range)', async () => {
    mockDns('172.32.0.1')
    expect(await fetchWebsiteText('http://172.32.0.1')).not.toBeNull()
  })

  it('does NOT block 172.15.255.255 (below /12 range)', async () => {
    mockDns('172.15.255.255')
    expect(await fetchWebsiteText('http://172.15.255.255')).not.toBeNull()
  })
})

// ── F-5: 192.168.0.0/16 private ──────────────────────────────────────────

describe('F-5 — 192.168.x.x private', () => {
  it('returns null for 192.168.0.1', async () => {
    mockDns('192.168.0.1')
    expect(await fetchWebsiteText('http://192.168.0.1')).toBeNull()
  })

  it('returns null for 192.168.255.255 (boundary)', async () => {
    mockDns('192.168.255.255')
    expect(await fetchWebsiteText('http://192.168.255.255')).toBeNull()
  })
})

// ── F-6: 169.254.0.0/16 link-local ───────────────────────────────────────

describe('F-6 — 169.254.x.x link-local / metadata', () => {
  it('returns null for 169.254.169.254 (AWS metadata)', async () => {
    mockDns('169.254.169.254')
    expect(await fetchWebsiteText('http://169.254.169.254')).toBeNull()
  })

  it('returns null for 169.254.0.1', async () => {
    mockDns('169.254.0.1')
    expect(await fetchWebsiteText('http://169.254.0.1')).toBeNull()
  })
})

// ── F-7: IPv6 loopback and ULA ────────────────────────────────────────────

describe('F-7 — IPv6 loopback and ULA', () => {
  it('returns null for ::1 (loopback)', async () => {
    mockLookup.mockResolvedValue([{ address: '::1', family: 6 }] as never)
    expect(await fetchWebsiteText('http://[::1]')).toBeNull()
  })

  it('returns null for fc00::1 (ULA fc00::/7)', async () => {
    mockLookup.mockResolvedValue([{ address: 'fc00::1', family: 6 }] as never)
    expect(await fetchWebsiteText('http://[fc00::1]')).toBeNull()
  })

  it('returns null for fd00::1 (ULA fd00::/8 inside fc00::/7)', async () => {
    mockLookup.mockResolvedValue([{ address: 'fd00::1', family: 6 }] as never)
    expect(await fetchWebsiteText('http://[fd00::1]')).toBeNull()
  })
})

// ── C-mapped-ipv6: IPv4-mapped IPv6 bypass ────────────────────────────────

describe('C-mapped-ipv6 — IPv4-mapped IPv6', () => {
  it('returns null for ::ffff:127.0.0.1 (loopback via mapped IPv6)', async () => {
    mockLookup.mockResolvedValue([{ address: '::ffff:127.0.0.1', family: 6 }] as never)
    expect(await fetchWebsiteText('http://example.com')).toBeNull()
  })

  it('returns null for ::ffff:10.0.0.1 (private range via mapped IPv6)', async () => {
    mockLookup.mockResolvedValue([{ address: '::ffff:10.0.0.1', family: 6 }] as never)
    expect(await fetchWebsiteText('http://example.com')).toBeNull()
  })
})

// ── C-dns-all: any-blocked multi-address check ────────────────────────────

describe('C-dns-all — all resolved addresses checked', () => {
  it('returns null when ANY resolved address is blocked (public + private mix)', async () => {
    mockLookup.mockResolvedValue([
      { address: PUBLIC_IP, family: 4 },
      { address: '10.0.0.1', family: 4 },
    ] as never)
    expect(await fetchWebsiteText('http://dual-stack.example.com')).toBeNull()
  })

  it('allows fetch when all resolved addresses are public', async () => {
    mockLookup.mockResolvedValue([
      { address: PUBLIC_IP, family: 4 },
      { address: '93.184.216.35', family: 4 },
    ] as never)
    expect(await fetchWebsiteText('http://example.com')).not.toBeNull()
  })
})

// ── C-toctou: pinned dispatcher structural guarantee ──────────────────────

describe('C-toctou — pinned dispatcher', () => {
  it('constructs an Agent with a pinned lookup for each fetch call', async () => {
    // The TOCTOU fix is structural: fetchWebsiteText creates a new Agent with
    // a custom connect.lookup that always returns the IP we already validated.
    // This prevents DNS rebinding between our resolution check and the actual
    // TCP connection. CI tests cannot verify this at the network layer (fetch
    // is mocked), but we confirm Agent is constructed — meaning the pinned
    // dispatcher is wired in — on every successful fetch path.
    MockAgent.mockClear()
    await fetchWebsiteText('https://example.com')
    expect(MockAgent).toHaveBeenCalledOnce()
  })
})

// ── F-9: Redirect to private IP ──────────────────────────────────────────

describe('F-9 — redirect chain re-resolution', () => {
  it('returns null when redirect resolves to private IP', async () => {
    // First DNS call returns public IP (passes initial check)
    // After redirect, DNS re-resolves to 127.0.0.1
    mockLookup
      .mockResolvedValueOnce([{ address: PUBLIC_IP, family: 4 }] as never)
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as never)

    mockFetch.mockResolvedValue({
      ok: true,
      status: 301,
      redirected: true,
      url: 'http://internal.corp/secret',
      headers: { get: (h: string) => h === 'location' ? 'http://internal.corp/secret' : null },
      text: async () => 'redirected content',
      arrayBuffer: async () => new ArrayBuffer(0),
    } as never)

    expect(await fetchWebsiteText('http://example.com')).toBeNull()
  })
})

// ── Happy path ────────────────────────────────────────────────────────────

describe('happy path', () => {
  it('returns extracted text content for a valid public URL', async () => {
    mockSuccessResponse(`
      <html>
        <head><title>Acme Corp</title></head>
        <body>
          <nav>Navigation</nav>
          <script>alert("xss")</script>
          <style>.body { color: red }</style>
          <p>We build great software for B2B teams.</p>
          <footer>Footer content</footer>
        </body>
      </html>
    `)
    const result = await fetchWebsiteText('https://example.com')
    expect(result).not.toBeNull()
    expect(result).toContain('We build great software')
    // Script content should be stripped
    expect(result).not.toContain('alert')
    // Style content should be stripped
    expect(result).not.toContain('color: red')
  })

  it('collapses whitespace in extracted text', async () => {
    mockSuccessResponse('<html><body><p>   Hello    world   </p></body></html>')
    const result = await fetchWebsiteText('https://example.com')
    expect(result).not.toBeNull()
    expect(result).not.toMatch(/\s{2,}/)
  })
})

// ── F-10: Timeout ─────────────────────────────────────────────────────────

describe('F-10 — timeout', () => {
  it('returns null when fetch times out', async () => {
    mockFetch.mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'))
    expect(await fetchWebsiteText('http://example.com')).toBeNull()
  })
})

// ── F-11: Oversized response ──────────────────────────────────────────────

describe('F-11 — body size cap', () => {
  it('returns null when response body exceeds MAX_BYTES', async () => {
    const oversized = new Uint8Array(513000) // > 512000
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      redirected: false,
      url: 'http://example.com',
      headers: { get: () => null },
      body: makeBodyStream(oversized),
    } as never)
    expect(await fetchWebsiteText('http://example.com')).toBeNull()
  })
})

// ── DNS failure ───────────────────────────────────────────────────────────

describe('DNS failure (F-8/F-9 support)', () => {
  it('returns null when DNS lookup fails', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'))
    expect(await fetchWebsiteText('http://nonexistent.invalid')).toBeNull()
  })
})

// ── B18-029 extra reserved ranges (RFC 6890, RFC 5737, RFC 2544, RFC 4193) ───

describe('B18-029 — 0.0.0.0/8 (this-network / loopback evasion)', () => {
  it('returns null for 0.0.0.0 (network address)', async () => {
    mockDns('0.0.0.0')
    expect(await fetchWebsiteText('http://0.0.0.0')).toBeNull()
  })

  it('returns null for 0.1.2.3 (mid-range)', async () => {
    mockDns('0.1.2.3')
    expect(await fetchWebsiteText('http://0.1.2.3')).toBeNull()
  })
})

describe('B18-029 — CGNAT 100.64.0.0/10', () => {
  it('returns null for 100.96.0.1 (mid-range)', async () => {
    mockDns('100.96.0.1')
    expect(await fetchWebsiteText('http://100.96.0.1')).toBeNull()
  })
})

describe('B18-029 — TEST-NET-1 192.0.2.0/24', () => {
  it('returns null for 192.0.2.100 (mid-range)', async () => {
    mockDns('192.0.2.100')
    expect(await fetchWebsiteText('http://192.0.2.100')).toBeNull()
  })
})

describe('B18-029 — TEST-NET-2 198.51.100.0/24', () => {
  it('returns null for 198.51.100.100 (mid-range)', async () => {
    mockDns('198.51.100.100')
    expect(await fetchWebsiteText('http://198.51.100.100')).toBeNull()
  })
})

describe('B18-029 — TEST-NET-3 203.0.113.0/24', () => {
  it('returns null for 203.0.113.100 (mid-range)', async () => {
    mockDns('203.0.113.100')
    expect(await fetchWebsiteText('http://203.0.113.100')).toBeNull()
  })
})

describe('B18-029 — benchmark 198.18.0.0/15', () => {
  it('returns null for 198.18.100.1 (mid-range)', async () => {
    mockDns('198.18.100.1')
    expect(await fetchWebsiteText('http://198.18.100.1')).toBeNull()
  })
})

describe('B18-029 — Class E 240.0.0.0/4', () => {
  it('returns null for 248.0.0.1 (mid-range)', async () => {
    mockDns('248.0.0.1')
    expect(await fetchWebsiteText('http://248.0.0.1')).toBeNull()
  })
})

describe('B18-029 — broadcast 255.255.255.255/32', () => {
  it('returns null for 255.255.255.255', async () => {
    mockDns('255.255.255.255')
    expect(await fetchWebsiteText('http://255.255.255.255')).toBeNull()
  })
})

describe('B18-029 — IPv6 link-local fe80::/10', () => {
  it('returns null for fe80::1 (mid-range)', async () => {
    mockDns('fe80::1', 6)
    expect(await fetchWebsiteText('http://[fe80::1]')).toBeNull()
  })
})

describe('B18-029 — IPv6 documentation 2001:db8::/32', () => {
  it('returns null for 2001:db8::1 (mid-range)', async () => {
    mockDns('2001:db8::1', 6)
    expect(await fetchWebsiteText('http://[2001:db8::1]')).toBeNull()
  })
})
