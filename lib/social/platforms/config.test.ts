import { describe, it, expect } from 'vitest'
import { PLATFORM_CONFIGS, isPublishingPlatform } from './config'

// SOCIAL-META-STILL-UNAVAILABLE (ADR 0028 build-guide N2.13, Reality 5).
// The removal means two native providers, honestly, not five — Instagram,
// Facebook and Threads remain publishingAvailable: false because Meta App
// Review (instagram_content_publish, pages_manage_posts,
// threads_content_publish) is an external, unbounded-time blocker this
// session does not and cannot close. A future edit that flips one of these
// to true without that review having happened would silently misrepresent
// the product's real capability — this scan makes the claim executable.
describe('SOCIAL-META-STILL-UNAVAILABLE', () => {
  it('covers exactly the five launch platforms (vacuity guard — a silently-dropped platform passes vacuously otherwise)', () => {
    expect(Object.keys(PLATFORM_CONFIGS).sort()).toEqual(
      ['facebook', 'instagram', 'linkedin', 'threads', 'twitter'].sort(),
    )
  })

  it('instagram, facebook and threads remain publishingAvailable: false — Meta App Review is not this session\'s to close', () => {
    expect(PLATFORM_CONFIGS.instagram.publishingAvailable).toBe(false)
    expect(PLATFORM_CONFIGS.facebook.publishingAvailable).toBe(false)
    expect(PLATFORM_CONFIGS.threads.publishingAvailable).toBe(false)
  })

  it('linkedin and twitter remain publishingAvailable: true — the two platforms this session actually shipped', () => {
    expect(PLATFORM_CONFIGS.linkedin.publishingAvailable).toBe(true)
    expect(PLATFORM_CONFIGS.twitter.publishingAvailable).toBe(true)
  })

  it('isPublishingPlatform narrows to exactly linkedin and twitter', () => {
    for (const platform of Object.keys(PLATFORM_CONFIGS) as (keyof typeof PLATFORM_CONFIGS)[]) {
      expect(isPublishingPlatform(platform)).toBe(platform === 'linkedin' || platform === 'twitter')
    }
  })
})
