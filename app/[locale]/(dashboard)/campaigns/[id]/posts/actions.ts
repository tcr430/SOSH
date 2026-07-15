'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { formatISO } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getCampaignById } from '@/lib/db/campaigns'
import {
  approvePost,
  unapprovePost,
  skipPost,
  unskipPost,
  updatePostContent,
  updatePostContentAndMetadata,
  bulkApproveDraftPosts,
  getPostById,
  getPostSiblingTopics,
} from '@/lib/db/posts'
import { buildCustomerContext } from '@/lib/ai/context'
import { runPrompt } from '@/lib/ai/runner'
import { AiError, type AiErrorCode } from '@/lib/ai/errors'
import { postRegenerationPrompt } from '@/lib/ai/prompts/post-regeneration'
import type { AiGenerationMetadata, Platform } from '@/lib/db/types'
import { parseAiGenerationMetadata } from '@/lib/db/utils'

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export type PostActionErrorCode = 'invalid_input' | 'generic' | 'not_eligible' | AiErrorCode

export type PostActionState = {
  success?: boolean
  error?: PostActionErrorCode
  count?: number
  content?: string
  hashtags?: string[]
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function getAuthContext() {
  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return null
  const business = await getBusinessForUser(client, user.id)
  if (!business) return null
  return { client, business }
}

function revalidateCampaignPosts(campaignId: string): void {
  // Literal /[locale]/... brackets are the Next.js 16 pattern for invalidating a dynamic
  // segment across all its values — this correctly purges every locale at once.
  revalidatePath(`/[locale]/campaigns/${campaignId}/posts`, 'page')
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const postIdSchema = z.object({ postId: z.string().uuid() })
const bulkApproveSchema = z.object({
  campaignId: z.string().uuid(),
  renderedIds: z.array(z.string().uuid()),
})

// ---------------------------------------------------------------------------
// approvePostAction
// ---------------------------------------------------------------------------

export async function approvePostAction(postId: string): Promise<PostActionState> {
  const parsed = postIdSchema.safeParse({ postId })
  if (!parsed.success) return { error: 'invalid_input' }

  try {
    const ctx = await getAuthContext()
    if (!ctx) return { error: 'generic' }

    const row = await approvePost(ctx.client, postId)
    revalidateCampaignPosts(row.campaign_id)
    return { success: true }
  } catch {
    return { error: 'generic' }
  }
}

// ---------------------------------------------------------------------------
// unapprovePostAction
// ---------------------------------------------------------------------------

export async function unapprovePostAction(postId: string): Promise<PostActionState> {
  const parsed = postIdSchema.safeParse({ postId })
  if (!parsed.success) return { error: 'invalid_input' }

  try {
    const ctx = await getAuthContext()
    if (!ctx) return { error: 'generic' }

    const row = await unapprovePost(ctx.client, postId)
    revalidateCampaignPosts(row.campaign_id)
    return { success: true }
  } catch {
    return { error: 'generic' }
  }
}

// ---------------------------------------------------------------------------
// skipPostAction
// ---------------------------------------------------------------------------

const skipPostSchema = z.object({
  postId: z.string().uuid(),
  rejectionNote: z.string().min(3).max(500),
})

export async function skipPostAction(
  postId: string,
  rejectionNote: string,
): Promise<PostActionState> {
  const parsed = skipPostSchema.safeParse({ postId, rejectionNote })
  if (!parsed.success) return { error: 'invalid_input' }

  try {
    const ctx = await getAuthContext()
    if (!ctx) return { error: 'generic' }

    const row = await skipPost(ctx.client, postId, rejectionNote)
    revalidateCampaignPosts(row.campaign_id)
    return { success: true }
  } catch {
    return { error: 'generic' }
  }
}

// ---------------------------------------------------------------------------
// unskipPostAction
// ---------------------------------------------------------------------------

export async function unskipPostAction(postId: string): Promise<PostActionState> {
  const parsed = postIdSchema.safeParse({ postId })
  if (!parsed.success) return { error: 'invalid_input' }

  try {
    const ctx = await getAuthContext()
    if (!ctx) return { error: 'generic' }

    const row = await unskipPost(ctx.client, postId)
    revalidateCampaignPosts(row.campaign_id)
    return { success: true }
  } catch {
    return { error: 'generic' }
  }
}

// ---------------------------------------------------------------------------
// updatePostContentAction
// ---------------------------------------------------------------------------

const updateContentSchema = z.object({
  postId: z.string().uuid(),
  content: z.string().min(1).max(5000),
  hashtags: z.array(z.string().max(100)).max(30),
})

export async function updatePostContentAction(
  postId: string,
  content: string,
  hashtags: string[],
): Promise<PostActionState> {
  const parsed = updateContentSchema.safeParse({ postId, content, hashtags })
  if (!parsed.success) return { error: 'invalid_input' }

  try {
    const ctx = await getAuthContext()
    if (!ctx) return { error: 'generic' }

    const row = await updatePostContent(ctx.client, postId, { content, hashtags })
    revalidateCampaignPosts(row.campaign_id)
    return { success: true }
  } catch {
    return { error: 'generic' }
  }
}

// ---------------------------------------------------------------------------
// bulkApprovePostsAction
// ---------------------------------------------------------------------------

export async function bulkApprovePostsAction(
  campaignId: string,
  renderedIds: string[],
): Promise<PostActionState> {
  const parsed = bulkApproveSchema.safeParse({ campaignId, renderedIds })
  if (!parsed.success) return { error: 'invalid_input' }

  try {
    const ctx = await getAuthContext()
    if (!ctx) return { error: 'generic' }

    // Session 22-D (BLOCKER-1/2): approve exactly the ids the caller rendered
    // — no business-wide count gate, no window-size argument. A caller can
    // never approve a draft it never showed the human.
    const count = await bulkApproveDraftPosts(
      ctx.client,
      campaignId,
      parsed.data.renderedIds,
      ctx.business.id,
    )
    revalidateCampaignPosts(campaignId)
    return { success: true, count }
  } catch {
    return { error: 'generic' }
  }
}

// ---------------------------------------------------------------------------
// regeneratePostAction
// ---------------------------------------------------------------------------

const regenerateSchema = z.object({
  postId: z.string().uuid(),
  feedbackNote: z.string().min(5).max(1000),
})

export async function regeneratePostAction(
  postId: string,
  feedbackNote: string,
): Promise<PostActionState> {
  const parsed = regenerateSchema.safeParse({ postId, feedbackNote })
  if (!parsed.success) return { error: 'invalid_input' }

  try {
    const ctx = await getAuthContext()
    if (!ctx) return { error: 'generic' }

    let post
    try {
      post = await getPostById(ctx.client, postId)
    } catch {
      return { error: 'not_eligible' }
    }

    if (post.status !== 'draft') return { error: 'not_eligible' }

    let campaign
    try {
      campaign = await getCampaignById(ctx.client, post.campaign_id)
    } catch {
      return { error: 'not_eligible' }
    }

    const siblingTopics = await getPostSiblingTopics(ctx.client, post.campaign_id, postId)
    const aiCtx = await buildCustomerContext(campaign.business_id)

    // Defence-in-depth trial pre-flight (runPrompt also enforces internally)
    if (aiCtx.trialState && aiCtx.trialState.postsRemaining < 1) {
      return { error: 'quota_exceeded' }
    }

    const existingMetadata = parseAiGenerationMetadata(post.ai_generation_metadata)

    const input = {
      postId,
      previousContent: post.content,
      previousRationale: existingMetadata.rationale ?? '',
      previousHashtags: post.hashtags ?? [],
      feedbackNote,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        objective: campaign.objective,
        special_instructions: campaign.special_instructions,
      },
      targetPlatform: post.platform as Platform,
      scheduledAt: post.scheduled_at,
      siblingPostsTopics: siblingTopics,
    }

    let output
    try {
      output = await runPrompt(postRegenerationPrompt, aiCtx, input)
    } catch (e) {
      if (e instanceof AiError) return { error: e.code }
      return { error: 'generic' }
    }

    // Build updated metadata — cap previousVersions at 5 (newest first)
    const newEntry = {
      content: post.content,
      rejectionNote: feedbackNote,
      regeneratedAt: formatISO(new Date()),
    }
    const previousVersions = [
      newEntry,
      ...(existingMetadata.previousVersions ?? []),
    ].slice(0, 5)

    const newMetadata: AiGenerationMetadata = {
      ...(existingMetadata as AiGenerationMetadata),
      regenerationCount: (existingMetadata.regenerationCount ?? 0) + 1,
      previousVersions,
      rationale: output.rationale,
    }

    await updatePostContentAndMetadata(ctx.client, postId, {
      content: output.content,
      hashtags: output.hashtags,
      metadata: newMetadata,
    })

    revalidateCampaignPosts(post.campaign_id)
    return { success: true, content: output.content, hashtags: output.hashtags }
  } catch {
    return { error: 'generic' }
  }
}
