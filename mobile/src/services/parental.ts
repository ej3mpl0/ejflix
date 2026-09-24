/**
 * Parental controls, ported from `parental.rs`: the rule of the open profile (local
 * profile or Jellyfin user), the parental PIN (in SecureStore) and the gates on
 * creating and deleting profiles. The rules live in the store under `parental`.
 */
import type { ParentalStatus } from "../lib/types";
import { emit } from "./events";
import { secrets, store } from "./store";
import { activeLocalProfileId, currentSession } from "./session";
import { LEVELS, UNRESTRICTED, allowsRating, isAdultLabel, parseRules, restricts, type Rule } from "./parental.pure";

const STORE_KEY = "parental";
const PIN_SECRET = "parental.pin";
const MAX_FAILS = 5;
const LOCKOUT_MS = 60_000;
export const BLOCKED = "parental_blocked";

let fails = 0;
let lockedUntil = 0;

function rules(): Record<string, Rule> {
  const stored = store.get<{ rules?: unknown }>(STORE_KEY);
  return parseRules(stored?.rules);
}

function saveRules(next: Record<string, Rule>): void {
  store.set(STORE_KEY, { rules: next });
}

/** The profile whose rule applies: the open local profile, else the Jellyfin user. */
function openUser(): string | null {
  return activeLocalProfileId() ?? currentSession()?.userId ?? null;
}

/** Restriction of the open profile, when it has one. */
export function currentRule(): Rule | null {
  const uid = openUser();
  if (!uid) return null;
  const rule = rules()[uid];
  return restricts(rule) ? rule : null;
}

export function allows(rating: string | null | undefined): boolean {
  return allowsRating(currentRule(), rating);
}

/** Adult IPTV groups are hidden while the open profile has a restriction. */
export function hidesAdult(): boolean {
  return currentRule() != null;
}

export function isAdultChannel(channel: { group: string; name: string }): boolean {
  return isAdultLabel(channel.group) || isAdultLabel(channel.name);
}

/** Checks the parental PIN, refusing for a minute after five wrong tries in a row. */
async function verify(pin: string | null | undefined): Promise<void> {
  const stored = await secrets.get(PIN_SECRET);
  if (stored == null) return;
  if (Date.now() < lockedUntil) throw new Error("parental_locked");
  if (!pin) throw new Error("parental_pin_required");
  if (pin === stored) {
    fails = 0;
    return;
  }
  fails += 1;
  if (fails >= MAX_FAILS) {
    fails = 0;
    lockedUntil = Date.now() + LOCKOUT_MS;
  }
  throw new Error("parental_pin_wrong");
}

function checkPinFormat(pin: string): string {
  if (!/^[0-9]{4}$/.test(pin)) throw new Error("El PIN debe tener 4 dígitos");
  return pin;
}

/** Creating a profile would sidestep every restriction, so while one exists it takes the PIN. */
export async function checkCreate(pin: string | null | undefined): Promise<void> {
  if (Object.values(rules()).some(restricts)) await verify(pin);
}

/** Deleting a restricted profile takes the PIN too; its rule goes with it. */
export async function checkDelete(profileId: string, pin: string | null | undefined): Promise<void> {
  const all = rules();
  if (restricts(all[profileId])) await verify(pin);
  if (profileId in all) {
    delete all[profileId];
    saveRules(all);
  }
}

async function view(uid: string | null): Promise<ParentalStatus> {
  const rule = uid ? rules()[uid] : undefined;
  const maxAge = (rule?.maxAge ?? UNRESTRICTED) as ParentalStatus["maxAge"];
  return {
    maxAge,
    hideUnrated: rule?.hideUnrated ?? false,
    pinSet: (await secrets.get(PIN_SECRET)) != null,
    active: restricts(rule),
  };
}

export async function parentalStatus(): Promise<ParentalStatus> {
  return view(openUser());
}

/** `pin` is the parental PIN, or the new one when none exists yet; `newPin` replaces it. */
export async function parentalSet(
  pin: string,
  maxAge: number,
  hideUnrated: boolean,
  newPin?: string | null,
): Promise<ParentalStatus> {
  const uid = openUser();
  if (!uid) throw new Error("No hay sesión activa");
  if (!(LEVELS as readonly number[]).includes(maxAge)) throw new Error("Nivel no válido");
  if ((await secrets.get(PIN_SECRET)) != null) await verify(pin);
  else await secrets.set(PIN_SECRET, checkPinFormat(pin));
  if (newPin) await secrets.set(PIN_SECRET, checkPinFormat(newPin));
  const all = rules();
  if (maxAge < UNRESTRICTED) all[uid] = { maxAge, hideUnrated };
  else delete all[uid];
  saveRules(all);
  const result = await view(uid);
  emit("parental://changed", result);
  return result;
}
