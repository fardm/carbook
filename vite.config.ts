import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";

/**
 * Dev & preview server plugin to support direct navigation/refresh for:
 * - /app (rewrites to /app/index.html)
 * - /blog (rewrites to /blog/index.html)
 * - /blog/:slug (rewrites to /blog/index.html)
 */
function multiPageFallbackPlugin(): Plugin {
  const handler = (req: { url?: string }, _res: unknown, next: () => void) => {
    if (!req.url) return next();
    if (req.url === "/app") {
      req.url = "/app/index.html";
      return next();
    }
    if (req.url === "/blog") {
      req.url = "/blog/index.html";
      return next();
    }
    if (req.url.startsWith("/blog/") && !req.url.includes(".")) {
      req.url = "/blog/index.html";
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

export default defineConfig({
  base: "/",
  plugins: [multiPageFallbackPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        app: resolve(import.meta.dirname, "app/index.html"),
        blog: resolve(import.meta.dirname, "blog/index.html"),
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