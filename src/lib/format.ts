export function ticksToSeconds(ticks: number): number {
  return ticks / 10_000_000;
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

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function sessionAvatar(session: { userId: string; avatarUrl?: string | null }): string {
  return session.avatarUrl || `http://jfimg.localhost/Users/${session.userId}/Images/Primary?quality=90`;
}

export function isSeries(item: { kind?: string } | null | undefined): boolean {
  return item?.kind === "Series";
}

export function isEpisode(item: { kind?: string } | null | undefined): boolean {
  return item?.kind === "Episode";
}

export function episodeCode(
  item: { seasonNumber?: number | null; episodeNumber?: number | null },
  template: (vars: { s: number | string; e: number | string }) => string,
): string | null {
  if (item.seasonNumber == null || item.episodeNumber == null) return null;
  return template({ s: item.seasonNumber, e: item.episodeNumber });
}
