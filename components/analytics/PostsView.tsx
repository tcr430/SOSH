import { dateLabel } from '@/lib/analytics/format'
import type { PostRowView, PostsView as PostsModel } from '@/lib/analytics/load'
import { BUTTON, Disclosures, ResultBadge, Section, SectionError, SelectField, StateNote, TABLE, type PickerOption, type T } from './shared'

// ADR 0031 §10.1 — the post level: a filter bar (GET form, native selects, no JavaScript), then a table with the date,
// platform, account, campaign, state, and the value or the "so far" counts with the badge.

const platformName = (t: T, platform: string) => t('analytics.platform.' + platform)

export interface PostsFilterState {
  period: string
  platform?: string
  accountId?: string
  campaignId?: string
}

export function PostsFilters({
  t,
  action,
  state,
  months,
  platforms,
  accounts,
  campaigns,
}: {
  t: T
  action: string
  state: PostsFilterState
  months: PickerOption[]
  platforms: PickerOption[]
  accounts: PickerOption[]
  campaigns: PickerOption[]
}) {
  const all = { value: '', label: t('analytics.posts.filters.all') }
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-3">
      <SelectField id="posts-month" label={t('analytics.picker.label')} name="month" value={state.period} options={months} />
      <SelectField id="posts-platform" label={t('analytics.posts.filters.platform')} name="platform" value={state.platform ?? ''} options={[all, ...platforms]} />
      <SelectField
        id="posts-account"
        label={t('analytics.posts.filters.account')}
        name="account"
        value={state.accountId ?? ''}
        options={[all, { value: 'none', label: t('analytics.posts.filters.none') }, ...accounts]}
      />
      <SelectField id="posts-campaign" label={t('analytics.posts.filters.campaign')} name="campaign" value={state.campaignId ?? ''} options={[all, ...campaigns]} />
      <button type="submit" className={BUTTON}>
        {t('analytics.posts.filters.apply')}
      </button>
    </form>
  )
}

function StateCell({ t, row }: { t: T; row: PostRowView }) {
  switch (row.state) {
    case 'measuring':
    case 'so_far':
      return <>{t('analytics.posts.state.measuring')}</>
    case 'final':
      return <>{t('analytics.posts.state.final')}</>
    case 'not_measured':
      return <>{t('analytics.posts.state.notMeasured', { reason: t('analytics.posts.state.reason.' + row.reason) })}</>
    case 'unavailable':
      return <>–</>
  }
}

function ResultCell({ t, locale, timezone, row }: { t: T; locale: string; timezone: string; row: PostRowView }) {
  if (row.state === 'so_far' && row.soFar && row.finalOn) {
    const missing = t('analytics.posts.state.soFarMissing')
    const n = (v: number | null) => (v === null ? missing : v)
    return (
      <>
        {t('analytics.posts.state.soFar', {
          asOf: dateLabel(row.soFar.asOf, locale, timezone),
          likes: n(row.soFar.likes),
          comments: n(row.soFar.comments),
          shares: n(row.soFar.shares),
          impressions: n(row.soFar.impressions),
          finalOn: dateLabel(row.finalOn, locale, timezone),
        })}
      </>
    )
  }
  if (row.state === 'final' && row.final) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span>{row.final.rate !== null ? t('analytics.posts.value.rate', { rate: row.final.rate }) : t('analytics.posts.value.count', { count: row.final.value })}</span>
        <ResultBadge t={t} badge={row.final.badge} />
      </span>
    )
  }
  return null
}

export function PostsTable({ t, locale, timezone, model }: { t: T; locale: string; timezone: string; model: PostsModel }) {
  if (model.posts.status === 'error') {
    return (
      <Section id="posts" title={t('analytics.posts.title')}>
        <SectionError t={t} />
      </Section>
    )
  }
  const rows = model.posts.data
  if (rows.length === 0) {
    return (
      <Section id="posts" title={t('analytics.posts.title')}>
        <StateNote>{t('analytics.state.empty')}</StateNote>
      </Section>
    )
  }
  // The unavailable platforms are named ONCE above the table, from the rows' own state (the capability), and a count is
  // always accompanied by its disclosure.
  const unavailable = [...new Set(rows.filter((r) => r.state === 'unavailable').map((r) => r.platform))]
  const showsCount = rows.some((r) => r.state === 'final' && r.final?.basis === 'count')
  return (
    <Section id="posts" title={t('analytics.posts.title')}>
      {unavailable.map((p) => (
        <StateNote key={p}>{t('analytics.state.unavailable', { platform: platformName(t, p) })}</StateNote>
      ))}
      {showsCount && <Disclosures t={t} keys={['analytics.disclosure.linkedinCount']} />}
      <table className={TABLE.table}>
        <thead className={TABLE.head}>
          <tr className="border-b border-border">
            <th scope="col" className={TABLE.th}>{t('analytics.posts.col.date')}</th>
            <th scope="col" className={TABLE.th}>{t('analytics.posts.col.platform')}</th>
            <th scope="col" className={TABLE.th + ' ' + TABLE.secondary}>{t('analytics.posts.col.account')}</th>
            <th scope="col" className={TABLE.th + ' ' + TABLE.secondary}>{t('analytics.posts.col.campaign')}</th>
            <th scope="col" className={TABLE.th}>{t('analytics.posts.col.state')}</th>
            <th scope="col" className={TABLE.th}>{t('analytics.posts.col.result')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.postId} className={TABLE.row} data-state={r.state}>
              <td className={TABLE.cell} data-label={t('analytics.posts.col.date')}>{dateLabel(r.publishedAt, locale, timezone)}</td>
              <td className={TABLE.cell} data-label={t('analytics.posts.col.platform')}>{platformName(t, r.platform)}</td>
              <td dir="auto" className={TABLE.cell + ' ' + TABLE.secondary} data-label={t('analytics.posts.col.account')}>
                {r.accountLabel ?? t(r.accountLabelKey ?? 'analytics.account.unrecorded')}
              </td>
              <td dir="auto" className={TABLE.cell + ' ' + TABLE.secondary} data-label={t('analytics.posts.col.campaign')}>{r.campaignName ?? '–'}</td>
              <td className={TABLE.cell} data-label={t('analytics.posts.col.state')}><StateCell t={t} row={r} /></td>
              <td className={TABLE.cell} data-label={t('analytics.posts.col.result')}><ResultCell t={t} locale={locale} timezone={timezone} row={r} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}
