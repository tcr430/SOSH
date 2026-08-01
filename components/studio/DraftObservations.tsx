import { useTranslations } from 'next-intl'
import type { DraftObservation } from '@/lib/ai/prompts/studio-suggestion'

// ADR 0019 §7.2/§11.2(9) — redundancy/platformNativeness are properties of
// the WHOLE draft, never a span, and are therefore visually distinct from
// the suggestion list AND never acceptable: no accept control anywhere in
// this component. A dashed border and amber tint (rather than the
// suggestion cards' solid border) is the non-colour-only distinction's
// visual half; the surrounding heading and the absence of an accept button
// are the structural half.

interface DraftObservationsProps {
  observations: readonly DraftObservation[]
}

export function DraftObservations({ observations }: DraftObservationsProps) {
  const t = useTranslations('studio.editor')
  if (observations.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('observations.heading')}</h3>
      {observations.map((observation) => (
        <p
          key={observation.category}
          className="rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 p-3 text-sm leading-relaxed"
        >
          <span className="font-medium">{t(`observations.${observation.category}`)}:</span> {observation.note}
        </p>
      ))}
    </div>
  )
}
