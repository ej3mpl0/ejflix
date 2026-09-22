import { describe, expect, it } from "vitest";
import { cueTextAt, decodeSubtitleBytes, parseSubtitles } from "../../lib/subtitles";
import { parseStremioCollection, parseTrailers } from "../addons.pure";
import { normalizeManifestUrl, sanitize } from "../settings.pure";

const SRT = `1
00:00:01,000 --> 00:00:03,500
<i>Hola</i> mundo

2
00:00:03,000 --> 00:00:05,000 X1:0
Segunda línea
de dos

3
bad --> worse
nada
`;

describe("subtitles", () => {
  it("parses SRT cues, tags stripped, bad blocks skipped", () => {
    const cues = parseSubtitles(SRT);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 1, end: 3.5, text: "Hola mundo" });
    expect(cues[1].text).toBe("Segunda línea\nde dos");
  });

  it("parses WebVTT without hours", () => {
    const cues = parseSubtitles("WEBVTT\n\n00:01.200 --> 00:02.000\nHi\n");
    expect(cues).toEqual([{ start: 1.2, end: 2, text: "Hi" }]);
  });

  it("stacks overlapping cues and is empty between them", () => {
    const cues = parseSubtitles(SRT);
    expect(cueTextAt(cues, 0.5)).toBe("");
    expect(cueTextAt(cues, 3.2)).toBe("Hola mundo\nSegunda línea\nde dos");
    expect(cueTextAt(cues, 6)).toBe("");
  });

  it("decodes UTF-8, and Windows-1252 when the bytes are not UTF-8", () => {
    expect(decodeSubtitleBytes(new Uint8Array([0xc3, 0xb1]))).toBe("ñ");
    expect(decodeSubtitleBytes(new Uint8Array([0xf1, 0x93, 0x61]))).toBe("ñ“a");
    expect(decodeSubtitleBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe("A");
  });
});

describe("addon import and trailers", () => {
  it("reads a Stremio collection without Cinemeta or the local addon", () => {
    const list = parseStremioCollection(
      {
        result: {
          addons: [
            { transportUrl: "https://v3-cinemeta.strem.io/manifest.json", manifest: { name: "Cinemeta" } },
            { transportUrl: "http://127.0.0.1:11470/local-addon/manifest.json", manifest: { name: "Local" } },
            { transportUrl: "https://torrentio.strem.fun/manifest.json", manifest: { name: "Torrentio" } },
            { transportUrl: "https://torrentio.strem.fun/manifest.json", manifest: { name: "Dup" } },
            { transportUrl: "https://opensubtitles-v3.strem.io/manifest.json", manifest: { name: "OpenSubtitles" }, flags: { official: true } },
          ],
        },
      },
      normalizeManifestUrl,
    );
    expect(list.map((a) => a.name)).toEqual(["Torrentio", "OpenSubtitles"]);
    expect(list[1].official).toBe(true);
  });

  it("turns trailer ids into YouTube URLs", () => {
    expect(
      parseTrailers({ trailerStreams: [{ ytId: "dQw4w9WgXcQ" }], trailers: [{ source: "dQw4w9WgXcQ", type: "Trailer" }, { source: "x", type: "Clip" }] }),
    ).toEqual(["https://www.youtube.com/watch?v=dQw4w9WgXcQ"]);
  });
});

describe("onboarding flag", () => {
  it("is done for stored profiles from before the step, not for new ones", () => {
    expect(sanitize({ appearance: { theme: "gold" } }).onboarding.setupDone).toBe(true);
    expect(sanitize(undefined).onboarding.setupDone).toBe(false);
    expect(sanitize({ onboarding: { setupDone: false } }).onboarding.setupDone).toBe(false);
  });
});
