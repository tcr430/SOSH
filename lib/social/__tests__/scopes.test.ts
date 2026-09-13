import { describe, it, expect } from 'vitest'
import { scopesGrantedUnknown } from '../scopes'

describe('scopesGrantedUnknown (ADR 0025 §7.4)', () => {
  it('null means unknown', () => {
    expect(scopesGrantedUnknown(null)).toBe(true)
  })

  it('[] means unknown — the same as null, never "zero scopes"', () => {
    expect(scopesGrantedUnknown([])).toBe(true)
  })

  it('a non-empty array means known', () => {
    expect(scopesGrantedUnknown(['tweet.read'])).toBe(false)
  })
})
