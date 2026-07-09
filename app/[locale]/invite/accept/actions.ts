'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { verifyInviteToken } from '@/lib/members/invite-token'
import { acceptInvite } from '@/lib/db/business-members'

export interface AcceptInviteState {
  status: 'pending' | 'already-member' | 'invalid'
}

// The §4.2 state machine, minus the two branches handled by redirect() itself
// (unauthenticated → /signup; accepted → /campaigns) since a thrown
// NEXT_REDIRECT must never be caught by this function's own error handling.
export async function processInviteAccept(
  _prevState: AcceptInviteState,
  formData: FormData,
): Promise<AcceptInviteState> {
  const token = String(formData.get('token') ?? '')
  const code = formData.get('code')
  const locale = String(formData.get('locale') ?? 'en')

  let claims: { memberId: string; businessId: string }
  try {
    claims = await verifyInviteToken(token)
  } catch {
    return { status: 'invalid' }
  }

  const client = await createClient()

  if (typeof code === 'string' && code.length > 0) {
    await client.auth.exchangeCodeForSession(code).catch(() => undefined)
  }

  const {
    data: { user },
  } = await client.auth.getUser()

  if (!user) {
    redirect(`/${locale}/signup?token=${encodeURIComponent(token)}`)
  }

  let result
  try {
    result = await acceptInvite(client, claims.memberId, claims.businessId)
  } catch {
    return { status: 'invalid' }
  }

  if (result.outcome === 'already_member') {
    return { status: 'already-member' }
  }

  redirect(`/${locale}/campaigns`)
}
