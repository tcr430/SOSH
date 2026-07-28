// ADR 0018 §9 — the worker that ties the capture pipeline together: claim →
// snapshot lookup → classify (Tier 0) → aggregate into performance_memory
// (Tier 0 promotion) → per-business summarize (Tier 1). Copies
// runEmailDrainTick (lib/email/orchestrator.ts:32) in shape: lazy
// service-role import, Sentry.withMonitor, atomic claim + status re-guard,
// one canonical tick log line. Deliberately NOT copying runJanitorTick
// (lib/publishing/orchestrator.ts:317), which has no withMonitor wrap
// (§9.1's named deviation) — this tick IS wrapped.

import * as Sentry from '@sentry/nextjs'
import { addSeconds, formatISO } from 'date-fns'
import { AiError, type AiErrorCode } from '@/lib/ai/errors'
import { config } from '@/lib/config'
import { claimPostEditSignals, transitionPostEditSignal } from '@/lib/db/post-edit-signals'
import { getPostAiOriginalById, AI_ORIGINAL_SCHEMA_VERSION } from '@/lib/db/post-ai-originals'
import { getPostById } from '@/lib/db/posts'
import { getBriefByCampaign } from '@/lib/db/campaign-briefs'
import { getEvidenceMemoryByIds } from '@/lib/db/memory-evidence'
import { retrieveVoice } from '@/lib/memory/voice'
import { classify } from '@/lib/learning/classify'
import type { ClassifyResult, PreferenceSignal, PreferenceKind } from '@/lib/learning/classify'
import { computePatternKey, computeContradictingPatternKey } from '@/lib/learning/pattern-key'
import { recomputeAndUpsertPattern } from '@/lib/learning/promote'
import { summarizeBusinessLearning } from '@/lib/learning/summarize'
import type { PostEditSignalRow, PostEditSignalClass, PostAiOriginalRow } from '@/lib/db/types'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface LearningTickSummary {
  tick: string
  triggeredBy: 'qstash' | 'secret'
  durationMs: number
  claimed: number
  classified: number
  signalsEmitted: number
  skippedNoSnapshot: number
  patternsUpserted: number
  promoted: number
  demoted: number
  summarized: number
  summarizeFailed: number
  // [Session 25-D correction, MINOR-4] The AiErrorCode of the MOST RECENT
  // summarize failure this tick ("last one wins", the same convention
  // post_edit_signals.last_error already uses). Lets an operator watching
  // summarizeFailed spike distinguish a transient Anthropic-side failure
  // (provider_error/rate_limit/timeout) from a prompt/schema regression
  // (invalid_response) from a DB write failure in the upsert loop
  // ('unknown' — not an AiError at all), without leaving the log line to
  // cross-reference Sentry. NOTE (silent-failure-hunter, D4 re-invocation):
  // if two different businesses fail with two different codes in the SAME
  // tick, only the last one is visible here — `summarizeFailed`'s COUNT is
  // unaffected (it increments once per failing business regardless of
  // code), but disambiguating which of several distinct codes occurred
  // still requires Sentry. Accepted, consistent with `abandoned` already
  // collapsing "permanent" vs "transient_exhausted" the same way.
  summarizeFailedCode: AiErrorCode | 'unknown' | null
  // [Session 25-D correction, NIT-4] Renamed from `failed`: this counter
  // means "sent back to pending with a backoff, will retry" — not
  // "failed" in the terminal sense `abandoned`/`promoted`/`demoted` carry.
  // `failed` sitting beside those in the same object read as though every
  // ordinary transient retry were an operator-actionable failure; an alert
  // on `failed > 0` would page on ordinary backoff traffic.
  retrying: number
  abandoned: number
  raceLost: number
}

// ADR 0018 §9.4 — copying isPermanentError/computeBackoff
// (lib/deletion/orchestrator.ts:20-27, :29-34). Postgres 23xxx constraint
// classes are permanent; everything else (network, 40001 serialization
// failures, etc.) is treated as transient, matching the deletion
// orchestrator's own default-to-transient posture for unrecognised codes.
function isPermanentError(e: unknown): boolean {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const code = String((e as { code: unknown }).code)
    if (code.startsWith('23')) return true
  }
  return false
}

export function computeBackoff(attempts: number): number {
  const base = config.server.LEARNING_RETRY_BACKOFF_SECONDS
  const exp = base * Math.pow(2, attempts - 1)
  const jitter = exp * (0.75 + Math.random() * 0.5)
  return Math.min(Math.round(jitter), 3600)
}

// Tier-0 templated pattern statements (§6.1: "arithmetic, not generation").
// Every PreferenceKind maps to dimension='format' — none of the eleven kinds
// represent an opening "hook" rewrite, so 'hook' is left for a future signal
// kind rather than guessed at here.
const KIND_LABEL: Record<PreferenceKind, string> = {
  avoid_word_removed: 'Human editors remove flagged avoid-list words',
  length_delta: 'Human editors adjust the length of AI-generated posts',
  hashtag_delta: 'Human editors adjust hashtags on AI-generated posts',
  cta_added: 'Human editors add a call-to-action to AI-generated posts',
  cta_removed: 'Human editors remove the call-to-action from AI-generated posts',
  thread_shortened: 'Human editors shorten AI-generated threads',
  thread_lengthened: 'Human editors lengthen AI-generated threads',
  link_moved: 'Human editors move the link within AI-generated posts',
  numbering_stripped: 'Human editors strip numbering markers from AI-generated threads',
}

function renderPatternStatement(signal: PreferenceSignal): string {
  return `${KIND_LABEL[signal.kind]} on ${signal.platform}.`
}

function getThreadPostCount(aiOriginal: PostAiOriginalRow): number | null {
  if (aiOriginal.format !== 'thread') return null
  const posts = (aiOriginal.payload as { posts?: unknown }).posts
  return Array.isArray(posts) ? posts.length : null
}

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 1000)
}

// One row → one canonical signal for the DB's scalar class/pattern_key
// columns (a genuine gap ADR 0018 leaves unresolved for multi-signal diffs
// — confirmed with the founder during C2.8 planning). `class` MUST be
// 'preference' whenever `pattern_key` is set: LEARN-VOICE-WRITE-TRIGGER
// (20260726020000_performance_memory_pattern_key.sql) joins a distilled
// performance_memory write back to its contributing post_edit_signals rows
// by (business_id, pattern_key) and REJECTS the write if any contributing
// row's class isn't 'preference' — so a preference-driven pattern_key on a
// row whose class read 'correction' (e.g. because a correction ALSO fired
// in the same diff) would be silently blocked by the DB trigger. The full
// ClassifyResult is still persisted verbatim into `signals` jsonb for audit;
// only the row's own scalar columns collapse to one canonical value.
function canonicalize(result: ClassifyResult): {
  rowClass: PostEditSignalClass | null
  rowPatternKey: string | null
  primaryPreference: PreferenceSignal | null
} {
  if (result.preferences.length > 0) {
    const primary = result.preferences[0]
    return { rowClass: 'preference', rowPatternKey: computePatternKey(primary), primaryPreference: primary }
  }
  if (result.corrections.length > 0) {
    return { rowClass: 'correction', rowPatternKey: null, primaryPreference: null }
  }
  if (result.inconclusive.length > 0) {
    return { rowClass: 'inconclusive', rowPatternKey: null, primaryPreference: null }
  }
  return { rowClass: null, rowPatternKey: null, primaryPreference: null }
}

// [silent-failure-hunter, C2.8 review BLOCKER-2] transitionPostEditSignal
// returns null (not an error) when its guarded UPDATE matched zero rows —
// the row moved to a different status between the caller's read and write
// (a concurrent tick, a manual operator fix, etc.). Every call site MUST
// treat that as its own terminal outcome — counted and Sentry-reported —
// rather than silently falling through as if the write succeeded, which
// would let the tick's own counters diverge from the row's real DB state
// with nothing in the log to show it.
async function guardedTransition(
  client: SupabaseClient,
  row: PostEditSignalRow,
  next: Parameters<typeof transitionPostEditSignal>[2],
  summary: LearningTickSummary,
): Promise<boolean> {
  const result = await transitionPostEditSignal(client, row.id, next)
  if (result === null) {
    summary.raceLost++
    Sentry.captureException(new Error('post_edit_signals transition lost a concurrent race'), {
      extra: { row_id: row.id, business_id: row.business_id, attempted_status: next.status },
    })
    return false
  }
  return true
}

// [Session 25-D correction, MINOR-3] Returns guardedTransition's boolean so
// every caller can branch on it before bumping its own terminal counter. A
// lost race already increments raceLost (inside guardedTransition) and
// returns false — the row was NOT actually abandoned by this call, so
// unconditionally incrementing abandoned/skippedNoSnapshot afterward would
// double-count the same lost race as two distinct outcomes and claim an
// abandonment that never happened.
async function abandonRow(
  client: SupabaseClient,
  row: PostEditSignalRow,
  lastError: string,
  summary: LearningTickSummary,
): Promise<boolean> {
  return guardedTransition(client, row, {
    status: 'abandoned',
    attempts: row.attempts + 1,
    last_error: lastError,
  }, summary)
}

// [silent-failure-hunter, C2.8 review BLOCKER-1] The ENTIRE body — including
// the snapshot lookup and the schema_version check, not just the classify/
// write path — lives inside one try/catch. Previously getPostAiOriginalById
// sat OUTSIDE the try: a transient DB error there propagated straight out of
// the tick's `for` loop, aborting every remaining row in the batch while
// those rows stayed stuck at status='processing' — which claim_post_edit_
// signals never reclaims (it only claims 'pending') — permanently. Now any
// exception, from any step, funnels into the same permanent/transient
// handling and always ends the row in a terminal-or-retryable state.
async function processRow(
  client: SupabaseClient,
  row: PostEditSignalRow,
  now: Date,
  summary: LearningTickSummary,
  touchedBusinessIds: Set<string>,
): Promise<void> {
  try {
    const aiOriginal = await getPostAiOriginalById(client, row.ai_original_id)
    if (!aiOriginal) {
      // ADR 0018 §9.4 — "a missing snapshot row" is a PERMANENT failure.
      // Tracked under skippedNoSnapshot (not the generic abandoned counter)
      // so §11's operator playbook ("a loop starved of snapshots shows a
      // high skippedNoSnapshot") stays meaningful.
      const wroteSkip = await abandonRow(client, row, 'missing_snapshot', summary)
      if (wroteSkip) summary.skippedNoSnapshot++
      return
    }

    if (aiOriginal.schema_version !== AI_ORIGINAL_SCHEMA_VERSION) {
      // ADR 0018 §2.4 — refuse to diff an unknown schema_version rather than
      // best-effort parse a shape this classifier does not understand.
      const wroteAbandon = await abandonRow(client, row, `unknown_schema_version:${aiOriginal.schema_version}`, summary)
      if (wroteAbandon) summary.abandoned++
      return
    }

    const post = await getPostById(client, row.post_id)
    const [voiceRules, brief] = await Promise.all([
      retrieveVoice(client, row.business_id),
      getBriefByCampaign(client, row.campaign_id),
    ])

    const pinnedIds = brief && brief.frozen_at !== null ? brief.content.pinnedEvidence.map((p) => p.evidenceMemoryId) : []
    const pinnedEvidence = pinnedIds.length > 0 ? await getEvidenceMemoryByIds(client, row.business_id, pinnedIds) : []

    const result = classify(
      {
        postId: row.post_id,
        platform: post.platform,
        format: aiOriginal.format,
        renderedContent: aiOriginal.rendered_content,
        hashtags: aiOriginal.hashtags,
        threadPostCount: getThreadPostCount(aiOriginal),
      },
      { humanContent: row.human_content, humanHashtags: row.human_hashtags },
      voiceRules,
      pinnedEvidence,
    )

    const totalSignals = result.preferences.length + result.corrections.length + result.inconclusive.length
    const { rowClass, rowPatternKey, primaryPreference } = canonicalize(result)

    const wrote = await guardedTransition(client, row, {
      status: 'processed',
      class: rowClass,
      pattern_key: rowPatternKey,
      signals: result as unknown as Record<string, unknown>,
      processed_at: formatISO(now),
    }, summary)
    if (!wrote) return

    summary.classified++
    summary.signalsEmitted += totalSignals
    touchedBusinessIds.add(row.business_id)

    if (primaryPreference && rowPatternKey) {
      const distillation = await recomputeAndUpsertPattern(client, {
        businessId: row.business_id,
        dimension: 'format',
        pattern: renderPatternStatement(primaryPreference),
        patternKey: rowPatternKey,
        contradictingPatternKey: computeContradictingPatternKey(primaryPreference),
        platform: post.platform,
        scope: 'platform',
        scopeRef: post.platform,
      })
      summary.patternsUpserted++
      if (distillation.promoted) summary.promoted++
      if (distillation.demoted) summary.demoted++
    }
  } catch (err) {
    const permanent = isPermanentError(err)
    const nextAttempts = row.attempts + 1
    const exhausted = nextAttempts >= config.server.LEARNING_MAX_ATTEMPTS
    const message = errorMessage(err)

    if (permanent || exhausted) {
      const wrote = await guardedTransition(client, row, {
        status: 'abandoned',
        attempts: nextAttempts,
        last_error: message,
      }, summary)
      if (wrote) summary.abandoned++
      Sentry.captureException(err, {
        extra: { class: permanent ? 'permanent' : 'transient_exhausted', row_id: row.id, business_id: row.business_id },
      })
    } else {
      const backoffSeconds = computeBackoff(nextAttempts)
      const wrote = await guardedTransition(client, row, {
        status: 'pending',
        attempts: nextAttempts,
        next_attempt_at: formatISO(addSeconds(now, backoffSeconds)),
        last_error: message,
      }, summary)
      if (wrote) summary.retrying++
    }
  }
}

export async function runLearningTick(opts: {
  triggeredBy: 'qstash' | 'secret'
}): Promise<LearningTickSummary> {
  const startedAt = Date.now()
  const now = new Date()
  const summary: LearningTickSummary = {
    tick: formatISO(now),
    triggeredBy: opts.triggeredBy,
    durationMs: 0,
    claimed: 0,
    classified: 0,
    signalsEmitted: 0,
    skippedNoSnapshot: 0,
    patternsUpserted: 0,
    promoted: 0,
    demoted: 0,
    summarized: 0,
    summarizeFailed: 0,
    summarizeFailedCode: null,
    retrying: 0,
    abandoned: 0,
    raceLost: 0,
  }

  try {
    await Sentry.withMonitor(
      'capture-learning',
      async () => {
        const { createServiceRoleClient } = await import('@/lib/supabase/service')
        const client = createServiceRoleClient()
        const batchSize = config.server.LEARNING_BATCH_SIZE

        const rows = await claimPostEditSignals(client, batchSize)
        summary.claimed = rows.length

        const touchedBusinessIds = new Set<string>()

        for (const row of rows) {
          await processRow(client, row, now, summary, touchedBusinessIds)
        }

        for (const businessId of touchedBusinessIds) {
          try {
            const result = await summarizeBusinessLearning(client, businessId)
            if (result.skipped === null) summary.summarized++
          } catch (err) {
            // [silent-failure-hunter, C2.8 review MAJOR-2] Sentry-only
            // reporting made a broken summarizer indistinguishable, in the
            // canonical log line, from "nothing needed summarizing this
            // hour" (the normal shouldSummarize skip). summarizeFailed
            // gives the log itself — the operator surface ADR §9.4/§11
            // designate — a way to show this without cross-referencing
            // Sentry.
            // [Session 25-D correction, MINOR-4] Tag both the Sentry capture
            // and the tick log with the underlying AiErrorCode (or
            // 'unknown' for a non-AiError, e.g. a DB write failure in the
            // upsert loop) — an operator watching summarizeFailed spike
            // must not have to leave the log to tell an Anthropic-side
            // outage from a prompt/schema regression.
            const code = err instanceof AiError ? err.code : 'unknown'
            summary.summarizeFailed++
            summary.summarizeFailedCode = code
            Sentry.captureException(err, { tags: { business_id: businessId, phase: 'learning-summarize', code } })
          }
        }
      },
      {
        schedule: { type: 'crontab', value: '0 * * * *' },
        checkinMargin: 10,
        maxRuntime: 55,
        failureIssueThreshold: 2,
        recoveryThreshold: 1,
      },
    )
  } catch (err) {
    Sentry.captureException(err, { tags: { cron: 'capture-learning' } })
  }

  summary.durationMs = Date.now() - startedAt

  console.log(JSON.stringify({ kind: 'learning.tick', ...summary }))

  return summary
}
