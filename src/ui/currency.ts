import type { Currency } from "../domain/types";
import { t, type MessageKey } from "../i18n";

const CURRENCY_KEYS: Record<Currency, MessageKey> = {
  IRR: "settings.currencyIrr",
  USD: "settings.currencyUsd",
  EUR: "settings.currencyEur",
};

/** Localized label of the currency setting (تومان / دلار / یورو). Used to
 * label service costs at entry and display — the setting never converts
 * amounts, it only picks the unit they are recorded and shown in. */
export function currencyLabel(currency: Currency): string {
  return t(CURRENCY_KEYS[currency]);
}