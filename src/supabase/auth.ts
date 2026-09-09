import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./client";

/**
 * Authentication state — the single source of truth for "who is signed in".
 *
 * The controller is initialized exactly once at app boot (before any view
 * renders or data loads), subscribes to Supabase's auth state changes, and
 * notifies subscribers on every transition so UI + data layer react
 * immediately after login/logout.
 */

export interface AccountUser {
  id: string;
  email: string;
}

type AuthListener = (user: AccountUser | null) => void;

export type InitReason = "configured" | "not-configured" | "no-client";

/** Result of initialize(): why the session is in its current state. */
export interface AuthInitResult {
  /** "no-client" — env vars missing (guest-only mode). "not-configured"
   * means the same thing functionally but is used when the client exists. */
  reason: InitReason;
  /** True when a restored session was applied at boot. */
  restored: boolean;
}

class AuthController {
  private user: AccountUser | null = null;
  private initialized = false;
  private client: SupabaseClient | null = null;
  private readonly listeners = new Set<AuthListener>();
  private unsubscribe: (() => void) | null = null;

  /** Whether auth state has been read from Supabase at least once. Views
   * and the data layer must wait for this before touching user data. */
  isInitialized(): boolean {
    return this.initialized;
  }

  getUser(): AccountUser | null {
    return this.user;
  }

  isAuthenticated(): boolean {
    return this.user != null;
  }

  subscribe(listener: AuthListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Reads the initial session (waiting for Supabase to restore it from
   * storage) and registers the onAuthStateChange listener. Safe to call
   * once; subsequent calls are no-ops.
   */
  async initialize(): Promise<AuthInitResult> {
    if (this.initialized) {
      return { reason: this.client ? "configured" : "not-configured", restored: this.user != null };
    }
    const client = getSupabase();
    if (!client) {
      this.initialized = true;
      return { reason: "no-client", restored: false };
    }
    this.client = client;

    // onAuthStateChange fires INITIAL_SESSION after the stored session is
    // resolved — await that first event so `user` is correct before any
    // consumer reads it (no race between UI and data layer).
    const initialSession = new Promise<Session | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 4000);
      const {
        data: { subscription },
      } = client.auth.onAuthStateChange((event, session) => {
        if (event === "INITIAL_SESSION") {
          clearTimeout(timeout);
          resolve(session);
          subscription.unsubscribe();
        }
      });
    });
    const restoredSession = await initialSession;

    // Keep ONE subscription alive for the app's lifetime.
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      this.applySession(session);
    });
    this.unsubscribe = () => subscription.unsubscribe();

    this.applySession(restoredSession);
    this.initialized = true;
    return { reason: "configured", restored: restoredSession != null };
  }

  /** Sign in with email + password. Throws mapped errors (errors.ts). */
  async signIn(email: string, password: string): Promise<void> {
    const client = this.requireClient();
    const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
  }

  /** Sign up with email + password. Throws mapped errors (errors.ts). */
  async signUp(email: string, password: string): Promise<void> {
    const client = this.requireClient();
    const { error } = await client.auth.signUp({ email: email.trim(), password });
    if (error) throw error;
  }

  /** Signs the user out server-side. The data-layer swap happens in the
   * auth listener registered by the app (data-source.ts). */
  async signOut(): Promise<void> {
    const client = this.requireClient();
    const { error } = await client.auth.signOut();
    if (error) throw error;
  }

  /** Test hook: pretend a session exists / ended without a server round-trip. */
  setUserDirect(user: AccountUser | null): void {
    this.applySession(user ? ({ user: { id: user.id, email: user.email } } as unknown as Session) : null);
  }

  /** Detaches the auth listener (used by tests). */
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.listeners.clear();
  }

  private requireClient(): SupabaseClient {
    if (!this.client) throw new Error("Auth controller not initialized");
    return this.client;
  }

  private applySession(session: Session | null): void {
    const next: AccountUser | null = session?.user
      ? { id: session.user.id, email: session.user.email ?? "" }
      : null;
    const sameUser = this.user?.id === next?.id;
    this.user = next;
    if (!sameUser) {
      for (const listener of this.listeners) {
        listener(next);
      }
    }
  }
}

export const auth = new AuthController();
