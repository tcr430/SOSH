import { describe, it, expect } from 'vitest'
import { voiceAxesSchema, voiceAxesCoerceSchema, NEUTRAL_VOICE_AXES } from './voice'

const valid = {
  formal_casual: 50,
  expert_peer: 50,
  serious_playful: 50,
  reserved_warm: 50,
  calm_energetic: 50,
  rational_emotional: 50,
  exclusive_inclusive: 50,
}

describe('voiceAxesSchema', () => {
  describe('accepts valid inputs', () => {
    it('accepts the neutral object (all 50)', () => {
      expect(voiceAxesSchema.safeParse(valid).success).toBe(true)
    })

    it('accepts boundary value 0', () => {
      expect(voiceAxesSchema.safeParse({ ...valid, formal_casual: 0 }).success).toBe(true)
    })

    it('accepts boundary value 100', () => {
      expect(voiceAxesSchema.safeParse({ ...valid, formal_casual: 100 }).success).toBe(true)
    })
  })

  describe('rejects invalid inputs', () => {
    it('rejects a missing axis key', () => {
      const { exclusive_inclusive: _drop, ...missing } = valid
      expect(voiceAxesSchema.safeParse(missing).success).toBe(false)
    })

    it('rejects a string-encoded number', () => {
      expect(voiceAxesSchema.safeParse({ ...valid, formal_casual: '50' }).success).toBe(false)
    })

    it('rejects value 101 (above max)', () => {
      expect(voiceAxesSchema.safeParse({ ...valid, formal_casual: 101 }).success).toBe(false)
    })

    it('rejects value -1 (below min)', () => {
      expect(voiceAxesSchema.safeParse({ ...valid, formal_casual: -1 }).success).toBe(false)
    })

    it('rejects a float (non-integer)', () => {
      expect(voiceAxesSchema.safeParse({ ...valid, formal_casual: 50.5 }).success).toBe(false)
    })
  })

  describe('NEUTRAL_VOICE_AXES constant', () => {
    it('parses without error', () => {
      expect(voiceAxesSchema.safeParse(NEUTRAL_VOICE_AXES).success).toBe(true)
    })

    it('has all 7 axes set to 50', () => {
      const keys: Array<keyof typeof NEUTRAL_VOICE_AXES> = [
        'formal_casual',
        'expert_peer',
        'serious_playful',
        'reserved_warm',
        'calm_energetic',
        'rational_emotional',
        'exclusive_inclusive',
      ]
      for (const key of keys) {
        expect(NEUTRAL_VOICE_AXES[key]).toBe(50)
      }
    })
  })
})

describe('voiceAxesCoerceSchema (FormData strings)', () => {
  const validStrings = {
    formal_casual: '50',
    expert_peer: '50',
    serious_playful: '50',
    reserved_warm: '50',
    calm_energetic: '50',
    rational_emotional: '50',
    exclusive_inclusive: '50',
  }

  it('coerces string "55" to number 55', () => {
    const result = voiceAxesCoerceSchema.safeParse({ ...validStrings, formal_casual: '55' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.formal_casual).toBe(55)
  })

  it('accepts boundary string "0"', () => {
    expect(voiceAxesCoerceSchema.safeParse({ ...validStrings, formal_casual: '0' }).success).toBe(true)
  })

  it('accepts boundary string "100"', () => {
    expect(voiceAxesCoerceSchema.safeParse({ ...validStrings, formal_casual: '100' }).success).toBe(true)
  })

  it('rejects "200" (above max after coerce)', () => {
    expect(voiceAxesCoerceSchema.safeParse({ ...validStrings, formal_casual: '200' }).success).toBe(false)
  })

  it('rejects "-1" (below min after coerce)', () => {
    expect(voiceAxesCoerceSchema.safeParse({ ...validStrings, formal_casual: '-1' }).success).toBe(false)
  })

  it('rejects "50.5" (non-integer after coerce)', () => {
    expect(voiceAxesCoerceSchema.safeParse({ ...validStrings, formal_casual: '50.5' }).success).toBe(false)
  })
})
