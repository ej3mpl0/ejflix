import { describe, expect, it } from "vitest";
import {
  defaultStreamIndex,
  directTracks,
  indexTracks,
  mergeTracks,
  normalizeKind,
  pickByLang,
  sameTrack,
  selectedId,
  subtitlePreference,
  transcodeTracks,
  type MediaStreamLike,
  type NativeTrack,
} from "../player/tracks";

const matches = (lang: string | null | undefined, code: string): boolean => {
  const aliases: Record<string, string[]> = { spa: ["spa", "es"], eng: ["eng", "en"] };
  return Boolean(lang) && (aliases[code] ?? [code]).includes((lang ?? "").toLowerCase());
};

const audio: NativeTrack[] = [
  { id: "a0", language: "en", label: "English" },
  { id: "a1", language: "es", label: "" },
  { id: "a2", language: "", label: "" },
];

const streams: MediaStreamLike[] = [
  { Index: 0, Type: "Video", Codec: "h264" },
  { Index: 1, Type: "Audio", Codec: "aac", Language: "eng", DisplayTitle: "English - AAC", IsDefault: true },
  { Index: 2, Type: "Audio", Codec: "ac3", Language: "spa", DisplayTitle: "Español - AC3" },
  { Index: 3, Type: "Subtitle", Codec: "subrip", Language: "spa", DisplayTitle: "Español" },
  { Index: 4, Type: "Subtitle", Codec: "pgs", Language: "eng", DisplayTitle: null },
];

describe("normalizeKind", () => {
  it("accepts the mpv names and rejects anything else", () => {
    expect(normalizeKind("audio")).toBe("audio");
    expect(normalizeKind("sub")).toBe("sub");
    expect(normalizeKind("subtitle")).toBe("sub");
    expect(normalizeKind("video")).toBeNull();
  });
});

describe("directTracks", () => {
  it("numbers tracks from 1 and derives the title from label, language or a fallback", () => {
    const tracks = directTracks("audio", audio, audio[1]);
    expect(tracks.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(tracks.map((t) => t.title)).toEqual(["English", "es", "Pista 3"]);
    expect(tracks.map((t) => t.lang)).toEqual(["en", "es", null]);
    expect(tracks.map((t) => t.selected)).toEqual([false, true, false]);
    expect(tracks.every((t) => t.kind === "audio" && t.codec === null)).toBe(true);
  });

  it("marks nothing selected when the player has no current track", () => {
    expect(directTracks("sub", audio, null).some((t) => t.selected)).toBe(false);
  });

  it("indexTracks maps the same ids back to the native tracks", () => {
    const map = indexTracks(audio);
    expect(map.get(1)).toBe(audio[0]);
    expect(map.get(3)).toBe(audio[2]);
    expect(map.has(0)).toBe(false);
  });
});

describe("sameTrack", () => {
  it("compares by id when both have one, else by language and label", () => {
    expect(sameTrack({ id: "x", language: "en", label: "A" }, { id: "x", language: "es", label: "B" })).toBe(true);
    expect(sameTrack({ id: "x", language: "en", label: "A" }, { id: "y", language: "en", label: "A" })).toBe(false);
    expect(sameTrack({ language: "en", label: "A" }, { language: "en", label: "A" })).toBe(true);
    expect(sameTrack(null, { language: "en", label: "A" })).toBe(false);
  });
});

describe("transcodeTracks", () => {
  it("uses the Jellyfin stream index as id and keeps codec and language", () => {
    const tracks = transcodeTracks("audio", streams, 2);
    expect(tracks).toEqual([
      { id: 1, kind: "audio", title: "English - AAC", lang: "eng", selected: false, codec: "aac" },
      { id: 2, kind: "audio", title: "Español - AC3", lang: "spa", selected: true, codec: "ac3" },
    ]);
  });

  it("falls back to the language, then to a numbered title, and treats -1 as off", () => {
    const subs = transcodeTracks("sub", streams, -1);
    expect(subs.map((t) => t.title)).toEqual(["Español", "eng"]);
    expect(subs.some((t) => t.selected)).toBe(false);
    expect(transcodeTracks("sub", [{ Index: 9, Type: "Subtitle" }], null)[0].title).toBe("Pista 1");
  });

  it("defaultStreamIndex prefers the IsDefault stream, then the first of the type", () => {
    expect(defaultStreamIndex(streams, "Audio")).toBe(1);
    expect(defaultStreamIndex(streams, "Subtitle")).toBe(3);
    expect(defaultStreamIndex(streams, "Data")).toBeUndefined();
  });
});

describe("selectedId / mergeTracks", () => {
  it("returns the selected id per kind and 0 when none", () => {
    const all = mergeTracks(transcodeTracks("audio", streams, 1), transcodeTracks("sub", streams, 4));
    expect(all.map((t) => t.id)).toEqual([1, 2, 3, 4]);
    expect(selectedId(all, "audio")).toBe(1);
    expect(selectedId(all, "sub")).toBe(4);
    expect(selectedId(transcodeTracks("sub", streams, -1), "sub")).toBe(0);
  });
});

describe("language preferences", () => {
  it("pickByLang returns the first match and null without a preference", () => {
    expect(pickByLang(audio, "spa", matches)).toBe(audio[1]);
    expect(pickByLang(audio, "eng", matches)).toBe(audio[0]);
    expect(pickByLang(audio, "fra", matches)).toBeNull();
    expect(pickByLang(audio, "", matches)).toBeNull();
    expect(pickByLang(audio, "off", matches)).toBeNull();
  });

  it("subtitlePreference distinguishes off, default and a matching track", () => {
    expect(subtitlePreference(audio, "off", matches)).toEqual({ kind: "off" });
    expect(subtitlePreference(audio, "", matches)).toEqual({ kind: "default" });
    expect(subtitlePreference(audio, "spa", matches)).toEqual({ kind: "track", track: audio[1] });
    expect(subtitlePreference(audio, "jpn", matches)).toEqual({ kind: "default" });
  });
});
