// ADR 0016 §5.2 — bounds the candidate scan every lib/db/memory-*.ts query
// takes. This is NOT the output cap (lib/memory's per-type CAP constants,
// B2) — it bounds how many active, non-expired rows the DB layer may return
// before lib/memory scores and truncates them (CLAUDE.md's no-unbounded-query
// rule, L-9).
//
// Caveat: this window is pre-sorted by the DB on (confidence DESC,
// recency_at DESC) ONLY — lib/memory's scopeMatch term isn't applied until
// after this fetch, so a record with a strong scope match but middling
// confidence/recency could in principle fall outside this window before
// scoring ever sees it. Negligible at Phase 1 per-business row counts
// (output caps are 3-5 against a window of 50); revisit if a business
// approaches this limit on active rows for one memory type.
export const MEMORY_CANDIDATE_LIMIT = 50
