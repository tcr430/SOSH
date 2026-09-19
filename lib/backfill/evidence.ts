import type { SocialBackfillPostRow } from '@/lib/db/types'
import { BACKFILL_EVIDENCE_MAX_CHARS } from './constants'

// ADR 0025 §4.5 BACKFILL-EVIDENCE-VERBATIM (Session 32 I2.12) —
// verify-then-cite: an item's content must be a VERBATIM substring of its
// cited post (after the SAME normalisation the provider applies —
// collapse whitespace, trim — twitter-provider.ts's buildXPlainTextContent
// and its LinkedIn counterpart both end with this exact step) and
// <= 500 chars, else DROPPED. A paraphrase, a truncated-but-altered copy,
// or a citation of a post outside the batch are all silently dropped —
// never repaired, never partially kept.

export function normalizeForVerification(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export interface RawEvidenceItem {
  kind: 'usage_data' | 'case_study' | 'quote'
  content: string
  platformPostId: string
}

export interface VerifiedEvidenceItem {
  kind: RawEvidenceItem['kind']
  content: string
  post: SocialBackfillPostRow
}

// Verifies EACH item against the batch's own posts — an item citing a
// platformPostId outside the batch has nothing to verify against and is
// dropped, exactly like a failed substring check.
export function verifyAndFilterEvidenceItems(
  items: readonly RawEvidenceItem[],
  batch: readonly SocialBackfillPostRow[],
): VerifiedEvidenceItem[] {
  const postsByPlatformId = new Map(batch.map((post) => [post.platform_post_id, post]))
  const verified: VerifiedEvidenceItem[] = []

  for (const item of items) {
    if (item.content.length > BACKFILL_EVIDENCE_MAX_CHARS) continue

    const post = postsByPlatformId.get(item.platformPostId)
    if (!post) continue // cites a post outside this batch

    const normalizedSource = normalizeForVerification(post.content)
    const normalizedItem = normalizeForVerification(item.content)
    if (!normalizedSource.includes(normalizedItem)) continue // not a verbatim substring — paraphrase or fabrication

    verified.push({ kind: item.kind, content: item.content, post })
  }

  return verified
}
