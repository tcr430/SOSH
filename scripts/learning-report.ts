// ADR 0018 §11 — founder-verifiability #2: "how many businesses have
// learned anything, and how much." Per business: signals by class, the top
// pattern_keys with observation_count / confidence / status, and how many
// have reached 'active'. Read-only, service-role (bypasses RLS by design,
// same posture as scripts/apply-migrations.ts).
//
// Usage: tsx --env-file=.env.local scripts/learning-report.ts [businessId]

import { fileURLToPath } from 'node:url'
import { createServiceRoleClient } from '../lib/supabase/service'

const TOP_PATTERNS_LIMIT = 10

// [Session 25-D correction, MINOR-7] Every list query below is bounded with
// an explicit ORDER BY matching an existing index (CLAUDE.md's two list-
// query rules) — no scripts/ carve-out was added; the rules are cheaper to
// obey than to weaken. A business with more rows than these bounds will see
// a truncated (not wrong, but incomplete) view in a single run — acceptable
// for an operator diagnostic tool, and strictly better than the prior
// unbounded self-DoS vector.
const SIGNAL_SCAN_LIMIT = 5000
const BUSINESS_SCAN_LIMIT = 500

// [Session 25-D correction, MAJOR-3 fix (c)] Bounds the orphan scan itself
// (posts_business_id_created_at_idx-ordered) and the printed sample
// separately — see findSnapshotOrphans below.
export const ORPHAN_SCAN_LIMIT = 500
export const ORPHAN_SAMPLE_LIMIT = 20

export interface SnapshotOrphanResult {
  readonly scanned: number
  readonly orphanIds: readonly string[]
}

// [Session 25-D correction, MAJOR-3] The Reviewer (docs/reviews/session-25-
// reviewer.md) found that createPosts commits N post rows in one call, and
// the post_ai_originals snapshot writes are a SECOND, independent round
// trip — if one fails, the posts already committed are NOT rolled back, and
// Promise.all's first-rejection-only surface doesn't even report which ids
// succeeded. Those posts stay live status='draft', render and approve
// exactly like healthy posts, and the capture trigger's
// `IF v_origin_id IS NOT NULL THEN … END IF` has no ELSE — no log, no
// counter, no row — so the post falls out of the learning loop silently,
// forever (there is no backfill: ADR 0018 §2.6, "no backfill; ships empty").
//
// The Reviewer offered three fixes: (a) one Postgres transaction wrapping
// both inserts; (b) Promise.allSettled + mark/soft-delete the specific
// snapshot-less posts on partial failure; (c) an orphan query, named the
// recommended minimum. This pass implements ONLY (c):
//   (a) considered and DEFERRED — a transaction boundary change across
//       createPosts (lib/campaigns/generate.ts) is a behaviour change to the
//       generation path itself, out of scope for a correction pass whose
//       brief is fixing what a Reviewer found wrong in already-shipped code,
//       not restructuring it.
//   (b) considered and DEFERRED — changes failure semantics (what
//       createPosts returns and what state a caller sees on partial
//       failure), which is exactly the kind of behavioural change this
//       correction pass is scoped to avoid; also out of scope here.
// Recorded so the choice is legible, not silent — see
// docs/reviews/session-25-reviewer.md CORRECTION PASS, D2.
//
// This gives [db-MAJOR-1]'s deliberate silent skip (an approved post with no
// snapshot does not fail the approval) the operator-visible counterpart it
// currently lacks: a post with `deleted_at IS NULL` and no matching
// `post_ai_originals` row is exactly the shape MAJOR-3 describes.
//
// NOTE for whoever reads this report: any post created before Track C
// shipped (the `20260726010000_learning_capture.sql` migration) will ALSO
// show here — those posts never had a snapshot by design (no backfill was
// built, a recorded decision, not a bug). Only an orphan you don't recognize
// as pre-existing is worth investigating.
export async function findSnapshotOrphans(
  client: ReturnType<typeof createServiceRoleClient>,
  businessId: string,
): Promise<SnapshotOrphanResult> {
  const { data, error } = await client
    .from('posts')
    .select('id, post_ai_originals(id)')
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(ORPHAN_SCAN_LIMIT)
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as { id: string; post_ai_originals: { id: string }[] | null }[]
  const orphanIds = rows
    .filter((row) => !row.post_ai_originals || row.post_ai_originals.length === 0)
    .map((row) => row.id)

  return { scanned: rows.length, orphanIds }
}

async function reportForBusiness(client: ReturnType<typeof createServiceRoleClient>, businessId: string) {
  // [silent-failure-hunter, C2.8 review MINOR-1] Query ALL statuses, not
  // just 'processed' — a business whose rows are stuck at 'processing'
  // (BLOCKER-1-shaped bugs) or piling up at 'pending'/'failed' would
  // otherwise print as "learned nothing," which reads as "nothing has
  // happened" rather than "something is stuck." This is the tool ADR
  // §11 built specifically so a founder doesn't have to take the pipeline's
  // health on faith — it must not itself become a source of false
  // reassurance.
  const { data: allRows, error: signalsError } = await client
    .from('post_edit_signals')
    .select('class, status')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(SIGNAL_SCAN_LIMIT)
  if (signalsError) throw new Error(signalsError.message)

  const byClass = { preference: 0, correction: 0, inconclusive: 0, null: 0 }
  const byStatus = { pending: 0, processing: 0, processed: 0, failed: 0, abandoned: 0 }
  for (const row of (allRows ?? []) as { class: string | null; status: keyof typeof byStatus }[]) {
    if (row.status === 'processed') {
      const key = (row.class ?? 'null') as keyof typeof byClass
      byClass[key] = (byClass[key] ?? 0) + 1
    }
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
  }
  const stuck = byStatus.pending + byStatus.processing + byStatus.failed

  const { data: patternRows, error: patternsError } = await client
    .from('performance_memory')
    .select('pattern_key, pattern, observation_count, confidence, status')
    .eq('business_id', businessId)
    .eq('source', 'distilled')
    .is('deleted_at', null)
    .order('confidence', { ascending: false })
    .limit(TOP_PATTERNS_LIMIT)
  if (patternsError) throw new Error(patternsError.message)

  const activeCount = (patternRows ?? []).filter((r) => (r as { status: string }).status === 'active').length

  const { scanned, orphanIds } = await findSnapshotOrphans(client, businessId)

  console.log(`\nBusiness: ${businessId}`)
  console.log(`  Signals by status: pending=${byStatus.pending} processing=${byStatus.processing} processed=${byStatus.processed} failed=${byStatus.failed} abandoned=${byStatus.abandoned}`)
  if (stuck > 0) {
    console.log(`  WARNING: ${stuck} signal(s) not yet terminal (pending/processing/failed) — the pipeline may be stalled for this business.`)
  }
  console.log(`  Processed signals by class: preference=${byClass.preference} correction=${byClass.correction} inconclusive=${byClass.inconclusive} unclassified=${byClass.null}`)
  console.log(`  Top ${TOP_PATTERNS_LIMIT} distilled patterns (of which ${activeCount} active):`)
  for (const row of (patternRows ?? []) as Array<{
    pattern_key: string | null
    pattern: string
    observation_count: number
    confidence: number
    status: string
  }>) {
    console.log(`    [${row.status.padEnd(9)}] obs=${row.observation_count} conf=${row.confidence.toFixed(2)} ${row.pattern_key ?? '(no key)'} — ${row.pattern}`)
  }

  console.log(`  Snapshot-orphan posts (of the ${scanned} most recent non-deleted posts scanned): ${orphanIds.length}`)
  if (orphanIds.length > 0) {
    const sample = orphanIds.slice(0, ORPHAN_SAMPLE_LIMIT)
    const more = orphanIds.length > sample.length ? ` (+${orphanIds.length - sample.length} more in this scan)` : ''
    console.log(`    sample ids: ${sample.join(', ')}${more}`)
    console.log('    NOTE: includes any post predating Track C (no backfill was built, by decision — ADR 0018 §2.6) as well as any genuine MAJOR-3 orphan from a partially-failed generation call. Only investigate ids you don\'t recognize as pre-existing.')
  }
}

async function main() {
  const client = createServiceRoleClient()
  const requestedBusinessId = process.argv[2]

  let businessIds: string[]
  if (requestedBusinessId) {
    businessIds = [requestedBusinessId]
  } else {
    // [Session 25-D correction, silent-failure-hunter D2 finding] Deriving
    // the sweep's business set from post_edit_signals ALONE misses exactly
    // the businesses MAJOR-3's orphan check exists to catch: a business
    // whose only symptom is a partially-failed generation call has zero
    // signals (no post has been approved/edited yet) but may already have a
    // snapshot-orphan post sitting in `posts`. Union both sources so the
    // no-businessId sweep can't silently skip a business with an orphan and
    // nothing else.
    const [signalRows, postRows] = await Promise.all([
      client
        .from('post_edit_signals')
        .select('business_id')
        .order('business_id', { ascending: true })
        .limit(BUSINESS_SCAN_LIMIT),
      client
        .from('posts')
        .select('business_id')
        .is('deleted_at', null)
        .order('business_id', { ascending: true })
        .limit(BUSINESS_SCAN_LIMIT),
    ])
    if (signalRows.error) throw new Error(signalRows.error.message)
    if (postRows.error) throw new Error(postRows.error.message)
    businessIds = [
      ...new Set([
        ...(signalRows.data ?? []).map((r) => (r as { business_id: string }).business_id),
        ...(postRows.data ?? []).map((r) => (r as { business_id: string }).business_id),
      ]),
    ]
  }

  if (businessIds.length === 0) {
    console.log('No businesses with any learning signals or posts yet.')
    return
  }

  for (const businessId of businessIds) {
    await reportForBusiness(client, businessId)
  }
}

// ESM-safe "is this the entry module" guard — importing this file (e.g. from
// a test) must not trigger the CLI side effect below. `require.main` does
// not exist under the ESM transform vitest/esbuild use; comparing
// `process.argv[1]` against `import.meta.url` is the standard equivalent.
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url)
if (isMainModule) {
  main().catch((err) => {
    console.error('learning-report failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
