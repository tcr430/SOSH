import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { listByBusiness } from '@/lib/db/social-accounts'

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new NextResponse(null, { status: 401 })
    }

    const business = await getBusinessForUser(supabase, user.id)
    if (!business) {
      return new NextResponse(null, { status: 404 })
    }

    const accounts = await listByBusiness(supabase, business.id)
    return NextResponse.json(accounts)
  } catch {
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 })
  }
}
