import { Step2Form } from './Step2Form'
import { VoiceReviewHost } from './VoiceReviewHost'
import { getBackfillRunForReviewAction } from '../step-4/backfill-actions'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getBrandVoice } from '@/lib/db/brand-voices'

// ADR 0025 §10.3 (Session 32 I2.14, corrected Session 32-D D8 MAJOR-1,
// D9/A-7) — step-2 backfill mode: ?run=<id> loads the staged voice and
// renders the review surface (VoiceReviewHost, wrapping the SHARED
// VoiceEditor in "review" mode — never a second voice editor, ADR §0 note
// 1) instead of the website path — ONLY for a run that is 'ratified' with
// a still-actionable voice_status (pending/refused_cap/failed;
// 'applied'/'declined' are done, and VoiceReviewHost's own state branches
// handle showing that). A run that hasn't been ratified yet — or has no
// staged voice at all — falls through to the ordinary website-inference
// path (Step2Form), never a broken review surface for a role that isn't
// declared yet.
const REVIEWABLE_VOICE_STATUSES = new Set(['pending', 'refused_cap', 'failed'])

export default async function Step2Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ run?: string }>
}) {
  const { locale } = await params
  const { run: runId } = await searchParams

  if (runId) {
    const run = await getBackfillRunForReviewAction(runId)
    if (run && run.status === 'ratified' && run.voice_status != null && REVIEWABLE_VOICE_STATUSES.has(run.voice_status)) {
      const client = await createClient()
      const {
        data: { user },
      } = await client.auth.getUser()
      const business = user ? await getBusinessForUser(client, user.id) : null
      const brandVoice = business ? await getBrandVoice(client, business.id) : null
      return (
        <VoiceReviewHost
          locale={locale}
          run={run}
          existingWritingExamples={brandVoice?.writing_examples ?? []}
        />
      )
    }
  }

  return <Step2Form locale={locale} />
}
