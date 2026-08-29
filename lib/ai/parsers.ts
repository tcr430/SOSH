import { z } from 'zod'
import { AiError } from './errors'

// Scans from the first `{` and returns the substring up to its MATCHING
// closing `}` (brace-depth tracked, quoted-string-aware so a `{`/`}`
// inside a JSON string value never miscounts) — or null if no balanced
// object is found. Session 30 G1b.13's live triage run discovered the
// model prefixing its JSON decision with a sentence of prose despite an
// explicit "no commentary" instruction (~75% of calls in that run) —
// extractJsonBlock's old behaviour (whole-text-must-be-JSON, fences only)
// hard-failed every one of those as invalid_response. This is a real
// production risk, not eval-only: the same non-compliance can happen on
// any runPrompt/runToolLoop call, fenced or not.
function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

// Strips markdown code fences (```json ... ``` or ``` ... ```) if present,
// then trims whitespace. Handles Claude's tendency to wrap JSON in fences.
// Falls back to a balanced-brace scan (above) when the fence-stripped/
// trimmed text is not, on its own, valid JSON — this tolerates prose
// BEFORE or AFTER the JSON object without weakening the schema check that
// follows (safeParseOrAiError still validates strictly; a bad extraction
// here just fails validation instead of failing to parse at all).
export function extractJsonBlock(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch?.[1] !== undefined) return fenceMatch[1].trim()
  const trimmed = text.trim()
  try {
    JSON.parse(trimmed)
    return trimmed
  } catch {
    // Fall through — the whole trimmed text is not valid JSON on its own.
  }
  return extractBalancedJsonObject(trimmed) ?? trimmed
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
