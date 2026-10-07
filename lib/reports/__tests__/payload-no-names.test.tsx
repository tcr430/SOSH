import type { ReportLabels } from '@/lib/analytics/labels'
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { assembleReport, type ReportPayload } from '../assemble'
import { REPORT_SCHEMA_VERSION } from '../constants'
import { fixtureReaders, fixturePatternRow, FIXTURE_LABELS_A, FIXTURE_NAME_A } from '../__fixtures__/readers'
import { A_CAMPAIGN_ACTIVE_ID, A_X_ACCOUNT_ID, BUSINESS_A_ID, BUSINESS_B_ID, FIXTURE_ACCOUNTS, FIXTURE_CAMPAIGNS, MARCH_REPORT_OUTCOMES_THROUGH } from '@/lib/analytics/__fixtures__/portfolio'
import { ReportBody } from '@/components/analytics/ReportBody'
import { makeTranslator } from '@/lib/i18n/__test-utils__/translator'
import type { T } from '@/components/analytics/shared'

// Session 37-D D2 (MINOR-7, A-12(a), ADR 0031 §D2.5): the stored report is write-once, so it can never hold a name that could need
// rectifying. It holds IDS; names and labels are resolved at read time. This file proves the payload has no name, handle or pattern
// sentence in it, however the readers spell them, and that the renderer puts them back, or says plainly that it cannot.

const NOW = MARCH_REPORT_OUTCOMES_THROUGH
const SECRET = 'SECRET-'

// The worst readers: EVERY name, label and handle the loaders can see carries a marker, and so does the pattern sentence.
function secretReaders(plan?: Record<string, unknown>) {
  const real = fixtureReaders({ plan, patterns: [fixturePatternRow({ pattern: SECRET + 'pattern sentence' })] })
  return {
    ...real,
    getBusinessById: async (id: string) => ({ ...(await real.getBusinessById(id)), name: SECRET + 'business' }),
    listCampaignsByIds: async (id: string, ids: readonly string[]) => (await real.listCampaignsByIds(id, ids)).map((c) => ({ ...c, name: SECRET + 'campaign ' + c.name })),
    listAccountLabels: async (id: string, ids: readonly string[]) =>
      (await real.listAccountLabels(id, ids)).map((a) => ({ ...a, platform_username: SECRET + 'handle ' + a.platform_username, platform_display_name: SECRET + 'display ' + a.id })),
  }
}

const stringLeaves = (value: unknown, out: string[] = []): string[] => {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach((v) => stringLeaves(v, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => stringLeaves(v, out))
  return out
}

describe('the stored payload holds ids, never a name (MINOR-7)', () => {
  it('the schema version is the one that says so', () => {
    expect(REPORT_SCHEMA_VERSION).toBe(2)
  })

  it('a Pro payload built from readers that mark every name contains no business name, campaign name, account label, handle or pattern sentence', async () => {
    const { payload } = await assembleReport({ readers: secretReaders(), businessId: BUSINESS_A_ID, period: '2026-03', now: NOW })
    expect(payload.tier).toBe('advanced')
    expect(stringLeaves(payload).filter((s) => s.includes(SECRET))).toEqual([])
    expect(JSON.stringify(payload)).not.toContain(SECRET)
    // The fixture's own (unmarked) names are not there either: the payload does not depend on which spelling the readers use.
    const text = JSON.stringify(payload)
    for (const name of [FIXTURE_NAME_A, ...Object.values(FIXTURE_LABELS_A.campaigns), ...Object.values(FIXTURE_LABELS_A.accounts), 'beat this brand']) expect(text, name).not.toContain(name)
    for (const a of FIXTURE_ACCOUNTS.filter((x) => x.business_id === BUSINESS_A_ID)) expect(text, a.platform_username).not.toContain(a.platform_username)
  })

  it('POSITIVE CONTROL: the ids ARE there (the payload is not simply empty), and so is the pattern cell', async () => {
    const { payload } = await assembleReport({ readers: secretReaders(), businessId: BUSINESS_A_ID, period: '2026-03', now: NOW })
    const text = JSON.stringify(payload)
    expect(text).toContain(A_CAMPAIGN_ACTIVE_ID)
    expect(text).toContain(A_X_ACCOUNT_ID)
    expect(payload.campaigns?.every((c) => !('name' in c))).toBe(true)
    expect(payload.activity?.rows.every((r) => !('label' in r) && !('labelKey' in r))).toBe(true)
    expect(payload.header.params).toEqual({ month: '2026-03', measuredAsOf: NOW, generatedOn: NOW })
    expect(payload.patterns).toEqual([{ platform: 'twitter', dimension: 'format', value: 'thread', direction: 'above', basis: 'rate', wins: 7, n: 10, campaigns: 3 }])
  })

  it('a basic payload (business B) holds none either', async () => {
    const { payload } = await assembleReport({ readers: secretReaders(), businessId: BUSINESS_B_ID, period: '2026-03', now: NOW })
    expect(payload.tier).toBe('basic')
    expect(JSON.stringify(payload)).not.toContain(SECRET)
    expect(payload).not.toHaveProperty('patterns')
  })

  it('a pattern whose key does not parse is not stored as text: it is dropped from the payload', async () => {
    const readers = fixtureReaders({ patterns: [fixturePatternRow({ pattern_key: 'not-a-key', pattern: SECRET + 'x' }), fixturePatternRow({ metric_basis: null }), fixturePatternRow({ pattern_key: 'outcome:format:thread:sideways:twitter' })] })
    const { payload } = await assembleReport({ readers, businessId: BUSINESS_A_ID, period: '2026-03', now: NOW })
    expect(payload.patterns).toEqual([])
    expect(JSON.stringify(payload)).not.toContain(SECRET)
  })
})

describe('the renderer puts the names back at read time, or says it cannot', () => {
  const tFor = (locale: 'en' | 'pt' | 'es'): T => (key, values) => {
    const dot = key.indexOf('.')
    return makeTranslator(locale, key.slice(0, dot))(key.slice(dot + 1), values)
  }
  const t = tFor('en')
  const build = async (): Promise<ReportPayload> => (await assembleReport({ readers: fixtureReaders({ patterns: [fixturePatternRow()] }), businessId: BUSINESS_A_ID, period: '2026-03', now: NOW })).payload
  const html = (payload: ReportPayload, businessName: string, labels: ReportLabels, locale: 'en' | 'pt' | 'es' = 'en') =>
    renderToStaticMarkup(<ReportBody t={tFor(locale)} locale={locale} timezone="Europe/Lisbon" payload={payload} proAllowed businessName={businessName} labels={labels} />)

  it('with every id resolved: the business name is in the header, the campaign names and account labels are in their sections', async () => {
    const out = html(await build(), FIXTURE_NAME_A, FIXTURE_LABELS_A)
    expect(out).toContain(FIXTURE_NAME_A.replace(/&/g, '&amp;'))
    expect(out).toContain('A active')
    expect(out).toContain('Fixture A on X')
  })

  it('a DELETED campaign renders the existing "Open campaign" fallback and an account that was REMOVED renders the unrecorded line', async () => {
    const labels = { campaigns: { ...FIXTURE_LABELS_A.campaigns }, accounts: { ...FIXTURE_LABELS_A.accounts }, posts: {} }
    delete labels.campaigns[A_CAMPAIGN_ACTIVE_ID]
    delete labels.accounts[A_X_ACCOUNT_ID]
    const out = html(await build(), FIXTURE_NAME_A, labels)
    expect(out).not.toContain('A active')
    expect(out).not.toContain('Fixture A on X')
    expect(out).toContain(t('analytics.campaignTable.open'))
    expect(out).toContain(t('analytics.account.unrecorded'))
  })

  it('with NO labels at all every campaign and account is its fallback, and nothing renders a raw key, NaN or undefined', async () => {
    const out = html(await build(), FIXTURE_NAME_A, { campaigns: {}, accounts: {}, posts: {} })
    for (const c of FIXTURE_CAMPAIGNS.filter((x) => x.business_id === BUSINESS_A_ID)) expect(out).not.toContain(c.name)
    expect(out).not.toMatch(/NaN|undefined|\[object Object\]/)
  })

  it('a pattern is rendered from its cell in the READER\'s language, never from stored English', async () => {
    const payload = await build()
    const en = html(payload, FIXTURE_NAME_A, FIXTURE_LABELS_A, 'en')
    const pt = html(payload, FIXTURE_NAME_A, FIXTURE_LABELS_A, 'pt')
    const es = html(payload, FIXTURE_NAME_A, FIXTURE_LABELS_A, 'es')
    expect(en).toContain(tFor('en')('outcome.observed.subject.format.thread'))
    expect(pt).toContain(tFor('pt')('outcome.observed.subject.format.thread'))
    expect(es).toContain(tFor('es')('outcome.observed.subject.format.thread'))
    // The English sentence memory stores is not printed in pt or es.
    expect(pt).not.toContain("thread posts beat this brand's usual engagement")
    expect(es).not.toContain("thread posts beat this brand's usual engagement")
  })
})
