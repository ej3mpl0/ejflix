import { useEffect, useSyncExternalStore } from "react";
import { dominantHue } from "./dominant-color";

/**
 * "Auto" accent: the hero and the details pages report the artwork they show; the newest
 * one that has artwork tints the accent. Owners keep their place when they update, so an
 * open details page stays in charge while the hero behind it changes slide.
 */
const owners = new Map<string, string | null>();
const listeners = new Set<() => void>();
let current: string | null = null;

function publish() {
  let next: string | null = null;
  for (const url of owners.values()) if (url) next = url;
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

/** Reports the artwork `owner` is showing (null: none) for as long as the caller is mounted. */
export function useArtworkAccent(owner: string, url: string | null | undefined): void {
  useEffect(() => {
    owners.set(owner, url ?? null);
    publish();
  }, [owner, url]);
  useEffect(
    () => () => {
      owners.delete(owner);
      publish();
    },
    [owner],
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// --- colour maths (sRGB, WCAG 2.x relative luminance) ---

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function parseHex(value: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (rgb: [number, number, number]) =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

/** Text colour on the accent: the darkest ink the app uses. */
const ON_ACCENT: [number, number, number] = [13, 13, 13];

/**
 * An accent from an artwork hue that passes WCAG AA (4.5:1) both ways it is used: as
 * text on the lightest panel and as a fill under `ON_ACCENT` text. Saturation is clamped
 * so washed-out or neon artwork still gives a pleasant colour; lightness only goes up
 * until the contrast holds.
 */
export function readableAccent(hue: number, saturation: number, panel: [number, number, number]): string {
  const s = Math.min(0.85, Math.max(0.5, saturation));
  let l = 0.55;
  let rgb = hslToRgb(hue, s, l);
  while (l < 0.92 && (contrast(rgb, panel) < 4.5 || contrast(rgb, ON_ACCENT) < 4.5)) {
    l += 0.02;
    rgb = hslToRgb(hue, s, l);
  }
  return toHex(rgb);
}

const PROPS = ["--color-accent", "--color-on-accent", "--color-accent-hover", "--color-accent-press"] as const;

function clear() {
  const style = document.documentElement.style;
  for (const prop of PROPS) style.removeProperty(prop);
}

/**
 * Applies the auto accent on `<html>` while `enabled` (the profile chose "Auto"); without
 * artwork, or with greyscale artwork, the profile's own theme shows through.
 */
export function useAutoAccent(enabled: boolean): void {
  const url = useSyncExternalStore(subscribe, () => current);

  useEffect(() => {
    if (!enabled || !url) {
      clear();
      return;
    }
    let alive = true;
    void dominantHue(url).then((hs) => {
      if (!alive) return;
      if (!hs) {
        clear();
        return;
      }
      const root = document.documentElement;
      const panel = parseHex(getComputedStyle(root).getPropertyValue("--color-panel")) ?? [36, 36, 36];
      const accent = readableAccent(hs[0], hs[1], panel);
      root.style.setProperty("--color-accent", accent);
      root.style.setProperty("--color-on-accent", toHex(ON_ACCENT));
      root.style.setProperty("--color-accent-hover", `color-mix(in oklab, ${accent} 88%, white)`);
      root.style.setProperty("--color-accent-press", `color-mix(in oklab, ${accent} 80%, black)`);
    });
    return () => {
      alive = false;
    };
  }, [enabled, url]);

  useEffect(() => () => clear(), []);
}
