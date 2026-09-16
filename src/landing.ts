/**
 * CarBook Landing Page Interactive Scripts
 * Handles theme toggling, mobile drawer, scroll reveals, and icon rendering.
 */

import { applyIcons } from "./ui/icons";

function initTheme(): void {
  const themeToggle = document.getElementById("theme-toggle");
  const themeIcon = document.getElementById("theme-toggle-icon");
  if (!themeToggle) return;

  const getTheme = (): "dark" | "light" => {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  };

  const updateIcon = (theme: "dark" | "light") => {
    if (!themeIcon) return;
    // Set sun or moon icon
    themeIcon.setAttribute("data-icon", theme === "dark" ? "lightbulb" : "spark-plug");
    applyIcons();
  };

  updateIcon(getTheme());

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
    updateIcon(next);
  });
}

function initMobileMenu(): void {
  const toggleBtn = document.getElementById("menu-toggle");
  const drawer = document.getElementById("mobile-drawer");
  if (!toggleBtn || !drawer) return;

  const setOpen = (open: boolean) => {
    drawer.classList.toggle("is-open", open);
    toggleBtn.setAttribute("aria-expanded", String(open));
  };

  toggleBtn.addEventListener("click", () => {
    const isOpen = drawer.classList.contains("is-open");
    setOpen(!isOpen);
  });

  drawer.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setOpen(false));
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
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootLanding);
} else {
  bootLanding();
}
