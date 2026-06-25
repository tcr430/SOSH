import type { VoiceAxes } from '@/lib/validation/voice'

type AxisKey = keyof VoiceAxes
type OffsetMap = Partial<Record<AxisKey, number>>

// Starter preset offsets (D-C) — tuning changes only this constant block
const PRESET_OFFSETS: ReadonlyArray<{ name: string; offsets: OffsetMap }> = [
  {
    name: 'Bolder',
    offsets: { expert_peer: -12, calm_energetic: +18, serious_playful: +6, rational_emotional: +8 },
  },
  {
    name: 'Buttoned-up',
    offsets: { formal_casual: -18, serious_playful: -15, calm_energetic: -10, reserved_warm: -8 },
  },
  {
    name: 'Warmer',
    offsets: { reserved_warm: +18, rational_emotional: +12, exclusive_inclusive: +12, formal_casual: +8 },
  },
  {
    name: 'Sharper',
    offsets: { rational_emotional: -15, serious_playful: -8, reserved_warm: -10, expert_peer: -10 },
  },
  {
    name: 'Thought leader',
    offsets: { expert_peer: -15, formal_casual: -10, rational_emotional: -8, exclusive_inclusive: -12, calm_energetic: +5 },
  },
]

export interface SuggestedVariation {
  readonly name: string
  readonly voiceAxes: VoiceAxes
}

function applyOffsets(base: VoiceAxes, offsets: OffsetMap): VoiceAxes {
  const updates = Object.fromEntries(
    (Object.entries(offsets) as Array<[AxisKey, number]>).map(([axis, delta]) => [
      axis,
      Math.min(100, Math.max(0, base[axis] + delta)),
    ]),
  )
  return { ...base, ...updates }
}

/**
 * Returns absolute variation suggestions for the given base vector.
 * Presets whose name already exists in existingNames are omitted.
 * Vectors are computed once from base and are independent of it thereafter (§3.2).
 */
export function suggestVariations(
  base: VoiceAxes,
  existingNames: string[] = [],
): SuggestedVariation[] {
  const existing = new Set(existingNames)
  return PRESET_OFFSETS
    .filter(p => !existing.has(p.name))
    .map(p => ({ name: p.name, voiceAxes: applyOffsets(base, p.offsets) }))
}
