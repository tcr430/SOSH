import { toUtcIso } from '@/lib/utils'
import { getErrorMessage } from '@/lib/db/utils'

export async function getCostThisMonth(businessId: string): Promise<{ cents: number }> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()

  const startOfMonth = new Date()
  startOfMonth.setUTCDate(1)
  startOfMonth.setUTCHours(0, 0, 0, 0)

  const { data, error } = await client
    .from('ai_usage')
    .select('cost_cents')
    .eq('business_id', businessId)
    .gte('created_at', toUtcIso(startOfMonth))

  if (error) throw new Error(getErrorMessage(error))

  const cents = (data ?? []).reduce(
    (sum: number, row: { cost_cents: number }) => sum + (row.cost_cents ?? 0),
    0,
  )

  return { cents }
}

export async function getCallVolumeLast24h(businessId: string): Promise<{ count: number }> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()

  const since = toUtcIso(new Date(Date.now() - 24 * 60 * 60 * 1000))

  const { count, error } = await client
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .gte('created_at', since)

  if (error) throw new Error(getErrorMessage(error))

  return { count: count ?? 0 }
}
