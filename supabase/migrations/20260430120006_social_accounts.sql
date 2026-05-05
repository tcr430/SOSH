-- Migration 6: social_accounts
--
-- A connection between a business and a social platform. STORES NO RAW OAUTH
-- TOKENS. All tokens live in Supabase Vault; this table holds only opaque
-- vault secret IDs. /lib/social/ is the only code that reads the secrets via
-- the service-role client.
--
-- Vault secret naming convention: 'sosh_token_{social_account_id}_{type}'
-- where {type} ∈ ('access','refresh').

CREATE TABLE public.social_accounts (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  platform                 text        NOT NULL
                             CHECK (platform IN ('linkedin','twitter','instagram','facebook','threads')),
  platform_user_id         text        NOT NULL,
  platform_username        text        NOT NULL,
  platform_display_name    text,
  vault_access_token_id    uuid        NOT NULL,
  vault_refresh_token_id   uuid,
  token_expires_at         timestamptz,
  is_active                boolean     NOT NULL DEFAULT true,
  connected_at             timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, platform, platform_user_id)
);

CREATE INDEX social_accounts_business_id_idx
  ON public.social_accounts (business_id);

-- Partial index for the publishing worker: it only ever queries active rows.
CREATE INDEX social_accounts_active_business_idx
  ON public.social_accounts (business_id)
  WHERE is_active = true;

CREATE TRIGGER trg_social_accounts_updated_at
BEFORE UPDATE ON public.social_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY social_accounts_select_own
  ON public.social_accounts FOR SELECT TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()));

CREATE POLICY social_accounts_insert_own
  ON public.social_accounts FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (public.get_user_business_ids()));

CREATE POLICY social_accounts_update_own
  ON public.social_accounts FOR UPDATE TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()))
  WITH CHECK (business_id = ANY (public.get_user_business_ids()));

CREATE POLICY social_accounts_delete_own
  ON public.social_accounts FOR DELETE TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()));
