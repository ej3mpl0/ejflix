/** Preset avatars for local profiles (`preset:<index>`) and the photo import helper. */
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

/** CSS gradient of a `preset:n` avatar, null for anything else. */
export function presetGradient(avatar: string | null | undefined): string | null {
  if (!avatar?.startsWith("preset:")) return null;
  const index = Number(avatar.slice(7));
  const pair = AVATAR_PRESETS[index] ?? AVATAR_PRESETS[0];
  return `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`;
}

const AVATAR_SIZE = 256;

/** Reads an image file, crops it to a centred square and returns a small JPEG data URL. */
export function fileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      if (!side) {
        reject(new Error("Imagen no válida"));
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = AVATAR_SIZE;
      canvas.height = AVATAR_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas no disponible"));
        return;
      }
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
      resolve(canvas.toDataURL("image/jpeg", 0.86));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Imagen no válida"));
    };
    img.src = url;
  });
}
