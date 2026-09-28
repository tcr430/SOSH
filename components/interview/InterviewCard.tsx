import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadInterviewPageState } from '@/lib/interview/load-page-state'
import { canAuthorInterview, canRatifyInterview, isInterviewCardState } from '@/lib/interview/page-state'
import type { MemberCapabilityContext } from '@/lib/members/capabilities'

// ADR 0029 §8.1/§5.5 (Session 35 M2.10) — the dashboard card: due / open / awaiting ratification, hidden while
// snoozed or when nothing is due/in progress (§5.8: overdue never escalates — the card just stays, it never
// gains urgency styling). A Server Component: it computes its own InterviewPageState via the SAME shared
// orchestrator the /interview page and the layout's nav badge use, and renders a compact summary linking there.
export async function InterviewCard({
  client,
  business,
  locale,
  member,
}: {
  client: SupabaseClient
  business: { id: string; interview_snoozed_until?: string | null }
  locale: string
  member: MemberCapabilityContext
}) {
  // §5.5 (D7, MINOR-2): each state is shown only to the roles whose RPCs would accept its action, so a viewer never sees a Start
  // link the RPC refuses and an editor is never invited to ratify. A member with neither role skips the load entirely.
  if (!canAuthorInterview(member) && !canRatifyInterview(member)) return null
  const state = await loadInterviewPageState(client, business, canRatifyInterview(member))
  if (!isInterviewCardState(state, member)) return null

  const t = await getTranslations('interview')
  const body =
    state.kind === 'due'
      ? t('ui.card.due')
      : state.kind === 'in_progress'
        ? t('ui.card.in_progress')
        : state.kind === 'extracting'
          ? t('ui.card.extracting')
          : state.kind === 'extraction_failed'
            ? t('ui.card.extraction_failed')
            : t('ui.card.awaiting_ratification')

  return (
    <div className="rounded-lg border p-4 flex items-center justify-between gap-4 mb-6" data-interview-card={state.kind}>
      <div>
        <h2 className="text-sm font-medium">{t('ui.card.title')}</h2>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      <Link href={`/${locale}/interview`} className={cn(buttonVariants({ size: 'sm' }))}>
        {t('ui.card.cta')}
      </Link>
    </div>
  )
}
