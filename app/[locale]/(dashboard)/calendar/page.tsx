import { redirect } from 'next/navigation'
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { toUtcIso } from '@/lib/utils'
import { getBusinessForUser } from '@/lib/db/businesses'
import { listPostsForCalendar } from '@/lib/db/posts'
import { groupByCampaignDay } from '@/lib/calendar/group'
import { CalendarView } from './CalendarView'

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ month?: string }>
}

export async function generateMetadata() {
  const t = await getTranslations('calendar')
  return { title: t('page_title') }
}

export default async function CalendarPage({ params, searchParams }: Props) {
  const { locale } = await params
  const { month: monthParam } = await searchParams

  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const business = await getBusinessForUser(client, user.id)
  if (!business) redirect(`/${locale}/onboarding`)

  const tz = business.timezone

  // Default to current month in business timezone
  const defaultMonth = formatInTimeZone(new Date(), tz, 'yyyy-MM')
  const monthKey =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : defaultMonth
  const [year, month] = monthKey.split('-').map(Number)

  // Compute the 6×7 grid's first and last day keys (business-TZ calendar strings).
  // Day-of-week arithmetic uses noon UTC so the result is machine-TZ-independent.
  const firstDayKey = `${year}-${String(month).padStart(2, '0')}-01`
  const firstDow = new Date(`${firstDayKey}T12:00:00Z`).getUTCDay()  // 0=Sun
  const daysSinceMonday = (firstDow + 6) % 7
  const gridStartMs = Date.UTC(year, month - 1, 1 - daysSinceMonday)
  const gridStartKey = toUtcIso(new Date(gridStartMs)).split('T')[0]
  const gridEndKey = toUtcIso(new Date(gridStartMs + 42 * 86_400_000)).split('T')[0]

  // Convert business-TZ day keys to UTC instants for the DB range query (R3).
  const rangeStartUtc = toUtcIso(fromZonedTime(`${gridStartKey} 00:00:00`, tz))
  const rangeEndUtc = toUtcIso(fromZonedTime(`${gridEndKey} 00:00:00`, tz))

  const { rows, overflow } = await listPostsForCalendar(client, {
    businessId: business.id,
    rangeStartUtc,
    rangeEndUtc,
  })

  const cells = groupByCampaignDay(rows, tz)

  return (
    <div className="flex flex-col h-full -m-6">
      <CalendarView
        initialMonth={monthKey}
        cells={cells}
        rows={rows}
        tz={tz}
        overflow={overflow}
        locale={locale}
      />
    </div>
  )
}
