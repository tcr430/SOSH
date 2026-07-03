-- ADR 0013 (Rev A) §9 M7 — idempotent primary-admin backfill.
--
-- Every existing (non-deleted) business's owner_id gets a business_members
-- row so app code that has moved to the multi-member read path
-- (get_user_business_ids, via M2) sees the creator without depending on the
-- owner-override branch in user_can(). Runs AFTER M1-M6 so the table,
-- indexes, and helpers already exist.
--
-- Idempotent: ON CONFLICT targets business_members_uniq_user (the partial
-- unique index on (business_id, user_id) WHERE user_id IS NOT NULL AND
-- status IN ('invited','active')), so re-running this migration is a no-op.
-- (ROLE-CREATOR-BACKFILL-IDEMPOTENT)

INSERT INTO public.business_members
  (business_id, user_id, email, role, is_admin, status, invited_at, accepted_at)
SELECT b.id, b.owner_id, lower(u.email), 'approver', true, 'active', b.created_at, b.created_at
FROM public.businesses b
JOIN auth.users u ON u.id = b.owner_id
WHERE b.deleted_at IS NULL
ON CONFLICT (business_id, user_id) WHERE (user_id IS NOT NULL AND status IN ('invited','active'))
DO NOTHING;
