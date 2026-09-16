/**
 * Blog SEO Manager
 * Dynamically updates document metadata, canonical links, Open Graph, and Twitter card tags.
 */

import type { Article } from "./articles";

export function setMetaTag(selector: string, attribute: string, value: string): void {
  let el = document.querySelector(selector);
  if (!el) {
    el = document.createElement("meta");
    if (selector.includes("property=")) {
      const propMatch = selector.match(/property="([^"]+)"/);
      if (propMatch) el.setAttribute("property", propMatch[1]);
    } else if (selector.includes("name=")) {
      const nameMatch = selector.match(/name="([^"]+)"/);
      if (nameMatch) el.setAttribute("name", nameMatch[1]);
    }
    document.head.appendChild(el);
  }
  el.setAttribute(attribute, value);
}

export function setCanonicalUrl(url: string): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.appendChild(link);
  }
  link.setAttribute("href", url);
}

export function updateBlogIndexSeo(): void {
  const title = "وبلاگ کاربوک — مقالات و نکات نگهداری خودرو";
  const desc = "مجموعه مقالات آموزشی و تخصصی درباره سرویس‌های دوره‌ای، استهلاک قطعات و راهکارهای نگهداری بهینه خودرو در وبلاگ کاربوک.";
  const url = "https://carbook.fardm.ir/blog";
  const image = "https://carbook.fardm.ir/icons/icon-512.png";

  document.title = title;
  setMetaTag('meta[name="description"]', "content", desc);
  setCanonicalUrl(url);

  setMetaTag('meta[property="og:title"]', "content", title);
  setMetaTag('meta[property="og:description"]', "content", desc);
  setMetaTag('meta[property="og:url"]', "content", url);
  setMetaTag('meta[property="og:image"]', "content", image);

  setMetaTag('meta[property="twitter:title"]', "content", title);
  setMetaTag('meta[property="twitter:description"]', "content", desc);
  setMetaTag('meta[property="twitter:image"]', "content", image);
}

export function updateArticleSeo(article: Article): void {
  const title = `${article.title} — وبلاگ کاربوک`;
  const desc = article.description;
  const url = `https://carbook.fardm.ir/blog/${article.slug}`;
  const image = article.cover.startsWith("http")
    ? article.cover
    : `https://carbook.fardm.ir${article.cover}`;

  document.title = title;
  setMetaTag('meta[name="description"]', "content", desc);
  setCanonicalUrl(url);

  setMetaTag('meta[property="og:title"]', "content", title);
  setMetaTag('meta[property="og:description"]', "content", desc);
  setMetaTag('meta[property="og:url"]', "content", url);
  setMetaTag('meta[property="og:image"]', "content", image);

  setMetaTag('meta[property="twitter:title"]', "content", title);
  setMetaTag('meta[property="twitter:description"]', "content", desc);
  setMetaTag('meta[property="twitter:image"]', "content", image);
}
