-- Migration 019: Replace UNIQUE on stripe_customer_id with a partial unique index
--
-- The original table-level UNIQUE constraint enforces uniqueness even for NULL
-- values in some DB configurations. A partial unique index scoped to non-NULL
-- rows is the correct formulation: each real Stripe customer maps to exactly
-- one business, but many businesses may have NULL (not yet subscribed).

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_stripe_customer_id_key;

CREATE UNIQUE INDEX businesses_stripe_customer_id_unique_idx
  ON public.businesses (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- Apply the same fix to stripe_subscription_id for consistency.
ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_stripe_subscription_id_key;

CREATE UNIQUE INDEX businesses_stripe_subscription_id_unique_idx
  ON public.businesses (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
