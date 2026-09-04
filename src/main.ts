import { t } from "./i18n";
import { applyIcons } from "./ui/icons";
import { routes, parseHash, type RouteId } from "./ui/router";
import { registerThemeSync } from "./ui/theme";
import { renderView } from "./views";

import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";

function renderNav(): void {
  const nav = document.getElementById("app-nav");
  if (!nav) return;
  // Desktop-only brand header (logo + app name at the top of the sidebar;
  // hidden on mobile where the .app-bar header shows it instead). Items
  // live in an inner .nav__list so the mobile bottom bar and the desktop
  // sidebar can size/lay them out independently of the shell (the desktop
  // <nav> keeps height: 100dvh while .nav__list is content-sized).
  nav.innerHTML = `
    <div class="nav__brand">
      <img class="app-bar__icon" src="./favicon.svg" alt="" width="24" height="24" />
      <span class="app-bar__titles">
        <span class="app-bar__title-main" id="nav-brand-title"></span>
        <span class="app-bar__subtitle" id="nav-brand-subtitle"></span>
      </span>
    </div>
    <div class="nav__list">
      ${routes
        .map(
          (route) => `
            <a class="nav__item" href="#${route.hash}" data-route="${route.id}">
              <span data-lucide="${route.icon}"></span>
              <span>${t(`nav.${route.id}` as const)}</span>
            </a>
          `,
        )
        .join("")}
    </div>
  `;
  applyIcons();
}

/** Fills the mobile header and desktop sidebar brand (main title +
 * subtitle) from the shared catalog. */
function setAppTitles(): void {
  const pairs: Array<[string | null, string | null]> = [
    ["app-title", "app-subtitle"],
    ["nav-brand-title", "nav-brand-subtitle"],
  ];
  for (const [titleId, subtitleId] of pairs) {
    const titleEl = titleId ? document.getElementById(titleId) : null;
    const subtitleEl = subtitleId ? document.getElementById(subtitleId) : null;
    if (titleEl) titleEl.textContent = t("app.title");
    if (subtitleEl) subtitleEl.textContent = t("app.subtitle");
  }
}

function setActiveNav(routeId: RouteId): void {
  document.querySelectorAll<HTMLElement>(".nav__item").forEach((item) => {
    if (item.dataset.route === routeId) {
      item.setAttribute("aria-current", "page");
    } else {
      item.removeAttribute("aria-current");
    }
  });
}

let disposeView: (() => void) | undefined;

function render(): void {
  const routeId = parseHash(window.location.hash);
  const container = document.getElementById("app-content");
  if (!container) return;
  // Leave the previous view: unsubscribe it from the store before swapping.
  disposeView?.();
  disposeView = renderView(routeId, container) ?? undefined;
  setActiveNav(routeId);
  applyIcons();
}

function boot(): void {
  registerThemeSync();
  renderNav();
  setAppTitles();
  render();
  window.addEventListener("hashchange", render);
  registerServiceWorker();
}

/**
 * Registers the offline service worker (§44). Production builds only — the
 * Vite dev server serves source modules and must never be cached. The first
 * load works normally; the worker (public/sw.js) precaches the shell so
 * subsequent loads run offline.
 */
function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js").catch(() => {
      console.warn("[pwa] Service worker registration failed.");
    });
  });
}

boot();