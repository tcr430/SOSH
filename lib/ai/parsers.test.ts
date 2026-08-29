import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { extractJsonBlock, safeParseOrAiError } from './parsers'
import { AiError } from './errors'

describe('extractJsonBlock', () => {
  it('returns raw text as-is when no markdown fence present', () => {
    expect(extractJsonBlock('{"key":"value"}')).toBe('{"key":"value"}')
  })

  it('strips ```json ... ``` fences', () => {
    const text = '```json\n{"key":"value"}\n```'
    expect(extractJsonBlock(text)).toBe('{"key":"value"}')
  })

  it('strips plain ``` ... ``` fences (no language tag)', () => {
    const text = '```\n{"key":"value"}\n```'
    expect(extractJsonBlock(text)).toBe('{"key":"value"}')
  })

  it('trims surrounding whitespace', () => {
    expect(extractJsonBlock('  {"key":"value"}  ')).toBe('{"key":"value"}')
  })

  it('handles multiline JSON inside fences', () => {
    const text = '```json\n{\n  "a": 1,\n  "b": 2\n}\n```'
    expect(extractJsonBlock(text)).toBe('{\n  "a": 1,\n  "b": 2\n}')
  })

  // Session 30 G1b.13 — the live triage run found the model prefixing its
  // JSON decision with a sentence of commentary despite an explicit
  // "no commentary" instruction, in ~75% of calls under one test
  // condition. No fence was present, so the old extractJsonBlock returned
  // the whole (prose + JSON) text, which JSON.parse then rejected outright.
  it('extracts a balanced JSON object when prose precedes it, no fence', () => {
    const text = 'No memory context is available for this business.\n\n{"key":"value"}'
    expect(extractJsonBlock(text)).toBe('{"key":"value"}')
  })

  it('extracts a balanced JSON object when prose follows it, no fence', () => {
    const text = '{"key":"value"}\n\nLet me know if you need anything else.'
    expect(extractJsonBlock(text)).toBe('{"key":"value"}')
  })

  it('extracts a balanced JSON object with prose on both sides, no fence', () => {
    const text = 'Here is my answer:\n{"key":"value"}\nHope that helps.'
    expect(extractJsonBlock(text)).toBe('{"key":"value"}')
  })

  it('brace-depth tracking is not confused by braces inside a JSON string value', () => {
    const text = 'Some commentary first.\n\n{"reason":"uses a { brace } inside a string","ok":true}'
    expect(extractJsonBlock(text)).toBe('{"reason":"uses a { brace } inside a string","ok":true}')
  })

  it('an escaped quote inside a string does not prematurely end string-tracking', () => {
    const text = 'Commentary.\n{"reason":"a \\"quoted\\" word, then a } brace","ok":true}'
    expect(extractJsonBlock(text)).toBe('{"reason":"a \\"quoted\\" word, then a } brace","ok":true}')
  })

  it('still returns the raw trimmed text when no `{` exists at all (unparseable either way)', () => {
    expect(extractJsonBlock('no json here')).toBe('no json here')
  })
})

describe('safeParseOrAiError', () => {
  const schema = z.object({ name: z.string(), value: z.number() })

  it('parses a decision preceded by commentary the model was told not to include (G1b.13 real failure pattern)', () => {
    const text = 'No memory context is available for this business — no audience notes on file.\n\n{"name":"test","value":42}'
    const result = safeParseOrAiError(schema, text)
    expect(result).toEqual({ name: 'test', value: 42 })
  })

  it('parses valid JSON that matches the schema', () => {
    const result = safeParseOrAiError(schema, '{"name":"test","value":42}')
    expect(result).toEqual({ name: 'test', value: 42 })
  })

  it('strips markdown fences before parsing', () => {
    const text = '```json\n{"name":"test","value":42}\n```'
    const result = safeParseOrAiError(schema, text)
    expect(result).toEqual({ name: 'test', value: 42 })
  })

  it('throws AiError with invalid_response on malformed JSON', () => {
    let caught: unknown
    try {
      safeParseOrAiError(schema, '{broken-json}')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(AiError)
    expect((caught as AiError).code).toBe('invalid_response')
  })

  it('throws AiError with invalid_response when JSON does not match schema', () => {
    let caught: unknown
    try {
      safeParseOrAiError(schema, '{"name":123,"value":"oops"}')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(AiError)
    expect((caught as AiError).code).toBe('invalid_response')
  })

  it('throws AiError when required fields are missing', () => {
    let caught: unknown
    try {
      safeParseOrAiError(schema, '{"name":"only-name"}')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(AiError)
    expect((caught as AiError).code).toBe('invalid_response')
  })

  it('throws AiError on completely empty input', () => {
    expect(() => safeParseOrAiError(schema, '')).toThrow(AiError)
  })
})
