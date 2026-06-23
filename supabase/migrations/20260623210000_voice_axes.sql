-- ADR 0011 Rev B §3.1 / §3.2 / §3.3 / §3.4 — Voice model schema (Session 19B BP1)
--
-- BUILDER GATE (§3.1 cutover caveat): before applying this migration confirm that
-- all rows in brand_voices are test/demo data only:
--   SELECT count(*) FROM brand_voices WHERE tone != '{}';
-- If any real voice row exists, halt and switch to reverse-derivation backfill
-- (map existing tone[] tags → approximate axis values) instead of neutral fill.
--
-- ADR 0010 Amendment 2 §D2.5 — cascade table addition:
--   brand_voice_variations | yes (business_id) | CASCADE | yes | none
-- This table cascades from businesses ON DELETE and is covered by purge_business
-- automatically. Row documented here per the CLAUDE.md erasure-cascade standing rule.

-- ─── §3.1 — Add voice_axes to brand_voices ───────────────────────────────────

ALTER TABLE public.brand_voices
  ADD COLUMN voice_axes jsonb NOT NULL
    DEFAULT '{"formal_casual":50,"expert_peer":50,"serious_playful":50,"reserved_warm":50,"calm_energetic":50,"rational_emotional":50,"exclusive_inclusive":50}'
    CHECK (
      jsonb_typeof(voice_axes) = 'object'
      AND voice_axes ?& ARRAY[
        'formal_casual','expert_peer','serious_playful','reserved_warm',
        'calm_energetic','rational_emotional','exclusive_inclusive'
      ]
      AND jsonb_typeof(voice_axes->'formal_casual')       = 'number'
      AND (voice_axes->>'formal_casual')::int       BETWEEN 0 AND 100
      AND jsonb_typeof(voice_axes->'expert_peer')         = 'number'
      AND (voice_axes->>'expert_peer')::int         BETWEEN 0 AND 100
      AND jsonb_typeof(voice_axes->'serious_playful')     = 'number'
      AND (voice_axes->>'serious_playful')::int     BETWEEN 0 AND 100
      AND jsonb_typeof(voice_axes->'reserved_warm')       = 'number'
      AND (voice_axes->>'reserved_warm')::int       BETWEEN 0 AND 100
      AND jsonb_typeof(voice_axes->'calm_energetic')      = 'number'
      AND (voice_axes->>'calm_energetic')::int      BETWEEN 0 AND 100
      AND jsonb_typeof(voice_axes->'rational_emotional')  = 'number'
      AND (voice_axes->>'rational_emotional')::int  BETWEEN 0 AND 100
      AND jsonb_typeof(voice_axes->'exclusive_inclusive') = 'number'
      AND (voice_axes->>'exclusive_inclusive')::int BETWEEN 0 AND 100
    );

-- Existing rows are backfilled to the neutral vector by the DEFAULT above.
-- Existing tone[] values are left intact; they will be re-derived the next
-- time the voice is saved through the vector editor (ADR 0011 §3.1).

-- ─── §3.2 — brand_voice_variations table ─────────────────────────────────────

CREATE TABLE public.brand_voice_variations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid        NOT NULL
                          REFERENCES public.businesses(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  voice_axes  jsonb       NOT NULL
    CHECK (
      jsonb_typeof(voice_axes) = 'object'
      AND voice_axes ?& ARRAY[
        'formal_casual','expert_peer','serious_playful','reserved_warm',
        'calm_energetic','rational_emotional','exclusive_inclusive'
      ]
      AND jsonb_typeof(voice_axes->'formal_casual')       = 'number'
      AND (voice_axes->>'formal_casual')::int       BETWEEN 0 AND 100
      AND jsonb_typeof(voice_axes->'expert_peer')         = 'number'
      AND (voice_axes->>'expert_peer')::int         BETWEEN 0 AND 100
      AND jsonb_typeof(voice_axes->'serious_playful')     = 'number'
      AND (voice_axes->>'serious_playful')::int     BETWEEN 0 AND 100
      AND jsonb_typeof(voice_axes->'reserved_warm')       = 'number'
      AND (voice_axes->>'reserved_warm')::int       BETWEEN 0 AND 100
      AND jsonb_typeof(voice_axes->'calm_energetic')      = 'number'
      AND (voice_axes->>'calm_energetic')::int      BETWEEN 0 AND 100
      AND jsonb_typeof(voice_axes->'rational_emotional')  = 'number'
      AND (voice_axes->>'rational_emotional')::int  BETWEEN 0 AND 100
      AND jsonb_typeof(voice_axes->'exclusive_inclusive') = 'number'
      AND (voice_axes->>'exclusive_inclusive')::int BETWEEN 0 AND 100
    ),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_voice_variations_business_name_key UNIQUE (business_id, name)
);

CREATE INDEX brand_voice_variations_business_id_idx
  ON public.brand_voice_variations (business_id);

CREATE TRIGGER trg_brand_voice_variations_updated_at
  BEFORE UPDATE ON public.brand_voice_variations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.brand_voice_variations ENABLE ROW LEVEL SECURITY;

CREATE POLICY brand_voice_variations_select_own
  ON public.brand_voice_variations FOR SELECT TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()));

CREATE POLICY brand_voice_variations_insert_own
  ON public.brand_voice_variations FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (public.get_user_business_ids()));

CREATE POLICY brand_voice_variations_update_own
  ON public.brand_voice_variations FOR UPDATE TO authenticated
  USING  (business_id = ANY (public.get_user_business_ids()))
  WITH CHECK (business_id = ANY (public.get_user_business_ids()));

CREATE POLICY brand_voice_variations_delete_own
  ON public.brand_voice_variations FOR DELETE TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()));

-- ─── §3.3 — campaigns.voice_variation_id ─────────────────────────────────────

ALTER TABLE public.campaigns
  ADD COLUMN voice_variation_id uuid
    REFERENCES public.brand_voice_variations(id) ON DELETE SET NULL;

-- ─── §3.4 — create_voice_variation RPC ───────────────────────────────────────
--
-- Enforces the 5-variation cap atomically (D-B):
--   1. Locks the parent businesses row FOR UPDATE, serialising concurrent creates.
--   2. Counts existing variations for the business.
--   3. Raises a typed error if count >= 5.
--   4. Otherwise inserts and returns the new row.

CREATE OR REPLACE FUNCTION public.create_voice_variation(
  p_business_id uuid,
  p_name        text,
  p_voice_axes  jsonb
)
RETURNS SETOF public.brand_voice_variations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int;
BEGIN
  -- Lock parent row to serialise concurrent variation creates for this business.
  PERFORM 1 FROM public.businesses WHERE id = p_business_id FOR UPDATE;

  SELECT count(*) INTO v_count
    FROM public.brand_voice_variations
   WHERE business_id = p_business_id;

  IF v_count >= 5 THEN
    RAISE EXCEPTION 'voice_variation_cap_reached';
  END IF;

  RETURN QUERY
    INSERT INTO public.brand_voice_variations (business_id, name, voice_axes)
    VALUES (p_business_id, p_name, p_voice_axes)
    RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.create_voice_variation(uuid, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.create_voice_variation(uuid, text, jsonb) TO service_role;
