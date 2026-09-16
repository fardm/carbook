/**
 * Blog Article Repository
 * Automatically discovers Markdown articles from /content/blog/*.md using Vite's glob import.
 */

import { parseFrontMatter, renderMarkdown, type ArticleMetadata, type TocItem } from "./markdown";

export interface Article extends ArticleMetadata {
  html: string;
  toc: TocItem[];
  readingTimeMinutes: number;
  formattedDate: string;
}

const rawArticles = import.meta.glob<string>("/content/blog/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

export function formatPersianDate(dateStr: string): string {
  try {
    const parts = dateStr.split("-").map(Number);
    if (parts.length === 3 && !parts.some(isNaN)) {
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      return new Intl.DateTimeFormat("fa-IR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(d);
    }
  } catch {
    /* fallback */
  }
  return dateStr;
}

let cachedArticles: Article[] | null = null;

export function getAllArticles(): Article[] {
  if (cachedArticles) return cachedArticles;

  const list: Article[] = [];

  for (const [path, raw] of Object.entries(rawArticles)) {
    const { data, content } = parseFrontMatter(raw);
    const { html, toc, readingTimeMinutes } = renderMarkdown(content);

    // If slug is not in frontmatter, derive from filename: /content/blog/foo.md -> foo
    const derivedSlug = data.slug || path.replace(/^.*\//, "").replace(/\.md$/, "");

    list.push({
      ...data,
      slug: derivedSlug,
      html,
      toc,
      readingTimeMinutes,
      formattedDate: formatPersianDate(data.date),
    });
  }

  // Sort by date descending (newest first)
  list.sort((a, b) => b.date.localeCompare(a.date));

  cachedArticles = list;
  return cachedArticles;
}

export function getArticleBySlug(slug: string): Article | undefined {
  const articles = getAllArticles();
  return articles.find((a) => a.slug === slug);
}

export interface CategoryInfo {
  name: string;
  count: number;
}

export function getCategories(): CategoryInfo[] {
  const articles = getAllArticles();
  const counts = new Map<string, number>();

  for (const article of articles) {
    const cat = article.category || "عمومی";
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }

  const result: CategoryInfo[] = [
    { name: "همه مقالات", count: articles.length },
  ];

  for (const [name, count] of counts.entries()) {
    result.push({ name, count });
  }

  return result;
}
