/*
 * Service worker — offline app shell (§44) + reminder notifications.
 *
 * Strategy: CACHE-FIRST for every same-origin GET, with the full shell
 * (index.html, hashed JS/CSS, fonts, favicon.svg) precached at install.
 * The FIRST visit still works normally (a service worker cannot control the
 * page that registers it); install fetches the shell + its assets so the
 * SECOND load onward is fully offline-capable.
 *
 * Notifications: the page calls registration.showNotification() when a
 * reminder fires; this worker handles notificationclick to focus/open the
 * app. There is no separate worker — offline + notifications share this file.
 *
 * Notes:
 * - Data stays in localStorage and is NEVER cached here — a stale asset
 *   cache must never look like the source of truth.
 * - The `CACHE` name is the release version: bump it when deploying new
 *   assets so old hashed files are evicted (see activate handler).
 * - Works from any sub-path (GitHub Pages): all URLs are relative to the
 *   worker scope, so `./` resolution is scope-relative.
 */
const CACHE = "car-maintenance-shell-v7";

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith("car-maintenance-shell-") && key !== CACHE).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch external calls
  // Page navigations: network-first. A cache-first shell would serve the
  // PREVIOUS release's index.html on a plain refresh (F5), which loads the
  // old hashed JS bundle — while a hard refresh (bypassing the worker) got
  // the fresh one. Network-first keeps F5 current; the cache is the offline
  // fallback only.
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

/** Focus an open CarBook window, or open the reminders route. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL("./#/reminders", self.location.href).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if ("focus" in client) {
          if ("navigate" in client) {
            try {
              await client.navigate(targetUrl);
            } catch {
              /* navigate may be blocked; focusing is still useful */
            }
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })(),
  );
});

/** Precache the shell document and every asset it references. */
async function precache() {
  const cache = await caches.open(CACHE);
  const shell = "./index.html";
  try {
    const htmlResponse = await fetch(shell);
    const html = await htmlResponse.clone().text();
    await cache.put(shell, htmlResponse);
    const assetUrls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((ref) => ref && !ref.startsWith("#") && !ref.startsWith("data:") && !/^https?:/.test(ref));
    // Also cache the fonts the CSS references (public/fonts keeps its names).
    const cssUrls = assetUrls.filter((ref) => ref.endsWith(".css"));
    for (const cssUrl of cssUrls) {
      try {
        const css = await (await fetch(cssUrl)).text();
        const fontUrls = [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]);
        for (const font of fontUrls) {
          const absolute = new URL(font, new URL(cssUrl, self.location.href)).href;
          const response = await fetch(absolute);
          if (response.ok) await cache.put(absolute, response);
        }
      } catch {
        /* a CSS asset failing to precache must not block the shell */
      }
    }
    await Promise.all(
      assetUrls.map((ref) =>
        fetch(ref).then((response) => {
          if (response.ok) cache.put(ref, response.clone());
        }),
      ).map((p) => p.catch(() => undefined)),
    );
  } catch {
    /* offline during first install: the shell is cached next time */
  }
}

/** Network-first for navigations: fresh shell when online, cached shell
 * when offline. The fresh document is stored so the next offline load
 * still boots. */
async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put("./index.html", response.clone());
    return response;
  } catch {
    const cached = (await cache.match(request)) ?? (await cache.match("./index.html"));
    if (cached) return cached;
    return Response.error();
  }
}

/** Serve from cache; on a miss fetch + store (cache-first). */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Network is down and the asset was never cached: for page navigations
    // fall back to the shell so the app still boots offline.
    if (request.mode === "navigate") {
      const shell = await cache.match("./index.html");
      if (shell) return shell;
    }
    return Response.error();
  }
}
