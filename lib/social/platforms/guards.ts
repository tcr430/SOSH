import type { Platform } from '@/lib/db/types'

export const VALID_PLATFORMS: readonly Platform[] = [
  'linkedin',
  'twitter',
  'instagram',
  'facebook',
  'threads',
]

export function isPlatform(value: string): value is Platform {
  return (VALID_PLATFORMS as readonly string[]).includes(value)
}
