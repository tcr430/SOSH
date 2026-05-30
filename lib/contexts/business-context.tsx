'use client'

import { createContext, useContext } from 'react'
import type { User } from '@supabase/supabase-js'
import type { BusinessRow, BrandVoiceRow } from '@/lib/db/types'

type BusinessContextValue = {
  user: User
  activeBusiness: BusinessRow
  brandVoice: BrandVoiceRow | null
}

const BusinessContext = createContext<BusinessContextValue | null>(null)

export function BusinessProvider({
  user,
  activeBusiness,
  brandVoice,
  children,
}: BusinessContextValue & { children: React.ReactNode }) {
  return (
    <BusinessContext.Provider value={{ user, activeBusiness, brandVoice }}>
      {children}
    </BusinessContext.Provider>
  )
}

export function useActiveBusiness(): BusinessContextValue {
  const ctx = useContext(BusinessContext)
  if (!ctx) throw new Error('useActiveBusiness must be used inside BusinessProvider')
  return ctx
}
