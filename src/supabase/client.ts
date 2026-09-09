import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Centralized Supabase client (single instance for the whole app).
 *
 * Configuration comes exclusively from Vite environment variables:
 *   - VITE_SUPABASE_URL             the project URL
 *   - VITE_SUPABASE_PUBLISHABLE_KEY the public anon/publishable key
 *
 * Only the PUBLISHABLE (anon) key may ever appear here — it is a public
 * value designed for browsers and is protected by Row Level Security.
 * The service-role/secret key must NEVER be referenced in frontend code.
 */

export interface SupabaseEnv {
  url: string;
  publishableKey: string;
}

/** Reads the env vars (injectable for tests). Returns null when unconfigured
 * so the app still boots in pure guest mode without crashing. */
function readEnv(read: (name: string) => string | undefined): SupabaseEnv | null {
  const url = read("VITE_SUPABASE_URL");
  const publishableKey = read("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

function viteEnvReader(name: string): string | undefined {
  return import.meta.env[name] as string | undefined;
}

let override: SupabaseClient | null = null;

/**
 * Returns the shared Supabase client, or null when the env vars are absent
 * (the app degrades to guest-only mode). Callers must handle null.
 */
export function getSupabase(): SupabaseClient | null {
  if (override) return override;
  const env = readEnv(viteEnvReader);
  if (!env) return null;
  override = createClient(env.url, env.publishableKey, {
    auth: {
      // Sessions persist in localStorage under an sb- prefixed key and are
      // restored automatically on the next launch.
      persistSession: true,
      autoRefreshToken: true,
      // The app is a static PWA — detectSessionInUrl covers OAuth/magic-link
      // style callbacks; email+password flows are unaffected.
      detectSessionInUrl: true,
    },
  });
  return override;
}

/** Test hook: inject a mock client (or null to reset to env-based). */
export function setSupabaseOverride(client: SupabaseClient | null): void {
  override = client;
}
