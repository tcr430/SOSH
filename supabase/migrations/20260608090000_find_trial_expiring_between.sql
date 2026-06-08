-- RPC used by the trial-warnings cron to find trials expiring in a given window.
-- Joins auth.users so the caller never has to make a separate N+1 email lookup.
-- SECURITY DEFINER so it can read auth.users from a service-role context.
CREATE OR REPLACE FUNCTION find_trial_expiring_between(
  p_from timestamptz,
  p_to   timestamptz
)
RETURNS TABLE (
  business_id      uuid,
  business_name    text,
  recipient_email  text,
  language         text,
  trial_expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id                                                          AS business_id,
    b.name                                                        AS business_name,
    u.email                                                       AS recipient_email,
    b.language                                                    AS language,
    (ts.trial_started_at::timestamptz + INTERVAL '14 days')      AS trial_expires_at
  FROM trial_state ts
  JOIN businesses b ON b.id = ts.business_id
  JOIN auth.users u ON u.id = b.owner_id
  WHERE b.plan = 'trial'
    AND b.deleted_at IS NULL
    AND ts.trial_started_at IS NOT NULL
    AND (ts.trial_started_at::timestamptz + INTERVAL '14 days') >= p_from
    AND (ts.trial_started_at::timestamptz + INTERVAL '14 days') <  p_to
  ORDER BY trial_expires_at
  LIMIT 500;
$$;

REVOKE ALL ON FUNCTION find_trial_expiring_between(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_trial_expiring_between(timestamptz, timestamptz) TO service_role;
