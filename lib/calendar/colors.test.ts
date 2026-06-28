import { describe, it, expect } from 'vitest'
import { colorIndex } from './colors'

describe('colorIndex', () => {
  it('returns a value in [0, paletteLength)', () => {
    const idx = colorIndex('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 8)
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(idx).toBeLessThan(8)
  })

  it('is deterministic — same id returns the same index every call', () => {
    const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    expect(colorIndex(id, 8)).toBe(colorIndex(id, 8))
    expect(colorIndex(id, 16)).toBe(colorIndex(id, 16))
  })

  it('different ids produce different indices (spreads across palette)', () => {
    const palette = 8
    // Generate 200 diverse UUID-shaped strings via a deterministic LCG so the
    // test is stable across runs without relying on Math.random().
    let seed = 42
    const lcg = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed }
    const fakeUuid = (n: number) => {
      seed = n * 997 + 1
      const h = () => lcg().toString(16).padStart(8, '0')
      return `${h().slice(0, 8)}-${h().slice(0, 4)}-4${h().slice(0, 3)}-8${h().slice(0, 3)}-${h()}${h().slice(0, 4)}`
    }
    const ids = Array.from({ length: 200 }, (_, i) => fakeUuid(i))
    const covered = new Set(ids.map(id => colorIndex(id, palette)))
    // 200 diverse inputs across 8 slots: all slots must be covered
    expect(covered.size).toBe(palette)
  })

  it('respects paletteLength — works for length 12', () => {
    const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const idx = colorIndex(id, 12)
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(idx).toBeLessThan(12)
  })

  it('works for paletteLength 1 (edge case)', () => {
    expect(colorIndex('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1)).toBe(0)
  })
})
