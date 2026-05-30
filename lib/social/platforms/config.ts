import type { Platform } from '@/lib/db/types'

export interface PlatformOAuthConfig {
  displayName: string
  scopes: readonly string[]
  supportsRefreshToken: boolean
  tokenExpiryDays: number | null
  publishingAvailable: boolean
}

export const PLATFORM_CONFIGS: Record<Platform, PlatformOAuthConfig> = {
  linkedin: {
    displayName: 'LinkedIn',
    scopes: ['openid', 'profile', 'email', 'w_member_social'],
    supportsRefreshToken: false,
    tokenExpiryDays: 60,
    publishingAvailable: true,
  },
  twitter: {
    displayName: 'X (Twitter)',
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    supportsRefreshToken: true,
    tokenExpiryDays: null,
    publishingAvailable: true,
  },
  instagram: {
    displayName: 'Instagram',
    // instagram_content_publish deferred — requires Meta App Review
    scopes: ['instagram_basic', 'pages_show_list'],
    supportsRefreshToken: false,
    tokenExpiryDays: 60,
    publishingAvailable: false,
  },
  facebook: {
    displayName: 'Facebook',
    // pages_manage_posts deferred — requires Meta App Review
    scopes: ['pages_show_list', 'pages_read_engagement'],
    supportsRefreshToken: false,
    tokenExpiryDays: 60,
    publishingAvailable: false,
  },
  threads: {
    displayName: 'Threads',
    // threads_content_publish deferred
    scopes: ['threads_basic'],
    supportsRefreshToken: false,
    tokenExpiryDays: 60,
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
