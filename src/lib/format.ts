export function ticksToSeconds(ticks: number): number {
  return ticks / 10_000_000;
}

/** True when `iso` (Jellyfin `DateCreated`) is within the last `days` days. */
export function isRecentlyAdded(iso: string | null | undefined, days = 14): boolean {
  if (!iso) return false;
  const added = Date.parse(iso);
  if (!Number.isFinite(added)) return false;
  const age = Date.now() - added;
  return age >= 0 && age <= days * 86_400_000;
}

export function formatRuntime(ticks: number | null | undefined): string {
  if (!ticks) return "";
  const minutes = Math.round(ticks / 10_000_000 / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours <= 0) return `${minutes} min`;
  return `${hours} h ${rest} min`;
}

export function remainingMinutes(runtimeTicks: number | null, positionTicks: number): number {
  if (!runtimeTicks) return 0;
  return Math.max(1, Math.round((runtimeTicks - positionTicks) / 10_000_000 / 60));
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "T1:E3" style label from the locale pattern (e.g. "T{s}:E{e}"); empty when unknown. */
export function episodeCode(
  movie: { seasonNumber: number | null; episodeNumber: number | null },
  pattern: string,
): string {
  if (movie.seasonNumber == null && movie.episodeNumber == null) return "";
  return pattern
    .split("{s}")
    .join(String(movie.seasonNumber ?? 1))
    .split("{e}")
    .join(String(movie.episodeNumber ?? 1));
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function sessionAvatar(session: {
  mode?: "jellyfin" | "local";
  userId: string;
  avatarUrl?: string | null;
}): string | null {
  if (session.mode === "local") return session.avatarUrl ?? null;
  return session.avatarUrl || `http://jfimg.localhost/Users/${session.userId}/Images/Primary?quality=90`;
}
