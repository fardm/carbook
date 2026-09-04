import { t } from "../i18n";
import { renderPlaceholder } from "../ui/placeholder";

export function renderHistory(container: HTMLElement): void {
  renderPlaceholder(container, {
    icon: "history",
    title: t("view.history.title"),
    description: t("view.history.description"),
  });
}