// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { auth } from "../src/supabase/auth";
import { setSupabaseOverride } from "../src/supabase/client";
import { initializeDataSource, resetDataSourceForTests } from "../src/supabase/data-source";
import { renderAccount } from "../src/views/account";

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

type AuthEventCallback = (event: string, session: unknown) => void;

/** Minimal Supabase auth double: records updateUser/signOut calls. */
function fakeSupabaseAuth(options?: { updateError?: { message: string; status?: number } }) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const listeners = new Set<AuthEventCallback>();
  let session: unknown = null;
  const client = {
    from: () => {
      throw new Error("not used here");
    },
    auth: {
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      onAuthStateChange: vi.fn((callback: AuthEventCallback) => {
        listeners.add(callback);
        return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
      }),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(async () => {
        calls.push({ fn: "signOut", args: null });
        session = null;
        for (const callback of listeners) callback("SIGNED_OUT", null);
        return { error: null };
      }),
      updateUser: vi.fn(async (args: unknown) => {
        calls.push({ fn: "updateUser", args });
        if (options?.updateError) return { data: { user: null }, error: options.updateError };
        return { data: { user: {} }, error: null };
      }),
    },
  } as unknown as SupabaseClient;
  return {
    client,
    calls,
    /** Signs a user in through the SDK event path. */
    signInAs: () => {
      session = { user: { id: USER_ID, email: EMAIL } };
      for (const callback of listeners) callback("SIGNED_IN", session);
    },
  };
}

const USER_ID = "22222222-2222-4222-8222-222222222222";
const EMAIL = "user@mail.com";

let disposers: Array<() => void> = [];

/** Boots auth with the fake, fakes a restored session, renders the page. */
async function renderSignedIn(
  options?: Parameters<typeof fakeSupabaseAuth>[0],
): Promise<{ container: HTMLElement; supabase: ReturnType<typeof fakeSupabaseAuth> }> {
  const supabase = fakeSupabaseAuth(options);
  setSupabaseOverride(supabase.client);
  await initializeDataSource();
  supabase.signInAs();
  await new Promise((resolve) => setTimeout(resolve, 0)); // let swaps settle
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = renderAccount(container);
  if (typeof dispose === "function") disposers.push(dispose);
  return { container, supabase };
}

/** Fills and submits the change-password form. */
async function submitPasswordForm(
  container: HTMLElement,
  values: { current: string; next: string; confirm: string },
): Promise<void> {
  const form = container.querySelector<HTMLFormElement>(".account-form")!;
  const set = (sel: string, value: string): void => {
    form.querySelector<HTMLInputElement>(sel)!.value = value;
  };
  set("#account-current-password", values.current);
  set("#account-new-password", values.next);
  set("#account-confirm-password", values.confirm);
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("account page", () => {
  beforeEach(() => {
    resetDataSourceForTests();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    for (const dispose of disposers) dispose();
    disposers = [];
    setSupabaseOverride(null);
    auth.resetForTests();
    resetDataSourceForTests();
    document.body.innerHTML = "";
  });

  it("sends a definitive guest back to the default route", async () => {
    const supabase = fakeSupabaseAuth();
    setSupabaseOverride(supabase.client);
    await initializeDataSource();
    expect(auth.isInitialized()).toBe(true);
    expect(auth.getUser()).toBeNull();

    window.location.hash = "#/account";
    const box = document.createElement("div");
    document.body.appendChild(box);
    renderAccount(box);
    expect(window.location.hash).toBe("#/vehicle");
    window.location.hash = "";
  });

  it("renders the title, the user's email, change-password fields, and logout", async () => {
    const { container } = await renderSignedIn();

    const html = container.innerHTML;
    expect(html).toContain("حساب کاربری"); // page title
    expect(html).toContain(EMAIL); // signup/login email
    expect(html).toContain("تغییر رمز عبور"); // section title + submit
    expect(html).toContain("خروج از حساب"); // logout button
    expect(html).toContain("id=\"account-current-password\"");
    expect(html).toContain("id=\"account-new-password\"");
    expect(html).toContain("id=\"account-confirm-password\"");
    // The old logged-in modal markup must not leak onto the page.
    expect(html).not.toContain("js-account-close");
  });

  it("blocks submission until the new password and confirmation agree", async () => {
    const { container, supabase } = await renderSignedIn();

    await submitPasswordForm(container, {
      current: "old-pass-1",
      next: "abc123",
      confirm: "abc999",
    });

    // Mismatch caught client-side; Supabase was never called.
    expect(container.querySelector(".field__error")?.textContent).toContain("یکسان نیستند");
    expect(supabase.calls).toEqual([]);
  });

  it("rejects a too-short new password client-side", async () => {
    const { container, supabase } = await renderSignedIn();

    await submitPasswordForm(container, {
      current: "old-pass-1",
      next: "abc",
      confirm: "abc",
    });

    expect(container.querySelector(".field__error")?.textContent).toContain("۶ کاراکتر");
    expect(supabase.calls).toEqual([]);
  });

  it("changes the password through Supabase Auth and shows the success message", async () => {
    const { container, supabase } = await renderSignedIn();

    await submitPasswordForm(container, {
      current: "old-pass-1",
      next: "abc123",
      confirm: "abc123",
    });

    expect(supabase.calls).toEqual([{ fn: "updateUser", args: { password: "abc123" } }]);
    expect(container.querySelector(".box--success")).not.toBeNull();
    expect(container.innerHTML).toContain("گذرواژه با موفقیت تغییر کرد");
  });

  it("shows a friendly error when Supabase rejects the change", async () => {
    const { container, supabase } = await renderSignedIn({
      updateError: { message: "Invalid login credentials", status: 400 },
    });

    await submitPasswordForm(container, {
      current: "old-pass-1",
      next: "abc123",
      confirm: "abc123",
    });

    expect(supabase.calls).toEqual([{ fn: "updateUser", args: { password: "abc123" } }]);
    expect(container.querySelector(".box--error")).not.toBeNull();
    expect(container.innerHTML).toContain("ایمیل یا گذرواژه اشتباه است");
  });

  it("logs out through auth.signOut and returns to the guest default route", async () => {
    const { container, supabase } = await renderSignedIn();

    const logout = container.querySelector<HTMLButtonElement>(".js-logout-start");
    expect(logout).not.toBeNull();
    logout!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(supabase.calls).toEqual([{ fn: "signOut", args: null }]);
    expect(auth.isAuthenticated()).toBe(false);
    // The Account page itself navigates back to the normal app on logout.
    expect(window.location.hash).toBe("#/vehicle");
  });
});
