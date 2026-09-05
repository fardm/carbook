/**
 * Floating-label fields — the small JS half of the form design system.
 *
 * Single-line text/number inputs cannot tell CSS whether they hold a value,
 * so this module keeps a `.field` in sync:
 *   - `is-focused` — the control currently has focus
 *   - `is-filled`  — the control currently holds a value
 *
 * The CSS floats `.field__label` whenever the field is focused or filled.
 * Controls that always display a value (selects, textareas) are floated
 * purely in CSS and never bound here. The date field's text input is a
 * plain `.field__input`, so it is bound here like any other input. Call
 * `bindFloatingFields(container)` after every render (right next to
 * `applyIcons()`); the container's markup is fresh on each render, so
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

    bindField(field, {
      hasValue: () => input.value.trim() !== "",
      focusTarget: input,
      valueSource: input,
    });
  });
}

/** Keeps one field's label floated while its control is focused or filled. */
function bindField(
  field: HTMLElement,
  opts: { hasValue: () => boolean; focusTarget: HTMLElement; valueSource: HTMLElement },
): void {
  const sync = (): void => {
    field.classList.toggle("is-filled", opts.hasValue());
  };
  const focus = (on: boolean): void => {
    field.classList.toggle("is-focused", on);
  };

  opts.focusTarget.addEventListener("focus", () => focus(true));
  opts.focusTarget.addEventListener("blur", () => {
    focus(false);
    sync();
  });
  opts.valueSource.addEventListener("input", sync);
  opts.valueSource.addEventListener("change", sync);

  // Initial state (covers prefilled edit forms before the first paint).
  sync();
  if (document.activeElement === opts.focusTarget) focus(true);
}
