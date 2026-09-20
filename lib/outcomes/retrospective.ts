import { addDays, formatISO, parseISO } from 'date-fns'
import {
  getFrozenBriefContentForWorker,
  insertCampaignRetrospective,
  listCampaignPostStatesForWorker,
  listCampaignsAwaitingRetrospective,
  listOutcomesForCampaign,
  wilsonBounds,
  type CampaignOutcomeForVerdict,
  type CampaignPostState,
} from '@/lib/db/campaign-retrospectives'
import type { RetrospectiveVerdict } from '@/lib/db/types'
import { OUTCOME_RETRO_MIN_N } from './constants'
import { HypothesisSchema, SuccessCriteriaSchema, type SuccessCriteria } from './hypothesis'
import { median } from './normalise'

// ADR 0026 §8.2 (Session 33 J2.11) — the campaign retrospective. DETERMINISTIC: no model call. The verdict is
// arithmetic over the campaign's frozen outcomes; the Wilson interval comes from SQL (wilson_bounds, through its
// lib/db wrapper) and is DISPLAY-ONLY — nothing here gates on it. A completed retrospective writes NOTHING to
// memory: only a human acknowledgement does (acknowledge_campaign_retrospective, L-6).

// The exact "not yet published" statuses (J2.0 premise 12): every other status is terminal for the campaign.
const NOT_YET_PUBLISHED = new Set(['draft', 'approved', 'scheduled'])
const MIN_EVALUATION_WINDOW_DAYS = 7
// A tolerance for wins / n against a decimal target (0.6 is not exactly representable): the boundary is INCLUSIVE.
const BOUNDARY_EPSILON = 1e-9

export interface ResolvedHypothesis {
  hypothesis: string
  criteria: SuccessCriteria
  source: 'brief' | 'implicit'
}

// A pre-amendment brief (or one whose fields no longer validate) is judged against the implicit hypothesis:
// "this campaign's posts beat the brand's usual engagement", win_rate 0.5, window 7 — and it is LABELLED implicit.
export const IMPLICIT_HYPOTHESIS: ResolvedHypothesis = {
  hypothesis: "This campaign's posts beat the brand's usual engagement.",
  criteria: { metric: 'win_rate', target: 0.5, evaluationWindowDays: 7 },
  source: 'implicit',
}

export function resolveHypothesis(briefContent: Record<string, unknown> | null): ResolvedHypothesis {
  const hypothesis = HypothesisSchema.safeParse(briefContent?.hypothesis)
  const criteria = SuccessCriteriaSchema.safeParse(briefContent?.successCriteria)
  if (hypothesis.success && criteria.success) {
    return { hypothesis: hypothesis.data, criteria: criteria.data, source: 'brief' }
  }
  return IMPLICIT_HYPOTHESIS
}

// When the retrospective becomes due: last published_at + max(7, evaluationWindowDays). null when it can never
// be due yet — no published post, or any post still in a not-yet-published status.
export function retrospectiveDueAt(posts: readonly CampaignPostState[], criteria: SuccessCriteria): Date | null {
  if (posts.some((p) => NOT_YET_PUBLISHED.has(p.status))) return null
  const published = posts.filter((p) => p.status === 'published' && p.published_at !== null)
  if (published.length === 0) return null
  const last = Math.max(...published.map((p) => parseISO(p.published_at as string).getTime()))
  if (!Number.isFinite(last)) throw new Error('retrospective: non-finite published_at')
  return addDays(new Date(last), Math.max(MIN_EVALUATION_WINDOW_DAYS, criteria.evaluationWindowDays))
}

export function isDue(posts: readonly CampaignPostState[], criteria: SuccessCriteria, now: Date): boolean {
  const dueAt = retrospectiveDueAt(posts, criteria)
  return dueAt !== null && now.getTime() >= dueAt.getTime()
}

export interface VerdictResult {
  verdict: RetrospectiveVerdict
  n: number
  wins: number
  medianLogLift: number | null
  byRole: Record<string, { n: number; wins: number }>
}

// Over the campaign's matured outcomes WITH a baseline (beat_baseline not null). inconclusive below
// OUTCOME_RETRO_MIN_N (5). win_rate -> supported iff wins / n >= target. median_lift -> supported iff
// exp(median(log_lift)) >= target. by_role is per-role n and wins.
export function computeVerdict(
  criteria: SuccessCriteria,
  outcomes: readonly CampaignOutcomeForVerdict[],
  roleByPost: ReadonlyMap<string, string | null>,
): VerdictResult {
  const observed = outcomes.filter((o) => o.beat_baseline !== null)
  const n = observed.length
  const wins = observed.filter((o) => o.beat_baseline === true).length
  const lifts = observed.map((o) => o.log_lift).filter((v): v is number => v !== null && Number.isFinite(v))
  const medianLogLift = lifts.length > 0 ? median(lifts) : null

  const byRole: Record<string, { n: number; wins: number }> = {}
  for (const o of observed) {
    const role = roleByPost.get(o.post_id) ?? 'unassigned'
    const cell = (byRole[role] ??= { n: 0, wins: 0 })
    cell.n += 1
    if (o.beat_baseline === true) cell.wins += 1
  }

  if (n < OUTCOME_RETRO_MIN_N) return { verdict: 'inconclusive', n, wins, medianLogLift, byRole }

  let supported: boolean
  if (criteria.metric === 'win_rate') {
    supported = wins / n + BOUNDARY_EPSILON >= criteria.target
  } else {
    if (medianLogLift === null) return { verdict: 'inconclusive', n, wins, medianLogLift, byRole }
    supported = Math.exp(medianLogLift) + BOUNDARY_EPSILON >= criteria.target
  }
  return { verdict: supported ? 'supported' : 'not_supported', n, wins, medianLogLift, byRole }
}

export interface RetrospectivePhaseResult {
  completed: number
  errors: number
}

// The worker's phase (runOutcomeTick's slot). One campaign at a time; a failing campaign counts an error and
// never stops the rest. INSERT ... ON CONFLICT (campaign_id) DO NOTHING inside insertCampaignRetrospective: a
// campaign is evaluated ONCE, so a replayed tick — or a second tick — re-evaluates nothing.
export async function runRetrospectivePhase(businessId: string, now: Date): Promise<RetrospectivePhaseResult> {
  const result: RetrospectivePhaseResult = { completed: 0, errors: 0 }
  const campaigns = await listCampaignsAwaitingRetrospective(businessId)
  for (const campaign of campaigns) {
    try {
      const posts = await listCampaignPostStatesForWorker(businessId, campaign.id)
      const resolved = resolveHypothesis(await getFrozenBriefContentForWorker(businessId, campaign.id))
      if (!isDue(posts, resolved.criteria, now)) continue

      const outcomes = await listOutcomesForCampaign(businessId, campaign.id)
      const roles = new Map(posts.map((p) => [p.id, p.role]))
      const verdict = computeVerdict(resolved.criteria, outcomes, roles)
      const interval = verdict.n > 0 ? await wilsonBounds(verdict.wins, verdict.n) : null

      const written = await insertCampaignRetrospective({
        campaign_id: campaign.id,
        business_id: businessId,
        hypothesis_snapshot: resolved.hypothesis,
        hypothesis_source: resolved.source,
        criteria_snapshot: { ...resolved.criteria },
        verdict: verdict.verdict,
        n: verdict.n,
        wins: verdict.wins,
        interval_low: interval?.low ?? null,
        interval_high: interval?.high ?? null,
        median_log_lift: verdict.medianLogLift,
        by_role: verdict.byRole,
        completed_at: formatISO(now),
      })
      if (written) result.completed += 1
    } catch {
      result.errors += 1
    }
  }
  return result
}
