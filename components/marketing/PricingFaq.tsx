import { getTranslations } from 'next-intl/server'

const FAQ_ITEMS = ['1', '2', '3', '4', '5', '6'] as const

/**
 * `/pricing` FAQ (ADR 0009 §6.13, L9 — lives on /pricing only).
 * Native <details>/<summary> per §13: keyboard-operable and announced by
 * default; chevron via CSS group-open rotation, no JS.
 */
export default async function PricingFaq() {
  const t = await getTranslations('marketing.faq')

  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      <h2 className="text-2xl font-bold tracking-tight">{t('heading')}</h2>
      <div className="mt-8 divide-y border-y">
        {FAQ_ITEMS.map((n) => (
          <details key={n} className="group py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
              {t(`q${n}`)}
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 6l4 4 4-4" />
              </svg>
            </summary>
            <p className="mt-3 pr-8 text-sm text-muted-foreground">{t(`a${n}`)}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
