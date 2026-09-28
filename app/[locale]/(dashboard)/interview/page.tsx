import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getMemberForUser } from '@/lib/db/business-members'
import { resolveMemberContext } from '@/lib/members/capabilities'
import { loadInterviewPageState } from '@/lib/interview/load-page-state'
import { InterviewPanel } from './InterviewPanel'

// ADR 0029 §8.1 (Session 35 M2.10) — the founder interview's own page. Server Component: it computes ONE
// InterviewPageState (loadInterviewPageState) and hands it to the Client Component that renders it.
// isRatifier mirrors the ADR §2.5/§8.5 predicate (role === 'approver' OR is_admin) — the SAME predicate
// ratify_interview_round enforces server-side; this is UX only (L-3), never the boundary.
export default async function InterviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const business = await getBusinessForUser(client, user.id)
  if (!business) redirect(`/${locale}/onboarding`)

  const member = resolveMemberContext(business, user.id, business.owner_id === user.id ? null : await getMemberForUser(client, business.id, user.id))
  const isRatifier = member.role === 'approver' || member.isAdmin

  const state = await loadInterviewPageState(client, business, isRatifier)

  return (
    <div className="py-8 px-4 sm:px-6">
      <InterviewPanel state={state} locale={locale} />
    </div>
  )
}
