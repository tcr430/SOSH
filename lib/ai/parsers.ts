import { z } from 'zod'
import { AiError } from './errors'

// Strips markdown code fences (```json ... ``` or ``` ... ```) if present,
// then trims whitespace. Handles Claude's tendency to wrap JSON in fences.
export function extractJsonBlock(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch?.[1] !== undefined) return fenceMatch[1].trim()
  return text.trim()
}

// Extracts JSON from text, validates against schema, returns typed result.
// On any failure (malformed JSON, schema mismatch) throws AiError('invalid_response').
export function safeParseOrAiError<T>(schema: z.ZodType<T>, text: string): T {
  let json: unknown
  try {
    json = JSON.parse(extractJsonBlock(text))
  } catch {
    throw new AiError('invalid_response', 'Response is not valid JSON')
  }

  const result = schema.safeParse(json)
  if (!result.success) {
    throw new AiError(
      'invalid_response',
      `Response schema validation failed: ${result.error.message}`,
    )
  }
  return result.data
}
