-- email_suppressions: addresses we must not send to (ADR 0008 §6)
CREATE TABLE public.email_suppressions (
  email           text        PRIMARY KEY,
  reason          text        NOT NULL
                    CHECK (reason IN ('bounce','complaint','manual')),
  source_event_id text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;
-- No authenticated policy: suppressions are service-role only.
-- They are not tenant-scoped and exposing them would leak
-- deliverability state across tenants.
