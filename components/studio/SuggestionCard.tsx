'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { MemoryCitation } from './MemoryCitation'
import type { StudioSuggestionDTO } from '@/lib/studio/verify'

// ADR 0019 §11.2(8)/§11.3 — each suggestion is a labelled region whose
// ACCESSIBLE NAME carries both category and attribution, so the
// memory-cited-vs-model-judgment trust distinction survives for a
// screen-reader user even though it's also shown visually (never
// colour-only, per §11.3). model_judgment suggestions are additionally
// marked with a visible textual badge (§11.2(8)) — an unmarked model guess
// spends the trust the feature exists to earn (L-11).

interface SuggestionCardProps {
  suggestion: StudioSuggestionDTO
  canAccept: boolean
  isPending: boolean
  onAccept: () => void
}

export function SuggestionCard({ suggestion, canAccept, isPending, onAccept }: SuggestionCardProps) {
  const t = useTranslations('studio.editor')

  const categoryLabel = t(`category.${suggestion.category}`)
  const attributionLabel =
    suggestion.attribution === 'memory' ? t('suggestion.attributionMemory') : t('suggestion.attributionModelJudgment')
  const accessibleName = `${categoryLabel} — ${attributionLabel}`

  return (
    <section
      aria-label={accessibleName}
      className="flex flex-col gap-2 rounded-md border border-border bg-card p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{categoryLabel}</span>
        {suggestion.attribution === 'model_judgment' && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {t('suggestion.modelJudgmentBadge')}
          </span>
        )}
      </div>

      <p className="text-sm leading-relaxed">{suggestion.rationale}</p>

      {suggestion.attribution === 'memory' && (
        <MemoryCitation
          source={suggestion.source}
          labels={{
            avoidWord: (word) => t('citation.avoidWord', { word }),
            performancePattern: (confidence, observationCount) =>
              t('citation.performancePattern', { confidence: Math.round(confidence * 100), count: observationCount }),
            evidence: t('citation.evidence'),
          }}
        />
      )}

      <div>
        <Button size="sm" disabled={!canAccept || isPending} onClick={onAccept}>
          {t('suggestion.accept')}
        </Button>
      </div>
    </section>
  )
}
