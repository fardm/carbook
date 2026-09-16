/**
 * Register the CarBook root-scoped Service Worker (/sw.js) for PWA installability and offline caching.
 *
 * In production, registering the service worker on public entry points (landing, blog)
 * satisfies browser PWA installability criteria across Android Chrome, Edge, and Samsung Internet,
 * allowing users to install CarBook directly from any page.
 */
export function registerServiceWorker(): void {
  if (typeof window !== "undefined" && "serviceWorker" in navigator) {
    if (import.meta.env.PROD) {
      const register = () => {
        navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
          /* Service worker registration failure is non-fatal */
        });
      };

      if (document.readyState === "complete") {
        register();
      } else {
        window.addEventListener("load", register, { once: true });
      }
    }
  }
}
