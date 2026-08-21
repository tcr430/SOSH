'use server'

// ADR 0021 §5.2/§5.3/§5.4 — the opportunity feed's Server Actions. Every
// action validates with Zod BEFORE any work (L-13), re-derives the
// capability gate server-side (the DB legality trigger is the real
// boundary — enforce_insight_card_legal_transition, §5.3 — this is UX
// only, mirroring ApprovalsInbox's precedent), and transitions state via
// the ALREADY-BUILT lib/db/insight-cards.ts#transitionCardStatus, which is
// itself the atomic conditional UPDATE. The two-admins race (§5.3) surfaces
// as the typed `already_triaged` outcome, never a generic error.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getMemberForUser } from '@/lib/db/business-members'
import { hasCapability, resolveMemberContext, CAPABILITIES } from '@/lib/members/capabilities'
import { transitionCardStatus } from '@/lib/db/insight-cards'
import { seedCampaignFromCard } from '@/lib/signals/seed'
import type { InsightCardDismissReason, InsightCardStatus } from '@/lib/db/types'

export type CardActionErrorCode = 'invalid_input' | 'generic' | 'forbidden'

export type CardActionState = {
  success?: boolean
  error?: CardActionErrorCode
  // §5.3's two-admins problem: the client re-renders THIS card's real state
  // — never a generic error toast — on both the 'ok' and 'already_triaged'
  // arms.
  outcome?: 'ok' | 'already_triaged'
  currentStatus?: InsightCardStatus
}

const DISMISS_REASONS = [
  'not_relevant',
  'already_covered',
  'too_sensitive',
  'wrong_timing',
  'weak_evidence',
] as const satisfies readonly InsightCardDismissReason[]

const cardIdSchema = z.object({ cardId: z.string().uuid() })
const dismissSchema = z.object({
  cardId: z.string().uuid(),
  reason: z.enum(DISMISS_REASONS).optional(),
})

async function getAuthorContext() {
  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return null
  const business = await getBusinessForUser(client, user.id)
  if (!business) return null

  const memberRow =
    business.owner_id === user.id ? null : await getMemberForUser(client, business.id, user.id)
  const member = resolveMemberContext(business, user.id, memberRow)

  // §5.8 — CAPABILITIES.AUTHOR || isAdmin, echoing the approvals precedent's
  // shape (not a plain APPROVE echo — this surface originates campaigns,
  // it approves nothing for publication).
  const canTriage = hasCapability(member, CAPABILITIES.AUTHOR) || member.isAdmin
  if (!canTriage) return { client, business, forbidden: true as const }

  return { client, business, forbidden: false as const }
}

function revalidateOpportunities(): void {
  revalidatePath('/[locale]/opportunities', 'page')
}

// §5.3's state machine: pending -> approved | dismissed | saved;
// saved -> approved | dismissed. Every transition attempts its PRIMARY
// expected prior state first (pending, the common case); if that misses
// because the card was already 'saved', a second atomic attempt against
// 'saved' is tried before conceding already_triaged — both are legal edges
// into the SAME target status, not a retry-until-success loop.
async function attemptTransition(
  client: Awaited<ReturnType<typeof createClient>>,
  businessId: string,
  cardId: string,
  updates: { status: InsightCardStatus; dismiss_reason?: InsightCardDismissReason | null; expires_at?: null },
  primaryExpected: InsightCardStatus,
  fallbackExpected?: InsightCardStatus,
): Promise<CardActionState> {
  const first = await transitionCardStatus(client, businessId, cardId, primaryExpected, updates)
  if (first.outcome === 'ok') {
    return { success: true, outcome: 'ok', currentStatus: first.currentStatus }
  }
  if (fallbackExpected && first.currentStatus === fallbackExpected) {
    const second = await transitionCardStatus(client, businessId, cardId, fallbackExpected, updates)
    if (second.outcome === 'ok') {
      return { success: true, outcome: 'ok', currentStatus: second.currentStatus }
    }
    return { outcome: 'already_triaged', currentStatus: second.currentStatus }
  }
  return { outcome: 'already_triaged', currentStatus: first.currentStatus }
}

export async function approveCardAction(cardId: string): Promise<CardActionState> {
  const parsed = cardIdSchema.safeParse({ cardId })
  if (!parsed.success) return { error: 'invalid_input' }

  try {
    const ctx = await getAuthorContext()
    if (!ctx) return { error: 'generic' }
    if (ctx.forbidden) return { error: 'forbidden' }

    const result = await attemptTransition(
      ctx.client,
      ctx.business.id,
      cardId,
      { status: 'approved' },
      'pending',
      'saved',
    )
    if (result.success) {
      // Session 28-D, D7 (MINOR-7) — the SAME path that flipped status to
      // 'approved', now also seeding the campaign + brief and writing
      // campaign_id back (lib/signals/seed.ts). attemptTransition's atomic
      // conditional UPDATE above already guarantees at most one concurrent
      // approveCardAction call reaches `result.success === true` for a
      // given card (§5.3's two-admins race is closed there), so this call
      // fires at most once per real approval — no separate concurrency
      // guard is needed here. Own try/catch: a seeding failure (e.g. the
      // AI call, or no connected social accounts) must not turn an
      // already-successful approval into a false error toast — the card
      // stays 'approved' and the feed shows the existing inert fallback
      // (campaign_id null) rather than the failure being silently hidden
      // as a rethrow into the outer catch.
      try {
        await seedCampaignFromCard(cardId)
      } catch (seedErr: unknown) {
        console.error('opportunities/actions: seedCampaignFromCard failed after approval', cardId, seedErr)
      }
      revalidateOpportunities()
    }
    return result
  } catch {
    return { error: 'generic' }
  }
}

export async function dismissCardAction(
  cardId: string,
  reason?: InsightCardDismissReason,
): Promise<CardActionState> {
  const parsed = dismissSchema.safeParse({ cardId, reason })
  if (!parsed.success) return { error: 'invalid_input' }

  try {
    const ctx = await getAuthorContext()
    if (!ctx) return { error: 'generic' }
    if (ctx.forbidden) return { error: 'forbidden' }

    const result = await attemptTransition(
      ctx.client,
      ctx.business.id,
      cardId,
      { status: 'dismissed', dismiss_reason: reason ?? null },
      'pending',
      'saved',
    )
    if (result.success) revalidateOpportunities()
    return result
  } catch {
    return { error: 'generic' }
  }
}

export async function saveCardAction(cardId: string): Promise<CardActionState> {
  const parsed = cardIdSchema.safeParse({ cardId })
  if (!parsed.success) return { error: 'invalid_input' }

  try {
    const ctx = await getAuthorContext()
    if (!ctx) return { error: 'generic' }
    if (ctx.forbidden) return { error: 'forbidden' }

    // §5.5 — saved sets expires_at = NULL, and that is the only thing
    // saved does. Only reachable from 'pending' (§5.3's machine has no
    // saved -> saved edge, so no fallback expected state here).
    const result = await attemptTransition(
      ctx.client,
      ctx.business.id,
      cardId,
      { status: 'saved', expires_at: null },
      'pending',
    )
    if (result.success) revalidateOpportunities()
    return result
  } catch {
    return { error: 'generic' }
  }
}
