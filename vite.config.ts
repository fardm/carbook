import { resolve } from "node:path";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";
import { writeSitemapFiles, generateSitemapXml, discoverBlogArticles } from "./src/blog/sitemap.ts";

/**
 * Dev & preview server plugin to support deterministic routing for:
 * - / (Landing page only)
 * - /app (App workspace only)
 * - /blog (Blog index only)
 * - /blog/:slug (Blog article only for valid slugs, 404 for invalid slugs)
 * - /support, /privacy, /terms (Informational MPA pages)
 * - Any unknown route -> /404.html
 */
function multiPageFallbackPlugin(): Plugin {
  const handler = (req: { url?: string }, _res: unknown, next: () => void) => {
    if (!req.url) return next();
    const parsedUrl = new URL(req.url, "http://localhost");
    const pathname = parsedUrl.pathname.replace(/\/+$/, "") || "/";
    const search = parsedUrl.search;

    // 1. Static asset files, Vite internal modules, and vite HMR
    if (
      pathname.includes(".") ||
      pathname.startsWith("/@") ||
      pathname.startsWith("/node_modules/") ||
      pathname.startsWith("/src/") ||
      pathname.startsWith("/fonts/") ||
      pathname.startsWith("/icons/") ||
      pathname.startsWith("/images/")
    ) {
      return next();
    }

    // 2. Root landing page only
    if (pathname === "/") {
      req.url = "/index.html" + search;
      return next();
    }

    // 3. /app workspace only
    if (pathname === "/app") {
      req.url = "/app/index.html" + search;
      return next();
    }

    // 4. /blog index only
    if (pathname === "/blog") {
      req.url = "/blog/index.html" + search;
      return next();
    }

    // 5. /blog/:slug (exact single segment)
    if (pathname.startsWith("/blog/")) {
      const slug = pathname.slice("/blog/".length);
      // Ensure single segment slug (no additional slashes)
      if (!slug.includes("/")) {
        const articles = discoverBlogArticles(resolve(import.meta.dirname, "content/blog"));
        const isValidSlug = articles.some((a) => a.slug === slug);
        if (isValidSlug) {
          req.url = "/blog/index.html" + search;
          return next();
        }
      }
      // Unknown slug or malformed path under /blog -> 404
      req.url = "/404.html" + search;
      return next();
    }

    // 6. Other MPA static pages
    if (pathname === "/support") {
      req.url = "/support/index.html" + search;
      return next();
    }
    if (pathname === "/privacy") {
      req.url = "/privacy/index.html" + search;
      return next();
    }
    if (pathname === "/terms") {
      req.url = "/terms/index.html" + search;
      return next();
    }

    // 7. Any unknown/invalid route -> 404 page
    req.url = "/404.html" + search;
    return next();
  };

  return {
    name: "multipage-fallback-plugin",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

/**
 * Automatically discovers blog Markdown articles and generates sitemap.xml on build and dev server start.
 */
function sitemapPlugin(): Plugin {
  return {
    name: "auto-sitemap-plugin",
    buildStart() {
      writeSitemapFiles({ rootDir: import.meta.dirname });
    },
    generateBundle() {
      const xml = generateSitemapXml({
        contentDir: resolve(import.meta.dirname, "content/blog"),
      });
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: xml,
      });
    },
    configureServer() {
      writeSitemapFiles({ rootDir: import.meta.dirname });
    },
  };
}

/**
 * Emits clean HTML entry points and static directory routes for GitHub Pages deployment.
 */
function gitHubPagesStaticPlugin(): Plugin {
  return {
    name: "github-pages-static-plugin",
    closeBundle() {
      const distDir = resolve(import.meta.dirname, "dist");
      if (!existsSync(distDir)) return;

      const copyIfExist = (srcRel: string, destRel: string) => {
        const src = resolve(distDir, srcRel);
        const dest = resolve(distDir, destRel);
        if (existsSync(src)) {
          mkdirSync(resolve(dest, ".."), { recursive: true });
          copyFileSync(src, dest);
        }
      };

      // Clean extension-free MPA HTML files for GitHub Pages root hosting
      copyIfExist("app/index.html", "app.html");
      copyIfExist("blog/index.html", "blog.html");
      copyIfExist("support/index.html", "support.html");
      copyIfExist("privacy/index.html", "privacy.html");
      copyIfExist("terms/index.html", "terms.html");

      // Generate static HTML files for each blog article
      const articles = discoverBlogArticles(resolve(import.meta.dirname, "content/blog"));
      for (const article of articles) {
        copyIfExist("blog/index.html", `blog/${article.slug}/index.html`);
        copyIfExist("blog/index.html", `blog/${article.slug}.html`);
      }
    },
  };
}

export default defineConfig({
  base: "/",
  appType: "mpa",
  plugins: [multiPageFallbackPlugin(), sitemapPlugin(), gitHubPagesStaticPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        app: resolve(import.meta.dirname, "app/index.html"),
        blog: resolve(import.meta.dirname, "blog/index.html"),
        support: resolve(import.meta.dirname, "support/index.html"),
        privacy: resolve(import.meta.dirname, "privacy/index.html"),
        terms: resolve(import.meta.dirname, "terms/index.html"),
      },
    },
  },
  // The project uses plain CSS. An inline config prevents Vite from
  // discovering a PostCSS config higher in the filesystem (e.g. the
  // user's global ~/postcss.config.mjs) and failing on it.
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    // "node" keeps the existing suite fast; DOM/UI tests declare jsdom
    // per-file via @vitest-environment.
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
  },
});