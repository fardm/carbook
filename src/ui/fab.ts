/**
 * Floating action bar helpers.
 *
 * The `.fab-bar` is `position: fixed` and therefore centers relative to the
 * viewport, but on desktop the sidebar shifts the viewport center away from
 * the main content column. The bar is re-centered onto the app content box
 * here, and re-aligned whenever the window is resized. Mobile keeps the
 * default viewport centering (content spans the full width there).
 */
let resizeBound = false;

/** Centers the visible floating action bar on the main content column. */
export function alignFabBar(): void {
  if (!resizeBound) {
    resizeBound = true;
    window.addEventListener("resize", alignFabBar);
  }
  const fab = document.querySelector<HTMLElement>(".fab-bar");
  if (!fab) return;
  const desktop = window.matchMedia("(min-width: 900px)").matches;
  if (!desktop) {
    fab.style.left = "";
    fab.style.right = "";
    return;
  }
  const content = document.querySelector<HTMLElement>(".app-content");
  if (!content) return;
  const rect = content.getBoundingClientRect();
  const center = Math.round(rect.left + rect.width / 2);
  fab.style.left = `${center}px`;
  fab.style.right = "auto";
}
