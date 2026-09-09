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
 * Account page — the dedicated account route (#/account), deliberately
 * minimal. Four visual rows separated by the app's hairline dividers:
 *
 *   # حساب کاربری
 *   ایمیل  <user email>
 *   ────────────────
 *   تغییر رمز عبور      ← opens the change-password modal
 *   ────────────────
 *   خروج از حساب        ← the existing auth.signOut() flow
 *
 * No explanatory text anywhere. The password form lives in the modal (the
 * project's .modal component, like add/edit/delete vehicle); the update
 * itself goes through Supabase Auth (`auth.updateUser({ password })`) — no
 * password is ever stored or managed by this app.
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
type Modal = null | "password";

interface AccountViewState {
  /** Which modal is open (only the change-password dialog exists). */
  modal: Modal;
  busy: boolean;
  /** Current/new/confirm password fields (client-side validation errors). */
  currentErrorKey: string | null;
  newPasswordErrorKey: string | null;
  confirmErrorKey: string | null;
  /** Supabase update failure (mapped key); null = hidden. */
  changeErrorKey: string | null;
  /** Half-typed modal fields, preserved across re-renders (the same seam
   * the vehicle/item forms use). Keyed by input id. */
  formValues: Record<string, string>;
  /** Migration offer state after a fresh sign-in. */
  migration: (MigrationChoice | "offer") | null;
  migrationCounts: DatasetCounts | null;
  migrationErrorKey: string | null;
}

const state: AccountViewState = {
  modal: null,
  busy: false,
  currentErrorKey: null,
  newPasswordErrorKey: null,
  confirmErrorKey: null,
  changeErrorKey: null,
  formValues: {},
  migration: null,
  migrationCounts: null,
  migrationErrorKey: null,
};

/** Clears the view-local state when the user navigates away from the page. */
export function leaveAccountView(): void {
  state.modal = null;
  state.busy = false;
  state.currentErrorKey = null;
  state.newPasswordErrorKey = null;
  state.confirmErrorKey = null;
  state.changeErrorKey = null;
  state.formValues = {};
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
  // The modal's half-typed fields and the offer must NOT be redrawn (and
  // their input wiped) by unrelated store updates — the view subscribes
  // only to the auth controller while mounted.
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
      <div class="account-list">
        <div class="account-list__row account-list__row--static">
          <span class="account-list__label">${t("account.emailLabel")}</span>
          <span class="account-list__value" dir="ltr">${escHtml(user.email)}</span>
        </div>
        <div class="account-list__divider" role="separator"></div>
        <button type="button" class="account-list__row account-list__row--action js-open-password">
          <span>${t("account.changePasswordTitle")}</span>
          <span class="account-list__chevron" data-lucide="chevron-left" aria-hidden="true"></span>
        </button>
        <div class="account-list__divider" role="separator"></div>
        <button type="button" class="account-list__row account-list__row--action account-list__row--danger js-logout-start">
          <span>${t("account.logoutButton")}</span>
        </button>
      </div>
      ${migrationHtmlSection()}
    </div>
    ${passwordModalHtml()}
  `;
}

/* --- Change-password modal (the project's .modal component) --- */

function passwordModalHtml(): string {
  if (state.modal !== "password") return "";
  const errorHtml = state.changeErrorKey
    ? `<div class="box box--error" role="alert"><span data-lucide="circle-alert"></span><span>${escHtml(t(state.changeErrorKey as never))}</span></div>`
    : "";
  const submitLabel = state.busy
    ? `<span class="account-spinner" data-lucide="loader-circle"></span>${t("account.working")}`
    : t("account.changePasswordButton");

  return `
    <div class="modal-overlay account-overlay">
      <div class="modal account-modal" role="dialog" aria-modal="true" aria-label="${t("account.changePasswordTitle")}">
        <div class="modal__head">
          <div class="form__title">${t("account.changePasswordTitle")}</div>
          <button type="button" class="icon-btn js-password-close" aria-label="${t("common.close")}">
            <span data-lucide="x"></span>
          </button>
        </div>
        <form class="form account-form" novalidate>
          <div class="field">
            <label class="field__label" for="account-current-password">${t("account.currentPasswordLabel")}</label>
            <input class="field__input" id="account-current-password" name="currentPassword" type="password"
              dir="ltr" autocomplete="current-password"
              value="${escHtml(state.formValues["account-current-password"] ?? "")}"
              placeholder="${t("account.currentPasswordPlaceholder")}" />
            ${fieldErrorHtml(state.currentErrorKey)}
          </div>
          <div class="field">
            <label class="field__label" for="account-new-password">${t("account.newPasswordLabel")}</label>
            <input class="field__input" id="account-new-password" name="newPassword" type="password"
              dir="ltr" autocomplete="new-password"
              value="${escHtml(state.formValues["account-new-password"] ?? "")}"
              placeholder="${t("account.passwordPlaceholder")}" />
            ${fieldErrorHtml(state.newPasswordErrorKey)}
          </div>
          <div class="field">
            <label class="field__label" for="account-confirm-password">${t("account.confirmPasswordLabel")}</label>
            <input class="field__input" id="account-confirm-password" name="confirmPassword" type="password"
              dir="ltr" autocomplete="new-password"
              value="${escHtml(state.formValues["account-confirm-password"] ?? "")}"
              placeholder="${t("account.confirmPasswordPlaceholder")}" />
            ${fieldErrorHtml(state.confirmErrorKey)}
          </div>
          ${errorHtml}
          <div class="form__actions">
            <button type="button" class="btn btn--text js-password-close">${t("common.cancel")}</button>
            <button type="submit" class="btn btn--filled js-change-password" ${state.busy ? "disabled" : ""}>
              ${submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

/** One inline validation error under a field; null = nothing rendered. */
function fieldErrorHtml(key: string | null): string {
  return key ? `<p class="field__error">${escHtml(t(key as never))}</p>` : "";
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
  // Capture half-typed modal fields before any redraw (the same seam the
  // vehicle/item forms use so re-renders never wipe user input).
  container.addEventListener("input", onModalInput);

  container.querySelector(".js-open-password")?.addEventListener("click", () => {
    state.modal = "password";
    state.changeErrorKey = null;
    state.currentErrorKey = null;
    state.newPasswordErrorKey = null;
    state.confirmErrorKey = null;
    redraw(container);
    document.getElementById("account-current-password")?.focus();
  });

  const closePassword = (): void => {
    state.modal = null;
    state.formValues = {};
    state.changeErrorKey = null;
    state.currentErrorKey = null;
    state.newPasswordErrorKey = null;
    state.confirmErrorKey = null;
    redraw(container);
  };
  container.querySelectorAll(".js-password-close").forEach((button) => {
    button.addEventListener("click", closePassword);
  });

  // Backdrop click closes the modal without changing the password (same
  // pattern as the reminders view).
  container.querySelectorAll<HTMLElement>(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closePassword();
    });
  });

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

function onModalInput(event: Event): void {
  const input = event.target as HTMLElement | null;
  if (!input || !input.id) return;
  if (state.modal !== "password") return;
  if (input instanceof HTMLInputElement && input.type === "password") {
    state.formValues[input.id] = input.value;
  }
}

/** Re-renders without notifying the store (pure view-local transitions). */
function redraw(container: HTMLElement): void {
  container.innerHTML = accountViewHtml();
  bind(container);
  applyIcons();
  bindFloatingFields(container);
}

/* --- Change password (in the modal; Supabase Auth updateUser) --- */

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
  if (state.currentErrorKey || state.newPasswordErrorKey || state.confirmErrorKey) {
    redraw(container);
    return;
  }

  state.busy = true;
  redraw(container);
  try {
    await auth.updatePassword(next);
    // Success: close the modal and confirm with the shared toast.
    state.modal = null;
    state.formValues = {};
    state.busy = false;
    redraw(container);
    showToast(t("account.changePasswordSuccess"));
  } catch (error) {
    state.changeErrorKey = mapAuthError(error);
    state.busy = false;
    redraw(container);
  }
}

/** The shared toast (same element/style as the login toast in ui/account). */
function showToast(message: string): void {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

/* --- Logout (existing auth.signOut flow) --- */

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
