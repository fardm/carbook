/**
 * Local icon assets (§29 status chips, catalog icons, UI glyphs).
 *
 * Every icon is a standalone SVG file under `src/assets/icons/` — one file
 * per icon, no sprite. The glob below inlines them into the bundle at build
 * time, so the PWA renders identically offline with zero extra network
 * requests.
 *
 * The renderer is FORMAT-AGNOSTIC: each SVG file is the single source of
 * truth for its own rendering properties (viewBox, width/height, fill,
 * stroke*, or any other SVG attribute — lucide-derived 24×24 stroke icons
 * and fully colored custom artwork both work unchanged). `applyIcons()`
 * only loads, inlines, and applies placeholder overrides:
 *
 * - markup contains `<span data-icon="icon-name">` placeholders;
 * - each placeholder is swapped for its file's real `<svg>`;
 * - attributes explicitly set on the placeholder (class, width/height,
 *   aria-*, style…) are transferred to the SVG and override the file's
 *   corresponding attributes;
 * - `data-icon` itself is never transferred;
 * - unknown names are left untouched (no silent data loss).
 *
 * All current assets derive from Lucide (ISC, see each file's header) and
 * carry their own presentation attributes; custom non-lucide SVGs (e.g.
 * `carbook-badge.svg`, a colored 512×512 mark) need no special casing.
 */

const iconFiles = import.meta.glob<string>("../assets/icons/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** kebab-case icon name → raw SVG markup ("car" → car.svg contents). */
export const ICON_ASSETS: Record<string, string> = Object.fromEntries(
  Object.entries(iconFiles).map(([path, markup]) => [
    path.replace(/^.*\//, "").replace(/\.svg$/, ""),
    markup,
  ]),
);

/** Status → icon asset name for status chips (§29: icon + label + color). */
export const STATUS_ICONS: Record<string, string> = {
  ok: "circle-check",
  upcoming: "calendar-arrow-up",
  dueSoon: "clock",
  due: "calendar-clock",
  overdue: "triangle-alert",
};

/** Icons offered to the user when creating a custom item (§37). */
export const CUSTOM_ICON_CHOICES = [

] as const;

/** Parses an SVG file's markup into its root `<svg>` element. The file's
 * own attributes are preserved untouched — no normalization here. */
function svgFromMarkup(markup: string): SVGSVGElement | null {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = markup.trim();
  return wrapper.firstElementChild instanceof SVGSVGElement
    ? wrapper.firstElementChild
    : null;
}

/** Replaces every `[data-icon]` element in the document with its inline
 * SVG asset. The SVG file owns its rendering properties; only attributes
 * explicitly present on the placeholder override them. */
export function applyIcons(): void {
  document.querySelectorAll<HTMLElement>("[data-icon]").forEach((placeholder) => {
    const name = placeholder.dataset.icon ?? "";
    const markup = ICON_ASSETS[name];
    if (!markup) return;
    const svg = svgFromMarkup(markup);
    if (!svg) return;
    // Transfer the placeholder's own attributes (class, sizing, a11y…)
    // over the file's; skip the data-icon handle itself.
    for (const attr of placeholder.getAttributeNames()) {
      if (attr === "data-icon") continue;
      svg.setAttribute(attr, placeholder.getAttribute(attr)!);
    }
    placeholder.replaceWith(svg);
  });
}
