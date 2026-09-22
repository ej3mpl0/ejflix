import { useEffect, useState } from "react";
import { getColors } from "react-native-image-colors";
import { hexToHsl, hslToHex } from "../theme/color";
import { useTheme } from "../theme/ThemeProvider";

/**
 * Port of the desktop `dominant-color.ts`: the most present saturated colour of a
 * backdrop, darkened to a background tint (S ≤ 45 %, L = 16 %). Returns a hex string
 * or `null` (no url, failure, greyscale picture, AMOLED theme) so callers fall back
 * to the theme base colour.
 */

const cache = new Map<string, string | null>();
const CACHE_MAX = 50;

function remember(url: string, value: string | null) {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(url, value);
}

/** Small variant of a Jellyfin image URL so the sampler downloads a few KB. */
function thumbUrl(url: string): string {
  if (!/\/Images\//.test(url)) return url;
  const stripped = url.replace(/([?&])(maxWidth|maxHeight|quality)=[^&]*/g, "$1").replace(/[?&]+$/, "").replace(/[?&]{2,}/g, "&");
  const sep = stripped.includes("?") ? "&" : "?";
  return `${stripped}${sep}maxWidth=96&quality=60`;
}

function darken(hex: string): string | null {
  const { h, s } = hexToHsl(hex);
  if (s < 0.2) return null;
  return hslToHex(h, Math.min(0.45, s), 0.16);
}

async function sample(url: string): Promise<string | null> {
  const result = await getColors(thumbUrl(url), { cache: true, key: url, quality: "low", fallback: "#000000" });
  let picked: string | null = null;
  if (result.platform === "android" || result.platform === "web") {
    picked = darken(result.vibrant) ?? darken(result.dominant) ?? darken(result.darkVibrant) ?? darken(result.muted);
  } else if (result.platform === "ios") {
    picked = darken(result.primary) ?? darken(result.background) ?? darken(result.secondary);
  }
  return picked;
}

export function useDominantColor(url: string | null | undefined): string | null {
  const t = useTheme();
  const [color, setColor] = useState<string | null>(() => (url ? cache.get(url) ?? null : null));

  useEffect(() => {
    if (!url) {
      setColor(null);
      return;
    }
    if (cache.has(url)) {
      setColor(cache.get(url) ?? null);
      return;
    }
    let alive = true;
    sample(url)
      .then((value) => {
        remember(url, value);
        if (alive) setColor(value);
      })
      .catch(() => {
        remember(url, null);
        if (alive) setColor(null);
      });
    return () => {
      alive = false;
    };
  }, [url]);

  return t.amoled ? null : color;
}
