/**
 * Large playlist / guide downloads go to disk (`expo-file-system`), capped in size, and
 * are read back either whole (playlists) or as a stream of text chunks (XMLTV).
 */
import { File } from "expo-file-system";
import { Gunzip } from "fflate";
import { USER_AGENT, isGzip, shortError } from "../http";
import { deleteIfExists } from "../store";
import { sleep } from "../util";
import { Utf8Stream, decodeUtf8 } from "./m3u";

export const MAX_PLAYLIST_BYTES = 32 * 1024 * 1024;
export const MAX_EPG_BYTES = 100 * 1024 * 1024;
/** A gzip bomb must not keep the CPU busy forever: inflated guide text is capped too. */
const MAX_INFLATED_BYTES = 512 * 1024 * 1024;
const HTTP_TIMEOUT_MS = 120_000;

function describeDownloadError(error: unknown): string {
  const message = shortError(error);
  const status = message.match(/\b([45]\d\d)\b/);
  if (status) return `El servidor respondió ${status[1]}`;
  if (message === "No se pudo conectar") return "No se pudo conectar: no responde";
  if (message === "Tiempo de espera agotado") return "No se pudo conectar: tiempo de espera agotado";
  return `No se pudo conectar: ${message}`;
}

/** Downloads `url` into `file`, rejecting anything over `maxBytes`. */
export async function downloadToFile(
  url: string,
  file: File,
  options: { userAgent: string | null; maxBytes: number },
): Promise<File> {
  deleteIfExists(file);
  const controller = new AbortController();
  let tooBig = false;
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    await File.downloadFileAsync(url, file, {
      headers: { "user-agent": options.userAgent ?? USER_AGENT },
      idempotent: true,
      signal: controller.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (bytesWritten > options.maxBytes || totalBytes > options.maxBytes) {
          tooBig = true;
          controller.abort();
        }
      },
    });
  } catch (error) {
    deleteIfExists(file);
    if (tooBig) throw new Error("La respuesta es demasiado grande");
    if (controller.signal.aborted) throw new Error("No se pudo conectar: tiempo de espera agotado");
    throw new Error(describeDownloadError(error));
  } finally {
    clearTimeout(timer);
  }
  if ((file.size ?? 0) > options.maxBytes) {
    deleteIfExists(file);
    throw new Error("La respuesta es demasiado grande");
  }
  return file;
}

/** Inflates a gzip buffer, failing past `max` output bytes. */
export function gunzipCapped(bytes: Uint8Array, max: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inflater = new Gunzip((data) => {
    total += data.length;
    if (total > max) throw new Error("La respuesta es demasiado grande");
    chunks.push(data);
  });
  try {
    inflater.push(bytes, true);
  } catch (error) {
    const message = shortError(error);
    throw new Error(message === "La respuesta es demasiado grande" ? message : "No se pudo descomprimir la lista");
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Whole file as text (gzip-aware), for playlists. */
export async function readTextFile(file: File, max: number, tooBig: string): Promise<string> {
  let bytes: Uint8Array = await file.bytes();
  if (bytes.length > max) throw new Error(tooBig);
  if (isGzip(bytes)) bytes = gunzipCapped(bytes, max);
  return decodeUtf8(bytes);
}

/**
 * Streams a (possibly gzipped) UTF-8 text file: each chunk is decoded and handed to
 * `onText`, yielding to the JS thread in between so the UI keeps responding.
 */
export async function streamTextFile(file: File, onText: (text: string) => void | Promise<void>): Promise<void> {
  const reader = file.readableStream().getReader();
  const utf8 = new Utf8Stream();
  let parts: string[] = [];
  let inflated = 0;
  let gunzip: Gunzip | null = null;
  let first = true;
  const feed = (bytes: Uint8Array) => {
    const text = utf8.push(bytes);
    if (text !== "") parts.push(text);
  };
  const flush = async () => {
    if (parts.length === 0) return;
    const text = parts.length === 1 ? parts[0] : parts.join("");
    parts = [];
    await onText(text);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;
      if (first) {
        first = false;
        if (isGzip(value)) {
          gunzip = new Gunzip((data) => {
            inflated += data.length;
            if (inflated > MAX_INFLATED_BYTES) throw new Error("La respuesta es demasiado grande");
            feed(data);
          });
        }
      }
      if (gunzip) gunzip.push(value);
      else feed(value);
      await flush();
      await sleep(0);
    }
    if (gunzip) gunzip.push(new Uint8Array(0), true);
    const tail = utf8.finish();
    if (tail !== "") parts.push(tail);
    await flush();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* stream already closed */
    }
  }
}
