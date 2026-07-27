import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { classify, type ClassifyAiOriginal, type ClassifyHumanFinal } from '@/lib/learning/classify'
import type { CoreVoiceRules } from '@/lib/memory/voice'
import type { EvidenceMemoryRow, Platform } from '@/lib/db/types'

function aiOriginal(overrides: Partial<ClassifyAiOriginal> = {}): ClassifyAiOriginal {
  return {
    postId: 'post-1',
    platform: 'linkedin' as Platform,
    format: 'single',
    renderedContent: 'Our platform is great.',
    hashtags: [],
    threadPostCount: null,
    ...overrides,
  }
}

function humanFinal(overrides: Partial<ClassifyHumanFinal> = {}): ClassifyHumanFinal {
  return {
    humanContent: 'Our platform is great.',
    humanHashtags: [],
    ...overrides,
  }
}

function evidenceRow(content: string): EvidenceMemoryRow {
  return {
    id: 'evidence-1',
    business_id: 'biz-1',
    source: 'manual',
    confidence: 1,
    observation_count: 1,
    status: 'active',
    sensitivity: 'public',
    public_use_permission: true,
    scope: 'brand',
    scope_ref: null,
    last_confirmed_at: null,
    recency_at: '2026-01-01T00:00:00.000Z',
    expires_at: null,
    deleted_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    kind: 'usage_data',
    content,
    source_url: null,
  }
}

function voiceRules(avoidWords: string[]): CoreVoiceRules {
  return {
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
    avoid_words: avoidWords,
    writing_examples: [],
    competitors: [],
    unique_value_prop: null,
    inferred_from_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    descriptor: 'test',
  }
}

describe('classify — the eleven kinds', () => {
  it('avoid_word_removed → preference', () => {
    const result = classify(
      aiOriginal({ renderedContent: 'We are synergistic industry leaders today' }),
      humanFinal({ humanContent: 'We are strong industry leaders today.' }),
      voiceRules(['synergistic']),
      [],
    )
    expect(result.preferences).toContainEqual(
      expect.objectContaining({ _class: 'preference', kind: 'avoid_word_removed' }),
    )
    expect(result.corrections).toEqual([])
    expect(result.inconclusive).toEqual([])
  })

  it('length_delta → preference, only past the 0.15 threshold', () => {
    const original = 'x'.repeat(100)
    const belowThreshold = classify(
      aiOriginal({ renderedContent: original }),
      humanFinal({ humanContent: 'x'.repeat(105) }),
      null,
      [],
    )
    expect(belowThreshold.preferences).toEqual([])

    const aboveThreshold = classify(
      aiOriginal({ renderedContent: original }),
      humanFinal({ humanContent: 'x'.repeat(130) }),
      null,
      [],
    )
    expect(aboveThreshold.preferences).toEqual([
      expect.objectContaining({ _class: 'preference', kind: 'length_delta' }),
    ])
  })

  it('hashtag_delta → preference', () => {
    const result = classify(
      aiOriginal({ hashtags: ['#saas', '#growth'] }),
      humanFinal({ humanHashtags: ['#saas', '#b2b'] }),
      null,
      [],
    )
    expect(result.preferences).toContainEqual(
      expect.objectContaining({ _class: 'preference', kind: 'hashtag_delta' }),
    )
  })

  it('cta_removed → preference (verdict changed from CTA to no-CTA)', () => {
    const result = classify(
      aiOriginal({ renderedContent: 'Sign up today for early access to our platform.' }),
      humanFinal({ humanContent: 'We shipped something new for our platform.' }),
      null,
      [],
    )
    expect(result.preferences).toContainEqual(
      expect.objectContaining({ _class: 'preference', kind: 'cta_removed' }),
    )
  })

  it('cta_added → preference (verdict changed from no-CTA to CTA)', () => {
    const result = classify(
      aiOriginal({ renderedContent: 'We shipped something new for our platform.' }),
      humanFinal({ humanContent: 'Sign up today for early access to our platform.' }),
      null,
      [],
    )
    expect(result.preferences).toContainEqual(
      expect.objectContaining({ _class: 'preference', kind: 'cta_added' }),
    )
  })

  it('thread_shortened → preference (thread family only)', () => {
    const result = classify(
      aiOriginal({
        format: 'thread',
        threadPostCount: 3,
        renderedContent: 'first segment here\n\n---\n\nsecond segment here\n\n---\n\nthird segment here',
      }),
      humanFinal({ humanContent: 'first segment here\n\n---\n\nsecond segment here' }),
      null,
      [],
    )
    expect(result.preferences).toContainEqual(
      expect.objectContaining({ _class: 'preference', kind: 'thread_shortened' }),
    )
  })

  it('thread_lengthened → preference (thread family only)', () => {
    const result = classify(
      aiOriginal({
        format: 'thread',
        threadPostCount: 2,
        renderedContent: 'first segment here\n\n---\n\nsecond segment here',
      }),
      humanFinal({
        humanContent: 'first segment here\n\n---\n\nsecond segment here\n\n---\n\nthird segment here',
      }),
      null,
      [],
    )
    expect(result.preferences).toContainEqual(
      expect.objectContaining({ _class: 'preference', kind: 'thread_lengthened' }),
    )
  })

  it('link_moved → preference', () => {
    const result = classify(
      aiOriginal({
        format: 'thread',
        threadPostCount: 3,
        renderedContent: 'https://sosh.app now\n\n---\n\nsegment two here\n\n---\n\nsegment three here',
      }),
      humanFinal({
        humanContent: 'segment two here\n\n---\n\nhttps://sosh.app now\n\n---\n\nsegment three here',
      }),
      null,
      [],
    )
    expect(result.preferences).toContainEqual(
      expect.objectContaining({ _class: 'preference', kind: 'link_moved' }),
    )
  })

  it('numbering_stripped → preference (thread family only)', () => {
    const result = classify(
      aiOriginal({
        format: 'thread',
        threadPostCount: 2,
        renderedContent: '1/ this is the first longer point\n\n---\n\n2/ this is the second longer point',
      }),
      humanFinal({
        humanContent: 'this is the first longer point\n\n---\n\nthis is the second longer point',
      }),
      null,
      [],
    )
    expect(result.preferences).toContainEqual(
      expect.objectContaining({ _class: 'preference', kind: 'numbering_stripped' }),
    )
  })

  it('unsourced_claim_removed → correction, when no pinned evidence backs the removed claim', () => {
    const result = classify(
      aiOriginal({ renderedContent: 'We serve 500 customers. Our platform is great.' }),
      humanFinal({ humanContent: 'Our platform is great.' }),
      null,
      [evidenceRow('Completely unrelated evidence about pricing.')],
    )
    expect(result.corrections).toContainEqual(
      expect.objectContaining({ _class: 'correction', kind: 'unsourced_claim_removed' }),
    )
    expect(result.inconclusive).toEqual([])
  })

  it('evidence_cited_claim_removed → inconclusive, when the removed claim IS backed by pinned evidence', () => {
    const result = classify(
      aiOriginal({ renderedContent: 'We serve 500 customers. Our platform is great.' }),
      humanFinal({ humanContent: 'Our platform is great.' }),
      null,
      [evidenceRow('We serve 500 customers.')],
    )
    expect(result.inconclusive).toContainEqual(
      expect.objectContaining({ _class: 'inconclusive', kind: 'evidence_cited_claim_removed' }),
    )
    expect(result.corrections).toEqual([])
  })

  it('avoid_word_added → inconclusive', () => {
    const result = classify(
      aiOriginal({ renderedContent: 'Our platform works well for teams.' }),
      humanFinal({ humanContent: 'Our synergistic platform works well for teams.' }),
      voiceRules(['synergistic']),
      [],
    )
    expect(result.inconclusive).toContainEqual(
      expect.objectContaining({ _class: 'inconclusive', kind: 'avoid_word_added' }),
    )
    expect(result.corrections).toEqual([])
  })
})

describe('LEARN-CORRECTION-REQUIRES-BRIEF', () => {
  const original = 'We serve 500 customers. Our platform is great.'
  const human = 'Our platform is great.'

  it('no frozen brief (empty pinnedEvidence) → inconclusive, never correction', () => {
    const result = classify(aiOriginal({ renderedContent: original }), humanFinal({ humanContent: human }), null, [])
    expect(result.corrections).toEqual([])
    expect(result.inconclusive).toEqual([
      expect.objectContaining({ _class: 'inconclusive', kind: 'evidence_cited_claim_removed' }),
    ])
  })

  it('empty pinned set (brief exists, nothing pinned) → inconclusive, never correction', () => {
    const result = classify(aiOriginal({ renderedContent: original }), humanFinal({ humanContent: human }), null, [])
    expect(result.corrections).toEqual([])
    expect(result.inconclusive.length).toBe(1)
  })

  it('a removed claim citing a pinned id → evidence_cited_claim_removed, not correction', () => {
    const result = classify(
      aiOriginal({ renderedContent: original }),
      humanFinal({ humanContent: human }),
      null,
      [evidenceRow('We serve 500 customers.')],
    )
    expect(result.corrections).toEqual([])
    expect(result.inconclusive).toEqual([
      expect.objectContaining({ _class: 'inconclusive', kind: 'evidence_cited_claim_removed' }),
    ])
  })
})

describe('LEARN-CLASSIFY-DETERMINISTIC', () => {
  it('the same golden fixture pair evaluated twice yields byte-identical output', () => {
    const ai = aiOriginal({
      format: 'thread',
      threadPostCount: 3,
      renderedContent: '1/ We serve 500 customers.\n\n---\n\n2/ Sign up now https://sosh.app\n\n---\n\n3/ Thanks!',
      hashtags: ['#saas', '#growth'],
    })
    const human = humanFinal({
      humanContent: 'We serve customers.\n\n---\n\nThanks!',
      humanHashtags: ['#saas', '#b2b'],
    })
    const rules = voiceRules(['leaders'])
    const evidence = [evidenceRow('irrelevant')]

    const first = classify(ai, human, rules, evidence)
    const second = classify(ai, human, rules, evidence)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })
})

describe('LEARN-HEURISTIC-FIRST', () => {
  it('no LLM client or AI runner is constructed on this path', () => {
    const diffSource = fs.readFileSync(path.join(__dirname, 'diff.ts'), 'utf8')
    const classifySource = fs.readFileSync(path.join(__dirname, 'classify.ts'), 'utf8')
    for (const source of [diffSource, classifySource]) {
      expect(source).not.toMatch(/anthropic/i)
      expect(source).not.toMatch(/runPrompt/)
      expect(source).not.toMatch(/@\/lib\/ai\//)
    }
  })
})
