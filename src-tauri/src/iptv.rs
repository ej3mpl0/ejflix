//! IPTV: M3U/M3U8 playlists (by URL or file), Xtream Codes accounts and XMLTV guides.
//!
//! Sources live per profile in the store (`iptv.<userId>`, passwords DPAPI-sealed).
//! Playlists and guides are fetched from Rust, parsed here and cached under
//! `<data dir>/iptv/<sourceId>.json` so the TV tab opens instantly; a refresh downloads
//! everything again. Stream URLs never reach the webview: `iptv_play` resolves them.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, Manager};
use tauri_plugin_store::StoreExt;
use tokio::sync::RwLock;

pub const CHANGED_EVENT: &str = "iptv://changed";
pub const MAX_SOURCES: usize = 12;
const MAX_PLAYLIST_BYTES: usize = 64 * 1024 * 1024;
const MAX_EPG_BYTES: usize = 200 * 1024 * 1024;
const MAX_JSON_BYTES: usize = 48 * 1024 * 1024;
const MAX_CHANNELS: usize = 60_000;
const MAX_FAVORITES: usize = 500;
const MAX_RECENT: usize = 20;
/// Cached playlists older than this are refreshed on launch (when the preference is on).
pub const STALE_AFTER_MS: u64 = 12 * 3600 * 1000;
/// Programmes kept around "now": a few hours back, three days ahead.
const EPG_PAST: u64 = 6 * 3600;
const EPG_FUTURE: u64 = 3 * 86_400;
const MAX_DESC: usize = 400;
const HTTP_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceKind {
    #[default]
    M3uUrl,
    M3uFile,
    Xtream,
}

/// A configured IPTV source (stored per profile).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IptvSource {
    pub id: String,
    pub name: String,
    pub kind: SourceKind,
    /// Playlist URL (`m3uUrl`) or the Xtream server base (`http://host:port`).
    pub url: String,
    /// Local playlist path (`m3uFile`); with `imported` the file was copied into the cache
    /// and `path` only keeps the original file name.
    pub path: String,
    pub imported: bool,
    pub username: String,
    /// DPAPI-sealed hex; empty when there is no password.
    pub password: String,
    /// XMLTV guide URL (optional; Xtream accounts serve their own, M3U headers may name one).
    pub epg_url: String,
    /// "ts" | "m3u8": container Xtream serves live streams in.
    pub output: String,
    /// Custom User-Agent sent to the provider (playlist, guide and streams).
    pub user_agent: String,
    /// Xtream: also list the movie (VOD) catalog under its categories.
    pub include_vod: bool,
    pub enabled: bool,
    pub created_ms: u64,
}

impl Default for IptvSource {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            kind: SourceKind::M3uUrl,
            url: String::new(),
            path: String::new(),
            imported: false,
            username: String::new(),
            password: String::new(),
            epg_url: String::new(),
            output: "ts".into(),
            user_agent: String::new(),
            include_vod: false,
            enabled: true,
            created_ms: 0,
        }
    }
}

impl IptvSource {
    pub fn password_plain(&self) -> String {
        if self.password.is_empty() {
            return String::new();
        }
        crate::protect::from_hex(&self.password)
            .ok()
            .and_then(|sealed| crate::protect::unprotect(&sealed).ok())
            .and_then(|raw| String::from_utf8(raw).ok())
            .unwrap_or_default()
    }

    fn user_agent(&self) -> Option<&str> {
        let ua = self.user_agent.trim();
        (!ua.is_empty()).then_some(ua)
    }
}

/// What the frontend sends to create or edit a source.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IptvSourceInput {
    pub id: Option<String>,
    pub name: String,
    pub kind: SourceKind,
    pub url: String,
    pub path: String,
    pub username: String,
    /// New password; `None` or empty keeps the stored one.
    pub password: Option<String>,
    pub epg_url: String,
    pub output: String,
    pub user_agent: String,
    pub include_vod: bool,
    pub enabled: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct XtreamAccount {
    /// "Active", "Expired", "Banned", "Disabled"...
    pub status: String,
    pub expires_ms: Option<u64>,
    pub max_connections: Option<u32>,
    pub active_connections: Option<u32>,
    pub trial: bool,
}

/// Source as the frontend sees it: no password, plus the loaded state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IptvSourceView {
    pub id: String,
    pub name: String,
    pub kind: SourceKind,
    pub url: String,
    pub path: String,
    pub imported: bool,
    pub username: String,
    pub has_password: bool,
    pub epg_url: String,
    pub output: String,
    pub user_agent: String,
    pub include_vod: bool,
    pub enabled: bool,
    pub channel_count: usize,
    pub group_count: usize,
    /// Channels with a programme guide attached.
    pub epg_channels: usize,
    pub updated_ms: u64,
    pub loading: bool,
    pub error: Option<String>,
    pub epg_error: Option<String>,
    pub epg_source: Option<String>,
    pub account: Option<XtreamAccount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Channel {
    /// `<sourceId>:<stable key>` (the key survives playlist refreshes).
    pub id: String,
    pub source_id: String,
    pub name: String,
    pub logo: Option<String>,
    pub group: String,
    /// "live" | "movie"
    pub kind: String,
    pub number: Option<u32>,
    pub tvg_id: String,
    /// Direct URL (M3U entries). Xtream streams are built from `stream_id` when played.
    pub url: String,
    pub stream_id: String,
    /// Xtream VOD container ("mp4", "mkv"); empty for live streams.
    pub container: String,
    pub user_agent: Option<String>,
    pub referrer: Option<String>,
}

impl Default for Channel {
    fn default() -> Self {
        Self {
            id: String::new(),
            source_id: String::new(),
            name: String::new(),
            logo: None,
            group: String::new(),
            kind: "live".into(),
            number: None,
            tvg_id: String::new(),
            url: String::new(),
            stream_id: String::new(),
            container: String::new(),
            user_agent: None,
            referrer: None,
        }
    }
}

/// Channel as listed in the TV tab (no URLs).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelView {
    pub id: String,
    pub source_id: String,
    pub name: String,
    pub logo: Option<String>,
    pub group: String,
    pub kind: String,
    pub number: Option<u32>,
    pub tvg_id: String,
    pub favorite: bool,
    /// A programme guide is attached to this channel.
    pub epg: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Programme {
    /// Unix seconds.
    pub start: u64,
    pub stop: u64,
    pub title: String,
    pub desc: Option<String>,
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpgNow {
    pub now: Option<Programme>,
    pub next: Option<Programme>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupInfo {
    pub name: String,
    pub source_id: String,
    pub count: usize,
    /// "live" when every channel is live, "movie" when every entry is VOD, else "mixed".
    pub kind: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChannelQuery {
    pub source_id: Option<String>,
    pub group: Option<String>,
    pub search: Option<String>,
    pub favorites: bool,
    pub recent: bool,
    pub offset: usize,
    pub limit: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPage {
    pub items: Vec<ChannelView>,
    pub total: usize,
}

/// Parsed playlist plus guide of one source (memory and disk cache).
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Catalog {
    pub channels: Vec<Channel>,
    /// Programmes by XMLTV channel id, sorted by start.
    pub epg: HashMap<String, Vec<Programme>>,
    /// Our channel id → XMLTV channel id.
    pub channel_epg: HashMap<String, String>,
    pub updated_ms: u64,
    pub account: Option<XtreamAccount>,
    pub epg_source: Option<String>,
    pub epg_error: Option<String>,
    #[serde(skip)]
    index: HashMap<String, usize>,
}

impl Catalog {
    fn finish(mut self) -> Self {
        self.index = self
            .channels
            .iter()
            .enumerate()
            .map(|(i, c)| (c.id.clone(), i))
            .collect();
        self
    }

    fn get(&self, id: &str) -> Option<&Channel> {
        self.index.get(id).map(|&i| &self.channels[i])
    }

    fn programmes(&self, channel_id: &str) -> Option<&Vec<Programme>> {
        self.channel_epg.get(channel_id).and_then(|epg_id| self.epg.get(epg_id))
    }
}

#[derive(Clone, Default)]
struct Entry {
    catalog: Option<Arc<Catalog>>,
    loading: bool,
    error: Option<String>,
}

pub struct IptvState {
    http: reqwest::Client,
    entries: RwLock<HashMap<String, Entry>>,
}

// ---- storage ----

fn sources_key(user_id: &str) -> String {
    format!("iptv.{user_id}")
}

fn favorites_key(user_id: &str) -> String {
    format!("iptvFavorites.{user_id}")
}

fn recent_key(user_id: &str) -> String {
    format!("iptvRecent.{user_id}")
}

/// Folder with everything the app keeps outside the store (`EJFLIX_DATA_DIR` or the app
/// data dir, where `session.json` also lives).
pub fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    match std::env::var("EJFLIX_DATA_DIR") {
        Ok(dir) if !dir.trim().is_empty() => PathBuf::from(dir),
        _ => app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("ejflix")),
    }
}

fn cache_dir(app: &tauri::AppHandle) -> PathBuf {
    data_dir(app).join("iptv")
}

fn cache_file(app: &tauri::AppHandle, source_id: &str) -> PathBuf {
    cache_dir(app).join(format!("{source_id}.json"))
}

fn imported_file(app: &tauri::AppHandle, source_id: &str) -> PathBuf {
    cache_dir(app).join(format!("{source_id}.m3u"))
}

pub fn list_sources(app: &tauri::AppHandle, user_id: &str) -> Vec<IptvSource> {
    let Ok(store) = app.store(crate::store_path()) else {
        return vec![];
    };
    store
        .get(sources_key(user_id))
        .and_then(|v| serde_json::from_value::<Vec<IptvSource>>(v).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|s| valid_source_id(&s.id))
        .collect()
}

fn save_sources(app: &tauri::AppHandle, user_id: &str, list: &[IptvSource]) -> Result<(), String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.set(
        sources_key(user_id),
        serde_json::to_value(list).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())
}

fn load_ids(app: &tauri::AppHandle, key: &str) -> Vec<String> {
    let Ok(store) = app.store(crate::store_path()) else {
        return vec![];
    };
    store
        .get(key)
        .and_then(|v| serde_json::from_value::<Vec<String>>(v).ok())
        .unwrap_or_default()
}

fn save_ids(app: &tauri::AppHandle, key: &str, ids: &[String]) -> Result<(), String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.set(key, serde_json::to_value(ids).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())
}

pub fn favorites(app: &tauri::AppHandle, user_id: &str) -> Vec<String> {
    load_ids(app, &favorites_key(user_id))
}

pub fn set_favorite(app: &tauri::AppHandle, user_id: &str, channel_id: &str, on: bool) -> Result<Vec<String>, String> {
    let mut list = favorites(app, user_id);
    list.retain(|id| id != channel_id);
    if on {
        list.insert(0, channel_id.to_string());
    }
    list.truncate(MAX_FAVORITES);
    save_ids(app, &favorites_key(user_id), &list)?;
    Ok(list)
}

pub fn recent(app: &tauri::AppHandle, user_id: &str) -> Vec<String> {
    load_ids(app, &recent_key(user_id))
}

pub fn push_recent(app: &tauri::AppHandle, user_id: &str, channel_id: &str) -> Result<(), String> {
    let mut list = recent(app, user_id);
    list.retain(|id| id != channel_id);
    list.insert(0, channel_id.to_string());
    list.truncate(MAX_RECENT);
    save_ids(app, &recent_key(user_id), &list)
}

/// A source as the ejFlix account stores it (`m3uFile` sources never leave the PC).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SyncedSource {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: SourceKind,
    pub name: String,
    pub url: String,
    pub username: String,
    /// Plain text; empty keeps whatever this PC already has.
    pub password: String,
    pub epg_url: String,
    pub output: String,
    pub user_agent: String,
    pub include_vod: bool,
    pub enabled: bool,
    pub created_ms: u64,
}

impl Default for SyncedSource {
    fn default() -> Self {
        Self {
            id: String::new(),
            kind: SourceKind::M3uUrl,
            name: String::new(),
            url: String::new(),
            username: String::new(),
            password: String::new(),
            epg_url: String::new(),
            output: "ts".into(),
            user_agent: String::new(),
            include_vod: false,
            enabled: true,
            created_ms: 0,
        }
    }
}

/// Makes the profile's URL and Xtream sources match the account, keeping local file
/// playlists as they are. Returns true when anything changed.
pub fn apply_synced(app: &tauri::AppHandle, user_id: &str, items: Vec<SyncedSource>) -> Result<bool, String> {
    let before = list_sources(app, user_id);
    let mut list: Vec<IptvSource> = before
        .iter()
        .filter(|s| matches!(s.kind, SourceKind::M3uFile))
        .cloned()
        .collect();
    for item in items {
        if matches!(item.kind, SourceKind::M3uFile) || !valid_source_id(&item.id) {
            continue;
        }
        if list.iter().any(|s| s.id == item.id) {
            // A local file playlist already uses that id.
            continue;
        }
        if list.len() >= MAX_SOURCES {
            break;
        }
        // The website only checks that a URL looks like http(s): read it the way a
        // typed one is, so a get.php link becomes a server base plus its credentials.
        let (url, url_user, url_pass) = match item.kind {
            SourceKind::Xtream => match parse_xtream_url(&item.url) {
                Ok(parsed) => parsed,
                Err(_) => continue,
            },
            _ => match normalize_http_url(&item.url) {
                Ok(url) => (url, None, None),
                Err(_) => continue,
            },
        };
        let mut source = before.iter().find(|s| s.id == item.id).cloned().unwrap_or_else(|| IptvSource {
            id: item.id.clone(),
            created_ms: if item.created_ms > 0 { item.created_ms } else { crate::addons::now_ms() },
            ..IptvSource::default()
        });
        source.kind = item.kind;
        source.name = item.name.trim().chars().take(60).collect();
        source.url = url.chars().take(2000).collect();
        source.path = String::new();
        source.imported = false;
        let username: String = item.username.trim().chars().take(200).collect();
        source.username = if username.is_empty() { url_user.unwrap_or_default() } else { username };
        let password = if item.password.is_empty() { url_pass.unwrap_or_default() } else { item.password.clone() };
        if !password.is_empty() && password.len() <= 200 {
            let sealed = crate::protect::protect(password.as_bytes())?;
            source.password = crate::protect::to_hex(&sealed);
        }
        source.epg_url = match item.epg_url.trim() {
            "" => String::new(),
            epg => normalize_http_url(epg).unwrap_or_default().chars().take(2000).collect(),
        };
        source.output = if item.output == "m3u8" { "m3u8".into() } else { "ts".into() };
        source.user_agent = item.user_agent.trim().chars().take(200).collect();
        source.include_vod = item.include_vod;
        source.enabled = item.enabled;
        list.push(source);
    }
    list.sort_by_key(|s| s.created_ms);
    let mut sorted_before = before.clone();
    sorted_before.sort_by_key(|s| s.created_ms);
    let changed = serde_json::to_string(&sorted_before).ok() != serde_json::to_string(&list).ok();
    if !changed {
        return Ok(false);
    }
    for gone in before.iter().filter(|s| !list.iter().any(|k| k.id == s.id)) {
        let _ = std::fs::remove_file(cache_file(app, &gone.id));
    }
    save_sources(app, user_id, &list)?;
    Ok(true)
}

/// Replaces the favourite channels with the account's list.
pub fn set_favorites_list(app: &tauri::AppHandle, user_id: &str, ids: Vec<String>) -> Result<(), String> {
    let mut seen = std::collections::HashSet::new();
    let mut list: Vec<String> = ids.into_iter().filter(|id| seen.insert(id.clone())).collect();
    list.truncate(MAX_FAVORITES);
    save_ids(app, &favorites_key(user_id), &list)
}

/// Drops every IPTV record of a profile (its sources, favorites, recents and caches).
pub fn delete_profile_data(app: &tauri::AppHandle, user_id: &str) {
    for source in list_sources(app, user_id) {
        let _ = std::fs::remove_file(cache_file(app, &source.id));
        let _ = std::fs::remove_file(imported_file(app, &source.id));
    }
    if let Ok(store) = app.store(crate::store_path()) {
        store.delete(sources_key(user_id));
        store.delete(favorites_key(user_id));
        store.delete(recent_key(user_id));
        let _ = store.save();
    }
}

fn valid_source_id(id: &str) -> bool {
    (8..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Source id part of a channel id (`<sourceId>:<key>`).
pub fn source_of(channel_id: &str) -> Option<&str> {
    channel_id.split_once(':').map(|(s, _)| s).filter(|s| valid_source_id(s))
}

/// Validates the form and stores the source (new or edited). Returns the saved source.
pub fn save_source(app: &tauri::AppHandle, user_id: &str, input: IptvSourceInput) -> Result<IptvSource, String> {
    let mut list = list_sources(app, user_id);
    let existing = input
        .id
        .as_deref()
        .and_then(|id| list.iter().find(|s| s.id == id).cloned());
    if existing.is_none() && list.len() >= MAX_SOURCES {
        return Err(format!("Máximo {MAX_SOURCES} listas IPTV"));
    }
    let mut source = existing.clone().unwrap_or_else(|| IptvSource {
        id: uuid::Uuid::new_v4().to_string(),
        created_ms: crate::addons::now_ms(),
        ..IptvSource::default()
    });
    source.kind = input.kind;
    source.enabled = input.enabled;
    source.include_vod = input.include_vod;
    source.output = if input.output == "m3u8" { "m3u8".into() } else { "ts".into() };
    source.user_agent = input.user_agent.trim().chars().take(200).collect();
    source.epg_url = match input.epg_url.trim() {
        "" => String::new(),
        url => normalize_http_url(url)?,
    };
    source.username = input.username.trim().chars().take(200).collect();
    if let Some(password) = input.password.filter(|p| !p.is_empty()) {
        if password.len() > 200 {
            return Err("Contraseña demasiado larga".into());
        }
        let sealed = crate::protect::protect(password.as_bytes())?;
        source.password = crate::protect::to_hex(&sealed);
    }
    match input.kind {
        SourceKind::M3uUrl => {
            source.url = normalize_http_url(&input.url)?;
            source.path = String::new();
            source.imported = false;
        }
        SourceKind::M3uFile => {
            let path = input.path.trim();
            if path.is_empty() {
                if !source.imported || !imported_file(app, &source.id).exists() {
                    return Err("Elige un archivo M3U o escribe su ruta".into());
                }
            } else if !source.imported || source.path != path {
                if !std::path::Path::new(path).is_file() {
                    return Err("No se encuentra el archivo".into());
                }
                source.path = path.to_string();
                source.imported = false;
            }
            source.url = String::new();
        }
        SourceKind::Xtream => {
            let (base, user, pass) = parse_xtream_url(&input.url)?;
            source.url = base;
            if source.username.is_empty() {
                source.username = user.unwrap_or_default();
            }
            if source.password.is_empty() {
                if let Some(pass) = pass {
                    let sealed = crate::protect::protect(pass.as_bytes())?;
                    source.password = crate::protect::to_hex(&sealed);
                }
            }
            if source.username.is_empty() || source.password.is_empty() {
                return Err("Xtream Codes necesita usuario y contraseña".into());
            }
        }
    }
    let name: String = input.name.trim().chars().take(60).collect();
    source.name = if name.is_empty() { default_name(&source) } else { name };
    match list.iter_mut().find(|s| s.id == source.id) {
        Some(slot) => *slot = source.clone(),
        None => list.push(source.clone()),
    }
    save_sources(app, user_id, &list)?;
    Ok(source)
}

/// Stores the content of a playlist file picked in the UI and creates (or updates) the
/// `m3uFile` source that reads it.
pub fn import_playlist(
    app: &tauri::AppHandle,
    user_id: &str,
    id: Option<&str>,
    name: &str,
    file_name: &str,
    text: &str,
) -> Result<IptvSource, String> {
    if text.len() > MAX_PLAYLIST_BYTES {
        return Err("El archivo es demasiado grande".into());
    }
    if !text.trim_start().starts_with("#EXTM3U") && !text.contains("#EXTINF") {
        return Err("El archivo no parece una lista M3U".into());
    }
    let mut list = list_sources(app, user_id);
    let existing = id.and_then(|id| list.iter().find(|s| s.id == id).cloned());
    if existing.is_none() && list.len() >= MAX_SOURCES {
        return Err(format!("Máximo {MAX_SOURCES} listas IPTV"));
    }
    let mut source = existing.unwrap_or_else(|| IptvSource {
        id: uuid::Uuid::new_v4().to_string(),
        created_ms: crate::addons::now_ms(),
        ..IptvSource::default()
    });
    source.kind = SourceKind::M3uFile;
    source.url = String::new();
    source.imported = true;
    source.path = file_name.trim().chars().take(120).collect();
    let name: String = name.trim().chars().take(60).collect();
    if !name.is_empty() {
        source.name = name;
    } else if source.name.is_empty() {
        source.name = default_name(&source);
    }
    std::fs::create_dir_all(cache_dir(app)).map_err(|e| e.to_string())?;
    std::fs::write(imported_file(app, &source.id), text).map_err(|e| e.to_string())?;
    match list.iter_mut().find(|s| s.id == source.id) {
        Some(slot) => *slot = source.clone(),
        None => list.push(source.clone()),
    }
    save_sources(app, user_id, &list)?;
    Ok(source)
}

pub fn remove_source(app: &tauri::AppHandle, user_id: &str, id: &str) -> Result<(), String> {
    let mut list = list_sources(app, user_id);
    list.retain(|s| s.id != id);
    save_sources(app, user_id, &list)?;
    let _ = std::fs::remove_file(cache_file(app, id));
    let _ = std::fs::remove_file(imported_file(app, id));
    let prefix = format!("{id}:");
    let favs: Vec<String> = favorites(app, user_id).into_iter().filter(|c| !c.starts_with(&prefix)).collect();
    save_ids(app, &favorites_key(user_id), &favs)?;
    let rec: Vec<String> = recent(app, user_id).into_iter().filter(|c| !c.starts_with(&prefix)).collect();
    save_ids(app, &recent_key(user_id), &rec)
}

fn default_name(source: &IptvSource) -> String {
    match source.kind {
        SourceKind::M3uFile => {
            let file = std::path::Path::new(&source.path)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            if file.is_empty() { "Lista M3U".into() } else { file }
        }
        _ => host_of(&source.url).unwrap_or_else(|| "IPTV".into()),
    }
}

fn host_of(url: &str) -> Option<String> {
    let rest = url.split("://").nth(1)?;
    let host = rest.split(['/', '?', '#']).next()?;
    let host = host.split('@').last()?;
    let host = host.split(':').next()?;
    (!host.is_empty()).then(|| host.to_string())
}

pub fn normalize_http_url(raw: &str) -> Result<String, String> {
    let url = raw.trim();
    if url.is_empty() || url.len() > 4096 {
        return Err("URL no válida".into());
    }
    if url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("URL no válida".into());
    }
    let url = if url.contains("://") {
        url.to_string()
    } else {
        format!("http://{url}")
    };
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Solo se permiten URLs http o https".into());
    }
    Ok(url)
}

/// Accepts `http://host:port`, `host:port` or a full `get.php?username=…&password=…`
/// playlist link and returns the server base plus the credentials it carried.
pub fn parse_xtream_url(raw: &str) -> Result<(String, Option<String>, Option<String>), String> {
    let url = normalize_http_url(raw)?;
    let (scheme, rest) = url.split_once("://").ok_or("URL no válida")?;
    let (authority, tail) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    if authority.is_empty() {
        return Err("Falta el servidor".into());
    }
    let base = format!("{scheme}://{authority}");
    let query = tail.split_once('?').map(|(_, q)| q).unwrap_or("");
    let mut user = None;
    let mut pass = None;
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            match k {
                "username" => user = Some(percent_decode(v)),
                "password" => pass = Some(percent_decode(v)),
                _ => {}
            }
        }
    }
    Ok((base, user.filter(|s| !s.is_empty()), pass.filter(|s| !s.is_empty())))
}

pub(crate) fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                match u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    Ok(b) => {
                        out.push(b);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn enc(s: &str) -> String {
    crate::jellyfin::urlencoding_lite(s)
}

/// Stream URL and request headers for a channel (Xtream URLs carry the credentials, so
/// they are only ever built here).
pub fn stream_for(source: &IptvSource, channel: &Channel) -> Result<(String, Vec<(String, String)>), String> {
    let url = match source.kind {
        SourceKind::Xtream => {
            let password = source.password_plain();
            if channel.stream_id.is_empty() || password.is_empty() {
                return Err("Canal no disponible".into());
            }
            let (folder, ext) = if channel.kind == "movie" {
                ("movie", if channel.container.is_empty() { "mp4".to_string() } else { channel.container.clone() })
            } else {
                ("live", source.output.clone())
            };
            format!(
                "{}/{folder}/{}/{}/{}.{ext}",
                source.url,
                enc(&source.username),
                enc(&password),
                channel.stream_id
            )
        }
        _ => channel.url.clone(),
    };
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Solo se pueden reproducir canales http o https".into());
    }
    let mut headers = Vec::new();
    if let Some(ua) = channel.user_agent.as_deref().or(source.user_agent()) {
        headers.push(("User-Agent".to_string(), ua.to_string()));
    }
    if let Some(referrer) = &channel.referrer {
        headers.push(("Referer".to_string(), referrer.clone()));
    }
    Ok((url, headers))
}

// ---- state ----

impl IptvState {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .timeout(HTTP_TIMEOUT)
            .user_agent(format!("ejFlix/{}", env!("CARGO_PKG_VERSION")))
            .redirect(reqwest::redirect::Policy::limited(8))
            .build()
            .expect("http client");
        Self {
            http,
            entries: RwLock::new(HashMap::new()),
        }
    }

    async fn fetch(&self, url: &str, user_agent: Option<&str>, max: usize) -> Result<Vec<u8>, String> {
        let mut req = self.http.get(url);
        if let Some(ua) = user_agent {
            req = req.header("user-agent", ua);
        }
        let mut res = req
            .send()
            .await
            .map_err(|e| format!("No se pudo conectar: {}", short_error(&e)))?;
        if !res.status().is_success() {
            return Err(format!("El servidor respondió {}", res.status().as_u16()));
        }
        if res.content_length().unwrap_or(0) as usize > max {
            return Err("La respuesta es demasiado grande".into());
        }
        let mut out = Vec::new();
        while let Some(chunk) = res.chunk().await.map_err(|e| format!("Descarga interrumpida: {}", short_error(&e)))? {
            out.extend_from_slice(&chunk);
            if out.len() > max {
                return Err("La respuesta es demasiado grande".into());
            }
        }
        Ok(out)
    }

    async fn fetch_text(&self, url: &str, user_agent: Option<&str>, max: usize) -> Result<String, String> {
        let bytes = self.fetch(url, user_agent, max).await?;
        let bytes = if crate::inflate::is_gzip(&bytes) {
            crate::inflate::gunzip(&bytes, max)?
        } else {
            bytes
        };
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    async fn xtream_json(&self, source: &IptvSource, action: Option<&str>) -> Result<Value, String> {
        let mut url = format!(
            "{}/player_api.php?username={}&password={}",
            source.url,
            enc(&source.username),
            enc(&source.password_plain())
        );
        if let Some(action) = action {
            url.push_str("&action=");
            url.push_str(action);
        }
        let bytes = self.fetch(&url, source.user_agent(), MAX_JSON_BYTES).await?;
        serde_json::from_slice(&bytes).map_err(|_| "El servidor no respondió como Xtream Codes".to_string())
    }

    /// Signs in to an Xtream account and describes it (used by "Check" in Settings).
    pub async fn xtream_check(&self, source: &IptvSource) -> Result<XtreamAccount, String> {
        let value = self.xtream_json(source, None).await?;
        parse_account(&value)
    }

    /// Puts every enabled source in memory (from its disk cache) and refreshes the ones
    /// that are missing or stale in the background.
    pub async fn ensure(self: &Arc<Self>, app: &tauri::AppHandle, sources: &[IptvSource], auto_refresh: bool, epg: bool) {
        let now = crate::addons::now_ms();
        for source in sources.iter().filter(|s| s.enabled) {
            let entry = self.entries.read().await.get(&source.id).cloned().unwrap_or_default();
            if entry.loading {
                continue;
            }
            let mut catalog = entry.catalog.clone();
            if catalog.is_none() {
                if let Some(cached) = read_cache(app, &source.id) {
                    let cached = Arc::new(cached);
                    self.entries
                        .write()
                        .await
                        .entry(source.id.clone())
                        .or_default()
                        .catalog = Some(cached.clone());
                    catalog = Some(cached);
                }
            }
            let stale = catalog
                .as_ref()
                .map(|c| now.saturating_sub(c.updated_ms) > STALE_AFTER_MS)
                .unwrap_or(true);
            if catalog.is_none() || (stale && auto_refresh) {
                self.spawn_refresh(app, source.clone(), epg).await;
            }
        }
    }

    pub async fn spawn_refresh(self: &Arc<Self>, app: &tauri::AppHandle, source: IptvSource, epg: bool) {
        {
            let mut entries = self.entries.write().await;
            let entry = entries.entry(source.id.clone()).or_default();
            if entry.loading {
                return;
            }
            entry.loading = true;
            entry.error = None;
        }
        let _ = app.emit(CHANGED_EVENT, ());
        let state = self.clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let result = state.build(&app, &source, epg).await;
            {
                let mut entries = state.entries.write().await;
                let entry = entries.entry(source.id.clone()).or_default();
                entry.loading = false;
                match result {
                    Ok(catalog) => {
                        write_cache(&app, &source.id, &catalog);
                        entry.catalog = Some(Arc::new(catalog));
                        entry.error = None;
                    }
                    Err(err) => entry.error = Some(err),
                }
            }
            let _ = app.emit(CHANGED_EVENT, ());
        });
    }

    async fn build(&self, app: &tauri::AppHandle, source: &IptvSource, epg: bool) -> Result<Catalog, String> {
        let mut catalog = Catalog::default();
        let mut header_epg: Option<String> = None;
        match source.kind {
            SourceKind::M3uUrl => {
                let text = self.fetch_text(&source.url, source.user_agent(), MAX_PLAYLIST_BYTES).await?;
                let parsed = parse_m3u(&text, &source.id);
                catalog.channels = parsed.channels;
                header_epg = parsed.epg_url;
            }
            SourceKind::M3uFile => {
                let path = if source.imported || source.path.is_empty() {
                    imported_file(app, &source.id)
                } else {
                    PathBuf::from(&source.path)
                };
                let bytes = std::fs::read(&path).map_err(|_| "No se pudo leer el archivo M3U".to_string())?;
                if bytes.len() > MAX_PLAYLIST_BYTES {
                    return Err("El archivo es demasiado grande".into());
                }
                let text = String::from_utf8_lossy(&bytes);
                let parsed = parse_m3u(&text, &source.id);
                catalog.channels = parsed.channels;
                header_epg = parsed.epg_url;
            }
            SourceKind::Xtream => {
                let auth = self.xtream_json(source, None).await?;
                catalog.account = Some(parse_account(&auth)?);
                let categories = self.xtream_json(source, Some("get_live_categories")).await.unwrap_or(Value::Null);
                let streams = self.xtream_json(source, Some("get_live_streams")).await?;
                catalog.channels = xtream_channels(&source.id, &categories, &streams, "live");
                if source.include_vod {
                    let vod_categories = self.xtream_json(source, Some("get_vod_categories")).await.unwrap_or(Value::Null);
                    if let Ok(vod) = self.xtream_json(source, Some("get_vod_streams")).await {
                        let mut movies = xtream_channels(&source.id, &vod_categories, &vod, "movie");
                        catalog.channels.append(&mut movies);
                    }
                }
            }
        }
        if catalog.channels.is_empty() {
            return Err("La lista no contiene canales".into());
        }
        catalog.channels.truncate(MAX_CHANNELS);
        if epg {
            let epg_url = if !source.epg_url.is_empty() {
                Some(source.epg_url.clone())
            } else if source.kind == SourceKind::Xtream {
                Some(format!(
                    "{}/xmltv.php?username={}&password={}",
                    source.url,
                    enc(&source.username),
                    enc(&source.password_plain())
                ))
            } else {
                header_epg.clone()
            };
            if let Some(url) = epg_url {
                catalog.epg_source = Some(if source.kind == SourceKind::Xtream && source.epg_url.is_empty() {
                    "xtream".to_string()
                } else {
                    url.clone()
                });
                match self.fetch_text(&url, source.user_agent(), MAX_EPG_BYTES).await {
                    Ok(text) => {
                        let now = crate::addons::now_ms() / 1000;
                        attach_guide(&mut catalog, &text, now);
                    }
                    Err(err) => catalog.epg_error = Some(err),
                }
            }
        }
        catalog.updated_ms = crate::addons::now_ms();
        Ok(catalog.finish())
    }

    pub async fn forget(&self, app: &tauri::AppHandle, source_id: &str) {
        self.entries.write().await.remove(source_id);
        let _ = std::fs::remove_file(cache_file(app, source_id));
    }

    pub async fn clear(&self) {
        self.entries.write().await.clear();
    }

    pub async fn views(&self, sources: &[IptvSource]) -> Vec<IptvSourceView> {
        let entries = self.entries.read().await;
        sources
            .iter()
            .map(|source| {
                let entry = entries.get(&source.id).cloned().unwrap_or_default();
                let catalog = entry.catalog.as_deref();
                let groups: HashSet<&str> = catalog
                    .map(|c| c.channels.iter().map(|ch| ch.group.as_str()).collect())
                    .unwrap_or_default();
                IptvSourceView {
                    id: source.id.clone(),
                    name: source.name.clone(),
                    kind: source.kind,
                    url: source.url.clone(),
                    path: source.path.clone(),
                    imported: source.imported,
                    username: source.username.clone(),
                    has_password: !source.password.is_empty(),
                    epg_url: source.epg_url.clone(),
                    output: source.output.clone(),
                    user_agent: source.user_agent.clone(),
                    include_vod: source.include_vod,
                    enabled: source.enabled,
                    channel_count: catalog.map(|c| c.channels.len()).unwrap_or(0),
                    group_count: groups.len(),
                    epg_channels: catalog.map(|c| c.channel_epg.len()).unwrap_or(0),
                    updated_ms: catalog.map(|c| c.updated_ms).unwrap_or(0),
                    loading: entry.loading,
                    error: entry.error.clone(),
                    epg_error: catalog.and_then(|c| c.epg_error.clone()),
                    epg_source: catalog.and_then(|c| c.epg_source.clone()),
                    account: catalog.and_then(|c| c.account.clone()),
                }
            })
            .collect()
    }

    pub async fn is_loading(&self) -> bool {
        self.entries.read().await.values().any(|e| e.loading)
    }

    pub async fn groups(&self, sources: &[IptvSource], source_id: Option<&str>) -> Vec<GroupInfo> {
        let entries = self.entries.read().await;
        let mut out: Vec<GroupInfo> = Vec::new();
        let mut index: HashMap<(String, String), usize> = HashMap::new();
        for source in sources.iter().filter(|s| s.enabled && source_id.map(|id| id == s.id).unwrap_or(true)) {
            let Some(catalog) = entries.get(&source.id).and_then(|e| e.catalog.clone()) else {
                continue;
            };
            for channel in &catalog.channels {
                let key = (source.id.clone(), channel.group.clone());
                match index.get(&key) {
                    Some(&i) => {
                        out[i].count += 1;
                        if out[i].kind != channel.kind {
                            out[i].kind = "mixed".into();
                        }
                    }
                    None => {
                        index.insert(key, out.len());
                        out.push(GroupInfo {
                            name: channel.group.clone(),
                            source_id: source.id.clone(),
                            count: 1,
                            kind: channel.kind.clone(),
                        });
                    }
                }
            }
        }
        out
    }

    pub async fn channels(
        &self,
        sources: &[IptvSource],
        query: &ChannelQuery,
        favorites: &[String],
        recent: &[String],
    ) -> ChannelPage {
        let entries = self.entries.read().await;
        let fav: HashSet<&str> = favorites.iter().map(|s| s.as_str()).collect();
        let search = query
            .search
            .as_deref()
            .map(normalize)
            .filter(|s| !s.is_empty());
        let number = query.search.as_deref().and_then(|s| s.trim().parse::<u32>().ok());
        let enabled: HashMap<&str, &IptvSource> = sources.iter().filter(|s| s.enabled).map(|s| (s.id.as_str(), s)).collect();
        let matches = |channel: &Channel| -> bool {
            match &search {
                Some(needle) => normalize(&channel.name).contains(needle.as_str()) || number.is_some_and(|n| channel.number == Some(n)),
                None => true,
            }
        };
        let view = |channel: &Channel, catalog: &Catalog| ChannelView {
            id: channel.id.clone(),
            source_id: channel.source_id.clone(),
            name: channel.name.clone(),
            logo: channel.logo.clone(),
            group: channel.group.clone(),
            kind: channel.kind.clone(),
            number: channel.number,
            tvg_id: channel.tvg_id.clone(),
            favorite: fav.contains(channel.id.as_str()),
            epg: catalog.channel_epg.contains_key(&channel.id),
        };
        let mut items: Vec<ChannelView> = Vec::new();
        if query.favorites || query.recent {
            let ids = if query.favorites { favorites } else { recent };
            for id in ids {
                let Some(source_id) = source_of(id) else { continue };
                if !enabled.contains_key(source_id) || query.source_id.as_deref().is_some_and(|s| s != source_id) {
                    continue;
                }
                let Some(catalog) = entries.get(source_id).and_then(|e| e.catalog.clone()) else {
                    continue;
                };
                if let Some(channel) = catalog.get(id) {
                    if matches(channel) {
                        items.push(view(channel, &catalog));
                    }
                }
            }
        } else {
            for source in sources.iter().filter(|s| s.enabled && query.source_id.as_deref().map(|id| id == s.id).unwrap_or(true)) {
                let Some(catalog) = entries.get(&source.id).and_then(|e| e.catalog.clone()) else {
                    continue;
                };
                for channel in &catalog.channels {
                    if let Some(group) = &query.group {
                        if &channel.group != group {
                            continue;
                        }
                    }
                    if matches(channel) {
                        items.push(view(channel, &catalog));
                    }
                }
            }
        }
        let total = items.len();
        let limit = if query.limit == 0 { 200 } else { query.limit.min(2000) };
        let page: Vec<ChannelView> = items.into_iter().skip(query.offset).take(limit).collect();
        ChannelPage { items: page, total }
    }

    pub async fn find(&self, channel_id: &str) -> Option<(Channel, Arc<Catalog>)> {
        let source_id = source_of(channel_id)?;
        let catalog = self.entries.read().await.get(source_id)?.catalog.clone()?;
        let channel = catalog.get(channel_id)?.clone();
        Some((channel, catalog))
    }

    pub async fn epg_now(&self, ids: &[String], now: u64) -> HashMap<String, EpgNow> {
        let entries = self.entries.read().await;
        let mut out = HashMap::new();
        for id in ids.iter().take(500) {
            let Some(source_id) = source_of(id) else { continue };
            let Some(catalog) = entries.get(source_id).and_then(|e| e.catalog.clone()) else {
                continue;
            };
            let Some(list) = catalog.programmes(id) else { continue };
            let position = list.partition_point(|p| p.stop <= now);
            let current = list.get(position).filter(|p| p.start <= now).cloned();
            let next = if current.is_some() { list.get(position + 1).cloned() } else { list.get(position).cloned() };
            out.insert(id.clone(), EpgNow { now: current, next });
        }
        out
    }

    pub async fn epg_channel(&self, id: &str, now: u64) -> Vec<Programme> {
        let Some(source_id) = source_of(id) else { return vec![] };
        let entries = self.entries.read().await;
        let Some(catalog) = entries.get(source_id).and_then(|e| e.catalog.clone()) else {
            return vec![];
        };
        catalog
            .programmes(id)
            .map(|list| {
                list.iter()
                    .filter(|p| p.stop > now.saturating_sub(EPG_PAST))
                    .take(200)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }
}

fn short_error(err: &reqwest::Error) -> String {
    if err.is_timeout() {
        return "tiempo de espera agotado".into();
    }
    if err.is_connect() {
        return "no responde".into();
    }
    let text = err.to_string();
    text.split(':').last().unwrap_or(&text).trim().to_string()
}

fn read_cache(app: &tauri::AppHandle, source_id: &str) -> Option<Catalog> {
    let bytes = std::fs::read(cache_file(app, source_id)).ok()?;
    let catalog: Catalog = serde_json::from_slice(&bytes).ok()?;
    Some(catalog.finish())
}

fn write_cache(app: &tauri::AppHandle, source_id: &str, catalog: &Catalog) {
    if std::fs::create_dir_all(cache_dir(app)).is_err() {
        return;
    }
    if let Ok(bytes) = serde_json::to_vec(catalog) {
        let path = cache_file(app, source_id);
        let tmp = path.with_extension("json.part");
        if std::fs::write(&tmp, bytes).is_ok() {
            let _ = std::fs::rename(&tmp, &path);
        }
    }
}

// ---- Xtream ----

fn json_text(v: &Value, key: &str) -> Option<String> {
    match v.get(key)? {
        Value::String(s) => {
            let s = s.trim();
            (!s.is_empty()).then(|| s.to_string())
        }
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

fn json_u64(v: &Value, key: &str) -> Option<u64> {
    match v.get(key)? {
        Value::Number(n) => n.as_u64().or_else(|| n.as_f64().map(|f| f.max(0.0) as u64)),
        Value::String(s) => s.trim().parse::<u64>().ok().or_else(|| s.trim().parse::<f64>().ok().map(|f| f.max(0.0) as u64)),
        _ => None,
    }
}

fn parse_account(value: &Value) -> Result<XtreamAccount, String> {
    let info = value
        .get("user_info")
        .filter(|v| v.is_object())
        .ok_or_else(|| "El servidor no respondió como Xtream Codes".to_string())?;
    let auth = match info.get("auth") {
        Some(Value::Number(n)) => n.as_i64() == Some(1),
        Some(Value::String(s)) => s == "1" || s.eq_ignore_ascii_case("true"),
        Some(Value::Bool(b)) => *b,
        _ => false,
    };
    let status = json_text(info, "status").unwrap_or_default();
    if !auth {
        return Err(match status.to_ascii_lowercase().as_str() {
            "expired" => "La cuenta ha caducado".into(),
            "banned" => "La cuenta está bloqueada".into(),
            "disabled" => "La cuenta está desactivada".into(),
            _ => "Usuario o contraseña incorrectos".into(),
        });
    }
    Ok(XtreamAccount {
        status: if status.is_empty() { "Active".into() } else { status },
        expires_ms: json_u64(info, "exp_date").filter(|&s| s > 0).map(|s| s * 1000),
        max_connections: json_u64(info, "max_connections").map(|n| n as u32),
        active_connections: json_u64(info, "active_cons").map(|n| n as u32),
        trial: json_text(info, "is_trial").is_some_and(|t| t == "1" || t.eq_ignore_ascii_case("true")),
    })
}

fn xtream_channels(source_id: &str, categories: &Value, streams: &Value, kind: &str) -> Vec<Channel> {
    let names: HashMap<String, String> = categories
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| Some((json_text(c, "category_id")?, json_text(c, "category_name")?)))
        .collect();
    let prefix = if kind == "movie" { "v" } else { "s" };
    streams
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| {
            let stream_id = json_text(s, "stream_id")?;
            let name = json_text(s, "name")?;
            let category = json_text(s, "category_id")
                .and_then(|id| names.get(&id).cloned())
                .unwrap_or_default();
            Some(Channel {
                id: format!("{source_id}:{prefix}{stream_id}"),
                source_id: source_id.to_string(),
                name: clean_name(&name),
                logo: json_text(s, "stream_icon").filter(|u| u.starts_with("http")),
                group: category,
                kind: kind.to_string(),
                number: json_u64(s, "num").map(|n| n as u32),
                tvg_id: json_text(s, "epg_channel_id").unwrap_or_default(),
                url: String::new(),
                stream_id,
                container: json_text(s, "container_extension").unwrap_or_default(),
                user_agent: None,
                referrer: None,
            })
        })
        .take(MAX_CHANNELS)
        .collect()
}

// ---- M3U ----

pub struct ParsedPlaylist {
    pub channels: Vec<Channel>,
    /// Guide named in the `#EXTM3U` header (`url-tvg` / `x-tvg-url`).
    pub epg_url: Option<String>,
}

/// Parses an extended M3U playlist. Tolerant: attributes may be unquoted, `#EXTGRP`,
/// `#EXTVLCOPT` and comment lines are understood, anything else is skipped.
pub fn parse_m3u(text: &str, source_id: &str) -> ParsedPlaylist {
    let mut channels: Vec<Channel> = Vec::new();
    let mut epg_url = None;
    let mut pending: Option<(HashMap<String, String>, String)> = None;
    let mut group_line: Option<String> = None;
    let mut user_agent: Option<String> = None;
    let mut referrer: Option<String> = None;
    let mut used: HashSet<String> = HashSet::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix("#EXTM3U") {
            let (attrs, _) = parse_extinf(rest);
            epg_url = attrs
                .get("url-tvg")
                .or_else(|| attrs.get("x-tvg-url"))
                .and_then(|v| v.split(',').next())
                .map(|v| v.trim().to_string())
                .filter(|v| v.starts_with("http"));
            continue;
        }
        if let Some(rest) = line.strip_prefix("#EXTINF:") {
            pending = Some(parse_extinf(rest));
            group_line = None;
            user_agent = None;
            referrer = None;
            continue;
        }
        if let Some(rest) = line.strip_prefix("#EXTGRP:") {
            group_line = Some(rest.trim().to_string());
            continue;
        }
        if let Some(rest) = line.strip_prefix("#EXTVLCOPT:") {
            if let Some((key, value)) = rest.split_once('=') {
                match key.trim().to_ascii_lowercase().as_str() {
                    "http-user-agent" => user_agent = Some(value.trim().to_string()).filter(|v| !v.is_empty()),
                    "http-referrer" => referrer = Some(value.trim().to_string()).filter(|v| !v.is_empty()),
                    _ => {}
                }
            }
            continue;
        }
        if line.starts_with('#') {
            continue;
        }
        // A URL line closes the pending entry.
        let Some((attrs, title)) = pending.take() else {
            continue;
        };
        if !(line.starts_with("http://") || line.starts_with("https://")) {
            continue;
        }
        let name = if title.is_empty() {
            attrs.get("tvg-name").cloned().unwrap_or_default()
        } else {
            title
        };
        let name = clean_name(&name);
        if name.is_empty() {
            continue;
        }
        let tvg_id = attrs.get("tvg-id").cloned().unwrap_or_default().trim().to_string();
        // Some lists (iptv-org) put several categories in group-title separated by ";".
        let group = attrs
            .get("group-title")
            .cloned()
            .filter(|g| !g.trim().is_empty())
            .or_else(|| group_line.clone())
            .unwrap_or_default()
            .split(';')
            .next()
            .unwrap_or_default()
            .trim()
            .to_string();
        let lower = line.to_ascii_lowercase();
        let kind = if lower.contains("/movie/") || lower.contains("/series/") { "movie" } else { "live" };
        let base_key = if !tvg_id.is_empty() {
            format!("i:{}", sanitize_key(&tvg_id))
        } else {
            format!("n:{}", sanitize_key(&normalize(&name)))
        };
        let mut key = base_key.clone();
        let mut n = 1;
        while !used.insert(key.clone()) {
            n += 1;
            key = format!("{base_key}~{n}");
        }
        channels.push(Channel {
            id: format!("{source_id}:{key}"),
            source_id: source_id.to_string(),
            name,
            logo: attrs.get("tvg-logo").map(|s| s.trim().to_string()).filter(|u| u.starts_with("http")),
            group,
            kind: kind.to_string(),
            number: attrs.get("tvg-chno").and_then(|n| n.trim().parse::<u32>().ok()),
            tvg_id,
            url: line.to_string(),
            stream_id: String::new(),
            container: String::new(),
            user_agent: user_agent.take(),
            referrer: referrer.take(),
        });
        if channels.len() >= MAX_CHANNELS {
            break;
        }
    }
    ParsedPlaylist { channels, epg_url }
}

/// `-1 tvg-id="x" group-title="News, US",Channel` → attributes (lowercase keys) and title.
fn parse_extinf(rest: &str) -> (HashMap<String, String>, String) {
    let bytes = rest.as_bytes();
    let mut i = 0;
    // Duration (or nothing when parsing the #EXTM3U header).
    while i < bytes.len() && !matches!(bytes[i], b' ' | b'\t' | b',') {
        i += 1;
    }
    let mut attrs = HashMap::new();
    let title;
    loop {
        while i < bytes.len() && matches!(bytes[i], b' ' | b'\t') {
            i += 1;
        }
        if i >= bytes.len() {
            title = String::new();
            break;
        }
        if bytes[i] == b',' {
            title = rest[i + 1..].trim().to_string();
            break;
        }
        let key_start = i;
        while i < bytes.len() && !matches!(bytes[i], b'=' | b',') {
            i += 1;
        }
        if i >= bytes.len() || bytes[i] == b',' {
            // Bare text before the comma: treat everything from here as the title.
            title = rest[key_start..].trim_start_matches(',').trim().to_string();
            break;
        }
        let key = rest[key_start..i].trim().to_ascii_lowercase();
        i += 1;
        let value = if i < bytes.len() && bytes[i] == b'"' {
            i += 1;
            let start = i;
            while i < bytes.len() && bytes[i] != b'"' {
                i += 1;
            }
            let value = rest[start..i].to_string();
            if i < bytes.len() {
                i += 1;
            }
            value
        } else {
            let start = i;
            while i < bytes.len() && !matches!(bytes[i], b' ' | b'\t' | b',') {
                i += 1;
            }
            rest[start..i].to_string()
        };
        if !key.is_empty() {
            attrs.insert(key, value);
        }
    }
    (attrs, title)
}

fn clean_name(name: &str) -> String {
    name.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(120).collect()
}

/// Lowercase alphanumerics only: "La 1 HD" → "la1hd".
pub fn normalize(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

fn sanitize_key(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control() && !c.is_whitespace())
        .take(80)
        .collect()
}

// ---- XMLTV ----

struct Guide {
    programmes: HashMap<String, Vec<Programme>>,
    /// Normalised display name → XMLTV channel id.
    names: HashMap<String, String>,
}

/// Parses the guide and links it to the catalog's channels: by `tvg-id` first, then by
/// display name. Only programmes of channels in the playlist, around now, are kept.
fn attach_guide(catalog: &mut Catalog, xml: &str, now: u64) {
    let wanted_ids: HashSet<String> = catalog
        .channels
        .iter()
        .filter(|c| !c.tvg_id.is_empty())
        .map(|c| c.tvg_id.to_lowercase())
        .collect();
    let wanted_names: HashSet<String> = catalog.channels.iter().map(|c| normalize(&c.name)).collect();
    let guide = parse_xmltv(xml, &wanted_ids, &wanted_names, now);
    let lower_ids: HashMap<String, String> = guide.programmes.keys().map(|id| (id.to_lowercase(), id.clone())).collect();
    for channel in &catalog.channels {
        let by_id = (!channel.tvg_id.is_empty())
            .then(|| lower_ids.get(&channel.tvg_id.to_lowercase()))
            .flatten();
        let by_name = || guide.names.get(&normalize(&channel.name)).filter(|id| guide.programmes.contains_key(*id));
        if let Some(id) = by_id.or_else(by_name) {
            catalog.channel_epg.insert(channel.id.clone(), id.clone());
        }
    }
    let used: HashSet<&String> = catalog.channel_epg.values().collect();
    catalog.epg = guide
        .programmes
        .into_iter()
        .filter(|(id, _)| used.contains(id))
        .collect();
}

fn parse_xmltv(xml: &str, wanted_ids: &HashSet<String>, wanted_names: &HashSet<String>, now: u64) -> Guide {
    let mut keep: HashSet<String> = wanted_ids.clone();
    let mut names: HashMap<String, String> = HashMap::new();
    // Channel elements: ids we want by display name.
    let mut pos = 0;
    while let Some(rel) = xml[pos..].find("<channel") {
        let start = pos + rel;
        let tag_end = match xml[start..].find('>') {
            Some(i) => start + i + 1,
            None => break,
        };
        let tag = &xml[start..tag_end];
        if !tag.starts_with("<channel ") && !tag.starts_with("<channel\t") && !tag.starts_with("<channel\n") {
            pos = tag_end;
            continue;
        }
        let self_closing = tag.ends_with("/>");
        let end = if self_closing {
            tag_end
        } else {
            match xml[tag_end..].find("</channel>") {
                Some(i) => tag_end + i,
                None => break,
            }
        };
        if let Some(id) = attr(tag, "id") {
            let id = id.to_string();
            let body = &xml[tag_end..end];
            for name in all_texts(body, "display-name") {
                let key = normalize(&name);
                if wanted_names.contains(&key) {
                    keep.insert(id.to_lowercase());
                    names.entry(key).or_insert_with(|| id.clone());
                }
            }
        }
        pos = if self_closing { end } else { end + "</channel>".len() };
    }
    let window_start = now.saturating_sub(EPG_PAST);
    let window_end = now + EPG_FUTURE;
    let mut programmes: HashMap<String, Vec<Programme>> = HashMap::new();
    let mut pos = 0;
    while let Some(rel) = xml[pos..].find("<programme") {
        let start = pos + rel;
        let tag_end = match xml[start..].find('>') {
            Some(i) => start + i + 1,
            None => break,
        };
        let tag = &xml[start..tag_end];
        let end = match xml[tag_end..].find("</programme>") {
            Some(i) => tag_end + i,
            None => break,
        };
        pos = end + "</programme>".len();
        let Some(channel) = attr(tag, "channel") else { continue };
        if !keep.contains(&channel.to_lowercase()) {
            continue;
        }
        let (Some(start_ts), Some(stop_ts)) = (
            attr(tag, "start").and_then(parse_xmltv_time),
            attr(tag, "stop").and_then(parse_xmltv_time),
        ) else {
            continue;
        };
        if stop_ts <= start_ts || stop_ts < window_start || start_ts > window_end {
            continue;
        }
        let body = &xml[tag_end..end];
        let Some(title) = first_text(body, "title") else { continue };
        programmes.entry(channel.to_string()).or_default().push(Programme {
            start: start_ts,
            stop: stop_ts,
            title,
            desc: first_text(body, "desc").map(|d| d.chars().take(MAX_DESC).collect()),
            category: first_text(body, "category"),
        });
    }
    for list in programmes.values_mut() {
        list.sort_by_key(|p| p.start);
        list.dedup_by(|a, b| a.start == b.start && a.title == b.title);
    }
    Guide { programmes, names }
}

/// Value of an attribute inside an opening tag.
fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let mut search = 0;
    while let Some(rel) = tag[search..].find(name) {
        let at = search + rel;
        let before_ok = at > 0 && tag.as_bytes()[at - 1].is_ascii_whitespace();
        let after = &tag[at + name.len()..];
        let after = after.trim_start();
        if before_ok {
            if let Some(rest) = after.strip_prefix('=') {
                let rest = rest.trim_start();
                let quote = rest.chars().next()?;
                if quote == '"' || quote == '\'' {
                    let inner = &rest[1..];
                    return inner.find(quote).map(|i| &inner[..i]);
                }
            }
        }
        search = at + name.len();
    }
    None
}

/// Text of the first `<tag …>…</tag>` element inside `body`, entities decoded.
fn first_text(body: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut search = 0;
    while let Some(rel) = body[search..].find(&open) {
        let at = search + rel;
        let after = body.as_bytes().get(at + open.len()).copied();
        if !matches!(after, Some(b'>') | Some(b' ') | Some(b'\t') | Some(b'\n') | Some(b'\r')) {
            search = at + open.len();
            continue;
        }
        let start = at + body[at..].find('>')? + 1;
        let end = start + body[start..].find(&close)?;
        let text = decode_entities(body[start..end].trim());
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        return (!text.is_empty()).then_some(text);
    }
    None
}

fn all_texts(body: &str, tag: &str) -> Vec<String> {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut out = Vec::new();
    let mut search = 0;
    while let Some(rel) = body[search..].find(&open) {
        let at = search + rel;
        let Some(gt) = body[at..].find('>') else { break };
        let start = at + gt + 1;
        let Some(len) = body[start..].find(&close) else { break };
        let text = decode_entities(body[start..start + len].trim());
        if !text.is_empty() {
            out.push(text);
        }
        search = start + len + close.len();
    }
    out
}

fn decode_entities(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(end) = rest.find(';').filter(|&e| e <= 10) else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..end];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ => entity
                .strip_prefix('#')
                .and_then(|num| {
                    if let Some(hex) = num.strip_prefix(['x', 'X']) {
                        u32::from_str_radix(hex, 16).ok()
                    } else {
                        num.parse::<u32>().ok()
                    }
                })
                .and_then(char::from_u32),
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// `20240101203000 +0100` → unix seconds (also accepts shorter stamps and no zone).
fn parse_xmltv_time(raw: &str) -> Option<u64> {
    let raw = raw.trim();
    let (digits, zone) = match raw.find(' ') {
        Some(i) => (&raw[..i], Some(raw[i + 1..].trim())),
        None => (raw, None),
    };
    if digits.len() < 8 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let num = |from: usize, to: usize| -> i64 {
        digits.get(from..to).and_then(|s| s.parse::<i64>().ok()).unwrap_or(0)
    };
    let year = num(0, 4);
    let month = num(4, 6);
    let day = num(6, 8);
    let hour = num(8, 10);
    let minute = num(10, 12);
    let second = num(12, 14);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let days = days_from_civil(year, month, day);
    let mut ts = days * 86_400 + hour * 3600 + minute * 60 + second;
    if let Some(zone) = zone.filter(|z| z.len() >= 5) {
        let sign = if zone.starts_with('-') { -1 } else { 1 };
        let body = &zone[1..];
        if body.len() >= 4 && body.bytes().all(|b| b.is_ascii_digit()) {
            let zh: i64 = body[0..2].parse().unwrap_or(0);
            let zm: i64 = body[2..4].parse().unwrap_or(0);
            ts -= sign * (zh * 3600 + zm * 60);
        }
    }
    (ts >= 0).then_some(ts as u64)
}

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_extinf_attributes() {
        let (attrs, title) = parse_extinf(r#"-1 tvg-id="La1.es" tvg-name="La 1" tvg-logo="http://x/l.png" group-title="TDT, España",La 1 HD"#);
        assert_eq!(attrs["tvg-id"], "La1.es");
        assert_eq!(attrs["group-title"], "TDT, España");
        assert_eq!(title, "La 1 HD");
        let (attrs, title) = parse_extinf("0,Solo nombre");
        assert!(attrs.is_empty());
        assert_eq!(title, "Solo nombre");
        let (attrs, title) = parse_extinf("-1 tvg-chno=12 group-title=Deportes,Canal 12");
        assert_eq!(attrs["tvg-chno"], "12");
        assert_eq!(attrs["group-title"], "Deportes");
        assert_eq!(title, "Canal 12");
    }

    #[test]
    fn parses_playlist() {
        let text = "#EXTM3U url-tvg=\"http://epg.example/guide.xml.gz\"\r\n\
#EXTINF:-1 tvg-id=\"a.es\" tvg-logo=\"http://x/a.png\" group-title=\"News\",Canal A\r\n\
#EXTVLCOPT:http-user-agent=VLC/3\r\n\
http://host/a.ts\r\n\
#EXTINF:-1,Canal B\r\n\
#EXTGRP:Movies\r\n\
http://host/movie/u/p/1.mkv\r\n\
#EXTINF:-1,Canal B\r\n\
http://host/b2.ts\r\n\
#EXTINF:-1,Sin URL\r\n\
rtmp://host/x\r\n";
        let parsed = parse_m3u(text, "src");
        assert_eq!(parsed.epg_url.as_deref(), Some("http://epg.example/guide.xml.gz"));
        assert_eq!(parsed.channels.len(), 3);
        let a = &parsed.channels[0];
        assert_eq!(a.id, "src:i:a.es");
        assert_eq!(a.group, "News");
        assert_eq!(a.user_agent.as_deref(), Some("VLC/3"));
        assert_eq!(a.logo.as_deref(), Some("http://x/a.png"));
        let b = &parsed.channels[1];
        assert_eq!(b.id, "src:n:canalb");
        assert_eq!(b.group, "Movies");
        assert_eq!(b.kind, "movie");
        assert_eq!(parsed.channels[2].id, "src:n:canalb~2");
    }

    #[test]
    fn parses_xmltv_and_links_channels() {
        let mut catalog = Catalog {
            channels: vec![
                Channel { id: "s:1".into(), name: "Canal A HD".into(), tvg_id: "A.es".into(), ..Channel::default() },
                Channel { id: "s:2".into(), name: "Canal B".into(), ..Channel::default() },
                Channel { id: "s:3".into(), name: "Nadie".into(), ..Channel::default() },
            ],
            ..Catalog::default()
        };
        let now = parse_xmltv_time("20240601120000 +0000").unwrap();
        let xml = r#"<?xml version="1.0"?><tv>
<channel id="a.es"><display-name>Canal A</display-name><icon src="x"/></channel>
<channel id="bb"><display-name lang="es">Canal B</display-name></channel>
<programme start="20240601110000 +0000" stop="20240601123000 +0000" channel="a.es"><title lang="es">Noticias &amp; m&#225;s</title><desc>Resumen</desc></programme>
<programme start="20240601123000 +0000" stop="20240601140000 +0000" channel="a.es"><title>Cine</title></programme>
<programme start="20240601130000 +0100" stop="20240601140000 +0100" channel="bb"><title>Tarde</title></programme>
<programme start="20240101000000 +0000" stop="20240101010000 +0000" channel="bb"><title>Viejo</title></programme>
</tv>"#;
        attach_guide(&mut catalog, xml, now);
        assert_eq!(catalog.channel_epg.get("s:1").map(String::as_str), Some("a.es"));
        assert_eq!(catalog.channel_epg.get("s:2").map(String::as_str), Some("bb"));
        assert!(!catalog.channel_epg.contains_key("s:3"));
        let a = &catalog.epg["a.es"];
        assert_eq!(a.len(), 2);
        assert_eq!(a[0].title, "Noticias & más");
        assert_eq!(a[0].desc.as_deref(), Some("Resumen"));
        let b = &catalog.epg["bb"];
        assert_eq!(b.len(), 1);
        assert_eq!(b[0].start, now); // 13:00 +0100 == 12:00 UTC
        let catalog = catalog.finish();
        let list = catalog.programmes("s:1").unwrap();
        let position = list.partition_point(|p| p.stop <= now);
        assert_eq!(list[position].title, "Noticias & más");
    }

    #[test]
    fn parses_times_and_xtream_urls() {
        assert_eq!(parse_xmltv_time("19700102000000 +0000"), Some(86_400));
        assert_eq!(parse_xmltv_time("197001020000"), Some(86_400));
        assert_eq!(parse_xmltv_time("19700101230000 -0100"), Some(86_400));
        assert!(parse_xmltv_time("nope").is_none());
        let (base, user, pass) = parse_xtream_url("http://host.tv:8080/get.php?username=u%201&password=p&type=m3u_plus").unwrap();
        assert_eq!(base, "http://host.tv:8080");
        assert_eq!(user.as_deref(), Some("u 1"));
        assert_eq!(pass.as_deref(), Some("p"));
        let (base, user, _) = parse_xtream_url("host.tv:8080").unwrap();
        assert_eq!(base, "http://host.tv:8080");
        assert!(user.is_none());
        assert!(parse_xtream_url("ftp://x").is_err());
    }

    #[test]
    fn xtream_streams_and_account() {
        let categories = serde_json::json!([{ "category_id": "3", "category_name": "Deportes" }]);
        let streams = serde_json::json!([
            { "num": 7, "name": "  Canal  X ", "stream_id": 55, "stream_icon": "http://i/x.png", "epg_channel_id": "x.es", "category_id": "3" },
            { "name": "Sin id" }
        ]);
        let list = xtream_channels("src", &categories, &streams, "live");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "src:s55");
        assert_eq!(list[0].name, "Canal X");
        assert_eq!(list[0].group, "Deportes");
        assert_eq!(list[0].number, Some(7));
        let ok = serde_json::json!({ "user_info": { "auth": 1, "status": "Active", "exp_date": "1900000000", "max_connections": "2", "is_trial": "0" } });
        let account = parse_account(&ok).unwrap();
        assert_eq!(account.expires_ms, Some(1_900_000_000_000));
        assert_eq!(account.max_connections, Some(2));
        let bad = serde_json::json!({ "user_info": { "auth": 0, "status": "Expired" } });
        assert_eq!(parse_account(&bad).unwrap_err(), "La cuenta ha caducado");
    }
}
