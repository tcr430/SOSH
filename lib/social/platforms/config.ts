import type { Platform } from '@/lib/db/types'

export interface PlatformOAuthConfig {
  displayName: string
  scopes: readonly string[]
  supportsRefreshToken: boolean
  // ADR 0028 §4.2 (N2.8). Was tokenExpiryDays: number | null — a unit that
  // CANNOT express X's real 2-hour access-token life. Nothing in lib/social/
  // currently computes from this field (grepped repo-wide before renaming;
  // withFreshToken/connection-status.ts both read social_accounts
  // .token_expires_at directly, which is set from each native provider's
  // own token response — its authoritative expires_in). This field is
  // informational only today, but an informational field asserting a
  // falsehood is still a falsehood.
  tokenExpirySeconds: number | null
  publishingAvailable: boolean
}

export const PLATFORM_CONFIGS: Record<Platform, PlatformOAuthConfig> = {
  linkedin: {
    displayName: 'LinkedIn',
    scopes: ['openid', 'profile', 'email', 'w_member_social'],
    supportsRefreshToken: false,
    tokenExpirySeconds: 60 * 86400, // 60 days, verified N2.1
    publishingAvailable: true,
  },
  twitter: {
    displayName: 'X (Twitter)',
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    supportsRefreshToken: true,
    tokenExpirySeconds: 2 * 3600, // 2 hours, verified N2.1 — the reason this field was renamed
    publishingAvailable: true,
  },
  instagram: {
    displayName: 'Instagram',
    // instagram_content_publish deferred — requires Meta App Review
    scopes: ['instagram_basic', 'pages_show_list'],
    supportsRefreshToken: false,
    tokenExpirySeconds: 60 * 86400,
    publishingAvailable: false,
  },
  facebook: {
    displayName: 'Facebook',
    // pages_manage_posts deferred — requires Meta App Review
    scopes: ['pages_show_list', 'pages_read_engagement'],
    supportsRefreshToken: false,
    tokenExpirySeconds: 60 * 86400,
    publishingAvailable: false,
  },
  threads: {
    displayName: 'Threads',
    // threads_content_publish deferred
    scopes: ['threads_basic'],
    supportsRefreshToken: false,
    tokenExpirySeconds: 60 * 86400,
    publishingAvailable: false,
  },
}

export function getPlatformConfig(platform: Platform): PlatformOAuthConfig {
  return PLATFORM_CONFIGS[platform]
}

export function publishingAvailableFor(platform: Platform): boolean {
  return PLATFORM_CONFIGS[platform].publishingAvailable
}

type PublishingPlatform = 'linkedin' | 'twitter'

export function isPublishingPlatform(platform: Platform): platform is PublishingPlatform {
  return PLATFORM_CONFIGS[platform].publishingAvailable
}
