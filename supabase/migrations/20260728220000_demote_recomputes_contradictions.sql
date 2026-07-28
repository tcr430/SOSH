-- Session 25-D correction pass (MINOR-8) — ADR 0018 §7.4.
--
-- [db-MINOR-3] adopted "the same rigor as promotion" for demotion's atomic
-- guard, but promotion's three gates are ALL evaluated from stored columns
-- plus one live correlated subquery — genuinely atomic — while demotion
-- trusted `p_net`, a value COMPUTED IN TYPESCRIPT (lib/learning/promote.ts)
-- and passed in as a plain numeric argument. The DB never re-derived it; a
-- caller bug or a stale value would demote (or fail to demote) on faith.
-- That was not "the same rigor," even though the disposition table read as
-- if it were.
--
-- Fix: demote_performance_pattern now recomputes the contradiction count
-- ITSELF, via a correlated subquery over post_edit_signals keyed on
-- p_contradicting_pattern_key (the TS side already computes this key at
-- lib/learning/pattern-key.ts's computeContradictingPatternKey — it now
-- passes the KEY, not the NET, exactly the shape this migration's own
-- comment anticipated). net = observation_count (the row's own, freshly
-- recomputed and stored column, per §9.6) minus that live count. When
-- p_contradicting_pattern_key IS NULL (a PreferenceKind with no natural
-- opposite — avoid_word_removed, hashtag_delta, link_moved,
-- numbering_stripped — computeContradictingPatternKey returns null for all
-- four), `pes.pattern_key = NULL` is never true for any row, so the
-- subquery correctly yields 0 contradictions without a special case.
--
-- Filters mirror countProcessedSignalsForPattern (lib/db/memory-
-- performance.ts) exactly: business_id, pattern_key, status='processed',
-- class='preference' — the same class filter that keeps a reclassified
-- signal from ever inflating (or here, deflating via net) the count again.
--
-- This is a DROP + CREATE, not a CREATE OR REPLACE alone: the parameter
-- list changes (p_net numeric -> p_contradicting_pattern_key text), and
-- Postgres does not allow CREATE OR REPLACE FUNCTION to change a function's
-- signature — only its body. The old five-argument overload is dropped so
-- no stale grant survives under a signature nothing calls anymore.

DROP FUNCTION IF EXISTS public.demote_performance_pattern(uuid, text, text, text, numeric);

CREATE FUNCTION public.demote_performance_pattern(
  p_business_id               uuid,
  p_pattern_key               text,
  p_dimension                 text,
  p_platform                  text,
  p_contradicting_pattern_key text
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
     AND (
       observation_count - (
         SELECT count(*)
           FROM public.post_edit_signals pes
          WHERE pes.business_id = p_business_id
            AND pes.pattern_key = p_contradicting_pattern_key
            AND pes.status = 'processed'
            AND pes.class = 'preference'
       )
     ) < 3
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.demote_performance_pattern(uuid, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.demote_performance_pattern(uuid, text, text, text, text) TO service_role;
