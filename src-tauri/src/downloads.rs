//! Downloads of online sources (Stremio addon streams) to the user's Downloads folder.
//!
//! The webview never writes to disk: it asks for a stream to be saved, Rust downloads it
//! with the addon's own request headers (never the Jellyfin token), reports progress
//! through `downloads://changed` and keeps the list in the store so it survives restarts.
//! Files land in `<Downloads>/ejFlix`, written as `<name>.part` until they are complete.

use std::collections::HashMap;
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_store::StoreExt;

/// Emitted with the whole list whenever anything changes (added, progress, finished).
pub const CHANGED_EVENT: &str = "downloads://changed";
const STORE_KEY: &str = "downloads";
const MAX_ITEMS: usize = 60;
/// Downloads running at the same time; more would only fight for the same bandwidth.
const MAX_ACTIVE: usize = 3;
const EMIT_EVERY: Duration = Duration::from_millis(300);
const MAX_NAME: usize = 120;
/// A server that sends nothing for this long is stalled: the download fails instead of
/// hanging forever (and holding one of the `MAX_ACTIVE` slots).
const READ_TIMEOUT: Duration = Duration::from_secs(60);

pub const DOWNLOADING: &str = "downloading";
pub const DONE: &str = "done";
pub const ERROR: &str = "error";
pub const CANCELED: &str = "canceled";

/// Extensions kept from a URL; anything else (`.php`, `.cgi`…) is not a container.
const VIDEO_EXTS: &[&str] = &[
    "mkv", "mp4", "avi", "m4v", "mov", "webm", "ts", "m2ts", "mpg", "mpeg", "wmv", "flv", "ogv",
    "3gp", "mp3", "m4a", "flac", "srt", "ass", "sub",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DownloadItem {
    pub id: String,
    /// File name on disk.
    pub name: String,
    /// What is being downloaded, as shown in the app (movie or episode).
    pub title: String,
    /// Addon that served the stream.
    pub source: String,
    pub path: String,
    pub received: u64,
    /// 0 when the server does not say how big the file is.
    pub total: u64,
    /// `downloading` | `done` | `error` | `canceled`
    pub status: String,
    pub error: Option<String>,
    pub started_ms: u64,
    pub updated_ms: u64,
}

impl Default for DownloadItem {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            title: String::new(),
            source: String::new(),
            path: String::new(),
            received: 0,
            total: 0,
            status: CANCELED.into(),
            error: None,
            started_ms: 0,
            updated_ms: 0,
        }
    }
}

/// What the picker sends to save a stream.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StartArgs {
    pub url: String,
    /// Proxy headers the addon asks for (the Jellyfin token is never among them).
    pub headers: Vec<(String, String)>,
    pub title: String,
    /// File name the addon reports, when it has one.
    pub file_name: String,
    pub source: String,
    /// Size the addon reports, used until the server answers with its own.
    pub size: Option<u64>,
}

pub struct Downloads {
    http: reqwest::Client,
    items: Mutex<Vec<DownloadItem>>,
    /// Cancel flag of each running download.
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

enum Outcome {
    Done(u64),
    Canceled,
}

impl Downloads {
    pub fn new() -> Self {
        // No request timeout: a download legitimately takes hours. Connecting and each
        // read are bounded, so a stalled server ends the download instead of hanging it.
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .read_timeout(READ_TIMEOUT)
            .user_agent(format!("ejFlix/{}", env!("CARGO_PKG_VERSION")))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .expect("http client");
        Self {
            http,
            items: Mutex::new(Vec::new()),
            cancels: Mutex::new(HashMap::new()),
        }
    }

    pub fn list(&self) -> Vec<DownloadItem> {
        self.items.lock().unwrap().clone()
    }

    /// Restores the list saved by a previous run: anything that was still downloading is
    /// marked as canceled (its partial file is dropped) and finished files that the user
    /// has since deleted leave the list.
    pub fn load(&self, app: &tauri::AppHandle) {
        let Ok(store) = app.store(crate::store_path()) else {
            return;
        };
        let saved: Vec<DownloadItem> = store
            .get(STORE_KEY)
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        let mut list: Vec<DownloadItem> = Vec::new();
        for mut item in saved.into_iter().take(MAX_ITEMS) {
            if item.status == DOWNLOADING {
                let _ = std::fs::remove_file(partial_of(&item.path));
                item.status = CANCELED.into();
            }
            if item.status == DONE && !Path::new(&item.path).is_file() {
                continue;
            }
            list.push(item);
        }
        *self.items.lock().unwrap() = list;
    }

    fn persist(&self, app: &tauri::AppHandle) {
        let Ok(store) = app.store(crate::store_path()) else {
            return;
        };
        if let Ok(value) = serde_json::to_value(self.list()) {
            store.set(STORE_KEY, value);
            let _ = store.save();
        }
    }

    fn emit(&self, app: &tauri::AppHandle) {
        let _ = app.emit(CHANGED_EVENT, self.list());
    }

    /// Applies `f` to the item and emits the new list. False when the item is gone
    /// (the user removed it), which tells a running download to stop.
    fn touch(&self, app: &tauri::AppHandle, id: &str, f: impl FnOnce(&mut DownloadItem)) -> bool {
        let list = {
            let mut items = self.items.lock().unwrap();
            let Some(item) = items.iter_mut().find(|i| i.id == id) else {
                return false;
            };
            f(item);
            item.updated_ms = crate::addons::now_ms();
            items.clone()
        };
        let _ = app.emit(CHANGED_EVENT, list);
        true
    }

    fn active(&self) -> usize {
        self.items
            .lock()
            .unwrap()
            .iter()
            .filter(|i| i.status == DOWNLOADING)
            .count()
    }

    /// Queues a stream for download and returns the new entry.
    pub fn start(
        self: &Arc<Self>,
        app: &tauri::AppHandle,
        args: StartArgs,
    ) -> Result<DownloadItem, String> {
        if !(args.url.starts_with("http://") || args.url.starts_with("https://")) {
            return Err("Solo se pueden descargar enlaces http o https".into());
        }
        if args.url.len() > 4096 || args.url.chars().any(|c| c.is_control()) {
            return Err("Enlace no válido".into());
        }
        if self.active() >= MAX_ACTIVE {
            return Err(format!("Ya hay {MAX_ACTIVE} descargas en curso"));
        }
        let dir = downloads_dir(app);
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("No se pudo crear la carpeta de descargas: {e}"))?;
        let wanted = target_name(&args.file_name, &args.title, &args.url);
        let cancel = Arc::new(AtomicBool::new(false));
        // The name is picked and the entry added under one lock: a download whose task
        // is still running holds its name even before its `.part` file exists on disk.
        let mut items = self.items.lock().unwrap();
        let mut cancels = self.cancels.lock().unwrap();
        let busy: std::collections::HashSet<String> = items
            .iter()
            .filter(|i| cancels.contains_key(&i.id))
            .map(|i| i.name.to_lowercase())
            .collect();
        let name = unique_name(&dir, &wanted, &busy);
        let path = dir.join(&name);
        let item = DownloadItem {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            title: args.title.chars().take(200).collect(),
            source: args.source.chars().take(80).collect(),
            path: path.to_string_lossy().into_owned(),
            received: 0,
            total: args.size.unwrap_or(0),
            status: DOWNLOADING.into(),
            error: None,
            started_ms: crate::addons::now_ms(),
            updated_ms: crate::addons::now_ms(),
        };
        items.insert(0, item.clone());
        items.truncate(MAX_ITEMS);
        cancels.insert(item.id.clone(), cancel.clone());
        drop(cancels);
        drop(items);
        self.emit(app);
        self.persist(app);

        let state = self.clone();
        let app = app.clone();
        let id = item.id.clone();
        let headers = args.headers;
        let url = args.url;
        tauri::async_runtime::spawn(async move {
            let result = state.run(&app, &id, &url, &headers, &cancel).await;
            let alive = match result {
                Ok(Outcome::Done(size)) => state.touch(&app, &id, |item| {
                    item.status = DONE.into();
                    item.received = size;
                    if item.total == 0 || item.total != size {
                        item.total = size;
                    }
                }),
                Ok(Outcome::Canceled) => state.touch(&app, &id, |item| {
                    item.status = CANCELED.into();
                }),
                Err(error) => state.touch(&app, &id, |item| {
                    item.status = ERROR.into();
                    item.error = Some(error.chars().take(200).collect());
                }),
            };
            state.cancels.lock().unwrap().remove(&id);
            if alive {
                state.persist(&app);
            }
        });
        Ok(item)
    }

    async fn run(
        &self,
        app: &tauri::AppHandle,
        id: &str,
        url: &str,
        headers: &[(String, String)],
        cancel: &AtomicBool,
    ) -> Result<Outcome, String> {
        let path = {
            let items = self.items.lock().unwrap();
            items
                .iter()
                .find(|i| i.id == id)
                .map(|i| PathBuf::from(&i.path))
                .ok_or_else(|| "Descarga cancelada".to_string())?
        };
        let partial = partial_of(&path.to_string_lossy());
        let mut request = self.http.get(url);
        for (key, value) in headers {
            if key.eq_ignore_ascii_case("x-emby-token") || key.is_empty() {
                continue;
            }
            if !key.is_ascii() || value.chars().any(|c| c.is_control()) {
                continue;
            }
            request = request.header(key, value);
        }
        let mut response = request
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    "El servidor no responde".to_string()
                } else if e.is_connect() {
                    "No se pudo conectar".to_string()
                } else {
                    short_error(&e)
                }
            })?
            .error_for_status()
            .map_err(|e| match e.status() {
                Some(status) => format!("El servidor respondió {}", status.as_u16()),
                None => short_error(&e),
            })?;
        let total = response.content_length().unwrap_or(0);
        if total > 0 {
            self.touch(app, id, |item| item.total = total);
        }
        // Canceled while waiting for the server: its name may already be someone else's.
        if cancel.load(Ordering::SeqCst) {
            return Ok(Outcome::Canceled);
        }
        let mut file = std::fs::File::create(&partial)
            .map_err(|e| format!("No se pudo crear el archivo: {e}"))?;
        let mut received: u64 = 0;
        let mut last_emit = Instant::now();
        loop {
            if cancel.load(Ordering::SeqCst) {
                drop(file);
                let _ = std::fs::remove_file(&partial);
                return Ok(Outcome::Canceled);
            }
            let chunk = match response.chunk().await {
                Ok(Some(chunk)) => chunk,
                Ok(None) => break,
                Err(e) => {
                    drop(file);
                    let _ = std::fs::remove_file(&partial);
                    return Err(format!("Descarga interrumpida: {}", short_error(&e)));
                }
            };
            if let Err(e) = file.write_all(&chunk) {
                drop(file);
                let _ = std::fs::remove_file(&partial);
                return Err(format!("No se pudo escribir en el disco: {e}"));
            }
            received += chunk.len() as u64;
            if last_emit.elapsed() >= EMIT_EVERY {
                last_emit = Instant::now();
                // The entry disappearing means the user removed it: stop and clean up.
                if !self.touch(app, id, |item| item.received = received) {
                    drop(file);
                    let _ = std::fs::remove_file(&partial);
                    return Ok(Outcome::Canceled);
                }
            }
        }
        file.flush().map_err(|e| e.to_string())?;
        drop(file);
        if total > 0 && received != total {
            let _ = std::fs::remove_file(&partial);
            return Err("La descarga quedó incompleta".into());
        }
        std::fs::rename(&partial, &path).map_err(|e| format!("No se pudo guardar el archivo: {e}"))?;
        Ok(Outcome::Done(received))
    }

    pub fn cancel(&self, app: &tauri::AppHandle, id: &str) {
        if let Some(flag) = self.cancels.lock().unwrap().get(id) {
            flag.store(true, Ordering::SeqCst);
        }
        self.touch(app, id, |item| {
            if item.status == DOWNLOADING {
                item.status = CANCELED.into();
            }
        });
        self.persist(app);
    }

    /// Drops the entry from the list. A finished file stays on disk; a partial one goes.
    pub fn remove(&self, app: &tauri::AppHandle, id: &str) {
        if let Some(flag) = self.cancels.lock().unwrap().get(id) {
            flag.store(true, Ordering::SeqCst);
        }
        {
            let mut items = self.items.lock().unwrap();
            if let Some(index) = items.iter().position(|i| i.id == id) {
                let item = items.remove(index);
                if item.status != DONE {
                    let _ = std::fs::remove_file(partial_of(&item.path));
                }
            }
        }
        self.emit(app);
        self.persist(app);
    }

    /// Clears everything that is not running.
    pub fn clear_finished(&self, app: &tauri::AppHandle) {
        self.items
            .lock()
            .unwrap()
            .retain(|item| item.status == DOWNLOADING);
        self.emit(app);
        self.persist(app);
    }

    /// Opens the Explorer window of a finished download with the file selected.
    pub fn reveal(&self, id: &str) -> Result<(), String> {
        let path = self
            .items
            .lock()
            .unwrap()
            .iter()
            .find(|i| i.id == id)
            .map(|i| i.path.clone())
            .ok_or_else(|| "Descarga no encontrada".to_string())?;
        let file = PathBuf::from(&path);
        if !file.is_file() {
            // Still downloading, or the user moved the file: open the folder itself.
            let dir = file.parent().filter(|d| d.is_dir()).ok_or("El archivo ya no está")?;
            std::process::Command::new("explorer.exe")
                .raw_arg(format!("\"{}\"", dir.display()))
                .spawn()
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
        if path.contains('"') {
            return Err("Ruta no válida".into());
        }
        std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{path}\""))
            .spawn()
            .map_err(|e| format!("No se pudo abrir la carpeta: {e}"))?;
        Ok(())
    }
}

fn short_error(err: &reqwest::Error) -> String {
    let text = err.to_string();
    text.split(':').last().unwrap_or(&text).trim().to_string()
}

fn partial_of(path: &str) -> PathBuf {
    PathBuf::from(format!("{path}.part"))
}

/// `<Downloads>/ejFlix`, or the app data folder when Windows has no Downloads folder.
/// A throwaway instance (`EJFLIX_DATA_DIR`) keeps its downloads with the rest of its data.
fn downloads_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(dir) = std::env::var("EJFLIX_DATA_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir).join("downloads");
        }
    }
    app.path()
        .download_dir()
        .unwrap_or_else(|_| crate::iptv::data_dir(app))
        .join("ejFlix")
}

/// File name for a stream: what the addon calls it, else the title, always with a
/// container extension.
pub fn target_name(file_name: &str, title: &str, url: &str) -> String {
    let mut name = sanitize(file_name);
    if name.is_empty() {
        name = sanitize(title);
    }
    if name.is_empty() {
        name = "descarga".to_string();
    }
    if extension_of(&name).is_none() {
        let ext = url_extension(url).unwrap_or_else(|| "mkv".to_string());
        name = format!("{name}.{ext}");
    }
    name
}

/// Keeps a plain file name: path separators and every character Windows rejects become
/// spaces, so the result can never point outside the downloads folder.
fn sanitize(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '|' | '?' | '*' | '/' | '\\' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim_matches(|c: char| c == '.' || c.is_whitespace());
    if is_reserved(trimmed) {
        return format!("_{trimmed}");
    }
    if trimmed.chars().count() <= MAX_NAME {
        return trimmed.to_string();
    }
    // Too long: keep the start of the name and its extension.
    match extension_of(trimmed) {
        Some(ext) => {
            let keep = MAX_NAME.saturating_sub(ext.len() + 1);
            let stem: String = trimmed.chars().take(keep).collect();
            format!("{}.{ext}", stem.trim_end())
        }
        None => trimmed.chars().take(MAX_NAME).collect(),
    }
}

/// Windows refuses these names whatever the folder and the extension are.
fn is_reserved(name: &str) -> bool {
    const RESERVED: &[&str] = &[
        "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7",
        "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    ];
    let stem = name.split('.').next().unwrap_or("").to_ascii_lowercase();
    RESERVED.contains(&stem.as_str())
}

/// Extension of a file name, when it looks like one (1–5 alphanumerics).
fn extension_of(name: &str) -> Option<String> {
    let (stem, ext) = name.rsplit_once('.')?;
    if stem.is_empty() || ext.is_empty() || ext.len() > 5 {
        return None;
    }
    ext.chars()
        .all(|c| c.is_ascii_alphanumeric())
        .then(|| ext.to_ascii_lowercase())
}

/// Container extension of a URL path, ignoring anything that is not a media file.
fn url_extension(url: &str) -> Option<String> {
    let path = url.split(['?', '#']).next()?;
    let last = path.rsplit('/').next()?;
    let ext = extension_of(last)?;
    VIDEO_EXTS.contains(&ext.as_str()).then_some(ext)
}

/// `name`, `name (2)`, `name (3)`… until nothing on disk uses it.
/// `busy` holds the (lowercase) names of downloads still running.
fn unique_name(dir: &Path, name: &str, busy: &std::collections::HashSet<String>) -> String {
    let used = |candidate: &str| busy.contains(&candidate.to_lowercase()) || taken(dir, candidate);
    if !used(name) {
        return name.to_string();
    }
    let (stem, ext) = match extension_of(name) {
        Some(ext) => (name[..name.len() - ext.len() - 1].to_string(), format!(".{ext}")),
        None => (name.to_string(), String::new()),
    };
    for n in 2..100 {
        let candidate = format!("{stem} ({n}){ext}");
        if !used(&candidate) {
            return candidate;
        }
    }
    format!("{stem} ({}){ext}", crate::addons::now_ms())
}

fn taken(dir: &Path, name: &str) -> bool {
    let path = dir.join(name);
    path.exists() || partial_of(&path.to_string_lossy()).exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_streams() {
        assert_eq!(
            target_name("The.Matrix.1999.1080p.mkv", "The Matrix", "http://x/y"),
            "The.Matrix.1999.1080p.mkv"
        );
        // No file name from the addon: the title plus the container of the URL.
        assert_eq!(
            target_name("", "Dark · S1:E3 · Pasado y presente", "https://cdn.x/v/file.mp4?token=1"),
            "Dark · S1 E3 · Pasado y presente.mp4"
        );
        // Unknown container: mkv, the safest default for a remux.
        assert_eq!(target_name("", "Peli", "https://cdn.x/stream.php?id=2"), "Peli.mkv");
        assert_eq!(target_name("", "", ""), "descarga.mkv");
    }

    #[test]
    fn sanitizes_names() {
        // Nothing that could walk out of the downloads folder survives.
        for raw in ["../../etc/passwd", r"C:\Windows\system32\evil.exe", "a/b\\c.mkv"] {
            let name = sanitize(raw);
            assert!(!name.contains('/') && !name.contains('\\') && !name.contains(".."), "{name}");
        }
        assert_eq!(sanitize("../../etc/passwd"), "etc passwd");
        assert_eq!(sanitize("nul.mkv"), "_nul.mkv");
        assert_eq!(sanitize("a\"b<c>d|e?f*g.mkv"), "a b c d e f g.mkv");
        assert_eq!(sanitize("  ..hola..  "), "hola");
        assert_eq!(sanitize("línea\nrota.mp4"), "línea rota.mp4");
        let long = format!("{}.mkv", "a".repeat(400));
        let short = sanitize(&long);
        assert!(short.chars().count() <= MAX_NAME);
        assert!(short.ends_with(".mkv"));
    }

    #[test]
    fn reads_extensions() {
        assert_eq!(extension_of("film.MKV"), Some("mkv".to_string()));
        assert_eq!(extension_of("film.name.mp4"), Some("mp4".to_string()));
        assert_eq!(extension_of("no-extension"), None);
        assert_eq!(extension_of("too.longextension"), None);
        assert_eq!(url_extension("https://x/y/film.mkv?tok=1"), Some("mkv".to_string()));
        assert_eq!(url_extension("https://x/download.php?id=1"), None);
        assert_eq!(url_extension("https://x/"), None);
    }

    #[test]
    fn keeps_partial_paths_next_to_the_file() {
        assert_eq!(
            partial_of(r"C:\Users\x\Downloads\ejFlix\film.mkv"),
            PathBuf::from(r"C:\Users\x\Downloads\ejFlix\film.mkv.part")
        );
    }
}
