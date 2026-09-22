//! Built-in BitTorrent engine, on librqbit. An addon's bare torrent (an info hash and
//! a file index, what Peerflix, Torrentio or Comet answer without a debrid service)
//! becomes a local `http://127.0.0.1` URL that mpv opens and seeks in like any other
//! stream: pieces are fetched on demand around the byte being read, files land in a
//! cache folder with a size cap, a torrent nobody is watching is paused within
//! seconds, and after a few idle minutes the whole engine (DHT, listener) stops so it
//! leaves the connection and the router alone. Upload is capped by default.

use std::collections::{HashMap, HashSet};
use std::io::SeekFrom;
use std::net::Ipv4Addr;
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use librqbit::limits::LimitsConfig;
use librqbit::{AddTorrent, AddTorrentOptions, AddTorrentResponse, ListenerOptions, ManagedTorrent, Session, SessionOptions};
use serde::Serialize;

type ManagedTorrentHandle = Arc<ManagedTorrent>;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// Public trackers added to every magnet: addons often send a bare hash, and the DHT
/// alone can take a while to find the first peers. HTTP ones are listed too, because
/// some networks drop UDP altogether and then they are the only way to find anyone.
const DEFAULT_TRACKERS: &[&str] = &[
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://explodie.org:6969/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://tracker.openbittorrent.com:6969/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://tracker.tiny-vps.com:6969/announce",
    "udp://opentracker.i2p.rocks:6969/announce",
    "udp://tracker.dler.org:6969/announce",
    "http://tracker.opentrackr.org:1337/announce",
    "http://open.tracker.cl:1337/announce",
    "http://tracker.openbittorrent.com:80/announce",
    "http://p4p.arenabg.com:1337/announce",
    "http://tracker.files.fm:6969/announce",
    "http://tracker.bt4g.com:2095/announce",
    "https://tracker.tamersunion.org:443/announce",
    "https://tracker.gbitt.info:443/announce",
];
const VIDEO_EXT: &[&str] = &["mkv", "mp4", "avi", "m4v", "mov", "ts", "m2ts", "webm", "wmv", "flv", "mpg", "mpeg", "ogm"];
/// How long to wait for the torrent's metadata (its file list) before giving up.
const METADATA_TIMEOUT: Duration = Duration::from_secs(90);
/// A torrent with no reader for this long is paused (its files stay cached).
const IDLE_PAUSE: Duration = Duration::from_secs(15);
/// With nothing read for this long the whole engine stops: DHT chatter and incoming
/// peers keep a home router busy long after playback, and a restart is cheap.
const ENGINE_IDLE: Duration = Duration::from_secs(300);
/// Peers per torrent: enough for speed, few enough not to swamp a home router.
const PEER_LIMIT: usize = 50;
/// A read that finds no piece for this long ends the response (mpv reports it).
const READ_TIMEOUT: Duration = Duration::from_secs(120);
const READ_CHUNK: usize = 256 * 1024;
const MAX_REQUEST_BYTES: usize = 16 * 1024;

pub struct TorrentEngine {
    session: tokio::sync::Mutex<Option<Arc<Session>>>,
    /// Port of the local HTTP server once it runs.
    server: tokio::sync::Mutex<Option<u16>>,
    /// Torrents the engine holds, by info hash.
    active: Mutex<HashMap<String, Active>>,
    /// Last time anyone asked the engine for anything (a resolve still waiting for
    /// metadata has no `Active` entry yet, and must not be shut down under).
    touched: Mutex<Instant>,
}

struct Active {
    handle: ManagedTorrentHandle,
    last_used: Instant,
    /// HTTP responses being streamed from it right now.
    readers: usize,
    paused: bool,
}

/// Live numbers of a torrent (see `TorrentEngine::status`).
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentStatus {
    pub known: bool,
    pub peers: u64,
    pub down_mbps: f64,
    pub up_mbps: f64,
    pub progress_bytes: u64,
    pub total_bytes: u64,
}

/// What the player gets back for a torrent.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolved {
    pub url: String,
    pub file_name: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheInfo {
    /// Bytes actually on disk (the files are sparse while a download runs).
    pub bytes: u64,
    pub torrents: usize,
    pub dir: String,
}

/// Bandwidth choices: applied when the engine starts and again on every change.
#[derive(Debug, Clone, Copy)]
pub struct EngineOptions {
    /// Upload to other peers while downloading (what keeps torrents alive).
    pub share: bool,
    /// Upload cap in KB/s; 0 = none.
    pub upload_kbps: u32,
    /// Download cap in KB/s; 0 = none.
    pub download_kbps: u32,
}

impl Default for EngineOptions {
    fn default() -> Self {
        Self { share: true, upload_kbps: 512, download_kbps: 0 }
    }
}

impl From<&crate::settings::TorrentPrefs> for EngineOptions {
    fn from(prefs: &crate::settings::TorrentPrefs) -> Self {
        Self { share: prefs.share, upload_kbps: prefs.upload_kbps, download_kbps: prefs.download_kbps }
    }
}

impl EngineOptions {
    /// (upload, download) caps in bytes per second, `None` for no cap. Sharing off at
    /// runtime becomes a one-byte cap, as good as none.
    fn caps(self) -> (Option<NonZeroU32>, Option<NonZeroU32>) {
        let cap = |kbps: u32| NonZeroU32::new(kbps.saturating_mul(1024));
        let up = if self.share { cap(self.upload_kbps) } else { NonZeroU32::new(1) };
        (up, cap(self.download_kbps))
    }
}

pub fn cache_dir(app: &tauri::AppHandle) -> PathBuf {
    crate::iptv::data_dir(app).join("torrents")
}

impl TorrentEngine {
    pub fn new() -> Self {
        Self {
            session: tokio::sync::Mutex::new(None),
            server: tokio::sync::Mutex::new(None),
            active: Mutex::new(HashMap::new()),
            touched: Mutex::new(Instant::now()),
        }
    }

    /// Adds (or wakes) the torrent, waits for its file list, picks the video and hands
    /// back the local URL that streams it.
    pub async fn resolve(
        self: &Arc<Self>,
        dir: &Path,
        info_hash: &str,
        file_idx: Option<usize>,
        sources: &[String],
        cache_limit: u64,
        opts: EngineOptions,
    ) -> Result<Resolved, String> {
        let hash = info_hash.trim().to_ascii_lowercase();
        if hash.len() != 40 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Torrent no válido".into());
        }
        *self.touched.lock().unwrap() = Instant::now();
        let session = self.session(dir, opts).await?;
        apply_caps(&session, opts);
        self.evict(&session, dir, cache_limit, &hash).await;
        let folder = dir.join(&hash);
        std::fs::create_dir_all(&folder).map_err(|e| format!("No se pudo crear la caché de torrents: {e}"))?;

        let existing = {
            let map = self.active.lock().unwrap();
            map.get(&hash).map(|a| (a.handle.clone(), a.paused))
        };
        let handle = match existing {
            Some((handle, paused)) => {
                if paused {
                    session.unpause(&handle).await.map_err(|e| e.to_string())?;
                }
                handle
            }
            None => {
                let magnet = magnet_link(&hash, sources);
                let options = AddTorrentOptions {
                    output_folder: Some(folder.to_string_lossy().into_owned()),
                    // Pieces already in the cache folder are checked and kept.
                    overwrite: true,
                    ..Default::default()
                };
                // Adding a magnet fetches its metadata from peers first: on a dead
                // torrent that would wait forever.
                let added = tokio::time::timeout(METADATA_TIMEOUT, session.add_torrent(AddTorrent::from_url(magnet), Some(options)))
                    .await
                    .map_err(|_| "Nadie comparte este torrent ahora mismo (sin fuentes)".to_string())?
                    .map_err(|e| format!("No se pudo abrir el torrent: {e}"))?;
                match added {
                    AddTorrentResponse::Added(_, handle) | AddTorrentResponse::AlreadyManaged(_, handle) => handle,
                    AddTorrentResponse::ListOnly(_) => return Err("No se pudo abrir el torrent".into()),
                }
            }
        };
        {
            let mut map = self.active.lock().unwrap();
            let entry = map.entry(hash.clone()).or_insert_with(|| Active {
                handle: handle.clone(),
                last_used: Instant::now(),
                readers: 0,
                paused: false,
            });
            entry.last_used = Instant::now();
            entry.paused = false;
        }
        touch(&folder);

        tokio::time::timeout(METADATA_TIMEOUT, handle.wait_until_initialized())
            .await
            .map_err(|_| "Nadie comparte este torrent ahora mismo (sin fuentes)".to_string())?
            .map_err(|e| format!("No se pudo leer el torrent: {e}"))?;
        let files: Vec<(String, u64)> = handle
            .with_metadata(|m| {
                m.file_infos
                    .iter()
                    .map(|f| (f.relative_filename.to_string_lossy().into_owned(), f.len))
                    .collect()
            })
            .map_err(|e| e.to_string())?;
        let idx = pick_file(&files, file_idx).ok_or_else(|| "El torrent no contiene ningún vídeo".to_string())?;
        session
            .update_only_files(&handle, &HashSet::from([idx]))
            .await
            .map_err(|e| e.to_string())?;

        let port = self.server().await?;
        let name = Path::new(&files[idx].0)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "video".into());
        Ok(Resolved {
            url: format!("http://127.0.0.1:{port}/t/{hash}/{idx}/{}", enc(&name)),
            file_name: name,
            size: files[idx].1,
        })
    }

    pub fn cache_info(&self, dir: &Path) -> CacheInfo {
        let entries = scan(dir);
        CacheInfo {
            bytes: entries.iter().map(|e| e.bytes).sum(),
            torrents: entries.len(),
            dir: dir.display().to_string(),
        }
    }

    /// Drops every cached torrent that is not being watched right now.
    pub async fn cache_clear(&self, dir: &Path) {
        let session = self.session.lock().await.clone();
        for entry in scan(dir) {
            self.drop_torrent(session.as_ref(), &entry).await;
        }
    }

    /// New bandwidth caps for a running engine (nothing to do before it starts).
    pub async fn apply_limits(&self, opts: EngineOptions) {
        if let Some(session) = self.session.lock().await.as_ref() {
            apply_caps(session, opts);
        }
    }

    /// Live numbers of one torrent for the player's loading screen. `known` is false
    /// while its metadata is still being fetched (it is not in the engine yet).
    pub fn status(&self, info_hash: &str) -> TorrentStatus {
        let hash = info_hash.trim().to_ascii_lowercase();
        let handle = self.active.lock().unwrap().get(&hash).map(|a| a.handle.clone());
        let Some(handle) = handle else {
            return TorrentStatus::default();
        };
        // Read through the JSON form: stable across librqbit's internal type changes.
        let stats = serde_json::to_value(handle.stats()).unwrap_or_default();
        let num = |ptr: &str| stats.pointer(ptr).and_then(serde_json::Value::as_f64).unwrap_or(0.0);
        TorrentStatus {
            known: true,
            peers: num("/live/snapshot/peer_stats/live") as u64,
            down_mbps: num("/live/download_speed/mbps"),
            up_mbps: num("/live/upload_speed/mbps"),
            progress_bytes: num("/progress_bytes") as u64,
            total_bytes: num("/total_bytes") as u64,
        }
    }

    /// Pauses every torrent without an open reader, right now.
    pub async fn pause_idle(&self) {
        self.pause_idle_for(Duration::ZERO).await;
    }

    /// Pauses the torrents that have had no reader for at least `idle`.
    async fn pause_idle_for(&self, idle: Duration) {
        let session = self.session.lock().await.clone();
        let Some(session) = session else { return };
        let due: Vec<ManagedTorrentHandle> = {
            let mut map = self.active.lock().unwrap();
            map.values_mut()
                .filter(|a| a.readers == 0 && !a.paused && a.last_used.elapsed() >= idle)
                .map(|a| {
                    a.paused = true;
                    a.handle.clone()
                })
                .collect()
        };
        for handle in due {
            let _ = session.pause(&handle).await;
        }
        // Nothing asked of the engine for a good while: let the whole thing go.
        let quiet = self.touched.lock().unwrap().elapsed() >= ENGINE_IDLE && {
            let map = self.active.lock().unwrap();
            map.values().all(|a| a.readers == 0 && a.last_used.elapsed() >= ENGINE_IDLE)
        };
        if quiet && idle > Duration::ZERO {
            self.shutdown().await;
        }
    }

    /// Stops the session (torrents, DHT, listener); files stay in the cache and the
    /// next play starts a fresh one.
    async fn shutdown(&self) {
        let session = self.session.lock().await.take();
        self.active.lock().unwrap().clear();
        if let Some(session) = session {
            session.stop().await;
        }
    }

    async fn session(&self, dir: &Path, opts: EngineOptions) -> Result<Arc<Session>, String> {
        let mut guard = self.session.lock().await;
        if let Some(session) = guard.as_ref() {
            return Ok(session.clone());
        }
        std::fs::create_dir_all(dir).map_err(|e| format!("No se pudo crear la caché de torrents: {e}"))?;
        let (upload_bps, download_bps) = opts.caps();
        let session = Session::new_with_opts(
            dir.to_path_buf(),
            SessionOptions {
                listen: Some(ListenerOptions {
                    enable_upnp_port_forwarding: true,
                    ..Default::default()
                }),
                disable_upload: !opts.share,
                ratelimits: LimitsConfig { upload_bps, download_bps },
                peer_limit: Some(PEER_LIMIT),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| format!("No se pudo iniciar el motor de torrents: {e}"))?;
        *guard = Some(session.clone());
        Ok(session)
    }

    /// The local HTTP server (and the idle watcher), started on first use.
    async fn server(self: &Arc<Self>) -> Result<u16, String> {
        let mut guard = self.server.lock().await;
        if let Some(port) = *guard {
            return Ok(port);
        }
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|e| format!("No se pudo abrir el servidor local: {e}"))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let engine = self.clone();
        tauri::async_runtime::spawn(async move { engine.accept_loop(listener).await });
        let engine = self.clone();
        tauri::async_runtime::spawn(async move { engine.idle_loop().await });
        *guard = Some(port);
        Ok(port)
    }

    async fn accept_loop(self: Arc<Self>, listener: TcpListener) {
        loop {
            let Ok((socket, _)) = listener.accept().await else {
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            };
            let engine = self.clone();
            tauri::async_runtime::spawn(async move {
                let _ = engine.handle_conn(socket).await;
            });
        }
    }

    async fn idle_loop(self: Arc<Self>) {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            self.pause_idle_for(IDLE_PAUSE).await;
        }
    }

    /// One HTTP request from mpv: a byte range of one file of one torrent.
    async fn handle_conn(self: Arc<Self>, mut socket: TcpStream) -> std::io::Result<()> {
        let head = match tokio::time::timeout(Duration::from_secs(10), read_head(&mut socket)).await {
            Ok(Ok(head)) => head,
            _ => return Ok(()),
        };
        let Some(request) = parse_request(&head) else {
            return respond(&mut socket, 400, "Bad Request", &[]).await;
        };
        let Some((hash, idx)) = parse_path(&request.path) else {
            return respond(&mut socket, 404, "Not Found", &[]).await;
        };
        let handle = {
            let map = self.active.lock().unwrap();
            map.get(&hash).map(|a| a.handle.clone())
        };
        let Some(handle) = handle else {
            return respond(&mut socket, 404, "Not Found", &[]).await;
        };
        let Ok(mut file) = handle.clone().stream(idx).await else {
            return respond(&mut socket, 404, "Not Found", &[]).await;
        };
        let len = file.len();
        let range = match request.range.as_deref() {
            Some(spec) => match resolve_range(spec, len) {
                Some(range) => Some(range),
                None => {
                    return respond(&mut socket, 416, "Range Not Satisfiable", &[("Content-Range", format!("bytes */{len}"))]).await;
                }
            },
            None => None,
        };
        let (start, end) = range.unwrap_or((0, len.saturating_sub(1)));
        let body_len = if len == 0 { 0 } else { end - start + 1 };
        let mut headers = vec![
            ("Content-Type", content_type(&request.path).to_string()),
            ("Accept-Ranges", "bytes".to_string()),
            ("Content-Length", body_len.to_string()),
            ("Cache-Control", "no-store".to_string()),
        ];
        if range.is_some() {
            headers.push(("Content-Range", format!("bytes {start}-{end}/{len}")));
        }
        let (status, reason) = if range.is_some() { (206, "Partial Content") } else { (200, "OK") };
        write_head(&mut socket, status, reason, &headers).await?;
        if request.method == "HEAD" || body_len == 0 {
            return socket.shutdown().await;
        }

        let _reader = Reader::open(self.clone(), &hash);
        file.seek(SeekFrom::Start(start)).await?;
        let mut remaining = body_len;
        let mut buf = vec![0u8; READ_CHUNK];
        let mut since_touch: u64 = 0;
        while remaining > 0 {
            let want = buf.len().min(remaining as usize);
            // Blocks until the pieces behind these bytes have arrived.
            let read = match tokio::time::timeout(READ_TIMEOUT, file.read(&mut buf[..want])).await {
                Ok(Ok(0)) | Err(_) => break,
                Ok(Ok(n)) => n,
                Ok(Err(_)) => break,
            };
            socket.write_all(&buf[..read]).await?;
            remaining -= read as u64;
            since_touch += read as u64;
            if since_touch >= 8 * 1024 * 1024 {
                self.touch_active(&hash);
                since_touch = 0;
            }
        }
        socket.shutdown().await
    }

    fn touch_active(&self, hash: &str) {
        if let Some(active) = self.active.lock().unwrap().get_mut(hash) {
            active.last_used = Instant::now();
        }
    }

    /// Frees cache space, oldest-used first, until `limit` fits; `keep` and anything
    /// being watched stay.
    async fn evict(&self, session: &Arc<Session>, dir: &Path, limit: u64, keep: &str) {
        let mut entries = scan(dir);
        let mut total: u64 = entries.iter().map(|e| e.bytes).sum();
        if total <= limit {
            return;
        }
        entries.sort_by_key(|e| e.used);
        for entry in entries {
            if total <= limit {
                break;
            }
            if entry.hash == keep {
                continue;
            }
            if self.drop_torrent(Some(session), &entry).await {
                total = total.saturating_sub(entry.bytes);
            }
        }
    }

    /// Removes a cached torrent, stopping it first when the engine still holds it.
    /// Leaves one that is being watched alone.
    async fn drop_torrent(&self, session: Option<&Arc<Session>>, entry: &Cached) -> bool {
        let active = {
            let mut map = self.active.lock().unwrap();
            match map.get(&entry.hash) {
                Some(a) if a.readers > 0 => return false,
                Some(_) => map.remove(&entry.hash),
                None => None,
            }
        };
        if let (Some(active), Some(session)) = (active, session) {
            let _ = session.delete(active.handle.id().into(), true).await;
        }
        let _ = std::fs::remove_dir_all(&entry.path);
        true
    }
}

/// Counts an open response on its torrent for as long as it lives.
struct Reader {
    engine: Arc<TorrentEngine>,
    hash: String,
}

impl Reader {
    fn open(engine: Arc<TorrentEngine>, hash: &str) -> Self {
        engine.adjust(hash, 1);
        Self { engine, hash: hash.to_string() }
    }
}

impl Drop for Reader {
    fn drop(&mut self) {
        self.engine.adjust(&self.hash, -1);
    }
}

impl TorrentEngine {
    fn adjust(&self, hash: &str, delta: i64) {
        *self.touched.lock().unwrap() = Instant::now();
        if let Some(active) = self.active.lock().unwrap().get_mut(hash) {
            active.readers = (active.readers as i64 + delta).max(0) as usize;
            active.last_used = Instant::now();
        }
    }
}

// ---- torrent helpers ----

fn apply_caps(session: &Session, opts: EngineOptions) {
    let (upload_bps, download_bps) = opts.caps();
    session.ratelimits.set_upload_bps(upload_bps);
    session.ratelimits.set_download_bps(download_bps);
}

/// `magnet:?xt=urn:btih:<hash>` plus the addon's trackers and the public ones.
pub fn magnet_link(hash: &str, sources: &[String]) -> String {
    let mut link = format!("magnet:?xt=urn:btih:{hash}");
    let mut seen = HashSet::new();
    for tracker in sources.iter().map(String::as_str).chain(DEFAULT_TRACKERS.iter().copied()) {
        let tracker = tracker.strip_prefix("tracker:").unwrap_or(tracker).trim();
        let ok = ["udp://", "http://", "https://", "wss://"].iter().any(|p| tracker.starts_with(p));
        if ok && seen.insert(tracker.to_string()) {
            link.push_str("&tr=");
            link.push_str(&enc(tracker));
        }
    }
    link
}

/// The file to play: the index the addon named, else the largest video that is not a
/// sample, else the largest file.
fn pick_file(files: &[(String, u64)], wanted: Option<usize>) -> Option<usize> {
    if let Some(i) = wanted {
        if i < files.len() {
            return Some(i);
        }
    }
    let is_video = |name: &str| {
        Path::new(name)
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| VIDEO_EXT.contains(&e.to_ascii_lowercase().as_str()))
    };
    let largest = |pred: &dyn Fn(&str) -> bool| {
        files
            .iter()
            .enumerate()
            .filter(|(_, (name, _))| pred(name))
            .max_by_key(|(_, (_, len))| *len)
            .map(|(i, _)| i)
    };
    largest(&|n| is_video(n) && !n.to_ascii_lowercase().contains("sample"))
        .or_else(|| largest(&is_video))
        .or_else(|| largest(&|_| true))
}

fn enc(s: &str) -> String {
    crate::jellyfin::urlencoding_lite(s)
}

// ---- cache folder ----

struct Cached {
    hash: String,
    path: PathBuf,
    bytes: u64,
    /// Unix seconds of the last time it was played.
    used: u64,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn touch(folder: &Path) {
    let _ = std::fs::write(folder.join(".used"), now_secs().to_string());
}

fn scan(dir: &Path) -> Vec<Cached> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let hash = e.file_name().to_string_lossy().to_ascii_lowercase();
            if hash.len() != 40 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
                return None;
            }
            let path = e.path();
            let used = std::fs::read_to_string(path.join(".used"))
                .ok()
                .and_then(|s| s.trim().parse().ok())
                .or_else(|| {
                    e.metadata()
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                })
                .unwrap_or(0);
            Some(Cached { hash, bytes: dir_size(&path), path, used })
        })
        .collect()
}

fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|e| {
            let p = e.path();
            if p.is_dir() { dir_size(&p) } else { physical_size(&p) }
        })
        .sum()
}

/// Bytes a file really takes: a torrent's files are sparse until they fill up.
#[cfg(windows)]
fn physical_size(path: &Path) -> u64 {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCompressedFileSizeW(name: *const u16, high: *mut u32) -> u32;
        fn GetLastError() -> u32;
    }
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut high: u32 = 0;
    // SAFETY: a NUL-terminated UTF-16 path and a valid out-pointer, as the API wants.
    let low = unsafe { GetCompressedFileSizeW(wide.as_ptr(), &mut high) };
    if low == u32::MAX && unsafe { GetLastError() } != 0 {
        return std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    }
    (u64::from(high) << 32) | u64::from(low)
}

#[cfg(not(windows))]
fn physical_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

// ---- the tiny HTTP side ----

struct Request {
    method: String,
    path: String,
    range: Option<String>,
}

async fn read_head(socket: &mut TcpStream) -> std::io::Result<String> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        let n = socket.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() > MAX_REQUEST_BYTES {
            break;
        }
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

fn parse_request(head: &str) -> Option<Request> {
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split_whitespace();
    let method = first.next()?.to_ascii_uppercase();
    let path = first.next()?.to_string();
    let mut range = None;
    for line in lines {
        if let Some((key, value)) = line.split_once(':') {
            if key.trim().eq_ignore_ascii_case("range") {
                range = Some(value.trim().to_string());
            }
        }
    }
    Some(Request { method, path, range })
}

/// `/t/<hash>/<file index>/<name>` -> (hash, index).
fn parse_path(path: &str) -> Option<(String, usize)> {
    let path = path.split('?').next().unwrap_or(path);
    let mut parts = path.trim_start_matches('/').split('/');
    if parts.next()? != "t" {
        return None;
    }
    let hash = parts.next()?.to_ascii_lowercase();
    let idx: usize = parts.next()?.parse().ok()?;
    (hash.len() == 40 && hash.bytes().all(|b| b.is_ascii_hexdigit())).then_some((hash, idx))
}

/// `bytes=a-b`, `bytes=a-` or `bytes=-n` as an inclusive (start, end) inside `len`.
fn resolve_range(spec: &str, len: u64) -> Option<(u64, u64)> {
    let spec = spec.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    let last = len.checked_sub(1)?;
    if a.is_empty() {
        let suffix: u64 = b.parse().ok()?;
        if suffix == 0 {
            return None;
        }
        return Some((len.saturating_sub(suffix), last));
    }
    let start: u64 = a.parse().ok()?;
    if start > last {
        return None;
    }
    let end = if b.is_empty() { last } else { b.parse::<u64>().ok()?.min(last) };
    (start <= end).then_some((start, end))
}

fn content_type(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or_default().to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "ts" | "m2ts" => "video/mp2t",
        "mov" => "video/quicktime",
        "wmv" => "video/x-ms-wmv",
        "flv" => "video/x-flv",
        "mpg" | "mpeg" => "video/mpeg",
        _ => "application/octet-stream",
    }
}

async fn write_head(socket: &mut TcpStream, status: u16, reason: &str, headers: &[(&str, String)]) -> std::io::Result<()> {
    let mut head = format!("HTTP/1.1 {status} {reason}\r\n");
    for (key, value) in headers {
        head.push_str(key);
        head.push_str(": ");
        head.push_str(value);
        head.push_str("\r\n");
    }
    head.push_str("Connection: close\r\n\r\n");
    socket.write_all(head.as_bytes()).await
}

async fn respond(socket: &mut TcpStream, status: u16, reason: &str, headers: &[(&str, String)]) -> std::io::Result<()> {
    let mut all: Vec<(&str, String)> = headers.to_vec();
    all.push(("Content-Length", "0".to_string()));
    write_head(socket, status, reason, &all).await?;
    socket.shutdown().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges() {
        assert_eq!(resolve_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(resolve_range("bytes=500-", 1000), Some((500, 999)));
        assert_eq!(resolve_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(resolve_range("bytes=0-5000", 1000), Some((0, 999)));
        assert_eq!(resolve_range("bytes=1000-", 1000), None);
        assert_eq!(resolve_range("bytes=0-", 0), None);
        assert_eq!(resolve_range("items=0-1", 1000), None);
    }

    #[test]
    fn paths_and_requests() {
        assert_eq!(parse_path("/t/814978f980297cc7cd42be9d60b37b928a5e7cdc/5/Film.mkv"), Some(("814978f980297cc7cd42be9d60b37b928a5e7cdc".into(), 5)));
        assert_eq!(parse_path("/t/short/5/x"), None);
        assert_eq!(parse_path("/x/814978f980297cc7cd42be9d60b37b928a5e7cdc/5"), None);
        let req = parse_request("GET /t/a/1/f.mkv HTTP/1.1\r\nHost: x\r\nRange: bytes=10-\r\n\r\n").unwrap();
        assert_eq!((req.method.as_str(), req.path.as_str(), req.range.as_deref()), ("GET", "/t/a/1/f.mkv", Some("bytes=10-")));
        assert_eq!(content_type("/t/a/1/Film.MKV"), "video/x-matroska");
        assert_eq!(content_type("/t/a/1/file"), "application/octet-stream");
    }

    /// No network: a torrent made from a local file, already complete in the cache
    /// folder, served through the engine's HTTP side with every kind of request mpv
    /// makes (whole file, ranges, a suffix range, HEAD, a bad range, a bad path).
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn serves_a_local_torrent() {
        use librqbit::spawn_utils::BlockingSpawner;
        use librqbit::{create_torrent, CreateTorrentOptions};

        let root = std::env::temp_dir().join(format!("ejflix-torrent-local-{}", std::process::id()));
        let cache = root.join("cache");
        let src = root.join("src");
        std::fs::create_dir_all(&src).unwrap();
        let data: Vec<u8> = (0..3 * 1024 * 1024u32).map(|i| (i % 251) as u8).collect();
        std::fs::write(src.join("Film.mp4"), &data).unwrap();
        let spawner = BlockingSpawner::new(2);
        let created = create_torrent(
            &src.join("Film.mp4"),
            CreateTorrentOptions { name: Some("Film.mp4"), trackers: vec![], piece_length: Some(65536) },
            &spawner,
        )
        .await
        .unwrap();
        let hash = created.info_hash().as_string();

        let engine = Arc::new(TorrentEngine::new());
        let session = Session::new_with_opts(
            cache.clone(),
            SessionOptions { dht: None, listen: None, disable_trackers: true, ..Default::default() },
        )
        .await
        .unwrap();
        *engine.session.lock().await = Some(session.clone());
        let folder = cache.join(&hash);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::copy(src.join("Film.mp4"), folder.join("Film.mp4")).unwrap();
        let options = AddTorrentOptions {
            output_folder: Some(folder.to_string_lossy().into_owned()),
            overwrite: true,
            ..Default::default()
        };
        let handle = session
            .add_torrent(AddTorrent::from_bytes(created.as_bytes().unwrap()), Some(options))
            .await
            .unwrap()
            .into_handle()
            .unwrap();
        handle.wait_until_initialized().await.unwrap();
        engine.active.lock().unwrap().insert(
            hash.clone(),
            Active { handle: handle.clone(), last_used: Instant::now(), readers: 0, paused: false },
        );
        let port = engine.server().await.unwrap();
        let url = format!("http://127.0.0.1:{port}/t/{hash}/0/Film.mp4");
        let client = reqwest::Client::new();

        let res = client.get(&url).send().await.unwrap();
        assert_eq!(res.status().as_u16(), 200);
        assert_eq!(res.headers().get("content-type").unwrap(), "video/mp4");
        assert_eq!(res.headers().get("accept-ranges").unwrap(), "bytes");
        assert_eq!(res.bytes().await.unwrap().as_ref(), &data[..]);

        let res = client.get(&url).header("Range", "bytes=1000-1999").send().await.unwrap();
        assert_eq!(res.status().as_u16(), 206);
        assert_eq!(res.headers().get("content-range").unwrap(), "bytes 1000-1999/3145728");
        assert_eq!(res.bytes().await.unwrap().as_ref(), &data[1000..2000]);

        let res = client.get(&url).header("Range", "bytes=3145000-").send().await.unwrap();
        assert_eq!(res.status().as_u16(), 206);
        assert_eq!(res.bytes().await.unwrap().as_ref(), &data[3145000..]);

        let res = client.get(&url).header("Range", "bytes=-100").send().await.unwrap();
        assert_eq!(res.status().as_u16(), 206);
        assert_eq!(res.bytes().await.unwrap().as_ref(), &data[data.len() - 100..]);

        let res = client.head(&url).send().await.unwrap();
        assert_eq!(res.status().as_u16(), 200);
        assert_eq!(res.headers().get("content-length").unwrap(), "3145728");

        let res = client.get(&url).header("Range", "bytes=99999999-").send().await.unwrap();
        assert_eq!(res.status().as_u16(), 416);
        let res = client.get(format!("http://127.0.0.1:{port}/t/{hash}/7/x")).send().await.unwrap();
        assert_eq!(res.status().as_u16(), 404);
        let res = client.get(format!("http://127.0.0.1:{port}/nope")).send().await.unwrap();
        assert_eq!(res.status().as_u16(), 404);

        assert_eq!(engine.cache_info(&cache).torrents, 1);
        engine.cache_clear(&cache).await;
        assert_eq!(engine.cache_info(&cache).torrents, 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Real network: fetches the first bytes of Big Buck Bunny (a well seeded, free
    /// film) through the engine and the local server. `cargo test -- --ignored smoke`.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    #[ignore]
    async fn torrent_smoke() {
        let dir = std::env::temp_dir().join(format!("ejflix-torrent-smoke-{}", std::process::id()));
        let engine = Arc::new(TorrentEngine::new());
        let resolved = engine
            .resolve(&dir, "dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c", None, &[], 2 * 1024 * 1024 * 1024, EngineOptions { share: false, ..Default::default() })
            .await
            .expect("resolve");
        assert!(resolved.file_name.to_ascii_lowercase().ends_with(".mp4"), "{}", resolved.file_name);
        assert!(resolved.size > 100 * 1024 * 1024);
        let client = reqwest::Client::new();
        let res = client
            .get(&resolved.url)
            .header("Range", "bytes=0-524287")
            .timeout(Duration::from_secs(180))
            .send()
            .await
            .expect("request");
        assert_eq!(res.status().as_u16(), 206);
        assert_eq!(res.headers().get("content-type").unwrap(), "video/mp4");
        assert_eq!(res.headers().get("content-range").unwrap(), format!("bytes 0-524287/{}", resolved.size).as_str());
        let body = res.bytes().await.expect("body");
        assert_eq!(body.len(), 524_288);
        // An MP4 starts with an ftyp box a few bytes in.
        assert_eq!(&body[4..8], b"ftyp");
        // Seeking: a range from the middle of the file must come back too.
        let middle = resolved.size / 2;
        let res = client
            .get(&resolved.url)
            .header("Range", format!("bytes={middle}-{}", middle + 65535))
            .timeout(Duration::from_secs(180))
            .send()
            .await
            .expect("request");
        assert_eq!(res.status().as_u16(), 206);
        assert_eq!(res.bytes().await.expect("body").len(), 65_536);
        assert!(engine.cache_info(&dir).torrents == 1);
        engine.cache_clear(&dir).await;
        assert_eq!(engine.cache_info(&dir).torrents, 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Real network, diagnostic: prints DHT and peer stats while resolving two well
    /// known free torrents. `cargo test -- --ignored torrent_probe --nocapture`.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    #[ignore]
    async fn torrent_probe() {
        let dir = std::env::temp_dir().join(format!("ejflix-torrent-probe-{}", std::process::id()));
        let engine = Arc::new(TorrentEngine::new());
        let started = Instant::now();
        let session = engine.session(&dir, EngineOptions { share: false, ..Default::default() }).await.expect("session");
        println!("session up in {:?}; listen {:?}", started.elapsed(), session.listen_addr());
        for _ in 0..3 {
            tokio::time::sleep(Duration::from_secs(5)).await;
            let dht = session.get_dht().map(|d| serde_json::to_string(&d.stats()).unwrap_or_default());
            println!("{:?} dht: {}", started.elapsed(), dht.unwrap_or_else(|| "none".into()));
        }
        for hash in ["dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c", "08ada5a7a6183aae1e09d831df6748d566095a10"] {
            let magnet = magnet_link(hash, &[]);
            let added = tokio::time::timeout(Duration::from_secs(120), session.add_torrent(AddTorrent::from_url(magnet), Some(AddTorrentOptions { overwrite: true, ..Default::default() }))).await;
            match added {
                Ok(Ok(AddTorrentResponse::Added(_, handle) | AddTorrentResponse::AlreadyManaged(_, handle))) => {
                    println!("{hash}: metadata in {:?}, name {:?}", started.elapsed(), handle.name());
                    for _ in 0..4 {
                        tokio::time::sleep(Duration::from_secs(5)).await;
                        let stats = handle.stats();
                        println!("  progress {} / {} bytes, state {:?}, live {}", stats.progress_bytes, stats.total_bytes, stats.state, stats.live.map(|l| serde_json::to_string(&l.snapshot).unwrap_or_default()).unwrap_or_default());
                    }
                }
                Ok(Ok(AddTorrentResponse::ListOnly(_))) => println!("{hash}: list only"),
                Ok(Err(e)) => println!("{hash}: error {e:#}"),
                Err(_) => {
                    let dht = session.get_dht().map(|d| serde_json::to_string(&d.stats()).unwrap_or_default());
                    println!("{hash}: no metadata after 120 s; dht {}", dht.unwrap_or_else(|| "none".into()));
                }
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn magnet_and_file_choice() {
        let link = magnet_link("814978f980297cc7cd42be9d60b37b928a5e7cdc", &["tracker:udp://a:1/announce".into(), "dht:abc".into()]);
        assert!(link.starts_with("magnet:?xt=urn:btih:814978f980297cc7cd42be9d60b37b928a5e7cdc&tr=udp%3A%2F%2Fa%3A1%2Fannounce&tr="));
        assert!(!link.contains("dht"));
        let files = vec![("Sample/sample.mkv".to_string(), 50), ("Film/Film.mkv".to_string(), 900), ("Film/notes.nfo".to_string(), 5000)];
        assert_eq!(pick_file(&files, None), Some(1));
        assert_eq!(pick_file(&files, Some(2)), Some(2));
        assert_eq!(pick_file(&files, Some(9)), Some(1));
        assert_eq!(pick_file(&[("readme.txt".to_string(), 1)], None), Some(0));
        assert_eq!(pick_file(&[], None), None);
    }
}
