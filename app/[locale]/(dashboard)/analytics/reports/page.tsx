import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { listReports } from '@/lib/db/analytics-reports'
import { monthLabel } from '@/lib/analytics/format'
import { ReportEmailForm } from '@/components/analytics/ReportEmailForm'
import { StateNote, type T } from '@/components/analytics/shared'
import { setReportEmailAction } from './actions'

// ADR 0031 §5.4, §10.1 — the monthly reports, newest first (at most 24). The business is the SERVER-SIDE active business.
// The email setting is the business OWNER's (ruling O-3): the owner gets the form, everyone else reads the current value.

type Props = { params: Promise<{ locale: string }> }

type Setting = 'admins' | 'all_members' | 'off'

export default async function ReportsPage({ params }: Props) {
  const { locale } = await params
  const translate = await getTranslations()
  const t: T = (key, values) => translate(key as never, values as never)

  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) redirect('/' + locale + '/login')
  const business = await getBusinessForUser(client, user.id)
  if (!business) redirect('/' + locale + '/onboarding')

  const reports = await listReports(client, business.id)
  const current = business.report_email ?? 'admins'
  const isOwner = business.owner_id === user.id
  const optionLabel = (value: Setting) => t('analytics.report.setting.option.' + value)

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('analytics.report.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('analytics.report.description')}</p>
        <Link href={'/' + locale + '/analytics'} className="text-sm font-medium underline underline-offset-2">
          {t('analytics.backLink')}
        </Link>
      </header>

      {isOwner ? (
        <ReportEmailForm
          action={setReportEmailAction}
          current={current}
          labels={{
            label: t('analytics.report.setting.label'),
            help: t('analytics.report.setting.help'),
            save: t('analytics.report.setting.save'),
            saved: t('analytics.report.setting.saved'),
            error: t('analytics.report.setting.error'),
            forbidden: t('analytics.report.setting.forbidden'),
            options: { admins: optionLabel('admins'), all_members: optionLabel('all_members'), off: optionLabel('off') },
          }}
        />
      ) : (
        <StateNote>{t('analytics.report.setting.current', { value: optionLabel(current) })}</StateNote>
      )}

      {reports.length === 0 ? (
        <StateNote>{t('analytics.report.list.empty')}</StateNote>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {reports.map((r) => {
            const period = r.period_month.slice(0, 7)
            const stub = (r.payload as { stub?: unknown }).stub === true
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <Link href={'/' + locale + '/analytics/reports/' + period} className="font-medium underline underline-offset-2">
                  {monthLabel(period, locale)}
                </Link>
                <span className="text-sm text-muted-foreground">{stub ? t('analytics.report.list.stub') : t('analytics.report.list.open')}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
