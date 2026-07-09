import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { listMembers, countSeatUsage } from '@/lib/db/business-members'
import { evaluateSeatState } from '@/lib/members/seats'
import { CAPABILITIES } from '@/lib/members/capabilities'
import { SeatMeter } from './SeatMeter'
import { InviteMemberForm } from './InviteMemberForm'
import { MemberList } from './MemberList'

export default async function TeamSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('team')

  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const business = await getBusinessForUser(client, user.id)
  if (!business) redirect(`/${locale}/onboarding`)

  // ROLE-TEAM-ADMIN-GATED: whole surface is admin-only — a non-admin is
  // redirected, not shown a disabled page (B-6).
  const { data: canManageMembers } = await client.rpc('user_can', {
    p_business_id: business.id,
    p_capability: CAPABILITIES.MANAGE_MEMBERS,
  })
  if (!canManageMembers) redirect(`/${locale}/campaigns`)

  const [members, { activeCount, pendingCount }] = await Promise.all([
    listMembers(client, business.id),
    countSeatUsage(client, business.id),
  ])
  const seats = evaluateSeatState({ plan: business.plan, activeCount, pendingCount })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <SeatMeter seats={seats} />

      <InviteMemberForm disabled={seats.overage > 0 || seats.atCap} />

      <MemberList members={members} ownerId={business.owner_id} currentUserId={user.id} />
    </div>
  )
}
