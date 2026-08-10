import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getMemberForUser } from '@/lib/db/business-members'
import { hasCapability, resolveMemberContext, CAPABILITIES } from '@/lib/members/capabilities'
import { listPendingCardsForBusiness, listExpiredCardsForBusiness } from '@/lib/db/insight-cards'
import { hasTriageFailedCandidates } from '@/lib/db/signal-candidates'
import { isTriageBudgetCapped } from '@/lib/db/signal-triage-budget'
import { getGithubConnectionByBusinessId } from '@/lib/db/github-connections'
import { config } from '@/lib/config'
import { OpportunityFeed } from './OpportunityFeed'

// ADR 0021 §5.1/§5.2/§9 — Server Component: auth, business lookup, the
// capability gate, and every bounded read the ten §9.2 states need. NO
// client-side data fetching — OpportunityFeed only owns interaction
// (approvals/page.tsx precedent).
export default async function OpportunitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ expired?: string }>
}) {
  const { locale } = await params
  const { expired: expiredParam } = await searchParams
  const showExpired = expiredParam === '1'

  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const business = await getBusinessForUser(client, user.id)
  if (!business) redirect(`/${locale}/onboarding`)

  const memberRow =
    business.owner_id === user.id ? null : await getMemberForUser(client, business.id, user.id)
  const member = resolveMemberContext(business, user.id, memberRow)

  // §5.8 — CAPABILITIES.AUTHOR || isAdmin, mirroring the approvals gate
  // shape (approvals/page.tsx:56).
  const canTriage = hasCapability(member, CAPABILITIES.AUTHOR) || member.isAdmin
  if (!canTriage) redirect(`/${locale}/campaigns`)

  const [connection, cards, expiredCards, hasFailed, isPaused] = await Promise.all([
    getGithubConnectionByBusinessId(client, business.id),
    listPendingCardsForBusiness(client, business.id),
    showExpired ? listExpiredCardsForBusiness(client, business.id) : Promise.resolve([]),
    hasTriageFailedCandidates(client, business.id),
    isTriageBudgetCapped(business.id, config.server.TRIAGE_DAILY_CAP_CENTS),
  ])

  return (
    <OpportunityFeed
      locale={locale}
      hasConnection={connection !== null}
      cards={cards}
      expiredCards={expiredCards}
      showExpired={showExpired}
      hasTriageFailures={hasFailed}
      isTriagePaused={isPaused}
    />
  )
}
