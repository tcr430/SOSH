import { describe, test, expect } from 'vitest'
import { vectorToVoiceFields } from './translate'
import type { VoiceAxes } from '@/lib/validation/voice'
import { NEUTRAL_VOICE_AXES } from '@/lib/validation/voice'

const ALL_LOW: VoiceAxes = {
  formal_casual: 10,
  expert_peer: 10,
  serious_playful: 10,
  reserved_warm: 10,
  calm_energetic: 10,
  rational_emotional: 10,
  exclusive_inclusive: 10,
}

const ALL_HIGH: VoiceAxes = {
  formal_casual: 90,
  expert_peer: 90,
  serious_playful: 90,
  reserved_warm: 90,
  calm_energetic: 90,
  rational_emotional: 90,
  exclusive_inclusive: 90,
}

describe('vectorToVoiceFields — all-neutral', () => {
  test('returns balanced tone and locked descriptor for neutral vector', () => {
    const result = vectorToVoiceFields(NEUTRAL_VOICE_AXES)
    expect(result.tone).toEqual(['balanced'])
    expect(result.descriptor).toBe('A balanced, neutral voice with no strong leanings.')
  })
})

describe('vectorToVoiceFields — determinism', () => {
  test('same vector produces byte-identical tone[] and descriptor', () => {
    const v: VoiceAxes = { formal_casual: 20, expert_peer: 80, serious_playful: 50, reserved_warm: 70, calm_energetic: 30, rational_emotional: 60, exclusive_inclusive: 85 }
    const a = vectorToVoiceFields(v)
    const b = vectorToVoiceFields(v)
    expect(a.tone).toEqual(b.tone)
    expect(a.descriptor).toBe(b.descriptor)
  })
})

describe('vectorToVoiceFields — article correctness', () => {
  test('uses "An" when fc-neutral fragment starts with vowel ("approachable")', () => {
    // fc=50 → neutral → "approachable"; one non-neutral axis to exit the all-neutral lock
    const mixed: VoiceAxes = { ...NEUTRAL_VOICE_AXES, expert_peer: 80 }
    const { descriptor } = vectorToVoiceFields(mixed)
    expect(descriptor).toMatch(/^An approachable/)
  })

  test('uses "A" when fc-low fragment starts with consonant ("formal and polished")', () => {
    const v: VoiceAxes = { ...NEUTRAL_VOICE_AXES, formal_casual: 20 }
    const { descriptor } = vectorToVoiceFields(v)
    expect(descriptor).toMatch(/^A formal and polished/)
  })

  test('uses "an" before inclusive-high fragment ("inclusive and broad")', () => {
    const v: VoiceAxes = { ...NEUTRAL_VOICE_AXES, exclusive_inclusive: 90 }
    const { descriptor } = vectorToVoiceFields(v)
    expect(descriptor).toContain('reaching an inclusive and broad audience')
  })

  test('uses "a" before welcoming-neutral fragment ("welcoming")', () => {
    // fc=20 makes the vector non-all-neutral; ei=50 stays neutral → "welcoming"
    const v: VoiceAxes = { ...NEUTRAL_VOICE_AXES, formal_casual: 20 }
    const { descriptor } = vectorToVoiceFields(v)
    expect(descriptor).toContain('reaching a welcoming audience')
  })
})

describe('vectorToVoiceFields — grouped composition', () => {
  test('descriptor has exactly 3 sentences (not a flat 7-item list)', () => {
    const { descriptor } = vectorToVoiceFields(ALL_LOW)
    const nonEmptySentences = descriptor.split('.').filter(s => s.trim().length > 0)
    expect(nonEmptySentences).toHaveLength(3)
  })

  test('no single sentence contains 5 or more commas (ruling out flat enumeration)', () => {
    const { descriptor } = vectorToVoiceFields(ALL_LOW)
    for (const sentence of descriptor.split('.')) {
      const commaCount = (sentence.match(/,/g) ?? []).length
      expect(commaCount).toBeLessThan(5)
    }
  })

  test('all-low snapshot', () => {
    const { descriptor } = vectorToVoiceFields(ALL_LOW)
    expect(descriptor).toBe(
      'A formal and polished voice, reserved and restrained in delivery. ' +
      'Speaks with authority, reaching a selective and discerning audience. ' +
      'Serious and substantive, calm and composed in energy; rational and evidence-led in argumentation.',
    )
  })

  test('all-high snapshot', () => {
    const { descriptor } = vectorToVoiceFields(ALL_HIGH)
    expect(descriptor).toBe(
      'A casual and conversational voice, warm and personable in delivery. ' +
      'Speaks peer-to-peer, reaching an inclusive and broad audience. ' +
      'Playful and witty, energetic and driving in energy; emotionally resonant in argumentation.',
    )
  })
})

describe('vectorToVoiceFields — tone[]', () => {
  test('contains all 7 non-neutral tags in axis order for all-low vector', () => {
    const { tone } = vectorToVoiceFields(ALL_LOW)
    expect(tone).toEqual(['professional', 'authoritative', 'earnest', 'measured', 'calm', 'analytical', 'discerning'])
  })

  test('contains only the single non-neutral tag when one axis is non-neutral', () => {
    const v: VoiceAxes = { ...NEUTRAL_VOICE_AXES, formal_casual: 20 }
    const { tone } = vectorToVoiceFields(v)
    expect(tone).toEqual(['professional'])
  })

  test('returns ["balanced"] when all axes are neutral', () => {
    const { tone } = vectorToVoiceFields(NEUTRAL_VOICE_AXES)
    expect(tone).toEqual(['balanced'])
  })

  test('tone[] contains no duplicate tags', () => {
    const { tone } = vectorToVoiceFields(ALL_HIGH)
    expect(tone).toEqual([...new Set(tone)])
  })
})
