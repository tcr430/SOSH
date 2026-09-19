import type { VoiceAxes } from '@/lib/validation/voice'

// The single canonical axis order/pole-label table — VoiceEditor.tsx and
// BackfillPanel.tsx (ADR 0025 §10.4 item 2, Session 32-D D9) both read
// from here rather than each keeping their own copy.
export const AXIS_ORDER: ReadonlyArray<keyof VoiceAxes> = [
  'formal_casual',
  'expert_peer',
  'serious_playful',
  'reserved_warm',
  'calm_energetic',
  'rational_emotional',
  'exclusive_inclusive',
]

export const AXIS_POLES: Record<keyof VoiceAxes, [string, string]> = {
  formal_casual: ['Formal', 'Casual'],
  expert_peer: ['Expert', 'Peer'],
  serious_playful: ['Serious', 'Playful'],
  reserved_warm: ['Reserved', 'Warm'],
  calm_energetic: ['Calm', 'Energetic'],
  rational_emotional: ['Rational', 'Emotional'],
  exclusive_inclusive: ['Exclusive', 'Inclusive'],
}

// ADR 0025 §10.4 item 2 — the n axes furthest from the neutral midpoint
// (50), each resolved to its leaning pole label (low label if < 50, high
// label if >= 50). Ties broken by AXIS_ORDER (stable sort).
export function strongestAxisLabels(axes: VoiceAxes, n: number): string[] {
  return [...AXIS_ORDER]
    .sort((a, b) => Math.abs(axes[b] - 50) - Math.abs(axes[a] - 50))
    .slice(0, n)
    .map((axis) => (axes[axis] >= 50 ? AXIS_POLES[axis][1] : AXIS_POLES[axis][0]))
}
