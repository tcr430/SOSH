import * as Sentry from '@sentry/nextjs'
import { formatISO } from 'date-fns'
import { listBusinessIdsPage, isLiveForReports, getTrialStartedAtForWorker } from '@/lib/db/businesses'
import { analyticsReportExistsForWorker, insertAnalyticsReport, type AnalyticsReportInsert } from '@/lib/db/analytics-reports'
import { analyticsWorkerReaders } from '@/lib/db/analytics-worker-reads'
import type { LoaderDeps, Readers } from '@/lib/analytics/load'
import { assembleReport } from './assemble'
import { REPORT_MAX_PER_TICK, REPORT_SCAN_CAP, REPORT_SCAN_PAGE } from './constants'
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
  insert: (row: AnalyticsReportInsert) => Promise<boolean>
}

function defaultDeps(): GenerateDeps {
  return {
    readers: analyticsWorkerReaders(),
    trialStartedAt: getTrialStartedAtForWorker,
    reportExists: analyticsReportExistsForWorker,
    insert: insertAnalyticsReport,
  }
}

export type GenerateOutcome =
  | { status: 'not_due'; inserted: false }
  | { status: 'ineligible'; inserted: false }
  | { status: 'exists'; inserted: false }
  | { status: 'generated'; inserted: boolean; stub: boolean; tier: 'basic' | 'advanced'; period: string }

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
  if (await deps.reportExists(businessId, periodMonth)) return { status: 'exists', inserted: false }

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
  return { status: 'generated', inserted, stub: report.stub, tier: report.tier, period }
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
  /** True when MAX per tick was reached: the rest are visited by the next tick. */
  capped: boolean
  /** The ids whose report was INSERTED this tick and is not a stub (the caller enqueues their email, O2.8). */
  insertedBusinessIds: string[]
}

export interface TickDeps extends Partial<GenerateDeps> {
  listBusinessIds?: (afterId: string | null, limit: number) => Promise<string[]>
  capture?: (error: unknown, context: { businessId: string }) => void
  maxPerTick?: number
}

// One failing business NEVER fails the tick: it is captured (Sentry) and the loop continues with the next business.
export async function runReportTick(now: string = formatISO(new Date()), deps: TickDeps = {}): Promise<ReportTickSummary> {
  const { listBusinessIds = listBusinessIdsPage, capture = (error, context) => Sentry.captureException(error, { tags: { worker: 'generate-reports' }, extra: context }), maxPerTick = REPORT_MAX_PER_TICK, ...generateDeps } = deps
  const summary: ReportTickSummary = { scanned: 0, notDue: 0, ineligible: 0, exists: 0, inserted: 0, stubs: 0, raced: 0, errors: 0, capped: false, insertedBusinessIds: [] }
  let attempts = 0
  let cursor: string | null = null

  scan: while (summary.scanned < REPORT_SCAN_CAP) {
    const ids = await listBusinessIds(cursor, REPORT_SCAN_PAGE)
    if (ids.length === 0) break
    for (const businessId of ids) {
      cursor = businessId
      if (attempts >= maxPerTick) {
        summary.capped = true
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
            break
          case 'generated':
            attempts += 1
            if (outcome.inserted) {
              summary.inserted += 1
              if (outcome.stub) summary.stubs += 1
              else summary.insertedBusinessIds.push(businessId)
            } else summary.raced += 1
            break
        }
      } catch (error) {
        summary.errors += 1
        attempts += 1
        capture(error, { businessId })
      }
    }
    if (ids.length < REPORT_SCAN_PAGE) break
  }
  return summary
}
