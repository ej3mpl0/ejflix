/**
 * Language aliases for track selection, ported from `player.rs::lang_aliases`.
 * Files spell languages as ISO 639-2/T, 639-2/B or 639-1, so every spelling counts.
 * Pure module (no React Native imports) so it can run under vitest.
 */
const ALIASES: Record<string, readonly string[]> = {
  spa: ["spa", "es"],
  eng: ["eng", "en"],
  fra: ["fra", "fre", "fr"],
  deu: ["deu", "ger", "de"],
  ita: ["ita", "it"],
  por: ["por", "pt"],
  jpn: ["jpn", "ja"],
  kor: ["kor", "ko"],
  zho: ["zho", "chi", "zh"],
  nld: ["nld", "dut", "nl"],
  rus: ["rus", "ru"],
  cat: ["cat", "ca"],
  eus: ["eus", "baq", "eu"],
  glg: ["glg", "gl"],
  ara: ["ara", "ar"],
  hin: ["hin", "hi"],
  tur: ["tur", "tr"],
  pol: ["pol", "pl"],
  swe: ["swe", "sv"],
  nor: ["nor", "no"],
  dan: ["dan", "da"],
  fin: ["fin", "fi"],
  ell: ["ell", "gre", "el"],
  heb: ["heb", "he"],
  ces: ["ces", "cze", "cs"],
  hun: ["hun", "hu"],
  ron: ["ron", "rum", "ro"],
  ukr: ["ukr", "uk"],
  tha: ["tha", "th"],
  vie: ["vie", "vi"],
  ind: ["ind", "id"],
};

/** Every spelling of `code` (an ISO 639-2 code from the settings); `[]` for "". */
export function langAliases(code: string): string[] {
  const key = code.trim().toLowerCase();
  if (!key) return [];
  const known = ALIASES[key];
  return known ? [...known] : [key];
}

/** Same list as mpv's comma-separated `alang`/`slang` value. */
export function langAliasList(code: string): string {
  return langAliases(code).join(",");
}

/** True when a track language (as written in the file) means `code`. */
export function matchesLang(trackLang: string | null | undefined, code: string): boolean {
  if (!trackLang) return false;
  const lang = trackLang.trim().toLowerCase();
  if (!lang) return false;
  const aliases = langAliases(code);
  if (aliases.includes(lang)) return true;
  // "es-ES", "pt-BR": compare the primary subtag as well.
  const primary = lang.split(/[-_]/)[0];
  return primary !== lang && aliases.includes(primary);
}
