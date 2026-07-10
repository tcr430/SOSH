'use client'

// ADR 0014 §6 — client-side echo of hasCapability, reading the member
// context the dashboard layout already resolved (B1/B2). UX only — never
// the security boundary (L-3); the DB (RLS + triggers) is already
// authoritative.

import { useActiveBusiness } from '@/lib/contexts/business-context'
import { hasCapability } from './capabilities'
import type { Capability } from './capabilities'

export function useCan(capability: Capability): boolean {
  const { member } = useActiveBusiness()
  return hasCapability(member, capability)
}
