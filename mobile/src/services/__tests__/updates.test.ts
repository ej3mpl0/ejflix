import { describe, expect, it } from "vitest";
import { allowedDownloadUrl, isNewer, parseVersion, pickAsset, safeAssetName } from "../updates.pure";

describe("updates.pure", () => {
  it("parses tags", () => {
    expect(parseVersion("v0.3.1")).toEqual([0, 3, 1]);
    expect(parseVersion("ejFlix 1.2")).toEqual([1, 2, 0]);
    expect(parseVersion("0.4.0-beta.1")).toEqual([0, 4, 0]);
    expect(parseVersion("latest")).toBeNull();
  });

  it("compares", () => {
    expect(isNewer("0.3.1", "0.3.0")).toBe(true);
    expect(isNewer("v1.0.0", "0.9.9")).toBe(true);
    expect(isNewer("0.3.0", "0.3.0")).toBe(false);
    expect(isNewer("0.2.9", "0.3.0")).toBe(false);
    expect(isNewer("nope", "0.3.0")).toBe(false);
  });

  it("picks the android asset", () => {
    const assets = [
      { name: "ejFlix-0.4.0-setup.exe", browser_download_url: "https://github.com/x/setup.exe", size: 1 },
      { name: "ejFlix-0.4.0-x86_64.apk", browser_download_url: "https://github.com/x/x86.apk", size: 2 },
      { name: "ejFlix-0.4.0-universal.apk", browser_download_url: "https://github.com/x/u.apk", size: 3 },
      { name: "ejFlix-0.4.0-arm64-v8a.apk", browser_download_url: "https://github.com/x/a.apk", size: 4 },
    ];
    expect(pickAsset(assets)?.name).toBe("ejFlix-0.4.0-arm64-v8a.apk");
    expect(pickAsset(assets.slice(0, 3))?.name).toBe("ejFlix-0.4.0-universal.apk");
    expect(pickAsset(assets, ".ipa")).toBeNull();
    const withIpa = [...assets, { name: "ejFlix-0.5.0-ios.ipa", browser_download_url: "https://github.com/x/ejFlix-0.5.0-ios.ipa", size: 9 }];
    expect(pickAsset(withIpa, ".ipa")?.name).toBe("ejFlix-0.5.0-ios.ipa");
    expect(pickAsset(withIpa)?.name).toBe("ejFlix-0.4.0-arm64-v8a.apk");
    expect(pickAsset([assets[0], assets[1]])).toBeNull();
    expect(pickAsset([{ name: "other.apk", browser_download_url: "https://github.com/x/o.apk" }])).toEqual({
      name: "other.apk",
      url: "https://github.com/x/o.apk",
      size: 0,
    });
  });

  it("sanitizes names and checks origins", () => {
    expect(safeAssetName("../ej Flix.apk")).toBe("..ejFlix.apk");
    expect(safeAssetName("###")).toBe("ejFlix.apk");
    expect(allowedDownloadUrl("https://github.com/ej3mpl0/ejflix/releases/download/v1/a.apk")).toBe(true);
    expect(allowedDownloadUrl("https://evil.example/a.apk")).toBe(false);
  });
});
