/**
 * Parental controls, ported from `parental.rs`: official ratings turned into ages, the
 * per-profile rule and the adult IPTV group check. Pure module (vitest-friendly).
 */

/** Ages a profile can be limited to; 18 means no limit. */
export const LEVELS = [0, 7, 12, 16, 18] as const;
export const UNRESTRICTED = 18;

export type Rule = { maxAge: number; hideUnrated: boolean };

export function restricts(rule: Rule | null | undefined): boolean {
  return rule != null && rule.maxAge < UNRESTRICTED;
}

/** True when a title with this rating passes the rule. */
export function allowsRating(rule: Rule | null | undefined, rating: string | null | undefined): boolean {
  if (!rule || !restricts(rule)) return true;
  const age = rating ? ratingAge(rating) : null;
  return age === null ? !rule.hideUnrated : age <= rule.maxAge;
}

const NOT_RATED = new Set(["NR", "UR", "UNRATED", "NOT RATED", "NONE", "N/A", "-", "SC", "SIN CALIFICAR"]);

const KNOWN = new Map<string, number>();
const table: [number, string[]][] = [
  [0, ["G", "TV-G", "TV-Y", "TP", "APTA", "ATP", "A", "AL", "U", "E", "ALL", "TODOS", "L", "0", "0+", "+0"]],
  [6, ["6", "+6", "6+"]],
  [7, ["TV-Y7", "TV-Y7-FV", "TV-Y7 FV", "7", "+7", "7+", "7I"]],
  [10, ["PG", "TV-PG", "10", "+10", "10+"]],
  [12, ["12", "12A", "+12", "12+", "PG-12"]],
  [13, ["PG-13", "13", "+13", "13+"]],
  [14, ["TV-14", "14", "+14", "14+"]],
  [15, ["15", "+15", "15+", "MA15+", "M"]],
  [16, ["16", "+16", "16+"]],
  [17, ["R", "TV-MA", "17", "+17", "17+"]],
  [18, ["NC-17", "18", "+18", "18+", "X", "XXX", "R18", "R18+", "ADULT", "AO"]],
];
for (const [age, labels] of table) for (const label of labels) KNOWN.set(label, age);

/** `undefined`: not a known label; `null`: a known "not rated" label; else the age. */
function known(label: string): number | null | undefined {
  const value = label.trim();
  if (NOT_RATED.has(value)) return null;
  return KNOWN.get(value);
}

/**
 * Age a rating stands for (`null` when it is not a rating): MPAA, US TV, UK/EU ages,
 * Spain's "APTA"/"TP" and the forms Jellyfin stores them in ("ES-12", "de/16").
 */
export function ratingAge(raw: string): number | null {
  const text = raw.trim().toUpperCase();
  if (!text) return null;
  const whole = known(text);
  if (whole !== undefined) return whole;
  const parts = text.split(/[:/]/);
  const tail = (parts[parts.length - 1] ?? text).trim();
  const fromTail = known(tail);
  if (fromTail !== undefined) return fromTail;
  if (/^[A-Z]{2}[- ]/.test(tail) && tail.length > 3) {
    const fromCountry = known(tail.slice(3));
    if (fromCountry !== undefined) return fromCountry;
  }
  const digits = /\d+/.exec(tail)?.[0];
  if (!digits) return null;
  const n = Number.parseInt(digits, 10);
  return n <= 21 ? Math.min(n, 18) : null;
}

const ADULT_WORDS = new Set([
  "adult",
  "adults",
  "adulto",
  "adultos",
  "adulta",
  "adultas",
  "+18",
  "18+",
  "erotic",
  "erotica",
  "erotico",
  "erótico",
  "erótica",
  "hentai",
]);

/** IPTV group (or channel) name that marks adult content: "XXX", "Adultos", "+18"... */
export function isAdultLabel(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.includes("xxx") || lower.includes("porn")) return true;
  return lower
    .split(/[^\p{L}\p{N}+]+/u)
    .filter(Boolean)
    .some((word) => ADULT_WORDS.has(word));
}

/** Age-rating fields some addons put in their metas (Stremio has no standard one). */
export function metaRating(meta: Record<string, unknown>): string | null {
  for (const key of ["certification", "contentRating", "officialRating", "mpaa", "rated", "ageRating"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** Coerces the stored rules into a clean map (drops broken entries). */
export function parseRules(value: unknown): Record<string, Rule> {
  const out: Record<string, Rule> = {};
  if (value == null || typeof value !== "object") return out;
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw == null || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const maxAge = typeof r.maxAge === "number" && (LEVELS as readonly number[]).includes(r.maxAge) ? r.maxAge : UNRESTRICTED;
    if (maxAge < UNRESTRICTED) out[id] = { maxAge, hideUnrated: r.hideUnrated === true };
  }
  return out;
}
