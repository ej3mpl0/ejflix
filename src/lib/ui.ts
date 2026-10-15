/**
 * Shared class strings for form controls, so every text field in the app looks the same.
 * `field-own-focus` drops the app-wide outline: the white ring is the focus state.
 */
export const fieldClass =
  "field-own-focus h-11 w-full rounded-btn border border-transparent bg-surface px-3.5 text-sm text-text outline-none placeholder:text-dim hover:bg-panel focus:bg-panel focus:shadow-[inset_0_0_0_2px_var(--color-text)]";

/** Taller variant for the onboarding screens (sign-in, profiles), where the form is the page. */
export const fieldLgClass =
  "field-own-focus h-[50px] w-full rounded-btn border border-transparent bg-surface px-4 text-[16px] text-text outline-none placeholder:text-dim hover:bg-panel focus:bg-panel focus:shadow-[inset_0_0_0_2px_var(--color-text)]";

/** Label above a field. */
export const labelClass = "mb-1.5 block text-[13px] font-medium text-text";
