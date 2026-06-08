-- email_webhook_events: audit log for Resend webhook events (ADR 0008 §14)
-- Mirrors billing_events: Resend event id as PK gives 23505 idempotency.
CREATE TABLE public.email_webhook_events (
  id              text        PRIMARY KEY,
  event_type      text        NOT NULL
                    CHECK (event_type IN (
                      'email.bounced','email.complained',
                      'email.delivered','email.opened',
                      'email.clicked','other'
                    )),
  payload         jsonb       NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_webhook_events ENABLE ROW LEVEL SECURITY;
-- No authenticated policy: service-role only.
