import type { Platform } from '@/lib/db/types'

/**
 * Derives a public post URL from a platform + raw platform_post_id (R5 / ADR 0012 §6).
 *
 * Returns null when:
 * - platformPostId is null, empty, or whitespace-only
 * - The platform's post ID is opaque (requires username, page slug, or other
 *   context not stored in platform_post_id)
 *
 * Only twitter is derivable today: a tweet ID maps directly to x.com/i/web/status/{id}.
 * All other platforms require additional context not stored in the post row.
 */
export function buildPlatformPostUrl(
  platform: Platform,
  platformPostId: string | null,
): string | null {
  if (!platformPostId || !platformPostId.trim()) return null

  if (platform === 'twitter') {
    return `https://x.com/i/web/status/${platformPostId}`
  }

  return null
}
