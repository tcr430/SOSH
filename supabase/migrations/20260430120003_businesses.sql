-- Migration 3: businesses
--
-- Tenancy root. Every customer-data row in the database traces back to a
-- businesses row. RLS uses businesses.owner_id directly (the
-- get_user_business_ids() helper is created in the next migration after this
-- table exists).

CREATE TABLE public.businesses (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text        NOT NULL,
  website                 text,
  industry                text,
  description             text,
  logo_url                text,
  owner_id                uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  plan                    text        NOT NULL DEFAULT 'trial'
                            CHECK (plan IN ('trial','starter','pro','agency')),
  stripe_customer_id      text        UNIQUE,
  stripe_subscription_id  text        UNIQUE,
  language                text        NOT NULL DEFAULT 'en'
                            CHECK (language IN ('en','pt','es')),
  timezone                text        NOT NULL DEFAULT 'UTC',
  onboarding_completed    boolean     NOT NULL DEFAULT false,
  deleted_at              timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX businesses_owner_id_idx ON public.businesses (owner_id);
-- The UNIQUE constraint on stripe_customer_id already provides an index;
-- a partial index would be redundant but is sometimes preferred for size.
-- We rely on the UNIQUE-index for now.

CREATE TRIGGER trg_businesses_updated_at
BEFORE UPDATE ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

-- SELECT: only the owner, and only non-soft-deleted rows.
CREATE POLICY businesses_select_own
  ON public.businesses
  FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid() AND deleted_at IS NULL);

-- INSERT: a user can only create businesses they own.
CREATE POLICY businesses_insert_own
  ON public.businesses
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- UPDATE: owner can update; cannot transfer ownership via UPDATE.
CREATE POLICY businesses_update_own
  ON public.businesses
  FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- No DELETE policy: businesses are deleted by service-role only
-- (cascade implications and Stripe coordination required).
