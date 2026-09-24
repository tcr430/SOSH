'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getMemberForUser } from '@/lib/db/business-members'
import { getPostById, setPostClaimResolution } from '@/lib/db/posts'
import { retrieveEvidenceMemory } from '@/lib/memory'
import { hasCapability, resolveMemberContext, CAPABILITIES } from '@/lib/members/capabilities'
import { toUtcIso } from '@/lib/utils'
import { CLAIMS_MAX } from '@/lib/ai/prompts/formats/schemas'

// ADR 0027 §4.8 (Session 34 K2.10) — what a HUMAN does about a flagged claim at the post approval gate.
// AGENCY-CLAIMS-FLAGGED-NEVER-EDITED: this file NEVER writes posts.content, and it never changes what is shown
// to the model or the verdict itself — it records a human resolution beside a claim, nothing else.
//
// Three of the four §4.8 actions live here, and each is a HUMAN act:
//   accepted  — records an acknowledgement; the text is untouched.
//   dismissed — records the dismissal.
//   cited     — LINKS an EXISTING evidence_memory row. It SELECTS; it never CREATES (L-1 forbids new memory
//               writers and no creation surface exists, ruling A-9). The id must be one of the rows the
//               picker offered — the business-scoped, status='active', capped retrieval through lib/memory — so
//               an id that was merely guessed or pasted is refused ('unknown_evidence').
// The fourth action, EDIT THE TEXT, is the existing post-edit path (a link, not an action here), which ADR 0018
// already captures as a learning signal.
//
// Capability: the same gate as the approvals page itself (approve-capable or admin). UX and defence in depth —
// the boundary is RLS on posts.

const schema = z
  .object({
    postId: z.uuid(),
    claimIndex: z.coerce.number().int().min(0).max(CLAIMS_MAX - 1),
    resolution: z.enum(['accepted', 'dismissed', 'cited']),
    evidenceMemoryId: z.uuid().optional(),
  })
  .refine((v) => (v.resolution === 'cited') === (v.evidenceMemoryId !== undefined), {
    message: 'evidenceMemoryId is required for, and only for, a cited resolution',
  })

export type ResolveClaimError =
  | 'invalid_input'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'not_checked'
  | 'unknown_evidence'
  | 'generic'

export type ResolveClaimState =
  | { status: 'idle' }
  | { status: 'resolved'; postId: string; claimIndex: number; resolution: 'accepted' | 'dismissed' | 'cited' }
  | { status: 'error'; error: ResolveClaimError; postId?: string }

export async function resolveClaimAction(_prev: ResolveClaimState, formData: FormData): Promise<ResolveClaimState> {
  try {
    const rawEvidence = formData.get('evidenceMemoryId')
    const parsed = schema.safeParse({
      postId: formData.get('postId'),
      claimIndex: formData.get('claimIndex'),
      resolution: formData.get('resolution'),
      evidenceMemoryId: rawEvidence === null || rawEvidence === '' ? undefined : rawEvidence,
    })
    if (!parsed.success) return { status: 'error', error: 'invalid_input' }

    const client = await createClient()
    const {
      data: { user },
    } = await client.auth.getUser()
    if (!user) return { status: 'error', error: 'unauthorized' }
    const business = await getBusinessForUser(client, user.id)
    if (!business) return { status: 'error', error: 'unauthorized' }

    const memberRow = business.owner_id === user.id ? null : await getMemberForUser(client, business.id, user.id)
    const member = resolveMemberContext(business, user.id, memberRow)
    if (!(hasCapability(member, CAPABILITIES.APPROVE) || member.isAdmin)) return { status: 'error', error: 'forbidden' }

    // Ownership re-checked here, never trusted from the client (RLS is the boundary; this is defence in depth).
    const post = await getPostById(client, parsed.data.postId).catch(() => null)
    if (!post || post.business_id !== business.id) return { status: 'error', error: 'not_found' }

    if (parsed.data.resolution === 'cited') {
      // SELECTS, never CREATES: only an id from the same capped, business-scoped retrieval the picker used.
      const offered = await retrieveEvidenceMemory(client, business.id, {})
      if (!offered.some((row) => row.id === parsed.data.evidenceMemoryId)) {
        return { status: 'error', error: 'unknown_evidence', postId: parsed.data.postId }
      }
    }

    const outcome = await setPostClaimResolution(client, parsed.data.postId, parsed.data.claimIndex, {
      kind: parsed.data.resolution,
      ...(parsed.data.resolution === 'cited' ? { evidenceMemoryId: parsed.data.evidenceMemoryId } : {}),
      at: toUtcIso(new Date()),
      by: user.id,
    })
    if (outcome !== 'ok') {
      const error: ResolveClaimError = outcome === 'no_such_claim' ? 'invalid_input' : outcome
      return { status: 'error', error, postId: parsed.data.postId }
    }

    revalidatePath('/[locale]/approvals', 'page')
    return { status: 'resolved', postId: parsed.data.postId, claimIndex: parsed.data.claimIndex, resolution: parsed.data.resolution }
  } catch {
    // TODO(logger): log the swallowed error once the project logger lands (matches the other approvals actions).
    return { status: 'error', error: 'generic' }
  }
}
