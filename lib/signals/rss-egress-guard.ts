// ADR 0023 §8.3 — the market-responsive (RSS) source's egress guard. Two
// SEPARATE controls, per the section title ("SSRF and XXE, as two separate
// controls"): fetchWithEgressGuard() is the SSRF half (clauses 1-7);
// rejectIfDeclaresDoctype() is the XXE half (clause 8). A caller (G1b.4's RSS
// client) uses BOTH — fetch, then reject-if-doctype on the returned body,
// BEFORE ever handing it to xml2js.
//
// §3.1: there is no installation, no token, no vault entry for this source —
// "there is no credential boundary, the egress guard IS the whole security
// boundary." This module carries that entire weight.
//
// Adapted from lib/ai/website-fetcher.ts's IP-blocking precedent, but
// STRICTER in three ways that precedent didn't need: (1) https-only, not
// http-or-https — a customer-supplied URL polled on a recurring schedule is
// a materially sharper SSRF surface than a one-shot onboarding fetch; (2)
// EVERY redirect hop is re-validated for scheme too, not just re-resolved
// for IP — an https->http downgrade mid-chain is rejected, not followed;
// (3) IPv4-mapped IPv6 is checked against its canonical HEX-group form
// (::ffff:a9fe:a9fe), not just the dotted form — see the comment on
// isBlockedIPv6 below for why: the WHATWG URL parser (Node's real IP parser,
// never a regex, satisfying ADR clause 2) normalizes to hex groups, not the
// dotted form website-fetcher.ts's regex expects.

import { lookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { Agent, fetch as undiciFetch } from 'undici'
import sax from 'sax'
import { config } from '@/lib/config'

// §8.3 clause 1 — https ONLY. Re-checked per redirect hop below, not just here.
const ALLOWED_SCHEME = 'https:'

// Bounds the manual redirect-following loop (clause 1's "re-checked per
// redirect hop" implies redirects ARE followed, just never blindly). Three
// hops is generous for a legitimate feed migration/CDN indirection while
// still bounding the total re-validation work per fetch.
const MAX_REDIRECTS = 3

export type EgressGuardErrorCode =
  | 'invalid_url'
  | 'scheme_rejected'
  | 'credentials_rejected'
  | 'dns_resolution_failed'
  | 'address_blocked'
  | 'too_many_redirects'
  | 'redirect_invalid'
  | 'timeout'
  | 'body_too_large'
  | 'fetch_failed'

export type EgressFetchResult =
  | { ok: true; status: number; body: string; headers: { etag: string | null; lastModified: string | null } }
  | { ok: false; errorCode: EgressGuardErrorCode; message: string }

export interface EgressFetchOptions {
  // Pass-through for G1b.4's conditional-GET layer (If-None-Match /
  // If-Modified-Since). This module has no opinion on 304 semantics — it
  // just returns whatever status the (re-validated, IP-pinned) server sent.
  headers?: Record<string, string>
}

// ── IP range blocklist (clause 3: loopback, private, link-local, ULA, cloud-
// metadata — plus the same B18-029 reserved-range hardening already proven
// in lib/ai/website-fetcher.ts, kept for house consistency) ────────────────

function ipv4ToNumber(ip: string): number {
  const parts = ip.split('.').map(Number)
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

function isBlockedIPv4(address: string): boolean {
  let n: number
  try {
    n = ipv4ToNumber(address)
  } catch {
    return false
  }

  // 0.0.0.0/8 — on Linux, TCP connect to 0.0.0.0 targets loopback: a
  // canonical loopback-SSRF evasion (B18-029).
  if ((n >>> 24) === 0) return true
  if ((n & 0xff000000) >>> 0 === 0x7f000000) return true // 127.0.0.0/8 loopback
  if ((n & 0xff000000) >>> 0 === 0x0a000000) return true // 10.0.0.0/8 private
  if ((n & 0xfff00000) >>> 0 === 0xac100000) return true // 172.16.0.0/12 private
  if ((n & 0xffff0000) >>> 0 === 0xc0a80000) return true // 192.168.0.0/16 private
  if ((n & 0xffff0000) >>> 0 === 0xa9fe0000) return true // 169.254.0.0/16 link-local / cloud metadata
  if ((n & 0xffc00000) >>> 0 === 0x64400000) return true // 100.64.0.0/10 CGNAT
  if ((n & 0xffffff00) >>> 0 === 0xc0000200) return true // 192.0.2.0/24 TEST-NET-1
  if ((n & 0xffffff00) >>> 0 === 0xc6336400) return true // 198.51.100.0/24 TEST-NET-2
  if ((n & 0xffffff00) >>> 0 === 0xcb007100) return true // 203.0.113.0/24 TEST-NET-3
  if ((n & 0xfffe0000) >>> 0 === 0xc6120000) return true // 198.18.0.0/15 benchmark
  if ((n & 0xf0000000) >>> 0 === 0xf0000000) return true // 240.0.0.0/4 Class E
  if (n === 0xffffffff) return true // 255.255.255.255/32 broadcast

  return false
}

function isBlockedIPv6(address: string): boolean {
  const lower = address.toLowerCase()
  if (lower === '::1') return true

  // IPv4-mapped IPv6 — Node's WHATWG URL parser (a real IP parser, per ADR
  // clause 2) normalizes a submitted ::ffff:169.254.169.254 to its canonical
  // HEX-group form, ::ffff:a9fe:a9fe, NOT the dotted form. Decode the two
  // trailing hex groups back into dotted-decimal for the IPv4 check.
  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16)
    const lo = parseInt(mappedHex[2], 16)
    const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
    return isBlockedIPv4(dotted)
  }
  // Defensive: also accept the dotted form directly, in case a caller (or a
  // future Node version) ever supplies it pre-normalized.
  const mappedDotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mappedDotted) return isBlockedIPv4(mappedDotted[1])

  const firstByte = parseInt(lower.split(':')[0].padStart(4, '0').slice(0, 2), 16)
  if (!isNaN(firstByte) && (firstByte & 0xfe) === 0xfc) return true // fc00::/7 ULA

  const groups = lower.split(':')
  const g0 = parseInt(groups[0] || '0', 16)
  if (!isNaN(g0) && (g0 & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  const g1 = parseInt(groups[1] || '0', 16)
  if (!isNaN(g0) && !isNaN(g1) && g0 === 0x2001 && g1 === 0x0db8) return true // 2001:db8::/32 documentation

  return false
}

async function resolveAndValidate(
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

// ── URL validation (clause 1: https-only; F-14 precedent: reject credentials) ─

function validateUrl(raw: string): URL | { errorCode: EgressGuardErrorCode; message: string } {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { errorCode: 'invalid_url', message: `not a valid URL: ${raw}` }
  }
  if (parsed.protocol !== ALLOWED_SCHEME) {
    return { errorCode: 'scheme_rejected', message: `scheme must be https:, got ${parsed.protocol}` }
  }
  if (parsed.username || parsed.password) {
    return { errorCode: 'credentials_rejected', message: 'URL must not carry credentials' }
  }
  return parsed
}

// ── Main export: the SSRF-guarded fetch (clauses 1-7) ───────────────────────

export async function fetchWithEgressGuard(
  url: string,
  options: EgressFetchOptions = {},
): Promise<EgressFetchResult> {
  let currentUrl = url
  let redirectCount = 0

  while (true) {
    const validated = validateUrl(currentUrl)
    if (!(validated instanceof URL)) {
      return { ok: false, errorCode: validated.errorCode, message: validated.message }
    }

    // Clause 5: re-validated on EVERY call (submission AND every poll) —
    // there is no cached/reused resolution anywhere in this module. A
    // domain that resolves cleanly today and internally next month is
    // caught the next time this function runs, not just once at signup.
    const { blocked, addresses } = await resolveAndValidate(validated.hostname)
    if (blocked || addresses.length === 0) {
      return { ok: false, errorCode: blocked ? 'address_blocked' : 'dns_resolution_failed', message: `could not safely resolve ${validated.hostname}` }
    }

    // Clause 4 — THE HIGHEST-RISK ITEM. Pin the validated address via
    // undici's connect.lookup hook: the request URL (and therefore the Host
    // header AND the TLS SNI/certificate check) still target the real
    // hostname, but the actual TCP connect is forced to the literal IP we
    // just validated — "validate then let fetch re-resolve" is exactly the
    // DNS-rebinding window this closes.
    const { address, family } = addresses[0]
    const dispatcher = new Agent({
      connect: { lookup: (_hostname, _opts, cb) => cb(null, address, family) },
    })

    let response
    try {
      response = await undiciFetch(currentUrl, {
        dispatcher,
        // Clause 7 (per-fetch half) — the per-tick half is the caller's
        // (G1b.5's ingestion loop) responsibility via
        // RSS_FEED_POLL_TICK_BUDGET_MS; this bounds ONE hop's wait.
        signal: AbortSignal.timeout(config.server.RSS_FEED_FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': 'SOSH-SignalsRSS/1.0', ...options.headers },
        redirect: 'manual',
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        return { ok: false, errorCode: 'timeout', message: `fetch of ${currentUrl} exceeded ${config.server.RSS_FEED_FETCH_TIMEOUT_MS}ms` }
      }
      return { ok: false, errorCode: 'fetch_failed', message: err instanceof Error ? err.message : String(err) }
    }

    // 304 Not Modified is in the 3xx range but is NOT a redirect — it has
    // no Location header and no body. Bug found integrating G1b.4's
    // conditional-GET caller: excluding it here is required, or a 304
    // falls into the redirect branch below and fails with
    // 'redirect_invalid' (no Location header) instead of surfacing as the
    // successful "unchanged" outcome the caller (rss-client.ts) expects.
    if (response.status === 304) {
      return {
        ok: true,
        status: 304,
        body: '',
        headers: { etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified') },
      }
    }

    if (response.status >= 300 && response.status < 400) {
      redirectCount += 1
      if (redirectCount > MAX_REDIRECTS) {
        return { ok: false, errorCode: 'too_many_redirects', message: `exceeded ${MAX_REDIRECTS} redirects` }
      }
      const location = response.headers.get('location')
      if (!location) return { ok: false, errorCode: 'redirect_invalid', message: 'redirect with no Location header' }

      let redirectUrl: URL
      try {
        redirectUrl = new URL(location, currentUrl)
      } catch {
        return { ok: false, errorCode: 'redirect_invalid', message: `invalid redirect target: ${location}` }
      }
      // Clause 1, re-checked per hop: an https -> http downgrade is
      // REJECTED, not followed, even though `new URL(location, base)`
      // would happily resolve it — the loop's top re-runs validateUrl()
      // against this new URL next iteration.
      currentUrl = redirectUrl.href
      continue
    }

    // §8.3 clause 6 — size cap enforced against bytes ACTUALLY READ,
    // aborting mid-stream. Content-Length is attacker-controlled and may be
    // absent or false; a check against the header alone is not the control.
    const reader = response.body?.getReader()
    if (!reader) return { ok: false, errorCode: 'fetch_failed', message: 'response had no readable body' }

    const maxBytes = config.server.RSS_FEED_MAX_BODY_BYTES
    let received = 0
    const chunks: Uint8Array[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value?.length ?? 0
      if (received > maxBytes) {
        reader.cancel()
        return { ok: false, errorCode: 'body_too_large', message: `body exceeded ${maxBytes} bytes` }
      }
      if (value) chunks.push(value)
    }

    const body = new TextDecoder().decode(Buffer.concat(chunks))
    return {
      ok: true,
      status: response.status,
      body,
      headers: {
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
      },
    }
  }
}

// ── XXE control (clause 8) — a DISTINCT control from the fetch above ───────

export class XxeRejectedError extends Error {
  constructor(doctypeContent: string) {
    // §7.2/§7.3 posture: identifiers only, never body text, even in an
    // internal error message — doctypeContent is truncated defensively,
    // never logged or surfaced to a customer-facing surface by this class
    // itself (a caller's own logging discipline is out of this module's
    // control, but nothing here encourages logging the full payload).
    super(`document declares a DOCTYPE (${doctypeContent.length} chars) — rejected unconditionally per ADR 0023 §8.3 clause 8`)
    this.name = 'XxeRejectedError'
  }
}

// §8.3 clause 8 — "DTD and external-entity resolution disabled
// UNCONDITIONALLY." sax (xml2js's own parser) never fetches external
// entities in the first place — there is no flag to misconfigure, because
// the capability does not exist in the library (verified: sax's own docs
// state fetching DTDs is not implemented). This function is the ACTIVE half
// of "unconditional": rather than relying on that passive immunity alone, it
// REJECTS any document that declares a DOCTYPE at all, closed and internal
// entities included — not just ones with a SYSTEM/PUBLIC external
// reference. A legitimate RSS/Atom document has no reason to declare one.
export function rejectIfDeclaresDoctype(xml: string): void {
  const parser = sax.parser(false, { lowercase: true })
  let doctypeContent: string | null = null

  parser.ondoctype = (dt: string) => {
    doctypeContent = dt
  }
  // sax surfaces malformed-XML errors via onerror rather than throwing
  // synchronously; this function's only job is the DOCTYPE check, so a
  // parse error here is not this function's concern — a caller's own
  // full parse (G1b.4, via xml2js) is what surfaces malformed input.
  parser.onerror = () => {
    parser.resume()
  }

  parser.write(xml).close()

  if (doctypeContent !== null) {
    throw new XxeRejectedError(doctypeContent)
  }
}
