import { z } from 'zod'

const axisSchema = z.number().int().min(0).max(100)

export const voiceAxesSchema = z.object({
  formal_casual: axisSchema,
  expert_peer: axisSchema,
  serious_playful: axisSchema,
  reserved_warm: axisSchema,
  calm_energetic: axisSchema,
  rational_emotional: axisSchema,
  exclusive_inclusive: axisSchema,
})

export type VoiceAxes = z.infer<typeof voiceAxesSchema>

export const NEUTRAL_VOICE_AXES: VoiceAxes = {
  formal_casual: 50,
  expert_peer: 50,
  serious_playful: 50,
  reserved_warm: 50,
  calm_energetic: 50,
  rational_emotional: 50,
  exclusive_inclusive: 50,
}
