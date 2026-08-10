// ADR 0021 §3 (Session 28 E5.6) — the worker that ties Stage C together:
// reclaim stale claims → per-business shortlist → age gate → deadline check
// → reserve → claim → run the loop → reconcile → terminal transition. Copies
// lib/learning/orchestrator.ts's shape (lazy service-role import inside the
// tick, Sentry.withMonitor wrap, one canonical tick log line) and
// app/api/cron/capture-learning/route.ts's route shape (QStash verification,
// always-200 posture — the orchestrator owns its own claim/retry state
// machine, same posture as publish/learning).
//
// Stage D (card.ts's generateCard) runs HERE, on a 'card' verdict — single-
// shot, Tier 1, OUTSIDE runToolLoop (L-5/D-3), consuming the CardCitableContext
// captured from this call's own buildTriageTools (§4.6). generateCard owns the
// terminal 'carded' transition itself, atomically with its own insert (A-4′/
// A-5) — this file never calls setCandidateTriageOutcome for a card verdict.
// A 'skipped' outcome (citations rejected, validation failed, tenant mismatch,
// or the claim was lost — card.ts's GenerateCardResult) is NOT a card: the
// candidate is left at 'triaging' and self-heals to 'new' via the stale-claim
// reclaim sweep below, the same fail-closed shape as a bound breach (§2.5).

import * as Sentry from '@sentry/nextjs'
import { formatISO, subDays } from 'date-fns'
import { listNewCandidates, claimCandidateForTriage, reclaimStaleTriagingCandidates, setCandidateTriageOutcome, ageGateCandidate } from '@/lib/db/signal-candidates'
import { listActiveConnectionBusinessIds } from '@/lib/db/github-connections'
import { reserveTriageBudget, reconcileTriageBudget } from '@/lib/db/signal-triage-budget'
import { buildCustomerContext } from '@/lib/ai/context'
import { runToolLoop, TRIAGE_MAX_WALL_CLOCK_MS } from '@/lib/ai/tool-runner'
import { wrapSignalForPrompt } from '@/lib/ai/wrap-evidence'
import { buildTriageTools } from './tools'
import { generateCard } from './card'
import { createCardCitableContext } from './verify'
import type { SignalCandidateWithSignal } from '@/lib/db/types'
import type { SupabaseClient } from '@supabase/supabase-js'

// §3.1 — the shortlist bound. Never the full 50-row listNewCandidates bound
// — judgment is deliberately narrower than the poller's own scoring pass.
export const TRIAGE_SHORTLIST_PER_TICK = 5
// §2.10 — matches ADR 0020 §6.1's recency term, which already reaches zero
// at exactly this many days (floor(40 × max(0, 1 − ageDays / 14))).
export const CARD_TTL_DAYS = 14
// §2.9 — a crashed tick's claim self-heals after this long.
export const TRIAGE_CLAIM_STALE_MINUTES = 30
// §3.3 — worst-case reservation per call (§2.6's 22¢ figure).
export const TRIAGE_RESERVATION_CENTS = 22
// §3.1.1 (E-2) — the worker's own deadline, matching the route's
// maxDuration. The check before each claim is the actual guarantee; this
// number alone is not (§3.1.1's own point).
export const TICK_MAX_DURATION_MS = 300_000

export interface TriageTickSummary {
  tick: string
  triggeredBy: 'qstash' | 'secret'
  durationMs: number
  businessesConsidered: number
  staleReclaimed: number
  triaged: number
  carded: number
  cardSkipped: number
  noCard: number
  ageGated: number
  triageFailed: number
  cappedBusinesses: number
  deadlineDeferred: number
}

function buildTriageSystemPrompt(): string {
  return [
    "You are triaging a software product's GitHub release to decide whether it is worth surfacing to the product's marketing team as a content opportunity.",
    'You have four read-only tools available — list_evidence, list_audience_notes, list_brand_claims, list_recent_campaigns — to check supporting context before deciding. Use any that would change your judgment; you are not required to call all four, or any of them.',
    'Decide "card" only if the release is genuinely noteworthy for this audience: a new capability, integration, or meaningfully improved workflow. Decide "no_card" for patch releases, internal refactors, security-only fixes with no external audience relevance, or anything you cannot substantiate.',
    'Respond with EXACTLY this JSON object and nothing else — no markdown fence, no commentary:',
    '{"verdict": "card" | "no_card", "reason": string, "citableEvidenceIds": string[], "citableBrandIds": string[], "audienceNote": string}',
  ].join('\n\n')
}

function buildTriageUserMessage(candidate: SignalCandidateWithSignal): string {
  const rendered = wrapSignalForPrompt({ title: candidate.signals.title, body: candidate.signals.body })
  return `A GitHub release was published on a repository this business watches. Decide whether it is worth surfacing.\n\n${rendered}`
}

async function triageOneCandidate(
  client: SupabaseClient,
  businessId: string,
  candidate: SignalCandidateWithSignal,
  claimedAtIso: string,
  summary: TriageTickSummary,
): Promise<void> {
  try {
    const context = await buildCustomerContext(businessId)
    const citable = createCardCitableContext()
    const tools = buildTriageTools(client, businessId, citable)
    const result = await runToolLoop({
      context,
      systemPrompt: buildTriageSystemPrompt(),
      userMessage: buildTriageUserMessage(candidate),
      tools,
    })

    // §3.3 — reconcile on EVERY outcome, including failure (a failed loop
    // still burns tokens before it fails closed).
    await reconcileTriageBudget(businessId, TRIAGE_RESERVATION_CENTS, result.costCents)

    if (result.outcome === 'decision') {
      summary.triaged++
      if (result.decision.verdict === 'card') {
        // Stage D — see this file's header comment. generateCard owns the
        // terminal 'carded' transition; a 'skipped' outcome leaves the
        // candidate at 'triaging' for the stale reclaim sweep to self-heal.
        const cardResult = await generateCard({
          client,
          context,
          candidate,
          claimedAtIso,
          decision: result.decision,
          citable,
        })
        if (cardResult.outcome === 'inserted') {
          summary.carded++
        } else {
          summary.cardSkipped++
        }
      } else {
        const wrote = await setCandidateTriageOutcome(client, candidate.id, claimedAtIso, 'no_card')
        if (wrote) summary.noCard++
      }
      return
    }

    // §2.5 — any loop failure: candidate -> triage_failed, counter,
    // candidate ID to Sentry, NEVER the body.
    const wrote = await setCandidateTriageOutcome(client, candidate.id, claimedAtIso, 'triage_failed')
    if (wrote) summary.triageFailed++
    Sentry.captureException(new Error(`signal triage failed: ${result.reason}`), {
      tags: { business_id: businessId, candidate_id: candidate.id, reason: result.reason },
    })
  } catch (err) {
    // A failure BEFORE runToolLoop returned (context build, tool
    // construction) or in the post-loop bookkeeping — the reservation was
    // taken but nothing was spent, so give it back before recording the
    // candidate as failed. Best-effort: this path must not itself throw and
    // abort the tick.
    await reconcileTriageBudget(businessId, TRIAGE_RESERVATION_CENTS, 0).catch(() => undefined)
    const wrote = await setCandidateTriageOutcome(client, candidate.id, claimedAtIso, 'triage_failed').catch(() => null)
    if (wrote) summary.triageFailed++
    // §2.5 — candidate ID only, never the body.
    Sentry.captureException(err, { tags: { business_id: businessId, candidate_id: candidate.id, phase: 'signals-triage' } })
  }
}

export async function runSignalsTriageTick(opts: { triggeredBy: 'qstash' | 'secret' }): Promise<TriageTickSummary> {
  const startedAt = Date.now()
  const now = new Date()
  const summary: TriageTickSummary = {
    tick: formatISO(now),
    triggeredBy: opts.triggeredBy,
    durationMs: 0,
    businessesConsidered: 0,
    staleReclaimed: 0,
    triaged: 0,
    carded: 0,
    cardSkipped: 0,
    noCard: 0,
    ageGated: 0,
    triageFailed: 0,
    cappedBusinesses: 0,
    deadlineDeferred: 0,
  }

  try {
    await Sentry.withMonitor(
      'signals-triage',
      async () => {
        const { createServiceRoleClient } = await import('@/lib/supabase/service')
        const { config } = await import('@/lib/config')
        const client = createServiceRoleClient()

        const staleBefore = formatISO(new Date(Date.now() - TRIAGE_CLAIM_STALE_MINUTES * 60 * 1000))
        summary.staleReclaimed = await reclaimStaleTriagingCandidates(client, staleBefore)

        const businessIds = await listActiveConnectionBusinessIds(client)
        summary.businessesConsidered = businessIds.length

        const ageCutoffMs = subDays(now, CARD_TTL_DAYS).getTime()
        let deadlineHit = false

        for (const businessId of businessIds) {
          const candidates = await listNewCandidates(client, businessId, TRIAGE_SHORTLIST_PER_TICK)
          let businessCapped = false

          for (const candidate of candidates) {
            // §2.10 — the age gate is cheap (no claim, no LLM) and always
            // runs regardless of the tick deadline below, which exists to
            // guard the EXPENSIVE claim+loop path.
            if (new Date(candidate.occurred_at).getTime() < ageCutoffMs) {
              const aged = await ageGateCandidate(client, candidate.id)
              if (aged) summary.ageGated++
              continue
            }

            // §3.1.1 (E-2) — re-checked before EVERY claim, not computed
            // once. Once tripped, every remaining candidate this tick
            // (across every remaining business) is deferred.
            if (deadlineHit || TICK_MAX_DURATION_MS - (Date.now() - startedAt) < TRIAGE_MAX_WALL_CLOCK_MS) {
              deadlineHit = true
              summary.deadlineDeferred++
              continue
            }

            if (businessCapped) continue

            // §3.3 — reserve BEFORE claiming. On cap, the candidate stays
            // 'new' — it was never touched.
            const reserved = await reserveTriageBudget(businessId, TRIAGE_RESERVATION_CENTS, config.server.TRIAGE_DAILY_CAP_CENTS)
            if (!reserved) {
              businessCapped = true
              summary.cappedBusinesses++
              continue
            }

            const claimedAtIso = formatISO(new Date())
            const claimed = await claimCandidateForTriage(client, candidate.id, claimedAtIso)
            if (!claimed) {
              // Lost the claim race to a concurrent tick — give the
              // reservation back; nothing was spent.
              await reconcileTriageBudget(businessId, TRIAGE_RESERVATION_CENTS, 0)
              continue
            }

            // `candidate` (not `claimed`) carries the joined signals(title,
            // body) data listNewCandidates fetched — claimCandidateForTriage's
            // return is a plain SignalCandidateRow with no join, since it's a
            // bare .update().select(), not a re-join.
            await triageOneCandidate(client, businessId, candidate, claimedAtIso, summary)
          }
        }
      },
      {
        schedule: { type: 'crontab', value: '0 6 * * *' },
        checkinMargin: 10,
        maxRuntime: 295,
        failureIssueThreshold: 2,
        recoveryThreshold: 1,
      },
    )
  } catch (err) {
    Sentry.captureException(err, { tags: { cron: 'signals-triage' } })
  }

  summary.durationMs = Date.now() - startedAt

  // EXACTLY ONE structured-JSON console.log per invocation
  // (lib/learning/orchestrator.ts's pattern). Every skip reason gets its
  // own field, per Session 27's MINOR-5 lesson — a counter that can
  // silently be zero without a field is a false-green shape.
  console.log(JSON.stringify({ kind: 'signals-triage.tick', ...summary }))

  return summary
}
