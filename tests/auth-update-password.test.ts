// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { auth } from "../src/supabase/auth";
import { setSupabaseOverride } from "../src/supabase/client";
import { navAccountItemHtml, onNavAccountClicked, closeAccountModal } from "../src/ui/account";

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

type AuthEventCallback = (event: string, session: unknown) => void;

/** Minimal Supabase auth double that records updateUser() calls. */
function fakeSupabaseAuth(options?: { updateError?: { message: string; status?: number } }) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const listeners = new Set<AuthEventCallback>();
  const client = {
    from: () => {
      throw new Error("not used here");
    },
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn((callback: AuthEventCallback) => {
        listeners.add(callback);
        return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
      }),
      signInWithPassword: vi.fn(async (args: unknown) => {
        calls.push({ fn: "signInWithPassword", args });
        return { data: { user: null }, error: null };
      }),
      signUp: vi.fn(async (args: unknown) => {
        calls.push({ fn: "signUp", args });
        return { data: { user: null }, error: null };
      }),
      signOut: vi.fn(async () => ({ error: null })),
      updateUser: vi.fn(async (args: unknown) => {
        calls.push({ fn: "updateUser", args });
        if (options?.updateError) return { data: { user: null }, error: options.updateError };
        return { data: { user: {} }, error: null };
      }),
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

/** Boots the auth controller against the fake and marks a signed-in user. */
async function bootWithUser(userId: string | null): Promise<void> {
  setSupabaseOverride(fakeSupabaseAuth().client);
  await auth.initialize();
  if (userId) {
    (
      auth as unknown as { applySession: (s: unknown) => void }
    ).applySession({ user: { id: userId, email: "user@mail.com" } });
  }
}

/* ------------------------------------------------------------------ */
/* updatePassword — Supabase Auth updateUser flow                      */
/* ------------------------------------------------------------------ */

describe("auth.updatePassword — Supabase updateUser flow", () => {
  afterEach(() => {
    setSupabaseOverride(null);
    auth.resetForTests();
  });

  it("passes the new password to auth.updateUser({ password })", async () => {
    const { client, calls } = fakeSupabaseAuth();
    setSupabaseOverride(client);
    await auth.initialize();
    (
      auth as unknown as { applySession: (s: unknown) => void }
    ).applySession({ user: { id: "u1", email: "user@mail.com" } });

    await auth.updatePassword("new-secret-9");

    expect(calls).toEqual([{ fn: "updateUser", args: { password: "new-secret-9" } }]);
  });

  it("throws the mapped Supabase error when the update fails", async () => {
    const { client } = fakeSupabaseAuth({
      updateError: { message: "Invalid login credentials", status: 400 },
    });
    setSupabaseOverride(client);
    await auth.initialize();
    (
      auth as unknown as { applySession: (s: unknown) => void }
    ).applySession({ user: { id: "u1", email: "user@mail.com" } });

    await expect(auth.updatePassword("whatever1")).rejects.toMatchObject({
      message: "Invalid login credentials",
      status: 400,
    });
  });

  it("throws when the auth controller is not initialized", async () => {
    await expect(auth.updatePassword("whatever1")).rejects.toThrow(
      "Auth controller not initialized",
    );
  });
});

/* ------------------------------------------------------------------ */
/* Account nav entry — identical button both states, modal vs page     */
/* ------------------------------------------------------------------ */

describe("account nav entry", () => {
  afterEach(() => {
    setSupabaseOverride(null);
    auth.resetForTests();
    closeAccountModal();
  });

  it("renders the SAME «حساب کاربری» button for guests and signed-in users", () => {
    const guestHtml = navAccountItemHtml();
    expect(guestHtml).toContain("حساب کاربری");
    expect(guestHtml).toContain("js-nav-account");
    expect(guestHtml).not.toContain("js-nav-logout");
    expect(guestHtml).not.toContain("log-out");

    bootWithUser("22222222-2222-4222-8222-222222222222").then(() => {
      // Re-render while authenticated: byte-identical markup, no logout item.
      expect(navAccountItemHtml()).toBe(guestHtml);
    });
  });

  it("opens the login/signup modal for guests (no navigation)", () => {
    bootWithUser(null).then(() => {
      const before = window.location.hash;
      onNavAccountClicked();
      expect(document.getElementById("account-overlay")).not.toBeNull();
      expect(document.querySelector(".account-tabs")).not.toBeNull();
      expect(window.location.hash).toBe(before);
      // The old authenticated modal content is gone for good.
      expect(document.querySelector(".js-logout-start")).toBeNull();
      expect(document.querySelector(".account-profile")).toBeNull();
    });
  });

  it("navigates signed-in users to the Account page route", () => {
    bootWithUser("22222222-2222-4222-8222-222222222222").then(() => {
      window.location.hash = "#/vehicle";
      onNavAccountClicked();
      expect(window.location.hash).toBe("#/account");
      // No modal appeared instead.
      expect(document.getElementById("account-overlay")).toBeNull();
    });
  });
});
