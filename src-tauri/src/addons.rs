//! Stremio addon protocol client: manifests, catalogs, metadata and streams.
//!
//! Addons are plain HTTP services (`<base>/manifest.json`, `/catalog/...`, `/meta/...`,
//! `/stream/...`). Everything is fetched from Rust because the webview CSP only allows
//! the app's own origin. Cinemeta (Stremio's public metadata addon) is used as the
//! fallback for titles whose addon does not serve `meta`.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri_plugin_store::StoreExt;

pub const CINEMETA_URL: &str = "https://v3-cinemeta.strem.io/manifest.json";
const MANIFEST_TTL: Duration = Duration::from_secs(60 * 60);
const STREAM_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_RESUME_ENTRIES: usize = 100;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonCatalog {
    pub addon_url: String,
    pub addon_name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub id: String,
    pub name: String,
    pub searchable: bool,
    /// Catalogs that only work with an extra (e.g. search) are not shown on Home.
    pub requires_extra: bool,
    pub genres: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonInfo {
    pub url: String,
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub logo: Option<String>,
    pub types: Vec<String>,
    /// Resource names: "catalog", "meta", "stream", "subtitles"...
    pub resources: Vec<String>,
    pub catalogs: Vec<AddonCatalog>,
    pub builtin: bool,
    #[serde(skip)]
    manifest: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonMeta {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub name: String,
    pub poster: Option<String>,
    pub background: Option<String>,
    pub logo: Option<String>,
    pub description: Option<String>,
    pub release_info: Option<String>,
    pub imdb_rating: Option<f64>,
    pub genres: Vec<String>,
    pub runtime: Option<String>,
    pub year: Option<i32>,
    /// "tt…" when the id (or the `imdb_id` field) is an IMDb id.
    pub imdb: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonVideo {
    pub id: String,
    pub title: String,
    pub season: Option<i32>,
    pub episode: Option<i32>,
    pub released: Option<String>,
    pub thumbnail: Option<String>,
    pub overview: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonMetaFull {
    #[serde(flatten)]
    pub meta: AddonMeta,
    pub cast: Vec<String>,
    pub director: Vec<String>,
    pub videos: Vec<AddonVideo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonStream {
    pub addon_name: String,
    pub addon_url: String,
    pub name: String,
    pub title: String,
    pub url: Option<String>,
    pub external_url: Option<String>,
    pub info_hash: Option<String>,
    pub headers: Vec<(String, String)>,
    pub binge_group: Option<String>,
    pub filename: Option<String>,
    pub video_size: Option<u64>,
    /// True when mpv can open it directly (an http(s) `url`).
    pub playable: bool,
}

/// Locally remembered playback position of an online title.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ResumeEntry {
    /// Stable key: the Stremio video id ("tt123" or "tt123:1:2").
    pub key: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub meta_id: String,
    pub name: String,
    pub series_name: Option<String>,
    pub poster: Option<String>,
    pub background: Option<String>,
    pub logo: Option<String>,
    pub season: Option<i32>,
    pub episode: Option<i32>,
    pub imdb: Option<String>,
    pub position_seconds: f64,
    pub duration_seconds: f64,
    pub updated_ms: u64,
}

impl Default for ResumeEntry {
    fn default() -> Self {
        Self {
            key: String::new(),
            kind: "movie".into(),
            meta_id: String::new(),
            name: String::new(),
            series_name: None,
            poster: None,
            background: None,
            logo: None,
            season: None,
            episode: None,
            imdb: None,
            position_seconds: 0.0,
            duration_seconds: 0.0,
            updated_ms: 0,
        }
    }
}

pub struct AddonClient {
    http: reqwest::Client,
    manifests: Mutex<HashMap<String, (Instant, AddonInfo)>>,
    /// Catalog pages by URL: Home, the hero and Discover ask for the same ones.
    catalogs: Mutex<HashMap<String, (Instant, Vec<AddonMeta>)>>,
}

const CATALOG_TTL: Duration = Duration::from_secs(5 * 60);

impl AddonClient {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(25))
            .user_agent(format!("ejFlix/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("http client");
        Self {
            http,
            manifests: Mutex::new(HashMap::new()),
            catalogs: Mutex::new(HashMap::new()),
        }
    }

    pub async fn manifest(&self, url: &str, builtin: bool) -> Result<AddonInfo, String> {
        let url = normalize_manifest_url(url)?;
        if let Some((at, info)) = self.manifests.lock().unwrap().get(&url) {
            if at.elapsed() < MANIFEST_TTL {
                return Ok(info.clone());
            }
        }
        let res = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("No se pudo cargar el addon: {e}"))?;
        if !res.status().is_success() {
            return Err(format!("El addon respondió {}", res.status()));
        }
        let value: Value = res
            .json()
            .await
            .map_err(|_| "El manifest del addon no es JSON válido".to_string())?;
        let info = parse_manifest(&url, value, builtin)?;
        self.manifests
            .lock()
            .unwrap()
            .insert(url, (Instant::now(), info.clone()));
        Ok(info)
    }

    pub fn forget(&self, url: &str) {
        if let Ok(url) = normalize_manifest_url(url) {
            self.manifests.lock().unwrap().remove(&url);
            let base = base_of(&url);
            self.catalogs.lock().unwrap().retain(|k, _| !k.starts_with(&base));
        }
    }

    pub async fn catalog(
        &self,
        addon: &AddonInfo,
        kind: &str,
        id: &str,
        extra: &[(String, String)],
    ) -> Result<Vec<AddonMeta>, String> {
        let base = base_of(&addon.url);
        let mut path = format!("{base}/catalog/{}/{}", enc(kind), enc(id));
        let query: Vec<String> = extra
            .iter()
            .filter(|(_, v)| !v.is_empty())
            .map(|(k, v)| format!("{}={}", enc(k), enc(v)))
            .collect();
        if !query.is_empty() {
            path.push('/');
            path.push_str(&query.join("&"));
        }
        path.push_str(".json");
        let cacheable = !extra.iter().any(|(k, _)| k == "search");
        if cacheable {
            if let Some((at, metas)) = self.catalogs.lock().unwrap().get(&path) {
                if at.elapsed() < CATALOG_TTL {
                    return Ok(metas.clone());
                }
            }
        }
        let value = self.get_json(&path).await?;
        let metas: Vec<AddonMeta> = value
            .get("metas")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
            .filter_map(parse_meta)
            .collect();
        if cacheable {
            let mut cache = self.catalogs.lock().unwrap();
            if cache.len() > 200 {
                cache.clear();
            }
            cache.insert(path, (Instant::now(), metas.clone()));
        }
        Ok(metas)
    }

    /// Full metadata: the first addon that serves `meta` for this type/id, else Cinemeta.
    pub async fn meta(&self, addons: &[AddonInfo], kind: &str, id: &str) -> Result<AddonMetaFull, String> {
        let mut candidates: Vec<AddonInfo> = addons
            .iter()
            .filter(|a| supports(a, "meta", kind, id))
            .cloned()
            .collect();
        if !candidates.iter().any(|a| a.url == CINEMETA_URL) {
            if let Ok(info) = self.manifest(CINEMETA_URL, true).await {
                if supports(&info, "meta", kind, id) {
                    candidates.push(info);
                }
            }
        }
        for addon in candidates {
            let path = format!("{}/meta/{}/{}.json", base_of(&addon.url), enc(kind), enc(id));
            if let Ok(value) = self.get_json(&path).await {
                if let Some(meta) = value.get("meta").and_then(parse_meta_full) {
                    return Ok(meta);
                }
            }
        }
        Err("No hay información para este título".into())
    }

    /// Streams from every addon that serves them for this type/id, fetched concurrently.
    pub async fn streams(&self, addons: &[AddonInfo], kind: &str, id: &str) -> Vec<AddonStream> {
        let mut handles = Vec::new();
        for addon in addons.iter().filter(|a| supports(a, "stream", kind, id)).cloned() {
            let http = self.http.clone();
            let path = format!("{}/stream/{}/{}.json", base_of(&addon.url), enc(kind), enc(id));
            handles.push(tauri::async_runtime::spawn(async move {
                let request = async {
                    let res = http.get(&path).send().await.ok()?;
                    if !res.status().is_success() {
                        return None;
                    }
                    res.json::<Value>().await.ok()
                };
                let value = tokio::time::timeout(STREAM_TIMEOUT, request).await.ok().flatten();
                let Some(value) = value else {
                    return Vec::new();
                };
                value
                    .get("streams")
                    .and_then(|v| v.as_array())
                    .into_iter()
                    .flatten()
                    .filter_map(|s| parse_stream(&addon, s))
                    .collect::<Vec<_>>()
            }));
        }
        let mut out = Vec::new();
        for handle in handles {
            if let Ok(list) = handle.await {
                out.extend(list);
            }
        }
        out
    }

    async fn get_json(&self, url: &str) -> Result<Value, String> {
        let res = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|e| format!("Error de red: {e}"))?;
        if !res.status().is_success() {
            return Err(format!("El addon respondió {}", res.status()));
        }
        res.json().await.map_err(|_| "Respuesta no válida del addon".to_string())
    }
}

pub fn normalize_manifest_url(raw: &str) -> Result<String, String> {
    let mut url = raw.trim().to_string();
    if url.is_empty() || url.len() > 2048 {
        return Err("URL de addon no válida".into());
    }
    if let Some(rest) = url.strip_prefix("stremio://") {
        url = format!("https://{rest}");
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("La URL del addon debe empezar por http:// o https://".into());
    }
    url = url.trim_end_matches('/').to_string();
    if !url.ends_with("/manifest.json") {
        url.push_str("/manifest.json");
    }
    Ok(url)
}

fn base_of(manifest_url: &str) -> &str {
    manifest_url
        .strip_suffix("/manifest.json")
        .unwrap_or(manifest_url)
}

fn enc(s: &str) -> String {
    crate::jellyfin::urlencoding_lite(s)
}

fn text(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn strings(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(|x| x.as_array())
        .into_iter()
        .flatten()
        .filter_map(|x| x.as_str().map(|s| s.to_string()))
        .collect()
}

fn parse_manifest(url: &str, value: Value, builtin: bool) -> Result<AddonInfo, String> {
    let name = text(&value, "name").ok_or("El manifest no tiene nombre")?;
    let resources: Vec<String> = value
        .get("resources")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|r| match r {
            Value::String(s) => Some(s.clone()),
            Value::Object(o) => o.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()),
            _ => None,
        })
        .collect();
    let types = strings(&value, "types");
    let catalogs = value
        .get("catalogs")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|c| {
            let kind = text(c, "type")?;
            let id = text(c, "id")?;
            let cname = text(c, "name").unwrap_or_else(|| id.clone());
            let extra = c.get("extra").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let extra_supported = strings(c, "extraSupported");
            let extra_required = strings(c, "extraRequired");
            let mut searchable = extra_supported.iter().any(|e| e == "search");
            let mut requires_extra = !extra_required.is_empty();
            let mut genres = Vec::new();
            for e in &extra {
                let ename = text(e, "name").unwrap_or_default();
                let required = e.get("isRequired").and_then(|v| v.as_bool()).unwrap_or(false);
                if ename == "search" {
                    searchable = true;
                }
                if ename == "genre" {
                    genres = strings(e, "options");
                }
                if required {
                    requires_extra = true;
                }
            }
            Some(AddonCatalog {
                addon_url: url.to_string(),
                addon_name: name.clone(),
                kind,
                id,
                name: cname,
                searchable,
                requires_extra,
                genres,
            })
        })
        .collect();
    Ok(AddonInfo {
        url: url.to_string(),
        id: text(&value, "id").unwrap_or_else(|| url.to_string()),
        name,
        version: text(&value, "version").unwrap_or_default(),
        description: text(&value, "description").unwrap_or_default(),
        logo: text(&value, "logo"),
        types,
        resources,
        catalogs,
        builtin,
        manifest: value,
    })
}

/// Does the addon declare `resource` for this content type and id prefix?
fn supports(addon: &AddonInfo, resource: &str, kind: &str, id: &str) -> bool {
    let manifest = &addon.manifest;
    let Some(resources) = manifest.get("resources").and_then(|v| v.as_array()) else {
        return false;
    };
    let global_types = strings(manifest, "types");
    let global_prefixes = strings(manifest, "idPrefixes");
    resources.iter().any(|r| match r {
        Value::String(s) => {
            s == resource
                && (global_types.is_empty() || global_types.iter().any(|t| t == kind))
                && (global_prefixes.is_empty() || global_prefixes.iter().any(|p| id.starts_with(p.as_str())))
        }
        Value::Object(o) => {
            if o.get("name").and_then(|n| n.as_str()) != Some(resource) {
                return false;
            }
            let own_types = strings(r, "types");
            let own_prefixes = strings(r, "idPrefixes");
            let types = if own_types.is_empty() { &global_types } else { &own_types };
            let prefixes = if own_prefixes.is_empty() { &global_prefixes } else { &own_prefixes };
            (types.is_empty() || types.iter().any(|t| t == kind))
                && (prefixes.is_empty() || prefixes.iter().any(|p| id.starts_with(p.as_str())))
        }
        _ => false,
    })
}

fn parse_meta(v: &Value) -> Option<AddonMeta> {
    let id = text(v, "id")?;
    let name = text(v, "name")?;
    let kind = text(v, "type").unwrap_or_else(|| "movie".into());
    let imdb = text(v, "imdb_id").or_else(|| {
        id.starts_with("tt")
            .then(|| id.split(':').next().unwrap_or(&id).to_string())
    });
    let release_info = text(v, "releaseInfo");
    let year = v
        .get("year")
        .and_then(|y| y.as_i64())
        .map(|y| y as i32)
        .or_else(|| {
            text(v, "year")
                .or_else(|| release_info.clone())
                .and_then(|s| s.get(0..4).and_then(|y| y.parse::<i32>().ok()))
        });
    Some(AddonMeta {
        id,
        kind,
        name,
        poster: text(v, "poster"),
        background: text(v, "background"),
        logo: text(v, "logo"),
        description: text(v, "description"),
        release_info,
        imdb_rating: v
            .get("imdbRating")
            .and_then(|r| r.as_f64().or_else(|| r.as_str().and_then(|s| s.parse().ok()))),
        genres: strings(v, "genres"),
        runtime: text(v, "runtime"),
        year,
        imdb,
    })
}

fn parse_meta_full(v: &Value) -> Option<AddonMetaFull> {
    let meta = parse_meta(v)?;
    let videos = v
        .get("videos")
        .and_then(|x| x.as_array())
        .into_iter()
        .flatten()
        .filter_map(|video| {
            let id = text(video, "id")?;
            Some(AddonVideo {
                title: text(video, "title")
                    .or_else(|| text(video, "name"))
                    .unwrap_or_else(|| id.clone()),
                season: video.get("season").and_then(|s| s.as_i64()).map(|n| n as i32),
                episode: video
                    .get("episode")
                    .or_else(|| video.get("number"))
                    .and_then(|s| s.as_i64())
                    .map(|n| n as i32),
                released: text(video, "released").or_else(|| text(video, "firstAired")),
                thumbnail: text(video, "thumbnail"),
                overview: text(video, "overview"),
                id,
            })
        })
        .collect();
    Some(AddonMetaFull {
        meta,
        cast: strings(v, "cast"),
        director: strings(v, "director"),
        videos,
    })
}

fn parse_stream(addon: &AddonInfo, s: &Value) -> Option<AddonStream> {
    let url = text(s, "url").filter(|u| u.starts_with("http://") || u.starts_with("https://"));
    let external_url = text(s, "externalUrl");
    let info_hash = text(s, "infoHash");
    if url.is_none() && external_url.is_none() && info_hash.is_none() {
        return None;
    }
    let hints = s.get("behaviorHints");
    let headers = hints
        .and_then(|h| h.get("proxyHeaders"))
        .and_then(|p| p.get("request"))
        .and_then(|r| r.as_object())
        .map(|o| {
            o.iter()
                .filter_map(|(k, v)| v.as_str().map(|v| (k.clone(), v.to_string())))
                .collect()
        })
        .unwrap_or_default();
    Some(AddonStream {
        addon_name: addon.name.clone(),
        addon_url: addon.url.clone(),
        name: text(s, "name").unwrap_or_else(|| addon.name.clone()),
        title: text(s, "title")
            .or_else(|| text(s, "description"))
            .unwrap_or_default(),
        playable: url.is_some(),
        url,
        external_url,
        info_hash,
        headers,
        binge_group: hints.and_then(|h| text(h, "bingeGroup")),
        filename: hints.and_then(|h| text(h, "filename")),
        video_size: hints.and_then(|h| h.get("videoSize")).and_then(|v| v.as_u64()),
    })
}

// ---- local resume positions for online titles ----

fn progress_key(user_id: &str) -> String {
    format!("addonProgress.{user_id}")
}

pub fn load_progress(app: &tauri::AppHandle, user_id: &str) -> Vec<ResumeEntry> {
    let Ok(store) = app.store("session.json") else {
        return vec![];
    };
    store
        .get(progress_key(user_id))
        .and_then(|v| serde_json::from_value::<Vec<ResumeEntry>>(v).ok())
        .unwrap_or_default()
}

pub fn upsert_progress(app: &tauri::AppHandle, user_id: &str, entry: ResumeEntry) -> Result<(), String> {
    let store = app.store("session.json").map_err(|e| e.to_string())?;
    let mut list = load_progress(app, user_id);
    list.retain(|e| e.key != entry.key);
    let finished =
        entry.duration_seconds > 0.0 && entry.position_seconds / entry.duration_seconds > 0.95;
    if !finished && entry.position_seconds > 5.0 {
        list.insert(0, entry);
    }
    list.truncate(MAX_RESUME_ENTRIES);
    store.set(
        progress_key(user_id),
        serde_json::to_value(&list).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())
}

pub fn remove_progress(app: &tauri::AppHandle, user_id: &str, key: &str) -> Result<(), String> {
    let store = app.store("session.json").map_err(|e| e.to_string())?;
    let mut list = load_progress(app, user_id);
    list.retain(|e| e.key != key);
    store.set(
        progress_key(user_id),
        serde_json::to_value(&list).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
