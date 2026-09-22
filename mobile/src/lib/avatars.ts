/** Preset avatars for local profiles (`preset:<index>`). */
export const AVATAR_PRESETS: [string, string][] = [
  ["#f6121d", "#7a0410"],
  ["#ff7a18", "#af002d"],
  ["#ffd45c", "#e8a91c"],
  ["#22d37c", "#0b6b45"],
  ["#4de3ff", "#3185f5"],
  ["#8e24aa", "#4a148c"],
  ["#e8b4a0", "#b76e5a"],
  ["#c9d1d9", "#6b7480"],
  ["#1e88e5", "#0d47a1"],
  ["#ff5c8a", "#c2185b"],
  ["#00c9a7", "#005f73"],
  ["#f5f5f5", "#9aa3ad"],
];

export function presetId(index: number): string {
  return `preset:${index}`;
}

/** Gradient stops of a `preset:n` avatar, null for anything else. */
export function presetGradient(avatar: string | null | undefined): [string, string] | null {
  if (!avatar?.startsWith("preset:")) return null;
  const index = Number(avatar.slice(7));
  return AVATAR_PRESETS[index] ?? AVATAR_PRESETS[0];
}
