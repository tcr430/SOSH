-- ADR 0030 §6.5 (Session 36-D D5, finding MINOR-6) — recompute_dismissal_audience_signal returns a DISTINCT outcome for every case it can reach.
--
-- WHY. The function (20260929140000) already returned distinct text for most branches, but two conflations hid real faults from every caller:
--   * `invalid_identifier` / `retired_invalid_identifier` covered THREE different situations: an identifier that failed the regex, a watched source
--     that no longer exists, and a watched source that belongs to ANOTHER business. The business-scoped read returns nothing for the last two, so
--     v_ident was NULL and both fell into the regex branch.
--   * `noop_unknown_source` covered BOTH a NULL watched-source id on a github/rss signal and a source kind that is neither.
-- None of this reached a log: the db wrapper returned the text unparsed, and all three opportunity actions dropped it.
--
-- WHAT CHANGES (the RETURN text only):
--   gone      the business-scoped read found nothing AND no row with that id exists in any business    -> watched_source_gone
--   foreign   the business-scoped read found nothing BUT a row with that id exists under ANOTHER business -> anomaly_watched_source_foreign
--   null id   a github/rss signal whose watched-source id is NULL                                        -> anomaly_watched_id_null
--   unknown   a source kind that is neither github nor rss                                              -> noop_unknown_kind
--   (noop_unknown_source is no longer returned.) A regex failure keeps invalid_identifier / retired_invalid_identifier. Where a live row is retired
--   by the gone / foreign cases, the same `retired_` prefix as today's retired_invalid_identifier is used.
--
-- WHAT DOES NOT CHANGE: which rows are written, retired or deleted. Every case keeps today's retired / non-retired split, the advisory-lock order,
-- the six-step order, both regexes, the count, the gate and the upsert. A state-for-state test in supabase/__tests__/substrate-dismissal-writer.test.ts
-- asserts the audience_memory row is identical to what the previous function left. No error is thrown that was not thrown before.
--
-- THE ONE NEW READ. To tell gone from foreign, ONE existence-only read looks the watched source up WITHOUT the business filter. It is the first read in
-- this function that is not scoped to the card's business_id, so it is deliberately minimal: it selects ONLY business_id (no owner, name, url, label or
-- any text), it is reached only after the business-scoped read already found nothing, and its result is used for FOUND and nothing else. The value
-- never reaches the statement, a comparison or a log. watched_repos / watched_feeds have no deleted_at column (unwatching is is_active = false, never a
-- DELETE, lib/db/watched-repos.ts:97), so "deleted" means the row is gone.
--
-- REACHABILITY, stated so the tests are read for what they prove. signals.watched_repo_id / watched_feed_id are ON DELETE CASCADE foreign keys,
-- signals_source_check admits only github / rss, and signals_exactly_one_parent_check forbids a NULL parent id for either. So gone, null-id and
-- unknown-kind are DEFENCE IN DEPTH today (reachable only if one of those constraints is dropped or bypassed); foreign is reachable only with the
-- identity trigger bypassed. They are still given distinct names because a future constraint change must surface in a log, not as a silent no-op.
--
-- PRIVILEGES. Restated below, in the 20260930100000 form: REVOKE from PUBLIC, anon and authenticated, GRANT to service_role only. CREATE OR REPLACE
-- keeps an existing ACL, but a FRESH Supabase database grants EXECUTE to anon and authenticated by default, and this file must be correct there too.

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
  v_src_found        boolean;
  v_other_biz        uuid;
  v_foreign          boolean := false;
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
  IF v_source = 'github' THEN
    IF v_repo_id IS NULL THEN
      RETURN 'anomaly_watched_id_null';
    END IF;
    v_key := 'dismissal:not_relevant:github:' || v_repo_id::text;
  ELSIF v_source = 'rss' THEN
    IF v_feed_id IS NULL THEN
      RETURN 'anomaly_watched_id_null';
    END IF;
    v_key := 'dismissal:not_relevant:rss:' || v_feed_id::text;
  ELSE
    RETURN 'noop_unknown_kind';
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
    v_src_found := FOUND;
    v_kind_word := 'GitHub repository';
    v_valid := v_ident IS NOT NULL AND v_ident ~ '^[A-Za-z0-9._-]{1,100}/[A-Za-z0-9._-]{1,100}$';
  ELSE
    SELECT public.dismissal_feed_host(f.url)
      INTO v_ident
      FROM public.watched_feeds f
     WHERE f.id = v_feed_id
       AND f.business_id = v_biz;
    v_src_found := FOUND;
    v_kind_word := 'feed';
    v_valid := v_ident IS NOT NULL AND v_ident ~ '^[a-z0-9.-]{1,253}$';
  END IF;
  IF NOT coalesce(v_valid, false) THEN
    IF NOT v_src_found THEN
      -- The ONE existence-only read (see the header): business_id only, no text column, FOUND is the whole result. It runs only when the
      -- business-scoped read above found nothing, so a hit here can only be a source that belongs to ANOTHER business.
      IF v_source = 'github' THEN
        SELECT r.business_id INTO v_other_biz FROM public.watched_repos r WHERE r.id = v_repo_id;
      ELSE
        SELECT f.business_id INTO v_other_biz FROM public.watched_feeds f WHERE f.id = v_feed_id;
      END IF;
      v_foreign := FOUND;
    END IF;
    IF v_row_id IS NOT NULL AND v_row_status <> 'retired' THEN
      -- database-reviewer M3 (L2.5): this write must be serialised with every other recompute of the same source, so the lock is taken
      -- BEFORE the retire, not only on the valid path below. A concurrent valid recompute can therefore never leave a retired row
      -- carrying valid data (or the reverse).
      PERFORM pg_advisory_xact_lock(hashtextextended(v_biz::text || v_key, 0));
      UPDATE public.audience_memory SET status = 'retired' WHERE id = v_row_id AND status <> 'retired';
      IF v_foreign THEN
        RETURN 'retired_anomaly_watched_source_foreign';
      ELSIF NOT v_src_found THEN
        RETURN 'retired_watched_source_gone';
      END IF;
      RETURN 'retired_invalid_identifier';
    END IF;
    IF v_foreign THEN
      RETURN 'anomaly_watched_source_foreign';
    ELSIF NOT v_src_found THEN
      RETURN 'watched_source_gone';
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

REVOKE ALL ON FUNCTION public.recompute_dismissal_audience_signal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_dismissal_audience_signal(uuid) TO service_role;
