import { t } from "../i18n";

export interface PlaceholderOptions {
  icon: string;
  title: string;
  description: string;
}

/** HTML for the scaffolding placeholder, composable with other content. */
export function placeholderHtml(options: PlaceholderOptions): string {
  const badge = t("placeholder.badge");
  const notImplemented = t("placeholder.notImplemented");
  return `
    <section class="placeholder">
      <span class="placeholder__icon" data-lucide="${options.icon}"></span>
      <h1 class="placeholder__title">${options.title}</h1>
      <p class="placeholder__text">${options.description}</p>
      <span class="placeholder__badge">${badge}</span>
      <p class="placeholder__text">${notImplemented}</p>
    </section>
  `;
}

/** Renders the Phase 1 scaffolding placeholder into `container`. */
export function renderPlaceholder(container: HTMLElement, options: PlaceholderOptions): void {
  container.innerHTML = placeholderHtml(options);
}