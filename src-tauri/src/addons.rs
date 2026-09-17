//! Stremio addon protocol client: manifests, catalogs, metadata and streams.
//!
//! Addons are plain HTTP services (`<base>/manifest.json`, `/catalog/...`, `/meta/...`,
//! `/stream/...`). Everything is fetched from Rust because the webview CSP only allows
//! the app's own origin. Cinemeta (Stremio's public metadata addon) is used as the
//! fallback for titles whose addon does not serve `meta`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri_plugin_store::StoreExt;

pub const CINEMETA_URL: &str = "https://v3-cinemeta.strem.io/manifest.json";
const MANIFEST_TTL: Duration = Duration::from_secs(60 * 60);
const STREAM_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_RESUME_ENTRIES: usize = 100;
const MAX_LIBRARY_ENTRIES: usize = 500;
const MAX_RELATED_LOOKUPS: usize = 16;

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
    /// The addon's own settings page (debrid keys and the like), when it has one.
    pub configure_url: Option<String>,
    /// False when the profile switched it off (kept in the list, not consulted).
    pub enabled: bool,
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

/// One name of the cast. Cinemeta lists plain names; the catalogs that wrap TMDB
/// carry the character and a picture as well.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonPerson {
    pub name: String,
    pub role: Option<String>,
    pub photo: Option<String>,
}

/// Another title this one is actually tied to: the rest of its collection, the saga
/// it belongs to. Addons publish these as `links` pointing at `stremio:///detail/...`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonRelated {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub name: String,
    /// The heading the addon filed them under ("Halloween - Colección").
    pub group: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonMetaFull {
    #[serde(flatten)]
    pub meta: AddonMeta,
    pub cast: Vec<AddonPerson>,
    pub director: Vec<String>,
    pub videos: Vec<AddonVideo>,
    pub related: Vec<AddonRelated>,
}

/// A title the user saved or ticked off. Online titles have no server to remember
/// them, so the app keeps its own list next to the playback positions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LibraryEntry {
    /// Stremio video id: "tt123" for a film, "tt123:1:2" for an episode.
    pub key: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub meta_id: String,
    pub name: String,
    pub series_name: Option<String>,
    pub poster: Option<String>,
    pub background: Option<String>,
    pub logo: Option<String>,
    pub year: Option<i32>,
    pub season: Option<i32>,
    pub episode: Option<i32>,
    pub imdb: Option<String>,
    /// In "My list".
    pub saved: bool,
    pub watched: bool,
    pub updated_ms: u64,
}

impl Default for LibraryEntry {
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
            year: None,
            season: None,
            episode: None,
            imdb: None,
            saved: false,
            watched: false,
            updated_ms: 0,
        }
    }
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
    /// True when mpv can open it directly (an http(s) `url`). A bare torrent (an
    /// `info_hash` without `url`) plays through the built-in engine instead.
    pub playable: bool,
    /// Which file of the torrent, when the addon says.
    pub file_idx: Option<usize>,
    /// Trackers the addon named for the torrent.
    pub sources: Vec<String>,
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
    /// `"movie/tmdb:610253"` -> the IMDb id of that title, `None` when it has none.
    imdb_ids: Mutex<HashMap<String, Option<String>>>,
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
            imdb_ids: Mutex::new(HashMap::new()),
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

    /// The same title addressed by its IMDb id, when the given id is a catalog one.
    ///
    /// Torrent addons (Torrentio, Peerflix...) only index IMDb ids, so asking with a
    /// catalog id such as `tmdb:610253` silently reaches barely half of the sources.
    /// The metadata behind those ids carries `imdb_id`, which is what this digs out.
    async fn imdb_alias(&self, addons: &[AddonInfo], kind: &str, id: &str) -> Option<String> {
        let (base, suffix) = split_video_id(id);
        if base.starts_with("tt") {
            return None;
        }
        let key = format!("{kind}/{base}");
        if let Some(cached) = self.imdb_ids.lock().unwrap().get(&key) {
            return cached.clone().map(|imdb| format!("{imdb}{suffix}"));
        }
        let imdb = self
            .meta(addons, kind, base)
            .await
            .ok()
            .and_then(|full| full.meta.imdb)
            .filter(|imdb| imdb.starts_with("tt"));
        self.imdb_ids.lock().unwrap().insert(key, imdb.clone());
        imdb.map(|imdb| format!("{imdb}{suffix}"))
    }

    /// The poster-card metadata of several titles at once, keeping the order asked for.
    ///
    /// A collection link carries a name and nothing else, so each title has to be
    /// looked up before it can be drawn as a card.
    pub async fn metas(self: &Arc<Self>, addons: &[AddonInfo], kind: &str, ids: &[String]) -> Vec<AddonMeta> {
        let mut handles = Vec::new();
        for id in ids.iter().take(MAX_RELATED_LOOKUPS).cloned() {
            let addons = addons.to_vec();
            let kind = kind.to_string();
            let me = Arc::clone(self);
            handles.push(tauri::async_runtime::spawn(async move {
                me.meta(&addons, &kind, &id).await.ok().map(|full| full.meta)
            }));
        }
        let mut out = Vec::new();
        for handle in handles {
            if let Ok(Some(meta)) = handle.await {
                out.push(meta);
            }
        }
        out
    }

    /// Streams from every addon that serves them for this type/id, fetched concurrently.
    ///
    /// A catalog id is asked for twice, as itself and as its IMDb id, because each one
    /// reaches a different half of the sources; both answers are merged.
    pub async fn streams(&self, addons: &[AddonInfo], kind: &str, id: &str) -> Vec<AddonStream> {
        let mut ids = vec![id.to_string()];
        if let Some(alias) = self.imdb_alias(addons, kind, id).await {
            ids.push(alias);
        }
        let mut handles = Vec::new();
        for id in ids {
            for addon in addons.iter().filter(|a| supports(a, "stream", kind, &id)).cloned() {
                let http = self.http.clone();
                let path = format!("{}/stream/{}/{}.json", base_of(&addon.url), enc(kind), enc(&id));
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
        }
        let mut out: Vec<AddonStream> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for handle in handles {
            let Ok(list) = handle.await else { continue };
            for stream in list {
                if seen.insert(identity_of(&stream)) {
                    out.push(stream);
                }
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

/// Categories of `links` that are not a title: everything else is a real relation.
const LINK_NOISE: [&str; 6] = ["imdb", "share", "Genres", "Cast", "Directors", "Writers"];

/// Titles named in `links` as `stremio:///detail/<type>/<id>`, which is how an addon
/// publishes the collection a film belongs to.
fn parse_related(v: &Value) -> Vec<AddonRelated> {
    v.get("links")
        .and_then(|x| x.as_array())
        .into_iter()
        .flatten()
        .filter_map(|link| {
            let group = text(link, "category")?;
            if LINK_NOISE.contains(&group.as_str()) {
                return None;
            }
            let url = text(link, "url")?;
            let rest = url.strip_prefix("stremio:///detail/")?;
            let (kind, id) = rest.split_once('/')?;
            let id = id.split('/').next().unwrap_or(id);
            (!id.is_empty()).then(|| AddonRelated {
                id: id.to_string(),
                kind: kind.to_string(),
                name: text(link, "name").unwrap_or_else(|| id.to_string()),
                group,
            })
        })
        .take(24)
        .collect()
}

/// `["Jamie Lee Curtis"]` or `{ name, character, photo }` entries, whichever the
/// addon wrote. The richer shape lives under `app_extras`, the plain one under `cast`.
fn parse_cast(v: &Value) -> Vec<AddonPerson> {
    let rich = v
        .get("app_extras")
        .and_then(|x| x.get("cast"))
        .and_then(|x| x.as_array());
    if let Some(list) = rich {
        let people: Vec<AddonPerson> = list
            .iter()
            .filter_map(|person| {
                Some(AddonPerson {
                    name: text(person, "name")?,
                    role: text(person, "character").or_else(|| text(person, "role")),
                    photo: text(person, "photo").or_else(|| text(person, "profile")),
                })
            })
            .take(20)
            .collect();
        if !people.is_empty() {
            return people;
        }
    }
    strings(v, "cast")
        .into_iter()
        .take(20)
        .map(|name| AddonPerson { name, role: None, photo: None })
        .collect()
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
    // Stremio convention: a configurable addon serves its page at <base>/configure.
    let configurable = value
        .get("behaviorHints")
        .and_then(|h| h.get("configurable"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
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
        configure_url: (configurable && !builtin).then(|| format!("{}/configure", base_of(url))),
        enabled: true,
        manifest: value,
    })
}

/// `"tmdb:610253:1:2"` -> `("tmdb:610253", ":1:2")`. A meta id carries colons of its
/// own, so only a trailing `:season:episode` pair counts as the suffix.
fn split_video_id(id: &str) -> (&str, &str) {
    let mut colons = id.rmatch_indices(':');
    if let (Some((episode, _)), Some((season, _))) = (colons.next(), colons.next()) {
        let number = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit());
        if number(&id[episode + 1..]) && number(&id[season + 1..episode]) {
            return (&id[..season], &id[season..]);
        }
    }
    (id, "")
}

/// What makes two rows the same file, so merging the two answers repeats nothing.
fn identity_of(s: &AddonStream) -> String {
    match (&s.url, &s.info_hash) {
        (Some(url), _) => format!("u:{url}"),
        (None, Some(hash)) => format!("h:{hash}:{}", s.filename.as_deref().unwrap_or_default()),
        _ => format!("t:{}:{}", s.name, s.title),
    }
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
        cast: parse_cast(v),
        director: strings(v, "director"),
        videos,
        related: parse_related(v),
    })
}

/// The info hash and trackers of a `magnet:` link, when the addon sent one instead of
/// the `infoHash` field.
fn magnet_parts(link: &str) -> Option<(String, Vec<String>)> {
    let query = link.strip_prefix("magnet:?")?;
    let mut hash = None;
    let mut trackers = Vec::new();
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else { continue };
        let value = crate::iptv::percent_decode(value);
        match key {
            "xt" => {
                let candidate = value.strip_prefix("urn:btih:").unwrap_or_default().to_ascii_lowercase();
                if candidate.len() == 40 && candidate.bytes().all(|b| b.is_ascii_hexdigit()) {
                    hash = Some(candidate);
                }
            }
            "tr" => trackers.push(value),
            _ => {}
        }
    }
    hash.map(|h| (h, trackers))
}

fn parse_stream(addon: &AddonInfo, s: &Value) -> Option<AddonStream> {
    let raw_url = text(s, "url");
    let url = raw_url.clone().filter(|u| u.starts_with("http://") || u.starts_with("https://"));
    let mut external_url = text(s, "externalUrl");
    let mut info_hash = text(s, "infoHash")
        .map(|h| h.to_ascii_lowercase())
        .filter(|h| h.len() == 40 && h.bytes().all(|b| b.is_ascii_hexdigit()));
    let mut sources: Vec<String> = strings(s, "sources")
        .into_iter()
        .filter_map(|src| src.strip_prefix("tracker:").map(str::to_string))
        .collect();
    // Some addons hand out a magnet link where others put the info hash.
    if info_hash.is_none() {
        let magnet = raw_url.as_deref().filter(|u| u.starts_with("magnet:")).or(external_url.as_deref().filter(|u| u.starts_with("magnet:")));
        if let Some((hash, trackers)) = magnet.and_then(magnet_parts) {
            info_hash = Some(hash);
            sources.extend(trackers);
            external_url = external_url.filter(|u| !u.starts_with("magnet:"));
        }
    }
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
        file_idx: s.get("fileIdx").and_then(|v| v.as_u64()).map(|v| v as usize),
        sources,
    })
}

// ---- local resume positions for online titles ----

fn progress_key(user_id: &str) -> String {
    format!("addonProgress.{user_id}")
}

fn library_key(user_id: &str) -> String {
    format!("addonLibrary.{user_id}")
}

pub fn load_library(app: &tauri::AppHandle, user_id: &str) -> Vec<LibraryEntry> {
    let Ok(store) = app.store(crate::store_path()) else {
        return vec![];
    };
    store
        .get(library_key(user_id))
        .and_then(|v| serde_json::from_value::<Vec<LibraryEntry>>(v).ok())
        .unwrap_or_default()
}

/// Saves or clears the two flags of one title. An entry with neither flag left is
/// dropped, so the list only ever holds what the user actually marked.
pub fn set_library_flags(
    app: &tauri::AppHandle,
    user_id: &str,
    mut entry: LibraryEntry,
    saved: Option<bool>,
    watched: Option<bool>,
) -> Result<Vec<LibraryEntry>, String> {
    if entry.key.is_empty() {
        return Err("La entrada no tiene identificador".into());
    }
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    let mut list = load_library(app, user_id);
    if let Some(previous) = list.iter().find(|e| e.key == entry.key) {
        entry.saved = previous.saved;
        entry.watched = previous.watched;
    }
    entry.saved = saved.unwrap_or(entry.saved);
    entry.watched = watched.unwrap_or(entry.watched);
    entry.updated_ms = now_ms();
    list.retain(|e| e.key != entry.key);
    if entry.saved || entry.watched {
        list.insert(0, entry);
    }
    list.truncate(MAX_LIBRARY_ENTRIES);
    store.set(
        library_key(user_id),
        serde_json::to_value(&list).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())?;
    Ok(list)
}

pub fn load_progress(app: &tauri::AppHandle, user_id: &str) -> Vec<ResumeEntry> {
    let Ok(store) = app.store(crate::store_path()) else {
        return vec![];
    };
    store
        .get(progress_key(user_id))
        .and_then(|v| serde_json::from_value::<Vec<ResumeEntry>>(v).ok())
        .unwrap_or_default()
}

pub fn upsert_progress(app: &tauri::AppHandle, user_id: &str, entry: ResumeEntry) -> Result<(), String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
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
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    let mut list = load_progress(app, user_id);
    list.retain(|e| e.key != key);
    store.set(
        progress_key(user_id),
        serde_json::to_value(&list).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())
}

/// Replaces the whole list with what the account holds (newest first).
pub fn replace_library(app: &tauri::AppHandle, user_id: &str, mut list: Vec<LibraryEntry>) -> Result<(), String> {
    list.retain(|e| !e.key.is_empty() && (e.saved || e.watched));
    let mut seen = std::collections::HashSet::new();
    list.retain(|e| seen.insert(e.key.clone()));
    list.sort_by(|a, b| b.updated_ms.cmp(&a.updated_ms));
    list.truncate(MAX_LIBRARY_ENTRIES);
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.set(
        library_key(user_id),
        serde_json::to_value(&list).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())
}

/// Replaces every remembered position with the merged set from the account.
pub fn replace_progress(app: &tauri::AppHandle, user_id: &str, mut list: Vec<ResumeEntry>) -> Result<(), String> {
    list.retain(|e| !e.key.is_empty());
    let mut seen = std::collections::HashSet::new();
    list.retain(|e| seen.insert(e.key.clone()));
    list.sort_by(|a, b| b.updated_ms.cmp(&a.updated_ms));
    list.truncate(MAX_RESUME_ENTRIES);
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_video_ids() {
        assert_eq!(split_video_id("tt10665338"), ("tt10665338", ""));
        assert_eq!(split_video_id("tt0944947:1:2"), ("tt0944947", ":1:2"));
        // The meta id keeps its own colon; only the episode pair is the suffix.
        assert_eq!(split_video_id("tmdb:610253"), ("tmdb:610253", ""));
        assert_eq!(split_video_id("tmdb:1399:1:2"), ("tmdb:1399", ":1:2"));
        assert_eq!(split_video_id("kitsu:12"), ("kitsu:12", ""));
    }

    #[test]
    fn merges_rows_by_what_they_point_at() {
        let row = |url: Option<&str>, hash: Option<&str>| AddonStream {
            addon_name: "A".into(),
            addon_url: "u".into(),
            name: "n".into(),
            title: "t".into(),
            url: url.map(str::to_string),
            external_url: None,
            info_hash: hash.map(str::to_string),
            headers: Vec::new(),
            binge_group: None,
            filename: None,
            video_size: None,
            playable: url.is_some(),
            file_idx: None,
            sources: Vec::new(),
        };
        // The same link from both ids is one row; a different one is not.
        assert_eq!(identity_of(&row(Some("http://x/1"), None)), identity_of(&row(Some("http://x/1"), None)));
        assert_ne!(identity_of(&row(Some("http://x/1"), None)), identity_of(&row(Some("http://x/2"), None)));
        assert_eq!(identity_of(&row(None, Some("abc"))), identity_of(&row(None, Some("abc"))));
    }

    #[test]
    fn reads_torrent_streams() {
        let addon = AddonInfo {
            url: "http://a/manifest.json".into(),
            id: "a".into(),
            name: "A".into(),
            version: String::new(),
            description: String::new(),
            logo: None,
            types: vec![],
            resources: vec![],
            catalogs: vec![],
            builtin: false,
            configure_url: None,
            enabled: true,
            manifest: Value::Null,
        };
        // Peerflix / Torrentio: a bare info hash with a file index and trackers.
        let s = parse_stream(&addon, &serde_json::json!({
            "name": "Peerflix 1080p", "title": "Film", "infoHash": "814978F980297CC7CD42BE9D60B37B928A5E7CDC", "fileIdx": 5,
            "sources": ["tracker:udp://t.example:1337/announce", "dht:814978f980297cc7cd42be9d60b37b928a5e7cdc"]
        })).unwrap();
        assert_eq!(s.info_hash.as_deref(), Some("814978f980297cc7cd42be9d60b37b928a5e7cdc"));
        assert_eq!(s.file_idx, Some(5));
        assert_eq!(s.sources, vec!["udp://t.example:1337/announce".to_string()]);
        assert!(!s.playable && s.url.is_none());
        // A magnet link in `url` counts as the same thing.
        let s = parse_stream(&addon, &serde_json::json!({
            "name": "X", "url": "magnet:?xt=urn:btih:814978f980297cc7cd42be9d60b37b928a5e7cdc&dn=Film&tr=udp%3A%2F%2Ft.example%3A1337%2Fannounce"
        })).unwrap();
        assert_eq!(s.info_hash.as_deref(), Some("814978f980297cc7cd42be9d60b37b928a5e7cdc"));
        assert_eq!(s.sources, vec!["udp://t.example:1337/announce".to_string()]);
        assert!(s.url.is_none() && s.external_url.is_none());
        // Nothing usable at all is dropped.
        assert!(parse_stream(&addon, &serde_json::json!({ "name": "X", "ytId": "abc" })).is_none());
    }
}
