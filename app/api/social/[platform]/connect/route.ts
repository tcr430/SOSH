import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { signOAuthState, getRegistry, getPlatformConfig, isPlatform } from '@/lib/social'
import { CAPABILITIES } from '@/lib/members/capabilities'
import type { Language } from '@/lib/db/types'

const VALID_LOCALES = new Set<string>(['en', 'pt', 'es'])

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
): Promise<NextResponse> {
  const { platform: platformParam } = await params
  const localeParam = request.nextUrl.searchParams.get('locale') ?? 'en'
  const locale: Language = VALID_LOCALES.has(localeParam) ? (localeParam as Language) : 'en'

  if (!isPlatform(platformParam)) {
    return new NextResponse(null, { status: 404 })
  }
  const platform = platformParam

  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.redirect(new URL(`/${locale}/login`, request.url))
    }

    const business = await getBusinessForUser(supabase, user.id)
    if (!business) {
      return NextResponse.redirect(new URL(`/${locale}/onboarding`, request.url))
    }

    // Authoritative gate (ADR 0014 §7): the write in .../callback/route.ts
    // runs service-role and bypasses RLS, so this app-layer user_can check
    // is the real boundary.
    const { data: canConnect, error: capError } = await supabase.rpc('user_can', {
      p_business_id: business.id,
      p_capability: CAPABILITIES.CONNECT_ACCOUNTS,
    })
    if (capError || !canConnect) {
      return NextResponse.redirect(
        new URL(`/${locale}/settings/accounts?error=forbidden`, request.url),
      )
    }

    const state = await signOAuthState({ businessId: business.id, platform, locale })
    const redirectUri = `${request.nextUrl.origin}/api/social/${platform}/callback`
    const platformConfig = getPlatformConfig(platform)

    const authorizeUrl = await getRegistry()
      .get(platform)
      .getOAuthAuthorizeUrl({
        platform,
        businessId: business.id,
        redirectUri,
        scopes: platformConfig.scopes,
        state,
      })

    return NextResponse.redirect(new URL(authorizeUrl))
  } catch {
    return NextResponse.redirect(
      new URL(`/${locale}/settings/accounts?error=connect_failed`, request.url),
    )
  }
}
