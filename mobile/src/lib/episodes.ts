/** Episode helpers for the lists (pure, vitest-friendly). */

const DAY_MS = 86_400_000;

/**
 * "New" badge of an episode: not watched and aired within the last `days` days
 * (a future air date is not new yet, it is upcoming).
 */
export function isNewlyAired(
  premiereDate: string | null | undefined,
  played: boolean,
  now: number = Date.now(),
  days = 7,
): boolean {
  if (played || !premiereDate) return false;
  const aired = Date.parse(premiereDate);
  if (!Number.isFinite(aired)) return false;
  const age = now - aired;
  return age >= 0 && age <= days * DAY_MS;
}

/** 0..1 watched share for the row bar; nothing for finished or untouched episodes. */
export function episodeProgress(playedPercentage: number, played: boolean): number {
  if (played || !Number.isFinite(playedPercentage) || playedPercentage <= 0) return 0;
  return Math.min(1, playedPercentage / 100);
}
