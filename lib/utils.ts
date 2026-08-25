import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function toUtcIso(d: Date): string {
  // eslint-disable-next-line no-restricted-properties -- the one sanctioned native call; see CLAUDE.md date rule
  return d.toISOString()
}

// ADR 0022 §6.5 (Session 29, F1b.6) — the exhaustiveness-check idiom for a
// switch dispatching on a bare string union (a discriminated-union TAG on
// its own, not a tagged object field) — tsc's discriminated-union narrowing
// only fires on the latter, so a switch missing a case here would otherwise
// compile silently. Calling assertNever(x) in the default arm only
// type-checks once every real case has its own arm; adding a union member
// without adding its case turns this into a compile error, not a runtime
// surprise.
export function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`)
}
