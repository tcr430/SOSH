import type { SupabaseClient } from '@supabase/supabase-js'
import type { PerformanceMemoryRow, PerformanceMemoryInsert } from './types'
import { getErrorMessage } from './utils'
import { MEMORY_CANDIDATE_LIMIT } from './memory-constants'
import { neutralizeWithSentinels } from '@/lib/ai/wrap-evidence'

// ADR 0016 §5.1 (Q4) — candidate query only. No scoring, no capping; that is
// lib/memory/performance.ts's job (B2), which also prefers this table's
// rows over the post_metrics-derived fallback once Track C populates it
// (ADR §3.4). business_id is filtered explicitly because the generation
// path reads via service-role, which bypasses RLS (ADR §4).
export async function listPerformanceMemoryCandidates(
  client: SupabaseClient,
  businessId: string,
  limit = MEMORY_CANDIDATE_LIMIT,
): Promise<PerformanceMemoryRow[]> {
  const { data, error } = await client
    .from('performance_memory')
    .select('*')
    .eq('business_id', businessId)
    .eq('status', 'active')
    .is('deleted_at', null)
    // [Session 25-D correction, MINOR-6] upsert_distilled_performance_pattern
    // writes expires_at = now() + 90 days on every upsert (ADR §7.1), but
    // until this filter NOTHING read it — a 90-day-stale active pattern
    // still reached generation, making the decay column write-only. This is
    // the ONE generation-time reader; NULL is included because manual/import
    // rows (source != 'distilled') never get an expires_at at all and must
    // not be treated as expired by omission.
    .or('expires_at.is.null,expires_at.gt.now()')
    .order('confidence', { ascending: false })
    .order('recency_at', { ascending: false }) // = COALESCE(last_confirmed_at, created_at), matches performance_memory_retrieval_idx
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as PerformanceMemoryRow[]) ?? []
}

// ADR 0018 §6.1 (Session 25 C2.7) — the summarizer's "signal summaries for
// one business" input. Deliberately not filtered to status='active' (unlike
// listPerformanceMemoryCandidates, which serves generation-time retrieval
// and must only surface promoted rows, LEARN-NO-SINGLE-DIFF-PROMOTION): the
// summarizer needs visibility into EVERY distilled pattern already
// established for this business, promoted or not, so it can avoid
// re-surfacing something already named. Excludes 'retired' (soft-retired
// via status, not just deleted_at) since a retired pattern is exactly the
// kind of stale signal the summarizer should not be reminded of.
//
// security-reviewer (C2.7 pass; premise corrected Session 29 F1b.10, ADR
// 0022 §17.1): despite "distilled" implying arithmetic Tier-0 output,
// source='distilled' rows returned here are NOT guaranteed to be
// deterministic/arithmetic — the summarizer itself (lib/ai/prompts/
// learning-summarizer.ts) is a live writer of this bucket via
// upsertDistilledPerformancePattern below, and so is the arithmetic Tier-0
// writer (lib/learning/promote.ts's recomputeAndUpsertPattern, called from
// lib/learning/orchestrator.ts's tick loop) — BOTH are live, and there is
// no column distinguishing the two. Callers of this function MUST treat
// every returned `pattern` string as untrusted, attacker-reachable-adjacent
// text — see learning-summarizer.ts's guardTierZeroSummaries(), which
// neutralize()s it.
//
// [Session 25-D correction, MINOR-6] Deliberately NOT filtered on
// expires_at, unlike listPerformanceMemoryCandidates above. The summarizer
// reads its OWN prior history back (tierZeroSummaries) to avoid re-surfacing
// a pattern it has already named — a decayed-but-not-yet-retired pattern is
// still a real thing this business's editors did, and excluding it here
// would just cause the summarizer to re-describe it as if it were new. Only
// the generation-time reader needs expires_at enforced, because that is the
// one place a stale pattern could shape a NEW post.
export async function listDistilledPatternsForSummary(
  client: SupabaseClient,
  businessId: string,
  limit = MEMORY_CANDIDATE_LIMIT,
): Promise<PerformanceMemoryRow[]> {
  const { data, error } = await client
    .from('performance_memory')
    .select('*')
    .eq('business_id', businessId)
    .eq('source', 'distilled')
    .neq('status', 'retired')
    .is('deleted_at', null)
    .order('confidence', { ascending: false })
    .order('recency_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as PerformanceMemoryRow[]) ?? []
}

// ADR 0018 §7.1/§7.2 (Session 25 C2.6) — THE FIRST WRITER for this table.
// Routes through upsert_distilled_performance_pattern (20260726030000_
// performance_memory_promotion.sql) rather than a plain supabase-js
// `.upsert()`: the conflict target must repeat the partial index's own
// predicate (`WHERE source='distilled' AND deleted_at IS NULL`,
// performance_memory_distilled_pattern_key_uq), which the query builder's
// onConflict option cannot express — a bare `.upsert({ onConflict: '...' })`
// does NOT resolve to a partial index. Governance columns (source, status,
// sensitivity, public_use_permission) are fixed inside the RPC itself, per
// §7.1's table — never accepted as caller input here.
// ADR 0022 §11.1 MEM-PATTERN-SENTINEL-GUARDED / A-5 (Session 29-D, MAJOR-1) —
// insert.pattern's provenance chain is NOT uniformly trusted: this is the
// SOLE writer of performance_memory (both production callers —
// lib/learning/summarize.ts's LLM-synthesized statements, which echo
// listRecentHumanEditExcerpts' human-authored prose, and
// lib/learning/promote.ts's deterministic template — route through here,
// and there is no third write path). neutralizeWithSentinels() (the SAME
// function guard.ts and wrap-evidence.ts already use, per ADR 0018 Amd A.3 —
// not a second copy) is applied at THIS single choke point rather than at
// each producer, so the guard holds regardless of which caller's
// composition touches human text and regardless of any future caller added
// here. Plain neutralize() is deliberately NOT used: it lacks the \p{Co}
// plane-15 marker-sentinel strip this boundary needs (ADR §5.1).
export async function upsertDistilledPerformancePattern(
  client: SupabaseClient,
  insert: PerformanceMemoryInsert,
): Promise<PerformanceMemoryRow> {
  const { data, error } = await client.rpc('upsert_distilled_performance_pattern', {
    p_business_id: insert.business_id,
    p_dimension: insert.dimension,
    p_pattern: neutralizeWithSentinels(insert.pattern),
    p_pattern_key: insert.pattern_key,
    p_platform: insert.platform,
    p_scope: insert.scope,
    p_scope_ref: insert.scope_ref,
    p_confidence: insert.confidence,
    p_observation_count: insert.observation_count,
  })
  if (error) throw new Error(getErrorMessage(error))
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('upsert_distilled_performance_pattern returned no row')
  return row as PerformanceMemoryRow
}

// ADR 0018 §9.6 — observation_count is RECOMPUTED from post_edit_signals,
// NEVER incremented: `COUNT(*) ... WHERE business_id = $1 AND pattern_key =
// $2 AND status = 'processed'`. An increment can be replayed under a
// re-delivered tick; a recompute cannot — this makes double-counting
// arithmetically impossible rather than merely guarded against.
//
// database-reviewer (C2.6 pass, MAJOR): `class = 'preference'` is filtered
// HERE, not left to LEARN-VOICE-WRITE-TRIGGER alone. Every pattern_key this
// track produces comes from lib/learning/pattern-key.ts's
// computePatternKey(), which only ever accepts a PreferenceSignal — so a
// contributing post_edit_signals row for one of these keys must be
// class='preference' by construction. Filtering it here means a signal that
// gets RECLASSIFIED away from 'preference' after a row already exists is
// automatically excluded from every future recompute, so it can never
// inflate observation_count/confidence again — regardless of whether the
// upsert's ON CONFLICT DO UPDATE happens to re-trigger the DB guard (it does
// NOT: the conflict target is exactly (business_id, dimension,
// coalesce(platform,''), pattern_key), so a conflict-triggered UPDATE never
// touches those columns and never re-arms
// enforce_voice_write_preference_only's OLD/NEW re-check). The DB trigger is
// still real defense-in-depth for insert-time and any other write path
// (a manual backfill, a future correction-derived writer that also touches
// this table) — it is no longer the SOLE thing keeping a tainted signal out
// of this table's arithmetic.
export async function countProcessedSignalsForPattern(
  client: SupabaseClient,
  businessId: string,
  patternKey: string,
): Promise<number> {
  const { count, error } = await client
    .from('post_edit_signals')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('pattern_key', patternKey)
    .eq('status', 'processed')
    .eq('class', 'preference')
  if (error) throw new Error(getErrorMessage(error))
  return count ?? 0
}

// ADR 0018 §7.3 — ONE atomic conditional UPDATE, matching approvePost's
// guard pattern (lib/db/posts.ts:329-336) at the SQL level: status,
// observation_count, and confidence are all re-checked in the same
// statement that flips status, so a read-then-update race window never
// opens. Returns null (not an error) when the guard did not hold — that is
// the expected, correct outcome for a pattern that isn't ready yet, exactly
// like approvePost's "already approved" no-op case.
export async function promotePerformancePattern(
  client: SupabaseClient,
  businessId: string,
  patternKey: string,
  dimension: string,
  platform: string | null,
): Promise<PerformanceMemoryRow | null> {
  const { data, error } = await client.rpc('promote_performance_pattern', {
    p_business_id: businessId,
    p_pattern_key: patternKey,
    p_dimension: dimension,
    p_platform: platform,
  })
  if (error) throw new Error(getErrorMessage(error))
  const row = Array.isArray(data) ? data[0] : data
  return (row as PerformanceMemoryRow | undefined) ?? null
}

// ADR 0018 §7.4 — never deletes; moves an 'active' row back to 'candidate',
// preserving the audit trail and observation history. Carries the SAME
// explicit status='active' guard as promotion.
//
// [Session 25-D correction, MINOR-8] `net` used to be computed by the
// caller and passed in as a plain numeric argument — trusted, not
// recomputed, which was NOT "the same rigor as promotion" ([db-MINOR-3])
// despite the disposition table reading as if it were. The RPC now
// recomputes the contradiction count ITSELF from `contradictingPatternKey`
// via a correlated subquery (net = the row's own stored `observation_count`
// minus a live COUNT over post_edit_signals), genuinely atomic like
// promotion's campaign gate. Pass the KEY (from
// lib/learning/pattern-key.ts's computeContradictingPatternKey), never a
// pre-computed net.
export async function demotePerformancePattern(
  client: SupabaseClient,
  businessId: string,
  patternKey: string,
  dimension: string,
  platform: string | null,
  contradictingPatternKey: string | null,
): Promise<PerformanceMemoryRow | null> {
  const { data, error } = await client.rpc('demote_performance_pattern', {
    p_business_id: businessId,
    p_pattern_key: patternKey,
    p_dimension: dimension,
    p_platform: platform,
    p_contradicting_pattern_key: contradictingPatternKey,
  })
  if (error) throw new Error(getErrorMessage(error))
  const row = Array.isArray(data) ? data[0] : data
  return (row as PerformanceMemoryRow | undefined) ?? null
}
