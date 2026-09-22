import type { MessageKey } from "./i18n";

export const ASPECT_MODES = ["auto", "16:9", "4:3", "2.35:1", "fill"] as const;
export type AspectMode = (typeof ASPECT_MODES)[number];

export function nextAspect(current: string): AspectMode {
  const index = ASPECT_MODES.indexOf(current as AspectMode);
  return ASPECT_MODES[(index + 1) % ASPECT_MODES.length];
}

/** Label for the chip: translated for auto/fill, the ratio itself otherwise. */
export function aspectLabel(mode: string, t: (key: MessageKey) => string): string {
  if (mode === "auto") return t("aspectAuto");
  if (mode === "fill") return t("aspectFill");
  return mode;
}
