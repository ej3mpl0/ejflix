/**
 * Update check against GitHub Releases and APK download / install hand-off
 * (port of `src-tauri/src/update.rs` and the `update_*` commands).
 */
import { File } from "expo-file-system";
import { getContentUriAsync } from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { Platform } from "react-native";
import type { UpdateCheck, UpdatePrefs } from "../lib/types";
import { emit } from "./events";
import { fetchWithTimeout, shortError } from "./http";
import { KEYS, PATHS, deleteIfExists, store } from "./store";
import { CLIENT_VERSION, nowMs } from "./util";
import {
  CACHE_TTL_MS,
  RELEASES_URL,
  REPO,
  allowedDownloadUrl,
  formatVersion,
  isNewer,
  parseVersion,
  pickAsset,
  safeAssetName,
} from "./updates.pure";

/** iOS only checks: the IPA is sideloaded by hand (AltStore, SideStore, Sideloadly). */
export const IS_IOS = Platform.OS === "ios";

const CHECK_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 600_000;
const PROGRESS_EVERY_MS = 150;

let last: { at: number; check: UpdateCheck } | null = null;
/** Serializes downloads (a second tap must not write the same file twice). */
let downloadChain: Promise<unknown> = Promise.resolve();

function loadPrefs(): UpdatePrefs {
  const auto = store.get<unknown>(KEYS.updateAuto);
  const skippedRaw = store.get<unknown>(KEYS.updateSkipped);
  const skipped = typeof skippedRaw === "string" && skippedRaw !== "" ? skippedRaw : null;
  return { auto: typeof auto === "boolean" ? auto : true, skipped };
}

export async function updateInfo(): Promise<{ current: string; showNotes: boolean }> {
  const seen = store.get<unknown>(KEYS.lastSeenVersion);
  if (typeof seen !== "string") {
    // Fresh install: remember the version silently. The notes describe what changed in an
    // update, so showing them to someone opening the app for the first time is noise.
    store.set(KEYS.lastSeenVersion, CLIENT_VERSION);
    return { current: CLIENT_VERSION, showNotes: false };
  }
  return { current: CLIENT_VERSION, showNotes: seen !== CLIENT_VERSION };
}

export async function dismissUpdate(): Promise<void> {
  store.set(KEYS.lastSeenVersion, CLIENT_VERSION);
}

export async function updatePrefs(): Promise<UpdatePrefs> {
  return loadPrefs();
}

export async function updateSetAuto(auto: boolean): Promise<UpdatePrefs> {
  store.set(KEYS.updateAuto, auto);
  return loadPrefs();
}

/** Remember (or forget, with an empty string) a version the user does not want to see again. */
export async function updateSkip(version: string): Promise<UpdatePrefs> {
  const parts = parseVersion(version);
  store.set(KEYS.updateSkipped, parts ? formatVersion(parts) : "");
  return loadPrefs();
}

/** Latest release from GitHub. `force` skips the 30 minute cache. */
export async function updateCheck(force = false): Promise<UpdateCheck> {
  const skipped = loadPrefs().skipped;
  if (!force && last && nowMs() - last.at < CACHE_TTL_MS) {
    return { ...last.check, skipped: skipped === last.check.latest };
  }
  const url = `https://api.github.com/repos/${REPO}/releases/latest`;
  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      timeoutMs: CHECK_TIMEOUT_MS,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": `ejFlix/${CLIENT_VERSION} (+https://github.com/${REPO})`,
      },
    });
  } catch (error) {
    const message = shortError(error);
    if (message === "Tiempo de espera agotado") throw new Error("GitHub no responde");
    if (message === "No se pudo conectar") throw new Error("Sin conexión");
    throw new Error(message);
  }
  if (res.status === 404) throw new Error("No hay versiones publicadas");
  if (res.status === 403 || res.status === 429) throw new Error("GitHub ha limitado las consultas; prueba más tarde");
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch (error) {
    throw new Error(shortError(error));
  }
  const tag = typeof body.tag_name === "string" ? body.tag_name : "";
  const parts = parseVersion(tag);
  if (!parts) throw new Error(`Etiqueta de versión no reconocida: ${tag}`);
  const latest = formatVersion(parts);
  const asset = pickAsset(Array.isArray(body.assets) ? body.assets : [], IS_IOS ? ".ipa" : ".apk");
  const check: UpdateCheck = {
    current: CLIENT_VERSION,
    latest,
    // iOS cannot install from inside the app: a release only counts once it carries
    // the IPA the user sideloads by hand.
    available: isNewer(latest, CLIENT_VERSION) && (!IS_IOS || asset != null),
    skipped: skipped === latest,
    notes: typeof body.body === "string" ? body.body : "",
    url: typeof body.html_url === "string" ? body.html_url : RELEASES_URL,
    // No in-app download on iOS: the dialog links to the release page instead.
    assetUrl: IS_IOS ? null : (asset?.url ?? null),
    assetName: asset?.name ?? null,
    assetSize: asset && asset.size > 0 ? asset.size : null,
    publishedAt: typeof body.published_at === "string" ? body.published_at : null,
    checkedAtMs: nowMs(),
  };
  last = { at: nowMs(), check };
  return check;
}

/** Downloads the APK of the latest checked release, reporting `update://progress`. */
export function updateDownload(): Promise<{ path: string; size: number }> {
  const run = downloadChain.then(doDownload, doDownload);
  downloadChain = run.catch(() => undefined);
  return run;
}

async function doDownload(): Promise<{ path: string; size: number }> {
  if (IS_IOS) throw new Error("En iOS la actualización se instala desde AltStore, SideStore o Sideloadly");
  const check = last?.check;
  if (!check) throw new Error("Comprueba primero si hay actualizaciones");
  if (!check.available) throw new Error("Ya tienes la última versión");
  if (!check.assetUrl || !check.assetName) throw new Error("Esta versión no incluye instalador");
  if (!allowedDownloadUrl(check.assetUrl)) throw new Error("Origen del instalador no permitido");
  const dir = PATHS.updateDir();
  const target = new File(dir, safeAssetName(check.assetName));
  // Already downloaded and complete: reuse it.
  if (check.assetSize != null && target.exists && target.size === check.assetSize) {
    emit("update://progress", { received: check.assetSize, total: check.assetSize });
    return { path: target.uri, size: check.assetSize };
  }
  const partial = new File(dir, `${target.name}.part`);
  deleteIfExists(partial);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let received = 0;
  let lastEmit = 0;
  try {
    await File.downloadFileAsync(check.assetUrl, partial, {
      headers: { "user-agent": `ejFlix/${CLIENT_VERSION}` },
      idempotent: true,
      signal: controller.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        received = bytesWritten;
        const now = nowMs();
        if (now - lastEmit >= PROGRESS_EVERY_MS) {
          lastEmit = now;
          const total = totalBytes > 0 ? totalBytes : (check.assetSize ?? 0);
          emit("update://progress", { received, total });
        }
      },
    });
  } catch (error) {
    deleteIfExists(partial);
    if (controller.signal.aborted) throw new Error("Tiempo de espera agotado");
    throw new Error(shortError(error));
  } finally {
    clearTimeout(timer);
  }
  received = partial.size ?? received;
  if (check.assetSize != null && received !== check.assetSize) {
    deleteIfExists(partial);
    throw new Error(`Descarga incompleta (${received} de ${check.assetSize} bytes)`);
  }
  deleteIfExists(target);
  await partial.move(target);
  emit("update://progress", { received, total: received });
  return { path: target.uri, size: received };
}

function sameDir(a: string, b: string): boolean {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

/** Opens the Android package installer for a downloaded APK. */
export async function updateInstall(path: string): Promise<void> {
  const file = new File(path);
  const inside = sameDir(file.parentDirectory.uri, PATHS.updateDir().uri);
  if (!inside || !file.exists) throw new Error("Instalador no encontrado");
  const contentUri = await getContentUriAsync(file.uri);
  try {
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: contentUri,
      type: "application/vnd.android.package-archive",
      flags: 1 | 0x10000000,
    });
  } catch (error) {
    throw new Error(`No se pudo abrir el instalador: ${shortError(error)}`);
  }
}
