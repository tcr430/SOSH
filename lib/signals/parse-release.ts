// ADR 0020 §5 / §7.3 / §10.1 — the ONLY place a raw GitHub release payload
// becomes a SOSH row, and the ONLY minter of UntrustedText on the write
// path (the read path's own mint is lib/db/signals.ts's asSignalRow, §7.4).
//
// A parse failure is a per-item skip that CONTINUES the repo's ingestion
// (§4.5's `malformed` row) — this function never throws, so one malformed
// release in a page of 30 cannot abort the other 29.

import { z } from 'zod'
import type { SignalInsert, UntrustedText } from '@/lib/db/types'

// Mirrors lib/signals/github-client.ts's GithubRelease interface field for
// field — not the full GitHub API response. Any field this schema does not
// name is invisible to the parser from this point on, which is what makes
// the contributor-identity drop STRUCTURAL rather than a runtime filter
// that could be forgotten (§5.3): author.login, author.id, author.node_id,
// author.avatar_url, author.html_url, author_association, reactions,
// assets[], mentions_count, tarball_url, zipball_url have no field on this
// schema, and therefore no field on ParsedSignal below, to receive them.
const releaseSchema = z.object({
  id: z.number(),
  tag_name: z.string(),
  name: z.string().nullable(),
  body: z.string().nullable(),
  html_url: z.string(),
  // Nullable at the schema level because GitHub itself sets this null on a
  // DRAFT release (the shape the draft check below needs to see). The
  // stronger rule — a published (non-draft) release must have a non-null
  // published_at — is a business rule enforced AFTER the draft check, not
  // a shape constraint; see the malformed-on-null-when-published branch.
  published_at: z.string().nullable(),
  prerelease: z.boolean(),
  draft: z.boolean(),
  author: z.object({ type: z.string() }).nullable(),
})

// ADR 0020 §5.3 — exactly the fields a single release payload can supply.
// Deliberately `Omit<SignalInsert, ...>` rather than a hand-written sibling
// type: business_id / watched_repo_id / source / kind / ingested_via are
// poller (caller) context, never derivable from a release object, and
// omitting them FROM SignalInsert ITSELF is what makes "this file cannot
// produce a contributor-identity field" a compile-time fact about
// SignalInsert's own shape, not merely a claim this file makes about
// itself.
//
// `tag_name` is NOT included, though §5.3 lists it as retained: no
// `signals.tag_name` column exists yet — the same drift lib/db/
// signal-candidates.ts:19-28 already documents against §13.1's join list.
// This function has the raw value in hand (release.tag_name) but nowhere
// on SignalInsert to put it; inventing a migration in this step is scope
// this ADR doesn't ask for here. `repo_id` is likewise absent: it
// identifies the REPO, not the release, and is already known via
// watched_repos.repo_id before this function is ever called — a single
// release payload carries no such field to parse in the first place.
export type ParsedSignal = Omit<
  SignalInsert,
  'id' | 'business_id' | 'watched_repo_id' | 'source' | 'kind' | 'ingested_via' | 'created_at' | 'updated_at'
>

export type ParseReleaseResult =
  | { status: 'ok'; signal: ParsedSignal }
  // §5.1 — a draft is a well-formed release object, just not one the
  // customer chose to publish; distinct from `malformed` so a future
  // caller's §4.5 malformed count isn't inflated by ordinary draft traffic.
  | { status: 'skipped_draft' }
  | { status: 'malformed'; issues: string[] }

// §5.4 / [sec-LOW-9] — a COST and payload-size control, NOT a security
// control: a complete prompt-injection payload fits comfortably under 8,000
// characters. lib/ai/wrap-evidence.ts's wrapSignalForPrompt (E2.4's
// read-time guard) is the actual defence; this cap only bounds what gets
// stored and transmitted.
export const BODY_MAX_CHARS = 8000

// UTF-16 surrogate-pair-safe truncation [sec-LOW-9]: `.slice(0, n)` alone
// can land the cut boundary between a high surrogate (0xD800-0xDBFF) and
// its low-surrogate partner, leaving a lone unpaired surrogate at the end
// of the string — invalid UTF-16 that corrupts downstream UTF-8 encoding.
// If the character immediately before the cut is a high surrogate, the
// pair's other half sits exactly at the cut boundary; back off one further
// index so the whole pair is either kept or dropped, never split.
function truncateMultibyteSafe(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  let end = maxChars
  const charBeforeCut = text.charCodeAt(end - 1)
  if (charBeforeCut >= 0xd800 && charBeforeCut <= 0xdbff) {
    end -= 1
  }
  return { text: text.slice(0, end), truncated: true }
}

export function parseRelease(raw: unknown): ParseReleaseResult {
  const result = releaseSchema.safeParse(raw)
  if (!result.success) {
    return { status: 'malformed', issues: result.error.issues.map((issue) => issue.message) }
  }
  const release = result.data

  if (release.draft) return { status: 'skipped_draft' }

  // §5.1 — a published (non-draft) release with a null published_at is not
  // a shape GitHub is documented to produce; treated as malformed rather
  // than silently defaulted (e.g. to "now"), so the caller's malformed
  // count reflects an unexpected payload instead of masking it.
  if (release.published_at === null) {
    return { status: 'malformed', issues: ['published_at is null on a non-draft release'] }
  }

  const rawTitle = release.name ?? release.tag_name
  const rawBody = release.body ?? ''
  const { text: truncatedBody, truncated } = truncateMultibyteSafe(rawBody, BODY_MAX_CHARS)

  const signal: ParsedSignal = {
    external_id: `github:release:${release.id}`,
    // §7.3 — minted here, and only here, on the write path.
    title: rawTitle as UntrustedText,
    body: truncatedBody as UntrustedText,
    body_truncated: truncated,
    html_url: release.html_url,
    occurred_at: release.published_at,
    is_prerelease: release.prerelease,
    // §5.3 — a boolean DERIVED from the release's author.type, not an
    // identity: the only author-adjacent value that survives ingestion.
    author_is_bot: release.author?.type === 'Bot',
  }
  return { status: 'ok', signal }
}
