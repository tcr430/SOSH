-- ADR 0014 §3: widen email_outbox.kind to accept 'team-invite', extending
-- the ADR 0008 outbox (no new delivery mechanism, no other column touched).
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_kind_check;

ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_kind_check
  CHECK (kind IN ('trial-warning-t3','trial-warning-t1',
                  'welcome-to-plan','payment-failed-courtesy',
                  'first-post-published','team-invite'));
