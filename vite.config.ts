import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";
import { writeSitemapFiles, generateSitemapXml } from "./src/blog/sitemap";

/**
 * Dev & preview server plugin to support direct navigation/refresh for:
 * - /app (rewrites to /app/index.html)
 * - /blog (rewrites to /blog/index.html)
 * - /blog/:slug (rewrites to /blog/index.html)
 */
function multiPageFallbackPlugin(): Plugin {
  const handler = (req: { url?: string }, _res: unknown, next: () => void) => {
    if (!req.url) return next();
    if (req.url === "/app" || req.url === "/app/") {
      req.url = "/app/index.html";
      return next();
    }
    if (req.url === "/blog" || req.url === "/blog/") {
      req.url = "/blog/index.html";
      return next();
    }
    if (req.url.startsWith("/blog/") && !req.url.includes(".")) {
      req.url = "/blog/index.html";
      return next();
    }
    if (req.url === "/support" || req.url === "/support/") {
      req.url = "/support/index.html";
      return next();
    }
    if (req.url === "/privacy" || req.url === "/privacy/") {
      req.url = "/privacy/index.html";
      return next();
    }
    if (req.url === "/terms" || req.url === "/terms/") {
      req.url = "/terms/index.html";
      return next();
    }
    next();
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

export default defineConfig({
  base: "/",
  plugins: [multiPageFallbackPlugin(), sitemapPlugin()],
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