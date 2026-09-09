/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL (public). */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable (anon) key — public by design, RLS-protected.
   * The service-role/secret key must NEVER be set in a VITE_ variable. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
