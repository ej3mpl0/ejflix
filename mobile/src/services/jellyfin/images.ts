/**
 * Image URL builder. The desktop app proxied images through a custom `jfimg://`
 * scheme; on Android we point straight at the server and authenticate with `api_key`.
 * `configureImages` is called by the session service whenever the Jellyfin session changes.
 */
let serverUrl: string | null = null;
let token: string | null = null;

export function configureImages(next: { serverUrl: string | null; token: string | null }): void {
  serverUrl = next.serverUrl ? next.serverUrl.replace(/\/+$/, "") : null;
  token = next.token;
}

export type ImageQuery = Record<string, string | number | null | undefined>;

/** `path` starts with `/`; returns an empty string when no server is configured. */
export function serverImageUrl(path: string, query: ImageQuery = {}): string {
  if (!serverUrl) return "";
  const params: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === "") continue;
    params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  if (token) params.push(`api_key=${encodeURIComponent(token)}`);
  return `${serverUrl}${path}${params.length ? `?${params.join("&")}` : ""}`;
}

export type ImageKind = "Primary" | "Backdrop" | "Logo" | "Thumb" | "Banner" | "Art" | "Disc";

/** Same widths as `jellyfin.rs::image_url`: Primary 400, thumb 640, Backdrop 1920, Logo 600, person 240. */
export function imageUrl(itemId: string, kind: ImageKind, maxWidth: number, tag?: string | null): string {
  const path = kind === "Backdrop" ? `/Items/${itemId}/Images/Backdrop/0` : `/Items/${itemId}/Images/${kind}`;
  return serverImageUrl(path, { maxWidth, quality: 90, tag: tag ?? undefined });
}

export function userImageUrl(userId: string, tag?: string | null): string {
  return serverImageUrl(`/Users/${userId}/Images/Primary`, { quality: 90, tag: tag ?? undefined });
}

export function personImageUrl(personId: string, tag?: string | null): string {
  return imageUrl(personId, "Primary", 240, tag);
}
