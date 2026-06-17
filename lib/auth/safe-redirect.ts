// Recursively URL-decode up to 3 times, stopping when the result is idempotent.
// Returns null if decoding fails (malformed %) or if 3 passes still change the value
// (triple-encoded input → reject as untrusted).
export function decodeRedirectParam(value: string): string | null {
  let current = value
  for (let i = 0; i < 3; i++) {
    let next: string
    try {
      next = decodeURIComponent(current)
    } catch {
      return null
    }
    if (next === current) return current
    if (i === 2) return null
    current = next
  }
  return current
}

export function isSafeRedirect(value: string, locale: string): boolean {
  const decoded = decodeRedirectParam(value)
  if (decoded === null) return false
  return (
    decoded.startsWith(`/${locale}/`) &&
    !decoded.includes('://') &&
    !decoded.includes('..')
  )
}
