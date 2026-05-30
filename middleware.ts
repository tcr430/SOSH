import createIntlMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { updateSession } from "@/lib/supabase/middleware";

const handleI18n = createIntlMiddleware(routing);

// Path segments (immediately after the locale prefix) that are publicly
// accessible without authentication. Everything else is treated as a
// /(dashboard)/ route and requires a valid session.
const PUBLIC_SEGMENTS = new Set([
  '',                 // /[locale]  (locale root)
  'home',             // /(marketing)/home
  'login',            // /(auth)/login
  'signup',           // /(auth)/signup
  'forgot-password',  // /(auth)/forgot-password
  'reset-password',   // /(auth)/reset-password
  'verify-email',     // /(auth)/verify-email
])

export async function middleware(request: NextRequest) {
  // 1. Refresh the Supabase session and get the current user in one call.
  const { response: supabaseResponse, user } = await updateSession(request);

  // 2. Protect dashboard routes: redirect unauthenticated users to /[locale]/login.
  const { pathname } = request.nextUrl
  const localeMatch = pathname.match(/^\/([a-z]{2})(\/.*)?$/)
  if (localeMatch) {
    const locale = localeMatch[1]
    const afterLocale = localeMatch[2] ?? '/'
    const firstSegment = afterLocale.split('/')[1] ?? ''

    if (!PUBLIC_SEGMENTS.has(firstSegment) && !user) {
      const loginUrl = new URL(`/${locale}/login`, request.url)
      loginUrl.searchParams.set('redirect', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  // 3. Forward pathname as a request header so Server Components can read it
  //    via headers().get('x-pathname'). Required for onboarding redirect guard.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', pathname)

  // 4. Run locale routing. If i18n issues a redirect (locale normalisation),
  //    attach Supabase cookies and return it directly.
  const i18nResponse = handleI18n(request)
  if (i18nResponse.headers.get('location')) {
    supabaseResponse.cookies.getAll().forEach((c) => i18nResponse.cookies.set(c))
    return i18nResponse
  }

  // 5. For normal renders, return NextResponse.next() with modified request
  //    headers so Server Components receive x-pathname.
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  supabaseResponse.cookies.getAll().forEach((c) => response.cookies.set(c))
  i18nResponse.cookies.getAll().forEach((c) => response.cookies.set(c))
  return response
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static  (static files)
     * - _next/image   (image optimisation)
     * - favicon.ico, sitemap.xml, robots.txt
     * - Any file with an extension in /public (svg, png, jpg, …)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
