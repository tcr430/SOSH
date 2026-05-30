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
})

describe('safeParseOrAiError', () => {
  const schema = z.object({ name: z.string(), value: z.number() })

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
