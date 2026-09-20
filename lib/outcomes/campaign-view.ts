import type { SupabaseClient } from '@supabase/supabase-js'
import { formatISO } from 'date-fns'
import type { CampaignRetrospectiveRow, PerformanceMemoryRow } from '@/lib/db/types'
import {
  getCampaignRetrospective,
  getFrozenBriefContent,
  listCampaignOutcomeCellSources,
  listCampaignPostStates,
  type CampaignOutcomeCellSource,
} from '@/lib/db/campaign-retrospectives'
import { listOutcomePatterns } from '@/lib/db/memory-performance'
import { resolveHypothesis, retrospectiveDueAt } from './retrospective'

// ADR 0026 §10 (Session 33 J2.12) — the campaign page's view models. Deterministic and read-only: the retrospective
// card and the observed-outcomes list only DISPLAY what the worker and the SQL floor already computed.

export type ObservedState = 'live' | 'provisional' | 'contradicted' | 'no_variety'

export interface ObservedRowView {
  // dimension:value:platform, one line per cell whichever direction leads.
  cell: string
  dimension: 'role' | 'format' | 'length_band' | 'cta' | 'origin_mode'
  value: string
  platform: string
  direction: 'above' | 'below'
  basis: 'rate' | 'count'
  state: ObservedState
  wins: number
  n: number
  campaigns: number
  seeded: boolean
  // ISO timestamp the pattern was paused, for the contradicted state.
  pausedAt: string | null
}

const DIMENSIONS = new Set(['role', 'format', 'length_band', 'cta', 'origin_mode'])

// outcome:<dimension>:<value>:<direction>:<platform> (no value contains a colon).
function parseKey(key: string | null): { dimension: string; value: string; direction: string; platform: string } | null {
  if (!key) return null
  const [kind, dimension, value, direction, platform] = key.split(':')
  if (kind !== 'outcome' || !dimension || !value || !direction || !platform) return null
  return { dimension, value, direction, platform }
}

// The cells (dimension:value:platform) this campaign's frozen outcomes contributed to.
export function campaignCellKeys(sources: readonly CampaignOutcomeCellSource[]): Set<string> {
  const keys = new Set<string>()
  for (const s of sources) {
    const add = (dimension: string, value: string | null) => {
      if (value !== null) keys.add(`${dimension}:${value}:${s.platform}`)
    }
    add('role', s.role)
    add('format', s.format)
    add('origin_mode', s.origin_mode)
    add('length_band', s.length_band)
    add('cta', s.cta_present === null ? null : String(s.cta_present))
  }
  return keys
}

// Rows are the brand's outcome patterns (candidate and active). Restricted to the campaign's cells; one row per
// cell (the direction with the larger share of agreeing posts leads); a dimension with a single value across all
// of the brand's patterns for that platform has nothing to compare (no_variety).
export function classifyObservedRows(rows: readonly PerformanceMemoryRow[], cells: ReadonlySet<string>): ObservedRowView[] {
  const parsed = rows.flatMap((row) => {
    const k = parseKey(row.pattern_key)
    if (!k || !DIMENSIONS.has(k.dimension) || row.outcome_n === null || row.outcome_wins === null) return []
    return [{ row, ...k }]
  })

  const valuesByDimension = new Map<string, Set<string>>()
  for (const p of parsed) {
    const key = `${p.dimension}:${p.platform}`
    const set = valuesByDimension.get(key) ?? new Set<string>()
    set.add(p.value)
    valuesByDimension.set(key, set)
  }

  const leading = new Map<string, (typeof parsed)[number]>()
  const share = (r: (typeof parsed)[number]) => (r.row.outcome_wins as number) / Math.max(r.row.outcome_n as number, 1)
  for (const p of parsed) {
    const cell = `${p.dimension}:${p.value}:${p.platform}`
    if (!cells.has(cell)) continue
    const current = leading.get(cell)
    if (!current || share(p) > share(current) || (share(p) === share(current) && p.direction === 'above')) leading.set(cell, p)
  }

  return [...leading.entries()]
    .map(([cell, p]): ObservedRowView => {
      const variety = valuesByDimension.get(`${p.dimension}:${p.platform}`)?.size ?? 0
      const contradicted = p.row.status === 'candidate' && p.row.contradicted_at !== null
      const state: ObservedState =
        variety <= 1 ? 'no_variety' : p.row.status === 'active' ? 'live' : contradicted ? 'contradicted' : 'provisional'
      return {
        cell,
        dimension: p.dimension as ObservedRowView['dimension'],
        value: p.value,
        platform: p.platform,
        direction: p.direction === 'below' ? 'below' : 'above',
        basis: p.row.metric_basis === 'count' ? 'count' : 'rate',
        state,
        wins: p.row.outcome_wins as number,
        n: p.row.outcome_n as number,
        campaigns: p.row.outcome_distinct_campaigns ?? 1,
        seeded: p.row.baseline_seeded === true,
        pausedAt: contradicted ? p.row.contradicted_at : null,
      }
    })
    .sort((a, b) => a.cell.localeCompare(b.cell))
}

export interface CampaignLearningView {
  retro: CampaignRetrospectiveRow | null
  // When the retrospective becomes due; null while posts are still unpublished or none is published.
  dueAt: string | null
  observed: ObservedRowView[]
  // Campaign platforms whose metrics are unavailable (LinkedIn's provider is NOT_IMPLEMENTED, ADR 0028 Amd A).
  unavailablePlatforms: string[]
}

const OBSERVED_LIST_LIMIT = 20

// `client` MUST be the caller's AUTHENTICATED client (never service-role): this is a user-facing read, so the
// SELECT policies on the outcome tables, not the businessId argument alone, are what scope it (MAJOR-1, L-9).
export async function loadCampaignLearningView(
  client: SupabaseClient,
  businessId: string,
  campaignId: string,
  platforms: readonly string[],
): Promise<CampaignLearningView> {
  const [retro, posts, brief, sources, active, candidate] = await Promise.all([
    getCampaignRetrospective(client, businessId, campaignId),
    listCampaignPostStates(client, businessId, campaignId),
    getFrozenBriefContent(client, businessId, campaignId),
    listCampaignOutcomeCellSources(client, businessId, campaignId),
    listOutcomePatterns(client, businessId, { status: 'active', limit: 100 }),
    listOutcomePatterns(client, businessId, { status: 'candidate', limit: 100 }),
  ])

  const dueAt = retrospectiveDueAt(posts, resolveHypothesis(brief).criteria)
  const measured = new Set(sources.map((s) => s.platform))
  return {
    retro,
    dueAt: dueAt ? formatISO(dueAt) : null,
    observed: classifyObservedRows([...active, ...candidate], campaignCellKeys(sources)).slice(0, OBSERVED_LIST_LIMIT),
    unavailablePlatforms: platforms.filter((p) => p === 'linkedin' && !measured.has(p)),
  }
}
