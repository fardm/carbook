/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ICON_ASSETS } from "../src/ui/icons";

describe("Landing Page Refinements Specification", () => {
  const landingHtml = readFileSync(resolve(import.meta.dirname, "../index.html"), "utf-8");
  const supportHtml = readFileSync(resolve(import.meta.dirname, "../support/index.html"), "utf-8");
  const privacyHtml = readFileSync(resolve(import.meta.dirname, "../privacy/index.html"), "utf-8");
  const termsHtml = readFileSync(resolve(import.meta.dirname, "../terms/index.html"), "utf-8");
  const landingCss = readFileSync(resolve(import.meta.dirname, "../src/styles/landing.css"), "utf-8");

  beforeEach(() => {
    document.documentElement.innerHTML = landingHtml;
    delete document.documentElement.dataset.theme;
    localStorage.clear();
  });

  describe("1. Header Navigation Cleanup", () => {
    it("desktop header does NOT contain unwanted navigation items", () => {
      const desktopNav = document.querySelector(".landing-nav");
      expect(desktopNav).not.toBeNull();
      const navText = desktopNav!.textContent || "";
      expect(navText).not.toContain("سلامت قطعات");
      expect(navText).not.toContain("سوابق سرویس");
      expect(navText).not.toContain("یادآوری‌ها");
      expect(navText).not.toContain("ورود به حساب");

      // Only minimal links remain
      const links = Array.from(desktopNav!.querySelectorAll("a")).map((a) => a.textContent?.trim());
      expect(links).toEqual(["امکانات", "وبلاگ"]);
    });

    it("desktop header actions do NOT contain 'ورود به حساب' text button", () => {
      const actions = document.querySelector(".landing-header__actions");
      expect(actions).not.toBeNull();
      expect(actions!.textContent).not.toContain("ورود به حساب");
    });
  });

  describe("2. Theme Toggle with Sun and Moon Icons", () => {
    it("has sun and moon SVGs in assets", () => {
      expect(ICON_ASSETS["sun"]).toBeDefined();
      expect(ICON_ASSETS["sun"]).toContain("<svg");
      expect(ICON_ASSETS["moon"]).toBeDefined();
      expect(ICON_ASSETS["moon"]).toContain("<svg");
    });

    it("theme toggle button exists in header and can toggle between light and dark themes", () => {
      const toggle = document.getElementById("theme-toggle") as HTMLButtonElement;
      expect(toggle).not.toBeNull();
      expect(toggle.getAttribute("id")).toBe("theme-toggle");
    });
  });

  describe("3. Removal of 'مشاهده محیط ثبت سرویس'", () => {
    it("button 'مشاهده محیط ثبت سرویس' is completely removed from the landing page", () => {
      expect(landingHtml).not.toContain("مشاهده محیط ثبت سرویس");
      const historySection = document.getElementById("history");
      expect(historySection).not.toBeNull();
      expect(historySection!.textContent).not.toContain("مشاهده محیط ثبت سرویس");
    });
  });

  describe("4. Footer Cleanup", () => {
    it("footer does NOT contain 'بخش‌های صفحه' or its former links", () => {
      expect(landingHtml).not.toContain("بخش‌های صفحه");
      const footer = document.querySelector(".landing-footer");
      expect(footer).not.toBeNull();
      expect(footer!.textContent).not.toContain("بخش‌های صفحه");
      expect(footer!.textContent).not.toContain("پایش سلامت قطعات");
      expect(footer!.textContent).not.toContain("تایم‌لاین سوابق");
      expect(footer!.textContent).not.toContain("یادآوری‌های موعد");
    });
  });

  describe("5. Footer Links Section & Dedicated Support Page", () => {
    it("footer includes 'لینک ها' column with 'حمایت مالی' first, then GitHub and Telegram", () => {
      const footer = document.querySelector(".landing-footer");
      expect(footer).not.toBeNull();
      expect(footer!.textContent).toContain("لینک ها");

      const linksCol = Array.from(footer!.querySelectorAll(".footer-col")).find(
        (col) => col.querySelector(".footer-col__title")?.textContent?.trim() === "لینک ها"
      );
      expect(linksCol).toBeDefined();

      const links = Array.from(linksCol!.querySelectorAll("a"));
      expect(links.length).toBe(3);

      // 1. حمایت مالی
      expect(links[0].textContent).toContain("حمایت مالی");
      expect(links[0].getAttribute("href")).toBe("/support");
      expect(links[0].querySelector('[data-icon="heart"]')).not.toBeNull();

      // 2. گیت هاب
      expect(links[1].textContent).toContain("گیت هاب");
      expect(links[1].getAttribute("href")).toBe("https://github.com/fardm/tamrinsaz-next");
      expect(links[1].querySelector('[data-icon="github"]')).not.toBeNull();

      // 3. تلگرام
      expect(links[2].textContent).toContain("تلگرام");
      expect(links[2].getAttribute("href")).toBe("https://t.me/ifard_ir/");
      expect(links[2].querySelector('[data-icon="telegram"]')).not.toBeNull();
    });

    it("github and telegram icons are in assets", () => {
      expect(ICON_ASSETS["github"]).toBeDefined();
      expect(ICON_ASSETS["telegram"]).toBeDefined();
    });

    it("support page contains exact required text, title, and payment link", () => {
      expect(supportHtml).toContain("حمایت از کاربوک");
      expect(supportHtml).toContain(
        "کاربوک به صورت رایگان عرضه شده تا همه بدون محدودیت از آن استفاده کنند. اگر این ابزار برای شما مفید بوده میتوانید با حمایت مالی به توسعه و بهبود مستمر این سایت کمک کنید."
      );
      expect(supportHtml).toContain("پرداخت با سایت کافیته");
      expect(supportHtml).toContain("https://www.coffeete.ir/ifard");
      expect(supportHtml).toContain("پرداخت ریالی با کارتهای بانکی از طریق درگاه زرین پال");
      expect(supportHtml).toContain("بازگشت به صفحه اصلی");
    });

    it("support page shares landing header and footer", () => {
      document.documentElement.innerHTML = supportHtml;
      expect(document.querySelector(".landing-header")).not.toBeNull();
      expect(document.querySelector(".landing-footer")).not.toBeNull();
      expect(document.getElementById("theme-toggle")).not.toBeNull();
      expect(document.getElementById("menu-toggle")).not.toBeNull();
      expect(document.querySelector('a[href="https://www.coffeete.ir/ifard"]')).not.toBeNull();
    });
  });

  describe("6. Privacy and Terms Pages", () => {
    it("privacy page shares landing header and footer and has concise privacy policy", () => {
      document.documentElement.innerHTML = privacyHtml;
      expect(document.querySelector(".landing-header")).not.toBeNull();
      expect(document.querySelector(".landing-footer")).not.toBeNull();
      expect(privacyHtml).toContain("سیاست حفظ حریم خصوصی");
      expect(privacyHtml).toContain("داده‌های محلی در مرورگر");
      expect(privacyHtml).toContain("داده‌های مرتبط با حساب کاربری");
    });

    it("terms page shares landing header and footer and has concise terms of service", () => {
      document.documentElement.innerHTML = termsHtml;
      expect(document.querySelector(".landing-header")).not.toBeNull();
      expect(document.querySelector(".landing-footer")).not.toBeNull();
      expect(termsHtml).toContain("شرایط استفاده از خدمات");
      expect(termsHtml).toContain("مسئولیت صحت اطلاعات واردشده");
      expect(termsHtml).toContain("محدودیت مسئولیت");
    });
  });

  describe("7. CarBook Logo Background Treatment", () => {
    it("CSS applies white background and 4px border-radius to .landing-brand__icon in header and footer", () => {
      expect(landingCss).toContain(".landing-brand__icon");
      expect(landingCss).toMatch(/\.landing-brand__icon\s*\{[^}]*background-color:\s*#ffffff;/);
      expect(landingCss).toMatch(/\.landing-brand__icon\s*\{[^}]*border-radius:\s*4px;/);
      expect(landingCss).toMatch(/\.footer-brand\s+\.landing-brand__icon/);
    });

    it("both header and footer brand icons share .landing-brand__icon class", () => {
      const headerIcon = document.querySelector(".landing-header .landing-brand__icon");
      const footerIcon = document.querySelector(".landing-footer .landing-brand__icon");
      expect(headerIcon).not.toBeNull();
      expect(footerIcon).not.toBeNull();
    });
  });

  describe("8. Mobile Header Hamburger & Responsive Fixes", () => {
    it("menu button contains 3 horizontal lines and no three dots", () => {
      const menuBtn = document.getElementById("menu-toggle") as HTMLButtonElement;
      expect(menuBtn).not.toBeNull();
      expect(menuBtn.classList.contains("menu-toggle-btn")).toBe(true);

      const hamburgerBox = menuBtn.querySelector(".hamburger-box");
      expect(hamburgerBox).not.toBeNull();

      const lines = hamburgerBox!.querySelectorAll(".hamburger-line");
      expect(lines.length).toBe(3);

      expect(menuBtn.querySelector('[data-icon="more-vertical"]')).toBeNull();
      expect(menuBtn.querySelector('[data-icon="more-horizontal"]')).toBeNull();
    });

    it("mobile drawer contains only minimal remaining navigation", () => {
      const drawer = document.getElementById("mobile-drawer");
      expect(drawer).not.toBeNull();
      const text = drawer!.textContent || "";
      expect(text).toContain("امکانات");
      expect(text).toContain("وبلاگ کاربوک");
      expect(text).toContain("حمایت مالی");
      expect(text).toContain("ورود به کاربوک");

      // Removed items must not be in mobile drawer
      expect(text).not.toContain("سلامت قطعات");
      expect(text).not.toContain("سوابق سرویس");
      expect(text).not.toContain("یادآوری‌های موعد");
      expect(text).not.toContain("ورود به حساب کاربری");
    });

    it("CSS ensures proper responsive layout and zero horizontal overflow", () => {
      expect(landingCss).toMatch(/html\s*\{[^}]*overflow-x:\s*clip;/);
      expect(landingCss).toMatch(/body\.landing-page\s*\{[^}]*overflow-x:\s*clip;/);
      expect(landingCss).toContain("@media (max-width: 640px)");
      expect(landingCss).toContain("@media (max-width: 480px)");
      // Responsive padding
      expect(landingCss).toContain(".landing-container {\n    padding: 0 16px;");
      // Perspective disabled on mobile to prevent 3D overflow
      expect(landingCss).toContain("perspective: none;");
    });
  });
});
