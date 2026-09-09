import { describe, expect, it } from "vitest";
import {
  authErrorCode,
  mapAuthError,
  passwordsMatch,
  validateEmail,
  validatePassword,
} from "../src/supabase/errors";

/** Builds Supabase-AuthApiError-like objects. */
function authError(message: string, status?: number, code?: string): Error & { status?: number; code?: string } {
  const error = new Error(message) as Error & { status?: number; code?: string };
  error.name = "AuthApiError";
  error.status = status;
  error.code = code;
  return error;
}

describe("client-side validation", () => {
  it("rejects empty and malformed emails", () => {
    expect(validateEmail("")).toBe("invalidEmail");
    expect(validateEmail("plain")).toBe("invalidEmail");
    expect(validateEmail("a@b")).toBe("invalidEmail");
    expect(validateEmail("a b@mail.com")).toBe("invalidEmail");
  });

  it("accepts reasonable emails", () => {
    expect(validateEmail("user@mail.com")).toBeNull();
    expect(validateEmail("  user@mail.com ")).toBeNull();
    expect(validateEmail("user+tag@sub.domain.io")).toBeNull();
  });

  it("rejects passwords shorter than 6 characters", () => {
    expect(validatePassword("12345")).toBe("shortPassword");
    expect(validatePassword("123456")).toBeNull();
  });

  it("requires the confirmation to exactly match the new password", () => {
    expect(passwordsMatch("abc123", "abc123")).toBe(true);
    expect(passwordsMatch("abc123", "abc124")).toBe(false);
    expect(passwordsMatch("abc123", "")).toBe(false);
  });
});

describe("change-password classification", () => {
  it("maps a wrong-current-password update to invalidCredentials", () => {
    // Supabase rejects an updateUser() with a wrong existing password
    // (session reauthentication failed).
    expect(authErrorCode(authError("Invalid login credentials", 400, "invalid_credentials"))).toBe(
      "invalidCredentials",
    );
  });

  it("maps a too-short new password to weakPassword", () => {
    expect(
      authErrorCode(authError("New password should be at least 6 characters", 422, "weak_password")),
    ).toBe("weakPassword");
  });

  it("maps a missing/expired session to invalidCredentials (401)", () => {
    expect(authErrorCode(authError("no session", 401))).toBe("invalidCredentials");
  });
});

describe("mapAuthError — Supabase auth failures", () => {
  it("maps an existing account (sign-up) to emailInUse", () => {
    expect(authErrorCode(authError("User already registered", 422))).toBe("emailInUse");
    expect(authErrorCode(authError("any", 422, "user_already_exists"))).toBe("emailInUse");
  });

  it("maps wrong credentials (sign-in) to invalidCredentials", () => {
    expect(authErrorCode(authError("Invalid login credentials", 400, "invalid_credentials"))).toBe(
      "invalidCredentials",
    );
    expect(authErrorCode(authError("Invalid login credentials", 400))).toBe("invalidCredentials");
    expect(authErrorCode(authError("any", 401))).toBe("invalidCredentials");
  });

  it("maps invalid email to invalidEmail", () => {
    expect(authErrorCode(authError("Unable to validate email address: invalid format", 422))).toBe(
      "invalidEmail",
    );
  });

  it("maps weak password to weakPassword", () => {
    expect(authErrorCode(authError("Password should be at least 8 characters", 422, "weak_password"))).toBe(
      "weakPassword",
    );
  });

  it("maps network failures to network", () => {
    expect(authErrorCode(authError("Failed to fetch", 0))).toBe("network");
    expect(authErrorCode(authError(" Network connection lost ", 503))).toBe("network");
    const retry = new Error("fetch failed");
    retry.name = "AuthRetryableFetchError";
    expect(authErrorCode(retry)).toBe("network");
  });

  it("maps rate limiting to rateLimited", () => {
    expect(authErrorCode(authError("Too many requests", 429))).toBe("rateLimited");
  });

  it("never leaks raw error text — output is always a known i18n key", () => {
    const key = mapAuthError(new Error("secret internal detail: db=xyz pass=hunter2"));
    expect(key).toMatch(/^account\.errors\.(invalidEmail|weakPassword|shortPassword|emailInUse|invalidCredentials|network|rateLimited|sessionExpired|migrationFailed|generic)$/);
    expect(key).toBe("account.errors.generic");
  });

  it("handles non-Error garbage without crashing", () => {
    expect(mapAuthError(undefined)).toBe("account.errors.generic");
    expect(mapAuthError(42)).toBe("account.errors.generic");
    expect(mapAuthError({ message: "Failed to fetch" })).toBe("account.errors.network");
  });
});
