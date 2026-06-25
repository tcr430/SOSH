import { describe, it, expect } from 'vitest'
import { CALIBRATION_BANK } from './calibration'
import { NEUTRAL_VOICE_AXES } from '@/lib/validation/voice'
import type { VoiceAxes } from '@/lib/validation/voice'
import {
  initialEditorState,
  isLocked,
  isFinalStep,
  currentQuestion,
  answerQuestion,
  manuallyAdjustAxes,
  setKeywords,
  setAvoidWords,
  buildSavePayload,
} from './editor-state'

// ── initialEditorState ────────────────────────────────────────────────────────

describe('initialEditorState', () => {
  it('starts at step 0', () => {
    expect(initialEditorState(NEUTRAL_VOICE_AXES).step).toBe(0)
  })

  it('preserves the seed axes', () => {
    const axes: VoiceAxes = { ...NEUTRAL_VOICE_AXES, formal_casual: 30 }
    expect(initialEditorState(axes).axes.formal_casual).toBe(30)
  })

  it('defaults keywords and avoidWords to empty arrays', () => {
    const s = initialEditorState(NEUTRAL_VOICE_AXES)
    expect(s.keywords).toEqual([])
    expect(s.avoidWords).toEqual([])
  })

  it('accepts seed keywords and avoidWords', () => {
    const s = initialEditorState(NEUTRAL_VOICE_AXES, ['ai', 'saas'], ['synergy'])
    expect(s.keywords).toEqual(['ai', 'saas'])
    expect(s.avoidWords).toEqual(['synergy'])
  })
})

// ── isLocked ──────────────────────────────────────────────────────────────────

describe('isLocked', () => {
  it('is locked at step 0', () => {
    expect(isLocked(initialEditorState(NEUTRAL_VOICE_AXES))).toBe(true)
  })

  it('is locked at step 1', () => {
    const s = { ...initialEditorState(NEUTRAL_VOICE_AXES), step: 1 }
    expect(isLocked(s)).toBe(true)
  })

  it(`is locked at step ${CALIBRATION_BANK.length - 1} (last question)`, () => {
    const s = { ...initialEditorState(NEUTRAL_VOICE_AXES), step: CALIBRATION_BANK.length - 1 }
    expect(isLocked(s)).toBe(true)
  })

  it(`is unlocked at final step (${CALIBRATION_BANK.length})`, () => {
    const s = { ...initialEditorState(NEUTRAL_VOICE_AXES), step: CALIBRATION_BANK.length }
    expect(isLocked(s)).toBe(false)
  })
})

// ── isFinalStep ───────────────────────────────────────────────────────────────

describe('isFinalStep', () => {
  it('returns false during question flow', () => {
    expect(isFinalStep(initialEditorState(NEUTRAL_VOICE_AXES))).toBe(false)
  })

  it('returns true after all questions are answered', () => {
    const s = { ...initialEditorState(NEUTRAL_VOICE_AXES), step: CALIBRATION_BANK.length }
    expect(isFinalStep(s)).toBe(true)
  })
})

// ── currentQuestion ───────────────────────────────────────────────────────────

describe('currentQuestion', () => {
  it('returns first question at step 0', () => {
    expect(currentQuestion(initialEditorState(NEUTRAL_VOICE_AXES))).toEqual(CALIBRATION_BANK[0])
  })

  it('returns null at final step', () => {
    const s = { ...initialEditorState(NEUTRAL_VOICE_AXES), step: CALIBRATION_BANK.length }
    expect(currentQuestion(s)).toBeNull()
  })
})

// ── answerQuestion ────────────────────────────────────────────────────────────

describe('answerQuestion', () => {
  it('increments the step', () => {
    const next = answerQuestion(initialEditorState(NEUTRAL_VOICE_AXES), CALIBRATION_BANK[0].options[0])
    expect(next.step).toBe(1)
  })

  it('applies applyAnswer to targeted axes (moves them away from neutral)', () => {
    // Q1 option a targets formal_casual:25, expert_peer:15 — both should move from 50
    const next = answerQuestion(initialEditorState(NEUTRAL_VOICE_AXES), CALIBRATION_BANK[0].options[0])
    expect(next.axes.formal_casual).not.toBe(50)
    expect(next.axes.expert_peer).not.toBe(50)
  })

  it('leaves untargeted axes unchanged', () => {
    // Q1 targets only formal_casual, expert_peer
    const next = answerQuestion(initialEditorState(NEUTRAL_VOICE_AXES), CALIBRATION_BANK[0].options[0])
    expect(next.axes.serious_playful).toBe(50)
    expect(next.axes.reserved_warm).toBe(50)
    expect(next.axes.calm_energetic).toBe(50)
    expect(next.axes.rational_emotional).toBe(50)
    expect(next.axes.exclusive_inclusive).toBe(50)
  })

  it('does not mutate the input state', () => {
    const s = initialEditorState(NEUTRAL_VOICE_AXES)
    const originalAxes = { ...s.axes }
    answerQuestion(s, CALIBRATION_BANK[0].options[0])
    expect(s.axes).toEqual(originalAxes)
    expect(s.step).toBe(0)
  })

  it('reaches final step after answering all 6 questions', () => {
    let s = initialEditorState(NEUTRAL_VOICE_AXES)
    for (const q of CALIBRATION_BANK) {
      s = answerQuestion(s, q.options[0])
    }
    expect(isFinalStep(s)).toBe(true)
    expect(s.step).toBe(CALIBRATION_BANK.length)
  })

  it('is a no-op when already at final step', () => {
    let s = initialEditorState(NEUTRAL_VOICE_AXES)
    for (const q of CALIBRATION_BANK) {
      s = answerQuestion(s, q.options[0])
    }
    const after = answerQuestion(s, CALIBRATION_BANK[0].options[0])
    expect(after.step).toBe(s.step)
  })
})

// ── manuallyAdjustAxes ────────────────────────────────────────────────────────

describe('manuallyAdjustAxes', () => {
  it('throws when called during the question flow (locked)', () => {
    const s = initialEditorState(NEUTRAL_VOICE_AXES)
    expect(() => manuallyAdjustAxes(s, { ...NEUTRAL_VOICE_AXES, formal_casual: 80 })).toThrow()
  })

  it('succeeds and updates axes at final step', () => {
    let s = initialEditorState(NEUTRAL_VOICE_AXES)
    for (const q of CALIBRATION_BANK) {
      s = answerQuestion(s, q.options[0])
    }
    expect(manuallyAdjustAxes(s, { ...s.axes, formal_casual: 80 }).axes.formal_casual).toBe(80)
  })

  it('does not change the step when adjusting', () => {
    let s = initialEditorState(NEUTRAL_VOICE_AXES)
    for (const q of CALIBRATION_BANK) {
      s = answerQuestion(s, q.options[0])
    }
    expect(manuallyAdjustAxes(s, { ...s.axes, formal_casual: 70 }).step).toBe(CALIBRATION_BANK.length)
  })

  it('does not mutate the input state', () => {
    let s = initialEditorState(NEUTRAL_VOICE_AXES)
    for (const q of CALIBRATION_BANK) {
      s = answerQuestion(s, q.options[0])
    }
    const snap = { ...s.axes }
    manuallyAdjustAxes(s, { ...s.axes, formal_casual: 99 })
    expect(s.axes).toEqual(snap)
  })
})

// ── setKeywords / setAvoidWords ───────────────────────────────────────────────

describe('setKeywords', () => {
  it('updates the keywords list', () => {
    const s = initialEditorState(NEUTRAL_VOICE_AXES)
    expect(setKeywords(s, ['ai', 'saas']).keywords).toEqual(['ai', 'saas'])
  })

  it('does not mutate the input state', () => {
    const s = initialEditorState(NEUTRAL_VOICE_AXES, ['original'])
    setKeywords(s, ['new'])
    expect(s.keywords).toEqual(['original'])
  })
})

describe('setAvoidWords', () => {
  it('updates the avoidWords list', () => {
    const s = initialEditorState(NEUTRAL_VOICE_AXES)
    expect(setAvoidWords(s, ['synergy']).avoidWords).toEqual(['synergy'])
  })

  it('does not mutate the input state', () => {
    const s = initialEditorState(NEUTRAL_VOICE_AXES, [], ['original'])
    setAvoidWords(s, ['new'])
    expect(s.avoidWords).toEqual(['original'])
  })
})

// ── buildSavePayload ──────────────────────────────────────────────────────────

describe('buildSavePayload', () => {
  it('includes voiceAxes in the payload', () => {
    const axes: VoiceAxes = { ...NEUTRAL_VOICE_AXES, formal_casual: 80 }
    const s = { ...initialEditorState(axes), step: CALIBRATION_BANK.length }
    expect(buildSavePayload(s).voiceAxes).toEqual(axes)
  })

  it('derives tone[] from vectorToVoiceFields (non-neutral axis → ≥1 tone)', () => {
    const axes: VoiceAxes = { ...NEUTRAL_VOICE_AXES, formal_casual: 80 }
    const s = { ...initialEditorState(axes), step: CALIBRATION_BANK.length }
    const { tone } = buildSavePayload(s)
    expect(Array.isArray(tone)).toBe(true)
    expect(tone.length).toBeGreaterThan(0)
  })

  it('includes keywords in the payload', () => {
    const s = { ...initialEditorState(NEUTRAL_VOICE_AXES, ['ai', 'saas']), step: CALIBRATION_BANK.length }
    expect(buildSavePayload(s).keywords).toEqual(['ai', 'saas'])
  })

  it('includes avoidWords in the payload', () => {
    const s = setAvoidWords(
      { ...initialEditorState(NEUTRAL_VOICE_AXES), step: CALIBRATION_BANK.length },
      ['synergy'],
    )
    expect(buildSavePayload(s).avoidWords).toEqual(['synergy'])
  })

  it('returns a copy of keywords (not the same reference)', () => {
    const s = { ...initialEditorState(NEUTRAL_VOICE_AXES, ['ai']), step: CALIBRATION_BANK.length }
    expect(buildSavePayload(s).keywords).not.toBe(s.keywords)
  })
})
