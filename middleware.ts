import createIntlMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { updateSession } from "@/lib/supabase/middleware";

const handleI18n = createIntlMiddleware(routing);

// Path segments (immediately after the locale prefix) that are publicly
// accessible without authentication. Everything else is treated as a
// /(dashboard)/ route and requires a valid session.
const PUBLIC_SEGMENTS = new Set([
  '',               // /[locale]  (locale root)
  'home',           // /(marketing)/home
  'login',          // /(auth)/login
  'signup',         // /(auth)/signup
  'reset-password', // /(auth)/reset-password
  'verify-email',   // /(auth)/verify-email
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
      return NextResponse.redirect(new URL(`/${locale}/login`, request.url))
    }
  }

  // 3. Run locale routing on the (now cookie-updated) request.
  const i18nResponse = handleI18n(request);

  // 4. Carry Supabase auth cookies over so the browser stores the refreshed
  //    session even when the i18n middleware issues a locale redirect.
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    i18nResponse.cookies.set(cookie);
  });

  return i18nResponse;
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
