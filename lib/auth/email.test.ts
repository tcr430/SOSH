import { describe, it, expect } from 'vitest'
import { canonicalizeEmail } from './email'

describe('canonicalizeEmail', () => {
  it('lowercases ASCII email', () => {
    expect(canonicalizeEmail('User@Example.COM')).toBe('user@example.com')
  })

  it('trims leading and trailing whitespace', () => {
    expect(canonicalizeEmail('  user@example.com  ')).toBe('user@example.com')
  })

  it('normalizes fullwidth characters to ASCII equivalents (NFKC)', () => {
    // ＡＢＣ are fullwidth Latin letters (U+FF21–U+FF23)
    expect(canonicalizeEmail('ＡＢＣ@example.com')).toBe('abc@example.com')
  })

  it('normalizes mixed fullwidth domain', () => {
    expect(canonicalizeEmail('user@ＥＸＡＭＰＬＥ.com')).toBe('user@example.com')
  })

  // NFKC does NOT collapse cross-script lookalikes. This test documents the
  // limitation: Cyrillic 'а' (U+0430) is not collapsed to Latin 'a' (U+0061).
  // Cross-script homoglyph defense is a documented P2 escalation.
  it('does NOT collapse Cyrillic lookalikes (documented NFKC limitation)', () => {
    const cyrillicA = 'а' // Cyrillic small letter a
    const latinA = 'a'
    const withCyrillic = `${cyrillicA}dmin@example.com`
    const canonical = canonicalizeEmail(withCyrillic)
    expect(canonical).not.toBe(`${latinA}dmin@example.com`)
  })

  it('applies trim + lowercase together', () => {
    expect(canonicalizeEmail('  HELLO@WORLD.COM  ')).toBe('hello@world.com')
  })
})
