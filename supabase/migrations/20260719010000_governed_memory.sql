-- ADR 0016 §2-§4 — Governed Memory Foundation (Track A / Session 23 B0)
--
-- Four new governed-memory tables: brand_memory, evidence_memory,
-- audience_memory, performance_memory. Each carries the shared governance
-- column block (ADR §2) plus its own domain columns (ADR §3.1-§3.4).
--
-- Voice is read THROUGH the existing brand_voices / brand_voice_variations
-- tables (ADR §3.5) — no voice_memory table here. `relationship` memory is
-- deferred (ADR §3.6) — no table here.
--
-- RLS uses the POST-017 InitPlan-wrapped form
-- `business_id = ANY (SELECT unnest(public.get_user_business_ids()))`,
-- NOT the pre-017 bare `= ANY (public.get_user_business_ids())` form
-- (campaigns.sql:42-59, superseded by 20260430120017 /
-- 20260702120100_get_user_business_ids_multimember.sql).
--
-- No user_can() write-gating in Track A (ADR §4 "Role-gating decision") —
-- the only writers today are the service-role generation path and (later)
-- Track C's service-role distillation worker, both of which bypass RLS.
-- These plain any-member policies are defense-in-depth for a future
-- authenticated memory-management UI; capability gating is added in the
-- same session that ships that UI, not speculatively now.

-- ─── brand_memory (ADR §3.1) ────────────────────────────────────────────────

CREATE TABLE public.brand_memory (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id            uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,

  -- governance block (ADR §2)
  source                 text        NOT NULL CHECK (source IN ('manual', 'distilled', 'import')),
  confidence             numeric(3,2) NOT NULL DEFAULT 0.50 CHECK (confidence >= 0 AND confidence <= 1),
  observation_count      int         NOT NULL DEFAULT 1 CHECK (observation_count >= 1),
  status                 text        NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'active', 'retired')),
  sensitivity            text        NOT NULL DEFAULT 'internal' CHECK (sensitivity IN ('public', 'internal', 'confidential')),
  public_use_permission  boolean     NOT NULL DEFAULT false,
  scope                  text        NOT NULL CHECK (scope IN ('brand', 'campaign', 'platform', 'contact')),
  scope_ref              text,
  last_confirmed_at      timestamptz,
  expires_at             timestamptz,
  deleted_at             timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- domain columns (ADR §3.1)
  category               text        NOT NULL CHECK (category IN ('positioning', 'capability', 'pricing', 'competitor', 'other')),
  statement              text        NOT NULL
);

CREATE INDEX brand_memory_business_id_idx ON public.brand_memory (business_id);

CREATE INDEX brand_memory_retrieval_idx ON public.brand_memory
  (business_id, confidence DESC, COALESCE(last_confirmed_at, created_at) DESC)
  WHERE deleted_at IS NULL AND status = 'active';

CREATE TRIGGER trg_brand_memory_updated_at
BEFORE UPDATE ON public.brand_memory
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.brand_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY brand_memory_select_own
  ON public.brand_memory FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY brand_memory_insert_own
  ON public.brand_memory FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY brand_memory_update_own
  ON public.brand_memory FOR UPDATE TO authenticated
  USING      (business_id = ANY (SELECT unnest(public.get_user_business_ids())))
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY brand_memory_delete_own
  ON public.brand_memory FOR DELETE TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- ─── evidence_memory (ADR §3.2) ─────────────────────────────────────────────
--
-- May hold third-party PII (a named customer quote). business_id-scoped and
-- ON DELETE CASCADE, so business erasure purges it — cascade IS erasure.
-- sensitivity + public_use_permission govern whether a given quote may reach
-- published output; enforcement of that gate is a CONSUMER concern (0017's
-- brief assembly), not this migration.

CREATE TABLE public.evidence_memory (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id            uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,

  -- governance block (ADR §2)
  source                 text        NOT NULL CHECK (source IN ('manual', 'distilled', 'import')),
  confidence             numeric(3,2) NOT NULL DEFAULT 0.50 CHECK (confidence >= 0 AND confidence <= 1),
  observation_count      int         NOT NULL DEFAULT 1 CHECK (observation_count >= 1),
  status                 text        NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'active', 'retired')),
  sensitivity            text        NOT NULL DEFAULT 'internal' CHECK (sensitivity IN ('public', 'internal', 'confidential')),
  public_use_permission  boolean     NOT NULL DEFAULT false,
  scope                  text        NOT NULL CHECK (scope IN ('brand', 'campaign', 'platform', 'contact')),
  scope_ref              text,
  last_confirmed_at      timestamptz,
  expires_at             timestamptz,
  deleted_at             timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- domain columns (ADR §3.2)
  kind                   text        NOT NULL CHECK (kind IN ('quote', 'case_study', 'usage_data', 'other')),
  content                text        NOT NULL,
  source_url             text
);

CREATE INDEX evidence_memory_business_id_idx ON public.evidence_memory (business_id);

CREATE INDEX evidence_memory_retrieval_idx ON public.evidence_memory
  (business_id, confidence DESC, COALESCE(last_confirmed_at, created_at) DESC)
  WHERE deleted_at IS NULL AND status = 'active';

CREATE TRIGGER trg_evidence_memory_updated_at
BEFORE UPDATE ON public.evidence_memory
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.evidence_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY evidence_memory_select_own
  ON public.evidence_memory FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY evidence_memory_insert_own
  ON public.evidence_memory FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY evidence_memory_update_own
  ON public.evidence_memory FOR UPDATE TO authenticated
  USING      (business_id = ANY (SELECT unnest(public.get_user_business_ids())))
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY evidence_memory_delete_own
  ON public.evidence_memory FOR DELETE TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- ─── audience_memory (ADR §3.3) ─────────────────────────────────────────────

CREATE TABLE public.audience_memory (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id            uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,

  -- governance block (ADR §2)
  source                 text        NOT NULL CHECK (source IN ('manual', 'distilled', 'import')),
  confidence             numeric(3,2) NOT NULL DEFAULT 0.50 CHECK (confidence >= 0 AND confidence <= 1),
  observation_count      int         NOT NULL DEFAULT 1 CHECK (observation_count >= 1),
  status                 text        NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'active', 'retired')),
  sensitivity            text        NOT NULL DEFAULT 'internal' CHECK (sensitivity IN ('public', 'internal', 'confidential')),
  public_use_permission  boolean     NOT NULL DEFAULT false,
  scope                  text        NOT NULL CHECK (scope IN ('brand', 'campaign', 'platform', 'contact')),
  scope_ref              text,
  last_confirmed_at      timestamptz,
  expires_at             timestamptz,
  deleted_at             timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- domain columns (ADR §3.3)
  segment                text,
  kind                   text        NOT NULL CHECK (kind IN ('problem', 'objection', 'question', 'trigger', 'other')),
  statement              text        NOT NULL
);

CREATE INDEX audience_memory_business_id_idx ON public.audience_memory (business_id);

CREATE INDEX audience_memory_retrieval_idx ON public.audience_memory
  (business_id, confidence DESC, COALESCE(last_confirmed_at, created_at) DESC)
  WHERE deleted_at IS NULL AND status = 'active';

CREATE TRIGGER trg_audience_memory_updated_at
BEFORE UPDATE ON public.audience_memory
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.audience_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY audience_memory_select_own
  ON public.audience_memory FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY audience_memory_insert_own
  ON public.audience_memory FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY audience_memory_update_own
  ON public.audience_memory FOR UPDATE TO authenticated
  USING      (business_id = ANY (SELECT unnest(public.get_user_business_ids())))
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY audience_memory_delete_own
  ON public.audience_memory FOR DELETE TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- ─── performance_memory (ADR §3.4) ──────────────────────────────────────────
--
-- Ships EMPTY. Track C's distillation worker is the writer. Track A's
-- lib/memory/performance.ts derives its scored patterns from the existing
-- post_metrics table and prefers performance_memory rows once Track C
-- populates them. Table + RLS + cascade ship now so Track C has a governed
-- target to write into.

CREATE TABLE public.performance_memory (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id            uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,

  -- governance block (ADR §2)
  source                 text        NOT NULL CHECK (source IN ('manual', 'distilled', 'import')),
  confidence             numeric(3,2) NOT NULL DEFAULT 0.50 CHECK (confidence >= 0 AND confidence <= 1),
  observation_count      int         NOT NULL DEFAULT 1 CHECK (observation_count >= 1),
  status                 text        NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'active', 'retired')),
  sensitivity            text        NOT NULL DEFAULT 'internal' CHECK (sensitivity IN ('public', 'internal', 'confidential')),
  public_use_permission  boolean     NOT NULL DEFAULT false,
  scope                  text        NOT NULL CHECK (scope IN ('brand', 'campaign', 'platform', 'contact')),
  scope_ref              text,
  last_confirmed_at      timestamptz,
  expires_at             timestamptz,
  deleted_at             timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- domain columns (ADR §3.4)
  dimension              text        NOT NULL CHECK (dimension IN ('topic', 'hook', 'format', 'proof_type')),
  pattern                text        NOT NULL,
  platform               text        CHECK (platform IS NULL OR platform IN ('linkedin', 'twitter', 'instagram', 'facebook', 'threads'))
);

CREATE INDEX performance_memory_business_id_idx ON public.performance_memory (business_id);

CREATE INDEX performance_memory_retrieval_idx ON public.performance_memory
  (business_id, confidence DESC, COALESCE(last_confirmed_at, created_at) DESC)
  WHERE deleted_at IS NULL AND status = 'active';

CREATE TRIGGER trg_performance_memory_updated_at
BEFORE UPDATE ON public.performance_memory
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.performance_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY performance_memory_select_own
  ON public.performance_memory FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY performance_memory_insert_own
  ON public.performance_memory FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY performance_memory_update_own
  ON public.performance_memory FOR UPDATE TO authenticated
  USING      (business_id = ANY (SELECT unnest(public.get_user_business_ids())))
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY performance_memory_delete_own
  ON public.performance_memory FOR DELETE TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));
