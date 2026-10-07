import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { z } from 'zod'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getReportByPeriod } from '@/lib/db/analytics-reports'
import { hasAdvancedAnalytics } from '@/lib/stripe/plan'
import { REPORT_SCHEMA_VERSION } from '@/lib/reports/constants'
import { resolveReportLabels } from '@/lib/analytics/labels'
import type { ReportPayload } from '@/lib/reports/assemble'
import { ReportBody } from '@/components/analytics/ReportBody'
import { FOCUS, type T } from '@/components/analytics/shared'

// ADR 0031 §5.4, §9.1, §10.5 — one stored report. The business is the SERVER-SIDE active business (never a param); the
// period is Zod-validated and anything else is a 404; a period that belongs to another business is the same 404, because the
// read is keyed on (the session business, the period) and RLS plus `.eq('business_id')` return nothing for it.

type Props = { params: Promise<{ locale: string; period: string }> }

const PERIOD = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

export default async function ReportPage({ params }: Props) {
  const { locale, period: rawPeriod } = await params
  const parsed = PERIOD.safeParse(rawPeriod)
  if (!parsed.success) notFound()
  const period = parsed.data

  const translate = await getTranslations()
  const t: T = (key, values) => translate(key as never, values as never)

  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) redirect('/' + locale + '/login')
  const business = await getBusinessForUser(client, user.id)
  if (!business) redirect('/' + locale + '/onboarding')

  const row = await getReportByPeriod(client, business.id, period + '-01')
  // No report for this period in THIS business (including a period another business has), or a payload shape this build
  // does not read: not found. A report is never recomputed on view.
  if (!row || row.schema_version !== REPORT_SCHEMA_VERSION) notFound()
  const payload = row.payload as unknown as ReportPayload
  // The stored payload holds ids only (MINOR-7): names and labels resolve here, by (this business, ids), with the authenticated client.
  const labels = await resolveReportLabels(client, business.id, payload)

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 print:max-w-none print:px-0 print:py-0">
      {/* The page's actions (ADR 0031 §10.1), outside ReportBody so they are never in the PDF and never in print. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 print:hidden">
        <Link href={'/' + locale + '/analytics/reports'} className={'inline-block min-h-6 py-0.5 text-sm font-medium underline underline-offset-2 ' + FOCUS}>
          {t('analytics.report.back')}
        </Link>
        {/* A plain anchor, not Link: the target is a file, not a page, so no client-side navigation or prefetch. The report id is
            the row's own (loaded by the session business above), never a value from the URL. Print is the browser's own: the print
            stylesheet applies, and a button would need a third client island (the ADR allows two). */}
        <a href={'/api/analytics/reports/' + row.id + '/pdf'} download className={'inline-flex min-h-8 items-center rounded-md border bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 active:opacity-80 ' + FOCUS}>
          {t('analytics.report.actions.pdf')}
        </a>
      </div>
      <ReportBody t={t} locale={locale} timezone={business.timezone} payload={payload} proAllowed={hasAdvancedAnalytics(business.plan)} businessName={business.name} labels={labels} />
    </div>
  )
}
