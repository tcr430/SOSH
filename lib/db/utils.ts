import type { AiGenerationMetadata } from './types'

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const msg = (error as Record<string, unknown>).message
    if (typeof msg === 'string') return msg
  }
  return String(error)
}

export function parseAiGenerationMetadata(raw: unknown): Partial<AiGenerationMetadata> {
  if (typeof raw !== 'object' || raw === null) return {}
  return raw as Partial<AiGenerationMetadata>
}
