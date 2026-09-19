import { parseISO, isValid, addMonths, formatISO } from 'date-fns'
import type {
  Platform,
  EvidenceMemoryKind,
  EvidenceMemoryRow,
  AudienceMemoryKind,
  AudienceMemoryRow,
  PerformanceMemoryDimension,
  PerformanceMemoryRow,
  MemoryScope,
} from '@/lib/db/types'
import { importEvidenceMemory } from '@/lib/db/memory-evidence'
import { importAudienceMemory } from '@/lib/db/memory-audience'
import { importPerformanceMemory } from '@/lib/db/memory-performance'

// ADR 0025 §9.4 (Session 32 I2.7) — MEM-NO-DIRECT-TABLE-ACCESS's import-path
// counterpart: the ONLY caller of importEvidenceMemory/importAudienceMemory/
// importPerformanceMemory (lib/memory/import.test.ts's source scan
// enforces it). Scope is fixed to 'platform' with scope_ref = the source
// platform (ADR §5.2 — no account column is added to memory; import_run_id
// is the account discriminator, not scope).
const IMPORT_SCOPE: MemoryScope = 'platform'
const IMPORT_EXPIRY_MONTHS = 12

// ADR §5.3 — dates are validated finite BEFORE the write, because
// recencyDecay (lib/memory/scoring.ts:34-38) throws on a non-finite age; a
// bad date must fail loudly here, at the import boundary, rather than
// later at retrieval time against an already-written row.
function assertFiniteIso(value: string, label: string): Date {
  const parsed = parseISO(value)
  if (!isValid(parsed)) {
    throw new Error(`lib/memory/import: ${label} is not a finite date: "${value}"`)
  }
  return parsed
}

function importExpiryFrom(source: Date): string {
  return formatISO(addMonths(source, IMPORT_EXPIRY_MONTHS))
}

function isAlreadyExpired(expiresAtIso: string, now: Date): boolean {
  return parseISO(expiresAtIso).getTime() <= now.getTime()
}

export type ImportEvidenceItemInput = {
  businessId: string
  runId: string
  sourcePostIds: string[]
  kind: EvidenceMemoryKind
  content: string
  sourceUrl: string | null
  platform: Platform
  confidence: number
  /** The source post's publishedAt, ISO. */
  publishedAt: string
}

// ADR §4.5 — usage_data rows get expires_at = publishedAt + 12 months,
// SKIPPED if already expired at import; quote/case_study/other rows are not
// time-bound (expires_at NULL), consistent with §4.3's performance-only and
// §4.5's usage_data-only expiry rule — recency still decays them via
// last_confirmed_at regardless.
export async function importEvidenceItem(input: ImportEvidenceItemInput): Promise<EvidenceMemoryRow | null> {
  const publishedAt = assertFiniteIso(input.publishedAt, 'publishedAt')

  let expiresAt: string | null = null
  if (input.kind === 'usage_data') {
    expiresAt = importExpiryFrom(publishedAt)
    if (isAlreadyExpired(expiresAt, new Date())) return null
  }

  const rows = await importEvidenceMemory({
    business_id: input.businessId,
    import_run_id: input.runId,
    import_source_post_ids: input.sourcePostIds,
    kind: input.kind,
    content: input.content,
    source_url: input.sourceUrl,
    scope: IMPORT_SCOPE,
    scope_ref: input.platform,
    confidence: input.confidence,
    last_confirmed_at: formatISO(publishedAt),
    expires_at: expiresAt,
  })
  return rows[0] ?? null
}

export type ImportAudienceItemInput = {
  businessId: string
  runId: string
  sourcePostIds: string[]
  segment: string | null
  kind: AudienceMemoryKind
  statement: string
  platform: Platform
  confidence: number
  /** The (newest) source post's publishedAt, ISO. */
  publishedAt: string
}

// ADR §4.4 — audience statements carry no expires_at; they are not
// time-bound the way performance/usage_data claims are.
export async function importAudienceItem(input: ImportAudienceItemInput): Promise<AudienceMemoryRow | null> {
  const publishedAt = assertFiniteIso(input.publishedAt, 'publishedAt')

  const rows = await importAudienceMemory({
    business_id: input.businessId,
    import_run_id: input.runId,
    import_source_post_ids: input.sourcePostIds,
    segment: input.segment,
    kind: input.kind,
    statement: input.statement,
    scope: IMPORT_SCOPE,
    scope_ref: input.platform,
    confidence: input.confidence,
    last_confirmed_at: formatISO(publishedAt),
    expires_at: null,
  })
  return rows[0] ?? null
}

export type ImportPerformanceItemInput = {
  businessId: string
  runId: string
  sourcePostIds: string[]
  dimension: PerformanceMemoryDimension
  pattern: string
  platform: Platform
  confidence: number
  observationCount: number
  /** The NEWEST backing post's publishedAt, ISO (ADR §5.3). */
  newestPublishedAt: string
}

// ADR §4.3 — last_confirmed_at is the newest backing post's date;
// expires_at = that date + 12 months, SKIPPED if already expired at import
// (a pattern whose newest supporting post is already a year old never
// enters memory).
export async function importPerformanceItem(input: ImportPerformanceItemInput): Promise<PerformanceMemoryRow | null> {
  const newest = assertFiniteIso(input.newestPublishedAt, 'newestPublishedAt')
  const expiresAt = importExpiryFrom(newest)
  if (isAlreadyExpired(expiresAt, new Date())) return null

  const rows = await importPerformanceMemory({
    business_id: input.businessId,
    import_run_id: input.runId,
    import_source_post_ids: input.sourcePostIds,
    dimension: input.dimension,
    pattern: input.pattern,
    platform: input.platform,
    scope: IMPORT_SCOPE,
    scope_ref: input.platform,
    confidence: input.confidence,
    observation_count: input.observationCount,
    last_confirmed_at: formatISO(newest),
    expires_at: expiresAt,
  })
  return rows[0] ?? null
}
