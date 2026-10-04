// ADR 0031 §2.7 (ANALYTICS-NO-SILENT-TRUNCATION) — the pager every aggregate read goes through.
//
// An aggregate (a median, a win count, an exclusion count) computed over a read that silently stopped at its LIMIT is a
// wrong number that looks right. So an aggregate read pages on its ORDER BY columns (a keyset, never OFFSET) until a page
// comes back short, and a hard ceiling stops a runaway: hitting it THROWS a typed error that the loader turns into the
// section's error state. There is no code path that returns the rows read so far.

/** Rows one read may return before it is refused (ADR 0031 §2.7). */
export const READ_CEILING = 5000

export class ReadCeilingExceeded extends Error {
  readonly read: string
  readonly ceiling: number

  constructor(read: string, ceiling: number) {
    super(`${read}: more than ${ceiling} rows; refusing to aggregate over a truncated read`)
    this.name = 'ReadCeilingExceeded'
    this.read = read
    this.ceiling = ceiling
  }
}

export interface PageAllOptions<Row> {
  /** Names the read in the error. */
  read: string
  pageSize: number
  /** Defaults to READ_CEILING. A test lowers it; production never does. */
  ceiling?: number
  /** One page of at most `limit` rows strictly after `after` (null for the first page), in the read's ORDER BY. */
  fetchPage: (after: Row | null, limit: number) => Promise<Row[]>
}

export async function readAllPages<Row>(opts: PageAllOptions<Row>): Promise<Row[]> {
  const ceiling = opts.ceiling ?? READ_CEILING
  const rows: Row[] = []
  let after: Row | null = null
  for (;;) {
    // Never ask for more than one row past the ceiling: that one row is how an over-ceiling read is detected.
    const limit = Math.min(opts.pageSize, ceiling + 1 - rows.length)
    const page = await opts.fetchPage(after, limit)
    rows.push(...page)
    if (rows.length > ceiling) throw new ReadCeilingExceeded(opts.read, ceiling)
    if (page.length < limit) return rows
    after = page[page.length - 1]
  }
}

function quoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * The PostgREST `or()` expression for "strictly after this cursor" on `ORDER BY primary DESC, tiebreak DESC`:
 * `primary < p OR (primary = p AND tiebreak < t)`. Values are double-quoted so a timestamp's colons and sign cannot
 * be read as syntax.
 */
export function keysetFilterDesc(primary: string, tiebreak: string, cursor: { primary: string; tiebreak: string }): string {
  const p = quoted(cursor.primary)
  return `${primary}.lt.${p},and(${primary}.eq.${p},${tiebreak}.lt.${quoted(cursor.tiebreak)})`
}
