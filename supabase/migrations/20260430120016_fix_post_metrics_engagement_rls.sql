-- Migration 016: Drop authenticated write policies from post_metrics and engagement_inbox
--
-- Both tables are written by background workers via the service-role client only.
-- Authenticated users may SELECT their own rows; INSERT/UPDATE/DELETE must not be
-- reachable from client sessions. This matches the pattern already used by
-- ai_usage and trial_state.

DROP POLICY post_metrics_insert_own ON public.post_metrics;
DROP POLICY post_metrics_update_own ON public.post_metrics;
DROP POLICY post_metrics_delete_own ON public.post_metrics;

DROP POLICY engagement_inbox_insert_own ON public.engagement_inbox;
DROP POLICY engagement_inbox_update_own ON public.engagement_inbox;
DROP POLICY engagement_inbox_delete_own ON public.engagement_inbox;
