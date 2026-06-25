import { describe, it, expect } from 'vitest'
import { suggestVariations } from './variations'
import { NEUTRAL_VOICE_AXES } from '@/lib/validation/voice'
import type { VoiceAxes } from '@/lib/validation/voice'

// ── Preset offsets (ADR §8.1) — spot-checked against neutral base ─────────

describe('suggestVariations — preset offset correctness (ADR §8.1)', () => {
  const results = suggestVariations(NEUTRAL_VOICE_AXES)
  const byName = Object.fromEntries(results.map(r => [r.name, r.voiceAxes]))

  it('returns all 5 presets when no existing names', () => {
    expect(results).toHaveLength(5)
    const names = results.map(r => r.name)
    expect(names).toContain('Bolder')
    expect(names).toContain('Buttoned-up')
    expect(names).toContain('Warmer')
    expect(names).toContain('Sharper')
    expect(names).toContain('Thought leader')
  })

  // Bolder: expert_peer −12, calm_energetic +18, serious_playful +6, rational_emotional +8
  it('Bolder: expert_peer = base − 12', () => { expect(byName['Bolder'].expert_peer).toBe(38) })
  it('Bolder: calm_energetic = base + 18', () => { expect(byName['Bolder'].calm_energetic).toBe(68) })
  it('Bolder: serious_playful = base + 6', () => { expect(byName['Bolder'].serious_playful).toBe(56) })
  it('Bolder: rational_emotional = base + 8', () => { expect(byName['Bolder'].rational_emotional).toBe(58) })
  it('Bolder: untouched axes equal base', () => {
    expect(byName['Bolder'].formal_casual).toBe(50)
    expect(byName['Bolder'].reserved_warm).toBe(50)
    expect(byName['Bolder'].exclusive_inclusive).toBe(50)
  })

  // Buttoned-up: formal_casual −18, serious_playful −15, calm_energetic −10, reserved_warm −8
  it('Buttoned-up: formal_casual = base − 18', () => { expect(byName['Buttoned-up'].formal_casual).toBe(32) })
  it('Buttoned-up: serious_playful = base − 15', () => { expect(byName['Buttoned-up'].serious_playful).toBe(35) })
  it('Buttoned-up: calm_energetic = base − 10', () => { expect(byName['Buttoned-up'].calm_energetic).toBe(40) })
  it('Buttoned-up: reserved_warm = base − 8', () => { expect(byName['Buttoned-up'].reserved_warm).toBe(42) })

  // Warmer: reserved_warm +18, rational_emotional +12, exclusive_inclusive +12, formal_casual +8
  it('Warmer: reserved_warm = base + 18', () => { expect(byName['Warmer'].reserved_warm).toBe(68) })
  it('Warmer: rational_emotional = base + 12', () => { expect(byName['Warmer'].rational_emotional).toBe(62) })
  it('Warmer: exclusive_inclusive = base + 12', () => { expect(byName['Warmer'].exclusive_inclusive).toBe(62) })
  it('Warmer: formal_casual = base + 8', () => { expect(byName['Warmer'].formal_casual).toBe(58) })

  // Sharper: rational_emotional −15, serious_playful −8, reserved_warm −10, expert_peer −10
  it('Sharper: rational_emotional = base − 15', () => { expect(byName['Sharper'].rational_emotional).toBe(35) })
  it('Sharper: serious_playful = base − 8', () => { expect(byName['Sharper'].serious_playful).toBe(42) })
  it('Sharper: reserved_warm = base − 10', () => { expect(byName['Sharper'].reserved_warm).toBe(40) })
  it('Sharper: expert_peer = base − 10', () => { expect(byName['Sharper'].expert_peer).toBe(40) })

  // Thought leader: expert_peer −15, formal_casual −10, rational_emotional −8,
  //                 exclusive_inclusive −12, calm_energetic +5
  it('Thought leader: expert_peer = base − 15', () => { expect(byName['Thought leader'].expert_peer).toBe(35) })
  it('Thought leader: formal_casual = base − 10', () => { expect(byName['Thought leader'].formal_casual).toBe(40) })
  it('Thought leader: rational_emotional = base − 8', () => { expect(byName['Thought leader'].rational_emotional).toBe(42) })
  it('Thought leader: exclusive_inclusive = base − 12', () => { expect(byName['Thought leader'].exclusive_inclusive).toBe(38) })
  it('Thought leader: calm_energetic = base + 5', () => { expect(byName['Thought leader'].calm_energetic).toBe(55) })
})

// ── Clamping ──────────────────────────────────────────────────────────────

describe('suggestVariations — clamping to 0–100', () => {
  it('clamps below-zero to 0 (expert_peer=5, Bolder −12 → 0)', () => {
    const base: VoiceAxes = { ...NEUTRAL_VOICE_AXES, expert_peer: 5 }
    const r = suggestVariations(base).find(v => v.name === 'Bolder')!
    expect(r.voiceAxes.expert_peer).toBe(0)
  })

  it('clamps above-100 to 100 (calm_energetic=95, Bolder +18 → 100)', () => {
    const base: VoiceAxes = { ...NEUTRAL_VOICE_AXES, calm_energetic: 95 }
    const r = suggestVariations(base).find(v => v.name === 'Bolder')!
    expect(r.voiceAxes.calm_energetic).toBe(100)
  })
})

// ── Absolute vectors (§3.2) ───────────────────────────────────────────────

describe('suggestVariations — absolute vectors', () => {
  it('every suggestion contains all 7 axes', () => {
    const axes: Array<keyof VoiceAxes> = [
      'formal_casual', 'expert_peer', 'serious_playful', 'reserved_warm',
      'calm_energetic', 'rational_emotional', 'exclusive_inclusive',
    ]
    for (const r of suggestVariations(NEUTRAL_VOICE_AXES)) {
      for (const axis of axes) {
        expect(r.voiceAxes[axis], `${r.name} missing axis ${axis}`).toBeDefined()
      }
    }
  })

  it('returned vector is independent of the base object (immutable output)', () => {
    const base: VoiceAxes = { ...NEUTRAL_VOICE_AXES }
    const suggestion = suggestVariations(base).find(r => r.name === 'Bolder')!
    const snapshot = suggestion.voiceAxes.expert_peer
    // Mutating base afterwards does not affect the already-computed suggestion
    ;(base as { expert_peer: number }).expert_peer = 99
    expect(suggestion.voiceAxes.expert_peer).toBe(snapshot)
  })
})

// ── Determinism ───────────────────────────────────────────────────────────

describe('suggestVariations — determinism', () => {
  it('same base ⇒ identical suggestion set', () => {
    expect(suggestVariations(NEUTRAL_VOICE_AXES)).toEqual(suggestVariations(NEUTRAL_VOICE_AXES))
  })
})

// ── Name-collision omission ───────────────────────────────────────────────

describe('suggestVariations — name-collision omission', () => {
  it('omits a single matching preset', () => {
    const results = suggestVariations(NEUTRAL_VOICE_AXES, ['Bolder'])
    expect(results).toHaveLength(4)
    expect(results.map(r => r.name)).not.toContain('Bolder')
  })

  it('omits multiple matching presets', () => {
    const results = suggestVariations(NEUTRAL_VOICE_AXES, ['Warmer', 'Sharper'])
    expect(results).toHaveLength(3)
    expect(results.map(r => r.name)).not.toContain('Warmer')
    expect(results.map(r => r.name)).not.toContain('Sharper')
  })

  it('returns empty array when all 5 names already exist', () => {
    const all = ['Bolder', 'Buttoned-up', 'Warmer', 'Sharper', 'Thought leader']
    expect(suggestVariations(NEUTRAL_VOICE_AXES, all)).toHaveLength(0)
  })

  it('is case-sensitive: "bolder" does not suppress "Bolder"', () => {
    const results = suggestVariations(NEUTRAL_VOICE_AXES, ['bolder'])
    expect(results.map(r => r.name)).toContain('Bolder')
  })
})
