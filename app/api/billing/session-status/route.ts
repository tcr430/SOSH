import { createClient } from '@/lib/supabase/server'
import { getBusinessByOwner } from '@/lib/db/businesses'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) {
    return Response.json({ error: 'auth' }, { status: 401 })
  }

  const business = await getBusinessByOwner(client, user.id)
  if (!business) {
    return Response.json({ error: 'no_business' }, { status: 404 })
  }

  return Response.json({
    plan: business.plan,
    planUpdated: business.plan !== 'trial',
  })
}
