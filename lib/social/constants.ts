import { PLATFORM_CONFIGS } from './platforms/config'

export const TOKEN_REFRESH_SKEW_SECONDS = 300

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
