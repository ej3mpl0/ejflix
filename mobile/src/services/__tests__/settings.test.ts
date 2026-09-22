import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../lib/types";
import { deepMerge, langOrEmpty, mergeSettings, normalizeManifestUrl, sanitize, utf8Length } from "../settings.pure";

describe("sanitize", () => {
  it("returns the defaults for garbage", () => {
    expect(sanitize(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitize(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitize("nope")).toEqual(DEFAULT_SETTINGS);
    expect(sanitize([])).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps and coerces every field like settings.rs", () => {
    const out = sanitize({
      appearance: { theme: "neon", amoled: "yes", posterSize: "huge" },
      playback: {
        skipIntro: "auto",
        skipRecap: "maybe",
        nextEpisodeCountdown: 7,
        audioLanguage: " SPA ",
        subtitleLanguage: "OFF",
        lastSpeed: 99,
      },
      library: { pinned: ["abcdefgh", "abcdefgh", "short", 12, "ijklmnopqrstuvwxyz"] },
      addons: { urls: ["stremio://example.com/addon/", "ftp://nope", "https://a.b/manifest.json", "https://a.b"] },
      discord: { clientId: " 12ab34 ", details: "x".repeat(200), header: "banner" },
      iptv: { epg: false },
      unknown: { key: true },
    });
    expect(out.appearance).toEqual({ theme: "crimson", amoled: false, posterSize: "medium" });
    expect(out.playback.skipIntro).toBe("auto");
    expect(out.playback.skipRecap).toBe("ask");
    expect(out.playback.nextEpisodeCountdown).toBe(5);
    expect(out.playback.audioLanguage).toBe("spa");
    expect(out.playback.subtitleLanguage).toBe("off");
    expect(out.playback.lastSpeed).toBe(4);
    expect(out.library.pinned).toEqual(["abcdefgh", "ijklmnopqrstuvwxyz"]);
    expect(out.addons.urls).toEqual(["https://example.com/addon/manifest.json", "https://a.b/manifest.json"]);
    expect(out.addons.cinemeta).toBe(true);
    expect(out.discord.clientId).toBe("1234");
    expect(out.discord.details).toHaveLength(128);
    expect(out.discord.header).toBe("details");
    expect(out.iptv).toEqual({ autoRefresh: true, epg: false, wheelZap: false });
    expect(out).not.toHaveProperty("unknown");
  });

  it("keeps a valid object intact", () => {
    const valid = {
      ...DEFAULT_SETTINGS,
      appearance: { theme: "ocean", amoled: true, posterSize: "large" },
      playback: { ...DEFAULT_SETTINGS.playback, lastSpeed: 1.5, nextEpisodeCountdown: 15, subtitleLanguage: "eng" },
    };
    expect(sanitize(valid)).toEqual(valid);
  });

  it("truncates pinned libraries to 24 and addon urls to 30", () => {
    const pinned = Array.from({ length: 30 }, (_, i) => `library-${String(i).padStart(4, "0")}`);
    const urls = Array.from({ length: 40 }, (_, i) => `https://addon${i}.test`);
    const out = sanitize({ library: { pinned }, addons: { urls } });
    expect(out.library.pinned).toHaveLength(24);
    expect(out.addons.urls).toHaveLength(30);
  });
});

describe("langOrEmpty", () => {
  it("accepts 2-3 lowercase letters, off only when allowed", () => {
    expect(langOrEmpty("es", false)).toBe("es");
    expect(langOrEmpty("SPA", false)).toBe("spa");
    // "off" is three lowercase letters, so it passes either way (same as settings.rs).
    expect(langOrEmpty("off", false)).toBe("off");
    expect(langOrEmpty("off", true)).toBe("off");
    expect(langOrEmpty(" Off ", true)).toBe("off");
    expect(langOrEmpty("span", false)).toBe("");
    expect(langOrEmpty("e1", false)).toBe("");
    expect(langOrEmpty(42, false)).toBe("");
  });
});

describe("normalizeManifestUrl", () => {
  it("normalizes like addons.rs", () => {
    expect(normalizeManifestUrl("stremio://x.y/z")).toBe("https://x.y/z/manifest.json");
    expect(normalizeManifestUrl("  https://x.y/z/  ")).toBe("https://x.y/z/manifest.json");
    expect(normalizeManifestUrl("http://x.y/manifest.json")).toBe("http://x.y/manifest.json");
    expect(() => normalizeManifestUrl("")).toThrow("URL de addon no válida");
    expect(() => normalizeManifestUrl("x.y")).toThrow("La URL del addon debe empezar por http:// o https://");
  });
});

describe("deepMerge", () => {
  it("merges nested objects and replaces everything else", () => {
    const target = { a: { b: 1, c: 2 }, list: [1, 2], keep: true };
    deepMerge(target, { a: { b: 5, d: { e: 1 } }, list: [3] });
    expect(target).toEqual({ a: { b: 5, c: 2, d: { e: 1 } }, list: [3], keep: true });
  });
  it("returns the patch when either side is not an object", () => {
    expect(deepMerge(1, { a: 1 })).toEqual({ a: 1 });
    expect(deepMerge({ a: 1 }, 2)).toBe(2);
  });
});

describe("mergeSettings", () => {
  it("applies a partial patch on top of the stored object", () => {
    const stored = { appearance: { theme: "gold", amoled: true }, playback: { lastSpeed: 2 } };
    const out = mergeSettings(stored, { appearance: { theme: "jade" }, playback: { rememberSpeed: true } });
    expect(out.appearance).toEqual({ theme: "jade", amoled: true, posterSize: "medium" });
    expect(out.playback.lastSpeed).toBe(2);
    expect(out.playback.rememberSpeed).toBe(true);
    // the stored value is not mutated
    expect(stored.appearance.theme).toBe("gold");
  });
  it("rejects non-objects and oversized patches", () => {
    expect(() => mergeSettings({}, "x")).toThrow("Ajustes no válidos");
    expect(() => mergeSettings({}, null)).toThrow("Ajustes no válidos");
    expect(() => mergeSettings({}, { discord: { details: "é".repeat(20_000) } })).toThrow("Ajustes demasiado grandes");
  });
});

describe("utf8Length", () => {
  it("counts bytes", () => {
    expect(utf8Length("abc")).toBe(3);
    expect(utf8Length("é")).toBe(2);
    expect(utf8Length("€")).toBe(3);
    expect(utf8Length("😀")).toBe(4);
  });
});
