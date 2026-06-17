// Single source of truth for Sentry event scrubbing and sensitive-key redaction.
// Imported by: sentry.*.config.ts (beforeSend), lib/social/errors.ts (redactor).

const URL_QUERY_PATTERN = /([?&](?:token|code|state)=)[^&#]+/gi
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
// Matches email-shaped substrings within longer strings (e.g. error messages).
// Used by scrubString to catch bare emails embedded in Resend/provider error text.
const EMAIL_INLINE_PATTERN = /[^@\s]+@[^@\s]+\.[^@\s]+/g

// VALUE_PATTERNS deliberately over-matches on common 32+ hex strings
// (the /^[0-9a-f]{32,}$/i pattern). This will redact:
//   - git commit SHAs (40 hex)
//   - MD5/SHA digests
//   - content hashes, idempotency keys
// Over-redaction is the safe direction for a scrubber — a debugging
// breadcrumb missing a SHA is recoverable; a leaked credential is not.
// If a future debug surface needs un-redacted hashes, wire them through
// a separate breadcrumb field that bypasses this scrubber, rather than
// narrowing the pattern.

// Value-scan patterns: redact tokens, JWTs, Stripe keys, long hex strings (B18-076).
// Applied to every string leaf during recursive object traversal.
const VALUE_PATTERNS: ReadonlyArray<RegExp> = [
  /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/,  // JWT (header.payload.sig)
  /^sk_(live|test)_[A-Za-z0-9]{20,}$/,                     // Stripe secret key
  /^rk_(live|test)_[A-Za-z0-9]{20,}$/,                     // Stripe restricted key
  /^(Bearer|Token)\s+\S+$/i,                                // Authorization header value
  /^[0-9a-f]{32,}$/i,                                       // Long hex token (32+ chars)
]

function matchesValuePattern(value: string): boolean {
  return VALUE_PATTERNS.some((re) => re.test(value))
}

// B18-076 value-scan; shared with redactTokens in publishing/orchestrator.ts (18B-2D fix).
// Applies VALUE_PATTERNS to a single string leaf — returns '[REDACTED]' on match, original otherwise.
export function scrubStringValue(s: string): string {
  return matchesValuePattern(s) ? '[REDACTED]' : s
}

const EXCLUDED_PATHS = [
  /^\/api\/stripe\/webhook$/,
  /^\/api\/cron\//,
]

// All entries are lowercase with non-alphanumeric characters stripped.
// Catch-alls (token, secret, apikey) intentionally listed last — they match
// via normaliseKey substring containment; the explicit entries document intent.
export const REDACTED_KEYS: ReadonlySet<string> = new Set([
  'accesstoken', 'refreshtoken',
  'vaultaccesstokenid', 'vaultrefreshtokenid',
  'stripesecretkey', 'stripewebhooksecret',
  'cronsecret', 'oauthstatesecret', 'healthchecktoken',
  'upstashsignature', 'qstashcurrentsigningkey', 'qstashnextsigningkey',
  'sentryauthtoken', 'sentrydsn',
  'authorization', 'cookie', 'setcookie',
  'password', 'passwordconfirmation', 'newpassword',
  'token', 'secret', 'apikey',
])

// Catch-alls checked as substrings of the normalised key in addition to exact set membership.
export const CATCH_ALL_SUBSTRINGS: ReadonlyArray<string> = ['token', 'secret', 'apikey', 'authorization', 'cookie', 'password'] as const

export function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function shouldRedactKey(key: string): boolean {
  const n = normaliseKey(key)
  if (REDACTED_KEYS.has(n)) return true
  return CATCH_ALL_SUBSTRINGS.some((s) => n.includes(s))
}

export function isEmailLike(value: string): boolean {
  return EMAIL_PATTERN.test(value)
}

function redactEmail(value: string): string {
  const at = value.indexOf('@')
  return value[0] + '***' + value.slice(at)
}

function scrubUrlQuery(url: string): string {
  return url.replace(URL_QUERY_PATTERN, '$1[Filtered]')
}

// Exported for unit testing. Production consumers use scrubEvent or scrubString.
// Recursively redact keys matching REDACTED_KEYS, scrub email and token leaf values.
// depth: bounded at 5 to prevent excessive traversal of large nested objects.
// seen: WeakSet for cycle detection — circular references are replaced with '[CIRCULAR]'.
// Arrays > 100 elements and objects > 50 keys are truncated (performance guard).
export function scrubObject(obj: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof obj === 'string') {
    if (isEmailLike(obj)) return redactEmail(obj)
    if (matchesValuePattern(obj)) return '[REDACTED]'
    return obj
  }
  if (Array.isArray(obj)) {
    if (depth >= 5) return obj
    if (obj.length > 100) return ['[ARRAY_TRUNCATED]']
    return obj.map((item) => scrubObject(item, depth + 1, seen))
  }
  if (obj !== null && typeof obj === 'object') {
    if (depth >= 5) return obj
    if (seen.has(obj)) return '[CIRCULAR]'
    const record = obj as Record<string, unknown>
    if (Object.keys(record).length > 50) return '[OBJECT_TRUNCATED]'
    seen.add(obj)
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(record)) {
      result[k] = shouldRedactKey(k) ? '[Filtered]' : scrubObject(v, depth + 1, seen)
    }
    return result
  }
  return obj
}

// Applies URL-query scrubbing and email scrubbing to a free string.
// Handles both whole-string emails and emails embedded in longer text (e.g. error messages).
// Exposed for SocialProviderError.toJSON() and other callers without a full Sentry Event.
export function scrubString(value: string): string {
  const urlScrubbed = value.replace(URL_QUERY_PATTERN, '$1[Filtered]')
  return urlScrubbed.replace(EMAIL_INLINE_PATTERN, (match) => {
    const at = match.indexOf('@')
    return match[0] + '***' + match.slice(at)
  })
}

type ScrubbableBreadcrumb = {
  category?: string
  data?: Record<string, unknown>
}

type ScrubbableEvent = {
  request?: {
    url?: string
    headers?: Record<string, unknown>
    data?: unknown
  }
  breadcrumbs?: ScrubbableBreadcrumb[]
  user?: Record<string, unknown>
  contexts?: Record<string, unknown>
  tags?: Record<string, unknown>
  extra?: Record<string, unknown>
  exception?: {
    values?: Array<{ type?: string; value?: string }>
  }
}

function extractPathname(url: string): string | null {
  try {
    return new URL(url).pathname
  } catch {
    // url may be a relative path like /api/cron/publish
    return url.startsWith('/') ? url.split('?')[0] : null
  }
}

export function scrubEvent<E extends ScrubbableEvent>(event: E): E | null {
  // 1. Route-path exclusion
  if (typeof event.request?.url === 'string') {
    const pathname = extractPathname(event.request.url)
    if (pathname !== null && EXCLUDED_PATHS.some((re) => re.test(pathname))) {
      return null
    }
  }

  // Work on a shallow copy; deep copies are produced by scrubObject for mutated branches.
  const result: ScrubbableEvent = { ...event }

  // 2. URL-query scrubbing on request.url
  if (result.request) {
    result.request = { ...result.request }
    if (typeof result.request.url === 'string') {
      result.request.url = scrubUrlQuery(result.request.url)
    }
    // 3. Key-redaction on request.headers + request.data
    if (result.request.headers) {
      result.request.headers = scrubObject(result.request.headers) as Record<string, unknown>
    }
    if (result.request.data !== undefined) {
      result.request.data = scrubObject(result.request.data)
    }
  }

  // 2. URL-query scrubbing on breadcrumb data.url / data.to for nav+fetch categories
  // 3+4. Key-redaction and email scrubbing on breadcrumb data
  if (result.breadcrumbs) {
    result.breadcrumbs = result.breadcrumbs.map((crumb) => {
      if (!crumb.data) return crumb
      const updated = { ...crumb, data: { ...crumb.data } }
      if (crumb.category === 'navigation' || crumb.category === 'fetch') {
        if (typeof updated.data.url === 'string') {
          updated.data.url = scrubUrlQuery(updated.data.url)
        }
        if (typeof updated.data.to === 'string') {
          updated.data.to = scrubUrlQuery(updated.data.to)
        }
      }
      updated.data = scrubObject(updated.data) as Record<string, unknown>
      return updated
    })
  }

  // 3+4. Key-redaction and email scrubbing on event-level fields
  if (result.user) result.user = scrubObject(result.user) as Record<string, unknown>
  if (result.contexts) result.contexts = scrubObject(result.contexts) as Record<string, unknown>
  if (result.tags) result.tags = scrubObject(result.tags) as Record<string, unknown>
  if (result.extra) result.extra = scrubObject(result.extra) as Record<string, unknown>

  // 5. Scrub exception message values — Sentry includes err.message in exception.values[].value.
  // Provider error messages (e.g. Resend "invalid_recipient") may embed the recipient email.
  if (result.exception?.values) {
    result.exception = {
      ...result.exception,
      values: result.exception.values.map((ex) => ({
        ...ex,
        value: typeof ex.value === 'string' ? scrubString(ex.value) : ex.value,
      })),
    }
  }

  return result as E
}
