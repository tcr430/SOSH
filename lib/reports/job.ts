import * as Sentry from '@sentry/nextjs'
import { formatISO } from 'date-fns'
import { deliverMonthlyReport, type DeliveredReport, type DeliveryResult } from './deliver'
import { runReportTick, type ReportTickSummary, type TickDeps } from './generate'

// ADR 0031 §5.2, §5.4, §9.3 — the hourly report job: generate what is due (runReportTick), then enqueue the email for the
// reports THAT TICK INSERTED and that are not stubs, and nothing else. A replayed tick, a lost race (another tick inserted
// first) and a stub month are not in `insertedReports`, so they cannot mail. One failing business never fails the job.
//
// Counts only: no business id, no member, no address and no text reaches the summary the route logs.

export type ReportJobSummary = Omit<ReportTickSummary, 'insertedBusinessIds' | 'insertedReports'> & {
  tick: string
  emails: { recipients: number; enqueued: number; deduped: number; suppressed: number; errors: number }
}

export interface ReportJobDeps {
  tick?: (now: string, deps?: TickDeps) => Promise<ReportTickSummary>
  deliver?: (report: DeliveredReport) => Promise<DeliveryResult>
  capture?: (error: unknown, context: { businessId: string }) => void
  tickDeps?: TickDeps
}

export async function runReportJob(now: string = formatISO(new Date()), deps: ReportJobDeps = {}): Promise<ReportJobSummary> {
  const {
    tick = runReportTick,
    deliver = deliverMonthlyReport,
    capture = (error, context) => Sentry.captureException(error, { tags: { worker: 'generate-reports', phase: 'deliver' }, extra: context }),
    tickDeps,
  } = deps

  return Sentry.withMonitor(
    'generate-reports',
    async () => {
      const { insertedBusinessIds, insertedReports, ...counts } = await tick(now, tickDeps)
      void insertedBusinessIds
      const emails = { recipients: 0, enqueued: 0, deduped: 0, suppressed: 0, errors: 0 }
      for (const report of insertedReports) {
        try {
          const result = await deliver(report)
          emails.recipients += result.recipients
          emails.enqueued += result.enqueued
          emails.deduped += result.deduped
          emails.suppressed += result.suppressed
          emails.errors += result.errors
        } catch (error) {
          emails.errors += 1
          capture(error, { businessId: report.businessId })
        }
      }
      return { ...counts, tick: now, emails }
    },
    {
      schedule: { type: 'crontab', value: '20 * * * *' },
      checkinMargin: 10,
      maxRuntime: 5,
      failureIssueThreshold: 2,
      recoveryThreshold: 1,
    },
  )
}
