import { lookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { Agent, fetch as undiciFetch } from 'undici'
import { config } from '@/lib/config'

const ALLOWED_SCHEMES = new Set(['http:', 'https:'])
const TEXT_TRUNCATE_CHARS = 50_000

// ── IP range blocklist ────────────────────────────────────────────────────

function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number)
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

function isBlockedIPv4(address: string): boolean {
  let n: number
  try {
    n = ipToNumber(address)
  } catch {
    return false
  }

  // 127.0.0.0/8 loopback
  if ((n & 0xff000000) >>> 0 === 0x7f000000) return true
  // 10.0.0.0/8 private
  if ((n & 0xff000000) >>> 0 === 0x0a000000) return true
  // 172.16.0.0/12 private
  if ((n & 0xfff00000) >>> 0 === 0xac100000) return true
  // 192.168.0.0/16 private
  if ((n & 0xffff0000) >>> 0 === 0xc0a80000) return true
  // 169.254.0.0/16 link-local
  if ((n & 0xffff0000) >>> 0 === 0xa9fe0000) return true

  // Additional reserved ranges (B18-029 / RFC 6890, RFC 5737, RFC 2544, RFC 4193).
  // 100.64.0.0/10 CGNAT
  if ((n & 0xffc00000) >>> 0 === 0x64400000) return true
  // 192.0.2.0/24 TEST-NET-1
  if ((n & 0xffffff00) >>> 0 === 0xc0000200) return true
  // 198.51.100.0/24 TEST-NET-2
  if ((n & 0xffffff00) >>> 0 === 0xc6336400) return true
  // 203.0.113.0/24 TEST-NET-3
  if ((n & 0xffffff00) >>> 0 === 0xcb007100) return true
  // 198.18.0.0/15 benchmark
  if ((n & 0xfffe0000) >>> 0 === 0xc6120000) return true
  // 240.0.0.0/4 Class E
  if ((n & 0xf0000000) >>> 0 === 0xf0000000) return true
  // 255.255.255.255/32 broadcast
  if (n === 0xffffffff) return true

  return false
}

function isBlockedIPv6(address: string): boolean {
  const lower = address.toLowerCase()
  if (lower === '::1') return true
  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) — extract and check as IPv4
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isBlockedIPv4(mapped[1])
  // fc00::/7 ULA — first byte is 0xfc or 0xfd
  const firstByte = parseInt(lower.split(':')[0].padStart(4, '0').slice(0, 2), 16)
  if (!isNaN(firstByte) && (firstByte & 0xfe) === 0xfc) return true

  // Additional reserved ranges (B18-029 / RFC 6890, RFC 5737, RFC 2544, RFC 4193).
  const groups = lower.split(':')
  const g0 = parseInt(groups[0] || '0', 16)
  // fe80::/10 link-local
  if (!isNaN(g0) && (g0 & 0xffc0) === 0xfe80) return true
  // 2001:db8::/32 documentation
  const g1 = parseInt(groups[1] || '0', 16)
  if (!isNaN(g0) && !isNaN(g1) && g0 === 0x2001 && g1 === 0x0db8) return true

  return false
}

async function resolveAndCheck(
  hostname: string,
): Promise<{ blocked: boolean; addresses: LookupAddress[] }> {
  try {
    const addresses = await lookup(hostname, { all: true })
    for (const { address, family } of addresses) {
      const blocked = family === 6 ? isBlockedIPv6(address) : isBlockedIPv4(address)
      if (blocked) return { blocked: true, addresses }
    }
    return { blocked: false, addresses }
  } catch {
    return { blocked: true, addresses: [] }
  }
}

// ── URL validation ────────────────────────────────────────────────────────

function validateUrl(raw: string): URL | null {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) return null
  // F-14: reject credentials
  if (parsed.username || parsed.password) return null
  return parsed
}

// ── HTML extraction ───────────────────────────────────────────────────────

function extractText(html: string): string {
  return html
    // Strip script blocks (including content)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    // Strip style blocks (including content)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    // Strip HTML comments
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Strip nav, header, footer tags and their content
    .replace(/<(?:nav|header|footer)\b[^>]*>[\s\S]*?<\/(?:nav|header|footer)>/gi, ' ')
    // Strip remaining HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Collapse all whitespace to single spaces
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TEXT_TRUNCATE_CHARS)
}

// ── Main export ───────────────────────────────────────────────────────────

export async function fetchWebsiteText(url: string): Promise<string | null> {
  try {
    const parsed = validateUrl(url)
    if (!parsed) return null

    // F-8 + C-toctou: resolve ALL addresses; reject if any is blocked; pin the
    // pre-resolved IP in the dispatcher so the TCP connect uses the same address
    // we validated — eliminates the DNS rebinding TOCTOU window.
    const { blocked, addresses } = await resolveAndCheck(parsed.hostname)
    if (blocked || addresses.length === 0) return null

    const timeoutMs = config.server.AI_WEBSITE_FETCH_TIMEOUT_MS
    const maxBytes = config.server.AI_WEBSITE_FETCH_MAX_BYTES

    const { address: ip1, family: f1 } = addresses[0]
    const dispatcher1 = new Agent({
      connect: { lookup: (_h, _o, cb) => cb(null, ip1, f1) },
    })

    let response = await undiciFetch(url, {
      dispatcher: dispatcher1,
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'SOSH-BrandVoice/1.0', Cookie: '' },
      redirect: 'manual',
    })

    // F-9: handle redirects manually, re-resolving on each hop (max 2)
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return null

      let redirectUrl: URL
      try {
        redirectUrl = new URL(location, url)
      } catch {
        return null
      }
      if (!ALLOWED_SCHEMES.has(redirectUrl.protocol)) return null
      if (redirectUrl.username || redirectUrl.password) return null

      const { blocked: b2, addresses: a2 } = await resolveAndCheck(redirectUrl.hostname)
      if (b2 || a2.length === 0) return null

      const { address: ip2, family: f2 } = a2[0]
      const dispatcher2 = new Agent({
        connect: { lookup: (_h, _o, cb) => cb(null, ip2, f2) },
      })

      response = await undiciFetch(redirectUrl.href, {
        dispatcher: dispatcher2,
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'SOSH-BrandVoice/1.0', Cookie: '' },
        redirect: 'manual',
      })

      // One more redirect level (max 2 total)
      if (response.status >= 300 && response.status < 400) {
        const location2 = response.headers.get('location')
        if (!location2) return null

        let redirectUrl2: URL
        try {
          redirectUrl2 = new URL(location2, redirectUrl.href)
        } catch {
          return null
        }
        if (!ALLOWED_SCHEMES.has(redirectUrl2.protocol)) return null
        if (redirectUrl2.username || redirectUrl2.password) return null

        const { blocked: b3, addresses: a3 } = await resolveAndCheck(redirectUrl2.hostname)
        if (b3 || a3.length === 0) return null

        const { address: ip3, family: f3 } = a3[0]
        const dispatcher3 = new Agent({
          connect: { lookup: (_h, _o, cb) => cb(null, ip3, f3) },
        })

        response = await undiciFetch(redirectUrl2.href, {
          dispatcher: dispatcher3,
          signal: AbortSignal.timeout(timeoutMs),
          headers: { 'User-Agent': 'SOSH-BrandVoice/1.0', Cookie: '' },
          redirect: 'error',
        })
      }
    }

    // F-11: body size cap — stream body to enforce cap before buffering
    const reader = response.body?.getReader()
    if (!reader) return null

    let received = 0
    const chunks: Uint8Array[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value?.length ?? 0
      if (received > maxBytes) {
        reader.cancel()
        return null
      }
      if (value) chunks.push(value)
    }

    const html = new TextDecoder().decode(Buffer.concat(chunks))
    const text = extractText(html)
    return text || null
  } catch {
    return null
  }
}
