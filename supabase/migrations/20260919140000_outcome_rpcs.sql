-- Migration: the outcome RPCs, the promotion floor, and the north-star
-- (ADR 0026 §5.4, §6.4, §7, §8.4, §8.5 — Session 33 J2.6)
--
-- EVERY SQL PATH THAT WRITES OR TRANSITIONS AN OUTCOME ROW LIVES HERE, so the first promotion
-- that ever runs is gated by construction. The floor NEVER trusts a caller:
--   * upsert_outcome_performance_pattern takes NO stats parameters (only what identifies the cell
--     and the human-readable text);
--   * promote / demote are ONE conditional UPDATE each that RECOMPUTES n, wins, distinct campaigns
--     and the Wilson bound from post_outcomes JOIN post_dimensions — never from the row's stored
--     outcome_n (a test forges the stored value and proves it is ignored);
--   * public.wilson_bounds is THE ONE COPY of the formula ([db-5]); public.outcome_cell_stats is
--     THE ONE COPY of the cell recomputation, and every RPC calls both. Nothing inlines either, so
--     upsert, promote and demote can never disagree about what a cell contains.
--
-- DIRECTION. A cell is (business, platform, dimension, value) plus a direction. ADR 0026 §6.4 gates
-- an "above-usual" pattern on wilson_low > 0.5 and a "below-usual" one on wilson_high < 0.5 (both
-- over the count of posts that BEAT their baseline). This file works in the direction-matching count
-- instead: wins = observations that agree with the pattern's direction (beat the baseline for
-- 'above', missed it for 'below'). By the symmetry of the Wilson interval,
-- low(k, n) = 1 - high(n - k, n), so "low over direction-matching wins > 0.5" IS the ADR's below rule
-- (and the stored interval and confidence are the direction-matching ones, which is exactly what §6.4's
-- "(1 - wilson_high)" confidence expression yields). The Tier-1 mirror test pins that identity.
--
-- SQL TWINS of lib/outcomes/constants.ts (the accepted ADR 0018 duplicate-constant trade-off; statistical
-- constants are code, never env; lib/outcomes/__tests__/constants.test.ts pins the TS side):
--   OUTCOME_WILSON_Z 1.96          OUTCOME_WINDOW_DAYS 180        OUTCOME_PROVISIONAL_N 5
--   OUTCOME_MIN_N 10               OUTCOME_MIN_DISTINCT_CAMPAIGNS 3    OUTCOME_CONFIDENCE_SHRINK_K 10
--   OUTCOME_PATTERN_TTL_DAYS 90    OUTCOME_FAST_CONTRA_LAST 5     OUTCOME_FAST_CONTRA_MIN 4
--   OUTCOME_HYPOTHESIS_TTL_DAYS 365
--
-- GRANTS. Every function is SECURITY DEFINER with a pinned search_path, REVOKEd from
-- public/anon/authenticated and GRANTed to service_role only (a missing REVOKE on a DEFINER function
-- is a privilege escalation). Every table read is filtered by business_id, EXCEPT
-- get_learning_cycles_northstar, which is an operator aggregate across brands BY DESIGN and returns
-- counts only (ADR 0026 §8.5) — no row, no identifier, no text.
--
-- acknowledge_campaign_retrospective DEVIATIONS from ADR 0026 §8.4, recorded here: (1) the ADR lists
-- three parameters; p_pattern_text is the fourth because neutralizeWithSentinels is a TypeScript
-- function and §8.4 requires it on this text (the RPC still derives every stat itself); (2) an optional
-- FIFTH, p_note, because the acknowledged state carries the member's note (§10.2, campaign_retrospectives
-- .note) and the RPC is the only writer of that transition; (3) the hypothesis row's metric_basis is
-- derived from the campaign's own outcomes ('rate' only if every one is rate-basis, else 'count'),
-- because a retrospective has no basis column of its own and the win/loss it summarises is
-- basis-agnostic.

-- ─── wilson_bounds — THE ONE COPY of the formula ─────────────────────────────

CREATE OR REPLACE FUNCTION public.wilson_bounds(p_wins int, p_n int, p_z numeric)
RETURNS TABLE (low numeric, high numeric)
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  n      float8 := p_n::float8;
  z      float8 := p_z::float8;
  p      float8;
  denom  float8;
  centre float8;
  margin float8;
BEGIN
  IF p_n IS NULL OR p_n <= 0 THEN
    -- No observations: the vacuous interval. low = 0 fails every "low > 0.5" gate.
    RETURN QUERY SELECT 0::numeric, 1::numeric;
    RETURN;
  END IF;
  IF p_wins IS NULL OR p_wins < 0 OR p_wins > p_n THEN
    RAISE EXCEPTION 'wilson_bounds: wins % must be between 0 and n %', p_wins, p_n;
  END IF;
  p      := p_wins::float8 / n;
  denom  := 1 + z * z / n;
  centre := p + z * z / (2 * n);
  margin := z * sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  RETURN QUERY SELECT greatest(0, (centre - margin) / denom)::numeric,
                      least(1,    (centre + margin) / denom)::numeric;
END;
$$;

-- ─── outcome_cell_stats — THE ONE COPY of the cell recomputation ─────────────
-- Observations: post_outcomes in the 180-day window with a baseline (beat_baseline IS NOT NULL),
-- joined to the post's LATEST-revision post_dimensions row for generation-time dimensions (role,
-- format, origin_mode; post_outcomes.ai_original_id already points at the latest revision), or read
-- from post_outcomes for MEASURED ones (length_band, cta). A human-written post has no snapshot and so
-- never appears in a generation-time cell. Every table read is filtered by business_id.

CREATE OR REPLACE FUNCTION public.outcome_cell_stats(
  p_business_id uuid,
  p_dimension   text,
  p_value       text,
  p_platform    text,
  p_direction   text
)
RETURNS TABLE (
  s_n int, s_wins int, s_campaigns int, s_low numeric, s_high numeric, s_basis text,
  s_seeded boolean, s_last_agree timestamptz, s_newest timestamptz, s_l5_n int, s_l5_against int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agree boolean;
BEGIN
  IF p_direction NOT IN ('above', 'below') THEN
    RAISE EXCEPTION 'outcome_cell_stats: direction must be above or below, got %', p_direction;
  END IF;
  IF p_dimension IN ('hook', 'proof_type') THEN
    RAISE EXCEPTION 'outcome_cell_stats: dimension % is descriptive-only and can never be an outcome pattern (ADR 0026 s4.1)', p_dimension;
  END IF;
  IF p_dimension NOT IN ('role', 'format', 'length_band', 'cta', 'origin_mode') THEN
    RAISE EXCEPTION 'outcome_cell_stats: dimension % is not a promotable outcome dimension', p_dimension;
  END IF;
  IF p_dimension = 'cta' AND p_value NOT IN ('true', 'false') THEN
    RAISE EXCEPTION 'outcome_cell_stats: cta value must be true or false, got %', p_value;
  END IF;
  v_agree := (p_direction = 'above');

  RETURN QUERY
  WITH obs AS (
    SELECT o.post_id, o.campaign_id, o.published_at, o.metric_basis AS basis, o.baseline_source,
           (o.beat_baseline = v_agree) AS agrees
      FROM public.post_outcomes AS o
      LEFT JOIN public.post_dimensions AS d
        ON d.ai_original_id = o.ai_original_id AND d.business_id = p_business_id
     WHERE o.business_id = p_business_id
       AND o.platform = p_platform
       AND o.published_at >= now() - interval '180 days'          -- OUTCOME_WINDOW_DAYS
       AND o.beat_baseline IS NOT NULL
       AND CASE p_dimension
             WHEN 'role'        THEN d.role = p_value
             WHEN 'format'      THEN d.format = p_value
             WHEN 'origin_mode' THEN d.origin_mode = p_value
             WHEN 'length_band' THEN o.length_band = p_value
             WHEN 'cta'         THEN o.cta_present = (p_value = 'true')
           END
  ),
  agg AS (
    SELECT count(*)::int                                   AS n,
           count(*) FILTER (WHERE agrees)::int             AS wins,
           count(DISTINCT campaign_id)::int                AS campaigns,
           count(DISTINCT basis)                           AS bases,
           min(basis)                                      AS basis,
           coalesce(bool_or(baseline_source = 'import_seed'), false) AS seeded,
           max(published_at) FILTER (WHERE agrees)         AS last_agree,
           max(published_at)                               AS newest
      FROM obs
  ),
  ranked AS (
    SELECT agrees, row_number() OVER (ORDER BY published_at DESC, post_id DESC) AS rn FROM obs
  ),
  last5 AS (
    -- OUTCOME_FAST_CONTRA_LAST 5: the cell's last five observations by published_at.
    SELECT count(*)::int AS c, count(*) FILTER (WHERE NOT agrees)::int AS against
      FROM ranked WHERE rn <= 5
  )
  SELECT agg.n, agg.wins, agg.campaigns, b.low, b.high,
         CASE WHEN agg.bases > 1 THEN NULL ELSE agg.basis END,
         agg.seeded, agg.last_agree, agg.newest, last5.c, last5.against
    FROM agg
   CROSS JOIN LATERAL public.wilson_bounds(agg.wins, agg.n, 1.96) AS b   -- OUTCOME_WILSON_Z
   CROSS JOIN last5;
END;
$$;

-- ─── upsert_outcome_performance_pattern ──────────────────────────────────────
-- Takes NO stats. Writes only when the recomputed n >= 5 (OUTCOME_PROVISIONAL_N): a 'candidate' is the
-- UI's provisional state and can never reach generation (isEligible requires 'active'). Fixed IN SQL:
-- source 'outcome', status 'candidate' on INSERT (an existing row — possibly already 'active' — KEEPS
-- its status and contradicted_at: the DO UPDATE leaves both alone), sensitivity 'internal',
-- public_use_permission false. The pattern KEY is built here from the identified cell, never supplied.

CREATE OR REPLACE FUNCTION public.upsert_outcome_performance_pattern(
  p_business_id  uuid,
  p_dimension    text,
  p_value        text,
  p_platform     text,
  p_direction    text,
  p_pattern_text text
)
RETURNS public.performance_memory
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s      record;
  v_key  text;
  v_last timestamptz;
  v_row  public.performance_memory;
BEGIN
  IF p_dimension IN ('hook', 'proof_type') THEN
    RAISE EXCEPTION 'upsert_outcome_performance_pattern: dimension % is descriptive-only (OUTCOME-DESCRIPTIVE-ONLY)', p_dimension;
  END IF;
  IF p_pattern_text IS NULL OR btrim(p_pattern_text) = '' THEN
    RAISE EXCEPTION 'upsert_outcome_performance_pattern: pattern text is required';
  END IF;

  SELECT * INTO s FROM public.outcome_cell_stats(p_business_id, p_dimension, p_value, p_platform, p_direction);
  IF s.s_n < 5 THEN                                                   -- OUTCOME_PROVISIONAL_N
    RETURN NULL;
  END IF;
  IF s.s_basis IS NULL THEN
    RAISE EXCEPTION 'upsert_outcome_performance_pattern: a cell must not mix rate- and count-basis observations';
  END IF;

  v_key  := format('outcome:%s:%s:%s:%s', p_dimension, p_value, p_direction, p_platform);
  v_last := coalesce(s.s_last_agree, s.s_newest);                     -- newest AGREEING observation

  INSERT INTO public.performance_memory (
    business_id, source, status, sensitivity, public_use_permission, scope, scope_ref,
    dimension, pattern, pattern_key, platform, confidence, observation_count,
    last_confirmed_at, expires_at,
    outcome_n, outcome_wins, outcome_distinct_campaigns, interval_low, interval_high, metric_basis, baseline_seeded
  ) VALUES (
    p_business_id, 'outcome', 'candidate', 'internal', false, 'platform', p_platform,
    p_dimension, p_pattern_text, v_key, p_platform,
    round(s.s_low * s.s_n / (s.s_n + 10), 2),                         -- OUTCOME_CONFIDENCE_SHRINK_K 10
    s.s_n,
    v_last, v_last + interval '90 days',                              -- OUTCOME_PATTERN_TTL_DAYS
    s.s_n, s.s_wins, s.s_campaigns, round(s.s_low, 3), round(s.s_high, 3), s.s_basis, s.s_seeded
  )
  ON CONFLICT (business_id, dimension, coalesce(platform, ''), pattern_key)
    WHERE source = 'outcome' AND deleted_at IS NULL
  DO UPDATE SET
    pattern                    = EXCLUDED.pattern,
    confidence                 = EXCLUDED.confidence,
    observation_count          = EXCLUDED.observation_count,
    last_confirmed_at          = EXCLUDED.last_confirmed_at,
    expires_at                 = EXCLUDED.expires_at,
    outcome_n                  = EXCLUDED.outcome_n,
    outcome_wins               = EXCLUDED.outcome_wins,
    outcome_distinct_campaigns = EXCLUDED.outcome_distinct_campaigns,
    interval_low               = EXCLUDED.interval_low,
    interval_high              = EXCLUDED.interval_high,
    metric_basis               = EXCLUDED.metric_basis,
    baseline_seeded            = EXCLUDED.baseline_seeded
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ─── promote_outcome_pattern — ONE conditional UPDATE, floor recomputed ──────
-- The predicate is evaluated for the row this statement locks (the [db-Q6] property of
-- promote_performance_pattern, 20260726030000:102-131): a concurrent transition re-checks
-- status = 'candidate' against the row's newest version, so a double promotion is impossible.
-- Key layout: outcome:<dimension>:<value>:<direction>:<platform> — no value contains a colon.
-- All three gates are independently load-bearing: n >= 10 (OUTCOME_MIN_N), >= 3 distinct campaigns
-- (OUTCOME_MIN_DISTINCT_CAMPAIGNS) and the Wilson bound clearing 0.5 — see the direction note above.

CREATE OR REPLACE FUNCTION public.promote_outcome_pattern(p_business_id uuid, p_pattern_key text)
RETURNS SETOF public.performance_memory
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.performance_memory AS pm
     SET status = 'active'
   WHERE pm.business_id = p_business_id
     AND pm.pattern_key = p_pattern_key
     AND pm.source = 'outcome'
     AND pm.status = 'candidate'
     AND pm.deleted_at IS NULL
     AND pm.dimension <> 'hypothesis'
     AND EXISTS (
       SELECT 1
         FROM public.outcome_cell_stats(
                pm.business_id, pm.dimension, split_part(pm.pattern_key, ':', 3), pm.platform,
                split_part(pm.pattern_key, ':', 4)) AS s
        WHERE s.s_n >= 10 AND s.s_campaigns >= 3 AND s.s_low > 0.5
     )
  RETURNING pm.*;
$$;

-- ─── demote_outcome_pattern — ONE conditional UPDATE, recomputes its own inputs ─
-- (the 20260728220000 lesson). active -> candidate, NEVER a delete, so history survives. Demotes when
-- EITHER the recomputed window bound stops clearing 0.5 (hysteresis: promotion needs n >= 10 AND 3
-- campaigns AND the bound; demotion only needs the bound to fail) OR the fast trigger fires: at least 4
-- (OUTCOME_FAST_CONTRA_MIN) of the cell's last 5 (OUTCOME_FAST_CONTRA_LAST) observations by
-- published_at go AGAINST the direction. Two concurrent calls: the second re-checks status = 'active'
-- against the updated row and matches nothing — one transition, contradicted_at set once.

CREATE OR REPLACE FUNCTION public.demote_outcome_pattern(p_business_id uuid, p_pattern_key text)
RETURNS SETOF public.performance_memory
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.performance_memory AS pm
     SET status = 'candidate', contradicted_at = now()
   WHERE pm.business_id = p_business_id
     AND pm.pattern_key = p_pattern_key
     AND pm.source = 'outcome'
     AND pm.status = 'active'
     AND pm.deleted_at IS NULL
     AND pm.dimension <> 'hypothesis'
     AND EXISTS (
       SELECT 1
         FROM public.outcome_cell_stats(
                pm.business_id, pm.dimension, split_part(pm.pattern_key, ':', 3), pm.platform,
                split_part(pm.pattern_key, ':', 4)) AS s
        WHERE s.s_low <= 0.5 OR (s.s_l5_n = 5 AND s.s_l5_against >= 4)
     )
  RETURNING pm.*;
$$;

-- ─── acknowledge_campaign_retrospective — the ADR 0025 ratify shape ──────────
-- p_user_id is checked against business_members (active, NON-viewer) — the caller derives it from
-- supabase.auth.getUser() on the anon server client, never a form field. One conditional UPDATE moves
-- completed -> acknowledged; a second call matches nothing and is a no-op (returns NULL). For supported /
-- not_supported it writes EXACTLY ONE performance_memory row (ADR 0026 §8.4); inconclusive writes none.
-- The whole call is one transaction: any RAISE below undoes the acknowledgement.

CREATE OR REPLACE FUNCTION public.acknowledge_campaign_retrospective(
  p_business_id  uuid,
  p_campaign_id  uuid,
  p_user_id      uuid,
  p_pattern_text text,
  p_note         text DEFAULT NULL
)
RETURNS public.campaign_retrospectives
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row    public.campaign_retrospectives;
  v_low    numeric;
  v_high   numeric;
  v_basis  text;
  v_seeded boolean;
  v_conf   numeric;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.business_members
     WHERE business_id = p_business_id
       AND user_id = p_user_id
       AND status = 'active'
       AND role <> 'viewer'
  ) THEN
    RAISE EXCEPTION 'user % is not an active, non-viewer member of business %', p_user_id, p_business_id
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.campaign_retrospectives AS r
     SET status = 'acknowledged', acknowledged_at = now(), acknowledged_by = p_user_id, note = p_note
   WHERE r.campaign_id = p_campaign_id
     AND r.business_id = p_business_id
     AND r.status = 'completed'
  RETURNING r.* INTO v_row;

  IF NOT FOUND THEN
    RETURN NULL;                                    -- already acknowledged, or no such retrospective
  END IF;

  IF v_row.verdict IN ('supported', 'not_supported') THEN
    IF p_pattern_text IS NULL OR btrim(p_pattern_text) = '' THEN
      RAISE EXCEPTION 'acknowledge_campaign_retrospective: pattern text is required for a % verdict', v_row.verdict;
    END IF;

    SELECT b.low, b.high INTO v_low, v_high FROM public.wilson_bounds(v_row.wins, v_row.n, 1.96) AS b;
    -- Confidence as ADR 0026 §6.4: (low) for a supported result, (1 - high) for a not-supported one,
    -- shrunk by n / (n + 10).
    v_conf := round((CASE WHEN v_row.verdict = 'supported' THEN v_low ELSE 1 - v_high END)
                    * v_row.n / (v_row.n + 10), 2);

    SELECT CASE WHEN bool_and(o.metric_basis = 'rate') THEN 'rate' ELSE 'count' END,
           coalesce(bool_or(o.baseline_source = 'import_seed'), false)
      INTO v_basis, v_seeded
      FROM public.post_outcomes AS o
     WHERE o.business_id = p_business_id AND o.campaign_id = p_campaign_id AND o.beat_baseline IS NOT NULL;

    INSERT INTO public.performance_memory (
      business_id, source, status, sensitivity, public_use_permission, scope, scope_ref,
      dimension, pattern, pattern_key, platform, confidence, observation_count,
      last_confirmed_at, expires_at,
      outcome_n, outcome_wins, outcome_distinct_campaigns, interval_low, interval_high, metric_basis, baseline_seeded
    ) VALUES (
      p_business_id, 'outcome', 'active', 'internal', false, 'campaign', p_campaign_id::text,
      'hypothesis', left(p_pattern_text, 500), 'outcome:hypothesis:' || p_campaign_id::text, NULL,
      v_conf, greatest(v_row.n, 1),
      v_row.completed_at, v_row.completed_at + interval '365 days',    -- OUTCOME_HYPOTHESIS_TTL_DAYS
      v_row.n, v_row.wins, 1,
      coalesce(v_row.interval_low, round(v_low, 3)), coalesce(v_row.interval_high, round(v_high, 3)),
      coalesce(v_basis, 'count'), coalesce(v_seeded, false)
    )
    ON CONFLICT (business_id, dimension, coalesce(platform, ''), pattern_key)
      WHERE source = 'outcome' AND deleted_at IS NULL
    DO NOTHING;
  END IF;

  RETURN v_row;
END;
$$;

-- ─── get_learning_cycles_northstar (ADR 0026 §8.5) ───────────────────────────
-- A learning cycle = a retrospective with a supported / not_supported verdict, acknowledged, WITH its
-- 'outcome:hypothesis:<campaign_id>' memory row (the write-back happened). Metric = cycles acknowledged
-- since p_since / active brands (businesses with >= 1 published post since p_since). Aggregate output
-- ONLY — the one function here that reads across businesses, by design.

CREATE OR REPLACE FUNCTION public.get_learning_cycles_northstar(p_since timestamptz)
RETURNS TABLE (cycles bigint, active_brands bigint, cycles_per_active_brand numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH c AS (
    SELECT count(*) AS n
      FROM public.campaign_retrospectives AS r
     WHERE r.verdict IN ('supported', 'not_supported')
       AND r.acknowledged_at IS NOT NULL
       AND r.acknowledged_at >= p_since
       AND EXISTS (
         SELECT 1 FROM public.performance_memory AS pm
          WHERE pm.business_id = r.business_id
            AND pm.source = 'outcome'
            AND pm.dimension = 'hypothesis'
            AND coalesce(pm.platform, '') = ''   -- pin the full performance_memory_outcome_pattern_key_uq prefix
            AND pm.pattern_key = 'outcome:hypothesis:' || r.campaign_id::text
            AND pm.deleted_at IS NULL
       )
  ),
  b AS (
    SELECT count(DISTINCT p.business_id) AS n
      FROM public.posts AS p
     WHERE p.status = 'published' AND p.published_at >= p_since AND p.deleted_at IS NULL
  )
  SELECT c.n, b.n, CASE WHEN b.n = 0 THEN NULL ELSE c.n::numeric / b.n END FROM c, b;
$$;

-- ─── Grants: service_role ONLY, on every function ────────────────────────────

REVOKE ALL ON FUNCTION public.wilson_bounds(int, int, numeric) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.outcome_cell_stats(uuid, text, text, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_outcome_performance_pattern(uuid, text, text, text, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.promote_outcome_pattern(uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.demote_outcome_pattern(uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.acknowledge_campaign_retrospective(uuid, uuid, uuid, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_learning_cycles_northstar(timestamptz) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.wilson_bounds(int, int, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.outcome_cell_stats(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_outcome_performance_pattern(uuid, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.promote_outcome_pattern(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.demote_outcome_pattern(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.acknowledge_campaign_retrospective(uuid, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_learning_cycles_northstar(timestamptz) TO service_role;
