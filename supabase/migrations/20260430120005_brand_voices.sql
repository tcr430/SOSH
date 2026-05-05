-- Migration 5: brand_voices
--
-- One row per business. Single mutable record; versioning is a Phase 2
-- concern handled by a future brand_voice_versions table.

CREATE TABLE public.brand_voices (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid        NOT NULL UNIQUE
                                  REFERENCES public.businesses(id) ON DELETE CASCADE,
  tone                text[]      NOT NULL DEFAULT '{}',
  target_audience     text,
  keywords            text[]      NOT NULL DEFAULT '{}',
  avoid_words         text[]      NOT NULL DEFAULT '{}',
  writing_examples    text[]      NOT NULL DEFAULT '{}'
                                  CHECK (cardinality(writing_examples) <= 3),
  competitors         text[]      NOT NULL DEFAULT '{}',
  unique_value_prop   text,
  inferred_from_url   text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- The UNIQUE on business_id is the lookup index.

CREATE TRIGGER trg_brand_voices_updated_at
BEFORE UPDATE ON public.brand_voices
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.brand_voices ENABLE ROW LEVEL SECURITY;

CREATE POLICY brand_voices_select_own
  ON public.brand_voices FOR SELECT TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()));

CREATE POLICY brand_voices_insert_own
  ON public.brand_voices FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (public.get_user_business_ids()));

CREATE POLICY brand_voices_update_own
  ON public.brand_voices FOR UPDATE TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()))
  WITH CHECK (business_id = ANY (public.get_user_business_ids()));

CREATE POLICY brand_voices_delete_own
  ON public.brand_voices FOR DELETE TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()));
