import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { StudioEditor } from '@/components/studio/StudioEditor'

// ADR 0019 §3.5/§11.4 — the NEW-draft entry point. A Server Component that
// only authenticates/authorizes, per CLAUDE.md's split; all interactivity
// lives in StudioEditor. No studio_drafts row exists yet and none is
// created here — the row is created on first explicit save or first
// suggest, both inside StudioEditor (§3.5).

type Props = {
  params: Promise<{ locale: string }>
}

export default async function StudioNewDraftPage({ params }: Props) {
  const { locale } = await params

  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const business = await getBusinessForUser(client, user.id)
  if (!business) redirect(`/${locale}/onboarding`)

  return <StudioEditor locale={locale} draftId={null} initialContent="" initialPlatform={null} />
}
