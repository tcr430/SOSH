// ADR 0031 §5.2, §5.3 — the report's fixed numbers and the closed methodology keys.

/**
 * Stored with every report so a later reader knows which payload shape it holds.
 * 2 (Session 37-D D2, MINOR-7): the payload stores ids, never a business name, a campaign name, an account label or pattern text.
 * Version 1 was never released (PR #20 is unmerged, so no production report exists at it), so no back-compat renderer is kept and a
 * reader that meets a version it does not read still answers not-found, exactly as before.
 */
export const REPORT_SCHEMA_VERSION = 2

/** The report's trend is 6 months (the live Pro page shows 12): a forwarded document stays one readable page per section. */
export const REPORT_TREND_MONTHS = 6

/** Due on or after local day 10 of the month after the report's month, and not before 06:00 UTC that day. */
export const REPORT_DUE_DAY = 10
export const REPORT_DUE_UTC_HOUR = 6

/** At most this many reports are GENERATED per hourly tick (candidates are scanned by id in pages). */
export const REPORT_MAX_PER_TICK = 25
export const REPORT_SCAN_PAGE = 100
/**
 * A scan bound: re-reading not-yet-due businesses each hour is accepted at launch scale (ADR 0031 §5.2 [db-2]). The scan starts at
 * a per-hour offset and wraps (Session 37-D D4, MAJOR-5), so each tick covers min(1, REPORT_SCAN_CAP / N) of the id space and a
 * tick that cannot reach everyone says so (`capped`), instead of never visiting the ids past the cap.
 */
export const REPORT_SCAN_CAP = 2000
/** Failing businesses stop the tick at this many errors; they do NOT spend the generation budget (MAJOR-5). */
export const REPORT_ERROR_CAP = 25
/** A report that already exists is re-delivered, idempotently, for this long after it was created (MINOR-8, A-13(a)). */
export const REPORT_REDELIVERY_HOURS = 72

/** Section 5: the three measured posts with the highest day-7 rate. */
export const REPORT_TOP_POSTS = 3

/** The key `analytics.report.*` namespace is written with the report copy in O2.8; the payload carries KEYS and PARAMS only. */
export const REPORT_KEYS = {
  header: 'analytics.report.header',
  stub: 'analytics.report.stub',
  ratedPostsTitle: 'analytics.report.ratedPosts.title',
  ratedPostsCaveat: 'analytics.report.ratedPosts.caveat',
  lateOutcomes: 'analytics.report.lateOutcomes',
} as const

/** Section 11, "How to read this" (ADR 0031 §5.3, [mle-11]): every key present in EVERY generated payload, the stub included. */
export const REPORT_METHODOLOGY_KEYS = [
  'analytics.report.methodology.median',
  'analytics.report.methodology.maturity',
  'analytics.report.methodology.exclusions',
  'analytics.report.methodology.usual',
  'analytics.report.methodology.floors',
  'analytics.report.methodology.xOnly',
  'analytics.report.methodology.descriptive',
  'analytics.report.methodology.engagementOnly',
] as const
