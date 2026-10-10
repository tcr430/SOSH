import * as Sentry from '@sentry/nextjs'
import { createHash } from 'node:crypto'
import { formatISO, parseISO } from 'date-fns'
import { toUtcIso } from '@/lib/utils'
import { listBusinessIdsPage, isLiveForReports, getTrialStartedAtForWorker } from '@/lib/db/businesses'
import { analyticsReportExistsForWorker, getReportForRedeliveryForWorker, insertAnalyticsReport, type AnalyticsReportInsert, type ReportForRedelivery } from '@/lib/db/analytics-reports'
import { analyticsWorkerReaders } from '@/lib/db/analytics-worker-reads'
import type { LoaderDeps, Readers } from '@/lib/analytics/load'
import { assembleReport, type SummaryLine } from './assemble'
import { REPORT_ERROR_CAP, REPORT_MAX_PER_TICK, REPORT_REDELIVERY_HOURS, REPORT_SCAN_CAP, REPORT_SCAN_PAGE } from './constants'
import { reportPeriodDue } from './due'
import { verifiedReaders } from './isolation'

// ADR 0031 §5.2, §5.6, §9.3 — generate the report of ONE business, and the hourly tick that visits the due ones. The
// email enqueue is O2.8's: the generator returns { inserted } and the caller enqueues only when a row came back and the
// report is not a stub. DETERMINISTIC (no model call), idempotent (INSERT ... ON CONFLICT DO NOTHING), and tenant-bound:
// the inserted row's business_id and tier come from the loop variable and the plan read here, never from a payload.

export interface GenerateDeps {
  readers: Readers
  loaderDeps?: Partial<LoaderDeps>
  trialStartedAt: (businessId: string) => Promise<{ business_id: string; trial_started_at: string | null } | null>
  reportExists: (businessId: string, periodMonth: string) => Promise<boolean>
  /** Read ONLY for a report the probe says exists (MINOR-8): when it was generated, whether it is a stub, its stored summary. */
  redeliveryOf: (businessId: string, periodMonth: string) => Promise<ReportForRedelivery | null>
  insert: (row: AnalyticsReportInsert) => Promise<boolean>
}

function defaultDeps(): GenerateDeps {
  return {
    readers: analyticsWorkerReaders(),
    trialStartedAt: getTrialStartedAtForWorker,
    reportExists: analyticsReportExistsForWorker,
    redeliveryOf: getReportForRedeliveryForWorker,
    insert: insertAnalyticsReport,
  }
}

export type GenerateOutcome =
  | { status: 'not_due'; inserted: false }
  | { status: 'ineligible'; inserted: false }
  | { status: 'exists'; inserted: false; redeliver?: RedeliveryCandidate; redeliveryReadError?: unknown }
  | { status: 'generated'; inserted: boolean; stub: boolean; tier: 'basic' | 'advanced'; period: string; summary: SummaryLine[] }

/** An existing, non-stub report still inside its redelivery window: the caller checks the outbox and re-sends what is missing. */
export interface RedeliveryCandidate {
  businessId: string
  period: string
  summary: SummaryLine[]
}

export async function generateReportForBusiness(businessId: string, now: string, overrides: Partial<GenerateDeps> = {}): Promise<GenerateOutcome> {
  const deps: GenerateDeps = { ...defaultDeps(), ...overrides }
  const readers = verifiedReaders(deps.readers, businessId)

  const business = await readers.getBusinessById(businessId)
  // 1. Is it due? Only the month before the business's current local month is ever generated.
  const period = reportPeriodDue(now, business.timezone)
  if (period === null) return { status: 'not_due', inserted: false }

  // 2. Is it eligible? A live trial or a live paid subscription, nothing else (ruling O-2). A cancelled or lapsed
  //    business, and a trial whose clock never started, get no report and no stub.
  const trial = await deps.trialStartedAt(businessId)
  if (trial !== null && trial.business_id !== businessId) throw new Error('report isolation: trial_state row for another business')
  const live = isLiveForReports({ plan: business.plan, stripe_subscription_id: business.stripe_subscription_id, trial_started_at: trial?.trial_started_at ?? null }, now)
  if (!live) return { status: 'ineligible', inserted: false }

  // 3. The anti-join probe on the unique key (the INSERT below is still the idempotency point).
  const periodMonth = period + '-01'
  if (await deps.reportExists(businessId, periodMonth)) {
    // A report whose email never went out (the job threw, or one enqueue failed) is re-delivered for REPORT_REDELIVERY_HOURS after it was
    // generated (MINOR-8, A-13(a)). Never for a stub (it mails nothing), never past the window.
    // The redelivery read is an add-on to a report that already exists: a failure of it is captured and counted on its OWN counter,
    // never as a generation error (it must not spend REPORT_ERROR_CAP and starve the due businesses behind it).
    let stored: ReportForRedelivery | null
    try {
      stored = await deps.redeliveryOf(businessId, periodMonth)
    } catch (error) {
      return { status: 'exists', inserted: false, redeliveryReadError: error }
    }
    const recent = stored !== null && parseISO(now).getTime() - parseISO(stored.generated_at).getTime() < REPORT_REDELIVERY_HOURS * 3_600_000
    if (stored !== null && !stored.stub && recent) return { status: 'exists', inserted: false, redeliver: { businessId, period, summary: stored.summary as SummaryLine[] } }
    return { status: 'exists', inserted: false }
  }

  // 4. Assemble (every read verified against THIS business) and store.
  const report = await assembleReport({ readers: deps.readers, businessId, period, now, loaderDeps: deps.loaderDeps })
  const inserted = await deps.insert({
    business_id: businessId,
    period_month: report.periodMonth,
    tier: report.tier,
    schema_version: report.payload.schemaVersion,
    payload: report.payload as unknown as Record<string, unknown>,
    outcomes_through: report.outcomesThrough,
    generated_at: report.generatedAt,
  })
  return { status: 'generated', inserted, stub: report.stub, tier: report.tier, period, summary: report.payload.summary }
}

export interface ReportTickSummary {
  scanned: number
  notDue: number
  ineligible: number
  exists: number
  inserted: number
  stubs: number
  raced: number
  errors: number
  /** Redelivery reads that failed (captured, not counted in `errors`): the report exists, only its email retry could not be checked. */
  redeliveryReadErrors: number
  /** True when a cap ended the tick with businesses left unvisited: the rest wait for a later tick (or, past the scan cap, for the offset to move). */
  capped: boolean
  /** Which cap ended it; null when the tick saw every business. */
  reason: 'scan_cap' | 'generation_cap' | 'error_cap' | null
  /** The ids whose report was INSERTED this tick and is not a stub (the caller enqueues their email, O2.8). */
  insertedBusinessIds: string[]
  /** The same reports with what the email needs: the period and the stored summary lines (no post text, keys and params). */
  insertedReports: Array<{ businessId: string; period: string; summary: SummaryLine[] }>
  /** Existing non-stub reports inside the redelivery window: the job re-sends the members the outbox is missing (MINOR-8). */
  redeliverReports: RedeliveryCandidate[]
}

export interface TickDeps extends Partial<GenerateDeps> {
  listBusinessIds?: (afterId: string | null, limit: number) => Promise<string[]>
  capture?: (error: unknown, context: { businessId: string }) => void
  maxPerTick?: number
  /** Test seam: the scan's starting id. Production derives it from the tick hour (reportScanOffset). */
  scanOffset?: string
}

/**
 * Where this hour's scan starts: the first 32 hex digits of sha256(the tick HOUR, UTC ISO) formatted as a uuid. Deterministic (a
 * replayed tick starts where it did) and different every hour, so the ids a capped tick could not reach are the ones a later tick
 * starts from. No cursor table (MAJOR-5, ADR 0031 §5.2).
 */
export function reportScanOffset(now: string): string {
  const hour = toUtcIso(new Date(Math.floor(parseISO(now).getTime() / 3_600_000) * 3_600_000))
  const h = createHash('sha256').update(hour).digest('hex').slice(0, 32)
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20, 32)
}

/**
 * The business ids in scan order: every id ABOVE the offset, then every id at or below it. The two ranges are disjoint, so each
 * business appears at most once whatever the offset is, an offset equal to an existing id included (that id is in the second range).
 */
async function* scanOrder(listBusinessIds: (afterId: string | null, limit: number) => Promise<string[]>, offset: string): AsyncGenerator<string[]> {
  let cursor: string | null = offset
  for (;;) {
    const ids = await listBusinessIds(cursor, REPORT_SCAN_PAGE)
    if (ids.length === 0) break
    yield ids
    if (ids.length < REPORT_SCAN_PAGE) break
    cursor = ids[ids.length - 1]
  }
  cursor = null
  for (;;) {
    const ids = await listBusinessIds(cursor, REPORT_SCAN_PAGE)
    const head = ids.filter((id) => id <= offset)
    if (head.length > 0) yield head
    if (head.length < ids.length || ids.length < REPORT_SCAN_PAGE) break
    cursor = ids[ids.length - 1]
  }
}

// One failing business NEVER fails the tick: it is captured (Sentry) and the loop continues with the next business. Three bounds end a
// tick early, each recorded in `reason` and `capped`: businesses scanned, reports generated, and errors. Errors do NOT spend the
// generation budget, so failing ids cannot starve the due businesses behind them.
export async function runReportTick(now: string = formatISO(new Date()), deps: TickDeps = {}): Promise<ReportTickSummary> {
  const { listBusinessIds = listBusinessIdsPage, capture = (error, context) => Sentry.captureException(error, { tags: { worker: 'generate-reports' }, extra: context }), maxPerTick = REPORT_MAX_PER_TICK, scanOffset, ...generateDeps } = deps
  const summary: ReportTickSummary = { scanned: 0, notDue: 0, ineligible: 0, exists: 0, inserted: 0, stubs: 0, raced: 0, errors: 0, redeliveryReadErrors: 0, capped: false, reason: null, insertedBusinessIds: [], insertedReports: [], redeliverReports: [] }
  let attempts = 0

  scan: for await (const ids of scanOrder(listBusinessIds, scanOffset ?? reportScanOffset(now))) {
    for (const businessId of ids) {
      // A business is in hand and a bound is spent: it is unvisited, so the tick is capped (exact, never a guess).
      const stop = attempts >= maxPerTick ? 'generation_cap' : summary.errors > REPORT_ERROR_CAP ? 'error_cap' : summary.scanned >= REPORT_SCAN_CAP ? 'scan_cap' : null
      if (stop !== null) {
        summary.capped = true
        summary.reason = stop
        break scan
      }
      summary.scanned += 1
      try {
        const outcome = await generateReportForBusiness(businessId, now, generateDeps)
        switch (outcome.status) {
          case 'not_due':
            summary.notDue += 1
            break
          case 'ineligible':
            summary.ineligible += 1
            break
          case 'exists':
            summary.exists += 1
            if (outcome.redeliver) summary.redeliverReports.push(outcome.redeliver)
            if (outcome.redeliveryReadError !== undefined) {
              summary.redeliveryReadErrors += 1
              capture(outcome.redeliveryReadError, { businessId })
            }
            break
          case 'generated':
            attempts += 1
            if (outcome.inserted) {
              summary.inserted += 1
              if (outcome.stub) summary.stubs += 1
              else {
                summary.insertedBusinessIds.push(businessId)
                summary.insertedReports.push({ businessId, period: outcome.period, summary: outcome.summary })
              }
            } else summary.raced += 1
            break
        }
      } catch (error) {
        summary.errors += 1
        capture(error, { businessId })
      }
    }
  }
  return summary
}
