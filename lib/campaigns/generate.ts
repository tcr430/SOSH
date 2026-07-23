import * as Sentry from '@sentry/nextjs'
import { formatISO } from 'date-fns'
import { buildCustomerContext } from '@/lib/ai/context'
import { runPrompt } from '@/lib/ai/runner'
import { rubricPrompt, BRIEF_QUALITY_THRESHOLD } from '@/lib/ai/prompts/rubric'
import { PLATFORM_CONSTRAINTS, getPlatformConstraintsVersion } from '@/lib/ai/prompts/post-generation'
import { generateNativeContent } from '@/lib/ai/generate-native'
import { MODELS } from '@/lib/ai/models'
import { AiError } from '@/lib/ai/errors'
import { getCampaignById, activateCampaign } from '@/lib/db/campaigns'
import { getBriefByCampaign, markBriefGenerated } from '@/lib/db/campaign-briefs'
import { freezeBrief, type FrozenBrief } from '@/lib/campaigns/brief'
import { listPostsByCampaign, createPosts } from '@/lib/db/posts'
import { updateGenerationSessionStatus } from '@/lib/db/post-generation-sessions'
import { incrementPostsGeneratedBy } from '@/lib/db/trial-state'
import { schedulePosts } from '@/lib/campaigns/schedule'
import { checkRoleCoverage, checkLinkPlacement } from '@/lib/campaigns/consistency'
import type { Platform, PostInsert, AiGenerationMetadata, CampaignPostRole } from '@/lib/db/types'
import type { SinglePostOutput, ThreadOutput } from '@/lib/ai/prompts/formats/schemas'

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

// ADR 0017 §4.3 — selectFormatFamily's `estimatedTweetsWorth` input has no
// direct signal in CampaignBriefContent (B2.4 flagged this as a Stage-D
// concern to resolve here). First-pass heuristic: a longer angle suggests a
// denser argument likely to need multiple tweets. Tunable — not false
// precision, just an honest, deterministic Tier-0 proxy.
function estimateTweetsWorth(angle: string): number {
  if (angle.length > 200) return 5
  if (angle.length > 80) return 3
  return 1
}

function extractOpener(output: SinglePostOutput | ThreadOutput): string {
  return output.format === 'single' ? (output.body.split('\n')[0] ?? '') : (output.posts[0]?.text ?? '')
}

function joinContent(output: SinglePostOutput | ThreadOutput): string {
  // Matches the existing flat posts-table convention (post-generation.ts's
  // twitter thread format): no post_variants child table, so a thread is
  // stored as one delimited string in posts.content.
  return output.format === 'single' ? output.body : output.posts.map((p) => p.text).join('\n\n---\n\n')
}

interface GeneratedItem {
  order: number
  role: CampaignPostRole
  platform: Platform
  scheduledAt: string
  output: SinglePostOutput | ThreadOutput
  regenerationCount: number
  previousContent: string | null
}

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

    // ADR 0017 §11 — the entry point is now awaiting_brief (post Stage A),
    // not the old one-shot 'draft'.
    if (campaign.status !== 'awaiting_brief') {
      await updateGenerationSessionStatus(client, sessionId, {
        status: 'failed',
        error_code: 'invalid_campaign_state',
        completed_at: formatISO(new Date()),
      })
      return { sessionId, postsCreated: 0 }
    }

    // PRESERVED UNCHANGED (generate.ts:63-71 pre-B2.6) — idempotency guard,
    // same position, same logic.
    const existingPosts = await listPostsByCampaign(client, campaignId)
    if (existingPosts.length > 0) {
      await updateGenerationSessionStatus(client, sessionId, {
        status: 'failed',
        error_code: 'already_generated',
        completed_at: formatISO(new Date()),
      })
      return { sessionId, postsCreated: 0 }
    }

    // NEW (ADR §11) — generation is gated on the atomic campaign_briefs
    // approved -> generated transition. Soft pre-checks first (clear error
    // codes on the obvious cases), then the ATOMIC claim.
    const brief = await getBriefByCampaign(client, campaignId)
    if (!brief || brief.status !== 'approved') {
      await updateGenerationSessionStatus(client, sessionId, {
        status: 'failed',
        error_code: 'invalid_campaign_state',
        completed_at: formatISO(new Date()),
      })
      return { sessionId, postsCreated: 0 }
    }

    const claimedBrief = await markBriefGenerated(client, brief.id)
    if (!claimedBrief) {
      // Guard rejected: another run already claimed this brief (race) — same
      // idempotency semantics as the existingPosts check above.
      await updateGenerationSessionStatus(client, sessionId, {
        status: 'failed',
        error_code: 'already_generated',
        completed_at: formatISO(new Date()),
      })
      return { sessionId, postsCreated: 0 }
    }

    // MODE2-BRIEF-FROZEN — ONE FrozenBrief instance, read from for every
    // per-platform call below. Never re-fetched/re-frozen mid-run.
    //
    // Freezes `brief` (the pre-claim, still-'approved' read), NOT
    // `claimedBrief`: freezeBrief's guard requires status==='approved', and
    // markBriefGenerated has already transitioned the row to 'generated' by
    // this point. Content (narrative/roleSequence/pinnedEvidence) and
    // frozen_at are identical between the two reads — only status differs —
    // so freezing the pre-claim row is correct, not stale.
    const frozenBrief: FrozenBrief = freezeBrief(brief)

    if (frozenBrief.content.roleSequence.length === 0) {
      // Replaces the old total_posts_planned<=0||platforms.length===0 check
      // — same "nothing to generate" purpose, now sourced from the brief.
      await updateGenerationSessionStatus(client, sessionId, {
        status: 'failed',
        error_code: 'invalid_campaign_state',
        completed_at: formatISO(new Date()),
      })
      return { sessionId, postsCreated: 0 }
    }

    // STEP 4 — Build customer context (§4.3: pass variation so descriptor reflects campaign's voice)
    // ADR 0017 §5.1 (L-10) — BYTE-IDENTICAL to the pre-B2.6 call. Memory
    // wires into the BRIEF (assembled in Stage A, already frozen above),
    // never into this context.
    const ctx = await buildCustomerContext(businessId, campaign.voice_variation_id)

    if (!ctx.brandVoice) {
      await updateGenerationSessionStatus(client, sessionId, {
        status: 'failed',
        error_code: 'invalid_campaign_state',
        completed_at: formatISO(new Date()),
      })
      return { sessionId, postsCreated: 0 }
    }

    // STEP 5 — Trial pre-flight (P-4, R-2), now sized from the brief's roleSequence
    const totalPosts = frozenBrief.content.roleSequence.length
    if (ctx.trialState !== null && ctx.trialState.postsRemaining < totalPosts) {
      await updateGenerationSessionStatus(client, sessionId, {
        status: 'failed',
        error_code: 'quota_exceeded',
        completed_at: formatISO(new Date()),
      })
      return { sessionId, postsCreated: 0 }
    }

    // STEP 6 — Schedule dates per platform, sized by the brief's roleSequence
    // (not an even split of a bare count — the brief's plan IS the schedule shape)
    const activePlatforms = CANONICAL_PLATFORM_ORDER.filter((p) =>
      frozenBrief.content.roleSequence.some((r) => r.platform === p),
    )
    const scheduleMap = new Map<Platform, string[]>()
    for (const platform of activePlatforms) {
      const entriesForPlatform = frozenBrief.content.roleSequence.filter((r) => r.platform === platform)
      const dates = schedulePosts({
        startDate: campaign.start_date,
        endDate: campaign.end_date,
        frequency: campaign.frequency,
        postsPerWeek: campaign.posts_per_week,
        platform,
        count: entriesForPlatform.length,
        timezone: ctx.business.timezone,
      })
      scheduleMap.set(platform, dates)
    }

    // STEP 7 — Generate per platform, N INDEPENDENT calls from the SAME
    // frozen brief (ADR §5, MODE2-BRIEF-FROZEN) — not one joint call.
    const generated: GeneratedItem[] = []

    for (const platform of activePlatforms) {
      const entriesForPlatform = frozenBrief.content.roleSequence.filter((r) => r.platform === platform)
      const dates = scheduleMap.get(platform)!

      for (let i = 0; i < entriesForPlatform.length; i++) {
        const entry = entriesForPlatform[i]
        const scheduledAt = dates[i]
        const pinnedEvidenceIds = frozenBrief.content.pinnedEvidence.map((e) => e.evidenceMemoryId)
        // typescript-reviewer MINOR (B2.6): one builder, not two byte-identical
        // object literals at each call site — a future field addition now only
        // needs updating here.
        const genInput = () => ({
          angle: entry.angle,
          role: entry.role,
          platform: entry.platform,
          narrative: frozenBrief.content.narrative,
          pinnedEvidenceIds,
          scheduledAt,
          estimatedTweetsWorth: estimateTweetsWorth(entry.angle),
        })

        let output: SinglePostOutput | ThreadOutput
        try {
          output = await generateNativeContent(client, ctx, genInput())
        } catch (err: unknown) {
          const errorCode = err instanceof AiError ? err.code : 'generic'
          await updateGenerationSessionStatus(client, sessionId, {
            status: 'failed',
            error_code: errorCode,
            completed_at: formatISO(new Date()),
          })
          return { sessionId, postsCreated: 0 }
        }

        // ADR §7 — the hook Tier-2 loop. Score the opener against the
        // rubric's openingStrength dimension (the dimension purpose-built
        // for this, §6.1); regenerate ONCE if below threshold, no re-score
        // of the second attempt (bounded — this is the ONLY Tier-2 in the
        // whole pipeline, no Tier-3 anywhere).
        let regenerationCount = 0
        let previousContent: string | null = null
        try {
          const openerScore = await runPrompt(rubricPrompt, ctx, {
            mode: 'post' as const,
            contentLabel: `${entry.platform} post opener`,
            content: extractOpener(output),
            platform: entry.platform,
          })
          if (openerScore.dimensions.openingStrength.score < BRIEF_QUALITY_THRESHOLD) {
            previousContent = joinContent(output)
            output = await generateNativeContent(client, ctx, genInput())
            regenerationCount = 1
          }
        } catch (hookErr: unknown) {
          // A hook-scoring hiccup (e.g. rate limit) must not abort a
          // generation that already succeeded — logged, not silently
          // swallowed, and the original content stands unregenerated.
          console.log(JSON.stringify({
            kind: 'campaign.generate.hook_loop_scoring_failed',
            level: 'warn',
            campaign_id: campaignId,
            platform: entry.platform,
            error: hookErr instanceof Error ? hookErr.message : String(hookErr),
          }))
        }

        generated.push({
          order: entry.order,
          role: entry.role,
          platform: entry.platform,
          scheduledAt,
          output,
          regenerationCount,
          previousContent,
        })
      }
    }

    // ADR §8 — the deterministic consistency pass (Tier 0, free). A
    // violation fails the whole session (no partial insert) — consistent
    // with this function's existing all-or-nothing error handling.
    const roleCoverage = checkRoleCoverage(
      generated.map((g) => ({ order: g.order })),
      frozenBrief.content.roleSequence,
    )
    const threadOutputs = generated
      .filter((g): g is GeneratedItem & { output: ThreadOutput } => g.output.format === 'thread')
      .map((g) => g.output)
    const linkPlacement = checkLinkPlacement(threadOutputs)

    if (!roleCoverage.ok || !linkPlacement.ok) {
      console.log(JSON.stringify({
        kind: 'campaign.generate.consistency_check_failed',
        level: 'error',
        campaign_id: campaignId,
        missing_orders: roleCoverage.missingOrders,
        link_violations: linkPlacement.violations,
      }))
      await updateGenerationSessionStatus(client, sessionId, {
        status: 'failed',
        error_code: 'consistency_check_failed',
        completed_at: formatISO(new Date()),
      })
      return { sessionId, postsCreated: 0 }
    }

    // STEP 8 — Build insert rows, role assigned from the brief (write-once,
    // DB-trigger-enforced from B2.0 — never mutated after this insert).
    const generatedAt = formatISO(new Date())
    const allInserts: PostInsert[] = generated.map((g) => {
      const metadata: AiGenerationMetadata = {
        promptId: g.output.format === 'thread' ? 'native-generation-thread' : 'native-generation-single',
        promptVersion: 1,
        // typescript-reviewer NIT (B2.6): derived from MODELS, not a literal
        // string — both native-generation format families use SONNET_4_6
        // (native-generation-prompt.ts), so this stays correct if that
        // ever changes per-family, unlike a hardcoded id string would.
        model: MODELS.SONNET_4_6.id,
        generationSessionId: sessionId,
        platformContext: PLATFORM_CONSTRAINTS[g.platform],
        platformConstraintsVersion: getPlatformConstraintsVersion(),
        rationale: frozenBrief.content.roleSequence.find((r) => r.order === g.order)?.angle ?? '',
        regenerationCount: g.regenerationCount,
        previousVersions:
          g.previousContent !== null
            ? [{ content: g.previousContent, rejectionNote: 'weak opener (openingStrength below threshold)', regeneratedAt: generatedAt }]
            : [],
        generatedAt,
      }
      return {
        campaign_id: campaignId,
        business_id: businessId,
        platform: g.platform,
        content: joinContent(g.output),
        role: g.role,
        scheduled_at: g.scheduledAt,
        status: 'draft',
        ai_generation_metadata: metadata,
      }
    })

    // STEP 9 — Single batch insert (P-1)
    const inserted = await createPosts(client, allInserts)
    const postsCreated = inserted.length

    // STEP 10 — Update campaign atomically (guard on 'awaiting_brief' prevents double-write)
    const activated = await activateCampaign(client, campaignId, postsCreated)
    if (!activated) {
      // Guard rejected: campaign no longer in 'awaiting_brief' status.
      // Self-healing — next generation attempt re-evaluates — but operator-visible.
      console.log(JSON.stringify({
        kind: 'campaign.activate.guard_rejected',
        level: 'warn',
        campaign_id: campaignId,
        posts_created: postsCreated,
      }))
      Sentry.addBreadcrumb({
        category: 'campaign',
        message: 'activateCampaign guard rejected',
        level: 'warning',
        data: { campaign_id: campaignId },
      })
    }

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
