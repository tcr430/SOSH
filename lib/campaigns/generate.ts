import * as Sentry from '@sentry/nextjs'
import { formatISO } from 'date-fns'
import { buildCustomerContext, withPostQueryContext } from '@/lib/ai/context'
import type { MemoryQueryContext } from '@/lib/memory'
import { runPrompt } from '@/lib/ai/runner'
import { rubricPrompt, BRIEF_QUALITY_THRESHOLD } from '@/lib/ai/prompts/rubric'
import type { RubricOutput } from '@/lib/ai/prompts/rubric'
import { PLATFORM_CONSTRAINTS, getPlatformConstraintsVersion } from '@/lib/ai/prompts/post-generation'
import { generateNativeContent } from '@/lib/ai/generate-native'
import { neutralize } from '@/lib/ai/wrap-evidence'
import { MODELS } from '@/lib/ai/models'
import { AiError } from '@/lib/ai/errors'
import { config } from '@/lib/config'
import { getBusinessById } from '@/lib/db/businesses'
import { getBrandVoice } from '@/lib/db/brand-voices'
import { reserveGenerationPost, releaseGenerationPost } from '@/lib/db/generation-budget'
import { getCampaignById, activateCampaign } from '@/lib/db/campaigns'
import { getBriefByCampaign, markBriefGenerated } from '@/lib/db/campaign-briefs'
import { freezeBrief, type FrozenBrief } from '@/lib/campaigns/brief'
import { listPostsByCampaign, createPosts } from '@/lib/db/posts'
import { createPostAiOriginal, AI_ORIGINAL_SCHEMA_VERSION } from '@/lib/db/post-ai-originals'
import { updateGenerationSessionStatus } from '@/lib/db/post-generation-sessions'
import { incrementPostsGeneratedBy } from '@/lib/db/trial-state'
import { schedulePosts } from '@/lib/campaigns/schedule'
import { checkRoleCoverage, checkLinkPlacement, checkSetRedundancy } from '@/lib/campaigns/consistency'
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

// ADR 0024 §2.1 (Session 31, H2.7) — do not change without reopening the
// ruling. 6 provider calls/post (3 generations + 3 judge calls) at ≈10¢
// recorded is the founder-adjudicated point: N=5 would put A-1's Pro daily
// cap at 58% of revenue (§7.4); N=2 gives the judge a binary choice where
// one bad draw halves the expected lift. This also IS the concurrency bound
// (§2.2) — candidates for one post are fired together, never more.
const N_CANDIDATES = 3

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
  // ADR 0024 §2.9 (Session 31, H2.5) — RETAINED, always 0/null at initial
  // generation now that the judge REPLACES the openingStrength retry that
  // used to set these. Do NOT repurpose as a candidate counter — conflating
  // "the user asked for a regeneration" with "the pipeline generated N
  // candidates" would corrupt ADR 0018's learning signal, which keys on
  // generation_kind.
  regenerationCount: number
  previousContent: string | null
  // The WINNING candidate's full-rubric score (neutralize()d
  // joinContent(output), mode:'post'), argmax'd on `overall` over the N=3
  // fan-out (ADR 0024 §2.6/§2.7, H2.7) — or null in the UNSCORED outcome
  // (every judge call threw for this entry; the pipeline still proceeds,
  // unscored and ungated, §2.3).
  rubricScore: RubricOutput | null
  // How many of the N=3 candidates actually generated for this entry (ADR
  // §2.3's hard-fail/unscored/scored split needs this even when
  // rubricScore is null; persisted verbatim into post_ai_originals'
  // candidate_count, §8.2).
  candidateCount: number
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

    // A-9 (Session 29-D correction, MAJOR-5) — the guard counts GENERATED
    // posts (role IS NOT NULL), not all posts. A promoted campaign (ADR 0022
    // §2.1) always holds exactly one human-authored post with role === null
    // before generation ever runs (promote.ts's createPosts call never sets
    // role); counting it here made every promoted campaign return
    // 'already_generated' forever and activateCampaign below unreachable.
    // Origin-blind by construction: this discriminates on posts.role (set
    // only by this function, ADR 0017 §3.2, write-once), never on
    // campaigns.origin. existingPosts itself is kept as ALL posts (not just
    // generated ones) — §2.7's arithmetic below still needs that full count.
    const existingPosts = await listPostsByCampaign(client, campaignId)
    const generatedPosts = existingPosts.filter((p) => p.role !== null)
    if (generatedPosts.length > 0) {
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
    // ADR 0024 §5.1/§5.4 (Session 31, H2.11) — the campaign-level
    // MemoryQueryContext: {objective, audience, campaignId}. `audience`
    // needs one extra, cheap single-row read here — ctx (and its
    // brandVoice.target_audience) doesn't exist until buildCustomerContext
    // RETURNS, so it cannot supply its own queryContext's audience field.
    // getBrandVoice is the SAME base read retrieveVoice performs internally
    // (voice variations only override voice_axes, never target_audience),
    // so this is not a second, drifting copy of voice resolution.
    const brandVoiceForAudience = await getBrandVoice(client, businessId)
    const queryContext: MemoryQueryContext = {
      objective: campaign.objective,
      audience: brandVoiceForAudience?.target_audience ?? undefined,
      campaignId,
    }
    const ctx = await buildCustomerContext(businessId, campaign.voice_variation_id, queryContext)

    // STEP 4b — Business plan (ADR 0024 §7.4/§7.5a, H2.9). CustomerContext
    // does not carry `plan` (context.ts's business Pick omits it), and only
    // the Pro tier's fan-out reservation below needs it — a separate,
    // service-role read, same as checkCampaignCreationAllowed's pattern in
    // lib/campaigns/enforcement.ts.
    const business = await getBusinessById(client, businessId)

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

    // Session 31-D, D6 (MINOR-1). ADR §7.5a names two outcomes for a
    // reserved unit — hard fail releases, success keeps — but did not name
    // a third: a MID-CAMPAIGN reservation refusal, which left every EARLIER
    // entry's already-reserved unit stranded (the whole session fails with
    // postsCreated: 0, so those posts never exist, but their units stayed
    // consumed against the day's cap). Tracks how many units this SESSION
    // has successfully reserved so far, across platforms, so a refusal can
    // release all of them rather than none.
    let reservedUnitsSoFar = 0

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
          businessId,
          angle: entry.angle,
          role: entry.role,
          platform: entry.platform,
          narrative: frozenBrief.content.narrative,
          pinnedEvidenceIds,
          scheduledAt,
          estimatedTweetsWorth: estimateTweetsWorth(entry.angle),
        })

        const input = genInput()

        // ADR 0024 §5.2b (Session 31, H2.11) — per-post refinement: platform
        // and role are the strongest task discriminators WITHIN one
        // campaign, and are only known per-entry, not at STEP 4's
        // campaign-level call. Brand/evidence/audience/voice are NOT
        // re-read (they cannot vary within one campaign) — only the
        // performance slot is replaced, one extra lib/memory DB read.
        //
        // Session 31-D, D4 (MAJOR-4): spreads STEP 4's campaign-level
        // queryContext ({objective, audience, campaignId}) in ALONGSIDE
        // platform/role, rather than passing platform/role alone. Before
        // this fix, campaignId never reached retrievePerformancePatterns on
        // this path — computed once at STEP 4, then thrown away every time
        // withPostQueryContext replaced it with a platform/role-only query.
        const postCtx = await withPostQueryContext(ctx, { ...queryContext, platform: entry.platform, role: entry.role })

        // STEP 7a-pre — Pro daily post cap (ADR §7.4/§7.5/§7.5a, A-1,
        // QUAL-PRO-DAILY-POST-CAP). ONE reservation of ONE unit, BEFORE the
        // fan-out below — never per candidate, which would reopen the
        // check-then-call race N-fold inside a single generation (L-6's
        // named loser). Only Pro reserves: Plus is already bounded by its
        // 250-posts/month product cap and trial by AI_TRIAL_POST_CAP (STEP
        // 5 above) — a different guard, in a different place (§7.4 table).
        // A denied reservation uses its OWN error_code, distinct from the
        // trial cap's 'quota_exceeded' (STEP 5) — the two cases need
        // different copy, and reusing one code would show a Pro customer
        // the trial-limit string.
        let reservedGenerationBudget = false
        if (business.plan === 'pro') {
          const reservation = await reserveGenerationPost(businessId, config.server.AI_PRO_DAILY_POST_CAP)
          if (reservation === null) {
            // Session 31-D, D6 (MINOR-1) — release every unit reserved by
            // THIS session's earlier entries before failing. Without this,
            // a 12-entry campaign that fails on entry 6 leaves entries 1-5's
            // units consumed against the day's cap for zero posts created.
            for (let released = 0; released < reservedUnitsSoFar; released++) {
              await releaseGenerationPost(businessId)
            }
            await updateGenerationSessionStatus(client, sessionId, {
              status: 'failed',
              error_code: 'daily_quota_exceeded',
              completed_at: formatISO(new Date()),
            })
            return { sessionId, postsCreated: 0 }
          }
          reservedGenerationBudget = true
          reservedUnitsSoFar++
        }

        // STEP 7a — N=3 candidates, PARALLEL within this post (ADR 0024
        // §2.1/§2.2). Posts stay SEQUENTIAL: this whole block is awaited
        // before the entry loop's next iteration starts, so the fan-out
        // width (N) IS the concurrency bound — no separate limiter needed,
        // and the STEP-2 rate-limit overshoot this can cause is capped at
        // N-1 (§2.2, QUAL-RATE-LIMIT-COUNTS-CALLS).
        const candidateResults = await Promise.allSettled(
          Array.from({ length: N_CANDIDATES }, () => generateNativeContent(client, postCtx, input)),
        )

        const succeeded: Array<{ index: number; output: SinglePostOutput | ThreadOutput }> = []
        candidateResults.forEach((result, index) => {
          if (result.status === 'fulfilled') succeeded.push({ index, output: result.value })
        })

        // HARD FAIL (ADR §2.3) — 0 of N candidates generated. Unchanged
        // from the pre-fan-out path: the whole session fails. Uses the
        // LAST attempt's error (array position N-1) — deterministic, and
        // matches "error_code from the last AiError" (§2.3) without
        // depending on unguaranteed settle-order.
        if (succeeded.length === 0) {
          // ADR §7.5a — a hard-failed generation releases its reserved
          // unit; a generation that succeeds keeps it regardless of
          // candidate count, so this is the ONLY release path.
          if (reservedGenerationBudget) {
            await releaseGenerationPost(businessId)
          }
          const lastResult = candidateResults[candidateResults.length - 1]
          const lastError = lastResult.status === 'rejected' ? lastResult.reason : undefined
          const errorCode = lastError instanceof AiError ? lastError.code : 'generic'
          await updateGenerationSessionStatus(client, sessionId, {
            status: 'failed',
            error_code: errorCode,
            completed_at: formatISO(new Date()),
          })
          return { sessionId, postsCreated: 0 }
        }

        // STEP 7b — judge every SUCCEEDED candidate, also in parallel (ADR
        // §2.6, §2.9 — the judge REPLACES the retired openingStrength
        // retry, MODE2-HOOK-STANDALONE). Full-rubric score of the WHOLE
        // candidate via joinContent, never a single sentence — nine of the
        // ten dimensions are undefined over one sentence. Each candidate is
        // neutralize()'d first: it is the model's own prior output fed back
        // into a second AI call, the same reused-AI-generated-text shape as
        // brief.ts's narrative/proofPlan (B2.5 security-reviewer pass) —
        // neutralize() (wrap-evidence.ts, NFKC + Cf-strip + fence/brace/
        // [/DATA]-closer defusal) is the stated L-9 posture for that shape.
        const judgeResults = await Promise.allSettled(
          succeeded.map(({ output }) =>
            runPrompt(rubricPrompt, postCtx, {
              mode: 'post' as const,
              contentLabel: `${entry.platform} post`,
              content: neutralize(joinContent(output)),
              platform: entry.platform,
            }),
          ),
        )

        const scored: Array<{ index: number; output: SinglePostOutput | ThreadOutput; score: RubricOutput }> = []
        judgeResults.forEach((result, i) => {
          if (result.status === 'fulfilled') {
            scored.push({ index: succeeded[i].index, output: succeeded[i].output, score: result.value })
          }
        })

        let winningOutput: SinglePostOutput | ThreadOutput
        let winningScore: RubricOutput | null

        if (scored.length === 0) {
          // UNSCORED (ADR §2.3) — at least 1 candidate generated, but
          // EVERY judge call threw. Proceed with the lowest-index
          // SUCCEEDED candidate, unscored and ungated — the backward-
          // compatible extension of the pre-H2.7 swallow-and-continue. ONE
          // structured log line for the outcome, not one per failed judge
          // call.
          console.log(JSON.stringify({
            kind: 'campaign.generate.judge_scoring_failed',
            level: 'warn',
            campaign_id: campaignId,
            platform: entry.platform,
            candidate_count: succeeded.length,
          }))
          const lowest = succeeded.reduce((min, c) => (c.index < min.index ? c : min))
          winningOutput = lowest.output
          winningScore = null
        } else {
          // SCORED — argmax on `overall` over the scored subset; unscored
          // candidates are never eligible to win. Deterministic tie-break:
          // the lowest candidate index (ADR §2.7) — no hidden preference,
          // no randomness.
          const winner = scored.reduce((best, c) => {
            if (c.score.overall > best.score.overall) return c
            if (c.score.overall === best.score.overall && c.index < best.index) return c
            return best
          })
          winningOutput = winner.output
          winningScore = winner.score

          // ADR 0024 §13 (H2.13) — interim instrumentation, LOGGED not
          // GATED, not a constraint. The judge self-discrimination margin:
          // winner's overall minus the SCORED subset's median. This proves
          // the judge discriminates (a measurable margin) — it does NOT
          // prove that discrimination tracks real quality (ADR 0015
          // Amendment B's MEASURED-NEVER-COVERED posture; no eval corpus
          // exists yet to check that, Session 32).
          const sortedOveralls = scored.map(c => c.score.overall).sort((a, b) => a - b)
          const mid = Math.floor(sortedOveralls.length / 2)
          const median = sortedOveralls.length % 2 === 0
            ? (sortedOveralls[mid - 1] + sortedOveralls[mid]) / 2
            : sortedOveralls[mid]
          console.log(JSON.stringify({
            kind: 'campaign.generate.judge_discrimination_margin',
            level: 'info',
            campaign_id: campaignId,
            platform: entry.platform,
            candidate_count: scored.length,
            winner_overall: winner.score.overall,
            median_overall: median,
            margin: winner.score.overall - median,
            note: 'proves the judge discriminates candidates; does NOT prove discrimination tracks real post quality',
          }))
        }

        // ADR §2.8 — ALL N below BRIEF_QUALITY_THRESHOLD is not a failure:
        // the best of the set is surfaced, flagged. No regeneration (§2.8's
        // named loser: unbounded by construction), no Opus escalation.
        // §8.1 — losing candidate CONTENT is discarded here: only
        // winningOutput/winningScore ever reach `generated`.
        generated.push({
          order: entry.order,
          role: entry.role,
          platform: entry.platform,
          scheduledAt,
          output: winningOutput,
          regenerationCount: 0,
          previousContent: null,
          rubricScore: winningScore,
          candidateCount: succeeded.length,
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

    // ADR 0027 §5.8 half (b), MODE2-REDUNDANCY-UNDEFER — a deterministic, zero-LLM structural check over the
    // GENERATED set. FLAGGED, NEVER BLOCKED, NEVER EDITED: this neither fails the session nor touches a post,
    // unlike the two checks above. Structural, not semantic — see checkSetRedundancy for the recorded residual.
    // Inputs are the campaign-level pinned evidence ids (every post gets the same set today) and a null
    // proofType (the DB derives proof_type AFTER insert, from that same campaign-level evidence).
    const pinnedEvidenceIdsForSet = frozenBrief.content.pinnedEvidence.map((e) => e.evidenceMemoryId)
    const redundancy = checkSetRedundancy(
      generated.map((g) => ({
        order: g.order,
        role: g.role,
        proofType: null,
        citedEvidenceIds: pinnedEvidenceIdsForSet,
        text: joinContent(g.output),
      })),
    )
    if (!redundancy.ok) {
      console.log(JSON.stringify({
        kind: 'campaign.generate.redundancy_flagged',
        level: 'warn',
        campaign_id: campaignId,
        flags: redundancy.flags,
      }))
    }

    // STEP 8 — Build insert rows, role assigned from the brief (write-once,
    // DB-trigger-enforced from B2.0 — never mutated after this insert).
    //
    // ADR 0018 §2.6 — each post's id is generated HERE, client-side, and
    // passed explicitly into the insert row (PostInsert.id is optional,
    // posts.id defaults to gen_random_uuid() but accepts a caller-supplied
    // value). This is deliberate: createPosts's multi-row INSERT ... VALUES
    // ... RETURNING is not formally guaranteed by Postgres/PostgREST to
    // return rows in the same order the VALUES were supplied, so relying on
    // positional zip between `generated` and `inserted` to know which
    // post_ai_originals row belongs to which post would be a silent
    // correctness risk. Knowing the id up front removes that dependency
    // entirely — the snapshot write below never reads `inserted`.
    const generatedAt = formatISO(new Date())
    const generatedWithIds = generated.map((g) => ({
      g,
      id: crypto.randomUUID(),
      renderedContent: joinContent(g.output),
    }))
    const allInserts: PostInsert[] = generatedWithIds.map(({ g, id, renderedContent }) => {
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
        // Session 31-D, D15 (NIT-1). `g.previousContent` is hard-coded `null`
        // at this file's own construction (:485) — the ternary this replaced
        // was dead residue from the retired openingStrength hook retry (ADR
        // 0024 §2.9), which was the only path that ever set it non-null, and
        // whose stale rejectionNote string ("weak opener...") no longer
        // describes anything the judge-based pipeline does. `previousVersions`
        // itself stays a real, reusable array — actions.ts's regenerate flow
        // appends its own, user-supplied rejectionNote to it.
        previousVersions: [],
        generatedAt,
      }
      return {
        id,
        campaign_id: campaignId,
        business_id: businessId,
        platform: g.platform,
        content: renderedContent,
        role: g.role,
        scheduled_at: g.scheduledAt,
        status: 'draft',
        ai_generation_metadata: metadata,
      }
    })

    // STEP 9 — Single batch insert (P-1)
    const inserted = await createPosts(client, allInserts)
    const postsCreated = inserted.length

    // ADR 0018 §2.3/§2.6 — write ONE post_ai_originals row per created post,
    // from the structured GeneratedItem.output. This is the ground truth of
    // the whole learning-capture track: a silent failure here loses it
    // permanently and invisibly, so this call is deliberately NOT wrapped in
    // a swallowing try/catch — a thrown error here propagates to this
    // function's outer catch, which marks the session failed. Loud failure
    // is the correct behaviour, not a regression.
    //
    // Uses generatedWithIds directly (the pre-known client-generated id and
    // the already-computed renderedContent), never `inserted` — see the
    // comment at generatedWithIds's definition for why.
    //
    // typescript-reviewer (C2.4 pass, MEDIUM): each write is independent
    // (distinct post_id, fixed revision:1, no shared mutable state) so these
    // run concurrently rather than serialized one-by-one — Promise.all still
    // propagates the first rejection to the outer catch, preserving the
    // "loud failure, never swallowed" property this loop exists for.
    await Promise.all(
      generatedWithIds.map(({ g, id, renderedContent }) =>
        createPostAiOriginal(client, {
          business_id: businessId,
          post_id: id,
          campaign_id: campaignId,
          revision: 1,
          generation_kind: 'initial',
          format: g.output.format,
          payload: g.output,
          rendered_content: renderedContent,
          schema_version: AI_ORIGINAL_SCHEMA_VERSION,
          // ADR 0024 §8.2 (H2.7) — the WINNER's score, persisted alongside
          // the payload it belongs to. null/null/false when the entry was
          // UNSCORED (§2.3) — an absent badge must not read as a passing
          // one (§8.3), so cleared_quality_threshold is null, not a
          // defaulted false, whenever rubricScore itself is null.
          overall_score: g.rubricScore?.overall ?? null,
          dimension_scores: g.rubricScore?.dimensions ?? null,
          candidate_count: g.candidateCount,
          cleared_quality_threshold:
            g.rubricScore !== null ? g.rubricScore.overall >= BRIEF_QUALITY_THRESHOLD : null,
        }),
      ),
    )

    // STEP 10 — Update campaign atomically (guard on 'awaiting_brief' prevents double-write)
    // ADR 0022 §2.7 — a promoted campaign already carries one post (inserted
    // by promoteDraftToCampaign, before this function ever runs) that this
    // batch does not include, so `planned` must be THIS batch's count PLUS
    // whatever was already attached. existingPosts was read at this
    // function's own idempotency guard above (:106) — for every
    // non-promoted campaign it is 0, so this is byte-identical to today.
    const activated = await activateCampaign(client, campaignId, postsCreated + existingPosts.length)
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
    // silent-failure-hunter (C2.4 pass, MAJOR): this catch previously bound
    // `err` and never read it — no log, no Sentry capture. That made a
    // post_ai_originals write failure (ADR 0018's ground truth) operationally
    // indistinguishable from any other failure in this function, which is
    // exactly the invisibility this step exists to prevent.
    const message = err instanceof Error ? err.message : String(err)
    console.log(JSON.stringify({
      kind: 'campaign.generate.failed',
      level: 'error',
      campaign_id: campaignId,
      session_id: sessionId,
      error: message,
    }))
    Sentry.captureException(err, {
      tags: { session_id: sessionId, campaign_id: campaignId },
    })
    await updateGenerationSessionStatus(client, sessionId, {
      status: 'failed',
      error_code: 'generic',
      completed_at: formatISO(new Date()),
    })
    return { sessionId, postsCreated: 0 }
  }
}
