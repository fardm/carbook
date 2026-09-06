import { fa, type Messages } from "./fa";
import { en } from "./en";

export { fa, type Messages } from "./fa";

export type Locale = "fa" | "en";

/** Dot-path to every leaf string in the message catalog, e.g. "nav.dashboard". */
export type MessageKey = Paths<Messages>;

type Paths<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : Paths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

type MessageValue<T, P extends string> = P extends `${infer Head}.${infer Tail}`
  ? Head extends keyof T
    ? MessageValue<T[Head], Tail>
    : never
  : P extends keyof T
    ? T[P]
    : never;

/** Deep-merge `override` onto `base`, returning a new object. Only plain
 * objects are merged recursively; all other values are taken from `override`
 * when present, otherwise from `base`. */
function deepMerge<T extends Record<string, unknown>>(base: T, override: Record<string, unknown>): T {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const bv = base[key];
    const ov = override[key];
    if (
      ov !== null &&
      typeof ov === "object" &&
      !Array.isArray(ov) &&
      bv !== null &&
      typeof bv === "object" &&
      !Array.isArray(bv)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        bv as Record<string, unknown>,
        ov as Record<string, unknown>,
      );
    } else {
      (result as Record<string, unknown>)[key] = ov;
    }
  }
  return result;
}

const dictionaries: Record<Locale, Messages> = {
  fa,
  en: deepMerge(fa, en as Record<string, unknown>),
};

let currentLocale: Locale = "fa";

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

/** Returns the localized string for `key` in the active locale. */
export function t<K extends MessageKey>(key: K): MessageValue<Messages, K> {
  return resolve(dictionaries[currentLocale], key) as MessageValue<Messages, K>;
}

function resolve(obj: unknown, path: string): string {
  const value = path
    .split(".")
    .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], obj);
  if (typeof value !== "string") {
    throw new Error(`Missing i18n message: "${path}"`);
  }
  return value;
}
