import { config } from '@/lib/config'
import type { Platform } from '@/lib/db/types'

// ADR 0028 §2.5 (D-β, N2.6). connect/route.ts previously derived redirectUri
// from request.nextUrl.origin (additionally attacker-influenceable via the
// Host header) while callback/route.ts derived it from config.server.APP_URL
// — two different values for the same OAuth flow. LinkedIn and X enforce an
// EXACT match between the authorize-time and exchange-time redirect_uri;
// The prior broker silently tolerated the mismatch, native providers will not. Both
// sides now call this ONE helper, reading only config.server.APP_URL.
export function getSocialRedirectUri(platform: Platform): string {
  return `${config.server.APP_URL}/api/social/${platform}/callback`
}
