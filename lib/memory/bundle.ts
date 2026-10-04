import type { SupabaseClient } from '@supabase/supabase-js'
import { listBrandMemoryCandidates } from '@/lib/db/memory-brand'
import { listEvidenceMemoryCandidates } from '@/lib/db/memory-evidence'
import { listAudienceMemoryCandidates } from '@/lib/db/memory-audience'
import { listPerformanceMemoryCandidates } from '@/lib/db/memory-performance'
import type { BrandMemoryRow, AudienceMemoryRow, EvidenceMemoryRow, PerformanceMemoryRow } from '@/lib/db/types'
import { bindEvidenceForPrompt, guardMemoryRowText, type BoundEvidence } from '@/lib/ai/wrap-evidence'
import { isEligible, scoreRecord, type BundleRequest, type MemoryQueryContext, type MemoryTask } from './scoring'

// ADR 0030 §5 (Session 36 L2.8) — the cross-type memory bundle: ONE read per memory type, ONE budget division across the types, and an
// OPAQUE result. The per-type retrieve* functions stay (the planner/triage tools and post generation read one type at a time); this is the
// path a prompt that wants several types at once takes, so that "how many rows of what" is decided in ONE place and "what reaches the
// model" passes ONE guard.

type MemoryTypeName = 'brand' | 'evidence' | 'audience' | 'performance'
const TYPE_NAMES: readonly MemoryTypeName[] = ['brand', 'evidence', 'audience', 'performance']

type TypeBudget = { readonly floor: number; readonly ceiling: number }
type TaskBudget = {
  readonly total: number
  // Inclusive eligibility filter on STORED confidence (rankAndCap's `confidenceFloor` semantics): a row exactly AT it is admitted. A slot that an
  // empty type donates therefore never goes to filler below the floor.
  readonly confidenceFloor: number
  readonly types: Readonly<Record<MemoryTypeName, TypeBudget>>
}

// ADR 0030 §5.2, as literals. `floor` = rows a type is guaranteed if it has that many eligible; `ceiling` = the most it may ever take; `total` =
// the most the whole bundle may hold. The brief reads no performance at all (ceiling 0 -> the reader is never called): a hypothesis is what
// Stage A is for, and the outcomes it would be measured against are read through retrieveHypothesisResults.
export const MEMORY_TASK_BUDGET: Readonly<Record<MemoryTask, TaskBudget>> = {
  brief: {
    total: 15,
    confidenceFloor: 0.25,
    types: { brand: { floor: 1, ceiling: 5 }, evidence: { floor: 2, ceiling: 5 }, audience: { floor: 2, ceiling: 5 }, performance: { floor: 0, ceiling: 0 } },
  },
  post: {
    total: 14,
    confidenceFloor: 0.25,
    types: { brand: { floor: 1, ceiling: 5 }, evidence: { floor: 0, ceiling: 5 }, audience: { floor: 1, ceiling: 5 }, performance: { floor: 1, ceiling: 3 } },
  },
  plan: {
    total: 14,
    confidenceFloor: 0.25,
    types: { brand: { floor: 1, ceiling: 5 }, evidence: { floor: 2, ceiling: 5 }, audience: { floor: 2, ceiling: 5 }, performance: { floor: 0, ceiling: 3 } },
  },
  triage: {
    total: 14,
    confidenceFloor: 0.25,
    types: { brand: { floor: 1, ceiling: 5 }, evidence: { floor: 1, ceiling: 5 }, audience: { floor: 2, ceiling: 5 }, performance: { floor: 0, ceiling: 3 } },
  },
}

// ─── The opaque bundle ──────────────────────────────────────────────────────
//
// The rows live in a module-private WeakMap keyed by the bundle object. The bundle has NO own property and its prototype methods return counts
// and evidence ids only, so `Object.keys`, spread, JSON.stringify and index access cannot reach a row. The one way to obtain text from it is
// renderMemoryBundleForPrompt below, which is the guard.
type BundleState = {
  readonly client: SupabaseClient
  readonly businessId: string
  readonly rows: {
    readonly brand: readonly BrandMemoryRow[]
    readonly evidence: readonly EvidenceMemoryRow[]
    readonly audience: readonly AudienceMemoryRow[]
    readonly performance: readonly PerformanceMemoryRow[]
  }
}

const bundleBrand: unique symbol = Symbol('memory-bundle')

// Nominal via a non-exported unique symbol: an object literal with these methods is not a MemoryBundle (review finding 2); stateOf still fails closed.
export interface MemoryBundle {
  readonly [bundleBrand]: true
  count(type: MemoryTypeName): number
  evidenceIds(): readonly string[]
  toJSON(): Record<MemoryTypeName, number>
}

const STATE = new WeakMap<object, BundleState>()

class MemoryBundleImpl implements MemoryBundle {
  declare readonly [bundleBrand]: true
  count(type: MemoryTypeName): number {
    return stateOf(this).rows[type].length
  }
  evidenceIds(): readonly string[] {
    return stateOf(this).rows.evidence.map((r) => r.id)
  }
  toJSON(): Record<MemoryTypeName, number> {
    const rows = stateOf(this).rows
    return { brand: rows.brand.length, evidence: rows.evidence.length, audience: rows.audience.length, performance: rows.performance.length }
  }
}

function stateOf(bundle: object): BundleState {
  const state = STATE.get(bundle)
  if (!state) throw new Error('memory bundle: not a bundle built by retrieveMemoryBundle')
  return state
}

// ─── Retrieval and the budget division ──────────────────────────────────────

type Scorable = Parameters<typeof scoreRecord>[0] & { readonly id: string }
type Candidate<T> = { readonly row: T; readonly type: MemoryTypeName; readonly score: number }

function compare(a: Candidate<Scorable>, b: Candidate<Scorable>): number {
  return (
    b.score - a.score ||
    b.row.confidence - a.row.confidence ||
    new Date(b.row.recency_at).getTime() - new Date(a.row.recency_at).getTime() ||
    (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0)
  )
}

function rankType<T extends Scorable>(type: MemoryTypeName, rows: readonly T[], ctx: MemoryQueryContext, floor: number, now: Date): Candidate<T>[] {
  return rows
    .filter((row) => isEligible(row, now) && row.confidence >= floor)
    .map((row) => ({ row, type, score: scoreRecord(row, ctx, now) }))
    .sort(compare)
}

export async function retrieveMemoryBundle(
  client: SupabaseClient,
  businessId: string,
  request: BundleRequest,
  now: Date = new Date(),
): Promise<MemoryBundle> {
  const budget = MEMORY_TASK_BUDGET[request.task]
  const floor = request.scope?.confidenceFloor ?? budget.confidenceFloor
  if (!Number.isFinite(floor) || floor < 0 || floor > 1) {
    throw new Error(`retrieveMemoryBundle: confidenceFloor must be a finite number in [0, 1], got ${floor}`)
  }
  const ctx: MemoryQueryContext = { ...request.hints, ...request.scope, confidenceFloor: floor }
  const wants = (type: MemoryTypeName) => budget.types[type].ceiling > 0

  // ONE read per type whose ceiling is > 0. The audience reader excludes source = 'dismissal' and the performance reader excludes
  // source = 'outcome' in SQL (SUBSTRATE-OUTCOME-SEPARATE); this module imports no other reader of either table.
  const [brand, evidence, audience, performance] = await Promise.all([
    wants('brand') ? listBrandMemoryCandidates(client, businessId) : Promise.resolve([] as BrandMemoryRow[]),
    wants('evidence') ? listEvidenceMemoryCandidates(client, businessId) : Promise.resolve([] as EvidenceMemoryRow[]),
    wants('audience') ? listAudienceMemoryCandidates(client, businessId) : Promise.resolve([] as AudienceMemoryRow[]),
    wants('performance') ? listPerformanceMemoryCandidates(client, businessId) : Promise.resolve([] as PerformanceMemoryRow[]),
  ])

  // Ranked PER TYPE, each keeping its own row type: no cast is needed to hand a typed row list back (review finding 1).
  const rankedBrand = rankType('brand', brand, ctx, floor, now)
  const rankedEvidence = rankType('evidence', evidence, ctx, floor, now)
  const rankedAudience = rankType('audience', audience, ctx, floor, now)
  const rankedPerformance = rankType('performance', performance, ctx, floor, now)
  const ranked: Record<MemoryTypeName, Candidate<Scorable>[]> = {
    brand: rankedBrand,
    evidence: rankedEvidence,
    audience: rankedAudience,
    performance: rankedPerformance,
  }

  // (2) each type takes min(floor, eligible) of its best; (3) the rest compete on one merged ranking until the task total, a type at its ceiling
  // is skipped; (4) an empty or exhausted type donates its slots implicitly, because only rows that exist can compete.
  const chosen: Record<MemoryTypeName, Set<string>> = { brand: new Set(), evidence: new Set(), audience: new Set(), performance: new Set() }
  const rest: Candidate<Scorable>[] = []
  for (const type of TYPE_NAMES) {
    const n = Math.min(budget.types[type].floor, ranked[type].length)
    for (const c of ranked[type].slice(0, n)) chosen[type].add(c.row.id)
    rest.push(...ranked[type].slice(n))
  }
  let used = TYPE_NAMES.reduce((n, t) => n + chosen[t].size, 0)
  rest.sort(compare)
  for (const candidate of rest) {
    if (used >= budget.total) break
    if (chosen[candidate.type].size >= budget.types[candidate.type].ceiling) continue
    chosen[candidate.type].add(candidate.row.id)
    used += 1
  }

  // Each ranked list is already in compare() order, so filtering by the chosen ids keeps the final order.
  const bundle = new MemoryBundleImpl()
  STATE.set(bundle, {
    client,
    businessId,
    rows: {
      brand: rankedBrand.filter((c) => chosen.brand.has(c.row.id)).map((c) => c.row),
      evidence: rankedEvidence.filter((c) => chosen.evidence.has(c.row.id)).map((c) => c.row),
      audience: rankedAudience.filter((c) => chosen.audience.has(c.row.id)).map((c) => c.row),
      performance: rankedPerformance.filter((c) => chosen.performance.has(c.row.id)).map((c) => c.row),
    },
  })
  return Object.freeze(bundle)
}

// ─── The guard (ADR 0030 §7.2) ──────────────────────────────────────────────
//
// RenderedMemory: a string a prompt may take as "already guarded". Non-exported `unique symbol` brand with a REAL runtime initializer (the
// Session 31 BLOCKER-1 lesson, the wrap-evidence RenderedToolResult pattern). HONEST LIMIT: a branded string is still a string and a bare
// `as RenderedMemory` compiles; that cast is closed by the source scan SUBSTRATE-CROSS-TYPE-GUARDED (it may appear in THIS file only).
const renderedMemoryBrand: unique symbol = Symbol('memory-rendered')
export type RenderedMemory = string & { readonly [renderedMemoryBrand]: true }

const mint = (text: string): RenderedMemory => text as RenderedMemory

export type RenderedMemoryBundle = {
  readonly brand: RenderedMemory
  readonly audience: RenderedMemory
  readonly performance: RenderedMemory
  readonly evidence: BoundEvidence
}

function block(lines: string[], heading?: string): RenderedMemory {
  if (lines.length === 0) return mint('')
  const body = `[DATA]\n${lines.join('\n')}\n[/DATA]`
  return mint(heading ? `${heading}\n${body}` : body)
}

export async function renderMemoryBundleForPrompt(bundle: MemoryBundle): Promise<RenderedMemoryBundle> {
  const { client, businessId, rows } = stateOf(bundle)
  return {
    brand: block(rows.brand.map((r) => `- (${guardMemoryRowText(r.category)}) ${guardMemoryRowText(r.statement)}`)),
    audience: block(rows.audience.map((r) => `- (${guardMemoryRowText(r.kind)}) ${guardMemoryRowText(r.statement)}`)),
    // A pattern is a probabilistic claim, never a rule: it is rendered with the number of observations behind it, under a heading that says so.
    performance: block(
      rows.performance.map((r) => `- ${guardMemoryRowText(r.pattern)} (based on ${r.observation_count} posts)`),
      'Observations from previous posts (probabilistic, not rules):',
    ),
    evidence: await bindEvidenceForPrompt(client, businessId, rows.evidence.map((r) => r.id)),
  }
}
