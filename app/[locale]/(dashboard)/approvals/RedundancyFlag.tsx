'use client'

import { useTranslations } from 'next-intl'
import type { PersistedRedundancy } from '@/lib/db/types'

// ADR 0027 §5.8(b) (Session 34-D D9, MAJOR-5) — MODE2-REDUNDANCY-UNDEFER half (b): a post that repeats another post
// of the same campaign is FLAGGED AT THE APPROVAL GATE. "Never blocked, never edited."
//
// It sits beside ClaimFlags in the same idiom: quiet text inside the row's own card, hairlines not nested boxes, no
// tick and no colour-only signal. It says WHICH other post the reviewer's post repeats (its position in the
// campaign's plan) and HOW MUCH of the wording overlaps, and that this is a structural word-overlap comparison, not
// a judgment. It is not a control: Approve stays enabled, the post is not hidden or reordered, and nothing here
// touches the text. Every number is derived from the persisted flag; no text of either post is rendered.
//
// `redundancy` is undefined for an unflagged post AND for a post whose text was edited or regenerated since the flag
// was computed (listRedundancyByPostIds drops a flag whose fingerprint no longer matches) — both render nothing.
//
// SHARED-FUNCTION CALLERS: RedundancyFlag has ONE caller, ApprovalsInbox.tsx's DraftRow (RedundancyFlag.test.tsx and
// ApprovalsInbox.test.tsx, describe "redundancy flags in DraftRow").

export function RedundancyFlag({ redundancy }: { redundancy: PersistedRedundancy | undefined }) {
  const t = useTranslations('agency.redundancy')
  if (!redundancy || redundancy.overlaps.length === 0) return null

  return (
    <section aria-label={t('heading')} className="mt-3 space-y-1 text-xs">
      <p className="font-medium">{t('heading')}</p>
      <ul className="space-y-1">
        {redundancy.overlaps.map((o) => (
          <li key={o.postId}>{t('overlap', { position: o.order + 1, percent: Math.round(o.overlap * 100) })}</li>
        ))}
      </ul>
      <p className="text-muted-foreground">{t('explainer')}</p>
    </section>
  )
}
