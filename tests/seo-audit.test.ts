/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { getAllArticles } from "../src/blog/articles";
import { updateBlogIndexSeo, updateArticleSeo } from "../src/blog/seo";
import { discoverBlogArticles, generateSitemapXml } from "../src/blog/sitemap";

describe("robots.txt Audit", () => {
  const robotsPath = resolve(import.meta.dirname, "../public/robots.txt");

  it("robots.txt exists in public/ and is correctly formatted", () => {
    expect(existsSync(robotsPath)).toBe(true);
    const content = readFileSync(robotsPath, "utf-8");

    expect(content).toContain("User-agent: *");
    expect(content).toContain("Allow: /");
    expect(content).toContain("Allow: /blog");
    expect(content).toContain("Disallow: /app/");
    expect(content).toContain("Disallow: /app");
    expect(content).toContain("Sitemap: https://carbook.fardm.ir/sitemap.xml");
  });
});

describe("sitemap.xml Audit", () => {
  const sitemapPath = resolve(import.meta.dirname, "../public/sitemap.xml");

  it("sitemap.xml exists in public/, has valid xml structure and includes all public routes", () => {
    expect(existsSync(sitemapPath)).toBe(true);
    const content = readFileSync(sitemapPath, "utf-8");

    expect(content.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(content).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

    // Required canonical URLs
    expect(content).toContain("<loc>https://carbook.fardm.ir/</loc>");
    expect(content).toContain("<loc>https://carbook.fardm.ir/blog</loc>");
    expect(content).toContain("<loc>https://carbook.fardm.ir/support</loc>");
    expect(content).toContain("<loc>https://carbook.fardm.ir/privacy</loc>");
    expect(content).toContain("<loc>https://carbook.fardm.ir/terms</loc>");

    // Check that all published blog articles are present
    const articles = getAllArticles();
    expect(articles.length).toBeGreaterThan(0);
    for (const article of articles) {
      expect(content).toContain(`<loc>https://carbook.fardm.ir/blog/${article.slug}</loc>`);
    }

    // Ensure /app is excluded
    expect(content).not.toContain("/app");
    // Ensure no localhost or staging URLs
    expect(content).not.toContain("localhost");
    expect(content).not.toContain("127.0.0.1");
  });

  it("sitemap has no duplicate URLs across all entries", () => {
    const content = readFileSync(sitemapPath, "utf-8");
    const locMatches = [...content.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

    const uniqueLocs = new Set(locMatches);
    expect(locMatches.length).toBe(uniqueLocs.size);
  });

  it("every published article in content/blog is discovered with date and slug", () => {
    const contentDir = resolve(import.meta.dirname, "../content/blog");
    const discovered = discoverBlogArticles(contentDir);

    expect(discovered.length).toBeGreaterThanOrEqual(2);
    for (const a of discovered) {
      expect(a.slug).toBeTruthy();
      expect(a.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("generateSitemapXml dynamically incorporates new Markdown articles without duplicate URLs", () => {
    const xml = generateSitemapXml({
      origin: "https://carbook.fardm.ir",
      contentDir: resolve(import.meta.dirname, "../content/blog"),
    });

    expect(xml).toContain("https://carbook.fardm.ir/blog/when-to-change-engine-oil");
    expect(xml).toContain("<lastmod>2026-03-10</lastmod>");
    expect(xml).toContain("https://carbook.fardm.ir/blog/how-to-diagnose-consumable-parts");
    expect(xml).toContain("<lastmod>2026-03-05</lastmod>");
    expect(xml).not.toContain("/app");

    // Verify uniqueness in generated output
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBe(new Set(locs).size);
  });

  it("automatically discovers and includes newly added Markdown articles in the sitemap without duplicate URLs", () => {
    const tempDir = resolve(import.meta.dirname, "../scratch/test-content-blog-" + Date.now());
    mkdirSync(tempDir, { recursive: true });

    try {
      // Write mock article 1
      writeFileSync(
        resolve(tempDir, "sample-one.md"),
        `---\ntitle: "مقاله تستی اول"\ndate: "2026-04-01"\nslug: "sample-one"\n---\nمتن تست اول`,
        "utf-8"
      );

      // Write mock article 2
      writeFileSync(
        resolve(tempDir, "sample-two.md"),
        `---\ntitle: "مقاله تستی دوم"\ndate: "2026-04-05"\nslug: "sample-two"\n---\nمتن تست دوم`,
        "utf-8"
      );

      const xml = generateSitemapXml({
        origin: "https://carbook.fardm.ir",
        contentDir: tempDir,
      });

      expect(xml).toContain("<loc>https://carbook.fardm.ir/blog/sample-one</loc>");
      expect(xml).toContain("<lastmod>2026-04-01</lastmod>");
      expect(xml).toContain("<loc>https://carbook.fardm.ir/blog/sample-two</loc>");
      expect(xml).toContain("<lastmod>2026-04-05</lastmod>");

      // Verify no duplicates
      const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      expect(locs.length).toBe(new Set(locs).size);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("Page Metadata & Search Indexing Safety Audit", () => {
  const pages = [
    { file: "index.html", titleContains: "کاربوک", isPublic: true },
    { file: "app/index.html", titleContains: "برنامه", isPublic: false },
    { file: "blog/index.html", titleContains: "وبلاگ", isPublic: true },
    { file: "support/index.html", titleContains: "حمایت", isPublic: true },
    { file: "privacy/index.html", titleContains: "حریم خصوصی", isPublic: true },
    { file: "terms/index.html", titleContains: "شرایط استفاده", isPublic: true },
  ];

  it("all public and app pages have unique, descriptive <title> tags", () => {
    const titles = new Set<string>();

    for (const p of pages) {
      const html = readFileSync(resolve(import.meta.dirname, `../${p.file}`), "utf-8");
      const titleMatch = html.match(/<title>([^<]+)<\/title>/);
      expect(titleMatch).toBeTruthy();
      const title = titleMatch![1].trim();

      expect(title).toContain(p.titleContains);
      expect(titles.has(title)).toBe(false);
      titles.add(title);
    }
  });

  it("all public pages have unique meta descriptions, canonical URLs, and absolute social images", () => {
    const descriptions = new Set<string>();

    for (const p of pages.filter((page) => page.isPublic)) {
      const html = readFileSync(resolve(import.meta.dirname, `../${p.file}`), "utf-8");

      // Unique meta description
      const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/);
      expect(descMatch).toBeTruthy();
      const desc = descMatch![1].trim();
      expect(descriptions.has(desc)).toBe(false);
      descriptions.add(desc);

      // Canonical link
      const canonicalMatch = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/);
      expect(canonicalMatch).toBeTruthy();
      expect(canonicalMatch![1].startsWith("https://carbook.fardm.ir")).toBe(true);

      // Absolute social image
      const ogImageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/);
      expect(ogImageMatch).toBeTruthy();
      expect(ogImageMatch![1].startsWith("https://carbook.fardm.ir")).toBe(true);

      // Twitter card
      expect(html).toContain('property="twitter:card"');
      expect(html).toContain('property="twitter:image"');

      // Essential tags
      expect(html).toContain('<meta charset="UTF-8" />');
      expect(html).toContain('name="viewport"');
      expect(html).toContain('<html lang="fa" dir="rtl">');

      // Indexing safety: no rogue noindex on public pages
      expect(html).not.toContain('content="noindex');
      expect(html).not.toContain("content='noindex");
    }
  });
});

describe("Structured Data (JSON-LD) Audit", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("index.html contains valid WebSite and WebApplication JSON-LD schema", () => {
    const html = readFileSync(resolve(import.meta.dirname, "../index.html"), "utf-8");
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(jsonLdMatch).toBeTruthy();

    const parsed = JSON.parse(jsonLdMatch![1]);
    expect(parsed["@context"]).toBe("https://schema.org");
    expect(Array.isArray(parsed["@graph"])).toBe(true);

    const site = parsed["@graph"].find((item: { ["@type"]: string }) => item["@type"] === "WebSite");
    expect(site).toBeTruthy();
    expect(site.url).toBe("https://carbook.fardm.ir/");
    expect(site.name).toContain("کاربوک");

    const app = parsed["@graph"].find((item: { ["@type"]: string }) => item["@type"] === "WebApplication");
    expect(app).toBeTruthy();
    expect(app.url).toBe("https://carbook.fardm.ir/app/");
  });

  it("updateBlogIndexSeo generates valid BreadcrumbList structured data", () => {
    updateBlogIndexSeo();
    const script = document.getElementById("blog-breadcrumbs-schema");
    expect(script).toBeTruthy();
    const parsed = JSON.parse(script!.textContent || "{}");
    expect(parsed["@type"]).toBe("BreadcrumbList");
    expect(parsed.itemListElement.length).toBe(2);
    expect(parsed.itemListElement[1].item).toBe("https://carbook.fardm.ir/blog");
  });

  it("updateArticleSeo generates valid BlogPosting and BreadcrumbList structured data without fake claims", () => {
    const articles = getAllArticles();
    const article = articles[0];

    updateArticleSeo(article);

    const postingScript = document.getElementById("blog-article-schema");
    expect(postingScript).toBeTruthy();
    const posting = JSON.parse(postingScript!.textContent || "{}");
    expect(posting["@type"]).toBe("BlogPosting");
    expect(posting.headline).toBe(article.title);
    expect(posting.description).toBe(article.description);
    expect(posting.datePublished).toBe(article.date);
    expect(posting.url).toBe(`https://carbook.fardm.ir/blog/${article.slug}`);
    expect(posting.inLanguage).toBe("fa-IR");

    // Must NOT invent fake ratings, reviews, or fake authors
    expect(posting.aggregateRating).toBeUndefined();
    expect(posting.review).toBeUndefined();

    const breadcrumbScript = document.getElementById("blog-breadcrumbs-schema");
    expect(breadcrumbScript).toBeTruthy();
    const breadcrumbs = JSON.parse(breadcrumbScript!.textContent || "{}");
    expect(breadcrumbs.itemListElement.length).toBe(3);
    expect(breadcrumbs.itemListElement[2].name).toBe(article.title);
  });
});

describe("Heading Structure Audit", () => {
  it("public HTML templates have exactly one H1 tag", () => {
    const templates = [
      "index.html",
      "support/index.html",
      "privacy/index.html",
      "terms/index.html",
    ];

    for (const file of templates) {
      const html = readFileSync(resolve(import.meta.dirname, `../${file}`), "utf-8");
      const h1Matches = html.match(/<h1[\s>]/g) || [];
      expect(h1Matches.length).toBe(1);
    }
  });
});

describe("Internal Linking Audit", () => {
  it("Landing page has crawlable <a href> links to /blog and /app", () => {
    const html = readFileSync(resolve(import.meta.dirname, "../index.html"), "utf-8");
    expect(html).toContain('href="/blog"');
    expect(html).toContain('href="/app"');
  });

  it("Legal and support pages link to / and /app", () => {
    for (const file of ["support/index.html", "privacy/index.html", "terms/index.html"]) {
      const html = readFileSync(resolve(import.meta.dirname, `../${file}`), "utf-8");
      expect(html).toContain('href="/"');
      expect(html).toContain('href="/app"');
    }
  });
});
