import { describe, expect, it } from "vitest";
import {
  catalogExtras,
  catalogPath,
  parseManifest,
  parseMeta,
  parseMetaFull,
  parseStream,
  percentEncode,
  supports,
  upsertProgressList,
} from "../addons.pure";
import type { ResumeEntry } from "../../lib/types";

const URL = "https://addon.example/manifest.json";

describe("addons.pure", () => {
  it("encodes like the Rust urlencoding_lite", () => {
    expect(percentEncode("tt123:1:2")).toBe("tt123%3A1%3A2");
    expect(percentEncode("a b'(é)~")).toBe("a%20b%27%28%C3%A9%29~");
  });

  it("builds catalog paths with extras as a path segment", () => {
    expect(catalogPath(URL, "movie", "top", [])).toBe("https://addon.example/catalog/movie/top.json");
    const extra = catalogExtras({ search: " star wars ", genre: "", skip: 40 });
    expect(extra).toEqual([
      ["search", "star wars"],
      ["skip", "40"],
    ]);
    expect(catalogPath(URL, "movie", "top", extra)).toBe(
      "https://addon.example/catalog/movie/top/search=star%20wars&skip=40.json",
    );
    expect(catalogExtras({ skip: 0, genre: "Drama" })).toEqual([["genre", "Drama"]]);
  });

  it("parses manifests and resolves supports()", () => {
    const addon = parseManifest(
      URL,
      {
        id: "org.test",
        name: "Test",
        version: "1.0.0",
        types: ["movie", "series"],
        idPrefixes: ["tt"],
        resources: ["catalog", { name: "meta", types: ["series"], idPrefixes: ["kitsu:"] }, "stream"],
        catalogs: [
          { type: "movie", id: "top", name: "Top", extra: [{ name: "genre", options: ["Drama", "Action"] }] },
          { type: "movie", id: "search", extraRequired: ["search"], extraSupported: ["search"] },
          { type: "series", extra: [{ name: "search", isRequired: true }] },
        ],
      },
      false,
    );
    expect(addon.info.name).toBe("Test");
    expect(addon.info.resources).toEqual(["catalog", "meta", "stream"]);
    expect(addon.info.catalogs).toHaveLength(2);
    expect(addon.info.catalogs[0]).toMatchObject({ name: "Top", searchable: false, requiresExtra: false, genres: ["Drama", "Action"] });
    expect(addon.info.catalogs[1]).toMatchObject({ name: "search", searchable: true, requiresExtra: true, genres: [] });
    expect(supports(addon, "stream", "movie", "tt1")).toBe(true);
    expect(supports(addon, "stream", "movie", "kitsu:1")).toBe(false);
    expect(supports(addon, "stream", "anime", "tt1")).toBe(false);
    expect(supports(addon, "meta", "series", "kitsu:1")).toBe(true);
    expect(supports(addon, "meta", "movie", "kitsu:1")).toBe(false);
    expect(supports(addon, "subtitles", "movie", "tt1")).toBe(false);
    expect(() => parseManifest(URL, { id: "x" }, false)).toThrow("El manifest no tiene nombre");
  });

  it("parses metas", () => {
    const meta = parseMeta({ id: "tt0944947:1:2", name: " GoT ", releaseInfo: "2011-2019", imdbRating: "9.2", genres: ["Drama"] });
    expect(meta).toMatchObject({ id: "tt0944947:1:2", type: "movie", name: "GoT", imdb: "tt0944947", year: 2011, imdbRating: 9.2 });
    expect(parseMeta({ id: "x" })).toBeNull();
    const full = parseMetaFull({
      id: "tt1",
      name: "Show",
      type: "series",
      year: 2020,
      cast: ["A"],
      videos: [{ id: "tt1:1:1", name: "Pilot", season: 1, number: 1, firstAired: "2020-01-01" }, { title: "no id" }],
    });
    expect(full?.year).toBe(2020);
    expect(full?.videos).toEqual([
      { id: "tt1:1:1", title: "Pilot", season: 1, episode: 1, released: "2020-01-01", thumbnail: null, overview: null },
    ]);
  });

  it("parses streams", () => {
    const addon = parseManifest(URL, { name: "Test", resources: ["stream"] }, false).info;
    const s = parseStream(addon, {
      title: "1080p",
      url: "https://cdn/x.mkv",
      behaviorHints: { bingeGroup: "g1", filename: "x.mkv", videoSize: 123, proxyHeaders: { request: { Referer: "https://r" } } },
    });
    expect(s).toMatchObject({ addonName: "Test", name: "Test", title: "1080p", playable: true, bingeGroup: "g1", videoSize: 123, headers: [["Referer", "https://r"]] });
    expect(parseStream(addon, { url: "magnet:?x" })).toBeNull();
    expect(parseStream(addon, { infoHash: "abc", description: "torrent" })).toMatchObject({ playable: false, title: "torrent", infoHash: "abc" });
  });

  it("upserts progress like the desktop", () => {
    const entry = (key: string, pos: number, dur: number): ResumeEntry => ({
      key,
      type: "movie",
      metaId: key,
      name: key,
      seriesName: null,
      poster: null,
      background: null,
      logo: null,
      season: null,
      episode: null,
      imdb: null,
      positionSeconds: pos,
      durationSeconds: dur,
      updatedMs: 1,
    });
    let list = upsertProgressList([], entry("a", 10, 100));
    list = upsertProgressList(list, entry("b", 20, 100));
    expect(list.map((e) => e.key)).toEqual(["b", "a"]);
    list = upsertProgressList(list, entry("a", 96, 100));
    expect(list.map((e) => e.key)).toEqual(["b"]);
    list = upsertProgressList(list, entry("c", 3, 100));
    expect(list.map((e) => e.key)).toEqual(["b"]);
    list = upsertProgressList(list, entry("b", 50, 0));
    expect(list.map((e) => e.key)).toEqual(["b"]);
    for (let i = 0; i < 150; i++) list = upsertProgressList(list, entry(`k${i}`, 10, 100));
    expect(list).toHaveLength(100);
  });
});
