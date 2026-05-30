CREATE TABLE public.billing_events (
  id                 text        PRIMARY KEY,
  type               text        NOT NULL,
  business_id        uuid        NULL
                     REFERENCES public.businesses(id) ON DELETE SET NULL,
  stripe_customer_id text        NULL,
  payload            jsonb       NOT NULL,
  processed_at       timestamptz NOT NULL DEFAULT now(),
  processed_outcome  text        NOT NULL,
  CHECK (processed_outcome IN (
    'applied',
    'ignored_unknown_price',
    'ignored_no_business',
    'ignored_duplicate',
    'error'
  ))
);

CREATE INDEX billing_events_business_idx
  ON public.billing_events (business_id, processed_at DESC)
  WHERE business_id IS NOT NULL;

CREATE INDEX billing_events_type_idx
  ON public.billing_events (type, processed_at DESC);

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_events_select_own"
  ON public.billing_events
  FOR SELECT TO authenticated
  USING (
    business_id IS NOT NULL
    AND business_id = ANY (get_user_business_ids())
  );
