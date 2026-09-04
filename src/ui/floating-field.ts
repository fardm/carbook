/**
 * Floating-label fields — the small JS half of the form design system.
 *
 * Single-line text/number inputs cannot tell CSS whether they hold a value,
 * so this module keeps a `.field` in sync:
 *   - `is-focused` — the control currently has focus
 *   - `is-filled`  — the control currently holds a value
 *
 * The CSS floats `.field__label` whenever the field is focused or filled.
 * Controls that always display a value or an empty-state hint (selects,
 * date triggers and textareas) are floated purely in CSS and never bound
 * here. Call `bindFloatingFields(container)` after every render (right next
 * to `applyIcons()`); the container's markup is fresh on each render, so
 * re-binding is safe and idempotent.
 */
export function bindFloatingFields(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>(".field").forEach((field) => {
    const control = field.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      "input.field__input, textarea.field__input",
    );
    if (!control) return;
    if (control instanceof HTMLTextAreaElement) return; // always-floated in CSS
    const input = control as HTMLInputElement;
    if (input.type === "hidden" || input.type === "checkbox" || input.type === "radio") return;

    const sync = (): void => {
      const filled = input.value.trim() !== "";
      field.classList.toggle("is-filled", filled);
    };
    const focus = (on: boolean): void => {
      field.classList.toggle("is-focused", on);
    };

    input.addEventListener("focus", () => focus(true));
    input.addEventListener("blur", () => {
      focus(false);
      sync();
    });
    input.addEventListener("input", sync);
    input.addEventListener("change", sync);

    // Initial state (covers prefilled edit forms before the first paint).
    sync();
    if (document.activeElement === input) focus(true);
  });
}
