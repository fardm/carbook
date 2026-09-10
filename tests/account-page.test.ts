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

/** Opens the change-password modal and submits it with the given values. */
async function submitPasswordForm(
  container: HTMLElement,
  values: { next: string; confirm: string },
): Promise<void> {
  container.querySelector<HTMLButtonElement>(".js-open-password")!.click();
  const form = container.querySelector<HTMLFormElement>(".account-form")!;
  const set = (sel: string, value: string): void => {
    form.querySelector<HTMLInputElement>(sel)!.value = value;
  };
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

  it("renders title, email, change-password and logout actions — no inline form", async () => {
    const { container } = await renderSignedIn();

    const html = container.innerHTML;
    expect(container.querySelector(".view-title")?.textContent).toContain("حساب کاربری");
    expect(html).toContain(EMAIL); // signup/login email
    expect(container.querySelector(".js-open-password")?.textContent).toContain("تنظیم / تغییر رمز عبور");
    expect(container.querySelector(".js-logout-start")?.textContent).toContain("خروج از حساب");
    // Not a form page: no password fields inline, no cards.
    expect(html).not.toContain('id="account-new-password"');
    expect(html).not.toContain('id="account-confirm-password"');
    // No explanatory paragraphs / helper text.
    expect(html).not.toContain("باقی می‌مانند"); // old logout cloud note
    expect(html).not.toContain("احراز هویت"); // old change-password intro
  });

  it("opens the change-password modal (the shared .modal component) on click", async () => {
    const { container } = await renderSignedIn();

    container.querySelector<HTMLButtonElement>(".js-open-password")!.click();

    const modal = container.querySelector<HTMLElement>(".modal.account-modal");
    expect(modal).not.toBeNull();
    expect(modal!.getAttribute("role")).toBe("dialog");
    expect(modal!.innerHTML).toContain('id="account-new-password"');
    expect(modal!.innerHTML).toContain('id="account-confirm-password"');

    // Cancel closes the modal without touching Supabase.
    modal!.querySelector<HTMLButtonElement>(".js-password-close")!.click();
    expect(container.querySelector(".modal")).toBeNull();
  });

  it("closes the modal when the overlay itself is clicked", async () => {
    const { container } = await renderSignedIn();

    container.querySelector<HTMLButtonElement>(".js-open-password")!.click();
    const overlay = container.querySelector<HTMLElement>(".modal-overlay");
    expect(overlay).not.toBeNull();
    overlay!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(container.querySelector(".modal")).toBeNull();
  });

  it("blocks submission until the new password and confirmation agree", async () => {
    const { container, supabase } = await renderSignedIn();

    await submitPasswordForm(container, {
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
      next: "abc",
      confirm: "abc",
    });

    expect(container.querySelector(".field__error")?.textContent).toContain("۶ کاراکتر");
    expect(supabase.calls).toEqual([]);
  });

  it("changes the password through Supabase Auth, then closes the modal with a toast", async () => {
    const { container, supabase } = await renderSignedIn();

    await submitPasswordForm(container, {
      next: "abc123",
      confirm: "abc123",
    });

    expect(supabase.calls).toEqual([{ fn: "updateUser", args: { password: "abc123" } }]);
    // Success feedback + modal closed (nothing left inline on the page).
    expect(document.querySelector(".toast")?.textContent).toContain("گذرواژه با موفقیت تنظیم شد");
    expect(container.querySelector(".modal")).toBeNull();
  });

  it("shows a friendly error inside the (still open) modal on Supabase failure", async () => {
    const { container, supabase } = await renderSignedIn({
      updateError: { message: "Invalid login credentials", status: 400 },
    });

    await submitPasswordForm(container, {
      next: "abc123",
      confirm: "abc123",
    });

    expect(supabase.calls).toEqual([{ fn: "updateUser", args: { password: "abc123" } }]);
    const modal = container.querySelector(".modal.account-modal");
    expect(modal).not.toBeNull();
    expect(modal!.querySelector(".box--error")).not.toBeNull();
    expect(modal!.innerHTML).toContain("ایمیل یا گذرواژه اشتباه است");
  });

  it("asks for confirmation before logout, then signs out on confirm", async () => {
    const { container, supabase } = await renderSignedIn();

    // Step 1: clicking خروج از حساب opens the confirm dialog, nothing more.
    container.querySelector<HTMLButtonElement>(".js-logout-start")!.click();
    const confirmModal = container.querySelector(".modal[role='alertdialog']");
    expect(confirmModal).not.toBeNull();
    expect(confirmModal!.innerHTML).toContain("آیا از خروج از حساب مطمئن هستید؟");
    // Neutral text — no warning box, no red background.
    expect(confirmModal!.querySelector(".box--danger")).toBeNull();
    expect(container.querySelector(".js-logout-confirm")?.textContent).toContain("خروج");
    // No session change has happened yet.
    expect(supabase.calls).toEqual([]);
    expect(auth.isAuthenticated()).toBe(true);

    // Step 2: انصراف closes the dialog without signing out.
    container.querySelector<HTMLButtonElement>(".js-logout-cancel")!.click();
    expect(container.querySelector(".modal")).toBeNull();
    expect(supabase.calls).toEqual([]);
    expect(auth.isAuthenticated()).toBe(true);

    // Step 3: confirming performs the existing logout flow.
    container.querySelector<HTMLButtonElement>(".js-logout-start")!.click();
    container.querySelector<HTMLButtonElement>(".js-logout-confirm")!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(supabase.calls).toEqual([{ fn: "signOut", args: null }]);
    expect(auth.isAuthenticated()).toBe(false);
    // The Account page itself navigates back to the normal app on logout.
    expect(window.location.hash).toBe("#/vehicle");
  });
});
