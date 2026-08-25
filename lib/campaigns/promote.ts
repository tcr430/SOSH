import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'
import { claimStudioDraftForPromotion, writeBackPromotedCampaignId } from '@/lib/db/studio-drafts'
import { createCampaign } from '@/lib/db/campaigns'
import { createPosts } from '@/lib/db/posts'
import { createPostAiOriginal, AI_ORIGINAL_SCHEMA_VERSION } from '@/lib/db/post-ai-originals'
import { assembleBrief } from '@/lib/campaigns/brief'
import { toUtcIso } from '@/lib/utils'
import type { Platform, StudioDraftRow } from '@/lib/db/types'

// ADR 0022 §2 (Session 29, F1b.4) — promote-to-campaign's core logic. A
// plain, client-parameterized function (not a 'use server' action) for the
// same reason lib/signals/seed.ts's seedCampaignFromCard is: it is the
// PROMOTE-BRIEF-END-TO-END test's vehicle for driving assembleBrief through
// real Postgres with a REAL signed-in client (ADR 0021 A-2's binding
// condition, applied to assembleBrief's second production caller, §9/§11.1)
// — createClient() (lib/supabase/server.ts) depends on next/headers'
// cookies(), which has no request scope in a Vitest run, so a Tier-1 test
// cannot call the Server Action itself. app/[locale]/(dashboard)/studio/
// actions.ts's promoteDraftToCampaign is the thin 'use server' wrapper:
// Zod-validate, resolve the authenticated client, delegate here.

export type PromoteDraftToCampaignResult =
  | { outcome: 'promoted'; campaignId: string; briefId: string; postId: string }
  // §3.3 — the claim's typed loser outcomes, passed through so the caller
  // can render the draft's REAL current state (§10's "already promoted" /
  // "reclaimable" arms), never a generic error.
  | { outcome: 'already_promoted'; draft: StudioDraftRow }
  | { outcome: 'claimed_by_another'; draft: StudioDraftRow }
  // Session 29-D, D8 (MINOR-8) — passed through from claimStudioDraftForPromotion.
  | { outcome: 'not_found' }
  // §10's "not promotable" gate, re-checked server-side. A won-but-
  // ineligible claim is deliberately left claimed (not un-claimed) — it
  // becomes reclaimable after PROMOTE_CLAIM_STALE_MINUTES elapses, the same
  // stranded-winner handling §3.4 gives a mid-flight crash.
  | { outcome: 'not_eligible' }
  | { outcome: 'content_too_long' }
  | { outcome: 'error' }

// Mirrors calendar/actions.ts:48 and posts/actions.ts:179 — promote must not
// be the one write path into posts.content with a weaker contract than every
// other (ADR 0022 §5.1). studio_drafts.content itself is UNBOUNDED today, so
// this bound does real work here, unlike at those two existing call sites.
const PROMOTE_CONTENT_MAX_CHARS = 5000

// Session 29 (mirrors seed.ts's SEED_NAME_MAX_CHARS/SEED_FREQUENCY/
// SEED_POSTS_PER_WEEK decision, lib/signals/seed.ts:37-39, Session 28
// E5.10): campaigns.name/frequency/posts_per_week are NOT NULL with no DB
// default and ADR 0022 does not name a value for any of the three, so this
// is a decision made explicitly here, not silently assumed. frequency/
// posts_per_week are conservative defaults a human can change during brief
// review — nothing here auto-publishes (L-2).
const PROMOTE_NAME_MAX_CHARS = 80
const PROMOTE_FREQUENCY = 'weekly' as const
const PROMOTE_POSTS_PER_WEEK = 3

function truncateForCampaignName(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

// ADR 0022 §2.4 — REUSES composeObjective's SHAPE (lib/signals/seed.ts:22-26),
// generalized for a draft instead of a card. Does NOT extend
// BriefAssemblyInput (lib/ai/prompts/brief.ts:61-68) — its six fields stay
// untouched; this only composes the string that fills the existing
// `objective` slot (ADR 0021 §6.1's ruling, applied to a second caller).
function composePromoteObjective(draft: Pick<StudioDraftRow, 'content' | 'platform'>): string {
  const parts = [draft.content]
  if (draft.platform) parts.push(`Platform: ${draft.platform}`)
  return parts.join('\n\n')
}

export async function promoteDraftToCampaignCore(
  client: SupabaseClient,
  businessId: string,
  draftId: string,
  scheduledAt: string,
): Promise<PromoteDraftToCampaignResult> {
  // ADR 0022 §2.1 step 1 — claim FIRST, before any other write. On a losing
  // claim, return its typed outcome and do NOTHING else (§3.3).
  const claim = await claimStudioDraftForPromotion(client, draftId, businessId)
  if (claim.outcome === 'already_promoted') return { outcome: 'already_promoted', draft: claim.draft }
  if (claim.outcome === 'claimed_by_another') return { outcome: 'claimed_by_another', draft: claim.draft }
  if (claim.outcome === 'not_found') return { outcome: 'not_found' }
  const draft = claim.draft

  const trimmedContent = draft.content.trim()
  if (trimmedContent.length === 0 || draft.platform === null) {
    return { outcome: 'not_eligible' }
  }
  const platform: Platform = draft.platform

  const contentParsed = z.string().min(1).max(PROMOTE_CONTENT_MAX_CHARS).safeParse(trimmedContent)
  if (!contentParsed.success) return { outcome: 'content_too_long' }
  const content = contentParsed.data

  try {
    // ADR 0022 §2.1 step 2 — createCampaign, origin='studio_promoted' (§2.3).
    const campaign = await createCampaign(client, {
      business_id: businessId,
      name: truncateForCampaignName(content, PROMOTE_NAME_MAX_CHARS),
      objective: composePromoteObjective({ content, platform }),
      platforms: [platform],
      frequency: PROMOTE_FREQUENCY,
      posts_per_week: PROMOTE_POSTS_PER_WEEK,
      start_date: toUtcIso(new Date()).slice(0, 10),
      origin: 'studio_promoted',
    })

    // ADR 0022 §2.1 step 3 — write back IMMEDIATELY, before step 6.
    await writeBackPromotedCampaignId(client, draft.id, businessId, campaign.id)

    // ADR 0022 §2.1 step 4 / §2.5 (A-3) — the human's OWN prose, with the
    // USER-CHOSEN scheduled_at. status='draft': nothing publishes drafts,
    // and approvePost must re-touch scheduled_at before this can go out.
    const [post] = await createPosts(client, [
      {
        campaign_id: campaign.id,
        business_id: businessId,
        platform,
        content,
        scheduled_at: scheduledAt,
        status: 'draft',
      },
    ])

    // ADR 0022 §2.1 step 5 / ADR 0018 Amd A.1's BINDING corollary — write
    // the snapshot IF AND ONLY IF the retained accepted revision is
    // non-NULL, and its content is THAT REVISION, never the human's raw
    // draft. When NULL (human-authored, no suggestion ever accepted), write
    // NO ROW AT ALL — the trigger's skip path
    // (20260726010000_learning_capture.sql:205-207) handles it exactly as
    // designed. A snapshot fabricated from human text would make the
    // classifier diff human text against itself and poison
    // performance_memory — the single most damaging mistake available here.
    if (draft.accepted_revision !== null) {
      await createPostAiOriginal(client, {
        business_id: businessId,
        post_id: post.id,
        campaign_id: campaign.id,
        revision: 1,
        generation_kind: 'studio_promoted',
        format: 'single',
        payload: { content: draft.accepted_revision, hashtags: [] },
        rendered_content: draft.accepted_revision,
        schema_version: AI_ORIGINAL_SCHEMA_VERSION,
      })
    }

    // ADR 0022 §2.1 step 6 — UNCHANGED (L-3). critiqueBrief and
    // approveBriefIfQualified's HARD gate then run exactly as they do for
    // every other campaign; per §2.6 their outcome does not block this
    // post's own approval path.
    const brief = await assembleBrief(campaign.id)

    return { outcome: 'promoted', campaignId: campaign.id, briefId: brief.id, postId: post.id }
  } catch (e) {
    Sentry.captureException(e, { tags: { module: 'lib/campaigns/promote' } })
    return { outcome: 'error' }
  }
}
