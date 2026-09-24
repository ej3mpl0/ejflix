import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "./motion";

/**
 * Couch / HTPC navigation for the main window.
 *
 * - Arrow keys move focus to the nearest focusable element in that direction, across the
 *   header, the hero, rows and grids (poster rows keep their own finer handler, which runs
 *   first and claims the key with preventDefault; so does anything else that uses arrows:
 *   radio groups, menus, selects, the carousel).
 * - Backspace (outside text fields) goes back, as Escape does.
 * - A gamepad drives the same: D-pad / left stick → arrows, A → activate, B → back,
 *   Start → play. It is polled with requestAnimationFrame only while one is connected.
 *
 * Text fields keep their keys, and the whole thing is off while `enabled` is false
 * (the player is up: it has its own hotkeys).
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** Widgets that own the arrow keys even when they forget to claim them. */
const OWN_ARROWS = new Set(["slider", "spinbutton", "combobox", "listbox", "option", "menu", "menuitem", "menuitemradio", "tree", "grid", "textbox"]);
const HEADER_GAP = 76;

type Dir = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

function isEditable(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["button", "checkbox", "radio", "submit", "reset", "image", "color", "file"].includes(type);
}

/** The layer the keys act in: the topmost open modal, else the whole document. */
function activeLayer(): HTMLElement {
  const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].filter(
    (el) => el.offsetParent !== null || getComputedStyle(el).position === "fixed",
  );
  return dialogs[dialogs.length - 1] ?? document.body;
}

function usable(el: HTMLElement): boolean {
  if (el.closest('[inert], [aria-hidden="true"]')) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const style = getComputedStyle(el);
  if (style.visibility === "hidden" || style.pointerEvents === "none") return false;
  // The header slides away while a details page is up; its buttons are still in the DOM.
  const header = el.closest("header");
  if (header && header.getBoundingClientRect().bottom <= 1) return false;
  return true;
}

/**
 * Focus targets of a layer. A poster card counts once (its main button), and a focusable
 * container (the hero carousel) gives way to the controls inside it.
 */
function candidates(layer: HTMLElement): HTMLElement[] {
  const all = [...layer.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(usable);
  const out: HTMLElement[] = [];
  const seenPosters = new Set<Element>();
  for (const el of all) {
    const poster = el.closest("[data-poster]");
    if (poster) {
      if (seenPosters.has(poster)) continue;
      seenPosters.add(poster);
      out.push(poster.querySelector<HTMLElement>("button, a[href]") ?? el);
      continue;
    }
    if (all.some((other) => other !== el && el.contains(other))) continue;
    out.push(el);
  }
  return out;
}

/** Nearest candidate in `dir` from `from`: distance along the axis, plus a heavier penalty off it. */
function pick(from: DOMRect, dir: Dir, list: HTMLElement[], current: HTMLElement | null): HTMLElement | null {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const el of list) {
    if (el === current || (current && (el.contains(current) || current.contains(el)))) continue;
    const r = el.getBoundingClientRect();
    const ex = r.left + r.width / 2;
    const ey = r.top + r.height / 2;
    let primary: number;
    let ortho: number;
    if (dir === "ArrowDown" || dir === "ArrowUp") {
      const ahead = dir === "ArrowDown" ? ey > cy && r.top > from.top + 2 : ey < cy && r.bottom < from.bottom - 2;
      if (!ahead) continue;
      primary = dir === "ArrowDown" ? Math.max(0, r.top - from.bottom) : Math.max(0, from.top - r.bottom);
      ortho = Math.max(0, r.left - from.right, from.left - r.right);
      primary += Math.abs(ey - cy) * 0.05;
      ortho += Math.abs(ex - cx) * 0.1;
    } else {
      const ahead = dir === "ArrowRight" ? ex > cx && r.left > from.left + 2 : ex < cx && r.right < from.right - 2;
      if (!ahead) continue;
      primary = dir === "ArrowRight" ? Math.max(0, r.left - from.right) : Math.max(0, from.left - r.right);
      ortho = Math.max(0, r.top - from.bottom, from.top - r.bottom);
      primary += Math.abs(ex - cx) * 0.05;
      ortho += Math.abs(ey - cy) * 0.1;
    }
    const score = primary + ortho * 3;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function focusEl(el: HTMLElement) {
  el.focus({ preventScroll: true });
  const target = el.closest<HTMLElement>("[data-poster]") ?? el;
  const rect = target.getBoundingClientRect();
  // Keep it clear of the fixed header, and on screen when it sits in a scroller.
  if (rect.top < HEADER_GAP || rect.bottom > window.innerHeight || rect.left < 0 || rect.right > window.innerWidth) {
    target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }
}

/** One step in `dir` from whatever has focus (or into the page when nothing has). */
export function moveFocus(dir: Dir): boolean {
  const layer = activeLayer();
  const list = candidates(layer);
  if (!list.length) return false;
  const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  if (!active || !layer.contains(active)) {
    // Nothing focused yet: start at the top-left of the content on screen.
    const onScreen = list
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ el, r }) => !el.closest("header") && r.top >= 0 && r.bottom <= window.innerHeight)
      .sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
    const first = onScreen[0]?.el ?? list[0];
    focusEl(first);
    return true;
  }
  const next = pick(active.getBoundingClientRect(), dir, list, active);
  if (!next) return false;
  focusEl(next);
  return true;
}

function dispatchKey(key: string): KeyboardEvent {
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
  const event = new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

/** Start: the play button of the focused card, else the first one on screen (hero, details). */
function pressPlay() {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const own = active?.closest("[data-poster]")?.querySelector<HTMLElement>(".btn-play");
  if (own) {
    own.click();
    return;
  }
  const layer = activeLayer();
  const play = [...layer.querySelectorAll<HTMLElement>(".btn-play")].find(
    (el) => usable(el) && !(el as HTMLButtonElement).disabled && !el.closest("[data-poster]"),
  );
  play?.click();
}

function setInputMode(mode: "pad" | null) {
  const root = document.documentElement;
  if (mode) root.dataset.input = mode;
  else delete root.dataset.input;
}

const REPEAT_DELAY = 380;
const REPEAT_EVERY = 110;
const STICK = 0.55;

export function useSpatialNavigation(enabled: boolean): void {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Keyboard: arrows and Backspace.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (e.key === "Backspace") {
        if (isEditable(target) || e.repeat) return;
        e.preventDefault();
        dispatchKey("Escape");
        return;
      }
      if (e.shiftKey || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
      // A one-line field keeps Left/Right for its caret; Up/Down have nothing to do there
      // and leave it (fields that use them, like the palette's, claim them first).
      const singleLine = target instanceof HTMLInputElement && target.type !== "range" && target.type !== "number";
      if (isEditable(target) && !(singleLine && (e.key === "ArrowUp" || e.key === "ArrowDown"))) return;
      const role = target?.getAttribute("role");
      if (role && OWN_ARROWS.has(role)) return;
      if (moveFocus(e.key as Dir)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);

  // Gamepad: polled only while one is connected (and the app is enabled and focused).
  useEffect(() => {
    if (!enabled || typeof navigator.getGamepads !== "function") return;
    let frame = 0;
    const held = new Map<string, { since: number; last: number }>();

    const fire = (name: string) => {
      setInputMode("pad");
      if (name === "A") {
        const active = document.activeElement;
        if (active instanceof HTMLElement && active !== document.body) {
          if (isEditable(active)) return;
          active.click();
        } else {
          moveFocus("ArrowDown");
        }
      } else if (name === "B") {
        dispatchKey("Escape");
      } else if (name === "Start") {
        pressPlay();
      } else {
        // As a key press, so the rows, the carousel and the radio groups see it first and
        // the keyboard listener above moves focus when none of them claims it.
        // A text field keeps Left/Right for its caret; Up/Down leave it (a pad cannot Tab).
        if (isEditable(document.activeElement) && (name === "ArrowUp" || name === "ArrowDown")) moveFocus(name);
        else dispatchKey(name);
      }
    };

    const poll = (now: number) => {
      frame = 0;
      const pads = [...navigator.getGamepads()].filter((pad): pad is Gamepad => Boolean(pad));
      if (!pads.length || !enabledRef.current) return;
      if (document.hasFocus()) {
        const pressed = new Set<string>();
        for (const pad of pads) {
          const b = (i: number) => Boolean(pad.buttons[i]?.pressed);
          const [x = 0, y = 0] = pad.axes;
          if (b(12) || y < -STICK) pressed.add("ArrowUp");
          if (b(13) || y > STICK) pressed.add("ArrowDown");
          if (b(14) || x < -STICK) pressed.add("ArrowLeft");
          if (b(15) || x > STICK) pressed.add("ArrowRight");
          if (b(0)) pressed.add("A");
          if (b(1)) pressed.add("B");
          if (b(9)) pressed.add("Start");
        }
        for (const name of [...held.keys()]) if (!pressed.has(name)) held.delete(name);
        for (const name of pressed) {
          const state = held.get(name);
          if (!state) {
            held.set(name, { since: now, last: now });
            fire(name);
          } else if (name.startsWith("Arrow") && now - state.since > REPEAT_DELAY && now - state.last > REPEAT_EVERY) {
            state.last = now;
            fire(name);
          }
        }
      } else {
        held.clear();
      }
      frame = requestAnimationFrame(poll);
    };

    const start = () => {
      if (!frame) frame = requestAnimationFrame(poll);
    };
    const leavePad = () => setInputMode(null);
    if ([...navigator.getGamepads()].some(Boolean)) start();
    window.addEventListener("gamepadconnected", start);
    window.addEventListener("mousedown", leavePad);
    return () => {
      window.removeEventListener("gamepadconnected", start);
      window.removeEventListener("mousedown", leavePad);
      if (frame) cancelAnimationFrame(frame);
      setInputMode(null);
    };
  }, [enabled]);
}
