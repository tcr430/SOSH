-- ADR 0010 A1.5 (T5): business_deletion_requests table.
-- Records user-initiated account deletion requests. The 30-day hard-delete
-- cron (F-1), the in-app Delete Account UI (Settings), and the auth_rate_limits
-- TTL purge are deferred — tracked in docs/launch-checklist.md §16.

CREATE TABLE public.business_deletion_requests (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid        NOT NULL REFERENCES public.businesses(id),
  requested_at        timestamptz NOT NULL DEFAULT now(),
  verified_at         timestamptz,
  scheduled_purge_at  timestamptz,
  purged_at           timestamptz
);

ALTER TABLE public.business_deletion_requests ENABLE ROW LEVEL SECURITY;

-- Owner can read their own deletion request via business_id FK.
-- INSERT/UPDATE/DELETE are service-role only at this stage; the in-app
-- delete flow (backlog) will add user-facing policies when it ships.
CREATE POLICY "owner can read own deletion request"
  ON public.business_deletion_requests
  FOR SELECT
  USING (
    business_id IN (SELECT get_user_business_ids())
  );
