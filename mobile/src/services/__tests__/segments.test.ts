import { describe, expect, it } from "vitest";
import type { MediaSegment } from "../../lib/types";
import {
  fromJellyfinSegments,
  mapJellyfinKind,
  mergeSegments,
  parseIntroDb,
  parseIntroSkipper,
  parseJellyfinSegments,
  sanitizeSegments,
  validImdbId,
} from "../segments.pure";

const seg = (kind: string, start: number, end: number, source = "jellyfin"): MediaSegment => ({
  kind,
  startSeconds: start,
  endSeconds: end,
  source,
});

describe("Jellyfin segments", () => {
  it("maps the Type names and drops unknown ones", () => {
    expect(mapJellyfinKind("Intro")).toBe("intro");
    expect(mapJellyfinKind("Outro")).toBe("outro");
    expect(mapJellyfinKind("Recap")).toBe("recap");
    expect(mapJellyfinKind("Preview")).toBe("preview");
    expect(mapJellyfinKind("Commercial")).toBe("commercial");
    expect(mapJellyfinKind("Unknown")).toBeNull();
  });
  it("parses ticks into seconds", () => {
    const raw = parseJellyfinSegments({
      Items: [
        { Type: "Intro", StartTicks: 100_000_000, EndTicks: 900_000_000 },
        { Type: "Weird", StartTicks: 0, EndTicks: 50_000_000 },
        { Type: "Outro", StartTicks: "x", EndTicks: 1 },
      ],
    });
    expect(raw).toEqual([
      ["Intro", 10, 90],
      ["Weird", 0, 5],
    ]);
    expect(fromJellyfinSegments(raw)).toEqual([seg("intro", 10, 90)]);
    expect(parseJellyfinSegments(null)).toEqual([]);
  });
  it("parses the Intro Skipper answer", () => {
    expect(parseIntroSkipper({ Valid: true, IntroStart: 5, IntroEnd: 65 })).toEqual([5, 65]);
    expect(parseIntroSkipper({ Valid: false, IntroStart: 5, IntroEnd: 65 })).toBeNull();
    expect(parseIntroSkipper({ Valid: true })).toBeNull();
  });
});

describe("parseIntroDb", () => {
  it("reads ms or seconds and applies the confidence floor", () => {
    const out = parseIntroDb({
      intro: { start_ms: 1000, end_ms: 61000, confidence: 0.9 },
      recap: { start_sec: 0, end_sec: 30 },
      outro: { start_ms: 1_200_000, end_ms: 1_260_000, confidence: 0.1 },
    });
    expect(out).toEqual([seg("intro", 1, 61, "introdb"), seg("recap", 0, 30, "introdb")]);
  });
  it("ignores nulls and incomplete entries", () => {
    expect(parseIntroDb({ intro: null, outro: { start_ms: 5 } })).toEqual([]);
    expect(parseIntroDb("nope")).toEqual([]);
  });
});

describe("mergeSegments", () => {
  it("lets Jellyfin win per kind", () => {
    const merged = mergeSegments([seg("intro", 10, 90)], [seg("intro", 0, 60, "introdb"), seg("outro", 1000, 1100, "introdb")]);
    expect(merged).toEqual([seg("intro", 10, 90), seg("outro", 1000, 1100, "introdb")]);
  });
});

describe("sanitizeSegments", () => {
  it("filters, sorts and caps", () => {
    const list = [
      seg("outro", 1000, 1100),
      seg("intro", -1, 50),
      seg("recap", 10, 11),
      seg("intro", 5, 60),
      seg("preview", Number.NaN, 10),
      seg("commercial", 2000, 2100),
    ];
    expect(sanitizeSegments(list, 1500)).toEqual([seg("intro", 5, 60), seg("outro", 1000, 1100)]);
    // No duration (or a bogus one) keeps everything in range.
    expect(sanitizeSegments(list, null)).toHaveLength(3);
    expect(sanitizeSegments(list, 0)).toHaveLength(3);
    const many = Array.from({ length: 40 }, (_, i) => seg("intro", i * 10, i * 10 + 5));
    expect(sanitizeSegments(many, null)).toHaveLength(32);
  });
});

describe("validImdbId", () => {
  it("requires tt + digits, at most 16 chars", () => {
    expect(validImdbId("tt0944947")).toBe(true);
    expect(validImdbId("tt")).toBe(false);
    expect(validImdbId("nm0000001")).toBe(false);
    expect(validImdbId("tt12345678901234567")).toBe(false);
  });
});
