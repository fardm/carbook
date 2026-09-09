import type { MessageKey } from "../i18n";

/**
 * Friendly auth error mapping. Raw Supabase/network errors are never shown
 * to users directly — each known case maps to a localized, human message
 * and everything else falls back to a generic one.
 */

/** The keys the account UI can render (all under account.errors.*). */
export type AuthErrorCode =
  | "invalidEmail"
  | "weakPassword"
  | "shortPassword"
  | "emailInUse"
  | "invalidCredentials"
  | "network"
  | "rateLimited"
  | "sessionExpired"
  | "migrationFailed"
  | "generic";

/** Client-side email/password validation (mirrors Supabase's own rules). */
export function validateEmail(email: string): AuthErrorCode | null {
  const value = email.trim();
  if (value === "" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return "invalidEmail";
  }
  return null;
}

export function validatePassword(password: string): AuthErrorCode | null {
  if (password.length < 6) return "shortPassword";
  return null;
}

/**
 * Maps anything thrown by the Supabase client (AuthApiError, AuthRetryableFetchError,
 * PostgrestError, plain Error, unknown) to a user-facing message key. The
 * decision is based on stable markers — status codes and well-known message
 * fragments — never on error text shown to the user.
 */
export function mapAuthError(error: unknown): MessageKey {
  const code = classify(error);
  return `account.errors.${code}` as MessageKey;
}

export function authErrorCode(error: unknown): AuthErrorCode {
  return classify(error);
}

function classify(error: unknown): AuthErrorCode {
  if (isRecord(error)) {
    const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
    const status = typeof error.status === "number" ? error.status : undefined;
    const name = typeof error.name === "string" ? error.name.toLowerCase() : "";

    // Network / infrastructure problems (offline, DNS, timeouts).
    if (
      status === 0 ||
      status === 502 ||
      status === 503 ||
      status === 504 ||
      name.includes("fetch") ||
      name.includes("network") ||
      /network|fetch failed|failed to fetch|timeout|load failed/.test(message)
    ) {
      return "network";
    }

    // Rate limiting.
    if (status === 429 || message.includes("rate limit") || message.includes("too many")) {
      return "rateLimited";
    }

    // Supabase auth error codes (modern SDKs expose `code`).
    const codeProp = typeof error.code === "string" ? error.code : "";
    if (codeProp === "user_already_exists" || /already registered|already exists|user already/.test(message)) {
      return "emailInUse";
    }
    if (codeProp === "invalid_credentials" || /invalid login credentials/.test(message)) {
      return "invalidCredentials";
    }
    if (/email address.*invalid|invalid email|unable to validate email/.test(message)) {
      return "invalidEmail";
    }
    if (codeProp === "weak_password" || /password should be at least|weak password/.test(message)) {
      return "weakPassword";
    }
    if (
      status === 400 &&
      /invalid|malformed/.test(message) &&
      !message.includes("credentials")
    ) {
      return "invalidCredentials";
    }
    if (status === 401) return "invalidCredentials";
    if (status === 422) return "invalidEmail";
  }
  return "generic";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
