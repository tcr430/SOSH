// ADR 0021 §6 (Session 28 E5.10) — Stage F: the seeding contract ONLY.
// seedCampaignFromCard composes an approved card into a NEW campaigns row
// (origin = 'signal_generated', §6.2 — no migration, the value already
// ships) and then calls the EXISTING assembleBrief(campaignId) UNCHANGED
// (§6.1). D-7's named loser is a signal-specific generation path — this
// file introduces NO generation prompt and NO second brief-assembly path.
// critiqueBrief and approveBriefIfQualified's HARD gate are untouched and
// still run on the resulting brief exactly as they do for every other
// campaign (§6.3) — the human still reviews it.

import { getCardById, setCardCampaignId } from '@/lib/db/insight-cards'
import { createCampaign } from '@/lib/db/campaigns'
import { listActiveSocialAccounts } from '@/lib/db/social-accounts'
import { assembleBrief } from '@/lib/campaigns/brief'
import { toUtcIso } from '@/lib/utils'
import type { InsightCardRow, Platform } from '@/lib/db/types'

// §6.1 composes the card into `objective` — costing ZERO change to ADR
// 0017's BriefAssemblyInput (`objective: string`). The named loser is
// extending BriefAssemblyInput with a seed variant; that is Mode 2
// generation-behaviour change, forbidden by L-1.
export function composeObjective(card: Pick<InsightCardRow, 'observation' | 'why_it_matters' | 'audience' | 'suggested_objective'>): string {
  const parts = [card.observation, card.why_it_matters, card.audience]
  if (card.suggested_objective) parts.push(card.suggested_objective)
  return parts.join('\n\n')
}

// §6.1 names only the objective composition. name/platforms/frequency/
// posts_per_week/start_date aren't specified there but are NOT NULL on
// CampaignInsert with no DB default — a decision made explicitly here
// (Session 28 E5.10, resolved with the user), not silently assumed:
// name is a truncated observation; platforms are the business's currently
// CONNECTED accounts (a signal-seeded campaign that names an unconnected
// platform can't be approved-to-publish downstream); frequency/cadence
// default to a conservative weekly/3-per-week baseline a human can change
// before or during brief review — nothing here auto-publishes (L-2).
const SEED_NAME_MAX_CHARS = 80
const SEED_FREQUENCY = 'weekly' as const
const SEED_POSTS_PER_WEEK = 3

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

async function serviceClient() {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  return createServiceRoleClient()
}

export type SeedCampaignResult = { campaignId: string; briefId: string }

// database-reviewer (Session 28-D, D7 follow-up, NIT-1): this function is
// NOT idempotent at the createCampaign step — only the final write-back is
// guarded (setCardCampaignId's `.is('campaign_id', null)`). Today that's
// unreachable: approveCardAction's atomic conditional transition guarantees
// at most one caller ever reaches this function per real approval, and no
// retry job exists. If a reconciliation job is ever added to recover a
// card stuck 'approved' with campaign_id IS NULL (e.g. after a crash
// between createCampaign and the write-back), it MUST check
// `campaign_id IS NULL` on the card BEFORE calling this function again —
// otherwise every retry creates a second, never-linked campaign + brief.
export async function seedCampaignFromCard(cardId: string): Promise<SeedCampaignResult> {
  const card = await getCardById(cardId)
  if (!card) throw new Error(`seedCampaignFromCard: no card found at id ${cardId}`)

  const client = await serviceClient()
  const connectedAccounts = await listActiveSocialAccounts(client, card.business_id)
  const platforms = Array.from(new Set(connectedAccounts.map(a => a.platform))) as Platform[]

  const campaign = await createCampaign(client, {
    business_id: card.business_id,
    name: truncate(card.observation, SEED_NAME_MAX_CHARS),
    objective: composeObjective(card),
    platforms,
    frequency: SEED_FREQUENCY,
    posts_per_week: SEED_POSTS_PER_WEEK,
    // CLAUDE.md date rule — never raw .toISOString(); toUtcIso() is the
    // one sanctioned call (lib/utils.ts:8-11).
    start_date: toUtcIso(new Date()).slice(0, 10),
    origin: 'signal_generated',
  })

  // D-7 — the EXISTING pipeline, unchanged. No new generation code, no
  // second brief-assembly path.
  const brief = await assembleBrief(campaign.id)

  // Session 28-D, D7 (MINOR-7) — the write-back that makes §9.2's "approved
  // and in flight" state legible: link the card to the campaign it just
  // seeded, only once there is a brief for that link to point at.
  // setCardCampaignId's `.is('campaign_id', null)` guard (lib/db/
  // insight-cards.ts) is the atomic-conditional property, not a
  // read-then-update — see that function's own comment.
  await setCardCampaignId(cardId, campaign.id)

  return { campaignId: campaign.id, briefId: brief.id }
}
