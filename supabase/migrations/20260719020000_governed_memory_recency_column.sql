-- ADR 0016 §5.3 — B1 follow-up. PostgREST's `.order()` can only target a real
-- column, not an arbitrary expression like `COALESCE(last_confirmed_at,
-- created_at)`. To let lib/db/memory-*.ts express the retrieval order
-- through supabase-js while still using the B0 retrieval index, add a STORED
-- generated column that mirrors the COALESCE and re-point the index at it.
-- The formula is unchanged — this only gives the existing formula a name
-- PostgREST can reference.

ALTER TABLE public.brand_memory
  ADD COLUMN recency_at timestamptz GENERATED ALWAYS AS (COALESCE(last_confirmed_at, created_at)) STORED;

DROP INDEX public.brand_memory_retrieval_idx;

CREATE INDEX brand_memory_retrieval_idx ON public.brand_memory
  (business_id, confidence DESC, recency_at DESC)
  WHERE deleted_at IS NULL AND status = 'active';

-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.evidence_memory
  ADD COLUMN recency_at timestamptz GENERATED ALWAYS AS (COALESCE(last_confirmed_at, created_at)) STORED;

DROP INDEX public.evidence_memory_retrieval_idx;

CREATE INDEX evidence_memory_retrieval_idx ON public.evidence_memory
  (business_id, confidence DESC, recency_at DESC)
  WHERE deleted_at IS NULL AND status = 'active';

-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.audience_memory
  ADD COLUMN recency_at timestamptz GENERATED ALWAYS AS (COALESCE(last_confirmed_at, created_at)) STORED;

DROP INDEX public.audience_memory_retrieval_idx;

CREATE INDEX audience_memory_retrieval_idx ON public.audience_memory
  (business_id, confidence DESC, recency_at DESC)
  WHERE deleted_at IS NULL AND status = 'active';

-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.performance_memory
  ADD COLUMN recency_at timestamptz GENERATED ALWAYS AS (COALESCE(last_confirmed_at, created_at)) STORED;

DROP INDEX public.performance_memory_retrieval_idx;

CREATE INDEX performance_memory_retrieval_idx ON public.performance_memory
  (business_id, confidence DESC, recency_at DESC)
  WHERE deleted_at IS NULL AND status = 'active';
