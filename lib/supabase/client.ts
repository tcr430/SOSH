"use client";

import { createBrowserClient } from "@supabase/ssr";
import { config } from "@/lib/config";

// Singleton — one browser client for the lifetime of the tab.
let client: ReturnType<typeof createBrowserClient> | undefined;

export function createClient() {
  if (!client) {
    client = createBrowserClient(
      config.public.SUPABASE_URL,
      config.public.SUPABASE_ANON_KEY
    );
  }
  return client;
}
