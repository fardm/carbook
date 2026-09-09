import { t } from "../i18n";
import { applyIcons } from "../ui/icons";
import { bindFloatingFields } from "../ui/floating-field";
import { escHtml } from "../ui/escape";
import { hashFor } from "../ui/router";
import { auth } from "../supabase/auth";
import { mapAuthError, validateEmail, validatePassword } from "../supabase/errors";
import { afterAuthenticated } from "../views/account";

/**
 * Account entry point — the single account button in the navigation
 * (mobile bottom bar + desktop sidebar).
 *
 * The button ALWAYS reads «حساب کاربری» (label never changes with auth
 * state):
 *   - Guest: opens the account modal with Sign in / Sign up tabs (the only
 *     remaining role of the modal — the authenticated modal was removed;
 *     signed-in users get the dedicated Account page at #/account instead).
 *   - Authenticated: navigates to the Account page like any other route.
 *
 * Guest→cloud migration: right after signing in, if the local guest dataset
 * holds meaningful data, a one-time offer appears on the Account page
 * (see views/account.ts). The local data is NEVER deleted — only read for
 * the upload.
 */

/* ------------------------------------------------------------------ */
/* Navigation entry (rendered by main.ts renderNav)                    */
/* ------------------------------------------------------------------ */

/**
 * The account navigation item markup appended to .nav__list. One markup for
 * BOTH auth states: identical label and icon, so the nav never changes
 * appearance on login/logout. It is a <button> (not a route link) because
 * the guest click must open the modal instead of navigating — but it carries
 * data-route="account" so the shared setActiveNav() in main.ts marks it
 * aria-current exactly like the other (route-link) items while the Account
 * page is open. Same mobile active state, zero extra CSS.
 */
export function navAccountItemHtml(): string {
  return `
    <button type="button" class="nav__item nav__item--account js-nav-account"
      data-route="account"
      aria-label="${t("nav.account")}">
      <span data-lucide="circle-user-round"></span>
      <span>${t("nav.account")}</span>
    </button>
  `;
}

/* ------------------------------------------------------------------ */
/* Modal (sign in / sign up — signed-out users only)                   */
/* ------------------------------------------------------------------ */

type Mode = "signIn" | "signUp";

interface AccountUiState {
  mode: Mode;
  busy: boolean;
  /** i18n key of the last auth error; null = hidden. */
  errorKey: string | null;
  /** Field-level validation error keys. */
  emailErrorKey: string | null;
  passwordErrorKey: string | null;
}

const state: AccountUiState = {
  mode: "signIn",
  busy: false,
  errorKey: null,
  emailErrorKey: null,
  passwordErrorKey: null,
};

let modalOpen = false;
let unsubscribeAuth: (() => void) | null = null;
let outsideClickListener: ((event: MouseEvent) => void) | null = null;

/**
 * Nav button click. Authenticated → go to the dedicated Account page
 * (normal route navigation); guest → open the login/signup modal.
 */
export function onNavAccountClicked(): void {
  if (auth.getUser()) {
    window.location.hash = hashFor("account");
    return;
  }
  openAccountModal();
}

/** Opens the account modal (from the nav button, guests only). */
export function openAccountModal(): void {
  if (modalOpen) return;
  modalOpen = true;
  state.errorKey = null;
  state.emailErrorKey = null;
  state.passwordErrorKey = null;
  drawModal();
  unsubscribeAuth = auth.subscribe(() => {
    state.errorKey = null;
    drawModal();
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

/* ------------------------------------------------------------------ */
/* Rendering (sign in / sign up only)                                  */
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

function drawModal(): void {
  const overlay = ensureOverlay();
  overlay.innerHTML = unauthenticatedModalHtml();
  bindModal(overlay);
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

  return `
    <div class="modal account-modal" role="dialog" aria-modal="true" aria-label="${t("account.title")}">
      <div class="modal__head">
        <div class="form__title">${t("account.title")}</div>
        <button type="button" class="icon-btn js-account-close" aria-label="${t("common.close")}">
          <span data-lucide="x"></span>
        </button>
      </div>
      ${tabs}
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
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function bindModal(overlay: HTMLElement): void {
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
  drawModal();
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
    drawModal();
    return;
  }

  state.busy = true;
  state.errorKey = null;
  drawModal();
  let loginSucceeded = false;
  try {
    if (state.mode === "signUp") {
      await auth.signUp(email, password);
      // With "Confirm email" disabled (project setting), signUp returns an
      // active session and the user enters the app immediately.
      if (auth.getUser()) {
        await afterAuthenticated();
        loginSucceeded = true;
      }
    } else {
      await auth.signIn(email, password);
      await afterAuthenticated();
      loginSucceeded = true;
    }
  } catch (error) {
    state.errorKey = mapAuthError(error);
  } finally {
    state.busy = false;
    if (loginSucceeded) {
      closeAccountModal();
      showLoginToast();
      // Enter the app on the Account page: it carries the one-time
      // guest→cloud migration offer (when guest data exists) plus the new
      // account management actions.
      window.location.hash = hashFor("account");
    } else {
      drawModal();
    }
  }
}

/** The toast shown right after a successful sign-in/sign-up. */
function showLoginToast(): void {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = t("account.loginSuccess");
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3000);
}