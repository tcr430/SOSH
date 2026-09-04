import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getActiveById, listActiveByBusinessAndPlatform, deactivateSocialAccount } from '@/lib/db/social-accounts'
import { isPlatform } from '@/lib/social'
import { CAPABILITIES } from '@/lib/members/capabilities'

export async function DELETE(
  request: NextRequest,
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

    // Authoritative gate (ADR 0014 §7): the write below runs service-role and
    // bypasses RLS, so this app-layer user_can check is the real boundary.
    const { data: canConnect, error: capError } = await supabase.rpc('user_can', {
      p_business_id: business.id,
      p_capability: CAPABILITIES.CONNECT_ACCOUNTS,
    })
    if (capError || !canConnect) {
      return new NextResponse(null, { status: 403 })
    }

    // ADR 0028 §5.3: disconnects ONE NAMED identity. accountId names it
    // explicitly (the accounts UI, N2.12, will always pass one once two
    // active identities can exist for a platform). Without it, this falls
    // back to the pre-dual-identity single-account shape — but when more
    // than one active account exists, guessing which one to deactivate is
    // exactly the "act on the wrong identity" failure this ADR forbids, so
    // it is refused rather than resolved arbitrarily.
    const accountIdParam = request.nextUrl.searchParams.get('accountId')

    let account
    if (accountIdParam) {
      const candidate = await getActiveById(supabase, accountIdParam)
      account = candidate && candidate.business_id === business.id && candidate.platform === platform
        ? candidate
        : null
    } else {
      const candidates = await listActiveByBusinessAndPlatform(supabase, business.id, platform)
      if (candidates.length > 1) {
        return NextResponse.json({ error: 'account_ambiguous' }, { status: 409 })
      }
      account = candidates[0] ?? null
    }
    if (!account) {
      return new NextResponse(null, { status: 404 })
    }

    await deactivateSocialAccount(account.id)

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'disconnect_failed' }, { status: 500 })
  }
}
