import { z } from 'zod'

const axisSchema = z.number().int().min(0).max(100)
const axisCoerceSchema = z.coerce.number().int().min(0).max(100)
const wordArraySchema = z.array(z.string().max(100)).max(20)

export const voiceAxesSchema = z.object({
  formal_casual: axisSchema,
  expert_peer: axisSchema,
  serious_playful: axisSchema,
  reserved_warm: axisSchema,
  calm_energetic: axisSchema,
  rational_emotional: axisSchema,
  exclusive_inclusive: axisSchema,
})

/** FormData-safe variant — coerces string values from `<input type="range">` to integers. */
export const voiceAxesCoerceSchema = z.object({
  formal_casual: axisCoerceSchema,
  expert_peer: axisCoerceSchema,
  serious_playful: axisCoerceSchema,
  reserved_warm: axisCoerceSchema,
  calm_energetic: axisCoerceSchema,
  rational_emotional: axisCoerceSchema,
  exclusive_inclusive: axisCoerceSchema,
})

/** Full payload schema for VoiceEditorSavePayload — validates axes + text arrays before any DB write. */
export const voicePayloadSchema = z.object({
  voiceAxes: voiceAxesSchema,
  tone: wordArraySchema,
  keywords: wordArraySchema,
  avoidWords: wordArraySchema,
})

export type VoiceAxes = z.infer<typeof voiceAxesSchema>

export const VOICE_VARIATION_CAP = 5

export const NEUTRAL_VOICE_AXES: VoiceAxes = {
  formal_casual: 50,
  expert_peer: 50,
  serious_playful: 50,
  reserved_warm: 50,
  calm_energetic: 50,
  rational_emotional: 50,
  exclusive_inclusive: 50,
}
