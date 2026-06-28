import { z } from 'zod'
import { parseISO } from 'date-fns'

const PLATFORMS = ['linkedin', 'twitter', 'instagram', 'facebook', 'threads'] as const

export const createCampaignSchema = z
  .object({
    name: z.string().min(1).max(100),
    objective: z.string().min(10).max(2000),
    specialInstructions: z.string().max(1000).optional(),
    platforms: z.array(z.enum(PLATFORMS)).min(1).max(5),
    frequency: z.enum(['daily', '3x_week', 'weekly', 'custom']),
    postsPerWeek: z.number().int().min(1).max(21),
    startDate: z.string().refine(s => !isNaN(Date.parse(s)), { message: 'Invalid date' }),
    endDate: z
      .string()
      .refine(s => !isNaN(Date.parse(s)), { message: 'Invalid date' })
      .optional(),
    voiceVariationId: z.string().uuid().optional().nullable(),
  })
  .refine(
    data => {
      if (data.endDate) {
        return parseISO(data.endDate) > parseISO(data.startDate)
      }
      return true
    },
    { message: 'End date must be after start date (not the same day)', path: ['endDate'] },
  )

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>
