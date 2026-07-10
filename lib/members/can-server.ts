// ADR 0014 §6 — server-side echo of hasCapability for Server Components /
// Server Actions that don't run inside the React tree (so can't read
// BusinessProvider's resolved member context). UX only — never the security
// boundary (L-3); the DB (RLS + triggers) is already authoritative.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BusinessRow } from '@/lib/db/types'
import { getMemberForUser } from '@/lib/db/business-members'
import { hasCapability, resolveMemberContext } from './capabilities'
import type { Capability } from './capabilities'

export async function canServer(
  client: SupabaseClient,
  business: BusinessRow,
  userId: string,
  capability: Capability,
): Promise<boolean> {
  if (business.owner_id === userId) {
    return hasCapability(resolveMemberContext(business, userId, null), capability)
  }
  const member = await getMemberForUser(client, business.id, userId)
  return hasCapability(resolveMemberContext(business, userId, member), capability)
}
