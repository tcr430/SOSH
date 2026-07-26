-- ADR 0018 §7 (Session 25 C2.6) — the first performance_memory writer plus
-- the atomic promotion/demotion RPCs.
--
-- Three SECURITY DEFINER functions, mirroring claim_post_edit_signals
-- (20260726010000_learning_capture.sql:231-249) and claim_email_outbox
-- (20260607100000_email_outbox.sql:49-64) in posture: REVOKE ALL FROM
-- public, GRANT EXECUTE TO service_role only. All three are called from
-- lib/db/memory-performance.ts under the service-role client (this is a
-- background distillation path, never an authenticated user action).
--
-- Why raw SQL rather than supabase-js .upsert()/.update(): the upsert's
-- conflict target must repeat the PARTIAL unique index predicate
-- (`WHERE source='distilled' AND deleted_at IS NULL`,
-- performance_memory_distilled_pattern_key_uq — 20260726020000_performance_
-- memory_pattern_key.sql:26-28) and the promotion/demotion guards need a
-- correlated subquery (COUNT DISTINCT campaign_id) inside the WHERE clause.
-- Neither is expressible through the supabase-js query builder — a bare
-- `.upsert({ onConflict: '...' })` does NOT resolve to a partial index, and
-- there is no builder API for a WHERE-clause subquery. This is not a style
-- choice; it is why claim_post_edit_signals and claim_email_outbox are also
-- raw SQL RPCs rather than query-builder calls.

-- ─── upsert_distilled_performance_pattern (§7.1) ────────────────────────────
--
-- Fixed governance values per §7.1's table: source='distilled',
-- sensitivity='internal', public_use_permission=false. status is NOT set by
-- this function — it defaults to 'candidate' on INSERT (table default,
-- 20260719010000_governed_memory.sql:213) and is deliberately left
-- UNTOUCHED on a conflicting re-observation, so a re-observation of an
-- already-'active' pattern cannot silently flip it back, and a 'retired'
-- pattern is never silently resurrected by a new observation alone —
-- promotion/demotion below are the only status-changing paths.
--
-- likes/impressions are not columns on this table at all (§7.1's
-- "OMIT likes and impressions entirely" — Session 23-E, commit 6149535f) —
-- there is nothing to omit here at the SQL layer; the omission is enforced
-- by PerformancePattern's TS shape (lib/memory/performance.ts:11-23) and by
-- this function's parameter list simply not accepting them.
CREATE OR REPLACE FUNCTION public.upsert_distilled_performance_pattern(
  p_business_id       uuid,
  p_dimension         text,
  p_pattern           text,
  p_pattern_key       text,
  p_platform          text,
  p_scope             text,
  p_scope_ref         text,
  p_confidence        numeric,
  p_observation_count int
)
RETURNS SETOF public.performance_memory
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.performance_memory (
    business_id, source, sensitivity, public_use_permission,
    scope, scope_ref, dimension, pattern, pattern_key, platform,
    confidence, observation_count, last_confirmed_at, expires_at
  ) VALUES (
    p_business_id, 'distilled', 'internal', false,
    p_scope, p_scope_ref, p_dimension, p_pattern, p_pattern_key, p_platform,
    p_confidence, p_observation_count, now(), now() + make_interval(days => 90)
  )
  ON CONFLICT (business_id, dimension, coalesce(platform, ''), pattern_key)
    WHERE source = 'distilled' AND deleted_at IS NULL
  DO UPDATE SET
    pattern           = EXCLUDED.pattern,
    confidence        = EXCLUDED.confidence,
    observation_count = EXCLUDED.observation_count,
    last_confirmed_at = EXCLUDED.last_confirmed_at,
    expires_at        = EXCLUDED.expires_at
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.upsert_distilled_performance_pattern(uuid, text, text, text, text, text, text, numeric, int) FROM public;
GRANT EXECUTE ON FUNCTION public.upsert_distilled_performance_pattern(uuid, text, text, text, text, text, text, numeric, int) TO service_role;

-- ─── promote_performance_pattern (§7.3) ─────────────────────────────────────
--
-- ONE atomic conditional UPDATE — matching approvePost's guard pattern
-- (lib/db/posts.ts:329-336) at the SQL level. observation_count and
-- confidence are read here as whatever upsert_distilled_performance_pattern
-- most recently wrote (already fresh — recomputed and stored by that
-- function's caller, lib/db/memory-performance.ts, per §9.6). Only the
-- distinct-campaign gate is evaluated live here, via a correlated subquery,
-- because it is cheap and this is the one place it must be atomic with the
-- status flip.
--
-- The literal thresholds (5 / 0.70 / 2) duplicate
-- lib/learning/promote.ts's LEARN_PROMOTION_MIN_OBSERVATIONS /
-- _MIN_CONFIDENCE / _MIN_DISTINCT_CAMPAIGNS constants — SQL cannot import a
-- TS constant. This is the same accepted duplication as every CHECK
-- constraint in this codebase that mirrors a TS enum; if the TS constants
-- ever change, this function must change with them.
--
-- [db-Q6] Postgres evaluates the whole predicate — including the subquery —
-- against one MVCC snapshot and takes the row lock before applying the
-- UPDATE, so two concurrent calls for the same pattern cannot both promote:
-- the second sees status already 'active' (if the first committed first) or
-- blocks on the row lock and re-evaluates against the first's committed
-- result (if concurrent). Double-promotion is structurally impossible, not
-- merely unlikely.
CREATE OR REPLACE FUNCTION public.promote_performance_pattern(
  p_business_id uuid,
  p_pattern_key text,
  p_dimension   text,
  p_platform    text
)
RETURNS SETOF public.performance_memory
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.performance_memory
     SET status = 'active'
   WHERE business_id = p_business_id
     AND pattern_key = p_pattern_key
     AND dimension = p_dimension
     AND coalesce(platform, '') = coalesce(p_platform, '')
     AND source = 'distilled'
     AND deleted_at IS NULL
     AND status = 'candidate'
     AND observation_count >= 5
     AND confidence >= 0.70
     AND (
       SELECT count(DISTINCT pes.campaign_id)
         FROM public.post_edit_signals pes
        WHERE pes.business_id = p_business_id
          AND pes.pattern_key = p_pattern_key
          AND pes.status = 'processed'
     ) >= 2
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.promote_performance_pattern(uuid, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.promote_performance_pattern(uuid, text, text, text) TO service_role;

-- ─── demote_performance_pattern (§7.4) ──────────────────────────────────────
--
-- Never deletes — moves an 'active' row back to 'candidate', preserving the
-- audit trail and observation history (§7.4). Carries the SAME explicit
-- .eq('status','active')-equivalent guard as promotion ([db-MINOR-3]),
-- spelled out here rather than left to prose. p_net is computed by the
-- caller (lib/learning/promote.ts's computeConfidence's net = observations
-- - contradictions) and passed in, since "contradictions" has no stored
-- column to recompute from inside this function.
CREATE OR REPLACE FUNCTION public.demote_performance_pattern(
  p_business_id uuid,
  p_pattern_key text,
  p_dimension   text,
  p_platform    text,
  p_net         numeric
)
RETURNS SETOF public.performance_memory
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.performance_memory
     SET status = 'candidate'
   WHERE business_id = p_business_id
     AND pattern_key = p_pattern_key
     AND dimension = p_dimension
     AND coalesce(platform, '') = coalesce(p_platform, '')
     AND source = 'distilled'
     AND deleted_at IS NULL
     AND status = 'active'
     AND p_net < 3
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.demote_performance_pattern(uuid, text, text, text, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.demote_performance_pattern(uuid, text, text, text, numeric) TO service_role;

-- RLS + erasure cascade are UNAFFECTED: no schema change to performance_memory
-- itself here (no new column, no new table), only new SECURITY DEFINER
-- functions operating on the existing, already-cascaded, already-RLS-enabled
-- table. docs/decisions/0010-legal-surface.md §D2.5's existing
-- performance_memory row already covers it.
