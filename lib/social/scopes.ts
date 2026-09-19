// ADR 0025 §7.4 (I2.4) — `scopes_granted` is `text[] NULL` on social_accounts.
// NULL (never persisted) and [] (both TwitterProvider.exchangeOAuthCode and
// LinkedInProvider.exchangeOAuthCode can return an empty scopesGranted array
// when the platform's token response omits `scope`) mean the SAME thing:
// unknown, not "zero scopes granted". Never treat [] as a real answer —
// always go through this helper rather than checking `.length === 0` or
// `!== null` inline at each call site.
export function scopesGrantedUnknown(scopesGranted: readonly string[] | null): boolean {
  return scopesGranted === null || scopesGranted.length === 0
}
