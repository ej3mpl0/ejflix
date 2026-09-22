import { describe, expect, it } from "vitest";
import { ASPECT_MODES, aspectBox, aspectRatio, isAspectMode } from "../player/aspect";

describe("aspect modes", () => {
  it("lists the desktop modes in order and validates them", () => {
    expect(ASPECT_MODES).toEqual(["auto", "16:9", "4:3", "2.35:1", "fill"]);
    expect(isAspectMode("16:9")).toBe(true);
    expect(isAspectMode("21:9")).toBe(false);
    expect(aspectRatio("4:3")).toBeCloseTo(4 / 3);
    expect(aspectRatio("auto")).toBeNull();
    expect(aspectRatio("fill")).toBeNull();
  });
});

describe("aspectBox", () => {
  it("auto fills the screen and lets the player letterbox", () => {
    expect(aspectBox("auto", 2400, 1080)).toEqual({ width: 2400, height: 1080, contentFit: "contain" });
  });

  it("fill covers the screen (crop)", () => {
    expect(aspectBox("fill", 2400, 1080)).toEqual({ width: 2400, height: 1080, contentFit: "cover" });
  });

  it("a fixed ratio on a wider screen is pillarboxed at full height", () => {
    expect(aspectBox("16:9", 2400, 1080)).toEqual({ width: 1920, height: 1080, contentFit: "fill" });
    expect(aspectBox("4:3", 2400, 1080)).toEqual({ width: 1440, height: 1080, contentFit: "fill" });
  });

  it("a fixed ratio on a taller screen is letterboxed at full width", () => {
    expect(aspectBox("2.35:1", 1920, 1080)).toEqual({ width: 1920, height: 817, contentFit: "fill" });
    expect(aspectBox("16:9", 1080, 2400)).toEqual({ width: 1080, height: 608, contentFit: "fill" });
  });

  it("an exact match keeps the screen size", () => {
    expect(aspectBox("16:9", 1920, 1080)).toEqual({ width: 1920, height: 1080, contentFit: "fill" });
  });

  it("unknown modes behave like auto and degenerate sizes are returned unchanged", () => {
    expect(aspectBox("21:9", 100, 50)).toEqual({ width: 100, height: 50, contentFit: "contain" });
    expect(aspectBox("16:9", 0, 50)).toEqual({ width: 0, height: 50, contentFit: "contain" });
    expect(aspectBox("16:9", Number.NaN, 50)).toEqual({ width: 0, height: 50, contentFit: "contain" });
  });
});
