import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./client";

/**
 * Authentication state — the single source of truth for "who is signed in".
 *
 * The controller is initialized exactly once at app boot (before any view
 * renders or data loads), subscribes to Supabase's auth state changes, and
 * notifies subscribers on every transition so UI + data layer react
 * immediately after login/logout.
 *
 * Session persistence across launches (browser tabs AND installed Android PWA
 * cold starts — both share the same per-origin localStorage):
 *  - client.ts persists sessions with `persistSession: true` + PKCE OAuth
 *    (PKCE sessions carry a refresh_token; implicit ones do not and can
 *    never survive a restart).
 *  - initialize() explicitly AWAITS `auth.getSession()` — the SDK resolves it
 *    only after it has restored (or definitively failed to restore) the
 *    persisted session. No timeout and no guesswork: the app boots as
 *    authenticated exactly when a session is actually stored, and as guest
 *    exactly when it is not.
 *  - Transient null-session events delivered while restoration is still in
 *    flight are ignored (see applySession) so the "still loading" state can
 *    never be mistaken for a logout.
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
  /** True between initialize() start and the restored session being applied.
   * While true, a null session event is the SDK's transient "still loading"
   * state (or a spurious pre-restoration SIGNED_OUT) — NOT a real logout —
   * so it must never clear the signed-in user or notify listeners. */
  private restoring = false;
  /** In-flight initialize() promise (drives re-entrant calls + test reset). */
  private initPromise: Promise<AuthInitResult> | null = null;
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
   * Reads the persisted session and registers the onAuthStateChange
   * listener. Safe to call once; subsequent calls are no-ops.
   *
   * Order matters: the lifetime listener is registered BEFORE the initial
   * session is applied, so the INITIAL_SESSION event (and any SIGNED_IN
   * event fired while initialization is still running) can never fall into
   * the gap and be lost.
   */
  async initialize(): Promise<AuthInitResult> {
    if (this.initialized) {
      return { reason: this.client ? "configured" : "not-configured", restored: this.user != null };
    }
    // Re-entrant call while initialization is still running: do NOT register a
    // second subscription and do NOT re-apply a provisional null (which would
    // log the user out mid-boot). Await the SAME in-flight init and report its
    // outcome — every concurrent caller gets the final answer.
    if (this.restoring) {
      return this.initPromise ?? { reason: "configured", restored: false };
    }
    const client = getSupabase();
    if (!client) {
      this.initialized = true;
      return { reason: "no-client", restored: false };
    }
    this.client = client;
    this.restoring = true;
    this.initPromise = this.initializeInner(client).finally(() => {
      this.restoring = false;
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private async initializeInner(client: SupabaseClient): Promise<AuthInitResult> {
    // ONE subscription for the app's lifetime: it receives the SDK's
    // INITIAL_SESSION event, then every later SIGNED_IN / SIGNED_OUT /
    // TOKEN_REFRESHED / USER_UPDATED event. TOKEN_REFRESHED carries the
    // same user, so applySession() keeps it a no-op (it must never flip
    // the app back to guest mode).
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      this.applySession(session);
    });
    this.unsubscribe = () => subscription.unsubscribe();

    // Explicitly wait for the persisted session. getSession() awaits the
    // SDK's own initialization (localStorage restore + token refresh), so
    // its result is the FINAL answer about the stored session — never a
    // provisional guess. A failing restore (offline, corrupt storage)
    // degrades to guest mode; the listener above still applies a session
    // if the SDK recovers one afterwards.
    let restoredSession: Session | null = null;
    try {
      const { data, error } = await client.auth.getSession();
      if (!error) restoredSession = data.session;
    } catch {
      restoredSession = null;
    }

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

  /**
   * Changes the signed-in user's password through Supabase Auth
   * (`auth.updateUser({ password })`) — the password is never stored or
   * managed by this app. Requires an active session; throws mapped errors
   * (errors.ts) on failure.
   */
  async updatePassword(password: string): Promise<void> {
    const client = this.requireClient();
    const { error } = await client.auth.updateUser({ password });
    if (error) throw error;
  }

  /** Signs the user out server-side. The data-layer swap happens in the
   * auth listener registered by the app (data-source.ts). */
  async signOut(): Promise<void> {
    const client = this.requireClient();
    const { error } = await client.auth.signOut();
    if (error) throw error;
  }

  /** Sign in with Google OAuth. Throws mapped errors (errors.ts). */
  async signInWithGoogle(): Promise<void> {
    const client = this.requireClient();
    const redirectTo = window.location.origin;
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) throw error;
  }

  /** Test hook: pretend a session exists / ended without a server round-trip. */
  setUserDirect(user: AccountUser | null): void {
    this.applySession(user ? ({ user: { id: user.id, email: user.email } } as unknown as Session) : null);
  }

  /** Test hook: resets the controller to its pre-initialize state so a
   * fresh boot sequence can be exercised. */
  resetForTests(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.listeners.clear();
    this.client = null;
    this.initialized = false;
    this.restoring = false;
    this.initPromise = null;
    this.user = null;
  }

  private requireClient(): SupabaseClient {
    if (!this.client) throw new Error("Auth controller not initialized");
    return this.client;
  }

  private applySession(session: Session | null): void {
    const next: AccountUser | null = session?.user
      ? { id: session.user.id, email: session.user.email ?? "" }
      : null;
    // Startup gate: while restoration is still in flight, a null session is
    // the SDK's transient "not loaded yet" state (INITIAL_SESSION(null), an
    // early SIGNED_OUT broadcast, or a pending refresh) — NOT a user logout.
    // Dropping it here keeps the previous user (and their repository/data)
    // intact until getSession() delivers the definitive persisted session.
    // This is exactly the window an installed PWA's cold start opens: the
    // onAuthStateChange subscription exists before the stored session is read.
    // Only genuine post-init sign-outs (real SIGNED_OUT / signOut()) reach
    // listeners as null.
    if (next === null && this.restoring) return;
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
