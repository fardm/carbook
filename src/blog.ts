/**
 * Minimal client-side router for the Blog placeholder (/blog and /blog/:slug).
 * Handles direct loads, client-side history navigation, and SPA redirects from 404.html.
 */

export function parseBlogRoute(pathname: string, search: string): { type: "index" | "post"; slug?: string } {
  // Check if redirected from 404 fallback with ?slug=...
  const params = new URLSearchParams(search);
  const querySlug = params.get("slug");
  if (querySlug) {
    return { type: "post", slug: decodeURIComponent(querySlug) };
  }

  const cleaned = pathname.replace(/\/+$/, ""); // remove trailing slashes
  const match = cleaned.match(/^\/blog\/(.+)$/);
  if (match && match[1]) {
    return { type: "post", slug: decodeURIComponent(match[1]) };
  }

  return { type: "index" };
}

function renderBlog(): void {
  const appEl = document.getElementById("blog-app");
  if (!appEl) return;

  const route = parseBlogRoute(window.location.pathname, window.location.search);

  // If arrived via query parameter fallback, clean up the address bar to clean /blog/:slug
  if (window.location.search.includes("slug=") && route.slug) {
    window.history.replaceState(null, "", `/blog/${encodeURIComponent(route.slug)}`);
  }

  if (route.type === "post" && route.slug) {
    document.title = `CarBook — Blog: ${route.slug}`;
    appEl.innerHTML = `
      <div class="container">
        <h1>CarBook — Blog: ${escapeHtml(route.slug)}</h1>
        <p>صفحه موقت نمایش مقاله با شناسه: <code>${escapeHtml(route.slug)}</code></p>
        <div class="nav-links">
          <a class="btn btn--secondary" href="/blog" data-link>بازگشت به وبلاگ</a>
          <a class="btn btn--primary" href="/app">ورود به برنامه</a>
        </div>
      </div>
    `;
  } else {
    document.title = "CarBook — Blog";
    appEl.innerHTML = `
      <div class="container">
        <h1>CarBook — Blog</h1>
        <p>بخش وبلاگ کاربوک در دست ساخت است.</p>
        <div class="sample-links">
          <p style="margin-bottom: 8px; font-weight: 500;">مسیرهای تستی وبلاگ:</p>
          <ul style="list-style: none; padding: 0; margin: 0 0 20px;">
            <li style="margin: 6px 0;"><a href="/blog/welcome-to-carbook" data-link>/blog/welcome-to-carbook</a></li>
            <li style="margin: 6px 0;"><a href="/blog/maintenance-tips" data-link>/blog/maintenance-tips</a></li>
          </ul>
        </div>
        <div class="nav-links">
          <a class="btn btn--primary" href="/app">ورود به برنامه</a>
          <a class="btn btn--secondary" href="/">صفحه اصلی</a>
        </div>
      </div>
    `;
  }

  bindLinks(appEl);
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function bindLinks(container: HTMLElement): void {
  container.querySelectorAll<HTMLAnchorElement>("a[data-link]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const href = link.getAttribute("href");
      if (href) {
        window.history.pushState(null, "", href);
        renderBlog();
      }
    });
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", renderBlog);

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", renderBlog);
    } else {
      renderBlog();
    }
  }
}
