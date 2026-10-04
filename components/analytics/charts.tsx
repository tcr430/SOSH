import { Group } from '@visx/group'
import { Bar } from '@visx/shape'
import { scaleBand, scaleLinear } from '@visx/scale'
import { monthLabel } from '@/lib/analytics/format'
import { formatRate } from '@/lib/analytics/rates'
import type { BreakdownView } from '@/lib/analytics/view-model'
import type { TrendView } from '@/lib/analytics/load'
import { TABLE, type T } from './shared'

// ADR 0031 §10.3 — the chart contract. Server Components built on @visx/scale, @visx/shape and @visx/group (no hooks, so
// they render in a Server Component and in the PDF's static render); the axes are plain SVG <text>.
//
//   * NO NUMBER EXISTS ONLY AS A SHAPE: every chart sits in a <figure> with a real <table> (visually hidden) and an
//     aria-describedby summary drawn from a closed template.
//   * Colour is never the sole carrier: every bar carries its printed value, and the badges carry text and an icon.
//   * A chart is not a focus trap: it is a role="img" with no focusable child.

const VIEW_W = 640
const MARGIN = { top: 20, right: 8, bottom: 26, left: 8 }

function Summary({ id, children }: { id: string; children: string }) {
  return (
    <p id={id + '-summary'} className="sr-only">
      {children}
    </p>
  )
}

// ─── posts published per month: vertical bars ──────────────────────────────────────────────────────────────────

export function PostsPerMonthChart({ t, locale, id, months }: { t: T; locale: string; id: string; months: TrendView['months'] }) {
  const innerW = VIEW_W - MARGIN.left - MARGIN.right
  const height = 200
  const innerH = height - MARGIN.top - MARGIN.bottom
  const x = scaleBand<string>({ domain: months.map((m) => m.period), range: [0, innerW], padding: 0.25 })
  const y = scaleLinear<number>({ domain: [0, Math.max(1, ...months.map((m) => m.published))], range: [innerH, 0] })
  const total = months.reduce((sum, m) => sum + m.published, 0)
  const title = t('analytics.chart.postsPerMonth.title')
  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      <svg viewBox={'0 0 ' + VIEW_W + ' ' + height} role="img" aria-label={title} aria-describedby={id + '-summary'} className="h-auto max-h-56 w-full">
        <Group left={MARGIN.left} top={MARGIN.top}>
          {months.map((m) => {
            const barH = innerH - y(m.published)
            const bx = x(m.period) ?? 0
            return (
              <Group key={m.period}>
                <Bar x={bx} y={y(m.published)} width={x.bandwidth()} height={barH} className="fill-primary" />
                <text x={bx + x.bandwidth() / 2} y={y(m.published) - 4} textAnchor="middle" fontSize={10} className="fill-foreground">
                  {m.published}
                </text>
                <text x={bx + x.bandwidth() / 2} y={innerH + 14} textAnchor="middle" fontSize={9} className="fill-muted-foreground">
                  {monthLabel(m.period, locale, 'short')}
                </text>
              </Group>
            )
          })}
        </Group>
      </svg>
      <Summary id={id}>
        {t('analytics.chart.postsPerMonth.summary', { total, first: monthLabel(months[0].period, locale), last: monthLabel(months[months.length - 1].period, locale) })}
      </Summary>
      <div className="sr-only">
      <table>
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{t('analytics.chart.postsPerMonth.col.month')}</th>
            <th scope="col">{t('analytics.chart.postsPerMonth.col.count')}</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.period}>
              <th scope="row">{monthLabel(m.period, locale)}</th>
              <td>{m.published}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  )
}

// ─── the typical rate over time: a strip of post dots per month with a median tick ─────────────────────────────

export function TrendStrip({
  t,
  locale,
  id,
  platformName,
  points,
}: {
  t: T
  locale: string
  id: string
  platformName: string
  points: TrendView['series'][number]['points']
}) {
  const innerW = VIEW_W - MARGIN.left - MARGIN.right
  const height = 220
  const innerH = height - MARGIN.top - MARGIN.bottom
  const top = Math.max(0.01, ...points.flatMap((p) => (p.stats ? [p.stats.hi, ...p.dots] : [])))
  const x = scaleBand<string>({ domain: points.map((p) => p.period), range: [0, innerW], padding: 0.25 })
  const y = scaleLinear<number>({ domain: [0, top], range: [innerH, 0] })
  const title = t('analytics.chart.trend.title')
  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-medium">
        {title} · {platformName}
      </figcaption>
      <svg viewBox={'0 0 ' + VIEW_W + ' ' + height} role="img" aria-label={title} aria-describedby={id + '-summary'} className="h-auto max-h-60 w-full">
        <Group left={MARGIN.left} top={MARGIN.top}>
          <line x1={0} x2={innerW} y1={innerH} y2={innerH} className="stroke-border" />
          <text x={0} y={-6} fontSize={9} className="fill-muted-foreground">
            {formatRate(top)}
          </text>
          {points.map((p) => {
            const cx = (x(p.period) ?? 0) + x.bandwidth() / 2
            return (
              <Group key={p.period}>
                {p.stats && (
                  <>
                    <line x1={cx} x2={cx} y1={y(p.stats.lo)} y2={y(p.stats.hi)} strokeWidth={1} className="stroke-muted-foreground" />
                    {p.dots.map((v, i) => (
                      <circle key={i} cx={cx + ((i % 5) - 2) * 3} cy={y(v)} r={2.5} className="fill-primary" />
                    ))}
                    <line x1={cx - x.bandwidth() / 2} x2={cx + x.bandwidth() / 2} y1={y(p.stats.median)} y2={y(p.stats.median)} strokeWidth={3} className="stroke-foreground" />
                  </>
                )}
                <text x={cx} y={innerH + 14} textAnchor="middle" fontSize={9} className="fill-muted-foreground">
                  {monthLabel(p.period, locale, 'short')}
                </text>
              </Group>
            )
          })}
        </Group>
      </svg>
      <Summary id={id}>
        {t('analytics.chart.trend.summary', { platform: platformName, first: monthLabel(points[0].period, locale), last: monthLabel(points[points.length - 1].period, locale) })}
      </Summary>
      <div className="sr-only">
      <table>
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{t('analytics.chart.trend.col.month')}</th>
            <th scope="col">{t('analytics.chart.trend.col.median')}</th>
            <th scope="col">{t('analytics.chart.trend.col.range')}</th>
            <th scope="col">{t('analytics.chart.trend.col.n')}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.period}>
              <th scope="row">{monthLabel(p.period, locale)}</th>
              {p.typical.state === 'number' ? (
                <>
                  <td>{p.typical.params.rate}</td>
                  <td>
                    {p.typical.params.lo}–{p.typical.params.hi}
                  </td>
                  <td>{p.typical.params.n}</td>
                </>
              ) : (
                <>
                  <td colSpan={2}>{t('analytics.chart.trend.gap')}</td>
                  <td>{p.typical.params.n}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  )
}

// ─── a breakdown: horizontal bars of win share with a range whisker (n >= 10 per side only) ─────────────────────

export function WinShareBars({ t, id, dimensionLabel, breakdown, valueLabel }: { t: T; id: string; dimensionLabel: string; breakdown: BreakdownView; valueLabel: (value: string) => string }) {
  const rowH = 30
  const labelW = 130
  const barW = 330
  const height = breakdown.rows.length * rowH + 8
  const share = scaleLinear<number>({ domain: [0, 1], range: [0, barW] })
  return (
    <figure className="space-y-2">
      <svg viewBox={'0 0 ' + (labelW + barW + 70) + ' ' + height} role="img" aria-label={dimensionLabel} aria-describedby={id + '-summary'} className="h-auto w-full">
        {breakdown.rows.map((r, i) => (
          <Group key={r.value} top={i * rowH + 4}>
            <text x={0} y={16} fontSize={11} className="fill-foreground">
              {valueLabel(r.value)}
            </text>
            <Group left={labelW}>
              <Bar x={0} y={4} width={share(r.share)} height={16} className="fill-primary" />
              {r.bar && <line x1={share(r.bar.lo)} x2={share(r.bar.hi)} y1={12} y2={12} strokeWidth={2} className="stroke-foreground" />}
              <text x={barW + 6} y={16} fontSize={11} className="fill-foreground">
                {r.params.wins}/{r.params.n}
              </text>
            </Group>
          </Group>
        ))}
      </svg>
      <Summary id={id}>{t('analytics.chart.winShare.summary', { dimension: dimensionLabel })}</Summary>
      <div className="sr-only">
      <table>
        <caption>{dimensionLabel}</caption>
        <thead>
          <tr>
            <th scope="col" className={TABLE.th}>
              {t('analytics.chart.winShare.col.value')}
            </th>
            <th scope="col">{t('analytics.chart.winShare.col.result')}</th>
            <th scope="col">{t('analytics.chart.winShare.col.range')}</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.rows.map((r) => (
            <tr key={r.value}>
              <th scope="row">{valueLabel(r.value)}</th>
              <td>{t('analytics.wins', { wins: r.params.wins, n: r.params.n })}</td>
              <td>{r.interval ? t('analytics.interval', r.interval.params) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  )
}
