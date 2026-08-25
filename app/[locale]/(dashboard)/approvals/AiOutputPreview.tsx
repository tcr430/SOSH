'use client'

// ADR 0022 §10 (Session 29, F1b.9) — carousel and script/image previews in
// the approvals surface. Kept as its own small component (not inlined into
// DraftRow) so lib/ai/prompts/formats/script-never-published.test.ts's
// ALLOWED_FILES allowlist (§7.2) stays a one-line addition naming exactly the
// file that references scriptBrief, rather than the whole ApprovalsInbox.

import { useTranslations } from 'next-intl'
import { NativeOutputSchema } from '@/lib/ai/prompts/formats/schemas'
import type { PostAiOriginalRow } from '@/lib/db/types'

interface AiOutputPreviewProps {
  original: PostAiOriginalRow | undefined
}

export function AiOutputPreview({ original }: AiOutputPreviewProps) {
  const t = useTranslations('approvals')
  if (!original) return null

  // Structural validation, not a downstream string check (mirrors
  // CAROUSEL-SCHEMA-STRUCTURAL) — a malformed/legacy payload silently renders
  // nothing rather than crashing the approvals list.
  const parsed = NativeOutputSchema.safeParse(original.payload)
  if (!parsed.success) return null
  const output = parsed.data

  const imageBrief = output.imageBrief
  const scriptBrief = output.scriptBrief
  const isCarousel = output.format === 'carousel'

  if (!isCarousel && !imageBrief && !scriptBrief) return null

  return (
    <div className="mt-3 space-y-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
      {isCarousel && (
        <div>
          <p className="font-medium text-foreground">{t('row.carousel.heading')}</p>
          <ol className="mt-1 space-y-1.5">
            {output.slides.map((slide, i) => (
              <li key={i} className="flex flex-col gap-1">
                <div className="flex items-start gap-2">
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-medium uppercase tracking-wide text-muted-foreground">
                    {t(`row.carousel.slideRole.${slide.role}`)}
                  </span>
                  <span className="text-foreground">{slide.text}</span>
                </div>
                {/* Session 29-D, D9 (NIT-5) — §6.1's per-slide imageBrief,
                    rendered alongside role/text with the SAME "recommendation,
                    never published" framing §7.3 already establishes for the
                    branch-level imageBrief/scriptBrief blocks below. */}
                {slide.imageBrief && (
                  <div
                    role="note"
                    aria-label={`${t('row.carousel.slideImageBrief.heading')} — ${t('row.carousel.slideImageBrief.neverPublishedNote')}`}
                    className="pl-1 text-muted-foreground"
                  >
                    <p className="font-medium text-foreground">{t('row.carousel.slideImageBrief.heading')}</p>
                    <p>{slide.imageBrief}</p>
                    <p className="italic">{t('row.carousel.slideImageBrief.neverPublishedNote')}</p>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {imageBrief && (
        <div role="note" aria-label={`${t('row.imageBrief.heading')} — ${t('row.imageBrief.neverPublishedNote')}`}>
          <p className="font-medium text-foreground">{t('row.imageBrief.heading')}</p>
          <p className="text-muted-foreground">{imageBrief}</p>
          <p className="italic text-muted-foreground">{t('row.imageBrief.neverPublishedNote')}</p>
        </div>
      )}

      {scriptBrief && (
        <div role="note" aria-label={`${t('row.scriptBrief.heading')} — ${t('row.scriptBrief.neverPublishedNote')}`}>
          <p className="font-medium text-foreground">{t('row.scriptBrief.heading')}</p>
          <p className="text-muted-foreground">{scriptBrief}</p>
          <p className="italic text-muted-foreground">{t('row.scriptBrief.neverPublishedNote')}</p>
        </div>
      )}
    </div>
  )
}
