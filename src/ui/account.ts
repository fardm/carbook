import { t } from "../i18n";
import { applyIcons } from "../ui/icons";
import { bindFloatingFields } from "../ui/floating-field";
import { escHtml } from "../ui/escape";
import { store } from "../state/store";
import { auth, type AccountUser } from "../supabase/auth";
import { getSupabase } from "../supabase/client";
import { mapAuthError, validateEmail, validatePassword } from "../supabase/errors";
import {
  applyAuthState,
  currentGuestRepository,
  reloadActiveRepository,
} from "../supabase/data-source";
import { hasMeaningfulData, countDataset, type DatasetCounts } from "../supabase/cloud-dataset";
import { migrateGuestDataToCloud } from "../supabase/migration";

/**
 * Account UI — the single account entry point in the navigation.
 *
 * Unauthenticated: a user button (mobile bottom bar + desktop sidebar)
 * opens the account modal with Sign in / Sign up tabs.
 * Authenticated: the button becomes a logout icon; the modal shows the
 * account email and the logout action. After logout the app switches back
 * to guest mode immediately — the previous user's cloud data is never
 * rendered (the repository swap is atomic) and never copied into IndexedDB.
 *
 * Guest→cloud migration: right after signing in, if the local guest dataset
 * holds meaningful data, a one-time offer appears inside the modal. The
 * local data is NEVER deleted — only read for the upload.
 */

/* ------------------------------------------------------------------ */
/* State (module-local, like the other views)                          */
/* ------------------------------------------------------------------ */

type Mode = "signIn" | "signUp";
type MigrationChoice = "pending" | "accepted" | "declined";

interface AccountUiState {
  mode: Mode;
  busy: boolean;
  /** i18n key of the last auth error; null = hidden. */
  errorKey: string | null;
  /** Field-level validation error keys. */
  emailErrorKey: string | null;
  passwordErrorKey: string | null;
  /** Successful sign-up without a session (email confirmation required). */
  confirmationSent: boolean;
  /** Logout confirmation step. */
  confirmLogout: boolean;
  /** Migration offer state after a successful sign-in. */
  migration: (MigrationChoice | "offer") | null;
  migrationCounts: DatasetCounts | null;
  migrationErrorKey: string | null;
}

const state: AccountUiState = {
  mode: "signIn",
  busy: false,
  errorKey: null,
  emailErrorKey: null,
  passwordErrorKey: null,
  confirmationSent: false,
  confirmLogout: false,
  migration: null,
  migrationCounts: null,
  migrationErrorKey: null,
};

/* ------------------------------------------------------------------ */
/* Navigation entry (rendered by main.ts renderNav)                    */
/* ------------------------------------------------------------------ */

/** The account/logout navigation item markup appended to .nav__list. */
export function navAccountItemHtml(user: AccountUser | null): string {
  if (user) {
    return `
      <button type="button" class="nav__item nav__item--account js-nav-logout"
        aria-label="${t("nav.account")}">
        <span data-lucide="log-out"></span>
        <span>${t("account.logoutButton")}</span>
      </button>
    `;
  }
  return `
    <button type="button" class="nav__item nav__item--account js-nav-account"
      aria-haspopup="dialog" aria-label="${t("nav.account")}">
      <span data-lucide="circle-user-round"></span>
      <span>${t("nav.account")}</span>
    </button>
  `;
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

let modalOpen = false;
let unsubscribeAuth: (() => void) | null = null;
let outsideClickListener: ((event: MouseEvent) => void) | null = null;

/** Opens the account modal (from the nav button). */
export function openAccountModal(): void {
  if (modalOpen) return;
  modalOpen = true;
  state.errorKey = null;
  state.emailErrorKey = null;
  state.passwordErrorKey = null;
  state.confirmLogout = false;
  const user = auth.getUser();
  // After a fresh sign-in the migration offer (if any) is shown here.
  drawModal(user);
  unsubscribeAuth = auth.subscribe(() => {
    state.errorKey = null;
    state.confirmLogout = false;
    drawModal(auth.getUser());
  });
}

export function closeAccountModal(): void {
  if (!modalOpen) return;
  modalOpen = false;
  const overlay = document.getElementById("account-overlay");
  if (overlay) overlay.remove();
  unsubscribeAuth?.();
  unsubscribeAuth = null;
  if (outsideClickListener) {
    document.removeEventListener("mousedown", outsideClickListener);
    outsideClickListener = null;
  }
}

export function isAccountModalOpen(): boolean {
  return modalOpen;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function ensureOverlay(): HTMLElement {
  let overlay = document.getElementById("account-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "account-overlay";
    overlay.className = "modal-overlay account-overlay";
    document.body.appendChild(overlay);
  }
  return overlay;
}

function drawModal(user: AccountUser | null): void {
  const overlay = ensureOverlay();
  overlay.innerHTML = user ? authenticatedModalHtml(user) : unauthenticatedModalHtml();
  bindModal(overlay, user);
  applyIcons();
  bindFloatingFields(overlay);
}

/** Modal body while signed out: sign in / sign up (switchable in place). */
function unauthenticatedModalHtml(): string {
  const tabs = `
    <div class="account-tabs" role="tablist">
      <button type="button" role="tab" aria-selected="${state.mode === "signIn"}"
        class="account-tabs__tab js-tab-sign-in ${state.mode === "signIn" ? "account-tabs__tab--active" : ""}">
        ${t("account.signInTab")}
      </button>
      <button type="button" role="tab" aria-selected="${state.mode === "signUp"}"
        class="account-tabs__tab js-tab-sign-up ${state.mode === "signUp" ? "account-tabs__tab--active" : ""}">
        ${t("account.signUpTab")}
      </button>
    </div>
  `;
  const isSignUp = state.mode === "signUp";
  const submitLabel = isSignUp ? t("account.signUpButton") : t("account.signInButton");
  const errorHtml = state.errorKey
    ? `<div class="box box--error account-error" role="alert"><span data-lucide="circle-alert"></span><span>${escHtml(t(state.errorKey as never))}</span></div>`
    : "";
  const emailError = state.emailErrorKey
    ? `<p class="field__error">${escHtml(t(state.emailErrorKey as never))}</p>`
    : "";
  const passwordError = state.passwordErrorKey
    ? `<p class="field__error">${escHtml(t(state.passwordErrorKey as never))}</p>`
    : "";
  const confirmationHtml = state.confirmationSent
    ? `<div class="box box--success" role="status"><span data-lucide="circle-check"></span><span>${escHtml(t("account.emailConfirmationSent"))}</span></div>`
    : "";

  return `
    <div class="modal account-modal" role="dialog" aria-modal="true" aria-label="${t("account.title")}">
      <div class="modal__head">
        <div class="form__title">${t("account.title")}</div>
        <button type="button" class="icon-btn js-account-close" aria-label="${t("common.close")}">
          <span data-lucide="x"></span>
        </button>
      </div>
      ${tabs}
      ${confirmationHtml}
      ${errorHtml}
      <form class="form account-form" novalidate>
        <div class="field">
          <label class="field__label" for="account-email">${t("account.emailLabel")}</label>
          <input class="field__input" id="account-email" name="email" type="email" dir="ltr"
            autocomplete="email" placeholder="${t("account.emailPlaceholder")}" />
          ${emailError}
        </div>
        <div class="field">
          <label class="field__label" for="account-password">${t("account.passwordLabel")}</label>
          <input class="field__input" id="account-password" name="password" type="password" dir="ltr"
            autocomplete="${isSignUp ? "new-password" : "current-password"}"
            placeholder="${t("account.passwordPlaceholder")}" />
          ${passwordError}
        </div>
        <div class="form__actions">
          <button type="button" class="btn btn--text js-account-close">${t("common.cancel")}</button>
          <button type="submit" class="btn btn--filled js-account-submit" ${state.busy ? "disabled" : ""}>
            ${state.busy ? `<span class="account-spinner" data-lucide="loader-circle"></span>${t("account.working")}` : submitLabel}
          </button>
        </div>
      </form>
      <p class="account-note">${t("account.storageGuestNote")}</p>
    </div>
  `;
}

/** Modal body while signed in: email + logout (+ one-time migration offer). */
function authenticatedModalHtml(user: AccountUser): string {
  const logoutHtml = state.confirmLogout
    ? `
      <div class="box box--warn account-logout-confirm" role="alert">
        <span>${escHtml(t("account.logoutConfirm"))}</span>
        <span class="account-logout-confirm__note">${escHtml(t("account.logoutKeepCloudNote"))}</span>
        <div class="form__actions">
          <button type="button" class="btn btn--text js-logout-cancel">${t("common.cancel")}</button>
          <button type="button" class="btn btn--danger js-logout-confirm">${t("account.logoutButton")}</button>
        </div>
      </div>
    `
    : "";
  const migrationHtml = migrationHtmlSection();
  return `
    <div class="modal account-modal" role="dialog" aria-modal="true" aria-label="${t("account.signedInTitle")}">
      <div class="modal__head">
        <div class="form__title">${t("account.signedInTitle")}</div>
        <button type="button" class="icon-btn js-account-close" aria-label="${t("common.close")}">
          <span data-lucide="x"></span>
        </button>
      </div>
      <div class="account-profile">
        <span class="account-profile__avatar" data-lucide="circle-user-round" aria-hidden="true"></span>
        <span class="account-profile__email" dir="ltr">${escHtml(user.email)}</span>
      </div>
      ${migrationHtml}
      ${logoutHtml}
      <div class="form__actions account-actions">
        <button type="button" class="btn btn--text js-account-close">${t("common.close")}</button>
        <button type="button" class="btn btn--danger-text js-logout-start">
          <span data-lucide="log-out"></span>
          ${t("account.logoutButton")}
        </button>
      </div>
    </div>
  `;
}

/** The one-time guest→cloud migration offer (after a fresh sign-in). */
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
        <button type="button" class="btn btn--text js-migration-decline">${t("account.migrationDecline")}</button>
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

function bindModal(overlay: HTMLElement, user: AccountUser | null): void {
  overlay.querySelectorAll(".js-account-close").forEach((button) => {
    button.addEventListener("click", closeAccountModal);
  });

  // Click on the dark overlay itself closes the modal (like other modals).
  if (!outsideClickListener) {
    outsideClickListener = (event: MouseEvent) => {
      if (event.target === overlay) closeAccountModal();
    };
    overlay.addEventListener("mousedown", outsideClickListener);
  }

  if (user == null) {
    bindAuthForm(overlay);
    return;
  }

  overlay.querySelector(".js-logout-start")?.addEventListener("click", () => {
    state.confirmLogout = true;
    drawModal(user);
  });
  overlay.querySelector(".js-logout-cancel")?.addEventListener("click", () => {
    state.confirmLogout = false;
    drawModal(user);
  });
  overlay.querySelector(".js-logout-confirm")?.addEventListener("click", () => {
    void performLogout();
  });
  overlay.querySelector(".js-migration-accept")?.addEventListener("click", () => {
    void performMigration(user.id);
  });
  overlay.querySelector(".js-migration-decline")?.addEventListener("click", () => {
    state.migration = "declined";
    drawModal(user);
  });
}

function bindAuthForm(overlay: HTMLElement): void {
  overlay.querySelector(".js-tab-sign-in")?.addEventListener("click", () => {
    switchMode("signIn");
  });
  overlay.querySelector(".js-tab-sign-up")?.addEventListener("click", () => {
    switchMode("signUp");
  });
  const form = overlay.querySelector<HTMLFormElement>(".account-form");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitAuthForm(form);
  });
}

function switchMode(mode: Mode): void {
  state.mode = mode;
  state.errorKey = null;
  state.emailErrorKey = null;
  state.passwordErrorKey = null;
  drawModal(null);
  document.getElementById("account-email")?.focus();
}

async function submitAuthForm(form: HTMLFormElement): Promise<void> {
  const emailInput = form.querySelector<HTMLInputElement>("#account-email");
  const passwordInput = form.querySelector<HTMLInputElement>("#account-password");
  const email = emailInput?.value ?? "";
  const password = passwordInput?.value ?? "";

  // Client-side validation first (friendly, immediate).
  state.emailErrorKey = validateEmail(email) ? "account.errors.invalidEmail" : null;
  state.passwordErrorKey = validatePassword(password) ? "account.errors.shortPassword" : null;
  if (state.emailErrorKey || state.passwordErrorKey) {
    state.errorKey = null;
    drawModal(null);
    return;
  }

  state.busy = true;
  state.errorKey = null;
  drawModal(null);
  try {
    if (state.mode === "signUp") {
      await auth.signUp(email, password);
      // Email-confirmation projects keep the user signed out here.
      if (auth.getUser()) {
        await afterAuthenticated();
      } else {
        state.confirmationSent = true;
      }
    } else {
      await auth.signIn(email, password);
      await afterAuthenticated();
    }
  } catch (error) {
    state.errorKey = mapAuthError(error);
  } finally {
    state.busy = false;
    drawModal(auth.getUser());
  }
}

/** Runs once after a successful sign-in: swap the data layer to the cloud
 * backend, then prepare the one-time migration offer if guest data exists. */
async function afterAuthenticated(): Promise<void> {
  const user = auth.getUser();
  if (!user) return;
  // Snapshot the GUEST dataset from IndexedDB before the store swaps to the
  // cloud backend (afterAuthenticated runs while still on the guest repo).
  const guestSnapshot = store.get();
  await currentGuestRepository().flush?.();
  // Swap the store to the user's Supabase repository.
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

/* Snapshot kept for the migration flow (module-local, one sign-in at a time). */
let lastGuestSnapshot: ReturnType<typeof store.get> | null = null;

async function performMigration(userId: string): Promise<void> {
  const client = getSupabase();
  const dataset = lastGuestSnapshot;
  if (!client || !dataset) {
    state.migration = "declined";
    drawModal(auth.getUser());
    return;
  }
  state.busy = true;
  drawModal(auth.getUser());
  const result = await migrateGuestDataToCloud(client, userId, dataset);
  state.busy = false;
  if (result.status === "migrated") {
    state.migration = "accepted";
    state.migrationErrorKey = null;
    // Reload the store from the cloud so the migrated rows are visible.
    await reloadActiveRepository();
    closeAccountModal();
  } else if (result.status === "conflict") {
    state.migration = "declined";
    state.migrationErrorKey = "account.migrationConflict";
  } else if (result.status === "error") {
    // Keep the offer open for retry; local data is untouched.
    state.migrationErrorKey = "account.errors.migrationFailed";
  } else {
    state.migration = "declined";
  }
  drawModal(auth.getUser());
}

async function performLogout(): Promise<void> {
  try {
    await auth.signOut();
    // onAuthStateChange → auth subscribers → applyAuthState() swaps the
    // store back to IndexedDB; the modal closes on the auth event.
    closeAccountModal();
  } catch (error) {
    state.confirmLogout = false;
    state.errorKey = mapAuthError(error);
    drawModal(auth.getUser());
  }
}
