-- ADR 0010 Amendment 2 §D2.1 / §D2.3 / §D2.4
-- Adds state-machine columns to business_deletion_requests,
-- decouples the FK so the audit row survives the hard-delete of its business,
-- and creates the claim + purge RPCs that drive the 30-day GDPR erasure cron.

-- ─── D2.1 — State-machine columns ────────────────────────────────────────────

ALTER TABLE public.business_deletion_requests
  ADD COLUMN status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed','abandoned')),
  ADD COLUMN attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN last_error text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Decouple the FK so the audit row survives the hard-delete of its business.
-- business_id is retained as a bare uuid NOT NULL: the row's purpose at rest
-- is to be an erasure-audit record keyed on a business_id that no longer
-- exists. Preserving referential integrity to a deleted parent is the wrong
-- semantic; SET NULL would erase *which* business was purged.
ALTER TABLE public.business_deletion_requests
  DROP CONSTRAINT business_deletion_requests_business_id_fkey;

-- Drainer scan index (mirror email_outbox_drainable_idx).
-- Covers the two claimable states; 'processing' rows are found by PK, not scanned.
CREATE INDEX business_deletion_requests_claimable_idx
  ON public.business_deletion_requests (requested_at)
  WHERE status IN ('pending','failed');

CREATE TRIGGER trg_business_deletion_requests_updated_at
  BEFORE UPDATE ON public.business_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── D2.3 — Claim RPC ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_deletion_requests(
  p_limit int, p_retention_days int, p_max_attempts int
)
RETURNS SETOF public.business_deletion_requests
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.business_deletion_requests
     SET status = 'processing', updated_at = now()
   WHERE id IN (
     SELECT id FROM public.business_deletion_requests
      WHERE (
        status = 'pending' AND verified_at IS NOT NULL
          AND requested_at <= now() - make_interval(days => p_retention_days)
      ) OR (
        status = 'failed' AND attempts < p_max_attempts
          AND next_attempt_at <= now()
      )
      ORDER BY requested_at
      FOR UPDATE SKIP LOCKED
      LIMIT p_limit
   )
  RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.claim_deletion_requests(int,int,int) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_deletion_requests(int,int,int) TO service_role;

-- ─── D2.4 — Purge RPC ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.purge_business(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_secret_count  int := 0;
  v_billing_count int := 0;
  v_secret_id     uuid;
BEGIN
  -- 0. Idempotency: a previous tick may have deleted the business already.
  IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = p_business_id) THEN
    RETURN jsonb_build_object('already_purged', true, 'business_id', p_business_id);
  END IF;

  -- 1. Vault secrets FIRST. social_accounts.vault_*_token_id reference
  --    vault.secrets in the OTHER direction; deleting the social_account row
  --    does NOT cascade to the secret. Delete each secret explicitly.
  FOR v_secret_id IN
    SELECT vault_access_token_id FROM public.social_accounts
     WHERE business_id = p_business_id AND vault_access_token_id IS NOT NULL
    UNION ALL
    SELECT vault_refresh_token_id FROM public.social_accounts
     WHERE business_id = p_business_id AND vault_refresh_token_id IS NOT NULL
  LOOP
    PERFORM public.vault_delete_secret(v_secret_id);
    v_secret_count := v_secret_count + 1;
  END LOOP;

  -- 2. Redact retained audit rows (D2.6) BEFORE the SET NULL FK fires on delete.
  --    billing_events is retained for tax/financial audit; sever the PII link.
  --    The PK `id` (the Stripe event id, an opaque evt_… reference) is retained
  --    as the idempotency/audit key — pseudonymous Stripe event ref, not direct PII,
  --    and a PK cannot be nulled.
  UPDATE public.billing_events
     SET stripe_customer_id = NULL,
         payload = jsonb_build_object('redacted', true, 'type', type)
   WHERE business_id = p_business_id;
  GET DIAGNOSTICS v_billing_count = ROW_COUNT;

  -- 3. Root delete. ON DELETE CASCADE purges every cascading child table;
  --    billing_events.business_id SET NULL; business_deletion_requests is
  --    decoupled (FK dropped, D2.1) and survives as the erasure-audit row.
  DELETE FROM public.businesses WHERE id = p_business_id;

  RETURN jsonb_build_object(
    'already_purged', false,
    'business_id', p_business_id,
    'vault_secrets_deleted', v_secret_count,
    'billing_events_redacted', v_billing_count,
    'purged_at', now()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.purge_business(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.purge_business(uuid) TO service_role;
