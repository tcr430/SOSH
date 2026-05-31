-- B4: Token-bucket rate limiting for auth actions (ADR 0007 §5)
-- tokens column is NUMERIC(10,4) — NOT REAL — to prevent drift.

CREATE TABLE auth_rate_limits (
  bucket_key   TEXT PRIMARY KEY,
  tokens       NUMERIC(10, 4) NOT NULL,
  last_refill  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE auth_rate_limits ENABLE ROW LEVEL SECURITY;
-- No RLS policies. Service-role bypasses RLS entirely.

CREATE OR REPLACE FUNCTION public.consume_rate_limit_token(
  p_bucket_key            text,
  p_capacity              numeric,
  p_refill_per_second     numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row auth_rate_limits;
  v_refill numeric;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_row FROM auth_rate_limits
    WHERE bucket_key = p_bucket_key FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO auth_rate_limits (bucket_key, tokens, last_refill)
    VALUES (p_bucket_key, p_capacity - 1, v_now);
    RETURN true;
  END IF;

  v_refill := EXTRACT(EPOCH FROM (v_now - v_row.last_refill)) * p_refill_per_second;
  v_row.tokens := LEAST(p_capacity, v_row.tokens + v_refill);

  IF v_row.tokens >= 1 THEN
    UPDATE auth_rate_limits
       SET tokens = v_row.tokens - 1,
           last_refill = v_now,
           updated_at = v_now
     WHERE bucket_key = p_bucket_key;
    RETURN true;
  ELSE
    UPDATE auth_rate_limits
       SET tokens = v_row.tokens,
           last_refill = v_now,
           updated_at = v_now
     WHERE bucket_key = p_bucket_key;
    RETURN false;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit_token(text, numeric, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit_token(text, numeric, numeric) TO service_role;
