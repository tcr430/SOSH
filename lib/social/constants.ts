import { PLATFORM_CONFIGS } from './platforms/config'

export const TOKEN_REFRESH_SKEW_SECONDS = 300

// ADR 0025 §2.2/§2.3 — provider-owned read bounds. These live in
// lib/social/, not lib/backfill/constants.ts, because lib/backfill must not
// own a provider contract; the orchestrator-owned bounds (max posts, lookback,
// pages, platform reads, cost ceilings) live there instead.
export const RECENT_POSTS_PAGE_SIZE_MIN = 5
export const RECENT_POSTS_PAGE_SIZE_MAX = 100
export const RECENT_POST_CONTENT_MAX_CHARS = 3000
export const SOCIAL_READ_TIMEOUT_MS = 10_000
export const SOCIAL_READ_RETRY_AFTER_CEILING_SECONDS = 900

// "Refuse, don't clamp" (ADR §2.3): an out-of-range pageSize is a caller
// bug, not platform data — clamping would silently change what the caller
// asked for. RangeError, not a SocialProviderError, because none of the
// eight codes describes a caller bug and ADR 0028 §7 settled that no new
// code is added. Shared so every implementation calls the SAME check,
// BEFORE any I/O, rather than each re-deriving its own bound check.
export function assertRecentPostsPageSize(pageSize: number): void {
  if (
    !Number.isInteger(pageSize) ||
    pageSize < RECENT_POSTS_PAGE_SIZE_MIN ||
    pageSize > RECENT_POSTS_PAGE_SIZE_MAX
  ) {
    throw new RangeError(
      `fetchRecentPosts: pageSize must be an integer between ${RECENT_POSTS_PAGE_SIZE_MIN} and ${RECENT_POSTS_PAGE_SIZE_MAX}, got ${pageSize}`,
    )
  }
}

// ADR 0028 §3.1 (N2.7). LinkedIn's Posts API requires a Linkedin-Version
// header and versions SUNSET on a rolling basis — 202508 already sunset on
// 2026-08-17 (N2.1, verified against vendor docs on 2026-09-04). No
// automated review mechanism exists to catch a sunset version before it
// starts failing every publish call (ADR 0028 §16 item 2, flagged, not
// built this session). Re-verify this value against LinkedIn's current
// Posts API documentation at any future touch of linkedin-provider.ts —
// do not assume it is still current just because it compiles.
export const LINKEDIN_VERSION = '202608'

export const LINKEDIN_REQUIRED_SCOPES = PLATFORM_CONFIGS.linkedin.scopes
export const TWITTER_REQUIRED_SCOPES = PLATFORM_CONFIGS.twitter.scopes
export const INSTAGRAM_REQUIRED_SCOPES = PLATFORM_CONFIGS.instagram.scopes
export const FACEBOOK_REQUIRED_SCOPES = PLATFORM_CONFIGS.facebook.scopes
export const THREADS_REQUIRED_SCOPES = PLATFORM_CONFIGS.threads.scopes
