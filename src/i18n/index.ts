import { fa, type Messages } from "./fa";

export { fa, type Messages } from "./fa";

export type Locale = "fa";

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

const dictionaries: Record<Locale, Messages> = { fa };

const currentLocale: Locale = "fa";

/** Returns the localized string for `key`. Persian is the only locale in the MVP. */
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