// ADR 0016 §5.2 — bounds the candidate scan every lib/db/memory-*.ts query
// takes. This is NOT the output cap (lib/memory's per-type CAP constants,
// B2) — it bounds how many active, non-expired rows the DB layer may return
// before lib/memory scores and truncates them (CLAUDE.md's no-unbounded-query
// rule, L-9).
export const MEMORY_CANDIDATE_LIMIT = 50
