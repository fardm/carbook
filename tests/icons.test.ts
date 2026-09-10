// @vitest-environment jsdom
/**
 * Local icon assets (src/assets/icons) — regression guards for the
 * applyIcons rendering contract after moving off the lucide runtime:
 * placeholders swap to inline SVGs, attributes carry over, colors stay
 * CSS-driven via currentColor, and every asset is a standalone file.
 */
import { describe, expect, it } from "vitest";
import { applyIcons, CUSTOM_ICON_CHOICES, ICON_ASSETS, STATUS_ICONS } from "../src/ui/icons";

/** The one intentionally non-lucide asset (own viewBox + internal fills). */
const CUSTOM_FORMAT_ICON = "carbook-badge";

describe("local icon assets", () => {
  it("ships a standalone SVG file for every status, custom-item, and choice icon", () => {
    const required = [
      ...Object.values(STATUS_ICONS),
      ...CUSTOM_ICON_CHOICES,
      "car-front", // nav
      "calendar", // date field
      "x", // close buttons
      "loader-circle", // busy spinner
    ];
    for (const name of required) {
      const markup = ICON_ASSETS[name];
      expect(markup, `${name}.svg present`).toBeTruthy();
      expect(markup).toContain("<svg");
      expect(markup).not.toContain("<symbol"); // one file per icon, no sprite
    }
  });

  it("lucide-derived assets draw with currentColor so CSS/theme keeps controlling color", () => {
    for (const [name, markup] of Object.entries(ICON_ASSETS)) {
      if (name === CUSTOM_FORMAT_ICON) continue; // custom artwork, tested below
      expect(markup, name).toContain('stroke="currentColor"');
      expect(markup, name).not.toMatch(/stroke="#[0-9a-fA-F]/);
      expect(markup, name).not.toMatch(/fill="#[0-9a-fA-F]/);
      expect(markup, name).toContain('viewBox="0 0 24 24"');
    }
  });
});

describe("applyIcons rendering contract", () => {
  it("swaps placeholders for inline SVGs carrying their classes and aria attributes", () => {
    document.body.innerHTML =
      '<span data-icon="calendar" class="date-field__icon" aria-hidden="true"></span>' +
      '<span data-icon="not-a-real-icon"></span>';
    applyIcons();
    const svg = document.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("class")).toBe("date-field__icon");
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
    // Placeholder consumed; unknown names are left untouched.
    expect(document.querySelector("[data-icon='calendar']")).toBeNull();
    expect(document.querySelector("[data-icon='not-a-real-icon']")).not.toBeNull();
  });

  it("the SVG file's own attributes are the source of truth — no renderer defaults", () => {
    document.body.innerHTML = '<span data-icon="wrench"></span>';
    applyIcons();
    const svg = document.querySelector("svg")!;
    // These come from wrench.svg itself, not from any normalization layer.
    expect(svg.getAttribute("width")).toBe("24");
    expect(svg.getAttribute("height")).toBe("24");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("stroke-width")).toBe("2");
    expect(svg.getAttribute("fill")).toBe("none");
  });

  it("placeholder attributes override the SVG file's own attributes", () => {
    document.body.innerHTML = '<span data-icon="car" width="18" height="18"></span>';
    applyIcons();
    const svg = document.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("18");
    expect(svg.getAttribute("height")).toBe("18");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
  });

  it("leaves no data-icon attribute on the injected SVG", () => {
    document.body.innerHTML = '<span data-icon="bell" class="icon"></span>';
    applyIcons();
    const svg = document.querySelector("svg")!;
    expect(svg.hasAttribute("data-icon")).toBe(false);
  });
});

describe("format-agnostic rendering (custom SVG formats)", () => {
  it("inlines a custom 512×512 colored SVG with its own attributes intact", () => {
    document.body.innerHTML = `<span data-icon="${CUSTOM_FORMAT_ICON}"></span>`;
    applyIcons();
    const svg = document.querySelector("svg")!;
    // File-owned rendering properties; the renderer injected nothing.
    expect(svg.getAttribute("viewBox")).toBe("0 0 512 512");
    expect(svg.getAttribute("width")).toBe("512");
    expect(svg.getAttribute("height")).toBe("512");
    expect(svg.getAttribute("fill")).toBeNull(); // no fill="none" injected
    expect(svg.getAttribute("stroke")).toBeNull(); // no stroke injected
    expect(svg.querySelector('rect[fill="#f2870d"]')).not.toBeNull();
    expect(svg.querySelector('circle[fill="#1f2937"]')).not.toBeNull();
  });

  it("placeholder attributes still override a custom SVG's own attributes", () => {
    document.body.innerHTML =
      `<span data-icon="${CUSTOM_FORMAT_ICON}" width="32" height="32" class="badge"></span>`;
    applyIcons();
    const svg = document.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("32");
    expect(svg.getAttribute("height")).toBe("32");
    expect(svg.getAttribute("class")).toBe("badge");
    expect(svg.getAttribute("viewBox")).toBe("0 0 512 512"); // untouched
    expect(svg.hasAttribute("data-icon")).toBe(false);
  });

  it("lucide-derived icons keep rendering exactly as before", () => {
    document.body.innerHTML = '<span data-icon="calendar-clock"></span>';
    applyIcons();
    const svg = document.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("stroke-width")).toBe("2");
    expect(svg.getAttribute("fill")).toBe("none");
  });
});
