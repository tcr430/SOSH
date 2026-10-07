import Link from 'next/link'
import { dateLabel, monthLabel } from '@/lib/analytics/format'
import type {
  AccountComparisonRow,
  Activity,
  AdvancedPlatformSection,
  AdvancedPortfolio,
  BasicPlatformSection,
  CampaignTableRow,
  Portfolio,
  RetroView,
  RetrospectiveListRow,
  Section as Loaded,
  TrendView,
  PatternObservation,
} from '@/lib/analytics/load'
import type { BreakdownView, MonthPairView, TypicalView, WinsView } from '@/lib/analytics/view-model'
import { PostsPerMonthChart, TrendStrip, WinShareBars } from './charts'
import { Disclosures, FOCUS, GatedSection, Section, SectionError, StateNote, TABLE, type T } from './shared'

// ADR 0031 §10.1 — the portfolio, in reading order: activity, results (or the platform's state), campaigns, then the Pro
// sections or their gated state. Synchronous Server Components: every figure arrives as a view model (keys and params),
// and the only words written here are looked up through `t`.

type PlatformSection = BasicPlatformSection | AdvancedPlatformSection

const platformName = (t: T, platform: string) => t('analytics.platform.' + platform)

function accountName(t: T, row: { label: string | null; labelKey: string | null }): string {
  return row.label ?? t(row.labelKey ?? 'analytics.account.unrecorded')
}

function TypicalLine({ t, view }: { t: T; view: TypicalView }) {
  if (view.state === 'thin') return <StateNote>{t(view.key, view.params)}</StateNote>
  const { n, rate, lo, hi } = view.params
  return <p className="text-sm text-foreground">{t(view.key, { n, rate, lo, hi })}</p>
}

function WinsLine({ t, view }: { t: T; view: WinsView }) {
  if (view.state === 'thin') return <StateNote>{t(view.key, view.params)}</StateNote>
  return (
    <div className="space-y-1">
      <p className="text-sm text-foreground">{t(view.key, view.params)}</p>
      <Disclosures t={t} keys={view.disclosureKeys} />
    </div>
  )
}

function PairLine({ t, locale, pair }: { t: T; locale: string; pair: MonthPairView }) {
  if (pair.state === 'suppressed') return <StateNote>{t(pair.key)}</StateNote>
  const [a, b] = pair.sides
  if (a.typical.state !== 'number' || b.typical.state !== 'number') return null
  return (
    <p className="text-sm text-foreground">
      {t('analytics.monthPair', {
        month: monthLabel(a.period, locale),
        rate: a.typical.params.rate,
        n: a.typical.params.n,
        month2: monthLabel(b.period, locale),
        rate2: b.typical.params.rate,
        n2: b.typical.params.n,
      })}
    </p>
  )
}

// ─── activity ──────────────────────────────────────────────────────────────────────────────────────────────

export function ActivitySection({ t, activity }: { t: T; activity: Loaded<Activity> }) {
  return (
    <Section id="activity" title={t('analytics.section.activity')}>
      {activity.status === 'error' ? (
        <SectionError t={t} />
      ) : (
        <>
          <p className="text-sm text-foreground">{t('analytics.activity.total', { count: activity.data.total, prev: activity.data.previousTotal })}</p>
          <ul className="space-y-1 text-sm">
            {activity.data.rows.map((r) => (
              <li key={r.platform + '|' + (r.accountId ?? '')} className="wrap-anywhere">
                {t('analytics.activity.line', { count: r.count, platform: platformName(t, r.platform), account: accountName(t, r) })}
              </li>
            ))}
          </ul>
          <StateNote>{t('analytics.activity.campaigns', activity.data.campaigns)}</StateNote>
        </>
      )}
    </Section>
  )
}

// ─── results, per platform ─────────────────────────────────────────────────────────────────────────────────

export function PlatformResults({ t, locale, timezone, section }: { t: T; locale: string; timezone: string; section: PlatformSection }) {
  const name = platformName(t, section.platform)
  return (
    <div className="space-y-2" data-platform={section.platform} data-state={section.state}>
      <h3 className="text-base font-semibold">{name}</h3>
      {section.state === 'unavailable' && <StateNote>{t('analytics.state.unavailable', { platform: name })}</StateNote>}
      {section.state === 'error' && <SectionError t={t} />}
      {section.state === 'immature' && (
        <StateNote>
          {t('analytics.state.immature', {
            count: section.current.exclusions.params.published,
            date: section.finalOn ? dateLabel(section.finalOn, locale, timezone) : '',
          })}
        </StateNote>
      )}
      {section.state === 'measured' && (
        <>
          {section.current.typical && <TypicalLine t={t} view={section.current.typical} />}
          {section.pair && <PairLine t={t} locale={locale} pair={section.pair} />}
          <WinsLine t={t} view={section.current.wins} />
          <p className="text-xs text-muted-foreground">
            {t(section.current.exclusions.key, section.current.exclusions.params)}
            {section.current.exclusions.reasons.length > 0 &&
              ' ' +
                t('analytics.exclusions.excluded', {
                  notIncluded: section.current.exclusions.params.notIncluded,
                  reasons: section.current.exclusions.reasons.map((r) => t(r.key, { count: r.count })).join(', '),
                })}
          </p>
          <Disclosures t={t} keys={['analytics.disclosure.engagementOnly', ...(section.current.basis === 'count' ? ['analytics.disclosure.linkedinCount'] : [])]} />
        </>
      )}
    </div>
  )
}

function ResultsSection({ t, locale, timezone, platforms }: { t: T; locale: string; timezone: string; platforms: Loaded<PlatformSection[]> }) {
  return (
    <Section id="results" title={t('analytics.section.results')}>
      {platforms.status === 'error' ? (
        <SectionError t={t} />
      ) : (
        platforms.data.map((s) => <PlatformResults key={s.platform} t={t} locale={locale} timezone={timezone} section={s} />)
      )}
    </Section>
  )
}

// ─── campaigns ─────────────────────────────────────────────────────────────────────────────────────────────

function RetroCell({ t, retro }: { t: T; retro: RetroView | null }) {
  if (!retro) return <span className="text-muted-foreground">{t('analytics.campaignTable.noVerdict')}</span>
  return (
    <span className="space-y-0.5">
      <span className="block">{t(retro.verdict.key, retro.verdict.params)}</span>
      {retro.beat && <span className="block text-muted-foreground">{t(retro.beat.key, retro.beat.params)}</span>}
    </span>
  )
}

function statusName(t: T, status: string | null): string {
  return status ? t('analytics.status.' + status) : '–'
}

export function CampaignsSection({ t, rows, plain = false }: { t: T; rows: Loaded<CampaignTableRow[]>; plain?: boolean }) {
  // No campaigns (a business that only posts by hand): no section, rather than a header with nothing under it.
  if (rows.status === 'ok' && rows.data.length === 0) return null
  return (
    <Section id="campaigns" title={t('analytics.section.campaigns')}>
      {rows.status === 'error' ? (
        <SectionError t={t} />
      ) : (
        <table className={TABLE.table}>
          <thead className={TABLE.head}>
            <tr className="border-b border-border">
              <th scope="col" className={TABLE.th}>{t('analytics.campaignTable.campaign')}</th>
              <th scope="col" className={TABLE.th + ' ' + TABLE.secondary}>{t('analytics.campaignTable.status')}</th>
              <th scope="col" className={TABLE.th + ' ' + TABLE.secondary}>{t('analytics.campaignTable.published')}</th>
              <th scope="col" className={TABLE.th}>{t('analytics.campaignTable.verdict')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.data.map((r) => (
              <tr key={r.campaignId} className={TABLE.row}>
                <td className={TABLE.cell} data-label={t('analytics.campaignTable.campaign')}>
                  <span>
                    {plain ? (
                      <span dir="auto" className="font-medium">{r.name ?? t('analytics.campaignTable.open')}</span>
                    ) : (
                      <Link href={r.href} dir="auto" className={'font-medium underline underline-offset-2 ' + FOCUS}>
                        {r.name ?? t('analytics.campaignTable.open')}
                      </Link>
                    )}
                    {/* At 640 the secondary columns sit behind a disclosure. */}
                    <details className="lg:hidden max-sm:hidden">
                      {/* min-h-6 (24 px): a text-xs summary alone is about 16 px tall, under the WCAG 2.5.8 target minimum. */}
                      <summary className={'inline-flex min-h-6 cursor-pointer items-center text-xs text-muted-foreground hover:text-foreground ' + FOCUS}>{t('analytics.posts.details')}</summary>
                      <span className="block text-xs">{statusName(t, r.status)} · {r.published}</span>
                    </details>
                  </span>
                </td>
                <td className={TABLE.cell + ' ' + TABLE.secondary} data-label={t('analytics.campaignTable.status')}>{statusName(t, r.status)}</td>
                <td className={TABLE.cell + ' ' + TABLE.secondary} data-label={t('analytics.campaignTable.published')}>{r.published}</td>
                <td className={TABLE.cell} data-label={t('analytics.campaignTable.verdict')}><RetroCell t={t} retro={r.retro} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  )
}

// ─── Pro ───────────────────────────────────────────────────────────────────────────────────────────────────

function roleLabel(t: T, value: string) {
  return t('outcome.role.' + value)
}

function valueLabelFor(t: T, dimension: string): (value: string) => string {
  if (dimension === 'role') return (v) => roleLabel(t, v)
  return (v) => t('analytics.value.' + dimension + '.' + v)
}

export function BreakdownBlock({ t, platform, view }: { t: T; platform: string; view: BreakdownView }) {
  // hook_type is shown only where a value reaches 10 and its opening survived: with no row there is nothing to show.
  if (view.dimension === 'hook_type' && view.rows.length === 0) return null
  const dimensionLabel = t('analytics.breakdown.dimension.' + view.dimension)
  const valueLabel = valueLabelFor(t, view.dimension)
  const id = 'breakdown-' + platform + '-' + view.dimension
  return (
    <div className="space-y-2" data-dimension={view.dimension}>
      <h4 className="text-sm font-semibold">
        {dimensionLabel} · {t(view.populationKey)}
      </h4>
      <StateNote>{t(view.coverage.key, view.coverage.params)}</StateNote>
      {view.presentation === 'bars' ? (
        <WinShareBars t={t} id={id} dimensionLabel={dimensionLabel} breakdown={view} valueLabel={valueLabel} />
      ) : view.rows.length === 0 && view.thinValues.length === 0 ? (
        <StateNote>{t('analytics.breakdown.none')}</StateNote>
      ) : (
        <ul className="space-y-1 text-sm">
          {view.rows.map((r) => (
            <li key={r.value}>
              {t(r.key, { value: valueLabel(r.value), ...r.params })} {r.provisional && <span className="text-xs text-muted-foreground">({t('analytics.breakdown.provisional')})</span>}
            </li>
          ))}
          {view.thinValues.map((value) => (
            <li key={value}>
              {valueLabel(value)}: {t('analytics.breakdown.thinValue')}
            </li>
          ))}
        </ul>
      )}
      {(view.rows.length > 0 || view.thinValues.length > 0) && <StateNote>{t('analytics.breakdown.describes')}</StateNote>}
      {view.dimension === 'hook_type' && <StateNote>{t('analytics.breakdown.hookNote')}</StateNote>}
    </div>
  )
}

export function TrendSection({ t, locale, trend }: { t: T; locale: string; trend: Loaded<TrendView> }) {
  return (
    <Section id="trend" title={t('analytics.section.trend')}>
      {trend.status === 'error' ? (
        <SectionError t={t} />
      ) : (
        <div className="space-y-6">
          <PostsPerMonthChart t={t} locale={locale} id="trend-posts" months={trend.data.months} />
          {trend.data.series.map((s) => (
            <TrendStrip key={s.platform} t={t} locale={locale} id={'trend-' + s.platform} platformName={platformName(t, s.platform)} points={s.points} />
          ))}
        </div>
      )}
    </Section>
  )
}

function BreakdownsSection({ t, platforms }: { t: T; platforms: Loaded<AdvancedPlatformSection[]> }) {
  return (
    <Section id="breakdowns" title={t('analytics.section.breakdowns')}>
      {platforms.status === 'error' ? (
        <SectionError t={t} />
      ) : (
        platforms.data.map((s) =>
          s.state === 'measured' && s.current.breakdowns.length > 0 ? (
            <div key={s.platform} className="space-y-4">
              <h3 className="text-base font-semibold">{platformName(t, s.platform)}</h3>
              {s.current.breakdowns.map((b) => (
                <BreakdownBlock key={b.dimension} t={t} platform={s.platform} view={b} />
              ))}
            </div>
          ) : null,
        )
      )}
    </Section>
  )
}

// A stored pattern is a CELL: the sentence is composed here, in the reader's locale, from closed analytics templates (one per direction x
// basis) and the subject keys the campaign page already translates. The evidence (wins of n, campaigns) is stated once, inside it.
function PatternLine({ t, cell }: { t: T; cell: PatternObservation }) {
  return (
    <>
      {t('analytics.pattern.' + cell.direction + (cell.basis === 'count' ? '_count' : ''), {
        platform: platformName(t, cell.platform),
        subject: t('outcome.observed.subject.' + cell.dimension + '.' + cell.value),
        wins: cell.wins,
        n: cell.n,
        campaigns: cell.campaigns,
      })}
    </>
  )
}

export function PatternsSection({ t, patterns }: { t: T; patterns: AdvancedPortfolio['patterns'] }) {
  return (
    <Section id="patterns" title={t('analytics.section.patterns')}>
      {patterns.status === 'error' ? (
        <SectionError t={t} />
      ) : patterns.data.length === 0 ? (
        // Reached only for a month that HAS posts (a month with none shows state.empty for the whole page), so "nothing published" would be
        // false here: this says what is true (A-8(a), MAJOR-1).
        <StateNote>{t('analytics.state.noPatternYet')}</StateNote>
      ) : (
        <ul className="space-y-2 text-sm">
          {patterns.data.map((p) => (
            <li key={[p.platform, p.dimension, p.value, p.direction].join(':')} className="wrap-anywhere">
              <PatternLine t={t} cell={p} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function RetrospectivesSection({ t, rows }: { t: T; rows: Loaded<RetrospectiveListRow[]> }) {
  return (
    <Section id="retrospectives" title={t('analytics.section.retrospectives')}>
      {rows.status === 'error' ? (
        <SectionError t={t} />
      ) : rows.data.length === 0 ? (
        <StateNote>{t('analytics.campaignTable.noVerdict')}</StateNote>
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.data.map((r) => (
            <li key={r.campaignId}>
              <Link href={r.href} className={'font-medium underline underline-offset-2 ' + FOCUS}>
                {r.campaignName ?? t('analytics.campaignTable.open')}
              </Link>{' '}
              <RetroCell t={t} retro={r} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function AccountsSection({ t, rows }: { t: T; rows: Loaded<AccountComparisonRow[]> }) {
  return (
    <Section id="accounts" title={t('analytics.section.accounts')}>
      {rows.status === 'error' ? (
        <SectionError t={t} />
      ) : (
        rows.data.length > 0 && (
          <table className={TABLE.table}>
            <thead className={TABLE.head}>
              <tr className="border-b border-border">
                <th scope="col" className={TABLE.th}>{t('analytics.posts.filters.account')}</th>
                <th scope="col" className={TABLE.th}>{t('analytics.section.results')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.data.map((r) => (
                <tr key={r.platform + '|' + (r.accountId ?? '')} className={TABLE.row}>
                  <td className={TABLE.cell} data-label={t('analytics.posts.filters.account')}>
                    {platformName(t, r.platform)} · {accountName(t, r)}
                  </td>
                  <td className={TABLE.cell} data-label={t('analytics.section.results')}>
                    <span className="space-y-0.5">
                      <TypicalLine t={t} view={r.typical} />
                      <WinsLine t={t} view={r.wins} />
                      {r.comparison === 'counts' && <StateNote>({t('analytics.breakdown.provisional')})</StateNote>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </Section>
  )
}

const GATED = [
  { id: 'trend', section: 'trend' },
  { id: 'breakdowns', section: 'breakdowns' },
  { id: 'patterns', section: 'patterns' },
  { id: 'retrospectives', section: 'retrospectives' },
  { id: 'accounts', section: 'accounts' },
] as const

export function PortfolioView({ t, locale, timezone, portfolio }: { t: T; locale: string; timezone: string; portfolio: Portfolio }) {
  const empty = portfolio.activity.status === 'ok' && portfolio.activity.data.total === 0
  if (empty) return <StateNote>{t('analytics.state.empty')}</StateNote>
  return (
    <div className="space-y-10">
      <ActivitySection t={t} activity={portfolio.activity} />
      <ResultsSection t={t} locale={locale} timezone={timezone} platforms={portfolio.platforms} />
      <CampaignsSection t={t} rows={portfolio.campaigns} />
      {portfolio.tier === 'advanced' ? (
        <>
          <TrendSection t={t} locale={locale} trend={portfolio.trend} />
          <BreakdownsSection t={t} platforms={portfolio.platforms as Loaded<AdvancedPlatformSection[]>} />
          <PatternsSection t={t} patterns={portfolio.patterns} />
          <RetrospectivesSection t={t} rows={portfolio.retrospectives} />
          <AccountsSection t={t} rows={portfolio.accounts} />
        </>
      ) : (
        GATED.map((g) => (
          <GatedSection key={g.id} t={t} locale={locale} id={g.id} titleKey={'analytics.section.' + g.section} lineKey={'analytics.gated.line.' + g.section} />
        ))
      )}
    </div>
  )
}
