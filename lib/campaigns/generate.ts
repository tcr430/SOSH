import { formatISO } from 'date-fns'
import { buildCustomerContext } from '@/lib/ai/context'
import { runPrompt } from '@/lib/ai/runner'
import { postGenerationPrompt, PLATFORM_CONSTRAINTS, getPlatformConstraintsVersion } from '@/lib/ai/prompts/post-generation'
import { MODELS } from '@/lib/ai/models'
import { getCampaignById, activateCampaign } from '@/lib/db/campaigns'
import { listPostsByCampaign, createPosts } from '@/lib/db/posts'
import { updateGenerationSessionStatus } from '@/lib/db/post-generation-sessions'
import { incrementPostsGeneratedBy } from '@/lib/db/trial-state'
import { schedulePosts } from '@/lib/campaigns/schedule'
import { AiError } from '@/lib/ai/errors'
import type { Platform, PostInsert, AiGenerationMetadata } from '@/lib/db/types'
import type { PostGenerationInput, PostGenerationOutput } from '@/lib/ai/prompts/post-generation'

export interface GenerateResult {
  sessionId: string
  postsCreated: number
}

const CANONICAL_PLATFORM_ORDER: Platform[] = [
  'linkedin',
  'twitter',
  'instagram',
  'facebook',
  'threads',
]

export async function generatePostsForCampaign(
  campaignId: string,
  businessId: string,
  sessionId: string,
): Promise<GenerateResult> {
  // STEP 1 — Service-role client (lazy import)
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()

  // STEP 2 — Mark session generating
  await updateGenerationSessionStatus(client, sessionId, { status: 'generating' })

  try {
    // STEP 3 — Load and validate campaign (P-3 idempotency guard)
    const campaign = await getCampaignById(client, campaignId)

    if (!campaign || campaign.business_id !== businessId) {
      await updateGenerationSessionStatus(client, sessionId, {
        status: 'failed',
        error_code: 'invalid_campaign_state',
        completed_at: formatISO(new Date()),
      })
      return { sessionId, postsCreated: 0 }
    }

    if (campaign.status !== 'draft') {
      await updateGenerationSessionStatus(client, sessionId, {
        status: 'failed',
        error_code: 'invalid_campaign_state',
        completed_at: formatISO(new Date()),
      })
      return { sessionId, postsCreated: 0 }
    }

    const existingPosts = await listPostsByCampaign(client, campaignId)
    if (existingPosts.length > 0) {
      await updateGenerationSessionStatus(client, sessionId, {
        status: 'failed',
        error_code: 'already_generated',
        completed_at: formatISO(new Date()),
      })
      return { sessionId, postsCreated: 0 }
    }

    if (campaign.total_posts_planned <= 0 || campaign.platforms.length === 0) {
      await updateGenerationSessionStatus(client, sessionId, {
        status: 'failed',
        error_code: 'invalid_campaign_state',
        completed_at: formatISO(new Date()),
      })
      return { sessionId, postsCreated: 0 }
    }

    // STEP 4 — Build customer context
    const ctx = await buildCustomerContext(businessId)

    if (!ctx.brandVoice) {
      await updateGenerationSessionStatus(client, sessionId, {
        status: 'failed',
        error_code: 'invalid_campaign_state',
        completed_at: formatISO(new Date()),
      })
      return { sessionId, postsCreated: 0 }
    }

    // STEP 5 — Trial pre-flight (P-4, R-2)
    const totalPosts = campaign.total_posts_planned
    if (ctx.trialState !== null && ctx.trialState.postsRemaining < totalPosts) {
      await updateGenerationSessionStatus(client, sessionId, {
        status: 'failed',
        error_code: 'quota_exceeded',
        completed_at: formatISO(new Date()),
      })
      return { sessionId, postsCreated: 0 }
    }

    // STEP 6 — Compute schedules per platform (P-5 canonical order)
    const activePlatforms = CANONICAL_PLATFORM_ORDER.filter(p =>
      campaign.platforms.includes(p)
    )
    const n = activePlatforms.length
    const scheduleMap = new Map<Platform, string[]>()

    activePlatforms.forEach((platform, idx) => {
      const platformPostCount =
        idx < totalPosts % n
          ? Math.ceil(totalPosts / n)
          : Math.floor(totalPosts / n)

      const dates = schedulePosts({
        startDate: campaign.start_date,
        endDate: campaign.end_date,
        frequency: campaign.frequency,
        postsPerWeek: campaign.posts_per_week,
        platform,
        count: platformPostCount,
        timezone: ctx.business.timezone,
      })
      scheduleMap.set(platform, dates)
    })

    // STEP 7 — Generate per platform; collect all outputs (P-1)
    const allOutputs: Array<{
      platform: Platform
      posts: PostGenerationOutput['posts']
      scheduledDates: string[]
    }> = []
    const alreadyGeneratedTopics: string[] = []

    for (const platform of activePlatforms) {
      const dates = scheduleMap.get(platform)!

      const input: PostGenerationInput = {
        campaign: {
          id: campaign.id,
          name: campaign.name,
          objective: campaign.objective,
          special_instructions: campaign.special_instructions,
          platforms: campaign.platforms,
          frequency: campaign.frequency,
          posts_per_week: campaign.posts_per_week,
          start_date: campaign.start_date,
          end_date: campaign.end_date,
        },
        targetPlatform: platform,
        postsToGenerate: dates.length,
        scheduledDates: dates,
        alreadyGeneratedTopics: alreadyGeneratedTopics.slice(-10),
      }

      let output: PostGenerationOutput
      try {
        output = await runPrompt(postGenerationPrompt, ctx, input)
      } catch (err: unknown) {
        const errorCode = err instanceof AiError ? err.code : 'generic'
        await updateGenerationSessionStatus(client, sessionId, {
          status: 'failed',
          error_code: errorCode,
          completed_at: formatISO(new Date()),
        })
        return { sessionId, postsCreated: 0 }
      }

      allOutputs.push({ platform, posts: output.posts, scheduledDates: dates })
      alreadyGeneratedTopics.push(...output.posts.map(p => p.rationale))
    }

    // STEP 8 — Build insert rows
    const allInserts: PostInsert[] = []
    for (const { platform, posts } of allOutputs) {
      for (const post of posts) {
        const metadata: AiGenerationMetadata = {
          promptId: postGenerationPrompt.id,
          promptVersion: postGenerationPrompt.version,
          model: MODELS.SONNET_4_6.id,
          generationSessionId: sessionId,
          platformContext: PLATFORM_CONSTRAINTS[platform],
          platformConstraintsVersion: getPlatformConstraintsVersion(),
          rationale: post.rationale,
          regenerationCount: 0,
          previousVersions: [],
          generatedAt: formatISO(new Date()),
        }
        allInserts.push({
          campaign_id: campaignId,
          business_id: businessId,
          platform,
          content: post.content,
          hashtags: post.hashtags,
          scheduled_at: post.scheduledAt,
          status: 'draft',
          ai_generation_metadata: metadata,
        })
      }
    }

    // STEP 9 — Single batch insert (P-1)
    const inserted = await createPosts(client, allInserts)
    const postsCreated = inserted.length

    // STEP 10 — Update campaign atomically (guard on 'draft' prevents double-write)
    await activateCampaign(client, campaignId, postsCreated)

    // STEP 11 — Increment trial counter (R-1)
    await incrementPostsGeneratedBy(businessId, postsCreated)

    // STEP 12 — Mark session complete
    await updateGenerationSessionStatus(client, sessionId, {
      status: 'complete',
      posts_created: postsCreated,
      completed_at: formatISO(new Date()),
    })

    return { sessionId, postsCreated }
  } catch (err: unknown) {
    await updateGenerationSessionStatus(client, sessionId, {
      status: 'failed',
      error_code: 'generic',
      completed_at: formatISO(new Date()),
    })
    return { sessionId, postsCreated: 0 }
  }
}
