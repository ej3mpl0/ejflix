/**
 * Shared class strings for form controls, so every text field in the app looks the same.
 * `field-own-focus` drops the app-wide outline: the accent border is the focus ring.
 */
export const fieldClass =
  "field-own-focus h-11 w-full rounded-btn border border-white/12 bg-black/40 px-3 text-sm text-text outline-none placeholder:text-dim focus:border-accent focus:ring-2 focus:ring-accent/25";

/** Taller variant for the onboarding screens (sign-in, profiles), where the form is the page. */
export const fieldLgClass =
  "field-own-focus h-12 w-full rounded-btn border border-white/12 bg-black/40 px-4 text-[15px] text-text outline-none placeholder:text-dim focus:border-accent focus:ring-2 focus:ring-accent/25";

/** Label above a field. */
export const labelClass = "mb-1.5 block text-[13px] font-medium text-text";
