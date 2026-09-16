/**
 * CarBook Landing Page Interactive Scripts
 * Handles theme toggling, mobile drawer, scroll reveals, and icon rendering.
 */

import { ICON_ASSETS, applyIcons } from "./ui/icons";
import { registerServiceWorker } from "./pwa";

function initTheme(): void {
  const themeToggle = document.getElementById("theme-toggle");
  if (!themeToggle) return;

  const getTheme = (): "dark" | "light" => {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  };

  const updateThemeUI = (theme: "dark" | "light") => {
    const iconName = theme === "dark" ? "moon" : "sun";
    const label =
      theme === "dark"
        ? "حالت تیره (کلیک برای تغییر به حالت روشن)"
        : "حالت روشن (کلیک برای تغییر به حالت تیره)";
    themeToggle.setAttribute("aria-label", label);
    themeToggle.setAttribute("title", label);

    const svgMarkup = ICON_ASSETS[iconName];
    if (svgMarkup) {
      themeToggle.innerHTML = svgMarkup;
      const svg = themeToggle.querySelector("svg");
      if (svg) {
        svg.setAttribute("class", "theme-toggle__svg");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("width", "20");
        svg.setAttribute("height", "20");
      }
    }
  };

  updateThemeUI(getTheme());

  themeToggle.addEventListener("click", () => {
    const current = getTheme();
    const next = current === "dark" ? "light" : "dark";
    if (next === "dark") {
      document.documentElement.dataset.theme = "dark";
    } else {
      delete document.documentElement.dataset.theme;
    }
    try {
      localStorage.setItem("carbook-landing-theme", next);
    } catch {
      /* ignore */
    }
    updateThemeUI(next);
  });
}

function initMobileMenu(): void {
  const toggleBtn = document.getElementById("menu-toggle");
  const drawer = document.getElementById("mobile-drawer");
  const backdrop = document.getElementById("mobile-nav-backdrop");
  const closeBtn = document.getElementById("drawer-close");
  if (!toggleBtn || !drawer) return;

  const setOpen = (open: boolean) => {
    drawer.classList.toggle("is-open", open);
    if (backdrop) backdrop.classList.toggle("is-open", open);
    toggleBtn.setAttribute("aria-expanded", String(open));
    toggleBtn.setAttribute("aria-label", open ? "بستن منو" : "باز کردن منو");
    drawer.setAttribute("aria-hidden", String(!open));
    document.body.classList.toggle("drawer-open", open);
  };

  toggleBtn.addEventListener("click", () => {
    const isOpen = drawer.classList.contains("is-open");
    setOpen(!isOpen);
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", () => setOpen(false));
  }

  if (backdrop) {
    backdrop.addEventListener("click", () => setOpen(false));
  }

  drawer.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setOpen(false));
  });

  document.addEventListener("click", (e) => {
    if (!drawer.classList.contains("is-open")) return;
    const target = e.target as Node | null;
    if (
      target &&
      !drawer.contains(target) &&
      !toggleBtn.contains(target) &&
      (!backdrop || !backdrop.contains(target))
    ) {
      setOpen(false);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer.classList.contains("is-open")) {
      setOpen(false);
    }
  });
}

function initScrollReveals(): void {
  if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
    document.querySelectorAll(".reveal-on-scroll").forEach((el) => el.classList.add("is-revealed"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
  );

  document.querySelectorAll(".reveal-on-scroll").forEach((el) => observer.observe(el));
}

function bootLanding(): void {
  initTheme();
  initMobileMenu();
  initScrollReveals();
  applyIcons();
  registerServiceWorker();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootLanding);
} else {
  bootLanding();
}
