// ADR 0025 (social read path and backfill) — every bound below is
// TRANSCRIBED verbatim from the ADR, never re-derived (Session 32 binding
// rule 1). Provider-owned bounds (page size, per-post content truncation,
// the read timeout and Retry-After ceiling) do NOT live here — they belong
// to lib/social/ and land at I2.2, because lib/backfill must not own a
// provider contract (ADR §2.3).

// ── §2.3 — orchestrator-owned fetch bounds ──────────────────────────────────

// Posts accepted per run — fetch stops once reached.
export const BACKFILL_MAX_POSTS = 200
// Lookback window in months (A-4, applies to both founder and company
// accounts) — older posts are discarded; fetch stops when a whole page is
// older than this.
export const BACKFILL_LOOKBACK_MONTHS = 24
// Pages per run — the non-terminating-cursor guard.
export const BACKFILL_MAX_PAGES = 5
// Platform reads per run, recorded on the run row.
export const BACKFILL_MAX_PLATFORM_READS = 500

// ── §6.1/§6.3 — cost ceilings ────────────────────────────────────────────────

// Per-run cumulative spend ceiling in cents (§6.1) — ~2.4x the realistic
// ~20.75c cost and ~1.5x the rounded worst case (§6.2). A run whose next
// call would cross it stops extracting and moves to awaiting_ratification
// with what it has, marked partial.
export const BACKFILL_RUN_CEILING_CENTS = 50
// Per-business daily ceiling in cents for the ai_budget_daily purpose
// 'backfill_cents' — three runs at the per-run ceiling (§6.3). A separate
// budget from the shared daily generation/triage cap so a first-day
// backfill never starves post generation on the day it must feel warm.
export const BACKFILL_DAILY_CENTS = 150

// ── §4.1 — pipeline pass sizes ───────────────────────────────────────────────

// The weighted subset: top N posts by lift, used as input to the insights
// pass and as the pool the voice pass's top 20 (below) is drawn from.
export const BACKFILL_WEIGHTED_SUBSET = 30
// Posts fed to the voice-synthesis model pass (top 20 of the weighted
// subset by lift).
export const BACKFILL_VOICE_INPUT_POSTS = 20
// Batch size for the evidence-extraction model pass over all staged posts.
export const BACKFILL_EVIDENCE_BATCH = 20

// ── §6.2 — extraction-time truncation ────────────────────────────────────────

// Characters a staged post's text is truncated to before it is fed to any
// model pass (the ~250-token-per-post cost arithmetic assumes this bound).
export const BACKFILL_EXTRACTION_TRUNCATE_CHARS = 1000

// ── §4.2 — voice ─────────────────────────────────────────────────────────────

// Writing examples staged for brand_voices application — matches the
// existing CHECK (cardinality(writing_examples) <= 3),
// 20260430120005_brand_voices.sql:15; this session does not widen that
// CHECK.
export const BACKFILL_VOICE_EXAMPLES = 3
// Max characters per staged writing example (verbatim excerpt).
export const BACKFILL_VOICE_EXAMPLE_MAX_CHARS = 1000

// ── §4.3 — performance memory ────────────────────────────────────────────────

// Imported performance_memory rows per account.
export const BACKFILL_PERFORMANCE_CAP = 15
// Minimum backing-post count for a format/topic/hook/proof_type pattern to
// be written; the model never supplies n — the orchestrator recomputes it
// from staging and drops anything below this floor.
export const BACKFILL_PATTERN_MIN_N = 5
// Minimum median lift for a pattern to be written, recomputed by the
// orchestrator from staging, never supplied by the model.
export const BACKFILL_PATTERN_MIN_LIFT = 1.25
// Confidence ceiling for an imported performance pattern: 0.6 * n/(n+5),
// capped here.
export const BACKFILL_CONFIDENCE_CEILING = 0.6

// ── §4.4 — audience memory ───────────────────────────────────────────────────

// Imported audience_memory rows per account.
export const BACKFILL_AUDIENCE_CAP = 25
// Flat confidence for every imported audience statement (thin evidence,
// self-reported framing).
export const BACKFILL_AUDIENCE_CONFIDENCE = 0.3
// Minimum backing posts an audience statement must cite.
export const BACKFILL_AUDIENCE_MIN_BACKING = 2

// ── §4.5 — evidence memory ───────────────────────────────────────────────────

// Imported evidence_memory rows per account.
export const BACKFILL_EVIDENCE_CAP = 40
// Flat confidence for every imported evidence row.
export const BACKFILL_EVIDENCE_CONFIDENCE = 0.5
// Max characters for an evidence row's verbatim-substring content.
export const BACKFILL_EVIDENCE_MAX_CHARS = 500

// ── §4.3/§4.5 — provenance decay ─────────────────────────────────────────────

// Expiry horizon in months, anchored to the SOURCE post's publishedAt (not
// the import time) — shared by imported performance patterns (§4.3) and
// evidence usage_data rows (§4.5). A pattern/row already expired at import
// is not written.
export const BACKFILL_EXPIRY_MONTHS = 12

// ── §9.1 — run cardinality ───────────────────────────────────────────────────

// Maximum backfill runs per social account (a failed run occupies its slot
// until resumed, not replaced — BACKFILL-ONCE-PER-ACCOUNT).
export const BACKFILL_MAX_RUNS_PER_ACCOUNT = 3

// ── §6.6 — timing ─────────────────────────────────────────────────────────────

// Target minutes from queued to awaiting_ratification for a full 200-post
// run. Verified operationally after launch (§6.7); not itself Tier-2
// tested.
export const BACKFILL_LATENCY_TARGET_MINUTES = 10
// Minutes of no progress before a run is marked failed (resumable).
export const BACKFILL_STALL_MINUTES = 30

// ── §8.3 — retention ──────────────────────────────────────────────────────────

// Days after which staged post text/metrics/permalink (social_backfill_posts)
// and staged voice (social_backfill_runs.staged_voice) are purged, whichever
// of the named triggers (ratification, discard, disconnect, or this TTL)
// comes first.
export const BACKFILL_STAGING_TTL_DAYS = 30
