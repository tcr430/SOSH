-- ADR 0013 (Rev A) §5 / §5.1 / §5.1b — capability-differentiated writes on posts.
-- THE APPROVAL BOUNDARY. SELECT policy is untouched; only INSERT/UPDATE/DELETE
-- are replaced (role-aware DELTA). approvePost's .eq('status','draft') atomic
-- guard is untouched — the trigger adds the capability guard on top of it.

-- 5.1a — Role-aware write policies.
DROP POLICY posts_insert_own ON public.posts;
DROP POLICY posts_update_own ON public.posts;
DROP POLICY posts_delete_own ON public.posts;

CREATE POLICY posts_insert_own ON public.posts
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = ANY ((SELECT public.get_user_business_ids()))
    AND (SELECT public.user_can(business_id, 'author'))
  );

-- Editor-floor: any editor+ may UPDATE the row. The trigger differentiates the
-- approval boundary. Keeps the existing atomic-guard pattern (callers still add
-- .eq('status','draft')); the WHERE guard and the capability check are orthogonal.
CREATE POLICY posts_update_own ON public.posts
  FOR UPDATE TO authenticated
  USING      (business_id = ANY ((SELECT public.get_user_business_ids()))
              AND (SELECT public.user_can(business_id, 'reschedule')))
  WITH CHECK (business_id = ANY ((SELECT public.get_user_business_ids()))
              AND (SELECT public.user_can(business_id, 'reschedule')));

CREATE POLICY posts_delete_own ON public.posts
  FOR DELETE TO authenticated
  USING (business_id = ANY ((SELECT public.get_user_business_ids()))
         AND (SELECT public.user_can(business_id, 'author')));

-- 5.1b — Status-transition capability trigger (the real approval boundary).
-- SET search_path = public added for parity with the DEFINER helpers (Rev A
-- reviewer note, non-blocking n3), even though this trigger runs as INVOKER —
-- it still calls user_can(), a DEFINER function, so locking the search path
-- here is defense-in-depth against search-path tricks in the calling session.
CREATE OR REPLACE FUNCTION public.enforce_post_transition_capability()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Service path (publishing/metrics workers) has no auth.uid(): exempt.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Rev A / m3 / L-17: ONLY *granting* approval is approver-gated. Every other
    -- human transition — unapprove (approved->draft to edit), remove (->skipped),
    -- author (draft<->skipped) — is editor+. Rationale: the gate exists to control
    -- what PUBLISHES, and nothing publishes without a fresh draft->approved; letting
    -- editors move/remove/unapprove approved posts cannot cause a publish and matches
    -- their existing ability to reschedule approved posts (D-3).
    IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
      IF NOT public.user_can(NEW.business_id, 'approve') THEN
        RAISE EXCEPTION 'approve capability required to grant approval (% -> %)',
          OLD.status, NEW.status;
      END IF;
    ELSE
      -- All other human status changes (incl. approved->draft, approved->skipped) are authoring.
      IF NOT public.user_can(NEW.business_id, 'author') THEN
        RAISE EXCEPTION 'author capability required for status transition % -> %',
          OLD.status, NEW.status;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_post_transition_capability
  BEFORE UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_post_transition_capability();
