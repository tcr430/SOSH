'use client'

import { createContext, useContext } from 'react'
import type { User } from '@supabase/supabase-js'
import type { BusinessRow, BrandVoiceRow } from '@/lib/db/types'
import type { MemberCapabilityContext } from '@/lib/members/capabilities'

type BusinessContextValue = {
  user: User
  activeBusiness: BusinessRow
  brandVoice: BrandVoiceRow | null
  // ADR 0014 §6 — the current user's (role, is_admin) in activeBusiness,
  // resolved once by the dashboard layout (owner override or member row).
  // useCan() reads this; it is a UX echo, never the security boundary.
  member: MemberCapabilityContext
}

const BusinessContext = createContext<BusinessContextValue | null>(null)

export function BusinessProvider({
  user,
  activeBusiness,
  brandVoice,
  member,
  children,
}: BusinessContextValue & { children: React.ReactNode }) {
  return (
    <BusinessContext.Provider value={{ user, activeBusiness, brandVoice, member }}>
      {children}
    </BusinessContext.Provider>
  )
}

export function useActiveBusiness(): BusinessContextValue {
  const ctx = useContext(BusinessContext)
  if (!ctx) throw new Error('useActiveBusiness must be used inside BusinessProvider')
  return ctx
}
