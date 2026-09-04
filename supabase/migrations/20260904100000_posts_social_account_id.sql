-- Migration: posts.social_account_id (ADR 0028 §9.2, N2.4)
--
-- Adds the publish-identity FK from posts to social_accounts. This is
-- Migration B of Session 30.5 Track N — it introduces the column only.
-- The resolver that populates it (posts.social_account_id -> business
-- default -> account_ambiguous failure) is N2.5, deliberately out of scope
-- here.
--
-- (a) Nullable is deliberate: existing rows have no publish identity and
--     must not be guessed at. A post created before this column existed, or
--     not yet resolved to a specific connected account, stays NULL.
-- (b) ON DELETE SET NULL, not CASCADE: disconnecting a social account must
--     never delete a business's published post history. A post survives its
--     account's disconnection with social_account_id cleared.
-- (c) No backfill, and none is possible: the pre-native (Postiz) integration
--     never populated an equivalent identity column on posts, and
--     social_accounts.platform_user_id historically stored Postiz
--     integrationIds, not native platform account ids — there is nothing to
--     map existing rows against (D-gamma).

ALTER TABLE public.posts
  ADD COLUMN social_account_id uuid NULL
    REFERENCES public.social_accounts(id) ON DELETE SET NULL;

CREATE INDEX posts_social_account_id_idx
  ON public.posts (social_account_id)
  WHERE social_account_id IS NOT NULL;
