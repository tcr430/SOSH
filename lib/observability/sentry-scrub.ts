// Single source of truth for Sentry event scrubbing and sensitive-key redaction.
// Imported by: sentry.*.config.ts (beforeSend), lib/social/errors.ts (redactor).

const URL_QUERY_PATTERN = /([?&](?:token|code|state)=)[^&#]+/gi
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
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
  'sentryauthtoken', 'sentrydsn',
  'authorization', 'cookie', 'setcookie',
  'password', 'passwordconfirmation', 'newpassword',
  'token', 'secret', 'apikey',
])

// Catch-alls checked as substrings of the normalised key in addition to exact set membership.
const CATCH_ALL_SUBSTRINGS = ['token', 'secret', 'apikey', 'authorization', 'cookie', 'password'] as const

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

// Recursively redact keys that match REDACTED_KEYS and scrub email leaf values.
function scrubObject(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return isEmailLike(obj) ? redactEmail(obj) : obj
  }
  if (Array.isArray(obj)) {
    return obj.map(scrubObject)
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = shouldRedactKey(k) ? '[Filtered]' : scrubObject(v)
    }
    return result
  }
  return obj
}

// Applies URL-query scrubbing and email-leaf scrubbing to a free string.
// Exposed for SocialProviderError.toJSON() and other callers that don't have
// a full Sentry Event shape.
export function scrubString(value: string): string {
  const urlScubbed = value.replace(URL_QUERY_PATTERN, '$1[Filtered]')
  return isEmailLike(urlScubbed) ? redactEmail(urlScubbed) : urlScubbed
}

type ScrubbableBreadcrumb = {
  category?: string
  data?: Record<string, unknown>
  [key: string]: unknown
}

type ScrubbableEvent = {
  request?: {
    url?: string
    headers?: Record<string, unknown>
    data?: unknown
    [key: string]: unknown
  }
  breadcrumbs?: ScrubbableBreadcrumb[]
  user?: Record<string, unknown>
  contexts?: Record<string, unknown>
  tags?: Record<string, unknown>
  extra?: Record<string, unknown>
  [key: string]: unknown
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

  return result as E
}
