import { Step2Form } from './Step2Form'
import { BackfillVoiceReview } from './BackfillVoiceReview'
import { getBackfillRunForReviewAction } from '../step-4/backfill-actions'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getBrandVoice } from '@/lib/db/brand-voices'

// ADR 0025 §10.3 (Session 32 I2.14) — step-2 backfill mode: ?run=<id> loads
// the staged voice and renders the review surface instead of the website
// path. hasInferredContent / inferred_from_url are NOT used as a
// ratification signal (they can't distinguish inferred from ratified voice)
// — this branches on the presence of a VALID run belonging to the caller's
// own business, nothing else. With no run param (or an invalid one), this
// is byte-for-byte the existing website-inference path.
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
    if (run) {
      const client = await createClient()
      const {
        data: { user },
      } = await client.auth.getUser()
      const business = user ? await getBusinessForUser(client, user.id) : null
      const brandVoice = business ? await getBrandVoice(client, business.id) : null
      return (
        <BackfillVoiceReview
          locale={locale}
          run={run}
          existingWritingExamples={brandVoice?.writing_examples ?? []}
        />
      )
    }
  }

  return <Step2Form locale={locale} />
}
