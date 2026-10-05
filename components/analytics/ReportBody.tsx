import Link from 'next/link'
import { dateLabel, monthLabel } from '@/lib/analytics/format'
import type { BasicPlatformSection, Section as Loaded } from '@/lib/analytics/load'
import { REPORT_KEYS } from '@/lib/reports/constants'
import type { ReportPayload } from '@/lib/reports/assemble'
import { ActivitySection, BreakdownBlock, CampaignsSection, PatternsSection, PlatformResults, TrendSection } from './PortfolioView'
import { FOCUS, GatedSection, ResultBadge, Section, StateNote, type T } from './shared'

// ADR 0031 §5.3, §10.5 — ONE report, as the immutable stored payload says it. A synchronous Server Component: the page and
// (O2.9) the PDF route render this same component with the same print rules, so the two can never disagree. Every figure
// is a key and params the assembler stored; the only words written here are looked up through `t`.
//
//   * A stored report keeps every section it was generated with. Its Pro sections RENDER only while the CURRENT plan allows
//     them (ruling A-5): `proAllowed` is the live gate, never the payload's own tier. A downgraded business sees the plain
//     "Available on Pro" line where the section was; a re-upgrade brings it back.
//   * A report generated on a basic plan has no Pro section in its payload at all. On a Pro plan that is said plainly
//     ("generated before your plan included this section"): the numbers are never recomputed or back-filled.
//   * Print: no actions, page breaks before the trend (8) and the methodology (11), charts and tables kept whole.

const PRO_SECTIONS = [
  { id: 'trend', section: 'trend' },
  { id: 'breakdowns', section: 'breakdowns' },
  { id: 'patterns', section: 'patterns' },
] as const

// The report reads as a document: generous vertical rhythm, a hairline above each section (the page and the PDF carry the same
// classes), section headings one step larger than on the live pages, and a heading never stranded at the foot of a printed page.
// Scoped to this article with arbitrary variants, so the live pages that share the section components are untouched.
const ARTICLE = 'space-y-12 print:space-y-8 [&_section]:border-t [&_section]:border-border [&_section]:pt-8 [&_h2]:text-xl print:[&_h2]:break-after-avoid print:[&_h3]:break-after-avoid print:[&_h4]:break-after-avoid print:[&_tr]:break-inside-avoid print:[&_svg]:break-inside-avoid'

const ok = <V,>(data: V): Loaded<V> => ({ status: 'ok', data })

export interface ReportBodyProps {
  t: T
  locale: string
  timezone: string
  payload: ReportPayload
  /** The CURRENT plan's gate (hasAdvancedAnalytics): the A-5 ruling renders Pro sections only while it is true. */
  proAllowed: boolean
  /**
   * The PDF's static render (ADR 0031 V.14): no link and no client-boundary component is invoked, because a route handler
   * cannot invoke one under react-dom/server. Links become plain text (a forwarded document has nothing to navigate to).
   * Default false: the page renders exactly as before.
   */
  plain?: boolean
}

function Methodology({ t, keys }: { t: T; keys: readonly string[] }) {
  return (
    <div className="space-y-3 print:break-before-page">
      <Section id="methodology" title={t('analytics.report.section.methodology')}>
        <ul className="max-w-prose space-y-2 text-sm leading-relaxed text-muted-foreground">
          {keys.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

function RatedPosts({ t, locale, payload, plain }: { t: T; locale: string; payload: ReportPayload; plain: boolean }) {
  const rated = payload.ratedPosts
  if (!rated || rated.state !== 'shown') return null
  return (
    <Section id="rated" title={t(rated.titleKey)}>
      <StateNote>{t(rated.caveatKey)}</StateNote>
      {rated.byPlatform.map((p) => (
        <div key={p.platform} className="space-y-2 break-inside-avoid">
          <h3 className="text-base font-semibold">{t('analytics.platform.' + p.platform)}</h3>
          <ol className="space-y-1 text-sm">
            {p.posts.map((post, i) => (
              <li key={post.postId} className="flex flex-wrap items-center gap-2">
                <span>{t('analytics.report.ratedPosts.row', { position: i + 1, rate: post.rate })}</span>
                <ResultBadge t={t} badge={post.badge} />
              </li>
            ))}
          </ol>
          {!plain && (
            <Link
              href={'/' + locale + '/analytics/posts?month=' + payload.period + '&platform=' + p.platform}
              className={'text-sm font-medium underline underline-offset-2 print:hidden ' + FOCUS}
            >
              {t('analytics.postsLink')}
            </Link>
          )}
        </div>
      ))}
    </Section>
  )
}

function ProSections({ t, locale, payload, proAllowed, plain = false }: ReportBodyProps) {
  if (!proAllowed) {
    return (
      <>
        {PRO_SECTIONS.map((g) => (
          <GatedSection key={g.id} t={t} locale={locale} id={g.id} titleKey={'analytics.section.' + g.section} lineKey={'analytics.gated.line.' + g.section} plain={plain} />
        ))}
      </>
    )
  }
  return (
    <>
      {payload.trend ? (
        <div className="print:break-before-page">
          <TrendSection t={t} locale={locale} trend={ok(payload.trend)} />
        </div>
      ) : (
        <Section id="trend" title={t('analytics.section.trend')}>
          <StateNote>{t('analytics.report.notInReport')}</StateNote>
        </Section>
      )}
      {payload.observed ? (
        <Section id="breakdowns" title={t('analytics.section.breakdowns')}>
          {payload.observed.map((o) =>
            o.breakdowns.length > 0 ? (
              <div key={o.platform} className="space-y-4">
                <h3 className="text-base font-semibold">{t('analytics.platform.' + o.platform)}</h3>
                {o.breakdowns.map((b) => (
                  <BreakdownBlock key={b.dimension} t={t} platform={o.platform} view={b} />
                ))}
              </div>
            ) : null,
          )}
        </Section>
      ) : (
        <Section id="breakdowns" title={t('analytics.section.breakdowns')}>
          <StateNote>{t('analytics.report.notInReport')}</StateNote>
        </Section>
      )}
      {payload.patterns ? (
        <PatternsSection t={t} patterns={ok(payload.patterns)} />
      ) : (
        <Section id="patterns" title={t('analytics.section.patterns')}>
          <StateNote>{t('analytics.report.notInReport')}</StateNote>
        </Section>
      )}
    </>
  )
}

export function ReportBody(props: ReportBodyProps) {
  const { t, locale, timezone, payload, plain = false } = props
  const month = monthLabel(payload.period, locale)
  const header = t(payload.header.key, {
    business: payload.header.params.business,
    month,
    measuredAsOf: dateLabel(payload.header.params.measuredAsOf, locale, timezone),
    generatedOn: dateLabel(payload.header.params.generatedOn, locale, timezone),
  })

  // §5.6: a month with nothing published is a stub: the sentence and the methodology, no empty tables.
  if (payload.stub) {
    return (
      <article className={ARTICLE}>
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{month}</h1>
          <p className="max-w-prose wrap-anywhere text-sm text-muted-foreground">{header}</p>
        </header>
        <Section id="summary" title={t('analytics.report.section.summary')}>
          <p className="text-sm text-foreground">{t(REPORT_KEYS.stub, { month })}</p>
        </Section>
        <Methodology t={t} keys={payload.methodology.keys} />
      </article>
    )
  }

  return (
    <article className={ARTICLE}>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{month}</h1>
        <p className="max-w-prose wrap-anywhere text-sm text-muted-foreground">{header}</p>
      </header>

      <Section id="summary" title={t('analytics.report.section.summary')}>
        <ul className="max-w-prose space-y-2 text-base leading-relaxed">
          {payload.summary.map((line, i) => (
            <li key={line.key + i}>{t(line.key, line.params)}</li>
          ))}
        </ul>
      </Section>

      {payload.activity && <ActivitySection t={t} activity={ok(payload.activity)} />}

      <Section id="results" title={t('analytics.section.results')}>
        {(payload.xResults ?? []).map((r) => (
          <PlatformResults key={r.platform} t={t} locale={locale} timezone={timezone} section={r satisfies BasicPlatformSection} />
        ))}
        {payload.lateOutcomes && (
          <StateNote>{t(payload.lateOutcomes.key, { date: dateLabel(payload.lateOutcomes.params.date, locale, timezone) })}</StateNote>
        )}
      </Section>

      <RatedPosts t={t} locale={locale} payload={payload} plain={plain} />

      {payload.unavailable && payload.unavailable.length > 0 && (
        <Section id="unavailable" title={t('analytics.report.section.unavailable')}>
          {payload.unavailable.map((u) => (
            <PlatformResults key={u.platform} t={t} locale={locale} timezone={timezone} section={{ platform: u.platform, state: 'unavailable', published: u.published }} />
          ))}
        </Section>
      )}

      {payload.campaigns && <CampaignsSection t={t} rows={ok(payload.campaigns)} plain={plain} />}

      <ProSections {...props} />

      <Methodology t={t} keys={payload.methodology.keys} />
    </article>
  )
}
