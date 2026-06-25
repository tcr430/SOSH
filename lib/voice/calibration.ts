import type { VoiceAxes } from '@/lib/validation/voice'

// Starter delta constants (D-C) — tuning changes only these two lines
const K_MIN = 0.15
const K_MAX = 0.45

type AxisKey = keyof VoiceAxes

// Axes targeted by an option; only the 2–3 axes the option speaks to are present
type OptionTarget = Partial<Record<AxisKey, number>>

export interface CalibrationOption {
  readonly id: string
  readonly textKey: string // i18n key — PT/ES translations live in the locale files
  readonly target: OptionTarget
}

export interface CalibrationQuestion {
  readonly id: string
  readonly promptKey: string // i18n key
  readonly targetsAxes: ReadonlyArray<AxisKey>
  readonly options: ReadonlyArray<CalibrationOption>
}

/**
 * Applies a calibration answer to the current voice vector.
 * For each axis the option targets:
 *   gap = target − current
 *   k   = clamp(K_MIN + (K_MAX − K_MIN) * (|gap| / 100), K_MIN, K_MAX)
 *   next = clamp(round(current + k * gap), 0, 100)
 * Untargeted axes are returned unchanged.
 */
export function applyAnswer(current: VoiceAxes, option: CalibrationOption): VoiceAxes {
  const entries = Object.entries(option.target) as Array<[AxisKey, number]>
  const updates = Object.fromEntries(
    entries.map(([axis, targetValue]) => {
      const gap = targetValue - current[axis]
      const k = Math.min(
        Math.max(K_MIN + (K_MAX - K_MIN) * (Math.abs(gap) / 100), K_MIN),
        K_MAX,
      )
      const next = Math.min(100, Math.max(0, Math.round(current[axis] + k * gap)))
      return [axis, next]
    }),
  )
  return { ...current, ...updates }
}

// ── Static calibration bank (ADR 0011 §6.2 — EN canonical) ───────────────
// PT/ES option text is provided via the i18n layer using textKey.
// Target vectors are hand-authored starter values (D-C).

export const CALIBRATION_BANK: ReadonlyArray<CalibrationQuestion> = [
  {
    id: 'q1',
    promptKey: 'calibration.q1.prompt',
    targetsAxes: ['formal_casual', 'expert_peer'],
    options: [
      {
        id: 'q1a',
        textKey: 'calibration.q1.a',
        target: { formal_casual: 25, expert_peer: 15 },
      },
      {
        id: 'q1b',
        textKey: 'calibration.q1.b',
        target: { formal_casual: 55, expert_peer: 40 },
      },
      {
        id: 'q1c',
        textKey: 'calibration.q1.c',
        target: { formal_casual: 80, expert_peer: 85 },
      },
      {
        id: 'q1d',
        textKey: 'calibration.q1.d',
        target: { formal_casual: 70, expert_peer: 65 },
      },
    ],
  },
  {
    id: 'q2',
    promptKey: 'calibration.q2.prompt',
    targetsAxes: ['serious_playful', 'calm_energetic'],
    options: [
      {
        id: 'q2a',
        textKey: 'calibration.q2.a',
        target: { serious_playful: 20, calm_energetic: 30 },
      },
      {
        id: 'q2b',
        textKey: 'calibration.q2.b',
        target: { serious_playful: 60, calm_energetic: 85 },
      },
      {
        id: 'q2c',
        textKey: 'calibration.q2.c',
        target: { serious_playful: 88, calm_energetic: 70 },
      },
      {
        id: 'q2d',
        textKey: 'calibration.q2.d',
        target: { serious_playful: 35, calm_energetic: 25 },
      },
    ],
  },
  {
    id: 'q3',
    promptKey: 'calibration.q3.prompt',
    targetsAxes: ['reserved_warm', 'rational_emotional'],
    options: [
      {
        id: 'q3a',
        textKey: 'calibration.q3.a',
        target: { reserved_warm: 30, rational_emotional: 15 },
      },
      {
        id: 'q3b',
        textKey: 'calibration.q3.b',
        target: { reserved_warm: 80, rational_emotional: 85 },
      },
      {
        id: 'q3c',
        textKey: 'calibration.q3.c',
        target: { reserved_warm: 60, rational_emotional: 55 },
      },
      {
        id: 'q3d',
        textKey: 'calibration.q3.d',
        target: { reserved_warm: 72, rational_emotional: 38 },
      },
    ],
  },
  {
    id: 'q4',
    promptKey: 'calibration.q4.prompt',
    targetsAxes: ['exclusive_inclusive', 'expert_peer'],
    options: [
      {
        id: 'q4a',
        textKey: 'calibration.q4.a',
        target: { exclusive_inclusive: 20, expert_peer: 25 },
      },
      {
        id: 'q4b',
        textKey: 'calibration.q4.b',
        target: { exclusive_inclusive: 88, expert_peer: 70 },
      },
      {
        id: 'q4c',
        textKey: 'calibration.q4.c',
        target: { exclusive_inclusive: 45, expert_peer: 40 },
      },
      {
        id: 'q4d',
        textKey: 'calibration.q4.d',
        target: { exclusive_inclusive: 78, expert_peer: 60 },
      },
    ],
  },
  {
    id: 'q5',
    promptKey: 'calibration.q5.prompt',
    targetsAxes: ['formal_casual', 'reserved_warm', 'serious_playful'],
    options: [
      {
        id: 'q5a',
        textKey: 'calibration.q5.a',
        target: { formal_casual: 20, reserved_warm: 30, serious_playful: 25 },
      },
      {
        id: 'q5b',
        textKey: 'calibration.q5.b',
        target: { formal_casual: 82, reserved_warm: 75, serious_playful: 78 },
      },
      {
        id: 'q5c',
        textKey: 'calibration.q5.c',
        target: { formal_casual: 68, reserved_warm: 82, serious_playful: 45 },
      },
      {
        id: 'q5d',
        textKey: 'calibration.q5.d',
        target: { formal_casual: 55, reserved_warm: 58, serious_playful: 40 },
      },
    ],
  },
  {
    id: 'q6',
    promptKey: 'calibration.q6.prompt',
    targetsAxes: ['calm_energetic', 'rational_emotional', 'exclusive_inclusive'],
    options: [
      {
        id: 'q6a',
        textKey: 'calibration.q6.a',
        target: { calm_energetic: 30, rational_emotional: 25, exclusive_inclusive: 50 },
      },
      {
        id: 'q6b',
        textKey: 'calibration.q6.b',
        target: { calm_energetic: 88, rational_emotional: 70, exclusive_inclusive: 65 },
      },
      {
        id: 'q6c',
        textKey: 'calibration.q6.c',
        target: { calm_energetic: 55, rational_emotional: 80, exclusive_inclusive: 88 },
      },
      {
        id: 'q6d',
        textKey: 'calibration.q6.d',
        target: { calm_energetic: 40, rational_emotional: 35, exclusive_inclusive: 35 },
      },
    ],
  },
]
