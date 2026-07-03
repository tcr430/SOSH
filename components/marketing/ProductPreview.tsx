import { getTranslations } from 'next-intl/server'
import { Check, Pencil, X } from 'lucide-react'
import { Section, StaggerItem } from '@/components/marketing/Section'

const DRAFTS = ['linkedin', 'x'] as const

type DraftPlatform = (typeof DRAFTS)[number]

const PLATFORM_LABEL: Record<DraftPlatform, string> = {
  linkedin: 'LinkedIn',
  x: 'X',
}

const PLATFORM_ACCENT: Record<DraftPlatform, string> = {
  linkedin: '#0A66C2',
  x: '#000000',
}

/**
 * Product Preview — a real approval-flow layout (platform badge, draft
 * content, approve/edit/skip row) rendered with sample copy, not a fake
 * div screenshot. Placed right after the Hero so the typography-led opener
 * is followed by one concrete look at the thing being described.
 */
export default async function ProductPreview() {
  const t = await getTranslations('marketing.preview')

  return (
    <Section className="scroll-mt-16">
      <div className="mx-auto max-w-5xl px-6 pb-20 sm:pb-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            {t('heading')}
          </h2>
          <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
            {t('subhead')}
          </p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {DRAFTS.map((platform, i) => (
            <StaggerItem key={platform} index={i}>
              <div className="glass-shell h-full">
                <div
                  className="glass-core h-full p-5"
                  style={{ borderLeft: `3px solid ${PLATFORM_ACCENT[platform]}` }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{PLATFORM_LABEL[platform]}</span>
                    <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {t('draftBadge')}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {t(`${platform}_content`)}
                  </p>
                  <div
                    aria-hidden="true"
                    className="mt-4 flex items-center gap-4 border-t border-border/70 pt-3 text-xs font-medium text-muted-foreground"
                  >
                    <span className="flex items-center gap-1.5">
                      <Check strokeWidth={2} className="size-3.5" />
                      {t('actionApprove')}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Pencil strokeWidth={2} className="size-3.5" />
                      {t('actionEdit')}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <X strokeWidth={2} className="size-3.5" />
                      {t('actionSkip')}
                    </span>
                  </div>
                </div>
              </div>
            </StaggerItem>
          ))}
        </div>
      </div>
    </Section>
  )
}
