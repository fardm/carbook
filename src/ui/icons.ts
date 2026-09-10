/**
 * Local icon assets (§29 status chips, catalog icons, UI glyphs).
 *
 * Every icon is a standalone SVG file under `src/assets/icons/` — one file
 * per icon, no sprite — vendored from Lucide (ISC, see each file's header).
 * The glob below inlines them into the bundle at build time, so the PWA
 * renders identically offline with zero extra network requests.
 *
 * Rendering contract (unchanged from the previous lucide.createIcons
 * pipeline): markup contains `<span data-icon="icon-name">` placeholders
 * and `applyIcons()` swaps each one for the real `<svg>`. Attributes on the
 * placeholder (class, width/height, aria-*, style…) are carried over and
 * override the SVG defaults, so every CSS selector targeting
 * `svg.lucide` / sized placeholders keeps working. All SVGs draw with
 * `stroke="currentColor"`, so color stays controlled by CSS/theme/state.
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
  "wrench",
  "settings-2",
  "filter",
  "droplets",
  "zap",
  "gauge",
  "battery",
  "lightbulb",
  "snowflake",
  "spray-can",
  "fan",
  "fuel",
] as const;

/** Presentation attributes every icon gets unless the placeholder carries
 * its own (matches the previous lucide rendering defaults). */
const SVG_DEFAULTS: Record<string, string> = {
  xmlns: "http://www.w3.org/2000/svg",
  width: "24",
  height: "24",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
};

/** Parses an SVG file's markup into a real `<svg>` element. */
function svgFromMarkup(markup: string): SVGSVGElement | null {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = markup.trim();
  return wrapper.firstElementChild instanceof SVGSVGElement
    ? wrapper.firstElementChild
    : null;
}

/** Replaces every `[data-icon]` element in the document with its local
 * SVG asset. Unknown names are left untouched (no silent data loss). */
export function applyIcons(): void {
  document.querySelectorAll<HTMLElement>("[data-icon]").forEach((placeholder) => {
    const name = placeholder.dataset.icon ?? "";
    const markup = ICON_ASSETS[name];
    if (!markup) return;
    const svg = svgFromMarkup(markup);
    if (!svg) return;
    // Defaults first, then the placeholder's own attributes — explicit
    // markup (sizing, class hooks, a11y) always wins.
    for (const [attr, value] of Object.entries(SVG_DEFAULTS)) {
      svg.setAttribute(attr, value);
    }
    for (const attr of placeholder.getAttributeNames()) {
      if (attr === "data-icon") continue;
      svg.setAttribute(attr, placeholder.getAttribute(attr)!);
    }
    placeholder.replaceWith(svg);
  });
}
