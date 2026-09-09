import { DEFAULT_ROUTE, hashFor } from "../ui/router";
import { t } from "../i18n";
import { escHtml } from "../ui/escape";
import { applyIcons } from "../ui/icons";
import { bindFloatingFields } from "../ui/floating-field";
import { store } from "../state/store";
import { auth } from "../supabase/auth";
import { getSupabase } from "../supabase/client";
import {
  mapAuthError,
  passwordsMatch,
  validatePassword,
} from "../supabase/errors";
import {
  applyAuthState,
  currentGuestRepository,
  reloadActiveRepository,
} from "../supabase/data-source";
import { hasMeaningfulData, countDataset, type DatasetCounts } from "../supabase/cloud-dataset";
import { migrateGuestDataToCloud } from "../supabase/migration";

/**
 * Account page — the dedicated, always-reachable account route (#/account).
 *
 * Reached only while authenticated (the guest entry point is the login/
 * signup modal instead, see ui/account.ts). Deliberately minimal:
 *   1. Profile — the signed-in user's email.
 *   2. تغییر رمز عبور — current + new + confirm; the update itself goes
 *      through Supabase Auth (`auth.updateUser({ password })`); no password
 *      is ever stored or managed by this app.
 *   3. خروج از حساب — the existing `auth.signOut()` flow; the data layer
 *      swaps back to the guest IndexedDB repository on the auth event and
 *      the app returns to the normal guest state.
 *
 * Guest→cloud migration: when the user signs in while the local guest
 * dataset holds meaningful data, the one-time offer is shown here (the same
 * offer that used to live inside the account modal). The local data is
 * NEVER deleted — only read for the upload.
 */

/* ------------------------------------------------------------------ */
/* State (module-local, like the other views)                          */
/* ------------------------------------------------------------------ */

type MigrationChoice = "pending" | "accepted" | "declined";

interface AccountViewState {
  busy: boolean;
  /** Current/new/confirm password fields (client-side validation errors). */
  currentErrorKey: string | null;
  newPasswordErrorKey: string | null;
  confirmErrorKey: string | null;
  /** Supabase update failure (mapped key); null = hidden. */
  changeErrorKey: string | null;
  /** Set right after a successful password change (dismissible). */
  changeSuccess: boolean;
  /** Migration offer state after a fresh sign-in. */
  migration: (MigrationChoice | "offer") | null;
  migrationCounts: DatasetCounts | null;
  migrationErrorKey: string | null;
}

const state: AccountViewState = {
  busy: false,
  currentErrorKey: null,
  newPasswordErrorKey: null,
  confirmErrorKey: null,
  changeErrorKey: null,
  changeSuccess: false,
  migration: null,
  migrationCounts: null,
  migrationErrorKey: null,
};

/** Clears the view-local state when the user navigates away from the page. */
export function leaveAccountView(): void {
  state.busy = false;
  state.currentErrorKey = null;
  state.newPasswordErrorKey = null;
  state.confirmErrorKey = null;
  state.changeErrorKey = null;
  state.changeSuccess = false;
  // Migration state survives navigation on purpose: it is a ONE-TIME offer
  // after sign-in, not page-local form state. It is consumed by showing the
  // offer (accepted / declined) or by the next auth transition.
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

export function renderAccount(container: HTMLElement): (() => void) | void {
  // Boot race: main.ts renders the active route BEFORE the Supabase session
  // has been restored (initializeDataSource is still in flight). The auth
  // decision is not final yet — render a quiet placeholder and let main.ts
  // re-render once the data layer settles (a restored session then shows
  // this page, a guest is sent away below). Refreshing on #/account must
  // stay on the Account page, never bounce to the default route.
  if (!auth.isInitialized()) {
    container.innerHTML = "";
    return;
  }

  const user = auth.getUser();

  // Definitive guest: the page needs a session. A guest can only end up
  // here through a hand-edited URL (or a logout racing the render); send
  // them to the default route like any other link, without touching history.
  if (!user) {
    window.location.hash = hashFor(DEFAULT_ROUTE);
    return;
  }

  const draw = (): void => {
    container.innerHTML = accountViewHtml();
    bind(container);
    applyIcons();
    bindFloatingFields(container);
  };
  draw();
  // Password fields + the offer must NOT be redrawn (and their typed input
  // wiped) by unrelated store updates — the view subscribes only to the
  // auth controller while mounted.
  return auth.subscribe((next) => {
    if (!next) {
      // Logged out while the page was open: the data layer has already
      // swapped to guest mode; leave the page for the normal app.
      window.location.hash = hashFor(DEFAULT_ROUTE);
      return;
    }
    draw();
  });
}

function accountViewHtml(): string {
  const user = auth.getUser();
  if (!user) return "";
  return `
    <div class="view-stack">
      <h1 class="view-title">${t("view.account.title")}</h1>
      ${profileCardHtml(user.email)}
      ${changePasswordCardHtml()}
      ${logoutCardHtml()}
    </div>
  `;
}

/* --- 1. Profile card: the signup/login email --- */

function profileCardHtml(email: string): string {
  return `
    <section class="card">
      <div class="account-profile">
        <span class="account-profile__avatar" data-lucide="circle-user-round" aria-hidden="true"></span>
        <span class="account-profile__email" dir="ltr">${escHtml(email)}</span>
      </div>
      ${migrationHtmlSection()}
    </section>
  `;
}

/* --- 2. Change password (Supabase Auth updateUser) --- */

function changePasswordCardHtml(): string {
  const errorHtml = state.changeErrorKey
    ? `<div class="box box--error" role="alert"><span data-lucide="circle-alert"></span><span>${escHtml(t(state.changeErrorKey as never))}</span></div>`
    : "";
  const successHtml = state.changeSuccess
    ? `<div class="box box--success" role="status"><span data-lucide="circle-check"></span><span>${t("account.changePasswordSuccess")}</span></div>`
    : "";
  const submitLabel = state.busy
    ? `<span class="account-spinner" data-lucide="loader-circle"></span>${t("account.working")}`
    : t("account.changePasswordButton");

  return `
    <section class="card">
      <h2 class="card__title">${t("account.changePasswordTitle")}</h2>
      <p class="card__text">${t("account.changePasswordIntro")}</p>
      <form class="form account-form" novalidate>
        <div class="field">
          <label class="field__label" for="account-current-password">${t("account.currentPasswordLabel")}</label>
          <input class="field__input" id="account-current-password" name="currentPassword" type="password"
            dir="ltr" autocomplete="current-password"
            placeholder="${t("account.currentPasswordPlaceholder")}" />
          ${fieldErrorHtml(state.currentErrorKey)}
        </div>
        <div class="field">
          <label class="field__label" for="account-new-password">${t("account.newPasswordLabel")}</label>
          <input class="field__input" id="account-new-password" name="newPassword" type="password"
            dir="ltr" autocomplete="new-password"
            placeholder="${t("account.passwordPlaceholder")}" />
          ${fieldErrorHtml(state.newPasswordErrorKey)}
        </div>
        <div class="field">
          <label class="field__label" for="account-confirm-password">${t("account.confirmPasswordLabel")}</label>
          <input class="field__input" id="account-confirm-password" name="confirmPassword" type="password"
            dir="ltr" autocomplete="new-password"
            placeholder="${t("account.confirmPasswordPlaceholder")}" />
          ${fieldErrorHtml(state.confirmErrorKey)}
        </div>
        ${errorHtml}
        ${successHtml}
        <div class="form__actions">
          <button type="submit" class="btn btn--filled js-change-password" ${state.busy ? "disabled" : ""}>
            ${submitLabel}
          </button>
        </div>
      </form>
    </section>
  `;
}

/** One inline validation error under a field; null = nothing rendered. */
function fieldErrorHtml(key: string | null): string {
  return key ? `<p class="field__error">${escHtml(t(key as never))}</p>` : "";
}

/* --- 3. Logout (existing auth.signOut flow) --- */

function logoutCardHtml(): string {
  return `
    <section class="card account-logout-card">
      <h2 class="card__title">${t("account.logoutSectionTitle")}</h2>
      <p class="card__text">${t("account.logoutKeepCloudNote")}</p>
      <div class="form__actions account-actions">
        <button type="button" class="btn btn--danger-text js-logout-start" ${state.busy ? "disabled" : ""}>
          <span data-lucide="log-out"></span>
          ${t("account.logoutButton")}
        </button>
      </div>
    </section>
  `;
}

/* --- One-time guest→cloud migration offer (after a fresh sign-in) --- */

function migrationHtmlSection(): string {
  if (state.migration !== "offer" || !state.migrationCounts) return "";
  const counts = state.migrationCounts;
  const countsText = t("account.migrationCounts")
    .replace("{vehicles}", String(counts.vehicles))
    .replace("{items}", String(counts.items))
    .replace("{services}", String(counts.services))
    .replace("{reminders}", String(counts.reminders));
  const errorHtml = state.migrationErrorKey
    ? `<div class="box box--error" role="alert"><span>${escHtml(t(state.migrationErrorKey as never))}</span></div>`
    : "";
  return `
    <section class="card account-migration">
      <h3 class="card__title">${t("account.migrationTitle")}</h3>
      <p class="card__text">${t("account.migrationIntro")}</p>
      <p class="account-migration__counts">${escHtml(countsText)}</p>
      ${errorHtml}
      <div class="form__actions">
        <button type="button" class="btn btn--text js-migration-decline" ${state.busy ? "disabled" : ""}>
          ${t("account.migrationDecline")}
        </button>
        <button type="button" class="btn btn--filled js-migration-accept" ${state.busy ? "disabled" : ""}>
          ${state.busy ? `<span class="account-spinner" data-lucide="loader-circle"></span>${t("account.working")}` : t("account.migrationButton")}
        </button>
      </div>
    </section>
  `;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function bind(container: HTMLElement): void {
  const form = container.querySelector<HTMLFormElement>(".account-form");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitPasswordChange(container, form);
  });
  container.querySelector(".js-logout-start")?.addEventListener("click", () => {
    void performLogout(container);
  });
  container.querySelector(".js-migration-accept")?.addEventListener("click", () => {
    void performMigration(container);
  });
  container.querySelector(".js-migration-decline")?.addEventListener("click", () => {
    state.migration = "declined";
    redraw(container);
  });
}

/** Re-renders without notifying the store (pure view-local transitions). */
function redraw(container: HTMLElement): void {
  container.innerHTML = accountViewHtml();
  bind(container);
  applyIcons();
  bindFloatingFields(container);
}

/* --- Change password --- */

async function submitPasswordChange(container: HTMLElement, form: HTMLFormElement): Promise<void> {
  const read = (selector: string): string =>
    form.querySelector<HTMLInputElement>(selector)?.value ?? "";
  const current = read("#account-current-password");
  const next = read("#account-new-password");
  const confirm = read("#account-confirm-password");

  // Client-side validation first (friendly, immediate): the new password
  // must satisfy Supabase's own minimum and the confirmation must match.
  state.currentErrorKey = current === "" ? "account.errors.requiredPassword" : null;
  state.newPasswordErrorKey = validatePassword(next)
    ? "account.errors.shortPassword"
    : null;
  state.confirmErrorKey = passwordsMatch(next, confirm)
    ? null
    : "account.errors.passwordMismatch";
  state.changeErrorKey = null;
  state.changeSuccess = false;
  if (state.currentErrorKey || state.newPasswordErrorKey || state.confirmErrorKey) {
    redraw(container);
    return;
  }

  state.busy = true;
  redraw(container);
  try {
    await auth.updatePassword(next);
    state.changeSuccess = true;
  } catch (error) {
    state.changeErrorKey = mapAuthError(error);
  } finally {
    state.busy = false;
    redraw(container);
  }
}

/* --- Logout (unchanged flow; no extra confirmation dialog) --- */

async function performLogout(container: HTMLElement): Promise<void> {
  try {
    await auth.signOut();
    // onAuthStateChange → auth subscribers → applyAuthState() swaps the
    // store back to IndexedDB; the auth subscription above navigates the
    // page back to the default route.
  } catch (error) {
    state.changeErrorKey = mapAuthError(error);
    redraw(container);
  }
}

/* ------------------------------------------------------------------ */
/* Guest→cloud migration (same flow the modal used to own)             */
/* ------------------------------------------------------------------ */

/* Snapshot of the GUEST dataset taken at sign-in, kept for the one-time
 * migration offer (module-local, one sign-in at a time). */
let lastGuestSnapshot: ReturnType<typeof store.get> | null = null;

/** Runs once after a successful sign-in: snapshot the guest dataset, swap
 * the data layer to the cloud backend, then prepare the one-time migration
 * offer if the guest data was meaningful. Called from ui/account.ts. */
export async function afterAuthenticated(): Promise<void> {
  const user = auth.getUser();
  if (!user) return;
  // Snapshot the GUEST dataset straight from the guest repository (NOT from
  // the store): the auth listener may already have swapped the store to the
  // user's cloud backend, and IndexedDB must never be read through the
  // wrong lens. Waiting for initialLoad guarantees the async IndexedDB load
  // has settled before we read it.
  const guestRepo = currentGuestRepository();
  await guestRepo.initialLoad?.();
  await guestRepo.flush?.();
  const guestSnapshot = guestRepo.load();
  // Swap the store to the user's Supabase repository (idempotent if the
  // auth listener already did it).
  await applyAuthState();
  // One-time migration offer only when the guest dataset was meaningful.
  if (hasMeaningfulData(guestSnapshot) && getSupabase()) {
    state.migration = "offer";
    state.migrationCounts = countDataset(guestSnapshot);
    state.migrationErrorKey = null;
  } else {
    state.migration = "pending";
  }
  // Keep a reference for the migration upload (reads local data only).
  lastGuestSnapshot = guestSnapshot;
}

async function performMigration(container: HTMLElement): Promise<void> {
  const client = getSupabase();
  const user = auth.getUser();
  const dataset = lastGuestSnapshot;
  if (!client || !user || !dataset) {
    state.migration = "declined";
    redraw(container);
    return;
  }
  state.busy = true;
  redraw(container);
  const result = await migrateGuestDataToCloud(client, user.id, dataset);
  state.busy = false;
  if (result.status === "migrated") {
    state.migration = "accepted";
    state.migrationErrorKey = null;
    // Reload the store from the cloud so the migrated rows are visible.
    await reloadActiveRepository();
  } else if (result.status === "conflict") {
    state.migration = "declined";
    state.migrationErrorKey = "account.migrationConflict";
  } else if (result.status === "error") {
    // Keep the offer open for retry; local data is untouched.
    state.migrationErrorKey = "account.errors.migrationFailed";
  } else {
    state.migration = "declined";
  }
  redraw(container);
}
