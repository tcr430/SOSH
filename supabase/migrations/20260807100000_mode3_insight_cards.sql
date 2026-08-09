-- Mode 3 Part 2 — the insight card and the triage cost ceiling (ADR 0021 §4.1, §8).
--
-- Two tables. insight_cards is the first table in this family where
-- `authenticated` gets a direct UPDATE (every Session 27 table is
-- service-role-write-only) — triage is a human action. signal_triage_budget
-- is an internal cost-control row, deny-by-default, never read by
-- `authenticated` directly (§8.1).
--
-- Backfill: NONE. Both tables are new feature surface (L-13).

-- ─── insight_cards (§4.1) ────────────────────────────────────────────────────

CREATE TABLE public.insight_cards (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  -- ON CONFLICT arbiter (the UNIQUE table constraint below) — ADR 0020 §3.4's
  -- lesson applied to this table: without it, a re-triage of the same
  -- candidate would silently insert a duplicate card rather than upsert.
  signal_candidate_id   uuid        NOT NULL REFERENCES public.signal_candidates(id) ON DELETE CASCADE,
  observation           text        NOT NULL,
  why_it_matters        text        NOT NULL,
  audience              text        NOT NULL,
  -- ≤ 3 × { angle ≤120 chars, rationale ≤240 } (§4.5). Shape enforced at the
  -- app layer (Tier-2 validator, SIGNAL3-CARD-NO-POST-COPY) — jsonb has no
  -- native array-length-of-object-shape CHECK worth writing by hand here.
  angle_options         jsonb       NOT NULL,
  -- The verified evidence-memory id set (§4.6).
  evidence              jsonb       NOT NULL,
  suggested_objective   text,
  novelty               numeric     NOT NULL CHECK (novelty BETWEEN 0 AND 100),
  freshness             numeric     NOT NULL CHECK (freshness BETWEEN 0 AND 100),
  sensitivity           numeric     NOT NULL CHECK (sensitivity BETWEEN 0 AND 100),
  confidence            numeric     NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  -- The six applicable rubric dimensions (§4.3) — recomputed in code over the
  -- six, never the model's discarded `overall`/`verdict`.
  rubric_scores         jsonb       NOT NULL,
  -- Denormalised from signal_candidates.score/occurred_at — Postgres cannot
  -- index across two tables and the feed's ORDER BY (§5.7) spans both, same
  -- reasoning as signal_candidates.occurred_at ([db-MAJOR-C] precedent).
  score                 numeric     NOT NULL CHECK (score >= 0),
  occurred_at           timestamptz NOT NULL,
  status                text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'dismissed', 'saved')),
  -- The closed five of §5.4. NULL unless status = 'dismissed' — enforced by
  -- the legality trigger below, not by this CHECK (a CHECK cannot see
  -- another column's value change atomically the way a BEFORE UPDATE
  -- trigger can reason about NEW as a whole).
  dismiss_reason        text        CHECK (dismiss_reason IS NULL OR dismiss_reason IN ('not_relevant', 'already_covered', 'too_sensitive', 'wrong_timing', 'weak_evidence')),
  expires_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signal_candidate_id)
);

-- ⚠️ SIGNAL3-TRIAGE-LEGAL-TRANSITION (§5.3, [db-MAJOR-1]). The atomic
-- conditional UPDATE (`.eq('status', expected)`) gives CONCURRENCY; this
-- trigger gives LEGALITY — two different guarantees. `authenticated` has a
-- direct UPDATE grant (below), so nothing at the RLS layer stops a raw
-- PostgREST call writing dismissed → approved or setting dismiss_reason on a
-- non-dismissed row without this guard. Shape follows
-- enforce_post_role_write_once (20260722190000_mode2_brief_and_roles.sql:147-159).
CREATE OR REPLACE FUNCTION public.enforce_insight_card_legal_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'pending' AND NEW.status IN ('approved', 'dismissed', 'saved'))
      OR (OLD.status = 'saved' AND NEW.status IN ('approved', 'dismissed'))
    ) THEN
      RAISE EXCEPTION 'insight_cards.status transition % -> % is not permitted (ADR 0021 §5.3, card %)', OLD.status, NEW.status, OLD.id;
    END IF;
  END IF;

  IF NOT (NEW.dismiss_reason IS NULL OR NEW.status = 'dismissed') THEN
    RAISE EXCEPTION 'insight_cards.dismiss_reason may only be set when status = dismissed (ADR 0021 §5.3, card %)', OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_insight_cards_enforce_legal_transition
  BEFORE UPDATE ON public.insight_cards
  FOR EACH ROW EXECUTE FUNCTION public.enforce_insight_card_legal_transition();

CREATE TRIGGER trg_insight_cards_updated_at
BEFORE UPDATE ON public.insight_cards
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ⚠️ Deliberately NO BEFORE DELETE trigger, for the reason recorded at
-- studio_drafts.sql:88-96 and signal_ingestion.sql:192-201: a raising guard
-- cannot distinguish an FK-cascade delete from a direct one and would abort
-- GDPR erasure. Cards are the eval corpus's history, but retention across a
-- business's own lifetime — not across its deletion — so ON DELETE CASCADE
-- (declared above) is correct and purge_business needs no edit (§8.2).

-- ─── signal_triage_budget (§3.4 cost ceiling, §8.1 deny-by-default) ─────────

CREATE TABLE public.signal_triage_budget (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  day            date        NOT NULL,
  reserved_cents integer     NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- The ON CONFLICT arbiter E5.2's atomic reservation RPC upserts against —
  -- one row per business per day.
  UNIQUE (business_id, day)
);

CREATE TRIGGER trg_signal_triage_budget_updated_at
BEFORE UPDATE ON public.signal_triage_budget
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- No BEFORE DELETE trigger here either — same reasoning, and this table
-- holds only a per-day cent counter with no PII to redact separately.

-- ─── Indexes ─────────────────────────────────────────────────────────────────

-- signal_candidate_id already has a UNIQUE index from the table constraint
-- above, serving both the ON CONFLICT arbiter and any lookup by candidate.

-- Bare-FK index on business_id (the MODERATE-2 lesson, signal_ingestion.sql:244-249):
-- the feed index below is partial (WHERE status = 'pending') and cannot
-- serve a plain business_id-only query (admin/debug, or any future query
-- once a card leaves 'pending').
CREATE INDEX insight_cards_business_id_idx
  ON public.insight_cards (business_id);

-- The feed index, VERBATIM per §5.7. INCLUDE (expires_at) is not optional —
-- `expires_at > now()` cannot enter the partial-index predicate (not
-- IMMUTABLE), but INCLUDE keeps it out of the sort key while letting
-- Postgres evaluate the filter from the index tuple rather than
-- dereferencing the heap for every skipped stale row.
CREATE INDEX insight_cards_feed_idx
  ON public.insight_cards (business_id, score DESC, occurred_at DESC, id ASC)
  INCLUDE (expires_at)
  WHERE status = 'pending';

-- signal_triage_budget.business_id is covered by the UNIQUE (business_id, day)
-- constraint's leading column — no separate index needed.

-- ─── RLS (§8.1) ──────────────────────────────────────────────────────────────
--
-- InitPlan form, verbatim from 20260730100000_studio_drafts.sql:71-86.

ALTER TABLE public.insight_cards        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_triage_budget ENABLE ROW LEVEL SECURITY;

-- insight_cards — SELECT, UPDATE (USING and WITH CHECK both). No INSERT
-- (Stage D writes service-role); no DELETE (cards are the eval corpus's
-- history).
CREATE POLICY insight_cards_select_own
  ON public.insight_cards FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY insight_cards_update_own
  ON public.insight_cards FOR UPDATE TO authenticated
  USING      (business_id = ANY (SELECT unnest(public.get_user_business_ids())))
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- signal_triage_budget — NO policy at all. Absence of a policy is
-- deny-by-default; paired with an explicit REVOKE and no matching GRANT so
-- intent is enforced at two independent layers rather than resting on an
-- absence alone (ADR 0020 §3.5 [db-D], the deny-by-default idiom at
-- signal_ingestion.sql:269-273). The feed's "paused" indicator comes from a
-- service-role helper behind a Server Action (§3.4), never a raw SELECT.

-- database-reviewer (E5.1+E5.2 pass, MAJOR-1): a table-wide UPDATE grant lets
-- an authenticated PostgREST call pass both RLS (WITH CHECK only guards
-- business_id) and the legality trigger (which only validates the status
-- transition and the dismiss_reason/status pairing) while overwriting
-- AI-generated card content — the exact content a human is meant to be
-- trusting when they triage. Column-scoped GRANT restricts the only
-- authenticated write surface to the two columns a triage transition
-- actually touches (§5.3).
REVOKE ALL ON public.insight_cards FROM authenticated;
GRANT SELECT ON public.insight_cards TO authenticated;
GRANT UPDATE (status, dismiss_reason) ON public.insight_cards TO authenticated;

REVOKE ALL ON public.signal_triage_budget FROM authenticated;
-- No matching GRANT — deny-by-default, both layers.
