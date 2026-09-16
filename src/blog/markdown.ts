/**
 * Zero-dependency Frontmatter & Markdown Parser for CarBook Blog.
 * Produces semantic, accessible HTML and extracts a structured Table of Contents (TOC).
 */

export interface ArticleMetadata {
  title: string;
  description: string;
  category: string;
  cover: string;
  date: string;
  slug: string;
}

export interface TocItem {
  id: string;
  title: string;
  level: 2 | 3;
}

export interface ParsedMarkdown {
  html: string;
  toc: TocItem[];
  readingTimeMinutes: number;
}

export function parseFrontMatter(raw: string): { data: ArticleMetadata; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return {
      data: {
        title: "",
        description: "",
        category: "عمومی",
        cover: "",
        date: new Date().toISOString().slice(0, 10),
        slug: "",
      },
      content: raw.trim(),
    };
  }

  const yamlBlock = match[1];
  const content = match[2].trim();
  const data: Partial<ArticleMetadata> = {};

  const lines = yamlBlock.split(/\r?\n/);
  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim() as keyof ArticleMetadata;
    let val = line.slice(colonIndex + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    data[key] = val;
  }

  return {
    data: {
      title: data.title || "",
      description: data.description || "",
      category: data.category || "عمومی",
      cover: data.cover || "",
      date: data.date || new Date().toISOString().slice(0, 10),
      slug: data.slug || "",
    },
    content,
  };
}

export function slugifyHeading(text: string, index: number): string {
  const clean = text
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
  return clean ? `${clean}-${index}` : `section-${index}`;
}

export function renderMarkdown(markdown: string): ParsedMarkdown {
  const toc: TocItem[] = [];
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];

  let inList: "ul" | "ol" | null = null;
  let inBlockquote = false;
  let blockquoteLines: string[] = [];
  let headingIndex = 0;

  const closeList = () => {
    if (inList) {
      out.push(inList === "ul" ? "</ul>" : "</ol>");
      inList = null;
    }
  };

  const closeBlockquote = () => {
    if (inBlockquote) {
      const inner = blockquoteLines
        .map((l) => formatInline(l))
        .join("<br />");
      out.push(`<blockquote class="article-quote">${inner}</blockquote>`);
      inBlockquote = false;
      blockquoteLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    // Empty line resets blocks
    if (!line) {
      closeList();
      closeBlockquote();
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      closeList();
      inBlockquote = true;
      blockquoteLines.push(line.slice(2).trim());
      continue;
    } else {
      closeBlockquote();
    }

    // Headings
    if (line.startsWith("### ")) {
      closeList();
      const title = line.slice(4).trim();
      headingIndex++;
      const id = slugifyHeading(title, headingIndex);
      toc.push({ id, title, level: 3 });
      out.push(`<h3 id="${id}" class="article-h3">${formatInline(title)}</h3>`);
      continue;
    }

    if (line.startsWith("## ")) {
      closeList();
      const title = line.slice(3).trim();
      headingIndex++;
      const id = slugifyHeading(title, headingIndex);
      toc.push({ id, title, level: 2 });
      out.push(`<h2 id="${id}" class="article-h2">${formatInline(title)}</h2>`);
      continue;
    }

    if (line.startsWith("# ")) {
      closeList();
      const title = line.slice(2).trim();
      out.push(`<h1 class="article-h1">${formatInline(title)}</h1>`);
      continue;
    }

    // Unordered List (- or *)
    const ulMatch = line.match(/^[-*]\s+(.*)$/);
    if (ulMatch) {
      if (inList !== "ul") {
        closeList();
        out.push('<ul class="article-list">');
        inList = "ul";
      }
      out.push(`<li>${formatInline(ulMatch[1])}</li>`);
      continue;
    }

    // Ordered List (1. 2.)
    const olMatch = line.match(/^\d+\.\s+(.*)$/);
    if (olMatch) {
      if (inList !== "ol") {
        closeList();
        out.push('<ol class="article-list article-list--ordered">');
        inList = "ol";
      }
      out.push(`<li>${formatInline(olMatch[1])}</li>`);
      continue;
    }

    closeList();

    // Standard paragraph
    out.push(`<p class="article-p">${formatInline(line)}</p>`);
  }

  closeList();
  closeBlockquote();

  // Approximate reading time (average ~200 words per minute for Persian technical text)
  const words = markdown.trim().split(/\s+/).length;
  const readingTimeMinutes = Math.max(1, Math.ceil(words / 200));

  return {
    html: out.join("\n"),
    toc,
    readingTimeMinutes,
  };
}

function formatInline(text: string): string {
  let escaped = escapeHtml(text);

  // Images: ![alt](url)
  escaped = escaped.replace(
    /!\[(.*?)\]\((.*?)\)/g,
    '<figure class="article-figure"><img src="$2" alt="$1" loading="lazy" /><figcaption>$1</figcaption></figure>'
  );

  // Links: [text](url)
  escaped = escaped.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" class="article-link">$1</a>');

  // Bold: **text**
  escaped = escaped.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

  // Italic: *text*
  escaped = escaped.replace(/\*(.*?)\*/g, "<em>$1</em>");

  // Inline code: `code`
  escaped = escaped.replace(/`(.*?)`/g, '<code class="article-code">$1</code>');

  return escaped;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
