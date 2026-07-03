-- ADR 0013 (Rev A) §8, M8 — purge_business gains an explicit
-- DELETE FROM public.business_members before the root delete.
--
-- business_members is business-scoped (business_id -> businesses ON DELETE
-- CASCADE) and holds identity PII (email, user_id), so the existing root
-- DELETE FROM public.businesses already cascades it. This explicit delete is
-- functionally redundant with that cascade but removes any dependency on the
-- root-delete assumption for erasing member PII — the conservative,
-- GDPR-safe choice (Rev A / M3). (RLS-PURGE-EXPLICIT-MEMBER-DELETE)
--
-- All other purge_business behaviour (vault secret deletion, billing_events
-- redaction, idempotency check, return shape) is unchanged.

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

  -- 3. Explicit business_members erasure (Rev A / M3, §8). Independent of the
  --    ON DELETE CASCADE backstop below — belt-and-suspenders for GDPR PII.
  DELETE FROM public.business_members WHERE business_id = p_business_id;

  -- 4. Root delete. ON DELETE CASCADE purges every cascading child table;
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
