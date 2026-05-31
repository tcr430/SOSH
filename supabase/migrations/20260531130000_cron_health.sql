CREATE TABLE cron_health (
  cron_slug    TEXT PRIMARY KEY,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE cron_health ENABLE ROW LEVEL SECURITY;
-- No RLS policies: service-role only.
