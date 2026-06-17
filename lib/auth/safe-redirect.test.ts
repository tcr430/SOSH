import { describe, it, expect } from 'vitest'
import { decodeRedirectParam, isSafeRedirect } from './safe-redirect'

describe('decodeRedirectParam', () => {
  it('returns plain ASCII URL unchanged (idempotent on first pass)', () => {
    expect(decodeRedirectParam('/en/dashboard')).toBe('/en/dashboard')
  })

  it('decodes single-encoded URL', () => {
    expect(decodeRedirectParam('%2Fen%2Fdashboard')).toBe('/en/dashboard')
  })

  it('decodes double-encoded URL', () => {
    // %252F → %2F → / (two decode passes, idempotent on third check)
    expect(decodeRedirectParam('%252Fen%252Fdashboard')).toBe('/en/dashboard')
  })

  it('returns null for triple-encoded input (still changing after 3 passes)', () => {
    // %25252F → %252F → %2F → / (still changes on pass 3 → reject)
    expect(decodeRedirectParam('%25252Fen%25252Fdashboard')).toBeNull()
  })

  it('returns null for malformed percent-encoding', () => {
    expect(decodeRedirectParam('%ZZ')).toBeNull()
  })

  it('returns null when iteration 3 still differs (triple-encoded attack)', () => {
    // Triple-encoded //attacker.com → still changes on 3rd pass → null
    const tripleEncoded = '%25252f%25252fattacker.com'
    expect(decodeRedirectParam(tripleEncoded)).toBeNull()
  })
})

describe('isSafeRedirect', () => {
  it('accepts a valid internal redirect', () => {
    expect(isSafeRedirect('/en/campaigns', 'en')).toBe(true)
    expect(isSafeRedirect('/pt/dashboard', 'pt')).toBe(true)
  })

  it('blocks absolute URLs with protocol', () => {
    expect(isSafeRedirect('https://attacker.com', 'en')).toBe(false)
    expect(isSafeRedirect('http://attacker.com', 'en')).toBe(false)
  })

  it('blocks path-traversal', () => {
    expect(isSafeRedirect('/en/../admin', 'en')).toBe(false)
  })

  it('blocks wrong locale prefix', () => {
    expect(isSafeRedirect('/fr/dashboard', 'en')).toBe(false)
  })

  it('blocks single-encoded open-redirect via %2f%2f', () => {
    // %2f%2fattacker.com decodes to //attacker.com → fails startsWith check
    expect(isSafeRedirect('%2f%2fattacker.com', 'en')).toBe(false)
  })

  it('blocks double-encoded open-redirect (%25%32%66 style)', () => {
    // %25%32%66 = % 2 f = %2f per character; decodes to //attacker.com on 2nd pass
    const doubleEncoded = '%25%32%66%25%32%66attacker.com'
    expect(isSafeRedirect(doubleEncoded, 'en')).toBe(false)
  })

  it('rejects triple-encoded input outright (null from decode → false)', () => {
    const tripleEncoded = '%25252f%25252fattacker.com'
    expect(isSafeRedirect(tripleEncoded, 'en')).toBe(false)
  })

  it('accepts idempotent ASCII URL without looping', () => {
    expect(isSafeRedirect('/en/campaigns/new', 'en')).toBe(true)
  })
})
