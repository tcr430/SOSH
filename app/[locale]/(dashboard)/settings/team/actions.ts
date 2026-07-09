'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import {
  createInvite,
  changeMemberRole,
  revokeMember,
  reissueInvite,
} from '@/lib/db/business-members'
import { checkInviteAllowed } from '@/lib/members/enforcement'
import { signInviteToken } from '@/lib/members/invite-token'
import { enqueueTeamInvite } from '@/lib/email/triggers/invite'
import { workEmailSchema } from '@/lib/validation/email'
import type { MemberRole } from '@/lib/db/types'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { BusinessRow } from '@/lib/db/types'

export interface ActionState {
  success?: boolean
  error?: string
}

const roleSchema = z.enum(['approver', 'editor', 'viewer'])

const inviteSchema = z.object({
  email: workEmailSchema,
  role: roleSchema,
  isAdmin: z.boolean().default(false),
})

const changeRoleSchema = z.object({
  memberId: z.string().min(1, 'errors.invalid_member'),
  role: roleSchema,
  isAdmin: z.boolean().default(false),
})

async function requireBusiness(
  client: SupabaseClient,
): Promise<{ user: User; business: BusinessRow }> {
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const business = await getBusinessForUser(client, user.id)
  if (!business) throw new Error('No business')
  return { user, business }
}

function inviterNameFrom(user: User): string {
  return (user.user_metadata?.full_name as string | undefined) ?? ''
}

async function sendInviteEmail(input: {
  memberId: string
  businessId: string
  recipientEmail: string
  role: MemberRole
  inviterName: string
  businessName: string
  locale: BusinessRow['language']
}): Promise<void> {
  // The signed token exists only to build the accept URL inside enqueueTeamInvite
  // (lib/email/triggers/invite.ts) — never returned to the caller, never logged.
  void (await signInviteToken({ memberId: input.memberId, businessId: input.businessId }))
  await enqueueTeamInvite({
    memberId: input.memberId,
    businessId: input.businessId,
    recipientEmail: input.recipientEmail,
    locale: input.locale,
    inviterName: input.inviterName,
    businessName: input.businessName,
    roleLabelKey: `team_invite.role.${input.role}`,
  })
}

// §5.3 — Zod-validate; work-email rule reused from signup validation.
// Fail-fast echo: checkInviteAllowed(...) BEFORE insert (over-cap → typed
// reason, no insert). The DB enforce_seat_cap trigger (0013 §6.6) is the
// real boundary — this only saves a round-trip and gives typed UX (§5.4).
export async function inviteMemberAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = inviteSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role'),
    isAdmin: formData.get('isAdmin') === 'true' || formData.get('isAdmin') === 'on',
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'errors.invite_invalid' }
  }

  const client = await createClient()
  const { user, business } = await requireBusiness(client)

  const { allowed, reason } = await checkInviteAllowed(client, business)
  if (!allowed) {
    return {
      error:
        reason === 'overage_locked'
          ? 'errors.overage_locked'
          : 'errors.seat_cap_reached',
    }
  }

  let member
  try {
    member = await createInvite(client, {
      businessId: business.id,
      email: parsed.data.email,
      role: parsed.data.role,
      isAdmin: parsed.data.isAdmin,
      invitedBy: user.id,
    })
  } catch {
    return { error: 'errors.invite_failed' }
  }

  await sendInviteEmail({
    memberId: member.id,
    businessId: business.id,
    recipientEmail: member.email,
    role: member.role,
    inviterName: inviterNameFrom(user),
    businessName: business.name,
    locale: business.language,
  })

  revalidatePath('/[locale]/(dashboard)/settings/team', 'page')
  return { success: true }
}

// UPDATE via business_members_update (user_can('manage_members')); the
// primary-admin protection trigger blocks demoting the owner's own row.
export async function changeMemberRoleAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = changeRoleSchema.safeParse({
    memberId: formData.get('memberId'),
    role: formData.get('role'),
    isAdmin: formData.get('isAdmin') === 'true' || formData.get('isAdmin') === 'on',
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'errors.invalid_role' }
  }

  const client = await createClient()
  try {
    await changeMemberRole(client, parsed.data.memberId, parsed.data.role, parsed.data.isAdmin)
  } catch {
    return { error: 'errors.role_change_failed' }
  }

  revalidatePath('/[locale]/(dashboard)/settings/team', 'page')
  return { success: true }
}

// Soft removal only — status='revoked' (UI-REMOVE-SOFT). Never a DELETE:
// fights 0013's no-DELETE RLS and loses the audit row.
export async function revokeMemberAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const memberId = String(formData.get('memberId') ?? '')
  if (!memberId) return { error: 'errors.invalid_member' }

  const client = await createClient()
  try {
    await revokeMember(client, memberId)
  } catch {
    return { error: 'errors.revoke_failed' }
  }

  revalidatePath('/[locale]/(dashboard)/settings/team', 'page')
  return { success: true }
}

// §4.4 — re-issues a fresh token on the SAME reserved row (reissueInvite
// refreshes invited_at so the RPC's own DB-side expiry guard doesn't still
// reject the freshly-issued token) and re-enqueues team-invite. No new row.
export async function resendInviteAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const memberId = String(formData.get('memberId') ?? '')
  if (!memberId) return { error: 'errors.invalid_member' }

  const client = await createClient()
  const { user, business } = await requireBusiness(client)

  let member
  try {
    member = await reissueInvite(client, memberId)
  } catch {
    return { error: 'errors.resend_failed' }
  }

  await sendInviteEmail({
    memberId: member.id,
    businessId: member.business_id,
    recipientEmail: member.email,
    role: member.role,
    inviterName: inviterNameFrom(user),
    businessName: business.name,
    locale: business.language,
  })

  revalidatePath('/[locale]/(dashboard)/settings/team', 'page')
  return { success: true }
}
