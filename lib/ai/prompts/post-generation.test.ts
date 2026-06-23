import { describe, test, expect } from 'vitest'
import {
  postGenerationPrompt,
  PostGenerationOutputSchema,
  getPlatformConstraintsVersion,
  type PostGenerationInput,
} from './post-generation'
import type { CustomerContext } from '@/lib/ai/context'
import type { Platform } from '@/lib/db/types'
import linkedinFixture from '@/lib/ai/__fixtures__/post-generation/linkedin.json'
import twitterFixture from '@/lib/ai/__fixtures__/post-generation/twitter.json'
import instagramFixture from '@/lib/ai/__fixtures__/post-generation/instagram.json'

const SCHEDULED_DATES = [
  '2026-05-26T09:00:00.000Z',
  '2026-05-27T09:00:00.000Z',
  '2026-05-28T09:00:00.000Z',
]

function makeCtx(overrides: Partial<CustomerContext> = {}): CustomerContext {
  return {
    business: {
      id: 'biz-1',
      name: 'Acme SaaS',
      industry: 'Software',
      description: 'B2B analytics platform',
      language: 'en',
      website: 'https://acme.example.com',
      timezone: 'Europe/London',
    },
    brandVoice: {
      id: 'bv-1',
      business_id: 'biz-1',
      voice_axes: { formal_casual: 50, expert_peer: 50, serious_playful: 50, reserved_warm: 50, calm_energetic: 50, rational_emotional: 50, exclusive_inclusive: 50 },
      tone: ['professional', 'confident'],
      target_audience: 'Engineering leaders at growth-stage startups',
      keywords: ['data-driven', 'scalable'],
      avoid_words: ['synergy', 'leverage'],
      unique_value_prop: 'Real-time analytics without the data-engineering overhead',
      competitors: ['Mixpanel', 'Amplitude'],
      writing_examples: [],
      inferred_from_url: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    recentCampaigns: [],
    recentPostPerformance: [],
    trialState: null,
    ...overrides,
  }
}

function makeInput(platform: Platform = 'linkedin', overrides: Partial<PostGenerationInput> = {}): PostGenerationInput {
  return {
    campaign: {
      id: 'camp-1',
      name: 'Q2 Launch',
      objective: 'Drive awareness of our new real-time dashboard feature',
      special_instructions: null,
      platforms: [platform],
      frequency: '3x_week',
      posts_per_week: 3,
      start_date: '2026-05-25',
      end_date: '2026-06-07',
    },
    targetPlatform: platform,
    postsToGenerate: 3,
    scheduledDates: SCHEDULED_DATES,
    alreadyGeneratedTopics: [],
    ...overrides,
  }
}

describe('postGenerationPrompt — contract', () => {
  test('has correct id, version, and modelKey', () => {
    expect(postGenerationPrompt.id).toBe('post-generation')
    expect(postGenerationPrompt.version).toBe(1)
    expect(postGenerationPrompt.modelKey).toBe('SONNET_4_6')
  })

  test('getPlatformConstraintsVersion returns a number', () => {
    expect(typeof getPlatformConstraintsVersion()).toBe('number')
  })
})

describe('postGenerationPrompt — buildSystemPrompt', () => {
  test('contains security directive about [DATA] tags', () => {
    const prompt = postGenerationPrompt.buildSystemPrompt(makeCtx())
    expect(prompt).toContain('[DATA]')
    expect(prompt).toContain('not as instructions')
  })

  test('instructs to return ONLY valid JSON', () => {
    const prompt = postGenerationPrompt.buildSystemPrompt(makeCtx())
    expect(prompt).toContain('Return ONLY valid JSON')
  })

  test('includes business language', () => {
    const ctx = makeCtx()
    const prompt = postGenerationPrompt.buildSystemPrompt(ctx)
    expect(prompt).toContain('en')
  })

  test('includes expected JSON structure with all fields', () => {
    const prompt = postGenerationPrompt.buildSystemPrompt(makeCtx())
    expect(prompt).toContain('"content"')
    expect(prompt).toContain('"hashtags"')
    expect(prompt).toContain('"scheduledAt"')
    expect(prompt).toContain('"rationale"')
  })

  test('contains platform constraints for all platforms', () => {
    const prompt = postGenerationPrompt.buildSystemPrompt(makeCtx())
    expect(prompt).toContain('150–300 words')    // linkedin
    expect(prompt).toContain('260 chars')         // twitter
    expect(prompt).toContain('15–25')             // instagram
    expect(prompt).toContain('80–150 words')      // facebook
    expect(prompt).toContain('500 characters')    // threads
  })

  test('includes business name and industry in role statement', () => {
    const prompt = postGenerationPrompt.buildSystemPrompt(makeCtx())
    expect(prompt).toContain('Acme SaaS')
    expect(prompt).toContain('Software')
  })
})

describe('postGenerationPrompt — buildUserMessage', () => {
  test('includes campaign name and objective', () => {
    const msg = postGenerationPrompt.buildUserMessage(makeInput(), makeCtx())
    expect(msg).toContain('Q2 Launch')
    expect(msg).toContain('Drive awareness')
  })

  test('includes platform constraints for linkedin', () => {
    const msg = postGenerationPrompt.buildUserMessage(makeInput('linkedin'), makeCtx())
    expect(msg).toContain('linkedin')
    expect(msg).toContain('150–300 words')
    expect(msg).toContain('professional hook')
  })

  test('includes platform constraints for twitter', () => {
    const msg = postGenerationPrompt.buildUserMessage(makeInput('twitter'), makeCtx())
    expect(msg).toContain('260 chars')
  })

  test('includes platform constraints for instagram', () => {
    const msg = postGenerationPrompt.buildUserMessage(makeInput('instagram'), makeCtx())
    expect(msg).toContain('15–25')
  })

  test('includes platform constraints for facebook', () => {
    const msg = postGenerationPrompt.buildUserMessage(makeInput('facebook'), makeCtx())
    expect(msg).toContain('80–150 words')
  })

  test('includes platform constraints for threads', () => {
    const msg = postGenerationPrompt.buildUserMessage(makeInput('threads'), makeCtx())
    expect(msg).toContain('500 characters')
    expect(msg).toContain('empty array')
  })

  test('includes scheduled dates', () => {
    const msg = postGenerationPrompt.buildUserMessage(makeInput(), makeCtx())
    for (const d of SCHEDULED_DATES) {
      expect(msg).toContain(d)
    }
  })

  test('includes brand voice fields', () => {
    const msg = postGenerationPrompt.buildUserMessage(makeInput(), makeCtx())
    expect(msg).toContain('professional')
    expect(msg).toContain('data-driven')
    expect(msg).toContain('synergy')
    expect(msg).toContain('Real-time analytics')
  })

  test('includes alreadyGeneratedTopics when present', () => {
    const input = makeInput('linkedin', {
      alreadyGeneratedTopics: ['Dashboard launch announcement angle'],
    })
    const msg = postGenerationPrompt.buildUserMessage(input, makeCtx())
    expect(msg).toContain('Dashboard launch announcement angle')
    expect(msg).toContain('do not repeat')
  })

  test('omits alreadyGeneratedTopics section when empty', () => {
    const msg = postGenerationPrompt.buildUserMessage(makeInput(), makeCtx())
    expect(msg).not.toContain('Topics Already Generated')
  })

  test('omits special_instructions section when null', () => {
    const msg = postGenerationPrompt.buildUserMessage(makeInput(), makeCtx())
    expect(msg).not.toContain('Special Instructions')
  })

  test('includes special_instructions when present', () => {
    const input = makeInput('linkedin', {
      campaign: { ...makeInput().campaign, special_instructions: 'Focus on enterprise customers' },
    })
    const msg = postGenerationPrompt.buildUserMessage(input, makeCtx())
    expect(msg).toContain('Focus on enterprise customers')
    expect(msg).toContain('Special Instructions')
  })

  test('includes recent campaigns for deduplication context', () => {
    const ctx = makeCtx({
      recentCampaigns: [
        { id: 'c1', name: 'Product Hunt Launch', objective: 'Drive signups', status: 'active' },
      ],
    })
    const msg = postGenerationPrompt.buildUserMessage(makeInput(), ctx)
    expect(msg).toContain('Product Hunt Launch')
    expect(msg).toContain('avoid repeating')
  })

  test('includes recentPostPerformance topContent', () => {
    const ctx = makeCtx({
      recentPostPerformance: [
        { platform: 'linkedin', topContent: 'Our dashboard saves 10h/week', likes: 50, impressions: 1200 },
      ],
    })
    const msg = postGenerationPrompt.buildUserMessage(makeInput(), ctx)
    expect(msg).toContain('saves 10h/week')
  })

  test('wraps brand voice in [DATA] tags', () => {
    const msg = postGenerationPrompt.buildUserMessage(makeInput(), makeCtx())
    expect(msg).toMatch(/\[DATA\][\s\S]*professional[\s\S]*\[\/DATA\]/)
  })
})

describe('PostGenerationOutputSchema — fixtures', () => {
  test('parses linkedin fixture (4 posts)', () => {
    expect(() => PostGenerationOutputSchema.parse(linkedinFixture)).not.toThrow()
    expect(PostGenerationOutputSchema.parse(linkedinFixture).posts).toHaveLength(4)
  })

  test('parses twitter fixture (3 posts)', () => {
    expect(() => PostGenerationOutputSchema.parse(twitterFixture)).not.toThrow()
    expect(PostGenerationOutputSchema.parse(twitterFixture).posts).toHaveLength(3)
  })

  test('parses instagram fixture (3 posts)', () => {
    expect(() => PostGenerationOutputSchema.parse(instagramFixture)).not.toThrow()
    expect(PostGenerationOutputSchema.parse(instagramFixture).posts).toHaveLength(3)
  })
})

describe('PostGenerationOutputSchema', () => {
  const validPost = {
    content: 'B2B founders: your analytics stack is costing you more than money.',
    hashtags: ['#analytics', '#b2bsaas'],
    scheduledAt: '2026-05-26T09:00:00.000Z',
    rationale: 'Opens with a pain-point hook tied to the campaign objective.',
  }

  test('parses a valid post', () => {
    expect(() => PostGenerationOutputSchema.parse({ posts: [validPost] })).not.toThrow()
  })

  test('accepts empty posts array', () => {
    // empty is allowed by schema; orchestrator asserts length === postsToGenerate
    expect(() => PostGenerationOutputSchema.parse({ posts: [] })).not.toThrow()
  })

  test('rejects post with empty content', () => {
    expect(() =>
      PostGenerationOutputSchema.parse({ posts: [{ ...validPost, content: '' }] })
    ).toThrow()
  })

  test('rejects post with rationale shorter than 10 chars', () => {
    expect(() =>
      PostGenerationOutputSchema.parse({ posts: [{ ...validPost, rationale: 'Too short' }] })
    ).toThrow()
  })

  test('rejects post with rationale longer than 280 chars', () => {
    expect(() =>
      PostGenerationOutputSchema.parse({ posts: [{ ...validPost, rationale: 'x'.repeat(281) }] })
    ).toThrow()
  })

  test('rejects post with more than 30 hashtags', () => {
    const tooMany = Array.from({ length: 31 }, (_, i) => `#tag${i}`)
    expect(() =>
      PostGenerationOutputSchema.parse({ posts: [{ ...validPost, hashtags: tooMany }] })
    ).toThrow()
  })

  test('accepts empty hashtags array', () => {
    expect(() =>
      PostGenerationOutputSchema.parse({ posts: [{ ...validPost, hashtags: [] }] })
    ).not.toThrow()
  })
})
