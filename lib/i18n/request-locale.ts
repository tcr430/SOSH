import { routing } from '@/i18n/routing'

// next-intl's middleware tells the rendering layer which locale won through
// the X-NEXT-INTL-LOCALE request header. proxy.ts builds its final response
// from a CLONE of the request headers (it adds x-pathname and x-nonce), so the
// header next-intl set on its own response is dropped unless proxy.ts re-sets
// it — every page then rendered the default locale (QA-LOCALE-HEADER-DROPPED).
export const NEXT_INTL_LOCALE_HEADER = 'X-NEXT-INTL-LOCALE'

// With localePrefix 'always', a request that reaches the render step carries a
// valid locale as its first path segment; anything else is the default.
export function resolveRequestLocale(pathname: string): string {
  const first = pathname.split('/')[1] ?? ''
  return (routing.locales as readonly string[]).includes(first) ? first : routing.defaultLocale
}
