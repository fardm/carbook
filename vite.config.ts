import { defineConfig } from "vitest/config";

// base: "./" makes all asset URLs relative so the built app can be hosted
// from any GitHub Pages sub-path without configuration.
export default defineConfig({
  base: "./",
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
    // per-file via @vitest-environment (account modal tests).
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});