/** ISO 639-2/T codes offered for preferred audio / subtitle languages. */
export const LANGUAGE_CODES = [
  "spa", "eng", "cat", "eus", "glg", "por", "fra", "ita", "deu", "nld", "pol", "rus", "ukr",
  "swe", "nor", "dan", "fin", "ces", "hun", "ron", "ell", "tur", "heb", "ara", "hin", "jpn",
  "kor", "zho", "tha", "vie", "ind",
] as const;

/** Display name in the UI locale; falls back to the code itself. */
export function languageName(code: string, locale: string): string {
  try {
    const names = new Intl.DisplayNames([locale], { type: "language" });
    const name = names.of(code);
    if (name && name.toLowerCase() !== code.toLowerCase()) {
      return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
    }
  } catch {
    /* unsupported */
  }
  return code.toUpperCase();
}
