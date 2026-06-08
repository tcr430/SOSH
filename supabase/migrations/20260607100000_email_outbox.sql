-- email_outbox: durable queue for the five product EmailKinds (ADR 0008 §5)
CREATE TABLE public.email_outbox (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  kind            text        NOT NULL
                    CHECK (kind IN ('trial-warning-t3','trial-warning-t1',
                                    'welcome-to-plan','payment-failed-courtesy',
                                    'first-post-published')),
  recipient       text        NOT NULL,
  locale          text        NOT NULL
                    CHECK (locale IN ('en','pt','es')),
  props           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  dedupe_token    text,
  status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sending','sent','failed','suppressed')),
  attempts        int         NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  provider_message_id text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);

-- Idempotency: one row per (business, kind, dedupe_token). NULL tokens collapse to ''
-- so trial/first-post kinds are deduped on (business_id, kind) alone.
CREATE UNIQUE INDEX email_outbox_dedupe_uq
  ON public.email_outbox (business_id, kind, coalesce(dedupe_token, ''));

-- Drainer scan target: only drainable rows, ordered by readiness.
CREATE INDEX email_outbox_drainable_idx
  ON public.email_outbox (next_attempt_at)
  WHERE status = 'pending';

CREATE TRIGGER trg_email_outbox_updated_at
  BEFORE UPDATE ON public.email_outbox
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;

-- Authenticated users may read their own business's rows (future in-app history).
-- No INSERT/UPDATE/DELETE policy for authenticated — service-role only.
CREATE POLICY email_outbox_select_own
  ON public.email_outbox FOR SELECT TO authenticated
  USING (business_id IN (SELECT get_user_business_ids()));

-- claim_email_outbox: atomic batch claim for the drainer (ADR 0008 §9).
-- FOR UPDATE SKIP LOCKED prevents concurrent ticks from claiming the same rows.
CREATE OR REPLACE FUNCTION public.claim_email_outbox(batch_size int)
RETURNS SETOF public.email_outbox
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.email_outbox
     SET status = 'sending', updated_at = now()
   WHERE id IN (
     SELECT id FROM public.email_outbox
      WHERE status = 'pending' AND next_attempt_at <= now()
      ORDER BY next_attempt_at
      FOR UPDATE SKIP LOCKED
      LIMIT batch_size
   )
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.claim_email_outbox(int) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_email_outbox(int) TO service_role;
