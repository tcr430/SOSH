import { describe, it, expect } from 'vitest'
import { rehydrateSignals } from '@/lib/learning/rehydrate'
import { classify, type ClassifyAiOriginal, type ClassifyHumanFinal } from '@/lib/learning/classify'
import type { Platform } from '@/lib/db/types'

const ai: ClassifyAiOriginal = {
  postId: 'post-1',
  platform: 'linkedin' as Platform,
  format: 'single',
  renderedContent: 'We are synergistic leaders.',
  hashtags: [],
  threadPostCount: null,
}
const human: ClassifyHumanFinal = { humanContent: 'We are leaders.', humanHashtags: [] }

describe('rehydrateSignals', () => {
  it('round-trips a real classify() output through JSON serialization', () => {
    const voiceRules = {
      id: 'voice-1',
      business_id: 'biz-1',
      voice_axes: {
        formal_casual: 0,
        expert_peer: 0,
        serious_playful: 0,
        reserved_warm: 0,
        calm_energetic: 0,
        rational_emotional: 0,
        exclusive_inclusive: 0,
      },
      tone: [],
      target_audience: null,
      keywords: [],
      avoid_words: ['synergistic'],
      writing_examples: [],
      competitors: [],
      unique_value_prop: null,
      inferred_from_url: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      descriptor: 'test',
    }
    const result = classify(ai, human, voiceRules, [])
    const roundTripped = rehydrateSignals(JSON.parse(JSON.stringify(result)))
    expect(roundTripped).toEqual(result)
  })

  it('rejects a row whose _class does not match its own kind vocabulary', () => {
    const corrupted = {
      preferences: [
        {
          _class: 'preference',
          kind: 'unsourced_claim_removed', // a CorrectionKind value under a preference _class
          postId: 'post-1',
          platform: 'linkedin',
          detail: {},
        },
      ],
      corrections: [],
      inconclusive: [],
    }
    expect(() => rehydrateSignals(corrupted)).toThrow()
  })

  it('rejects a shape with a missing required field', () => {
    const corrupted = {
      preferences: [{ _class: 'preference', kind: 'length_delta', postId: 'post-1', detail: {} }],
      corrections: [],
      inconclusive: [],
    }
    expect(() => rehydrateSignals(corrupted)).toThrow()
  })

  it('rejects a non-object payload', () => {
    expect(() => rehydrateSignals(null)).toThrow()
    expect(() => rehydrateSignals('not an object')).toThrow()
  })
})
