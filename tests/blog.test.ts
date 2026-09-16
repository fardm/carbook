/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import { parseBlogRoute } from "../src/blog";
import { parseFrontMatter, renderMarkdown, slugifyHeading } from "../src/blog/markdown";
import { getAllArticles, getArticleBySlug, getCategories, formatPersianDate } from "../src/blog/articles";
import { updateBlogIndexSeo, updateArticleSeo } from "../src/blog/seo";

describe("Blog Router (parseBlogRoute)", () => {
  it("resolves index route for /blog and /blog/", () => {
    expect(parseBlogRoute("/blog", "")).toEqual({ type: "index" });
    expect(parseBlogRoute("/blog/", "")).toEqual({ type: "index" });
  });

  it("resolves article post route for /blog/:slug", () => {
    expect(parseBlogRoute("/blog/when-to-change-engine-oil", "")).toEqual({
      type: "post",
      slug: "when-to-change-engine-oil",
    });
    expect(parseBlogRoute("/blog/how-to-diagnose-consumable-parts/", "")).toEqual({
      type: "post",
      slug: "how-to-diagnose-consumable-parts",
    });
  });

  it("resolves article from 404 query redirect fallback (?slug=...)", () => {
    expect(parseBlogRoute("/blog", "?slug=oil-guide")).toEqual({
      type: "post",
      slug: "oil-guide",
    });
    expect(parseBlogRoute("/blog/", "?foo=bar&slug=brake-pads")).toEqual({
      type: "post",
      slug: "brake-pads",
    });
  });
});

describe("Markdown & Frontmatter Engine", () => {
  const sampleMarkdown = `---
title: "تست عنوان مقاله"
description: "توضیح کوتاه تست"
category: "راهنما"
cover: "/images/cover.svg"
date: "2026-03-10"
slug: "test-article"
---

این یک پاراگراف مقدمه است.

## بخش اول: مقدمه

اینجا **متن ضخیم** و *متن ایتالیک* داریم.

- مورد اول لیست
- مورد دوم لیست

> این یک پیام مهم داخل نقل قول است.

### زیربخش ۱.۱: جزئیات فنی

کد داخل خط: \`console.log("test")\`
[لینک تست](https://example.com)
`;

  it("parseFrontMatter correctly extracts all metadata fields and body", () => {
    const { data, content } = parseFrontMatter(sampleMarkdown);
    expect(data.title).toBe("تست عنوان مقاله");
    expect(data.description).toBe("توضیح کوتاه تست");
    expect(data.category).toBe("راهنما");
    expect(data.cover).toBe("/images/cover.svg");
    expect(data.date).toBe("2026-03-10");
    expect(data.slug).toBe("test-article");
    expect(content).toContain("این یک پاراگراف مقدمه است.");
    expect(content).not.toContain("---");
  });

  it("slugifyHeading generates clean, unique IDs for Persian headings", () => {
    const id1 = slugifyHeading("نقش حیاتی روغن در موتور", 1);
    expect(id1).toBe("نقش-حیاتی-روغن-در-موتور-1");
  });

  it("renderMarkdown generates structured HTML and extracts TOC", () => {
    const { content } = parseFrontMatter(sampleMarkdown);
    const { html, toc, readingTimeMinutes } = renderMarkdown(content);

    expect(html).toContain('<h2 id="بخش-اول-مقدمه-1" class="article-h2">بخش اول: مقدمه</h2>');
    expect(html).toContain('<strong>متن ضخیم</strong>');
    expect(html).toContain('<em>متن ایتالیک</em>');
    expect(html).toContain('<blockquote class="article-quote">این یک پیام مهم داخل نقل قول است.</blockquote>');
    expect(html).toContain('<ul class="article-list">');
    expect(html).toContain('<li>مورد اول لیست</li>');
    expect(html).toContain('<code class="article-code">console.log(&quot;test&quot;)</code>');
    expect(html).toContain('<a href="https://example.com" class="article-link">لینک تست</a>');

    expect(toc).toEqual([
      { id: "بخش-اول-مقدمه-1", title: "بخش اول: مقدمه", level: 2 },
      { id: "زیربخش-۱۱-جزئیات-فنی-2", title: "زیربخش ۱.۱: جزئیات فنی", level: 3 },
    ]);
    expect(readingTimeMinutes).toBeGreaterThanOrEqual(1);
  });
});

describe("Article Repository (Discovery & Glob Import)", () => {
  it("discovers all markdown articles in /content/blog/", () => {
    const articles = getAllArticles();
    expect(articles.length).toBeGreaterThanOrEqual(2);

    const slugs = articles.map((a) => a.slug);
    expect(slugs).toContain("when-to-change-engine-oil");
    expect(slugs).toContain("how-to-diagnose-consumable-parts");
  });

  it("sorts articles by date descending (newest first)", () => {
    const articles = getAllArticles();
    for (let i = 0; i < articles.length - 1; i++) {
      expect(articles[i].date >= articles[i + 1].date).toBe(true);
    }
  });

  it("getArticleBySlug retrieves the correct article or undefined", () => {
    const oilArticle = getArticleBySlug("when-to-change-engine-oil");
    expect(oilArticle).toBeDefined();
    expect(oilArticle?.title).toContain("روغن موتور");
    expect(oilArticle?.toc.length).toBeGreaterThan(0);

    const nonExistent = getArticleBySlug("non-existent-article-slug-xyz");
    expect(nonExistent).toBeUndefined();
  });

  it("getCategories aggregates unique categories with article counts", () => {
    const categories = getCategories();
    expect(categories[0].name).toBe("همه مقالات");
    expect(categories[0].count).toBeGreaterThanOrEqual(2);

    const names = categories.map((c) => c.name);
    expect(names).toContain("سرویس‌های دوره‌ای");
    expect(names).toContain("راهنمای فنی");
  });

  it("formatPersianDate formats YYYY-MM-DD into readable Persian date", () => {
    const formatted = formatPersianDate("2026-03-10");
    expect(formatted).toBeDefined();
    expect(typeof formatted).toBe("string");
    expect(formatted.length).toBeGreaterThan(0);
  });
});

describe("Blog SEO Manager", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.title = "";
  });

  it("updateBlogIndexSeo sets index title, meta description, and canonical link", () => {
    updateBlogIndexSeo();
    expect(document.title).toContain("وبلاگ کاربوک");

    const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute("content");
    expect(metaDesc).toContain("وبلاگ کاربوک");

    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
    expect(canonical).toBe("https://carbook.fardm.ir/blog");

    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content");
    expect(ogTitle).toContain("وبلاگ کاربوک");
  });

  it("updateArticleSeo sets article title, meta description, and canonical link", () => {
    const article = getArticleBySlug("when-to-change-engine-oil");
    expect(article).toBeDefined();

    updateArticleSeo(article!);
    expect(document.title).toContain(article!.title);
    expect(document.title).toContain("وبلاگ کاربوک");

    const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute("content");
    expect(metaDesc).toBe(article!.description);

    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
    expect(canonical).toBe(`https://carbook.fardm.ir/blog/${article!.slug}`);

    const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
    expect(ogImage).toContain(article!.cover);
  });
});

describe("Blog Shell & Layout", () => {
  it("blog/index.html includes shared header, footer, theme toggle, and blog-app mount", () => {
    const blogHtml = readFileSync(resolve(import.meta.dirname, "../blog/index.html"), "utf-8");
    expect(blogHtml).toContain("landing-header");
    expect(blogHtml).toContain("landing-footer");
    expect(blogHtml).toContain("blog-app");
    expect(blogHtml).toContain("theme-toggle");
    expect(blogHtml).toContain("menu-toggle");
    expect(blogHtml).toContain("لینک ها");
    expect(blogHtml).toContain("حمایت مالی");
    expect(blogHtml).toContain("/src/styles/blog.css");
    expect(blogHtml).toContain("/src/blog.ts");
  });
});

