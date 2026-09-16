import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseBlogRoute } from "../src/blog";

describe("PWA manifest configuration", () => {
  const manifestPath = resolve(import.meta.dirname, "../public/manifest.json");

  it("manifest exists and has correct start_url, scope, and id for /app architecture", () => {
    expect(existsSync(manifestPath)).toBe(true);
    const content = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(content.start_url).toBe("/app/");
    expect(content.scope).toBe("/app/");
    expect(content.id).toBe("/");
    expect(content.display).toBe("standalone");
    expect(content.icons.length).toBeGreaterThan(0);
    for (const icon of content.icons) {
      expect(icon.src.startsWith("/")).toBe(true);
    }
  });
});

describe("Service Worker configuration", () => {
  const swPath = resolve(import.meta.dirname, "../public/sw.js");

  it("sw.js precaches /app/index.html and handles notification clicks to /app/#/reminders", () => {
    expect(existsSync(swPath)).toBe(true);
    const swContent = readFileSync(swPath, "utf-8");
    expect(swContent).toContain("/app/index.html");
    expect(swContent).toContain("/app/#/reminders");
  });
});

describe("HTML Entry Points", () => {
  it("root index.html is the landing page and contains OAuth forwarding", () => {
    const landingHtml = readFileSync(resolve(import.meta.dirname, "../index.html"), "utf-8");
    expect(landingHtml).toContain("کاربوک");
    expect(landingHtml).toContain("ورود به کاربوک");
    expect(landingHtml).toContain("/app");
    expect(landingHtml).toContain("/blog");
    expect(landingHtml).toContain("code=");
    expect(landingHtml).toContain("access_token=");
  });

  it("app/index.html contains the full CarBook application shell", () => {
    const appHtml = readFileSync(resolve(import.meta.dirname, "../app/index.html"), "utf-8");
    expect(appHtml).toContain("app-bar");
    expect(appHtml).toContain("app-content");
    expect(appHtml).toContain("app-nav");
    expect(appHtml).toContain("/src/main.ts");
  });

  it("blog/index.html contains blog app container and loads src/blog.ts", () => {
    const blogHtml = readFileSync(resolve(import.meta.dirname, "../blog/index.html"), "utf-8");
    expect(blogHtml).toContain("blog-app");
    expect(blogHtml).toContain("/src/blog.ts");
  });

  it("support/index.html contains support info and exact CoffeeTe link", () => {
    const supportHtml = readFileSync(resolve(import.meta.dirname, "../support/index.html"), "utf-8");
    expect(supportHtml).toContain("حمایت از کاربوک");
    expect(supportHtml).toContain("https://www.coffeete.ir/ifard");
    expect(supportHtml).toContain("پرداخت با سایت کافیته");
    expect(supportHtml).toContain("زرین پال");
    expect(supportHtml).toContain("/src/landing.ts");
  });

  it("privacy/index.html and terms/index.html exist and use landing stylesheet and scripts", () => {
    const privacyHtml = readFileSync(resolve(import.meta.dirname, "../privacy/index.html"), "utf-8");
    expect(privacyHtml).toContain("سیاست حفظ حریم خصوصی");
    expect(privacyHtml).toContain("/src/styles/landing.css");
    expect(privacyHtml).toContain("/src/landing.ts");

    const termsHtml = readFileSync(resolve(import.meta.dirname, "../terms/index.html"), "utf-8");
    expect(termsHtml).toContain("شرایط استفاده از خدمات");
    expect(termsHtml).toContain("/src/styles/landing.css");
    expect(termsHtml).toContain("/src/landing.ts");
  });

  it("landing page index.html has unwanted items and button removed and includes support link and social links", () => {
    const landingHtml = readFileSync(resolve(import.meta.dirname, "../index.html"), "utf-8");
    expect(landingHtml).not.toContain("مشاهده محیط ثبت سرویس");
    expect(landingHtml).not.toContain("بخش‌های صفحه");
    expect(landingHtml).toContain("لینک ها");
    expect(landingHtml).toContain("حمایت مالی");
    expect(landingHtml).toContain("/support");
    expect(landingHtml).toContain("https://github.com/fardm/carbook");
    expect(landingHtml).toContain("https://t.me/ifard_ir/");
    expect(landingHtml).toContain("hamburger-line");
  });

  it("public/404.html contains GitHub Pages SPA fallback logic for /app and /blog/:slug", () => {
    const notFoundHtml = readFileSync(resolve(import.meta.dirname, "../public/404.html"), "utf-8");
    expect(notFoundHtml).toContain("/app");
    expect(notFoundHtml).toContain("/blog/");
    expect(notFoundHtml).toContain("slug");
  });
});

describe("Blog route parsing", () => {
  it("parses /blog and /blog/ as index route", () => {
    expect(parseBlogRoute("/blog", "")).toEqual({ type: "index" });
    expect(parseBlogRoute("/blog/", "")).toEqual({ type: "index" });
  });

  it("parses /blog/:slug from pathname", () => {
    expect(parseBlogRoute("/blog/engine-oil", "")).toEqual({
      type: "post",
      slug: "engine-oil",
    });
    expect(parseBlogRoute("/blog/maintenance-guide-2026/", "")).toEqual({
      type: "post",
      slug: "maintenance-guide-2026",
    });
  });

  it("parses slug from query search fallback (?slug=...)", () => {
    expect(parseBlogRoute("/blog", "?slug=oil-change")).toEqual({
      type: "post",
      slug: "oil-change",
    });
    expect(parseBlogRoute("/blog/", "?other=1&slug=brake-pad")).toEqual({
      type: "post",
      slug: "brake-pad",
    });
  });
});
