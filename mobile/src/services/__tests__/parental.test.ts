import { describe, expect, it } from "vitest";
import { allowsRating, isAdultLabel, metaRating, parseRules, ratingAge } from "../parental.pure";

describe("ratingAge", () => {
  it("maps official ratings to ages", () => {
    expect(ratingAge("G")).toBe(0);
    expect(ratingAge("TV-Y")).toBe(0);
    expect(ratingAge("APTA")).toBe(0);
    expect(ratingAge("TP")).toBe(0);
    expect(ratingAge("TV-Y7")).toBe(7);
    expect(ratingAge("7")).toBe(7);
    expect(ratingAge("PG")).toBe(10);
    expect(ratingAge("ES-12")).toBe(12);
    expect(ratingAge("PG-13")).toBe(13);
    expect(ratingAge("TV-14")).toBe(14);
    expect(ratingAge("de/16")).toBe(16);
    expect(ratingAge("FSK 16")).toBe(16);
    expect(ratingAge("R")).toBe(17);
    expect(ratingAge("TV-MA")).toBe(17);
    expect(ratingAge("NC-17")).toBe(18);
    expect(ratingAge("US:18")).toBe(18);
  });
  it("treats unrated labels as no rating", () => {
    expect(ratingAge("NR")).toBeNull();
    expect(ratingAge("Unrated")).toBeNull();
    expect(ratingAge("")).toBeNull();
  });
});

describe("allowsRating", () => {
  it("applies the age limit and the unrated switch", () => {
    const rule = { maxAge: 12, hideUnrated: false };
    expect(allowsRating(rule, "PG")).toBe(true);
    expect(allowsRating(rule, "12")).toBe(true);
    expect(allowsRating(rule, "PG-13")).toBe(false);
    expect(allowsRating(rule, null)).toBe(true);
    const strict = { maxAge: 0, hideUnrated: true };
    expect(allowsRating(strict, "TV-G")).toBe(true);
    expect(allowsRating(strict, "TV-Y7")).toBe(false);
    expect(allowsRating(strict, "NR")).toBe(false);
    expect(allowsRating(null, "NC-17")).toBe(true);
    expect(allowsRating({ maxAge: 18, hideUnrated: true }, null)).toBe(true);
  });
});

describe("isAdultLabel", () => {
  it("spots adult IPTV groups", () => {
    expect(isAdultLabel("XXX Movies")).toBe(true);
    expect(isAdultLabel("ES | Adultos")).toBe(true);
    expect(isAdultLabel("+18")).toBe(true);
    expect(isAdultLabel("VOD 18+")).toBe(true);
    expect(isAdultLabel("Deportes")).toBe(false);
    expect(isAdultLabel("Cine 2018")).toBe(false);
  });
});

describe("metaRating / parseRules", () => {
  it("reads the rating fields addons use", () => {
    expect(metaRating({ certification: " PG-13 " })).toBe("PG-13");
    expect(metaRating({ ageRating: 16 })).toBe("16");
    expect(metaRating({ imdbRating: "7.5" })).toBeNull();
  });
  it("keeps only valid restrictive rules", () => {
    expect(parseRules({ a: { maxAge: 7, hideUnrated: true }, b: { maxAge: 18 }, c: { maxAge: 9 }, d: null })).toEqual({
      a: { maxAge: 7, hideUnrated: true },
    });
  });
});
