// ADR 0027 §3.2 / §7.4 / §2.3 — the campaign planner's named constants. Every value is a literal transcribed
// from the ADR, none is read from env (the one tunable, AI_PLANNER_DAILY_CAP_CENTS, arrives through
// lib/config.ts). The seven AI_PLANNER_* bounds are NEW siblings of lib/ai/tool-runner.ts's TRIAGE_* constants;
// the TRIAGE_* names are deliberately NOT renamed in this session (ADR 0027 §3.1, [sec-MAJOR-3]).
//
// A human is waiting on this loop — every number below is derived from that (ADR 0027 §3.2).

// §3.2 — the intelligence doc's "2-4 bounded tool calls". Six tools exist; a plan needs evidence + brand +
// one follow-up evidence query, not a sweep of the inventory.
export const AI_PLANNER_MAX_TOOL_CALLS = 4

// §3.2 — 5 requests serve 4 tool calls; 1 spare absorbs a malformed tool block.
export const AI_PLANNER_MAX_TURNS = 6

// §3.2 — typical run is 33 000 (§7.1), so the cap sits ~1.5x above normal and fires on pathology, not variance.
export const AI_PLANNER_MAX_CUMULATIVE_INPUT_TOKENS = 50_000

// §3.2 — a proposal set with reason strings is longer than a triage verdict.
export const AI_PLANNER_MAX_OUTPUT_TOKENS_PER_TURN = 2_048

// §3.2 — 5 x 300 + one 1 500-token final turn, ~1.5x headroom.
export const AI_PLANNER_MAX_CUMULATIVE_OUTPUT_TOKENS = 6_000

// §3.2 — the human-is-waiting number. 45 s is a worker budget; p50 is ~22 s (§7.3), so 30 s fires on pathology.
export const AI_PLANNER_MAX_WALL_CLOCK_MS = 30_000

// §3.2 — a retry costs RETRY_DELAY_MS the user feels; the deadline, not this knob, caps how many attempts fit.
export const AI_PLANNER_RETRY_BUDGET = 1

// §7.4 — the worst case at the bounds (§7.1: 15 c input + 9 c output), reserved up front and reconciled to
// actual spend on EVERY outcome including failure.
export const PLANNER_RESERVATION_CENTS = 24

// §2.3 — the closed inventory: six tools, all reads, no seventh (`AGENCY-TOOLS-CLOSED-INVENTORY`, K2.4).
// Adding a name here without an ADR amendment is the "small seventh tool" §2.3 exists to prevent.
export const PLANNER_TOOL_NAMES = [
  'list_evidence',
  'list_brand_claims',
  'list_audience_notes',
  'list_recent_campaigns',
  'get_campaign_signal',
  'list_recent_posts',
] as const

export type PlannerToolName = (typeof PLANNER_TOOL_NAMES)[number]
