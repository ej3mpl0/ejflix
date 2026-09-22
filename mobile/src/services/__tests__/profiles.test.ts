import { describe, expect, it } from "vitest";
import { cleanAvatar, cleanName, cleanPin, parseStoredProfiles, profileView } from "../profiles.pure";

describe("cleanName", () => {
  it("trims and caps at 40 characters", () => {
    expect(cleanName("  Ana  ")).toBe("Ana");
    expect(cleanName("x".repeat(50))).toHaveLength(40);
    expect(cleanName("ñ".repeat(45))).toHaveLength(40);
  });
  it("rejects empty names", () => {
    expect(() => cleanName("   ")).toThrow("Escribe un nombre para el perfil");
  });
});

describe("cleanAvatar", () => {
  it("keeps presets below 12 and falls back to preset:0", () => {
    expect(cleanAvatar("preset:3")).toBe("preset:3");
    expect(cleanAvatar(" preset:11 ")).toBe("preset:11");
    expect(cleanAvatar("preset:12")).toBe("preset:0");
    expect(cleanAvatar("preset:abc")).toBe("preset:0");
    expect(cleanAvatar("preset:-1")).toBe("preset:0");
  });
  it("accepts jpeg/png/webp data URLs of printable ASCII", () => {
    expect(cleanAvatar("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(cleanAvatar("data:image/webp;base64,AAAA")).toBe("data:image/webp;base64,AAAA");
    expect(() => cleanAvatar("data:image/gif;base64,AAAA")).toThrow("Imagen de perfil no válida");
    expect(() => cleanAvatar("https://x/y.png")).toThrow("Imagen de perfil no válida");
    expect(() => cleanAvatar("data:image/jpeg;base64,AA AA")).toThrow("Imagen de perfil no válida");
    expect(() => cleanAvatar("data:image/jpeg;base64,AAñA")).toThrow("Imagen de perfil no válida");
  });
  it("rejects pictures above 400 KiB", () => {
    const big = `data:image/jpeg;base64,${"A".repeat(400 * 1024)}`;
    expect(() => cleanAvatar(big)).toThrow("La foto es demasiado grande");
  });
});

describe("cleanPin", () => {
  it("requires exactly four digits", () => {
    expect(cleanPin(null)).toBeNull();
    expect(cleanPin("  ")).toBeNull();
    expect(cleanPin(" 1234 ")).toBe("1234");
    expect(() => cleanPin("123")).toThrow("El PIN debe tener 4 dígitos");
    expect(() => cleanPin("12a4")).toThrow("El PIN debe tener 4 dígitos");
    expect(() => cleanPin("12345")).toThrow("El PIN debe tener 4 dígitos");
  });
});

describe("stored profiles", () => {
  it("parses the list leniently and never exposes the PIN", () => {
    const list = parseStoredProfiles([
      { id: "a", name: "Ana", avatar: "preset:2", hasPin: true, createdMs: 5 },
      { id: "b", name: "Bo" },
      { name: "sin id" },
      "garbage",
    ]);
    expect(list).toEqual([
      { id: "a", name: "Ana", avatar: "preset:2", hasPin: true, createdMs: 5 },
      { id: "b", name: "Bo", avatar: "preset:0", hasPin: false, createdMs: 0 },
    ]);
    expect(profileView(list[0], true)).toEqual({ id: "a", name: "Ana", avatar: "preset:2", hasPin: true, linked: true });
    expect(parseStoredProfiles(undefined)).toEqual([]);
  });
});
