import { describe, expect, it } from "vitest";
import { fa, t } from "../src/i18n";
import type { MessageKey } from "../src/i18n";

function* walkStrings(obj: unknown, path: string): Generator<[string, string]> {
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const fullPath = path ? `${path}.${key}` : key;
    if (typeof value === "string") {
      yield [fullPath, value];
    } else if (value !== null && typeof value === "object") {
      yield* walkStrings(value, fullPath);
    }
  }
}

describe("i18n catalog", () => {
  it("defines only string leaves with non-empty values", () => {
    for (const [path, value] of walkStrings(fa, "")) {
      expect(value.trim().length, `${path} must not be empty`).toBeGreaterThan(0);
    }
  });

  it("is not empty", () => {
    const entries = [...walkStrings(fa, "")];
    expect(entries.length).toBeGreaterThan(5);
  });

  it("resolves every key via t()", () => {
    const entries = [...walkStrings(fa, "")];
    for (const [path] of entries) {
      expect(t(path as MessageKey), path).toBeTypeOf("string");
    }
  });

  it("throws on an unknown key", () => {
    expect(() => t("does.not.exist" as MessageKey)).toThrow();
  });
});