import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { SignalInsert } from '@/lib/db/types'

// ── Mock the egress guard's FETCH half only — the XXE half
// (rejectIfDeclaresDoctype/XxeRejectedError) is imported REAL, so this file
// exercises the actual, unmocked XXE control end-to-end against the
// external-entity.xml fixture, not a stand-in. ─────────────────────────────
vi.mock('./rss-egress-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./rss-egress-guard')>()
  return {
    ...actual,
    fetchWithEgressGuard: vi.fn(),
  }
})

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      RSS_FEED_MAX_ITEMS_PER_FETCH: 50,
    },
  },
}))

import { fetchAndParseFeed } from './rss-client'
import { fetchWithEgressGuard } from './rss-egress-guard'

const mockFetchWithEgressGuard = vi.mocked(fetchWithEgressGuard)

const FIXTURES_DIR = path.join(__dirname, '__fixtures__', 'rss')
function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8')
}

const notModifiedFixture = JSON.parse(loadFixture('304-not-modified.json'))
const redirectChainFixture = JSON.parse(loadFixture('redirect-chain.json'))
const oversizedFixture = JSON.parse(loadFixture('oversized.json'))

function mockOk(body: string, headers: { etag?: string | null; lastModified?: string | null } = {}) {
  mockFetchWithEgressGuard.mockResolvedValue({
    ok: true,
    status: 200,
    body,
    headers: { etag: headers.etag ?? null, lastModified: headers.lastModified ?? null },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Every fixture ────────────────────────────────────────────────────────────

describe('valid-rss.xml — RSS 2.0', () => {
  it('parses both items with full title/link/date/body, no contributor field', async () => {
    mockOk(loadFixture('valid-rss.xml'))
    const result = await fetchAndParseFeed('https://competitor.example.com/blog/rss.xml')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.malformedCount).toBe(0)
    expect(result.articles).toHaveLength(2)
    expect(result.articles[0].title).toContain('new pricing tier')
    expect(result.articles[0].html_url).toBe('https://competitor.example.com/blog/new-pricing-tier')
    expect(result.articles[0].link).toBe('https://competitor.example.com/blog/new-pricing-tier')
    expect(result.articles[0].occurred_at).toBe(new Date('Mon, 01 Jun 2026 09:00:00 GMT').toISOString())
    // content:encoded preferred over description when both present
    expect(result.articles[0].body).toContain('mid-market teams')
  })

  it('falls back to <description> when <content:encoded> is absent', async () => {
    mockOk(loadFixture('valid-rss.xml'))
    const result = await fetchAndParseFeed('https://competitor.example.com/blog/rss.xml')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.articles[1].body).toContain('VP of Engineering hire')
  })
})

describe('valid-atom.xml — Atom', () => {
  it('parses the entry via rel="alternate" link, not rel="self"', async () => {
    mockOk(loadFixture('valid-atom.xml'))
    const result = await fetchAndParseFeed('https://widgetsinc.example.com/changelog/atom.xml')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.malformedCount).toBe(0)
    expect(result.articles).toHaveLength(1)
    expect(result.articles[0].title).toContain('real-time collaboration')
    expect(result.articles[0].html_url).toBe('https://widgetsinc.example.com/changelog/realtime-collab')
    expect(result.articles[0].body).toContain('real-time collaboration features')
  })
})

describe('malformed.xml — SIGNAL-MR-FEED-ISOLATED parser arm', () => {
  it('fails CLOSED with a typed error result, never throws', async () => {
    mockOk(loadFixture('malformed.xml'))
    const result = await fetchAndParseFeed('https://broken.example.com/feed.xml')
    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.errorCode).toBe('malformed_document')
  })
})

describe('empty.xml — a feed with zero items', () => {
  it('returns ok with an empty articles array, not an error', async () => {
    mockOk(loadFixture('empty.xml'))
    const result = await fetchAndParseFeed('https://quiet.example.com/rss.xml')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.articles).toHaveLength(0)
    expect(result.malformedCount).toBe(0)
  })
})

describe('external-entity.xml — XXE rejected BEFORE any xml2js parsing', () => {
  it('rejects with xxe_rejected, real (unmocked) rejectIfDeclaresDoctype', async () => {
    mockOk(loadFixture('external-entity.xml'))
    const result = await fetchAndParseFeed('https://malicious.example.com/feed.xml')
    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.errorCode).toBe('xxe_rejected')
  })
})

describe('304-not-modified.json — conditional GET', () => {
  it('returns status "not_modified" when the egress guard reports 304', async () => {
    mockFetchWithEgressGuard.mockResolvedValue({
      ok: true,
      status: notModifiedFixture.status,
      body: '',
      headers: { etag: notModifiedFixture.headers.etag, lastModified: null },
    })
    const result = await fetchAndParseFeed('https://competitor.example.com/blog/rss.xml', { etag: '"old-etag"' })
    expect(result.status).toBe('not_modified')
  })

  it('passes etag/lastModified through to the egress guard as conditional headers', async () => {
    mockOk(loadFixture('empty.xml'))
    await fetchAndParseFeed('https://quiet.example.com/rss.xml', { etag: '"my-etag"', lastModified: 'Wed, 01 Jan 2026 00:00:00 GMT' })
    const [, opts] = mockFetchWithEgressGuard.mock.calls[0]!
    expect(opts?.headers?.['If-None-Match']).toBe('"my-etag"')
    expect(opts?.headers?.['If-Modified-Since']).toBe('Wed, 01 Jan 2026 00:00:00 GMT')
  })
})

describe('redirect-chain.json — rejected by the validator', () => {
  it("propagates the egress guard's address_blocked rejection for a redirect chain ending on a private address", async () => {
    void redirectChainFixture // documents the scenario this mock represents
    mockFetchWithEgressGuard.mockResolvedValue({
      ok: false,
      errorCode: 'address_blocked',
      message: `could not safely resolve internal.corp.example (redirected to ${redirectChainFixture.finalHostResolvesTo})`,
    })
    const result = await fetchAndParseFeed('https://competitor.example.com/feed.xml')
    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.errorCode).toBe('address_blocked')
  })
})

describe('oversized.json — body exceeding the cap, aborted mid-stream', () => {
  it("propagates the egress guard's body_too_large rejection", async () => {
    void oversizedFixture // documents the scenario this mock represents
    mockFetchWithEgressGuard.mockResolvedValue({
      ok: false,
      errorCode: 'body_too_large',
      message: 'body exceeded 2000000 bytes',
    })
    const result = await fetchAndParseFeed('https://competitor.example.com/feed.xml')
    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.errorCode).toBe('body_too_large')
  })
})

// ── Per-tick item bound (ADR §3.4/§16) ──────────────────────────────────────

describe('per-tick item bound from lib/config.ts', () => {
  it('bounds parsed items to RSS_FEED_MAX_ITEMS_PER_FETCH, never a literal', async () => {
    const items = Array.from({ length: 60 }, (_, i) => `
      <item>
        <title>Item ${i}</title>
        <link>https://many.example.com/item-${i}</link>
        <guid>urn:uuid:item-${i}</guid>
        <pubDate>Mon, 01 Jun 2026 09:00:00 GMT</pubDate>
        <description>Item ${i} body.</description>
      </item>`).join('')
    const manyItemsXml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Many</title>${items}</channel></rss>`
    mockOk(manyItemsXml)
    const result = await fetchAndParseFeed('https://many.example.com/feed.xml')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    // Config mock sets RSS_FEED_MAX_ITEMS_PER_FETCH to 50; 60 items in the
    // feed must yield exactly 50 parsed articles, not 60.
    expect(result.articles).toHaveLength(50)
  })
})

// ── Unrecognized format ──────────────────────────────────────────────────────

describe('a document that is neither RSS 2.0 nor Atom', () => {
  it('fails closed with unrecognized_format', async () => {
    mockOk('<?xml version="1.0"?><somethingelse><notafeed/></somethingelse>')
    const result = await fetchAndParseFeed('https://weird.example.com/feed.xml')
    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.errorCode).toBe('unrecognized_format')
  })
})

// ── Per-item malformed skip (one bad item does not abort the others) ───────

describe('one malformed item among valid ones is skipped, not fatal', () => {
  it('increments malformedCount and still returns the valid articles', async () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Mix</title>
      <item><title>Good item</title><link>https://mix.example.com/good</link><pubDate>Mon, 01 Jun 2026 09:00:00 GMT</pubDate><description>ok</description></item>
      <item><link>https://mix.example.com/no-title</link><pubDate>Mon, 01 Jun 2026 09:00:00 GMT</pubDate><description>no title, invalid</description></item>
      </channel></rss>`
    mockOk(xml)
    const result = await fetchAndParseFeed('https://mix.example.com/feed.xml')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.articles).toHaveLength(1)
    expect(result.malformedCount).toBe(1)
  })
})

// ── SIGNAL-MR-NO-CONTRIBUTOR-IDENTITY: type-level assertion ─────────────────

describe('SIGNAL-MR-NO-CONTRIBUTOR-IDENTITY — structural, not a runtime filter', () => {
  it('ParsedArticle has no author/creator/byline/email field on its own type', async () => {
    mockOk(loadFixture('valid-rss.xml'))
    const result = await fetchAndParseFeed('https://competitor.example.com/blog/rss.xml')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const article = result.articles[0]
    // Runtime confirmation that the actual object has no such key at all —
    // the real guarantee is the TYPE-LEVEL one below, checked at compile time.
    expect(Object.keys(article)).not.toContain('author')
    expect(Object.keys(article)).not.toContain('creator')
    expect(Object.keys(article)).not.toContain('byline')
    expect(Object.keys(article)).not.toContain('email')
  })

  it('type-level: SignalInsert assignment compiles without any contributor-identity field required or accepted', () => {
    // This is a compile-time assertion masquerading as a runtime no-op: if
    // SignalInsert ever gained an author/creator/byline/email field, one of
    // two things would happen — either this object literal would fail to
    // compile (missing required field) or a contributor-identity field
    // typed into this literal would be a type error (no such property on
    // SignalInsert). Either way, `npx tsc --noEmit` catches drift here, not
    // this assertion.
    const insert: SignalInsert = {
      business_id: 'b',
      watched_feed_id: 'f',
      source: 'rss',
      kind: 'article',
      external_id: 'rss:abc',
      title: 'x' as SignalInsert['title'],
      occurred_at: new Date().toISOString(),
    }
    expect(insert).toBeDefined()
  })
})
