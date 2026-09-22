/**
 * Authenticated HTTP client for the Jellyfin server (ported from `jellyfin.rs`).
 * The singleton `jellyfin` gets its session from `services/session.ts`.
 */
import { fetchWithTimeout, HttpError } from "../http";
import { CLIENT_NAME, CLIENT_VERSION } from "../util";

export type JellyfinSession = {
  serverUrl: string;
  token: string;
  userId: string;
  userName: string;
  deviceId: string;
  /** Token-less picture URL of the user (null when unknown). */
  avatarUrl: string | null;
};

export const REQUEST_TIMEOUT_MS = 20_000;

let deviceName = "Android";

/** Sets the `Device` shown in the Jellyfin dashboard (ASCII only, no quotes, ≤ 64 chars). */
export function setDeviceName(name: string | null | undefined): void {
  const cleaned = (name ?? "")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/["\\]/g, "")
    .trim()
    .slice(0, 64);
  deviceName = cleaned || "Android";
}

export function getDeviceName(): string {
  return deviceName;
}

/** `MediaBrowser Client="ejFlix", Device="…", DeviceId="…", Version="…"[, Token="…"]`. */
export function authHeaders(deviceId: string, token: string | null): Record<string, string> {
  const tokenPart = token ? `, Token="${token}"` : "";
  const value = `MediaBrowser Client="${CLIENT_NAME}", Device="${deviceName}", DeviceId="${deviceId}", Version="${CLIENT_VERSION}"${tokenPart}`;
  const headers: Record<string, string> = {
    Authorization: value,
    "X-Emby-Authorization": value,
  };
  if (token) headers["X-Emby-Token"] = token;
  return headers;
}

function hasUserinfo(url: string): boolean {
  const index = url.indexOf("://");
  if (index < 0) return false;
  const authority = url.slice(index + 3).split("/")[0] ?? "";
  return authority.includes("@");
}

function hostOf(url: string): string | null {
  const index = url.indexOf("://");
  if (index < 0) return null;
  const authority = url.slice(index + 3).split("/")[0] ?? "";
  let host: string;
  if (authority.startsWith("[")) {
    host = authority.slice(1).split("]")[0] ?? "";
  } else {
    host = authority.split(":")[0] ?? "";
  }
  return host ? host : null;
}

/** `jellyfin.rs::normalize_url`: adds `http://`, strips trailing `/`, rejects userinfo. */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 2048) throw new Error("URL no válida");
  let u = trimmed.replace(/\/+$/, "");
  if (!u.startsWith("http://") && !u.startsWith("https://")) {
    if (u.includes("://")) throw new Error("Solo se permiten URLs http o https");
    u = `http://${u}`;
  }
  if (hasUserinfo(u)) throw new Error("La URL no debe incluir usuario ni contraseña");
  if (!hostOf(u)) throw new Error("URL no válida");
  return u;
}

/** Token-less user picture (Jellyfin serves user images anonymously, as on its login page). */
export function publicUserImageUrl(serverUrl: string, userId: string, tag: string | null | undefined): string {
  const base = `${serverUrl.replace(/\/+$/, "")}/Users/${userId}/Images/Primary`;
  return tag ? `${base}?tag=${encodeURIComponent(tag)}&quality=90` : `${base}?quality=90`;
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export function buildQuery(query: Query | undefined): string {
  if (!query) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === "") continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export class JellyfinClient {
  session: JellyfinSession | null = null;

  get serverUrl(): string | null {
    return this.session?.serverUrl ?? null;
  }

  /** Throws "No hay sesión activa" without a session. */
  require(): JellyfinSession {
    if (!this.session) throw new Error("No hay sesión activa");
    return this.session;
  }

  authHeaders(): Record<string, string> {
    const session = this.require();
    return authHeaders(session.deviceId, session.token);
  }

  /** Raw request against `path` (which may carry its own query string). */
  async request(
    method: string,
    path: string,
    body?: unknown,
    options: { timeoutMs?: number; query?: Query } = {},
  ): Promise<Response> {
    const session = this.require();
    const url = `${session.serverUrl}${path}${buildQuery(options.query)}`;
    const headers: Record<string, string> = { ...authHeaders(session.deviceId, session.token), Accept: "application/json" };
    let payload: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    } else if (method !== "GET" && method !== "HEAD") {
      headers["Content-Length"] = "0";
    }
    try {
      return await fetchWithTimeout(url, {
        method,
        headers,
        body: payload,
        timeoutMs: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      throw new Error(`Error de red: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** GET returning the raw response (callers that need the status, e.g. 404 fallbacks). */
  getResponse(path: string, query?: Query): Promise<Response> {
    return this.request("GET", path, undefined, { query });
  }

  /** GET parsed as JSON; throws `HttpError` on a non-2xx status. */
  async get<T>(path: string, query?: Query): Promise<T> {
    const response = await this.getResponse(path, query);
    if (!response.ok) throw new HttpError(`HTTP ${response.status}`, response.status, path);
    return (await response.json()) as T;
  }

  /** POST with a JSON body; an empty / 204 answer resolves to `undefined`. */
  async post<T = void>(path: string, body?: unknown, query?: Query): Promise<T> {
    const response = await this.request("POST", path, body, { query });
    if (!response.ok) throw new HttpError(`Jellyfin ${path}: ${response.status}`, response.status, path);
    return (await readJson(response)) as T;
  }

  /** Body-less POST/DELETE toggle; returns the raw response. */
  sendEmpty(method: "POST" | "DELETE", path: string, query?: Query): Promise<Response> {
    return this.request(method, path, undefined, { query });
  }

  async del(path: string, query?: Query): Promise<void> {
    const response = await this.sendEmpty("DELETE", path, query);
    if (!response.ok) throw new HttpError(`Jellyfin ${path}: ${response.status}`, response.status, path);
  }
}

async function readJson(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The app-wide client; `services/session.ts` owns its `session`. */
export const jellyfin = new JellyfinClient();
