import type { KeyboardEvent } from "react";

/**
 * Arrow keys between poster cards (`[data-poster]`) inside `root`, for rows and grids
 * alike: the next card is picked by position on screen, so Up/Down land on the card
 * straight above or below, whichever row or grid it belongs to.
 */
export function handlePosterArrows(e: KeyboardEvent<HTMLElement>, root: HTMLElement | null) {
  if (!root || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
  const current = (e.target as HTMLElement).closest<HTMLElement>("[data-poster]");
  if (!current || !root.contains(current)) return;
  const here = current.getBoundingClientRect();
  const cards = [...root.querySelectorAll<HTMLElement>("[data-poster]")].filter((card) => card !== current);
  const center = (r: DOMRect) => r.left + r.width / 2;
  const sameLine = (r: DOMRect) => Math.abs(r.top - here.top) < here.height / 3;

  let target: HTMLElement | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const card of cards) {
    const r = card.getBoundingClientRect();
    let score = Number.POSITIVE_INFINITY;
    if (e.key === "ArrowRight" && sameLine(r) && r.left > here.left) score = r.left - here.left;
    if (e.key === "ArrowLeft" && sameLine(r) && r.left < here.left) score = here.left - r.left;
    if (e.key === "ArrowDown" && r.top > here.top + here.height / 3) score = (r.top - here.top) * 4 + Math.abs(center(r) - center(here));
    if (e.key === "ArrowUp" && r.top < here.top - here.height / 3) score = (here.top - r.top) * 4 + Math.abs(center(r) - center(here));
    if (score < best) {
      best = score;
      target = card;
    }
  }
  if (!target) return;
  e.preventDefault();
  const focusable = target.querySelector<HTMLElement>("button, a[href]");
  focusable?.focus({ preventScroll: true });
  target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}
