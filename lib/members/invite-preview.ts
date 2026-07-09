import { verifyInviteToken } from './invite-token'
import { getMemberById } from '@/lib/db/business-members'
import { getBusinessById } from '@/lib/db/businesses'
import type { MemberRole } from '@/lib/db/types'

export interface InvitePreview {
  memberId: string
  businessId: string
  businessName: string
  inviterName: string
  email: string
  role: MemberRole
}

// Server-side preview for the invite/accept arrival card and the signup
// email-lock (ADR 0014 §4.5). Any failure — bad/expired token signature,
// missing row, missing business — collapses to null so callers render the
// single generic [INVALID] state (§4.3 anti-enum): no distinction is
// surfaced between these failure classes.
export async function getInvitePreview(token: string): Promise<InvitePreview | null> {
  let claims: { memberId: string; businessId: string }
  try {
    claims = await verifyInviteToken(token)
  } catch {
    return null
  }

  try {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    const serviceClient = createServiceRoleClient()

    const member = await getMemberById(serviceClient, claims.memberId)
    if (member.business_id !== claims.businessId) return null

    const business = await getBusinessById(serviceClient, claims.businessId)

    let inviterName = ''
    if (member.invited_by) {
      const { data } = await serviceClient.auth.admin.getUserById(member.invited_by)
      inviterName = (data.user?.user_metadata?.full_name as string | undefined) ?? ''
    }

    return {
      memberId: claims.memberId,
      businessId: claims.businessId,
      businessName: business.name,
      inviterName,
      email: member.email,
      role: member.role,
    }
  } catch {
    return null
  }
}
