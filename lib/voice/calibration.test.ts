import { describe, it, expect } from 'vitest'
import { applyAnswer, CALIBRATION_BANK } from './calibration'
import type { CalibrationOption } from './calibration'
import { NEUTRAL_VOICE_AXES } from '@/lib/validation/voice'
import type { VoiceAxes } from '@/lib/validation/voice'

// ── applyAnswer — delta mechanics ─────────────────────────────────────────

describe('applyAnswer — delta mechanics', () => {
  const neutral = NEUTRAL_VOICE_AXES // all axes = 50

  it('returns current unchanged when target equals current (gap = 0)', () => {
    const option: CalibrationOption = {
      id: 'test',
      textKey: 'test',
      target: { formal_casual: 50 },
    }
    const result = applyAnswer(neutral, option)
    expect(result.formal_casual).toBe(50)
  })

  it('confirming answer (small gap) barely moves the axis', () => {
    // current=50, target=55 → gap=5; k=0.15+0.30*(5/100)=0.165; delta=0.825 → rounds to 51
    const option: CalibrationOption = {
      id: 'test',
      textKey: 'test',
      target: { formal_casual: 55 },
    }
    const result = applyAnswer(neutral, option)
    expect(result.formal_casual).toBe(51)
  })

  it('contradicting answer (large gap) moves axis significantly more', () => {
    // current=50, target=0 → gap=-50; k=0.15+0.30*(50/100)=0.30; delta=-15 → 35
    const option: CalibrationOption = {
      id: 'test',
      textKey: 'test',
      target: { formal_casual: 0 },
    }
    const result = applyAnswer(neutral, option)
    expect(result.formal_casual).toBe(35)
  })

  it('a single answer never fully reaches the target (L-3: no full override)', () => {
    // Max divergence: current=0, target=100 → gap=100; k=0.45; next=45 ≠ 100
    const current: VoiceAxes = { ...neutral, formal_casual: 0 }
    const option: CalibrationOption = {
      id: 'test',
      textKey: 'test',
      target: { formal_casual: 100 },
    }
    const result = applyAnswer(current, option)
    expect(result.formal_casual).toBe(45)
    expect(result.formal_casual).not.toBe(100)
  })

  it('max pull is ≤ 45% of gap (k_max = 0.45)', () => {
    // current=0, target=100 → gap=100; k=0.45; delta=45 = 0.45*100
    const current: VoiceAxes = { ...neutral, expert_peer: 0 }
    const option: CalibrationOption = {
      id: 'test',
      textKey: 'test',
      target: { expert_peer: 100 },
    }
    const result = applyAnswer(current, option)
    const delta = result.expert_peer - 0
    expect(delta).toBeLessThanOrEqual(45)
  })

  it('gap=0 produces no movement regardless of k floor', () => {
    // k=0.15 but k*0=0 so result unchanged
    const option: CalibrationOption = {
      id: 'test',
      textKey: 'test',
      target: { serious_playful: 50 },
    }
    const result = applyAnswer(neutral, option)
    expect(result.serious_playful).toBe(50)
  })

  it('divergence proportionality: larger gap ⇒ more movement', () => {
    const smallGapOption: CalibrationOption = {
      id: 'small',
      textKey: 'test',
      target: { calm_energetic: 60 }, // gap=10
    }
    const largeGapOption: CalibrationOption = {
      id: 'large',
      textKey: 'test',
      target: { calm_energetic: 90 }, // gap=40
    }
    const smallMove = Math.abs(applyAnswer(neutral, smallGapOption).calm_energetic - 50)
    const largeMove = Math.abs(applyAnswer(neutral, largeGapOption).calm_energetic - 50)
    expect(largeMove).toBeGreaterThan(smallMove)
  })

  it('applies movement toward a low target correctly', () => {
    // current=80, target=20 → gap=-60; k=0.15+0.30*(60/100)=0.33; next=round(80+0.33*(-60))=round(60.2)=60
    const current: VoiceAxes = { ...neutral, reserved_warm: 80 }
    const option: CalibrationOption = {
      id: 'test',
      textKey: 'test',
      target: { reserved_warm: 20 },
    }
    const result = applyAnswer(current, option)
    expect(result.reserved_warm).toBe(60)
  })
})

// ── applyAnswer — axis isolation ──────────────────────────────────────────

describe('applyAnswer — untargeted axes are untouched', () => {
  it('only axes present in option.target are modified', () => {
    const current: VoiceAxes = {
      formal_casual: 30,
      expert_peer: 70,
      serious_playful: 40,
      reserved_warm: 60,
      calm_energetic: 20,
      rational_emotional: 80,
      exclusive_inclusive: 45,
    }
    const option: CalibrationOption = {
      id: 'test',
      textKey: 'test',
      target: { formal_casual: 50 },
    }
    const result = applyAnswer(current, option)
    expect(result.expert_peer).toBe(70)
    expect(result.serious_playful).toBe(40)
    expect(result.reserved_warm).toBe(60)
    expect(result.calm_energetic).toBe(20)
    expect(result.rational_emotional).toBe(80)
    expect(result.exclusive_inclusive).toBe(45)
    expect(result.formal_casual).not.toBe(30)
  })

  it('multi-axis option only changes targeted axes', () => {
    const option: CalibrationOption = {
      id: 'test',
      textKey: 'test',
      target: { serious_playful: 88, calm_energetic: 70 },
    }
    const result = applyAnswer(NEUTRAL_VOICE_AXES, option)
    expect(result.formal_casual).toBe(50)
    expect(result.expert_peer).toBe(50)
    expect(result.reserved_warm).toBe(50)
    expect(result.rational_emotional).toBe(50)
    expect(result.exclusive_inclusive).toBe(50)
    expect(result.serious_playful).not.toBe(50)
    expect(result.calm_energetic).not.toBe(50)
  })

  it('does not mutate the input current object', () => {
    const current: VoiceAxes = { ...NEUTRAL_VOICE_AXES }
    const option: CalibrationOption = {
      id: 'test',
      textKey: 'test',
      target: { formal_casual: 80 },
    }
    applyAnswer(current, option)
    expect(current.formal_casual).toBe(50)
  })
})

// ── applyAnswer — determinism ─────────────────────────────────────────────

describe('applyAnswer — determinism', () => {
  it('same (current, option) always produces the same result', () => {
    const option: CalibrationOption = {
      id: 'q1a',
      textKey: 'calibration.q1.a',
      target: { formal_casual: 25, expert_peer: 15 },
    }
    const r1 = applyAnswer(NEUTRAL_VOICE_AXES, option)
    const r2 = applyAnswer(NEUTRAL_VOICE_AXES, option)
    expect(r1).toEqual(r2)
  })
})

// ── Bank structure ────────────────────────────────────────────────────────

describe('CALIBRATION_BANK — structure', () => {
  it('contains exactly 6 questions', () => {
    expect(CALIBRATION_BANK).toHaveLength(6)
  })

  it('every question has exactly 4 options', () => {
    for (const q of CALIBRATION_BANK) {
      expect(q.options, `${q.id} should have 4 options`).toHaveLength(4)
    }
  })

  it('no question targets more than 3 axes (L-4)', () => {
    for (const q of CALIBRATION_BANK) {
      expect(
        q.targetsAxes.length,
        `${q.id} targets ${q.targetsAxes.length} axes (max 3)`,
      ).toBeLessThanOrEqual(3)
    }
  })

  it('targetsAxes declared on each question matches axes present in its options', () => {
    for (const q of CALIBRATION_BANK) {
      const allOptionAxes = new Set(q.options.flatMap(o => Object.keys(o.target)))
      for (const axis of q.targetsAxes) {
        expect(
          allOptionAxes.has(axis),
          `${q.id} declares "${axis}" in targetsAxes but no option targets it`,
        ).toBe(true)
      }
    }
  })
})

// ── Bank coverage ─────────────────────────────────────────────────────────

describe('CALIBRATION_BANK — axis coverage', () => {
  it('all 7 axes are targeted at least once across the bank', () => {
    const covered = new Set<string>()
    for (const q of CALIBRATION_BANK) {
      for (const axis of q.targetsAxes) {
        covered.add(axis)
      }
    }
    const expected: Array<keyof VoiceAxes> = [
      'formal_casual',
      'expert_peer',
      'serious_playful',
      'reserved_warm',
      'calm_energetic',
      'rational_emotional',
      'exclusive_inclusive',
    ]
    for (const axis of expected) {
      expect(covered.has(axis), `axis "${axis}" not covered by any question`).toBe(true)
    }
  })
})

// ── Bank integrity — verbatim ADR §6.2 target vectors ────────────────────

describe('CALIBRATION_BANK — bank integrity (ADR §6.2)', () => {
  const q = (idx: number) => CALIBRATION_BANK[idx]
  const opt = (qIdx: number, letter: string) =>
    q(qIdx).options.find(o => o.id === `q${qIdx + 1}${letter}`)!

  it('Q1-A: formal_casual=25, expert_peer=15', () => {
    expect(opt(0, 'a').target).toMatchObject({ formal_casual: 25, expert_peer: 15 })
  })

  it('Q1-B: formal_casual=55, expert_peer=40', () => {
    expect(opt(0, 'b').target).toMatchObject({ formal_casual: 55, expert_peer: 40 })
  })

  it('Q1-C: formal_casual=80, expert_peer=85', () => {
    expect(opt(0, 'c').target).toMatchObject({ formal_casual: 80, expert_peer: 85 })
  })

  it('Q1-D: formal_casual=70, expert_peer=65', () => {
    expect(opt(0, 'd').target).toMatchObject({ formal_casual: 70, expert_peer: 65 })
  })

  it('Q2-A: serious_playful=20, calm_energetic=30', () => {
    expect(opt(1, 'a').target).toMatchObject({ serious_playful: 20, calm_energetic: 30 })
  })

  it('Q2-B: serious_playful=60, calm_energetic=85', () => {
    expect(opt(1, 'b').target).toMatchObject({ serious_playful: 60, calm_energetic: 85 })
  })

  it('Q2-C: serious_playful=88, calm_energetic=70', () => {
    expect(opt(1, 'c').target).toMatchObject({ serious_playful: 88, calm_energetic: 70 })
  })

  it('Q2-D: serious_playful=35, calm_energetic=25', () => {
    expect(opt(1, 'd').target).toMatchObject({ serious_playful: 35, calm_energetic: 25 })
  })

  it('Q3-A: reserved_warm=30, rational_emotional=15', () => {
    expect(opt(2, 'a').target).toMatchObject({ reserved_warm: 30, rational_emotional: 15 })
  })

  it('Q3-B: reserved_warm=80, rational_emotional=85', () => {
    expect(opt(2, 'b').target).toMatchObject({ reserved_warm: 80, rational_emotional: 85 })
  })

  it('Q3-C: reserved_warm=60, rational_emotional=55', () => {
    expect(opt(2, 'c').target).toMatchObject({ reserved_warm: 60, rational_emotional: 55 })
  })

  it('Q3-D: reserved_warm=72, rational_emotional=38', () => {
    expect(opt(2, 'd').target).toMatchObject({ reserved_warm: 72, rational_emotional: 38 })
  })

  it('Q4-A: exclusive_inclusive=20, expert_peer=25', () => {
    expect(opt(3, 'a').target).toMatchObject({ exclusive_inclusive: 20, expert_peer: 25 })
  })

  it('Q4-B: exclusive_inclusive=88, expert_peer=70', () => {
    expect(opt(3, 'b').target).toMatchObject({ exclusive_inclusive: 88, expert_peer: 70 })
  })

  it('Q4-C: exclusive_inclusive=45, expert_peer=40', () => {
    expect(opt(3, 'c').target).toMatchObject({ exclusive_inclusive: 45, expert_peer: 40 })
  })

  it('Q4-D: exclusive_inclusive=78, expert_peer=60', () => {
    expect(opt(3, 'd').target).toMatchObject({ exclusive_inclusive: 78, expert_peer: 60 })
  })

  it('Q5-A: formal_casual=20, reserved_warm=30, serious_playful=25', () => {
    expect(opt(4, 'a').target).toMatchObject({ formal_casual: 20, reserved_warm: 30, serious_playful: 25 })
  })

  it('Q5-B: formal_casual=82, reserved_warm=75, serious_playful=78', () => {
    expect(opt(4, 'b').target).toMatchObject({ formal_casual: 82, reserved_warm: 75, serious_playful: 78 })
  })

  it('Q5-C: formal_casual=68, reserved_warm=82, serious_playful=45', () => {
    expect(opt(4, 'c').target).toMatchObject({ formal_casual: 68, reserved_warm: 82, serious_playful: 45 })
  })

  it('Q5-D: formal_casual=55, reserved_warm=58, serious_playful=40', () => {
    expect(opt(4, 'd').target).toMatchObject({ formal_casual: 55, reserved_warm: 58, serious_playful: 40 })
  })

  it('Q6-A: calm_energetic=30, rational_emotional=25, exclusive_inclusive=50', () => {
    expect(opt(5, 'a').target).toMatchObject({ calm_energetic: 30, rational_emotional: 25, exclusive_inclusive: 50 })
  })

  it('Q6-B: calm_energetic=88, rational_emotional=70, exclusive_inclusive=65', () => {
    expect(opt(5, 'b').target).toMatchObject({ calm_energetic: 88, rational_emotional: 70, exclusive_inclusive: 65 })
  })

  it('Q6-C: calm_energetic=55, rational_emotional=80, exclusive_inclusive=88', () => {
    expect(opt(5, 'c').target).toMatchObject({ calm_energetic: 55, rational_emotional: 80, exclusive_inclusive: 88 })
  })

  it('Q6-D: calm_energetic=40, rational_emotional=35, exclusive_inclusive=35', () => {
    expect(opt(5, 'd').target).toMatchObject({ calm_energetic: 40, rational_emotional: 35, exclusive_inclusive: 35 })
  })
})
