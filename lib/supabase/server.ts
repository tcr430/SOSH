import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { config } from "@/lib/config";

// Call this inside every Server Component / Server Action / Route Handler.
// A new client is created per call so cookies are always from the current request.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    config.public.SUPABASE_URL,
    config.public.SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );
}
