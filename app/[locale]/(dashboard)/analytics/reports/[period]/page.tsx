import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { z } from 'zod'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getReportByPeriod } from '@/lib/db/analytics-reports'
import { hasAdvancedAnalytics } from '@/lib/stripe/plan'
import { REPORT_SCHEMA_VERSION } from '@/lib/reports/constants'
import type { ReportPayload } from '@/lib/reports/assemble'
import { ReportBody } from '@/components/analytics/ReportBody'
import type { T } from '@/components/analytics/shared'

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

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 print:max-w-none print:px-0 print:py-0">
      <Link href={'/' + locale + '/analytics/reports'} className="text-sm font-medium underline underline-offset-2 print:hidden">
        {t('analytics.report.back')}
      </Link>
      <ReportBody t={t} locale={locale} timezone={business.timezone} payload={payload} proAllowed={hasAdvancedAnalytics(business.plan)} />
    </div>
  )
}
