import type { ReactNode } from 'react'
import Link from 'next/link'

// ADR 0031 §10 — the plainest correct version of the contract (the design pass is O2.10). Server Components: the
// translator arrives as a prop, so every component here is synchronous and renders to static markup under test.

export type T = (key: string, values?: Record<string, string | number>) => string

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id + '-title'} className="space-y-3">
      <h2 id={id + '-title'} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  )
}

export function StateNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

/** A section whose read hit the ceiling: the error state, never a number over part of the data. */
export function SectionError({ t }: { t: T }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {t('analytics.state.error')}
    </p>
  )
}

// Inline SVG with lucide's arrow-up, arrow-down and minus geometry. A component from a client-boundary package (lucide-react)
// cannot be invoked by the PDF route's static render (ADR 0031 V.14), and the report tree is ONE tree for the page and the PDF.
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 shrink-0">
      {children}
    </svg>
  )
}
const ArrowUp = () => (
  <Glyph>
    <path d="m5 12 7-7 7 7" />
    <path d="M12 19V5" />
  </Glyph>
)
const ArrowDown = () => (
  <Glyph>
    <path d="M12 5v14" />
    <path d="m19 12-7 7-7-7" />
  </Glyph>
)
const Minus = () => (
  <Glyph>
    <path d="M5 12h14" />
  </Glyph>
)

const BADGES = {
  above: { key: 'analytics.posts.badge.above', Icon: ArrowUp },
  below: { key: 'analytics.posts.badge.below', Icon: ArrowDown },
  no_baseline: { key: 'analytics.posts.badge.noBaseline', Icon: Minus },
} as const

/** Colour is never the sole carrier: every badge carries its text AND an icon. */
export function ResultBadge({ t, badge }: { t: T; badge: keyof typeof BADGES }) {
  const { key, Icon } = BADGES[badge]
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs font-medium text-foreground">
      <Icon />
      {t(key)}
    </span>
  )
}

/** "Available on Pro: {one line}" with a plain link to billing. No blur, no fake numbers, no modal (ADR 0031 §10.2). */
export function GatedSection({ t, locale, id, titleKey, lineKey, plain = false }: { t: T; locale: string; id: string; titleKey: string; lineKey: string; plain?: boolean }) {
  return (
    <Section id={id} title={t(titleKey)}>
      <p className="text-sm text-muted-foreground">
        {t('analytics.gated.prefix', { line: t(lineKey) })}
        {/* `plain` is the PDF's static render: a document has no billing page to link to, and Link cannot be invoked there. */}
        {!plain && (
          <>
            {' '}
            <Link href={'/' + locale + '/billing'} className={'font-medium text-foreground underline underline-offset-2 ' + FOCUS}>
              {t('analytics.gated.link')}
            </Link>
          </>
        )}
      </p>
    </Section>
  )
}

export function Disclosures({ t, keys }: { t: T; keys: readonly string[] }) {
  if (keys.length === 0) return null
  return (
    <ul className="space-y-1 text-xs text-muted-foreground">
      {keys.map((key) => (
        <li key={key}>{t(key)}</li>
      ))}
    </ul>
  )
}

export interface PickerOption {
  value: string
  label: string
}

/**
 * A full-contrast focus indicator for every control on these surfaces. The global base sets `outline-ring/50`, which is about
 * 1.5:1 on the page background: below the 3:1 minimum for a focus indicator (WCAG 1.4.11, 2.4.11). `outline-foreground` is the
 * body text colour in both themes.
 */
export const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground'
// max-w-full: a select sizes itself to its LONGEST option, and the options carry customer names (campaigns, accounts).
const SELECT = 'min-h-8 w-full max-w-full rounded-md border bg-background px-3 py-2 text-sm ' + FOCUS
// hover: only on a real hover device (Tailwind v4 gates it), active: an instant opacity change (no motion, so nothing to gate).
export const BUTTON = 'min-h-8 rounded-md border bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 active:opacity-80 ' + FOCUS

export function SelectField({ id, label, name, value, options }: { id: string; label: string; name: string; value: string; options: PickerOption[] }) {
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <select id={id} name={name} defaultValue={value} className={SELECT}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/** A native <select> in a GET form: it works without JavaScript (ADR 0031 §10.6). */
export function MonthPicker({ t, action, value, options }: { t: T; action: string; value: string; options: PickerOption[] }) {
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-3">
      <SelectField id="analytics-month" label={t('analytics.picker.label')} name="month" value={value} options={options} />
      <button type="submit" className={BUTTON}>
        {t('analytics.picker.submit')}
      </button>
    </form>
  )
}

/** The responsive table recipe: full at 1280, secondary columns behind a disclosure at 640, stacked labelled cards at 320. */
export const TABLE = {
  table: 'w-full text-left text-sm',
  head: 'max-sm:sr-only',
  row: 'border-b border-border max-sm:mb-2 max-sm:block max-sm:rounded-md max-sm:border max-sm:p-3',
  // min-w-0 + wrap-anywhere: a cell that holds a customer string (a 120-character campaign name, an unbreakable handle) may shrink
  // and break anywhere, so it can never push the table or the 320 px card wider than its container.
  cell: 'min-w-0 wrap-anywhere py-2 pr-4 align-top max-sm:flex max-sm:justify-between max-sm:gap-3 max-sm:py-1 max-sm:before:max-w-[45%] max-sm:before:shrink-0 max-sm:before:wrap-break-word max-sm:before:font-medium max-sm:before:text-muted-foreground max-sm:before:content-[attr(data-label)]',
  secondary: 'max-lg:hidden',
  th: 'py-2 pr-4 font-medium text-muted-foreground',
} as const
