-- ADR 0030 §6.2-§6.5 (Session 36, L2.5; founder rulings A-1, A-2, A-3) — the dismissal writer's SQL half.
--
-- The proof writer: the closed-enum reason a human gives when dismissing an opportunity card becomes ONE audience_memory row per
-- (business, watched source). It is DETERMINISTIC (L-7, no model, 0 LLM cents) and it is a RECOMPUTE-IN-PLACE writer: on every card
-- transition that can move its count it re-counts the source's cards and rebuilds the row from that count.
--
--   dismissal_feed_host(url)                        the fixed-step hostname parse (ADR §6.3), IMMUTABLE, not callable by clients
--   recompute_dismissal_audience_signal(p_card_id)  the writer (W1-W9), service_role only
--
-- WHAT THE WRITER NEVER READS: any text column of the card, of the signal, or of the watched feed. Its only inputs are ids, the card's
-- status / reason / updated_at, the signal's source and watched-source id, and ONE identifier that it builds itself and checks by regex in
-- this function (repo owner || '/' || name, or the host parsed from the feed URL). watched_repos.owner / name and watched_feeds.url are
-- unchecked text that a member can write over PostgREST, so THIS regex is the only defence ([sec-2]); the Server Action's length bound is
-- bypassable. A failed check writes nothing and retires an existing row.
--
-- WHAT THE CALLER NEVER SUPPLIES (L-3, W3, W4, W8): the function takes ONE argument, the card id. business_id is derived from the card and
-- the chain card -> candidate -> signal is RE-VERIFIED (a mismatch RAISES 42501), source / status / kind / segment / scope / scope_ref /
-- sensitivity / decision_key / statement / confidence / observation_count / last_confirmed_at / expires_at are all computed here.
--
-- ORDER (ADR §6.5), each step reachable and tested through the transition that reaches it:
--   1. lock the card FOR SHARE; return unless it is a not_relevant dismissal (may create) or approved / saved (update-only)
--   2. business from the card; re-verify the chain
--   3. derive the decision_key; if the card may not create and no live row has that key, RETURN before ANY identifier work
--   4. read the watched source BY business_id; build and check the identifier (fail -> retire an existing row, never insert)
--   5. take the advisory lock BEFORE counting (W9), re-read the row, count n and m over 180 days, then upsert (create-capable) or update
--      the existing row only; n = 0 retires (status only); a row retired for 30+ days is hard-deleted
--
-- No new table, no new index (the count is served by signals_watched_repo_id_idx / signals_watched_feed_id_idx, then the UNIQUEs on
-- signal_candidates.signal_id and insight_cards.signal_candidate_id), no new dependency, no trigger on insight_cards or on the
-- member-writable watched_* tables.

-- ─── the hostname helper (ADR §6.3, six fixed steps, IN ORDER) ──────────────

CREATE OR REPLACE FUNCTION public.dismissal_feed_host(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v text;
BEGIN
  IF p_url IS NULL THEN
    RETURN NULL;
  END IF;
  -- 1. lower(btrim(url))
  v := lower(btrim(p_url));
  -- 2. require an http:// or https:// scheme and strip it; any other scheme fails closed (NULL)
  IF v LIKE 'http://%' THEN
    v := substr(v, 8);
  ELSIF v LIKE 'https://%' THEN
    v := substr(v, 9);
  ELSE
    RETURN NULL;
  END IF;
  -- 3. everything up to the first /, ? or #
  v := substring(v FROM '^[^/?#]*');
  -- 4. strip any userinfo up to and including the LAST @
  v := regexp_replace(v, '^.*@', '');
  -- 5. strip a trailing :<digits> port
  v := regexp_replace(v, ':[0-9]+$', '');
  -- 6. strip ONE trailing dot
  v := regexp_replace(v, '\.$', '');
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.dismissal_feed_host(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dismissal_feed_host(text) FROM anon, authenticated;

-- ─── the writer ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.recompute_dismissal_audience_signal(p_card_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_biz              uuid;
  v_card_status      text;
  v_card_reason      text;
  v_candidate_id     uuid;
  v_may_create       boolean;
  v_cand_biz         uuid;
  v_signal_id        uuid;
  v_signal_biz       uuid;
  v_source           text;
  v_repo_id          uuid;
  v_feed_id          uuid;
  v_key              text;
  v_row_id           uuid;
  v_row_status       text;
  v_row_updated      timestamptz;
  v_ident            text;
  v_kind_word        text;
  v_valid            boolean;
  v_n                int;
  v_kept             int;
  v_m                int;
  v_last             timestamptz;
  v_conf             numeric;
  v_status           text;
  v_statement        text;
BEGIN
  -- 1. lock the card, decide what this call may do
  SELECT c.business_id, c.status, c.dismiss_reason, c.signal_candidate_id
    INTO v_biz, v_card_status, v_card_reason, v_candidate_id
    FROM public.insight_cards c
   WHERE c.id = p_card_id
     FOR SHARE;
  IF NOT FOUND THEN
    RETURN 'noop_card_not_found';
  END IF;
  v_may_create := coalesce(v_card_status = 'dismissed' AND v_card_reason = 'not_relevant', false);
  IF NOT v_may_create AND v_card_status NOT IN ('approved', 'saved') THEN
    RETURN 'noop_card_state';
  END IF;

  -- 2. the business comes from the card; the chain is re-verified, never trusted
  SELECT sc.business_id, sc.signal_id
    INTO v_cand_biz, v_signal_id
    FROM public.signal_candidates sc
   WHERE sc.id = v_candidate_id;
  IF NOT FOUND OR v_cand_biz IS DISTINCT FROM v_biz THEN
    RAISE EXCEPTION 'recompute_dismissal_audience_signal: the card and its candidate do not belong to one business' USING ERRCODE = '42501';
  END IF;
  SELECT s.business_id, s.source, s.watched_repo_id, s.watched_feed_id
    INTO v_signal_biz, v_source, v_repo_id, v_feed_id
    FROM public.signals s
   WHERE s.id = v_signal_id;
  IF NOT FOUND OR v_signal_biz IS DISTINCT FROM v_biz THEN
    RAISE EXCEPTION 'recompute_dismissal_audience_signal: the card and its signal do not belong to one business' USING ERRCODE = '42501';
  END IF;

  -- 3. the decision key, and the early no-op BEFORE any identifier work
  IF v_source = 'github' AND v_repo_id IS NOT NULL THEN
    v_key := 'dismissal:not_relevant:github:' || v_repo_id::text;
  ELSIF v_source = 'rss' AND v_feed_id IS NOT NULL THEN
    v_key := 'dismissal:not_relevant:rss:' || v_feed_id::text;
  ELSE
    RETURN 'noop_unknown_source';
  END IF;

  SELECT a.id, a.status, a.updated_at
    INTO v_row_id, v_row_status, v_row_updated
    FROM public.audience_memory a
   WHERE a.business_id = v_biz
     AND a.source = 'dismissal'
     AND a.decision_key = v_key
     AND a.deleted_at IS NULL;
  IF NOT v_may_create AND v_row_id IS NULL THEN
    RETURN 'noop_no_row';
  END IF;

  -- 4. the identifier: read BY business_id, built here, checked here. Fail closed.
  IF v_source = 'github' THEN
    SELECT r.owner || '/' || r.name
      INTO v_ident
      FROM public.watched_repos r
     WHERE r.id = v_repo_id
       AND r.business_id = v_biz;
    v_kind_word := 'GitHub repository';
    v_valid := v_ident IS NOT NULL AND v_ident ~ '^[A-Za-z0-9._-]{1,100}/[A-Za-z0-9._-]{1,100}$';
  ELSE
    SELECT public.dismissal_feed_host(f.url)
      INTO v_ident
      FROM public.watched_feeds f
     WHERE f.id = v_feed_id
       AND f.business_id = v_biz;
    v_kind_word := 'feed';
    v_valid := v_ident IS NOT NULL AND v_ident ~ '^[a-z0-9.-]{1,253}$';
  END IF;
  IF NOT coalesce(v_valid, false) THEN
    IF v_row_id IS NOT NULL AND v_row_status <> 'retired' THEN
      -- database-reviewer M3 (L2.5): this write must be serialised with every other recompute of the same source, so the lock is taken
      -- BEFORE the retire, not only on the valid path below. A concurrent valid recompute can therefore never leave a retired row
      -- carrying valid data (or the reverse).
      PERFORM pg_advisory_xact_lock(hashtextextended(v_biz::text || v_key, 0));
      UPDATE public.audience_memory SET status = 'retired' WHERE id = v_row_id AND status <> 'retired';
      RETURN 'retired_invalid_identifier';
    END IF;
    RETURN 'invalid_identifier';
  END IF;

  -- 5. serialise recomputes of ONE source BEFORE counting (W9): without this a stale count can land last
  PERFORM pg_advisory_xact_lock(hashtextextended(v_biz::text || v_key, 0));

  -- the row may have been created, retired or deleted by a recompute that held the lock before us
  v_row_id := NULL;
  SELECT a.id, a.status, a.updated_at
    INTO v_row_id, v_row_status, v_row_updated
    FROM public.audience_memory a
   WHERE a.business_id = v_biz
     AND a.source = 'dismissal'
     AND a.decision_key = v_key
     AND a.deleted_at IS NULL;
  IF NOT v_may_create AND v_row_id IS NULL THEN
    RETURN 'noop_no_row';
  END IF;

  -- n = not_relevant dismissals, kept = approved or saved, over the 180 days before now(), by card updated_at
  IF v_source = 'github' THEN
    SELECT count(*) FILTER (WHERE c.status = 'dismissed' AND c.dismiss_reason = 'not_relevant'),
           count(*) FILTER (WHERE c.status IN ('approved', 'saved')),
           max(c.updated_at) FILTER (WHERE c.status = 'dismissed' AND c.dismiss_reason = 'not_relevant')
      INTO v_n, v_kept, v_last
      FROM public.signals s
      JOIN public.signal_candidates sc ON sc.signal_id = s.id
      JOIN public.insight_cards c ON c.signal_candidate_id = sc.id
     WHERE s.business_id = v_biz
       AND s.watched_repo_id = v_repo_id
       AND c.business_id = v_biz
       AND c.updated_at >= now() - interval '180 days';
  ELSE
    SELECT count(*) FILTER (WHERE c.status = 'dismissed' AND c.dismiss_reason = 'not_relevant'),
           count(*) FILTER (WHERE c.status IN ('approved', 'saved')),
           max(c.updated_at) FILTER (WHERE c.status = 'dismissed' AND c.dismiss_reason = 'not_relevant')
      INTO v_n, v_kept, v_last
      FROM public.signals s
      JOIN public.signal_candidates sc ON sc.signal_id = s.id
      JOIN public.insight_cards c ON c.signal_candidate_id = sc.id
     WHERE s.business_id = v_biz
       AND s.watched_feed_id = v_feed_id
       AND c.business_id = v_biz
       AND c.updated_at >= now() - interval '180 days';
  END IF;
  v_m := v_n + v_kept;

  -- nothing left to count: retire (status ONLY: observation_count >= 1 is a CHECK, so n = 0 is never written), and hard-delete a row
  -- that has been retired for 30+ days (best-effort retention: it runs at this source's next recompute)
  IF v_n = 0 THEN
    IF v_row_id IS NOT NULL THEN
      IF v_row_status = 'retired' THEN
        IF v_row_updated < now() - interval '30 days' THEN
          DELETE FROM public.audience_memory WHERE id = v_row_id AND status = 'retired';
          RETURN 'deleted';
        END IF;
      ELSE
        UPDATE public.audience_memory SET status = 'retired' WHERE id = v_row_id;
        RETURN 'retired';
      END IF;
    END IF;
    RETURN 'noop_nothing_counted';
  END IF;

  v_conf := round(0.5 * v_n / (v_n + 3), 2);
  v_status := CASE WHEN v_n >= 3 AND (v_n::numeric / v_m) >= 0.75 THEN 'active' ELSE 'candidate' END;
  v_statement := format(
    'Updates from the %s %s were dismissed as not relevant to this audience in %s of %s recent opportunity cards.',
    v_kind_word, v_ident, v_n, v_m);

  IF v_may_create THEN
    INSERT INTO public.audience_memory (
      business_id, source, status, sensitivity, scope, scope_ref, kind, segment,
      statement, confidence, observation_count, last_confirmed_at, expires_at, decision_key
    ) VALUES (
      v_biz, 'dismissal', v_status, 'internal', 'brand', NULL, 'other', NULL,
      v_statement, v_conf, v_n, v_last, v_last + interval '180 days', v_key
    )
    ON CONFLICT (business_id, decision_key)
      WHERE source = 'dismissal' AND deleted_at IS NULL
    DO UPDATE SET
      statement         = EXCLUDED.statement,
      confidence        = EXCLUDED.confidence,
      observation_count = EXCLUDED.observation_count,
      status            = EXCLUDED.status,
      last_confirmed_at = EXCLUDED.last_confirmed_at,
      expires_at        = EXCLUDED.expires_at;
    RETURN 'upserted';
  END IF;

  UPDATE public.audience_memory
     SET statement         = v_statement,
         confidence        = v_conf,
         observation_count = v_n,
         status            = v_status,
         last_confirmed_at = v_last,
         expires_at        = v_last + interval '180 days'
   WHERE id = v_row_id;
  RETURN 'updated';
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_dismissal_audience_signal(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_dismissal_audience_signal(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_dismissal_audience_signal(uuid) TO service_role;
