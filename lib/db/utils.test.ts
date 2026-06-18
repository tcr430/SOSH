import { describe, it, expect } from 'vitest'
import { getErrorMessage, parseAiGenerationMetadata } from './utils'

describe('getErrorMessage', () => {
  it('returns message from an Error instance', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('returns message from a plain object with string message', () => {
    expect(getErrorMessage({ message: 'db error' })).toBe('db error')
  })

  it('falls through to String() when message is not a string', () => {
    // typeof guard rejects non-string; result is String({ message: 42 })
    const result = getErrorMessage({ message: 42 })
    expect(result).toBe(String({ message: 42 }))
    expect(result).not.toBe('42')
  })

  it('returns String() for a bare string', () => {
    expect(getErrorMessage('plain string')).toBe('plain string')
  })

  it('returns String() for a number', () => {
    expect(getErrorMessage(404)).toBe('404')
  })
})

describe('parseAiGenerationMetadata', () => {
  it('returns {} for null', () => {
    expect(parseAiGenerationMetadata(null)).toEqual({})
  })

  it('returns {} for non-object input', () => {
    expect(parseAiGenerationMetadata('not-an-object')).toEqual({})
    expect(parseAiGenerationMetadata(42)).toEqual({})
  })

  it('returns the object as-is when fields are missing — regenerationCount ?? 0 is safe', () => {
    const result = parseAiGenerationMetadata({})
    expect(result.regenerationCount).toBeUndefined()
    // call sites use ?? 0 / ?? [] — confirms the helper does not throw
  })

  it('returns parsed values intact for a well-formed record', () => {
    const raw = {
      promptId: 'p1',
      promptVersion: 2,
      model: 'claude-sonnet-4-6',
      generationSessionId: 'sess-1',
      platformContext: 'linkedin',
      platformConstraintsVersion: 1,
      rationale: 'test',
      regenerationCount: 3,
      previousVersions: [],
      generatedAt: '2026-06-18T00:00:00.000Z',
    }
    const result = parseAiGenerationMetadata(raw)
    expect(result.regenerationCount).toBe(3)
    expect(result.promptId).toBe('p1')
    expect(result.previousVersions).toEqual([])
  })
})
