'use client'

// ADR 0024 §8.3 (Session 31, H2.12) — the shared renderer for the four
// judgment states, used by BOTH ApprovalsInbox and PostCard (PostsClient) so
// the state->visual mapping exists in exactly one place. `t` is a caller-
// scoped translator (e.g. useTranslations('approvals.row.judgment') or
// useTranslations('posts.card.judgment')) — this component never hardcodes
// a namespace, since its two callers use different i18n trees.

import { useState } from 'react'
import { resolvePostJudgment } from '@/lib/posts/judgment'
import type { PostAiOriginalRow } from '@/lib/db/types'

const DIMENSION_KEYS = [
  'specificity',
  'originality',
  'evidenceSufficiency',
  'audienceRelevance',
  'platformNativeness',
  'brandVoiceAlignment',
  'openingStrength',
  'ctaFit',
  'unsupportedClaimsRisk',
  'redundancy',
] as const

interface PostJudgmentBadgeProps {
  original: PostAiOriginalRow | undefined
  t: (key: string, values?: Record<string, string | number>) => string
}

export function PostJudgmentBadge({ original, t }: PostJudgmentBadgeProps) {
  const [expanded, setExpanded] = useState(false)
  const judgment = resolvePostJudgment(original)
  if (judgment === null) return null

  // JUDGING FAILED — no badge (an absent badge must not read as a passing
  // one, §8.3), an explicit statement it was not scored.
  if (judgment.state === 'judging-failed') {
    return <p className="mt-1.5 text-xs text-muted-foreground">{t('unscored')}</p>
  }

  // ALL-BELOW-THRESHOLD — amber flag, excluded from bulk approve elsewhere.
  if (judgment.state === 'all-below-threshold') {
    return (
      <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
        <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
        {t('belowThreshold')}
      </p>
    )
  }

  // JUDGED-AND-PASSED — score badge, expandable to the ten-dimension breakdown.
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
        {t('passed', { overall: judgment.overall })}
        <span className="opacity-70">· {t('passedDetail', { count: judgment.candidateCount })}</span>
      </button>
      {expanded && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border bg-muted/30 p-3 text-xs">
          {DIMENSION_KEYS.map(key => (
            <div key={key} className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">{t(`dimension.${key}`)}</dt>
              <dd className="tabular-nums font-medium text-foreground">{judgment.dimensionScores[key].score}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
