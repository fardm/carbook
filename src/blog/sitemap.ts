/**
 * Automatic Blog Sitemap Generator for CarBook.
 * Discovers Markdown articles dynamically from content/blog/*.md,
 * extracts frontmatter metadata, and generates standard sitemap.xml.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseFrontMatter } from "./markdown";

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
}

export interface DiscoveredArticle {
  slug: string;
  date: string;
  title: string;
}

/**
 * Discovers all published Markdown articles from the blog content directory.
 */
export function discoverBlogArticles(contentDir: string): DiscoveredArticle[] {
  if (!existsSync(contentDir)) return [];

  const files = readdirSync(contentDir).filter((file) => file.endsWith(".md"));
  const articles: DiscoveredArticle[] = [];

  for (const file of files) {
    const filePath = resolve(contentDir, file);
    const content = readFileSync(filePath, "utf-8");
    const { data } = parseFrontMatter(content);

    // Derive slug from frontmatter or filename
    const slug = data.slug || file.replace(/\.md$/, "");

    if (slug) {
      articles.push({
        slug,
        date: data.date,
        title: data.title,
      });
    }
  }

  // Sort articles newest first
  return articles.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

export interface SitemapOptions {
  origin?: string;
  contentDir?: string;
  staticRoutes?: Array<{
    path: string;
    changefreq: SitemapEntry["changefreq"];
    priority: number;
  }>;
}

/**
 * Generates valid sitemap.xml content from static routes and discovered blog articles.
 */
export function generateSitemapXml(options: SitemapOptions = {}): string {
  const origin = (options.origin || "https://carbook.fardm.ir").replace(/\/+$/, "");
  const contentDir = options.contentDir || resolve(process.cwd(), "content/blog");

  const staticRoutes = options.staticRoutes || [
    { path: "/", changefreq: "weekly" as const, priority: 1.0 },
    { path: "/blog", changefreq: "weekly" as const, priority: 0.8 },
    { path: "/support", changefreq: "monthly" as const, priority: 0.5 },
    { path: "/privacy", changefreq: "yearly" as const, priority: 0.3 },
    { path: "/terms", changefreq: "yearly" as const, priority: 0.3 },
  ];

  const seenUrls = new Set<string>();
  const entries: SitemapEntry[] = [];

  // Add static public routes (excluding /app and private application routes)
  for (const r of staticRoutes) {
    const url = `${origin}${r.path === "/" ? "/" : r.path}`;
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      entries.push({
        loc: url,
        changefreq: r.changefreq,
        priority: r.priority,
      });
    }
  }

  // Discover and add published blog articles
  const articles = discoverBlogArticles(contentDir);
  for (const a of articles) {
    const url = `${origin}/blog/${a.slug}`;
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      entries.push({
        loc: url,
        lastmod: a.date || undefined,
        changefreq: "monthly",
        priority: 0.7,
      });
    }
  }

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  for (const entry of entries) {
    xml += "  <url>\n";
    xml += `    <loc>${entry.loc}</loc>\n`;
    if (entry.lastmod) {
      xml += `    <lastmod>${entry.lastmod}</lastmod>\n`;
    }
    if (entry.changefreq) {
      xml += `    <changefreq>${entry.changefreq}</changefreq>\n`;
    }
    if (entry.priority !== undefined) {
      xml += `    <priority>${entry.priority.toFixed(1)}</priority>\n`;
    }
    xml += "  </url>\n";
  }

  xml += "</urlset>\n";
  return xml;
}

/**
 * Writes the generated sitemap to public/sitemap.xml (and dist/sitemap.xml if dist exists).
 */
export function writeSitemapFiles(options: { rootDir?: string; origin?: string } = {}): void {
  const rootDir = options.rootDir || process.cwd();
  const contentDir = resolve(rootDir, "content/blog");
  const xml = generateSitemapXml({
    origin: options.origin,
    contentDir,
  });

  const publicDir = resolve(rootDir, "public");
  if (!existsSync(publicDir)) {
    mkdirSync(publicDir, { recursive: true });
  }
  writeFileSync(resolve(publicDir, "sitemap.xml"), xml, "utf-8");

  const distDir = resolve(rootDir, "dist");
  if (existsSync(distDir)) {
    writeFileSync(resolve(distDir, "sitemap.xml"), xml, "utf-8");
  }
}
