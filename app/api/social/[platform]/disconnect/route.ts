import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getActiveByBusinessAndPlatform, deactivateSocialAccount } from '@/lib/db/social-accounts'
import { isPlatform } from '@/lib/social'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
): Promise<NextResponse> {
  const { platform: platformParam } = await params

  if (!isPlatform(platformParam)) {
    return new NextResponse(null, { status: 404 })
  }
  const platform = platformParam

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

    const account = await getActiveByBusinessAndPlatform(supabase, business.id, platform)
    if (!account) {
      return new NextResponse(null, { status: 404 })
    }

    await deactivateSocialAccount(account.id)

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'disconnect_failed' }, { status: 500 })
  }
}
