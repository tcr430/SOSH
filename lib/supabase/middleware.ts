import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";

// Called from middleware.ts on every matched request to keep the session
// cookie fresh. Returns the (possibly updated) response.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    config.public.SUPABASE_URL,
    config.public.SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          // Write cookies onto the request so downstream server code sees them.
          // NextRequest.cookies.set only accepts (name, value) — options aren't
          // needed here since this is just propagating tokens to the request object.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          // Re-create the response with the updated request cookies.
          response = NextResponse.next({ request });
          // Write cookies onto the response so the browser stores them.
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
          // Apply cache-control headers mandated by the library when auth
          // cookies are set (prevents CDN from caching session tokens).
          Object.entries(headers).forEach(([key, value]) =>
            response.headers.set(key, value)
          );
        },
      },
    }
  );

  // Calling getUser() is what actually refreshes the session token when needed.
  // Don't remove this — without it the session silently expires.
  const { data: { user } } = await supabase.auth.getUser();

  return { response, user };
}
