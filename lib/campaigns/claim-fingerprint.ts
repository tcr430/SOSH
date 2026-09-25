import { createHash } from 'node:crypto'
import type { PersistedClaimCheck } from '@/lib/db/types'

// ADR 0027 §4.8 — Session 34-D D7 (MAJOR-3). A claim check stores SPANS into the post's text (verify-claims.ts:
// "Rendering a claim means slicing THE POST"), so it is valid only for the exact text it was computed on. Rather
// than clear it in every writer that can change the text (edit, calendar edit, regenerate, and any future one —
// the named loser, per-writer clearing), the check carries a FINGERPRINT of that text and every READER treats a
// mismatch as "not checked". A writer added tomorrow is covered without anyone remembering it.
//
// THE ONE HASHER. This is the only place a claim-check fingerprint is computed; nothing else hashes (a scan in
// lib/campaigns/__tests__/claim-fingerprint.test.ts pins it). Server-only by construction (node:crypto).
//
// WHAT IS HASHED: exactly the `posts.content` string the spans index into — NOT content plus hashtags. Hashtags
// live in their own column and are edited independently; folding them in would invalidate a check on a hashtag-only
// edit (the spans are still right), and would make an UNEDITED post's fingerprint depend on a column the spans
// never index (the trap the D7 reddening (b) exists to catch).
export function contentFingerprint(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

// Stamps a verdict with the fingerprint of the text it was computed on. Applied to EVERY variant, not only
// `checked`: a stale "no_claims" would tell a reviewer nothing needs checking on text that has since gained claims.
export function withContentFingerprint(check: PersistedClaimCheck, content: string): PersistedClaimCheck {
  return { ...check, contentFingerprint: contentFingerprint(content) }
}

// True only when the check carries a fingerprint AND it matches the text now in the post. A check with NO
// fingerprint (K2.9-era, before this fix) is NOT valid: absence already means "not checked", never "clean".
export function claimCheckMatchesContent(check: PersistedClaimCheck | undefined, content: string): check is PersistedClaimCheck {
  return check !== undefined && fingerprintMatchesContent(check.contentFingerprint, content)
}

// The rule itself, for anything else that is computed FROM a post's text and must not outlive it (Session 34-D D9:
// the redundancy flag). Same one hasher, same "absent means not valid" reading.
export function fingerprintMatchesContent(fingerprint: string | undefined, content: string): boolean {
  return typeof fingerprint === 'string' && fingerprint === contentFingerprint(content)
}
