/**
 * CarBook Blog Application
 * Handles client-side routing, article listing with categories & sorting,
 * single article rendering with sticky TOC & scroll spy, theme toggling, and SEO.
 */

import { ICON_ASSETS, applyIcons } from "./ui/icons";
import { getAllArticles, getArticleBySlug, getCategories } from "./blog/articles";
import { updateBlogIndexSeo, updateArticleSeo } from "./blog/seo";

// State
let currentCategory = "همه مقالات";
let currentSort: "newest" | "oldest" = "newest";
let tocObserver: IntersectionObserver | null = null;

export function parseBlogRoute(
  pathname: string,
  search: string
): { type: "index" | "post"; slug?: string } {
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

function initTheme(): void {
  const themeToggle = document.getElementById("theme-toggle");
  if (!themeToggle) return;

  const getTheme = (): "dark" | "light" => {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  };

  const updateThemeUI = (theme: "dark" | "light") => {
    const iconName = theme === "dark" ? "moon" : "sun";
    const label =
      theme === "dark"
        ? "حالت تیره (کلیک برای تغییر به حالت روشن)"
        : "حالت روشن (کلیک برای تغییر به حالت تیره)";
    themeToggle.setAttribute("aria-label", label);
    themeToggle.setAttribute("title", label);

    const svgMarkup = ICON_ASSETS[iconName];
    if (svgMarkup) {
      themeToggle.innerHTML = svgMarkup;
      const svg = themeToggle.querySelector("svg");
      if (svg) {
        svg.setAttribute("class", "theme-toggle__svg");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("width", "20");
        svg.setAttribute("height", "20");
      }
    }
  };

  updateThemeUI(getTheme());

  themeToggle.addEventListener("click", () => {
    const current = getTheme();
    const next = current === "dark" ? "light" : "dark";
    if (next === "dark") {
      document.documentElement.dataset.theme = "dark";
    } else {
      delete document.documentElement.dataset.theme;
    }
    try {
      localStorage.setItem("carbook-landing-theme", next);
    } catch {
      /* ignore */
    }
    updateThemeUI(next);
  });
}

function initMobileMenu(): void {
  const toggleBtn = document.getElementById("menu-toggle");
  const drawer = document.getElementById("mobile-drawer");
  const backdrop = document.getElementById("mobile-nav-backdrop");
  const closeBtn = document.getElementById("drawer-close");
  if (!toggleBtn || !drawer) return;

  const setOpen = (open: boolean) => {
    drawer.classList.toggle("is-open", open);
    if (backdrop) backdrop.classList.toggle("is-open", open);
    toggleBtn.setAttribute("aria-expanded", String(open));
    toggleBtn.setAttribute("aria-label", open ? "بستن منو" : "باز کردن منو");
    drawer.setAttribute("aria-hidden", String(!open));
    document.body.classList.toggle("drawer-open", open);
  };

  toggleBtn.addEventListener("click", () => {
    const isOpen = drawer.classList.contains("is-open");
    setOpen(!isOpen);
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", () => setOpen(false));
  }

  if (backdrop) {
    backdrop.addEventListener("click", () => setOpen(false));
  }

  drawer.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setOpen(false));
  });

  document.addEventListener("click", (e) => {
    if (!drawer.classList.contains("is-open")) return;
    const target = e.target as Node | null;
    if (
      target &&
      !drawer.contains(target) &&
      !toggleBtn.contains(target) &&
      (!backdrop || !backdrop.contains(target))
    ) {
      setOpen(false);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer.classList.contains("is-open")) {
      setOpen(false);
    }
  });
}

function renderBlogIndex(container: HTMLElement): void {
  updateBlogIndexSeo();

  const allArticles = getAllArticles();
  const categories = getCategories();

  // Filter
  let filtered =
    currentCategory === "همه مقالات"
      ? allArticles
      : allArticles.filter((a) => a.category === currentCategory);

  // Sort
  filtered = [...filtered].sort((a, b) => {
    return currentSort === "newest"
      ? b.date.localeCompare(a.date)
      : a.date.localeCompare(b.date);
  });

  container.innerHTML = `
    <!-- Hero Banner -->
    <section class="blog-hero">
      <div class="landing-container blog-hero__inner">
        <nav class="blog-breadcrumbs" aria-label="مسیر راهنما">
          <a href="/" data-link>صفحه اصلی</a>
          <span class="blog-breadcrumbs__sep">/</span>
          <span class="blog-breadcrumbs__current">وبلاگ</span>
        </nav>
        <h1 class="blog-hero__title">وبلاگ کاربوک</h1>
        <p class="blog-hero__subtitle">
          راهنماهای جامع، نکات کاربردی و مقالات تخصصی درباره سرویس‌های دوره‌ای، استهلاک قطعات و نگهداری اصولی خودرو.
        </p>
      </div>
    </section>

    <!-- Content & Sidebar Layout -->
    <div class="landing-container">
      <!-- Mobile Filter Chips -->
      <div class="blog-mobile-filters">
        <div class="mobile-chips-row" role="tablist" aria-label="دسته‌بندی مقالات">
          ${categories
            .map(
              (cat) => `
            <button
              type="button"
              class="mobile-chip ${cat.name === currentCategory ? "is-active" : ""}"
              data-category="${escapeHtml(cat.name)}"
            >
              <span>${escapeHtml(cat.name)}</span>
              <span>(${cat.count})</span>
            </button>
          `
            )
            .join("")}
        </div>
      </div>

      <div class="blog-layout">
        <!-- Main Articles Grid Column -->
        <section class="blog-articles-column" aria-label="لیست مقالات">
          ${
            filtered.length === 0
              ? `
            <div class="blog-empty-state">
              <h3>مقاله‌ای در این دسته‌بندی یافت نشد</h3>
              <p>می‌توانید سایر دسته‌ها را بررسی کنید یا به همه مقالات بازگردید.</p>
              <button type="button" class="btn btn--primary" id="btn-reset-filter">مشاهده همه مقالات</button>
            </div>
          `
              : `
            <div class="articles-grid">
              ${filtered
                .map(
                  (article) => `
                <article class="article-card">
                  <a href="/blog/${encodeURIComponent(article.slug)}" class="article-card__cover-link" data-link aria-label="${escapeHtml(article.title)}">
                    <img
                      src="${escapeHtml(article.cover)}"
                      alt="${escapeHtml(article.title)}"
                      class="article-card__cover"
                      loading="lazy"
                    />
                  </a>
                  <div class="article-card__body">
                    <div class="article-card__meta">
                      <span class="article-category-badge">${escapeHtml(article.category)}</span>
                      <time datetime="${article.date}">${article.formattedDate}</time>
                    </div>

                    <h2 class="article-card__title">
                      <a href="/blog/${encodeURIComponent(article.slug)}" data-link>
                        ${escapeHtml(article.title)}
                      </a>
                    </h2>

                    <p class="article-card__excerpt">
                      ${escapeHtml(article.description)}
                    </p>

                    <div class="article-card__footer">
                      <span>زمان مطالعه: حدود ${article.readingTimeMinutes} دقیقه</span>
                      <a href="/blog/${encodeURIComponent(article.slug)}" class="article-card__read-link" data-link>
                        <span>مطالعه مقاله</span>
                        <span data-icon="arrow-right" aria-hidden="true"></span>
                      </a>
                    </div>
                  </div>
                </article>
              `
                )
                .join("")}
            </div>
          `
          }
        </section>

        <!-- Desktop Sidebar Column -->
        <aside class="blog-sidebar" aria-label="فیلتر و مرتب‌سازی">
          <!-- Categories Widget -->
          <div class="sidebar-widget">
            <h3 class="sidebar-widget__title">
              <span data-icon="filter" aria-hidden="true"></span>
              <span>دسته‌بندی‌ها</span>
            </h3>
            <ul class="category-list">
              ${categories
                .map(
                  (cat) => `
                <li>
                  <button
                    type="button"
                    class="category-btn ${cat.name === currentCategory ? "is-active" : ""}"
                    data-category="${escapeHtml(cat.name)}"
                  >
                    <span>${escapeHtml(cat.name)}</span>
                    <span class="category-badge">${cat.count}</span>
                  </button>
                </li>
              `
                )
                .join("")}
            </ul>
          </div>

          <!-- Sorting Widget -->
          <div class="sidebar-widget">
            <h3 class="sidebar-widget__title">
              <span data-icon="arrow-up-down" aria-hidden="true"></span>
              <span>مرتب‌سازی</span>
            </h3>
            <div class="sort-select-wrap">
              <select class="sort-select" id="blog-sort-select" aria-label="مرتب‌سازی مقالات">
                <option value="newest" ${currentSort === "newest" ? "selected" : ""}>جدیدترین مقالات</option>
                <option value="oldest" ${currentSort === "oldest" ? "selected" : ""}>قدیمی‌ترین مقالات</option>
              </select>
            </div>
          </div>
        </aside>
      </div>
    </div>
  `;

  // Bind Category Clicks (both desktop sidebar and mobile chips)
  container.querySelectorAll<HTMLButtonElement>("[data-category]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cat = btn.getAttribute("data-category");
      if (cat && cat !== currentCategory) {
        currentCategory = cat;
        renderBlogIndex(container);
      }
    });
  });

  // Bind Reset Filter Button
  const resetBtn = container.querySelector("#btn-reset-filter");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      currentCategory = "همه مقالات";
      renderBlogIndex(container);
    });
  }

  // Bind Sort Select
  const sortSelect = container.querySelector<HTMLSelectElement>("#blog-sort-select");
  if (sortSelect) {
    sortSelect.addEventListener("change", (e) => {
      currentSort = (e.target as HTMLSelectElement).value as "newest" | "oldest";
      renderBlogIndex(container);
    });
  }

  bindLinks(container);
  applyIcons();
}

function renderArticlePage(container: HTMLElement, slug: string): void {
  const article = getArticleBySlug(slug);

  if (!article) {
    document.title = "مقاله یافت نشد — وبلاگ کاربوک";
    container.innerHTML = `
      <div class="landing-container" style="padding-top: 64px; padding-bottom: 80px;">
        <div class="blog-empty-state">
          <h1 style="font-size: 1.75rem; margin-bottom: 12px;">مقاله مورد نظر یافت نشد</h1>
          <p>ممکن است آدرس مقاله تغییر کرده یا حذف شده باشد.</p>
          <a href="/blog" class="btn btn--primary" data-link>بازگشت به وبلاگ</a>
        </div>
      </div>
    `;
    bindLinks(container);
    applyIcons();
    return;
  }

  updateArticleSeo(article);

  const relatedArticles = getAllArticles()
    .filter((a) => a.slug !== article.slug)
    .slice(0, 2);

  const tocHtml =
    article.toc.length > 0
      ? `
      <ul class="blog-toc__list">
        ${article.toc
          .map(
            (item) => `
          <li class="blog-toc__item blog-toc__item--level-${item.level}">
            <a href="#${item.id}" class="blog-toc__link" data-toc-target="${item.id}">
              ${escapeHtml(item.title)}
            </a>
          </li>
        `
          )
          .join("")}
      </ul>
    `
      : "<p style='font-size: 0.8125rem; color: var(--md-sys-color-on-surface-variant);'>فهرستی برای این مقاله وجود ندارد.</p>";

  container.innerHTML = `
    <!-- Article Breadcrumbs -->
    <section class="blog-hero" style="margin-bottom: 0; padding-bottom: 24px;">
      <div class="landing-container">
        <nav class="blog-breadcrumbs" aria-label="مسیر راهنما">
          <a href="/" data-link>صفحه اصلی</a>
          <span class="blog-breadcrumbs__sep">/</span>
          <a href="/blog" data-link>وبلاگ</a>
          <span class="blog-breadcrumbs__sep">/</span>
          <span class="blog-breadcrumbs__sep">${escapeHtml(article.category)}</span>
          <span class="blog-breadcrumbs__sep">/</span>
          <span class="blog-breadcrumbs__current">${escapeHtml(article.title)}</span>
        </nav>
      </div>
    </section>

    <!-- Main Article Body -->
    <div class="landing-container">
      <div class="article-layout">
        <!-- Article Content Column -->
        <article class="article-main-column">
          <header class="article-header">
            <div class="article-header__meta">
              <span class="article-category-badge">${escapeHtml(article.category)}</span>
              <span class="article-meta-item">
                <span data-icon="calendar" aria-hidden="true"></span>
                <time datetime="${article.date}">${article.formattedDate}</time>
              </span>
              <span class="article-meta-item">
                <span data-icon="clock" aria-hidden="true"></span>
                <span>حدود ${article.readingTimeMinutes} دقیقه مطالعه</span>
              </span>
            </div>

            <h1 class="article-header__title">${escapeHtml(article.title)}</h1>
            <p class="article-header__lead">${escapeHtml(article.description)}</p>
          </header>

          ${
            article.cover
              ? `
            <div class="article-featured-cover">
              <img src="${escapeHtml(article.cover)}" alt="${escapeHtml(article.title)}" />
            </div>
          `
              : ""
          }

          <!-- Mobile Collapsible TOC -->
          ${
            article.toc.length > 0
              ? `
            <details class="blog-toc-mobile">
              <summary>
                <span>فهرست مطالب این مقاله</span>
                <span data-icon="chevron-right" aria-hidden="true"></span>
              </summary>
              ${tocHtml}
            </details>
          `
              : ""
          }

          <!-- Markdown Rendered HTML Body -->
          <div class="article-content">
            ${article.html}
          </div>

          <!-- Related Articles (Internal Links) -->
          ${
            relatedArticles.length > 0
              ? `
            <section class="related-articles" aria-label="مقالات پیشنهادی">
              <h3 class="related-articles__title">مقالات پیشنهادی دیگر</h3>
              <div class="related-articles__grid">
                ${relatedArticles
                  .map(
                    (rel) => `
                  <article class="related-card">
                    <a href="/blog/${encodeURIComponent(rel.slug)}" class="related-card__link" data-link>
                      ${
                        rel.cover
                          ? `<img src="${escapeHtml(rel.cover)}" alt="${escapeHtml(rel.title)}" class="related-card__cover" loading="lazy" />`
                          : ""
                      }
                      <div class="related-card__body">
                        <span class="article-category-badge">${escapeHtml(rel.category)}</span>
                        <h4 class="related-card__title">${escapeHtml(rel.title)}</h4>
                        <span class="related-card__read">مطالعه مقاله ←</span>
                      </div>
                    </a>
                  </article>
                `
                  )
                  .join("")}
              </div>
            </section>
          `
              : ""
          }

          <!-- Bottom Actions -->
          <div class="article-footer-nav">
            <a href="/blog" class="btn btn--secondary" data-link>
              <span data-icon="arrow-right" aria-hidden="true"></span>
              <span>بازگشت به مقالات وبلاگ</span>
            </a>
            <a href="/app" class="btn btn--primary">
              <span>شروع استفاده از کاربوک</span>
            </a>
          </div>
        </article>

        <!-- Desktop Sticky TOC Sidebar -->
        <aside class="article-sidebar" aria-label="فهرست مطالب">
          <nav class="blog-toc">
            <div class="blog-toc__header">
              <span data-icon="menu" aria-hidden="true"></span>
              <span>فهرست مطالب</span>
            </div>
            ${tocHtml}
          </nav>
        </aside>
      </div>
    </div>
  `;

  bindLinks(container);
  setupToc(container);
  applyIcons();
}

function setupToc(container: HTMLElement): void {
  // Clean up previous observer
  if (tocObserver) {
    tocObserver.disconnect();
    tocObserver = null;
  }

  const tocLinks = container.querySelectorAll<HTMLAnchorElement>(".blog-toc__link");
  if (tocLinks.length === 0) return;

  // Smooth scroll click
  tocLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      const targetId = link.getAttribute("data-toc-target");
      if (targetId) {
        const targetEl = document.getElementById(targetId);
        if (targetEl) {
          e.preventDefault();
          targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
          window.history.replaceState(null, "", `#${targetId}`);
        }
      }
    });
  });

  // Scroll Spy using IntersectionObserver
  const headingElements: HTMLElement[] = [];
  tocLinks.forEach((link) => {
    const targetId = link.getAttribute("data-toc-target");
    if (targetId) {
      const el = document.getElementById(targetId);
      if (el) headingElements.push(el);
    }
  });

  if (headingElements.length > 0 && "IntersectionObserver" in window) {
    tocObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            tocLinks.forEach((link) => {
              link.classList.toggle("is-active", link.getAttribute("data-toc-target") === id);
            });
          }
        });
      },
      {
        rootMargin: "-96px 0px -60% 0px",
        threshold: 0,
      }
    );

    headingElements.forEach((h) => tocObserver!.observe(h));
  }
}

function renderBlog(): void {
  const appEl = document.getElementById("blog-app");
  if (!appEl) return;

  const route = parseBlogRoute(window.location.pathname, window.location.search);

  // If arrived via 404 search fallback ?slug=..., update address bar cleanly
  if (window.location.search.includes("slug=") && route.slug) {
    window.history.replaceState(null, "", `/blog/${encodeURIComponent(route.slug)}`);
  }

  if (route.type === "post" && route.slug) {
    renderArticlePage(appEl, route.slug);
  } else {
    renderBlogIndex(appEl);
  }

  // Scroll to top on page change
  window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
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

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function bootBlog(): void {
  initTheme();
  initMobileMenu();
  renderBlog();
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", renderBlog);

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bootBlog);
    } else {
      bootBlog();
    }
  }
}
