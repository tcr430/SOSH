'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser, updateBusiness } from '@/lib/db/businesses'

// ADR 0031 §5.4, ruling O-3, constraint #42 REPORT-EMAIL-SETTING-ADMIN-ONLY (narrowed to OWNER: the businesses UPDATE
// policy is owner-only and no service-role use is added). The ONLY input is the setting. The business is the SERVER-SIDE
// active business, never a form field, so there is no id for a caller to forge; the owner is re-checked here (the policy
// is the boundary, this saves the round trip and gives a typed message); the UPDATE is keyed on that business id and runs
// on the AUTHENTICATED client. 'off' stops only the email: nothing here touches generation or the stored reports.

export interface ReportEmailActionState {
  success?: boolean
  /** A short code the form maps to its own copy: nothing in this state is user-facing text. */
  error?: 'error' | 'forbidden'
}

const settingSchema = z.object({ setting: z.enum(['admins', 'all_members', 'off']) })

export async function setReportEmailAction(_prev: ReportEmailActionState, formData: FormData): Promise<ReportEmailActionState> {
  const parsed = settingSchema.safeParse({ setting: formData.get('setting') })
  if (!parsed.success) return { error: 'error' }

  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return { error: 'error' }
  const business = await getBusinessForUser(client, user.id)
  if (!business) return { error: 'error' }
  if (business.owner_id !== user.id) return { error: 'forbidden' }

  try {
    await updateBusiness(client, business.id, { report_email: parsed.data.setting })
  } catch {
    return { error: 'error' }
  }
  revalidatePath('/[locale]/analytics/reports', 'page')
  return { success: true }
}
