import { CLIENT_VERSION } from "./util";

export const USER_AGENT = `ejFlix/${CLIENT_VERSION} (Android)`;

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export type FetchOptions = RequestInit & { timeoutMs?: number };

/** `fetch` with an AbortController timeout (default 20 s). */
export async function fetchWithTimeout(url: string, options: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = 20_000, signal, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  // An already-aborted signal never fires "abort" again.
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", onOuterAbort);
  try {
    const headers = new Headers(init.headers);
    if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);
    return await fetch(url, { ...init, headers, signal: controller.signal });
  } catch (error) {
    if (signal?.aborted) throw new Error("Cancelado");
    if (controller.signal.aborted) throw new Error("Tiempo de espera agotado");
    throw new Error(shortError(error));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const response = await fetchWithTimeout(url, options);
  if (!response.ok) {
    throw new HttpError(`HTTP ${response.status}`, response.status, url);
  }
  return (await response.json()) as T;
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const response = await fetchWithTimeout(url, options);
  if (!response.ok) throw new HttpError(`HTTP ${response.status}`, response.status, url);
  return response.text();
}

/** Human readable message out of anything thrown. */
export function shortError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message || error.name;
    if (/network request failed/i.test(message)) return "No se pudo conectar";
    return message;
  }
  return typeof error === "string" ? error : "Error desconocido";
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}
