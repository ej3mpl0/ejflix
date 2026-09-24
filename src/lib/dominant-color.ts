import { useEffect, useState } from "react";

const cache = new Map<string, string | null>();
const CACHE_MAX = 50;
const SAMPLE_W = 32;
const SAMPLE_H = 18;

function remember(url: string, value: string | null) {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(url, value);
}

/** Small variant of a jfimg URL so the sampler downloads a few KB. */
function thumbUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("maxWidth", "96");
    u.searchParams.set("quality", "60");
    return u.toString();
  } catch {
    return url;
  }
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

/** Hue and saturation of the most present saturated colour, or null (CORS, greyscale...). */
function dominantHs(img: HTMLImageElement): [number, number] | null {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_W;
  canvas.height = SAMPLE_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, SAMPLE_W, SAMPLE_H);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
  } catch {
    return null; // tainted canvas
  }
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const [, s, l] = rgbToHsl(r, g, b);
    if (l < 0.08 || l > 0.92 || s < 0.2) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  let best: { count: number; r: number; g: number; b: number } | null = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket;
  }
  if (!best || best.count < 4) return null;
  const [h, s] = rgbToHsl(best.r / best.count, best.g / best.count, best.b / best.count);
  return [h, s];
}

/**
 * Most present saturated colour of an image, darkened to a background tint
 * (`hsl(h s% l%)` with L in 12–22 %). `null` when it cannot be computed (CORS, decode
 * error, greyscale picture), so callers fall back to the theme background.
 */
function sample(img: HTMLImageElement): string | null {
  const hs = dominantHs(img);
  if (!hs) return null;
  const [h, s] = hs;
  const sat = Math.min(0.45, s);
  const light = 0.16;
  return `hsl(${Math.round(h)} ${Math.round(sat * 100)}% ${Math.round(light * 100)}%)`;
}

export function useDominantColor(url: string | null | undefined): string | null {
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
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      const value = sample(img);
      remember(url, value);
      if (alive) setColor(value);
    };
    img.onerror = () => {
      remember(url, null);
      if (alive) setColor(null);
    };
    img.src = thumbUrl(url);
    return () => {
      alive = false;
    };
  }, [url]);

  return color;
}

const hsCache = new Map<string, Promise<[number, number] | null>>();

/** Hue (degrees) and saturation (0–1) of the dominant colour of an image, for the auto accent. */
export function dominantHue(url: string): Promise<[number, number] | null> {
  let job = hsCache.get(url);
  if (!job) {
    job = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => resolve(dominantHs(img));
      img.onerror = () => resolve(null);
      img.src = thumbUrl(url);
    });
    if (hsCache.size >= CACHE_MAX) {
      const first = hsCache.keys().next().value;
      if (first !== undefined) hsCache.delete(first);
    }
    hsCache.set(url, job);
  }
  return job;
}
