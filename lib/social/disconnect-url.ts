import type { Platform } from '@/lib/db/types'

// ADR 0028 §5.3 — disconnect/route.ts's disconnect handler resolves ONE
// named identity when accountId is present, and falls back to the
// pre-dual-identity single-account shape (refusing with 409 account_ambiguous
// if more than one active row exists) when it is absent. Extracted as a pure
// function so the dual-identity URL shape has direct Tier-2 coverage without
// driving the AlertDialog confirmation flow in a component test.
export function buildDisconnectUrl(platform: Platform, accountId?: string): string {
  return accountId
    ? `/api/social/${platform}/disconnect?accountId=${accountId}`
    : `/api/social/${platform}/disconnect`
}
