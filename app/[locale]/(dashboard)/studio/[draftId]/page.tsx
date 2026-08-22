import { redirect } from 'next/navigation'
import { addMinutes, isPast } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getStudioDraft } from '@/lib/db/studio-drafts'
import { StudioEditor } from '@/components/studio/StudioEditor'
import { config } from '@/lib/config'

// ADR 0019 §11.4 — the EXISTING-draft entry point, CLAUDE.md's Server/Client
// split: this Server Component fetches and authorizes only. getStudioDraft
// is already tenant-scoped (business_id filter + RLS, lib/db/studio-drafts.ts
// §12.5) — a draftId belonging to another business resolves to null here,
// same as a soft-deleted or nonexistent one, and all three redirect to the
// new-draft page rather than leaking existence via a distinct 404.

type Props = {
  params: Promise<{ locale: string; draftId: string }>
}

export default async function StudioDraftPage({ params }: Props) {
  const { locale, draftId } = await params

  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const business = await getBusinessForUser(client, user.id)
  if (!business) redirect(`/${locale}/onboarding`)

  const draft = await getStudioDraft(client, draftId, business.id)
  if (!draft) redirect(`/${locale}/studio`)

  // ADR 0022 §3.4/§10 (Session 29 F1b.5) — "reclaimable" needs
  // config.server.PROMOTE_CLAIM_STALE_MINUTES, a server-only constant, so
  // it is computed HERE, not re-derived client-side.
  const isClaimReclaimable =
    draft.promotion_claimed_at !== null &&
    draft.promoted_campaign_id === null &&
    isPast(addMinutes(new Date(draft.promotion_claimed_at), config.server.PROMOTE_CLAIM_STALE_MINUTES))

  return (
    <StudioEditor
      locale={locale}
      draftId={draft.id}
      initialContent={draft.content}
      initialPlatform={draft.platform}
      initialPromotedCampaignId={draft.promoted_campaign_id}
      isClaimReclaimable={isClaimReclaimable}
    />
  )
}
