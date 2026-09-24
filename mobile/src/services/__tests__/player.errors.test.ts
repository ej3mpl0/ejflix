import { describe, expect, it } from "vitest";
import { errorActions, errorMessageKey } from "../player/error-actions";
import { isNewlyAired, episodeProgress } from "../../lib/episodes";
import { subtitlePlacement, subtitleTextStyle } from "../../lib/subtitle-style";

describe("errorActions", () => {
  it("offers transcoding for a Jellyfin direct play that could not be decoded", () => {
    expect(errorActions({ source: "jellyfin", code: "decoder", transcoding: false, hasUrl: true })).toEqual([
      "transcode",
      "retry",
      "external",
    ]);
  });

  it("does not offer transcoding again, nor for network failures", () => {
    expect(errorActions({ source: "jellyfin", code: "decoder", transcoding: true, hasUrl: false })).toEqual(["retry"]);
    expect(errorActions({ source: "jellyfin", code: "network", transcoding: false, hasUrl: false })).toEqual(["retry"]);
  });

  it("puts another source first for online titles unless the network failed", () => {
    expect(errorActions({ source: "addon", code: "decoder", transcoding: false, hasUrl: true })).toEqual(["source", "retry", "external"]);
    expect(errorActions({ source: "addon", code: "network", transcoding: false, hasUrl: false })).toEqual(["retry", "source"]);
  });

  it("offers the online version of a failing download, never an external player for a file", () => {
    expect(errorActions({ source: "offline", code: "decoder", transcoding: false, hasUrl: true })).toEqual(["stream", "retry"]);
  });

  it("live channels retry or go external", () => {
    expect(errorActions({ source: "live", code: "unknown", transcoding: false, hasUrl: true })).toEqual(["retry", "external"]);
  });

  it("maps codes to translated messages", () => {
    expect(errorMessageKey("decoder")).toBe("playbackFailedDecoder");
    expect(errorMessageKey("network")).toBe("playbackFailedNetwork");
    expect(errorMessageKey("unknown")).toBe("playbackFailedGeneric");
  });
});

describe("episodes", () => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  it("is new when unwatched and aired within a week", () => {
    expect(isNewlyAired("2026-09-20T00:00:00Z", false, now)).toBe(true);
    expect(isNewlyAired("2026-09-20T00:00:00Z", true, now)).toBe(false);
    expect(isNewlyAired("2026-09-10T00:00:00Z", false, now)).toBe(false);
    expect(isNewlyAired("2026-10-01T00:00:00Z", false, now)).toBe(false);
    expect(isNewlyAired(null, false, now)).toBe(false);
    expect(isNewlyAired("garbage", false, now)).toBe(false);
  });

  it("progress hides for finished or untouched episodes", () => {
    expect(episodeProgress(40, false)).toBeCloseTo(0.4);
    expect(episodeProgress(40, true)).toBe(0);
    expect(episodeProgress(0, false)).toBe(0);
    expect(episodeProgress(150, false)).toBe(1);
  });
});

describe("subtitle style", () => {
  it("scales the text and draws the background", () => {
    const box = subtitleTextStyle({ scale: 1.5, color: "#FFE45C", background: "box" }, 20);
    expect(box).toMatchObject({ color: "#FFE45C", fontSize: 30, textShadowRadius: 0, backgroundColor: "rgba(0,0,0,0.7)" });
    const shadow = subtitleTextStyle({ scale: 1, color: "#FFFFFF", background: "shadow" }, 22);
    expect(shadow.textShadowOffset).toEqual({ width: 2, height: 2 });
    expect(shadow.backgroundColor).toBe("transparent");
  });

  it("places the lines at the bottom, raised or at the top", () => {
    expect(subtitlePlacement("bottom", 400, 28, 20)).toEqual({ bottom: 28 });
    expect(subtitlePlacement("top", 400, 28, 20)).toEqual({ top: 20 });
    const raised = subtitlePlacement("raised", 400, 28, 20) as { bottom: number };
    expect(raised.bottom).toBeGreaterThan(28);
    // Never lower than the normal position, even when the controls push it up.
    expect((subtitlePlacement("raised", 400, 200, 20) as { bottom: number }).bottom).toBe(200);
  });
});
