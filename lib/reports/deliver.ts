import * as Sentry from '@sentry/nextjs'
import { getTranslations } from 'next-intl/server'
import { config } from '@/lib/config'
import { getBusinessByIdForWorker } from '@/lib/db/businesses'
import { resolveReportRecipients } from '@/lib/db/business-members'
import { monthLabel } from '@/lib/analytics/format'
import { enqueueEmail } from '@/lib/email/enqueue'
import type { SummaryLine } from './assemble'

// ADR 0031 §5.4 — enqueue ONE business's monthly report email, to its members and nobody else. Called only for a report
// the generator INSERTED this tick and that is not a stub (a replayed tick, a lost race or a stub month never mails).
//
//   * The recipients come from resolveReportRecipients (service-role, one business, active members) and the address is
//     read off the member row it returned: never from the payload, an argument or a column that holds free text
//     (REPORT-MEMBERS-ONLY, scan #23). Status is re-resolved here, immediately before the enqueue.
//   * The email carries no figure of its own: its sentences are the stored summary lines, rendered through the report's
//     own closed templates in the business language.
//   * Dedupe token `report:{YYYY-MM}:{member id}` (the immutable member id, never the email), so a re-run, an overlapping
//     tick or a retry enqueues each member at most once. A member added after the run does not get that month's report.
//   * 'off' stops ONLY the email: resolveReportRecipients returns nobody, and the report was already stored.
//   * One failing member never stops the others.

export interface DeliveredReport {
  businessId: string
  /** `YYYY-MM`. */
  period: string
  summary: SummaryLine[]
}

export interface DeliveryResult {
  recipients: number
  enqueued: number
  deduped: number
  suppressed: number
  errors: number
}

/** The email shows at most this many of the report's summary sentences (the template schema bounds it the same). */
export const REPORT_EMAIL_MAX_LINES = 8

export async function deliverMonthlyReport(report: DeliveredReport): Promise<DeliveryResult> {
  const result: DeliveryResult = { recipients: 0, enqueued: 0, deduped: 0, suppressed: 0, errors: 0 }
  const business = await getBusinessByIdForWorker(report.businessId)
  const locale = business.language
  const members = await resolveReportRecipients(report.businessId, business.report_email ?? 'admins')
  if (members.length === 0) return result

  const t = await getTranslations({ locale })
  const summaryLines = report.summary
    .slice(0, REPORT_EMAIL_MAX_LINES)
    .map((line) => t(line.key as never, line.params as never))
  const props = {
    businessName: business.name,
    periodLabel: monthLabel(report.period, locale),
    summaryLines,
    reportUrl: `${config.server.APP_URL}/${locale}/analytics/reports/${report.period}`,
  }

  result.recipients = members.length
  for (const member of members) {
    try {
      const outcome = await enqueueEmail({
        business_id: report.businessId,
        kind: 'monthly-report',
        recipient: member.email,
        locale,
        props,
        dedupe_token: `report:${report.period}:${member.id}`,
      })
      if (outcome.outcome === 'enqueued') result.enqueued += 1
      else if (outcome.outcome === 'deduped') result.deduped += 1
      else result.suppressed += 1
    } catch (error) {
      result.errors += 1
      Sentry.captureException(error, { tags: { worker: 'generate-reports', phase: 'deliver' }, extra: { businessId: report.businessId } })
    }
  }
  return result
}
