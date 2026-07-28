import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AiError } from '@/lib/ai/errors'
import type {
  PostEditSignalRow,
  PostAiOriginalRow,
  PostRow,
  CampaignBriefRow,
  PerformanceMemoryRow,
} from '@/lib/db/types'

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      LEARNING_BATCH_SIZE: 50,
      LEARNING_MAX_ATTEMPTS: 3,
      LEARNING_RETRY_BACKOFF_SECONDS: 60,
    },
  },
}))

vi.mock('@sentry/nextjs', () => ({
  withMonitor: vi.fn().mockImplementation((_slug: string, fn: () => unknown) => fn()),
  captureException: vi.fn(),
}))

const mockClaimPostEditSignals = vi.hoisted(() => vi.fn())
const mockTransitionPostEditSignal = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/post-edit-signals', () => ({
  claimPostEditSignals: mockClaimPostEditSignals,
  transitionPostEditSignal: mockTransitionPostEditSignal,
}))

const mockGetPostAiOriginalById = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/post-ai-originals', () => ({
  getPostAiOriginalById: mockGetPostAiOriginalById,
  AI_ORIGINAL_SCHEMA_VERSION: 1,
}))

const mockGetPostById = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/posts', () => ({
  getPostById: mockGetPostById,
}))

const mockGetBriefByCampaign = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/campaign-briefs', () => ({
  getBriefByCampaign: mockGetBriefByCampaign,
}))

const mockGetEvidenceMemoryByIds = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/memory-evidence', () => ({
  getEvidenceMemoryByIds: mockGetEvidenceMemoryByIds,
}))

const mockRetrieveVoice = vi.hoisted(() => vi.fn())
vi.mock('@/lib/memory/voice', () => ({
  retrieveVoice: mockRetrieveVoice,
}))

const mockClassify = vi.hoisted(() => vi.fn())
vi.mock('@/lib/learning/classify', () => ({
  classify: mockClassify,
}))

const mockRecomputeAndUpsertPattern = vi.hoisted(() => vi.fn())
vi.mock('@/lib/learning/promote', () => ({
  recomputeAndUpsertPattern: mockRecomputeAndUpsertPattern,
}))

const mockSummarizeBusinessLearning = vi.hoisted(() => vi.fn())
vi.mock('@/lib/learning/summarize', () => ({
  summarizeBusinessLearning: mockSummarizeBusinessLearning,
}))

import { runLearningTick } from './orchestrator'
import * as Sentry from '@sentry/nextjs'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const signalRow: PostEditSignalRow = {
  id: 'sig-1',
  business_id: 'biz-1',
  post_id: 'post-1',
  campaign_id: 'camp-1',
  ai_original_id: 'origin-1',
  human_content: 'Human edited content, much shorter now.',
  human_hashtags: [],
  approved_at: '2026-07-27T10:00:00Z',
  status: 'processing',
  attempts: 0,
  next_attempt_at: '2026-07-27T09:00:00Z',
  last_error: null,
  processed_at: null,
  class: null,
  pattern_key: null,
  signals: null,
  created_at: '2026-07-27T09:00:00Z',
  updated_at: '2026-07-27T09:00:00Z',
}

const aiOriginalRow: PostAiOriginalRow = {
  id: 'origin-1',
  business_id: 'biz-1',
  post_id: 'post-1',
  campaign_id: 'camp-1',
  revision: 1,
  generation_kind: 'initial',
  format: 'single',
  payload: { format: 'single', body: 'Original AI content here.', imageBrief: null },
  rendered_content: 'Original AI content here.',
  hashtags: [],
  schema_version: 1,
  created_at: '2026-07-27T08:00:00Z',
}

const postRow: PostRow = {
  id: 'post-1',
  campaign_id: 'camp-1',
  business_id: 'biz-1',
  platform: 'linkedin',
  content: 'Human edited content, much shorter now.',
  hashtags: [],
  media_urls: [],
  scheduled_at: null,
  published_at: null,
  platform_post_id: null,
  platform_url: null,
  status: 'approved',
  role: null,
  rejection_note: null,
  publish_attempts: 0,
  publish_error_code: null,
  publish_error_details: null,
  ai_generation_metadata: null,
  deleted_at: null,
  created_at: '2026-07-27T08:00:00Z',
  updated_at: '2026-07-27T08:00:00Z',
} as unknown as PostRow

const preferenceSignal = {
  _class: 'preference' as const,
  kind: 'length_delta' as const,
  postId: 'post-1',
  platform: 'linkedin' as const,
  detail: { delta: -0.3 },
}

const emptyClassifyResult = { preferences: [], corrections: [], inconclusive: [] }
const onePreferenceResult = { preferences: [preferenceSignal], corrections: [], inconclusive: [] }

const distillationRow = { id: 'pm-1' } as unknown as PerformanceMemoryRow

function resetAllMocks() {
  vi.clearAllMocks()
  mockClaimPostEditSignals.mockResolvedValue([])
  mockGetPostAiOriginalById.mockResolvedValue(aiOriginalRow)
  mockGetPostById.mockResolvedValue(postRow)
  mockGetBriefByCampaign.mockResolvedValue(null as CampaignBriefRow | null)
  mockGetEvidenceMemoryByIds.mockResolvedValue([])
  mockRetrieveVoice.mockResolvedValue(null)
  mockClassify.mockReturnValue(emptyClassifyResult)
  mockTransitionPostEditSignal.mockResolvedValue({ ...signalRow, status: 'processed' })
  mockRecomputeAndUpsertPattern.mockResolvedValue({
    row: distillationRow,
    observations: 1,
    contradictions: 0,
    confidence: 0.33,
    promoted: null,
    demoted: null,
  })
  mockSummarizeBusinessLearning.mockResolvedValue({ skipped: 'gates_not_met', statementsWritten: 0 })
}

beforeEach(() => {
  resetAllMocks()
})

// ─── Counters ────────────────────────────────────────────────────────────────

describe('runLearningTick — counters', () => {
  it('reports claimed=0 and all-zero counters when nothing is claimable', async () => {
    const result = await runLearningTick({ triggeredBy: 'secret' })
    expect(result.claimed).toBe(0)
    expect(result.classified).toBe(0)
    expect(result.signalsEmitted).toBe(0)
    expect(result.skippedNoSnapshot).toBe(0)
    expect(result.patternsUpserted).toBe(0)
    expect(result.promoted).toBe(0)
    expect(result.demoted).toBe(0)
    expect(result.summarized).toBe(0)
    expect(result.retrying).toBe(0)
    expect(result.abandoned).toBe(0)
  })

  it('classifies a claimed row with no detected signals: classified=1, signalsEmitted=0, no aggregation', async () => {
    mockClaimPostEditSignals.mockResolvedValue([signalRow])
    mockClassify.mockReturnValue(emptyClassifyResult)
    const result = await runLearningTick({ triggeredBy: 'secret' })
    expect(result.claimed).toBe(1)
    expect(result.classified).toBe(1)
    expect(result.signalsEmitted).toBe(0)
    expect(result.patternsUpserted).toBe(0)
    expect(mockRecomputeAndUpsertPattern).not.toHaveBeenCalled()
    expect(mockTransitionPostEditSignal).toHaveBeenCalledWith(
      expect.anything(),
      signalRow.id,
      expect.objectContaining({ status: 'processed', class: null, pattern_key: null }),
    )
  })

  it('classifies a row emitting one preference: classified=1, signalsEmitted=1, patternsUpserted=1, class=preference on the row', async () => {
    mockClaimPostEditSignals.mockResolvedValue([signalRow])
    mockClassify.mockReturnValue(onePreferenceResult)
    const result = await runLearningTick({ triggeredBy: 'secret' })
    expect(result.classified).toBe(1)
    expect(result.signalsEmitted).toBe(1)
    expect(result.patternsUpserted).toBe(1)
    expect(mockTransitionPostEditSignal).toHaveBeenCalledWith(
      expect.anything(),
      signalRow.id,
      expect.objectContaining({ status: 'processed', class: 'preference' }),
    )
    expect(mockRecomputeAndUpsertPattern).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ businessId: 'biz-1', dimension: 'format', platform: 'linkedin', scope: 'platform' }),
    )
  })

  it('propagates promoted/demoted from recomputeAndUpsertPattern', async () => {
    mockClaimPostEditSignals.mockResolvedValue([signalRow])
    mockClassify.mockReturnValue(onePreferenceResult)
    mockRecomputeAndUpsertPattern.mockResolvedValue({
      row: distillationRow,
      observations: 5,
      contradictions: 0,
      confidence: 0.9,
      promoted: distillationRow,
      demoted: null,
    })
    const result = await runLearningTick({ triggeredBy: 'secret' })
    expect(result.promoted).toBe(1)
    expect(result.demoted).toBe(0)
  })

  it('counts summarized only when summarizeBusinessLearning actually wrote statements', async () => {
    mockClaimPostEditSignals.mockResolvedValue([signalRow])
    mockClassify.mockReturnValue(onePreferenceResult)
    mockSummarizeBusinessLearning.mockResolvedValue({ skipped: null, statementsWritten: 3 })
    const result = await runLearningTick({ triggeredBy: 'secret' })
    expect(mockSummarizeBusinessLearning).toHaveBeenCalledWith(expect.anything(), 'biz-1')
    expect(result.summarized).toBe(1)
  })

  it('does not call summarizeBusinessLearning when no row was successfully classified for that business', async () => {
    mockClaimPostEditSignals.mockResolvedValue([])
    await runLearningTick({ triggeredBy: 'secret' })
    expect(mockSummarizeBusinessLearning).not.toHaveBeenCalled()
  })
})

// ─── Canonical signal-per-row rule ───────────────────────────────────────────

describe('runLearningTick — canonical class/pattern_key (LEARN-VOICE-WRITE-TRIGGER safety)', () => {
  it('class is "preference" and pattern_key is set whenever any preference signal exists, even alongside a correction', async () => {
    mockClaimPostEditSignals.mockResolvedValue([signalRow])
    mockClassify.mockReturnValue({
      preferences: [preferenceSignal],
      corrections: [{ _class: 'correction', kind: 'unsourced_claim_removed', postId: 'post-1', platform: 'linkedin', detail: {} }],
      inconclusive: [],
    })
    await runLearningTick({ triggeredBy: 'secret' })
    expect(mockTransitionPostEditSignal).toHaveBeenCalledWith(
      expect.anything(),
      signalRow.id,
      expect.objectContaining({ class: 'preference', pattern_key: expect.any(String) }),
    )
  })

  it('class is "correction" with pattern_key null when only corrections are detected', async () => {
    mockClaimPostEditSignals.mockResolvedValue([signalRow])
    mockClassify.mockReturnValue({
      preferences: [],
      corrections: [{ _class: 'correction', kind: 'unsourced_claim_removed', postId: 'post-1', platform: 'linkedin', detail: {} }],
      inconclusive: [],
    })
    await runLearningTick({ triggeredBy: 'secret' })
    expect(mockTransitionPostEditSignal).toHaveBeenCalledWith(
      expect.anything(),
      signalRow.id,
      expect.objectContaining({ class: 'correction', pattern_key: null }),
    )
    expect(mockRecomputeAndUpsertPattern).not.toHaveBeenCalled()
  })
})

// ─── Failure taxonomy ────────────────────────────────────────────────────────

describe('runLearningTick — missing snapshot (skippedNoSnapshot, §9.4 permanent)', () => {
  it('abandons the row and increments skippedNoSnapshot when the ai_original does not exist', async () => {
    mockClaimPostEditSignals.mockResolvedValue([signalRow])
    mockGetPostAiOriginalById.mockResolvedValue(null)
    const result = await runLearningTick({ triggeredBy: 'secret' })
    expect(result.skippedNoSnapshot).toBe(1)
    expect(result.abandoned).toBe(0)
    expect(mockClassify).not.toHaveBeenCalled()
    expect(mockTransitionPostEditSignal).toHaveBeenCalledWith(
      expect.anything(),
      signalRow.id,
      expect.objectContaining({ status: 'abandoned' }),
    )
  })
})

describe('runLearningTick — an exception during snapshot/post lookup does not abort the rest of the batch (silent-failure-hunter BLOCKER-1)', () => {
  it('a transient getPostAiOriginalById throw on one row still lets a later row in the same batch be processed', async () => {
    const otherRow = { ...signalRow, id: 'sig-2', post_id: 'post-2', ai_original_id: 'origin-2' }
    mockClaimPostEditSignals.mockResolvedValue([signalRow, otherRow])
    mockGetPostAiOriginalById.mockImplementation((_client: unknown, id: string) => {
      if (id === 'origin-1') return Promise.reject({ code: undefined, message: 'connection reset' })
      return Promise.resolve(aiOriginalRow)
    })
    mockClassify.mockReturnValue(emptyClassifyResult)
    const result = await runLearningTick({ triggeredBy: 'secret' })
    // row 1 failed transiently (retried, not lost) and row 2 was classified —
    // the exception on row 1 must not have aborted the loop before row 2 ran.
    expect(result.classified).toBe(1)
    expect(result.retrying).toBe(1)
    expect(mockTransitionPostEditSignal).toHaveBeenCalledWith(
      expect.anything(),
      'sig-1',
      expect.objectContaining({ status: 'pending' }),
    )
  })
})

describe('runLearningTick — unknown schema_version (§9.4 permanent, no best-effort parse)', () => {
  it('abandons the row without calling classify()', async () => {
    mockClaimPostEditSignals.mockResolvedValue([signalRow])
    mockGetPostAiOriginalById.mockResolvedValue({ ...aiOriginalRow, schema_version: 999 })
    const result = await runLearningTick({ triggeredBy: 'secret' })
    expect(result.abandoned).toBe(1)
    expect(mockClassify).not.toHaveBeenCalled()
    expect(mockTransitionPostEditSignal).toHaveBeenCalledWith(
      expect.anything(),
      signalRow.id,
      expect.objectContaining({ status: 'abandoned', last_error: expect.stringContaining('schema_version') }),
    )
  })
})

// [Session 25-D correction, MINOR-3] abandonRow's guardedTransition call can
// itself lose a concurrent race (the row moved out from under this tick
// between the claim and the abandon write). That already increments
// raceLost and is Sentry-reported inside guardedTransition — it must NOT
// ALSO increment `abandoned`, which would claim an abandonment that never
// actually happened (the write matched zero rows) and double-count one lost
// race as two distinct terminal outcomes.
describe('runLearningTick — a lost race on abandonRow does not double-count as an abandonment (MINOR-3)', () => {
  it('increments raceLost but NOT abandoned when the abandon write itself loses its race', async () => {
    mockClaimPostEditSignals.mockResolvedValue([signalRow])
    mockGetPostAiOriginalById.mockResolvedValue({ ...aiOriginalRow, schema_version: 999 })
    mockTransitionPostEditSignal.mockResolvedValue(null) // guarded UPDATE matched zero rows — lost race
    const result = await runLearningTick({ triggeredBy: 'secret' })
    expect(result.raceLost).toBe(1)
    expect(result.abandoned).toBe(0)
    expect(Sentry.captureException).toHaveBeenCalled()
  })
})

describe('runLearningTick — transient vs permanent branch', () => {
  it('a transient error (Postgres 40001) retries: status=pending, attempts incremented, retrying++', async () => {
    mockClaimPostEditSignals.mockResolvedValue([signalRow])
    mockTransitionPostEditSignal.mockImplementation((_client, _id, next) => {
      if (next.status === 'processed') {
        return Promise.reject({ code: '40001', message: 'serialization failure' })
      }
      return Promise.resolve({ ...signalRow, status: next.status })
    })
    const result = await runLearningTick({ triggeredBy: 'secret' })
    expect(result.retrying).toBe(1)
    expect(result.abandoned).toBe(0)
    expect(mockTransitionPostEditSignal).toHaveBeenCalledWith(
      expect.anything(),
      signalRow.id,
      expect.objectContaining({ status: 'pending', attempts: 1 }),
    )
  })

  it('a permanent error (Postgres 23xxx) abandons immediately, no retry', async () => {
    mockClaimPostEditSignals.mockResolvedValue([signalRow])
    mockTransitionPostEditSignal.mockImplementation((_client, _id, next) => {
      if (next.status === 'processed') {
        return Promise.reject({ code: '23503', message: 'foreign key violation' })
      }
      return Promise.resolve({ ...signalRow, status: next.status })
    })
    const result = await runLearningTick({ triggeredBy: 'secret' })
    expect(result.abandoned).toBe(1)
    expect(result.retrying).toBe(0)
    expect(mockTransitionPostEditSignal).toHaveBeenCalledWith(
      expect.anything(),
      signalRow.id,
      expect.objectContaining({ status: 'abandoned' }),
    )
  })

  it('a transient error exhausts LEARNING_MAX_ATTEMPTS and abandons instead of retrying', async () => {
    mockClaimPostEditSignals.mockResolvedValue([{ ...signalRow, attempts: 2 }]) // next attempt = 3 = LEARNING_MAX_ATTEMPTS
    mockTransitionPostEditSignal.mockImplementation((_client, _id, next) => {
      if (next.status === 'processed') {
        return Promise.reject({ code: '40001', message: 'serialization failure' })
      }
      return Promise.resolve({ ...signalRow, status: next.status })
    })
    const result = await runLearningTick({ triggeredBy: 'secret' })
    expect(result.abandoned).toBe(1)
    expect(result.retrying).toBe(0)
  })

  it('every terminal outcome writes last_error (no silent swallow)', async () => {
    mockClaimPostEditSignals.mockResolvedValue([signalRow])
    mockTransitionPostEditSignal.mockImplementation((_client, _id, next) => {
      if (next.status === 'processed') {
        return Promise.reject({ code: '23503', message: 'foreign key violation' })
      }
      return Promise.resolve({ ...signalRow, status: next.status })
    })
    await runLearningTick({ triggeredBy: 'secret' })
    expect(mockTransitionPostEditSignal).toHaveBeenCalledWith(
      expect.anything(),
      signalRow.id,
      expect.objectContaining({ last_error: expect.any(String) }),
    )
    expect(Sentry.captureException).toHaveBeenCalled()
  })
})

describe('runLearningTick — a lost race on the terminal transition is not silently absorbed (silent-failure-hunter BLOCKER-2)', () => {
  it('increments raceLost and reports it in the summary when transitionPostEditSignal returns null on the success write', async () => {
    mockClaimPostEditSignals.mockResolvedValue([signalRow])
    mockClassify.mockReturnValue(emptyClassifyResult)
    mockTransitionPostEditSignal.mockResolvedValue(null) // guarded UPDATE matched zero rows
    const result = await runLearningTick({ triggeredBy: 'secret' })
    expect(result.raceLost).toBe(1)
    expect(result.classified).toBe(0)
    expect(Sentry.captureException).toHaveBeenCalled()
  })
})

describe('runLearningTick — a summarizer exception is counted, not just Sentry-captured (silent-failure-hunter MAJOR-2)', () => {
  it('increments summarizeFailed when summarizeBusinessLearning throws', async () => {
    mockClaimPostEditSignals.mockResolvedValue([signalRow])
    mockClassify.mockReturnValue(onePreferenceResult)
    mockSummarizeBusinessLearning.mockRejectedValue(new Error('anthropic outage'))
    const result = await runLearningTick({ triggeredBy: 'secret' })
    expect(result.summarizeFailed).toBe(1)
    expect(result.summarized).toBe(0)
    // [Session 25-D correction, MINOR-4] A plain (non-AiError) failure —
    // e.g. a DB write failure in the upsert loop — falls back to 'unknown'.
    expect(result.summarizeFailedCode).toBe('unknown')
    expect(Sentry.captureException).toHaveBeenCalled()
  })
})

// [Session 25-D correction, MINOR-4] Distinguishing an Anthropic-side
// failure from a prompt/schema regression requires the actual AiErrorCode,
// not just "something threw." Proves the code reaches both the Sentry tags
// AND the tick summary (which the canonical log line spreads verbatim).
describe('runLearningTick — a summarize failure carries its AiErrorCode into the log line (MINOR-4)', () => {
  it('tags the Sentry capture and the tick summary with the AiError code', async () => {
    mockClaimPostEditSignals.mockResolvedValue([signalRow])
    mockClassify.mockReturnValue(onePreferenceResult)
    mockSummarizeBusinessLearning.mockRejectedValue(new AiError('provider_error', 'upstream 503'))
    const result = await runLearningTick({ triggeredBy: 'secret' })
    expect(result.summarizeFailed).toBe(1)
    expect(result.summarizeFailedCode).toBe('provider_error')
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ code: 'provider_error' }) }),
    )
  })
})

// ─── LEARN-TICK-IDEMPOTENT (replayed tick) ───────────────────────────────────
//
// [Session 25-D correction, MAJOR-4] The prior version of this describe block
// stubbed the SECOND claim to return an EMPTY batch
// (`.mockResolvedValueOnce([signalRow]).mockResolvedValueOnce([])`), which
// only proves "an empty claim batch is a no-op" — it never replays anything,
// and would not redden if recompute were mutated to increment. Fixed per the
// Reviewer's preferred option (b): a REAL replay, where BOTH claims return
// the SAME signalRow, asserting recomputeAndUpsertPattern is actually
// invoked (not skipped) on both ticks and resolves to an IDENTICAL,
// non-cumulative observation count each time — recompute, never increment.
// The no-op-on-empty-batch case is kept, renamed to what it actually proves.

describe('runLearningTick — a second tick with nothing left to claim (no-op on an empty batch)', () => {
  it('produces all-zero counters and performs no writes when the claim returns empty', async () => {
    mockClaimPostEditSignals.mockResolvedValueOnce([signalRow]).mockResolvedValueOnce([])
    mockClassify.mockReturnValue(onePreferenceResult)

    const first = await runLearningTick({ triggeredBy: 'secret' })
    expect(first.claimed).toBe(1)
    expect(first.classified).toBe(1)
    expect(first.patternsUpserted).toBe(1)

    vi.mocked(mockTransitionPostEditSignal).mockClear()
    vi.mocked(mockRecomputeAndUpsertPattern).mockClear()
    vi.mocked(mockClassify).mockClear()

    const second = await runLearningTick({ triggeredBy: 'secret' })
    expect(second.claimed).toBe(0)
    expect(second.classified).toBe(0)
    expect(second.signalsEmitted).toBe(0)
    expect(second.patternsUpserted).toBe(0)
    expect(second.promoted).toBe(0)
    expect(second.demoted).toBe(0)
    expect(second.abandoned).toBe(0)
    expect(second.retrying).toBe(0)
    expect(mockTransitionPostEditSignal).not.toHaveBeenCalled()
    expect(mockRecomputeAndUpsertPattern).not.toHaveBeenCalled()
    expect(mockClassify).not.toHaveBeenCalled()
  })
})

describe('runLearningTick — replayed tick over the SAME signal row (LEARN-TICK-IDEMPOTENT)', () => {
  it('recomputes an identical, non-cumulative observation count on both ticks — never increments', async () => {
    // BOTH claims return the identical signalRow — a genuine replay, not a
    // second claim that conveniently finds nothing.
    mockClaimPostEditSignals.mockResolvedValue([signalRow])
    mockClassify.mockReturnValue(onePreferenceResult)
    // A correct recompute (COUNT(*) over the same underlying rows) is
    // idempotent by construction: the SAME fixed value on every call. A
    // persistent .mockResolvedValue (not paired .mockResolvedValueOnce
    // calls) models that.
    mockRecomputeAndUpsertPattern.mockResolvedValue({
      row: distillationRow,
      observations: 5,
      contradictions: 0,
      confidence: 0.714,
      promoted: null,
      demoted: null,
    })

    const first = await runLearningTick({ triggeredBy: 'secret' })
    const second = await runLearningTick({ triggeredBy: 'secret' })

    expect(first.claimed).toBe(1)
    expect(second.claimed).toBe(1)
    // Both ticks fully reprocess the row — recomputeAndUpsertPattern is
    // NEVER skipped on the second tick just because it's "already seen".
    expect(mockRecomputeAndUpsertPattern).toHaveBeenCalledTimes(2)
    expect(first.patternsUpserted).toBe(1)
    expect(second.patternsUpserted).toBe(1)

    // Both calls resolve to the IDENTICAL observation count — recomputed,
    // not accumulated across ticks.
    const [firstResult, secondResult] = await Promise.all(
      mockRecomputeAndUpsertPattern.mock.results.map((r) => r.value),
    )
    expect(firstResult.observations).toBe(5)
    expect(secondResult.observations).toBe(5)
    expect(secondResult.observations).toBe(firstResult.observations)

    // Both calls also carry identical DistillationInput — the orchestrator
    // constructs the same call from the same row both times, with no hidden
    // state carried between ticks.
    const [firstArgs, secondArgs] = mockRecomputeAndUpsertPattern.mock.calls
    expect(secondArgs[1]).toEqual(firstArgs[1])
  })
})

// ─── The canonical tick log ──────────────────────────────────────────────────

describe('runLearningTick — canonical tick log', () => {
  it('logs exactly one JSON line with kind: learning.tick and all named counters', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runLearningTick({ triggeredBy: 'qstash' })
    const learningTickLogs = logSpy.mock.calls.filter((call) => {
      try {
        return JSON.parse(String(call[0]))?.kind === 'learning.tick'
      } catch {
        return false
      }
    })
    expect(learningTickLogs).toHaveLength(1)
    const parsed = JSON.parse(String(learningTickLogs[0][0]))
    expect(parsed).toMatchObject({
      kind: 'learning.tick',
      triggeredBy: 'qstash',
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
    })
    expect(parsed).toHaveProperty('tick')
    expect(parsed).toHaveProperty('durationMs')
    logSpy.mockRestore()
  })

  it('wraps the tick in Sentry.withMonitor with the capture-learning slug', async () => {
    await runLearningTick({ triggeredBy: 'secret' })
    expect(Sentry.withMonitor).toHaveBeenCalledWith(
      'capture-learning',
      expect.any(Function),
      expect.objectContaining({ schedule: { type: 'crontab', value: '0 * * * *' } }),
    )
  })
})

// ─── Cross-business isolation (MAJOR-6, ADR §14 [sec-Q2]'s test obligation) ──
//
// [Session 25-D correction] runLearningTick runs entirely under a
// service-role client, which BYPASSES RLS — the only tenancy boundary for
// the whole batch is the business_id threaded through each call. Until this
// test, only 'biz-1' ever appeared anywhere in this file, so a future
// closure-capture or shared-variable refactor (the exact bug class Session
// 24-D's MAJOR-1 closed for wrapEvidenceForPrompt) could leak one business's
// data into another's downstream calls with nothing here to catch it.

describe('runLearningTick — cross-business isolation in one tick (MAJOR-6)', () => {
  it('claims two rows for two distinct businesses and keeps every downstream call scoped to its own business', async () => {
    const signalRowBiz2: PostEditSignalRow = {
      ...signalRow,
      id: 'sig-2',
      business_id: 'biz-2',
      post_id: 'post-2',
      campaign_id: 'camp-2',
      ai_original_id: 'origin-2',
      human_content: 'Completely unrelated edited content that belongs only to biz-2.',
    }
    const aiOriginalRow2: PostAiOriginalRow = {
      ...aiOriginalRow,
      id: 'origin-2',
      business_id: 'biz-2',
      post_id: 'post-2',
      campaign_id: 'camp-2',
    }
    const postRow2 = {
      ...postRow,
      id: 'post-2',
      business_id: 'biz-2',
      campaign_id: 'camp-2',
      platform: 'twitter',
    } as unknown as PostRow

    mockClaimPostEditSignals.mockResolvedValue([signalRow, signalRowBiz2])
    mockGetPostAiOriginalById.mockImplementation(async (_client: unknown, id: string) =>
      id === 'origin-2' ? aiOriginalRow2 : aiOriginalRow,
    )
    mockGetPostById.mockImplementation(async (_client: unknown, id: string) => (id === 'post-2' ? postRow2 : postRow))
    mockClassify.mockReturnValue(onePreferenceResult)

    const result = await runLearningTick({ triggeredBy: 'secret' })

    expect(result.claimed).toBe(2)
    expect(result.classified).toBe(2)

    // (a) each recomputeAndUpsertPattern call carries its OWN row's
    // business_id — never the other row's, never a shared/closed-over value.
    expect(mockRecomputeAndUpsertPattern).toHaveBeenCalledTimes(2)
    expect(mockRecomputeAndUpsertPattern).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ businessId: 'biz-1' }),
    )
    expect(mockRecomputeAndUpsertPattern).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ businessId: 'biz-2' }),
    )

    // (b) summarizeBusinessLearning is called once per business, with the
    // matching id — not once overall, not with the wrong id.
    expect(mockSummarizeBusinessLearning).toHaveBeenCalledTimes(2)
    expect(mockSummarizeBusinessLearning).toHaveBeenCalledWith(expect.anything(), 'biz-1')
    expect(mockSummarizeBusinessLearning).toHaveBeenCalledWith(expect.anything(), 'biz-2')

    // (c) neither business's human_content appears in the other's call
    // arguments — classify() is called once per row with THAT row's own
    // human-edited copy, never a value carried over from the other row.
    const classifyCalls = mockClassify.mock.calls
    expect(classifyCalls).toHaveLength(2)
    const [firstCallArgs, secondCallArgs] = classifyCalls
    expect(firstCallArgs[1]).toEqual(
      expect.objectContaining({ humanContent: signalRow.human_content }),
    )
    expect(secondCallArgs[1]).toEqual(
      expect.objectContaining({ humanContent: signalRowBiz2.human_content }),
    )
    expect(firstCallArgs[1].humanContent).not.toBe(signalRowBiz2.human_content)
    expect(secondCallArgs[1].humanContent).not.toBe(signalRow.human_content)

    // [security-reviewer, D3 re-invocation] retrieveVoice and
    // getBriefByCampaign are ALSO constructed per-row inside processRow
    // (retrieveVoice(client, row.business_id), getBriefByCampaign(client,
    // row.campaign_id)) — the same leak vector as (a)-(c) above, just on two
    // more collaborators. Asserting them closes the gap the security review
    // found: without this, a swapped business_id/campaign_id reaching either
    // call would pass silently.
    expect(mockRetrieveVoice).toHaveBeenCalledWith(expect.anything(), 'biz-1')
    expect(mockRetrieveVoice).toHaveBeenCalledWith(expect.anything(), 'biz-2')
    expect(mockGetBriefByCampaign).toHaveBeenCalledWith(expect.anything(), 'camp-1')
    expect(mockGetBriefByCampaign).toHaveBeenCalledWith(expect.anything(), 'camp-2')
  })
})
