// ADR 0018 §11 — founder-verifiability #2: "how many businesses have
// learned anything, and how much." Per business: signals by class, the top
// pattern_keys with observation_count / confidence / status, and how many
// have reached 'active'. Read-only, service-role (bypasses RLS by design,
// same posture as scripts/apply-migrations.ts).
//
// Usage: tsx --env-file=.env.local scripts/learning-report.ts [businessId]

import { createServiceRoleClient } from '../lib/supabase/service'

const TOP_PATTERNS_LIMIT = 10

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
}

async function main() {
  const client = createServiceRoleClient()
  const requestedBusinessId = process.argv[2]

  let businessIds: string[]
  if (requestedBusinessId) {
    businessIds = [requestedBusinessId]
  } else {
    const { data, error } = await client
      .from('post_edit_signals')
      .select('business_id')
    if (error) throw new Error(error.message)
    businessIds = [...new Set((data ?? []).map((r) => (r as { business_id: string }).business_id))]
  }

  if (businessIds.length === 0) {
    console.log('No businesses with any learning signals yet.')
    return
  }

  for (const businessId of businessIds) {
    await reportForBusiness(client, businessId)
  }
}

main().catch((err) => {
  console.error('learning-report failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
