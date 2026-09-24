//! Trakt: sign in with the device-code flow using the user's own API application,
//! import the watchlist (into My list) and the watched history, and optionally send
//! "watched" back as it happens.
//!
//! Everything is kept per profile under `trakt.<userId>`; the client secret and the
//! tokens are DPAPI-protected like the other secrets of the store.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Emitter, Manager, State};
use tauri_plugin_store::StoreExt;

use crate::addons::{LibraryEntry, ResumeEntry};
use crate::AppState;

const API: &str = "https://api.trakt.tv";
const REDIRECT_URI: &str = "urn:ietf:wg:oauth:2.0:oob";
pub const IMPORTED_EVENT: &str = "trakt://imported";
/// Refresh the access token when it has less than this left (Trakt tokens last 24 h).
const REFRESH_MARGIN_SECS: u64 = 2 * 60 * 60;
/// Library entries the import may add at most, so it never pushes out saved titles.
const MAX_LIBRARY: usize = 500;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Stored {
    client_id: String,
    /// Sealed (hex).
    client_secret: String,
    access_token: String,
    refresh_token: String,
    /// Unix seconds.
    expires_at: u64,
    username: String,
    sync_back: bool,
    last_import_ms: u64,
}

impl Stored {
    fn connected(&self) -> bool {
        !self.access_token.is_empty() && !self.refresh_token.is_empty()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraktStatus {
    pub client_id: String,
    pub has_secret: bool,
    pub connected: bool,
    pub username: String,
    pub sync_back: bool,
    pub last_import_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    pub user_code: String,
    pub verification_url: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    /// Titles of the watchlist now in My list.
    pub watchlist: usize,
    /// Films and series marked watched.
    pub watched: usize,
    /// Episodes marked watched.
    pub episodes: usize,
    /// Titles that could not be matched (no IMDb id and not in the library).
    pub unmatched: usize,
    /// Left out because the local list is full.
    pub skipped: usize,
}

/// Device code waiting for the user to approve it on trakt.tv.
struct PendingDevice {
    user_id: String,
    code: String,
    expires: Instant,
}

static PENDING: Mutex<Option<PendingDevice>> = Mutex::new(None);

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent(format!("ejFlix/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("http client")
    })
}

fn key(user_id: &str) -> String {
    format!("trakt.{user_id}")
}

fn load(app: &tauri::AppHandle, user_id: &str) -> Stored {
    app.store(crate::store_path())
        .ok()
        .and_then(|store| store.get(key(user_id)))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn save(app: &tauri::AppHandle, user_id: &str, stored: &Stored) -> Result<(), String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.set(key(user_id), serde_json::to_value(stored).map_err(|e| e.to_string())?);
    crate::save_store(&store)
}

fn seal(text: &str) -> Result<String, String> {
    if text.is_empty() {
        return Ok(String::new());
    }
    Ok(crate::protect::to_hex(&crate::protect::protect(text.as_bytes())?))
}

fn open_sealed(hex: &str) -> String {
    crate::protect::from_hex(hex)
        .and_then(|bytes| crate::protect::unprotect(&bytes))
        .ok()
        .and_then(|raw| String::from_utf8(raw).ok())
        .unwrap_or_default()
}

fn now_secs() -> u64 {
    crate::addons::now_ms() / 1000
}

fn status_of(stored: &Stored) -> TraktStatus {
    TraktStatus {
        client_id: stored.client_id.clone(),
        has_secret: !stored.client_secret.is_empty(),
        connected: stored.connected(),
        username: stored.username.clone(),
        sync_back: stored.sync_back,
        last_import_ms: stored.last_import_ms,
    }
}

async fn user_id(app: &tauri::AppHandle, state: &AppState) -> Result<String, String> {
    crate::settings_user(app, state)
        .await
        .ok_or_else(|| crate::errors::code("noSession"))
}

fn request(method: reqwest::Method, path: &str, client_id: &str) -> reqwest::RequestBuilder {
    http()
        .request(method, format!("{API}{path}"))
        .header("Content-Type", "application/json")
        .header("trakt-api-version", "2")
        .header("trakt-api-key", client_id)
}

fn net(err: reqwest::Error) -> String {
    crate::errors::detail("network", err)
}

/// Stores the tokens of a `/oauth/device/token` or `/oauth/token` answer.
fn apply_tokens(stored: &mut Stored, value: &Value) -> Result<(), String> {
    let access = value.get("access_token").and_then(|v| v.as_str()).unwrap_or_default();
    let refresh = value.get("refresh_token").and_then(|v| v.as_str()).unwrap_or_default();
    if access.is_empty() || refresh.is_empty() {
        return Err("trakt_bad_response".into());
    }
    let created = value.get("created_at").and_then(|v| v.as_u64()).unwrap_or_else(now_secs);
    let expires_in = value.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(86_400);
    stored.access_token = seal(access)?;
    stored.refresh_token = seal(refresh)?;
    stored.expires_at = created + expires_in;
    Ok(())
}

/// A valid access token, refreshed first when it is about to expire. A refresh the
/// server refuses signs the profile out of Trakt.
async fn access_token(app: &tauri::AppHandle, user_id: &str, force: bool) -> Result<(Stored, String), String> {
    // One refresh at a time: Trakt rotates the refresh token, so a second refresh with
    // the same one (several titles marked watched at once) is refused and signs out.
    static REFRESH: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let seen = load(app, user_id).access_token;
    let _guard = REFRESH.lock().await;
    let mut stored = load(app, user_id);
    if !stored.connected() {
        return Err("trakt_not_connected".into());
    }
    // A forced refresh is moot when another caller refreshed while this one waited.
    if (!force || stored.access_token != seen) && stored.expires_at > now_secs() + REFRESH_MARGIN_SECS {
        let token = open_sealed(&stored.access_token);
        if !token.is_empty() {
            return Ok((stored, token));
        }
    }
    let body = json!({
        "refresh_token": open_sealed(&stored.refresh_token),
        "client_id": stored.client_id,
        "client_secret": open_sealed(&stored.client_secret),
        "redirect_uri": REDIRECT_URI,
        "grant_type": "refresh_token",
    });
    let res = request(reqwest::Method::POST, "/oauth/token", &stored.client_id)
        .json(&body)
        .send()
        .await
        .map_err(net)?;
    if res.status().as_u16() == 400 || res.status().as_u16() == 401 {
        stored.access_token.clear();
        stored.refresh_token.clear();
        save(app, user_id, &stored)?;
        return Err("trakt_expired".into());
    }
    if !res.status().is_success() {
        return Err(crate::errors::detail("traktStatus", res.status().as_u16()));
    }
    let value: Value = res.json().await.map_err(|_| "trakt_bad_response".to_string())?;
    // Only the tokens go back: settings may have changed while the request was out.
    let mut stored = load(app, user_id);
    apply_tokens(&mut stored, &value)?;
    save(app, user_id, &stored)?;
    let token = open_sealed(&stored.access_token);
    Ok((stored, token))
}

/// Signed-in call to the API; a 401 refreshes the token once and retries.
async fn call(
    app: &tauri::AppHandle,
    user_id: &str,
    method: reqwest::Method,
    path: &str,
    body: Option<&Value>,
) -> Result<Value, String> {
    let mut force = false;
    loop {
        let (stored, token) = access_token(app, user_id, force).await?;
        let mut req = request(method.clone(), path, &stored.client_id).bearer_auth(token);
        if let Some(body) = body {
            req = req.json(body);
        }
        let res = req.send().await.map_err(net)?;
        if res.status().as_u16() == 401 && !force {
            force = true;
            continue;
        }
        if !res.status().is_success() {
            return Err(crate::errors::detail("traktStatus", res.status().as_u16()));
        }
        return Ok(res.json().await.unwrap_or(Value::Null));
    }
}

#[tauri::command]
pub async fn trakt_status(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<TraktStatus, String> {
    let uid = user_id(&app, &state).await?;
    Ok(status_of(&load(&app, &uid)))
}

/// Saves the API application (Client ID and Secret). A different application drops the
/// current sign-in, whose tokens belong to the old one. An empty secret keeps the saved one.
#[tauri::command]
pub async fn trakt_set_app(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    client_id: String,
    client_secret: String,
) -> Result<TraktStatus, String> {
    let uid = user_id(&app, &state).await?;
    let client_id = client_id.trim().to_string();
    let client_secret = client_secret.trim().to_string();
    let valid = |s: &str| s.len() <= 128 && s.bytes().all(|b| b.is_ascii_alphanumeric());
    if client_id.is_empty() || !valid(&client_id) || !valid(&client_secret) {
        return Err("trakt_bad_app".into());
    }
    let mut stored = load(&app, &uid);
    if stored.client_id != client_id {
        stored.access_token.clear();
        stored.refresh_token.clear();
        stored.username.clear();
    }
    stored.client_id = client_id;
    if !client_secret.is_empty() {
        stored.client_secret = seal(&client_secret)?;
    }
    if stored.client_secret.is_empty() {
        return Err("trakt_bad_app".into());
    }
    save(&app, &uid, &stored)?;
    Ok(status_of(&stored))
}

/// Starts the device sign-in: the code the user types at the verification page.
#[tauri::command]
pub async fn trakt_device_start(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<DeviceCode, String> {
    let uid = user_id(&app, &state).await?;
    let stored = load(&app, &uid);
    if stored.client_id.is_empty() || stored.client_secret.is_empty() {
        return Err("trakt_bad_app".into());
    }
    let res = request(reqwest::Method::POST, "/oauth/device/code", &stored.client_id)
        .json(&json!({ "client_id": stored.client_id }))
        .send()
        .await
        .map_err(net)?;
    if res.status().as_u16() == 401 || res.status().as_u16() == 403 {
        return Err("trakt_bad_app".into());
    }
    if !res.status().is_success() {
        return Err(crate::errors::detail("traktStatus", res.status().as_u16()));
    }
    let value: Value = res.json().await.map_err(|_| "trakt_bad_response".to_string())?;
    let text = |k: &str| value.get(k).and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let code = text("device_code");
    let user_code = text("user_code");
    if code.is_empty() || user_code.is_empty() {
        return Err("trakt_bad_response".into());
    }
    let expires_in = value.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(600);
    let interval = value.get("interval").and_then(|v| v.as_u64()).unwrap_or(5).max(1);
    if let Ok(mut pending) = PENDING.lock() {
        *pending = Some(PendingDevice {
            user_id: uid,
            code,
            expires: Instant::now() + Duration::from_secs(expires_in),
        });
    }
    let verification_url = Some(text("verification_url"))
        .filter(|u| u.starts_with("https://"))
        .unwrap_or_else(|| "https://trakt.tv/activate".to_string());
    Ok(DeviceCode {
        user_code,
        verification_url,
        expires_in,
        interval,
    })
}

/// One poll of the device sign-in: "pending", "slow_down", "connected", or "expired" /
/// "denied" / "invalid" when it is over.
#[tauri::command]
pub async fn trakt_device_poll(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let uid = user_id(&app, &state).await?;
    let code = {
        let pending = PENDING.lock().map_err(|_| "invalid".to_string())?;
        match pending.as_ref() {
            Some(p) if p.user_id == uid && Instant::now() < p.expires => p.code.clone(),
            Some(p) if p.user_id == uid => return Ok("expired".into()),
            _ => return Ok("invalid".into()),
        }
    };
    let mut stored = load(&app, &uid);
    let body = json!({
        "code": code,
        "client_id": stored.client_id,
        "client_secret": open_sealed(&stored.client_secret),
    });
    let res = request(reqwest::Method::POST, "/oauth/device/token", &stored.client_id)
        .json(&body)
        .send()
        .await
        .map_err(net)?;
    let outcome = match res.status().as_u16() {
        200 => "connected",
        400 => return Ok("pending".into()),
        429 => return Ok("slow_down".into()),
        410 => "expired",
        418 => "denied",
        _ => "invalid",
    };
    if outcome == "connected" {
        let value: Value = res.json().await.map_err(|_| "trakt_bad_response".to_string())?;
        apply_tokens(&mut stored, &value)?;
        save(&app, &uid, &stored)?;
        if let Ok(me) = call(&app, &uid, reqwest::Method::GET, "/users/settings", None).await {
            let mut stored = load(&app, &uid);
            stored.username = me
                .pointer("/user/username")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            save(&app, &uid, &stored)?;
        }
    }
    if let Ok(mut pending) = PENDING.lock() {
        *pending = None;
    }
    Ok(outcome.into())
}

/// Revokes the token on Trakt (best effort) and forgets it. The API application stays.
#[tauri::command]
pub async fn trakt_disconnect(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<TraktStatus, String> {
    let uid = user_id(&app, &state).await?;
    let mut stored = load(&app, &uid);
    if stored.connected() {
        let body = json!({
            "token": open_sealed(&stored.access_token),
            "client_id": stored.client_id,
            "client_secret": open_sealed(&stored.client_secret),
        });
        let _ = request(reqwest::Method::POST, "/oauth/revoke", &stored.client_id)
            .json(&body)
            .send()
            .await;
    }
    stored.access_token.clear();
    stored.refresh_token.clear();
    stored.expires_at = 0;
    stored.username.clear();
    save(&app, &uid, &stored)?;
    Ok(status_of(&stored))
}

#[tauri::command]
pub async fn trakt_set_sync_back(app: tauri::AppHandle, state: State<'_, AppState>, on: bool) -> Result<TraktStatus, String> {
    let uid = user_id(&app, &state).await?;
    let mut stored = load(&app, &uid);
    stored.sync_back = on;
    save(&app, &uid, &stored)?;
    Ok(status_of(&stored))
}

/// Opens a trakt.tv page (the applications page, the activation page).
#[tauri::command]
pub fn trakt_open(url: String) -> Result<(), String> {
    if !url.starts_with("https://trakt.tv/") || url.chars().any(|c| c.is_control() || c == '"' || c.is_whitespace()) {
        return Err(crate::errors::code("linkNotAllowed"));
    }
    std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ---- import ----

/// Trakt ids of a movie or show.
#[derive(Debug, Clone, Default)]
struct Ids {
    imdb: Option<String>,
    tmdb: Option<String>,
    tvdb: Option<String>,
}

fn ids_of(media: &Value) -> Ids {
    let ids = media.get("ids");
    let field = |k: &str| -> Option<String> {
        match ids?.get(k)? {
            Value::String(s) if !s.is_empty() => Some(s.clone()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        }
    };
    Ids {
        imdb: field("imdb").filter(|s| s.starts_with("tt")),
        tmdb: field("tmdb"),
        tvdb: field("tvdb"),
    }
}

/// Library lookup by "imdb:tt…", "tmdb:123" or "tvdb:123", split by kind.
struct Index {
    items: HashMap<String, crate::jellyfin::ProviderItem>,
}

impl Index {
    fn build(list: Vec<crate::jellyfin::ProviderItem>) -> Self {
        let mut items = HashMap::new();
        for item in list {
            for (provider, value) in &item.provider_ids {
                let provider = provider.to_ascii_lowercase();
                if ["imdb", "tmdb", "tvdb"].contains(&provider.as_str()) {
                    items.insert(format!("{}:{provider}:{value}", item.kind), item.clone());
                }
            }
        }
        Self { items }
    }

    fn find(&self, kind: &str, ids: &Ids) -> Option<&crate::jellyfin::ProviderItem> {
        [("imdb", &ids.imdb), ("tmdb", &ids.tmdb), ("tvdb", &ids.tvdb)]
            .into_iter()
            .find_map(|(provider, value)| self.items.get(&format!("{kind}:{provider}:{}", value.as_ref()?)))
    }
}

/// Unix milliseconds of an ISO-8601 UTC timestamp ("2024-05-01T20:15:00.000Z").
fn iso_ms(text: &str) -> Option<u64> {
    let num = |range: std::ops::Range<usize>| text.get(range)?.parse::<i64>().ok();
    let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hh, mm, ss) = (num(11..13).unwrap_or(0), num(14..16).unwrap_or(0), num(17..19).unwrap_or(0));
    // Days from the civil date (Howard Hinnant's algorithm).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let secs = days * 86_400 + hh * 3600 + mm * 60 + ss;
    u64::try_from(secs).ok().map(|s| s * 1000)
}

fn online_entry(kind: &str, imdb: &str, media: &Value) -> LibraryEntry {
    let art = |what: &str| Some(format!("https://images.metahub.space/{what}/medium/{imdb}/img"));
    LibraryEntry {
        key: imdb.to_string(),
        kind: kind.to_string(),
        meta_id: imdb.to_string(),
        name: media.get("title").and_then(|v| v.as_str()).unwrap_or(imdb).to_string(),
        year: media.get("year").and_then(|v| v.as_i64()).map(|y| y as i32),
        poster: art("poster"),
        background: art("background"),
        logo: art("logo"),
        imdb: Some(imdb.to_string()),
        ..LibraryEntry::default()
    }
}

/// Online titles to flag, merged into the local list without dropping what it holds.
struct OnlineChanges {
    list: Vec<LibraryEntry>,
    positions: HashMap<String, usize>,
    room: usize,
    skipped: usize,
    /// Every flag asked for, replayed onto the list as it is when the import saves.
    log: Vec<(LibraryEntry, bool, bool, u64)>,
}

impl OnlineChanges {
    fn new(list: Vec<LibraryEntry>) -> Self {
        let positions = list.iter().enumerate().map(|(i, e)| (e.key.clone(), i)).collect();
        let room = MAX_LIBRARY.saturating_sub(list.len());
        Self { list, positions, room, skipped: 0, log: Vec::new() }
    }

    /// The flags applied to `current` (the list read again at save time, so changes
    /// made while the import ran are kept). Returns it and how many found no room.
    fn replay(self, current: Vec<LibraryEntry>) -> (Vec<LibraryEntry>, usize) {
        let mut fresh = OnlineChanges::new(current);
        for (entry, saved, watched, at_ms) in self.log {
            fresh.flag(entry, saved, watched, at_ms);
        }
        (fresh.list, fresh.skipped)
    }

    /// False when the list had no room left for it.
    fn flag(&mut self, mut entry: LibraryEntry, saved: bool, watched: bool, at_ms: u64) -> bool {
        self.log.push((entry.clone(), saved, watched, at_ms));
        if let Some(&i) = self.positions.get(&entry.key) {
            let current = &mut self.list[i];
            current.saved |= saved;
            current.watched |= watched;
            return true;
        }
        if self.room == 0 {
            self.skipped += 1;
            return false;
        }
        entry.saved = saved;
        entry.watched = watched;
        entry.updated_ms = at_ms;
        self.positions.insert(entry.key.clone(), self.list.len());
        self.list.push(entry);
        self.room -= 1;
        true
    }
}

async fn fetch_list(app: &tauri::AppHandle, uid: &str, path: &str) -> Result<Vec<Value>, String> {
    let value = call(app, uid, reqwest::Method::GET, path, None).await?;
    Ok(value.as_array().cloned().unwrap_or_default())
}

/// Watchlist → My list and watched history → watched. Titles of the Jellyfin library
/// (matched by IMDb / TMDB / TVDB id) are flagged on the server; the rest are kept in
/// the local list of online titles, keyed by IMDb id like everything the addons play.
#[tauri::command]
pub async fn trakt_import(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<ImportReport, String> {
    let uid = user_id(&app, &state).await?;
    let watchlist_movies = fetch_list(&app, &uid, "/sync/watchlist/movies").await?;
    let watchlist_shows = fetch_list(&app, &uid, "/sync/watchlist/shows").await?;
    let watched_movies = fetch_list(&app, &uid, "/sync/watched/movies").await?;
    let watched_shows = fetch_list(&app, &uid, "/sync/watched/shows").await?;

    let jellyfin = &state.jellyfin;
    let index = match jellyfin.session().await {
        Some(_) => Some(Index::build(jellyfin.provider_index().await?)),
        None => None,
    };
    let mut online = OnlineChanges::new(crate::addons::load_library(&app, &uid));
    let mut report = ImportReport::default();
    let now = crate::addons::now_ms();

    // Watchlist.
    for (row, key, kind, jf_kind) in watchlist_movies
        .iter()
        .map(|r| (r, "movie", "movie", "Movie"))
        .chain(watchlist_shows.iter().map(|r| (r, "show", "series", "Series")))
    {
        let Some(media) = row.get(key) else { continue };
        let ids = ids_of(media);
        if let Some(item) = index.as_ref().and_then(|i| i.find(jf_kind, &ids)) {
            if item.favorite || jellyfin.set_favorite(&item.id, true).await.is_ok() {
                report.watchlist += 1;
            }
            continue;
        }
        let Some(imdb) = ids.imdb.as_deref() else {
            report.unmatched += 1;
            continue;
        };
        let at = row.get("listed_at").and_then(|v| v.as_str()).and_then(iso_ms).unwrap_or(now);
        if online.flag(online_entry(kind, imdb, media), true, false, at) {
            report.watchlist += 1;
        }
    }

    // Watched films.
    for row in &watched_movies {
        let Some(media) = row.get("movie") else { continue };
        let ids = ids_of(media);
        if let Some(item) = index.as_ref().and_then(|i| i.find("Movie", &ids)) {
            if item.played || jellyfin.set_played(&item.id, true).await.is_ok() {
                report.watched += 1;
            }
            continue;
        }
        let Some(imdb) = ids.imdb.as_deref() else {
            report.unmatched += 1;
            continue;
        };
        let at = row.get("last_watched_at").and_then(|v| v.as_str()).and_then(iso_ms).unwrap_or(now);
        if online.flag(online_entry("movie", imdb, media), false, true, at) {
            report.watched += 1;
        }
    }

    // Watched episodes, per show.
    for row in &watched_shows {
        let Some(media) = row.get("show") else { continue };
        let ids = ids_of(media);
        let episodes: Vec<(i32, i32, u64)> = row
            .get("seasons")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
            .flat_map(|season| {
                let number = season.get("number").and_then(|v| v.as_i64()).unwrap_or(-1) as i32;
                season
                    .get("episodes")
                    .and_then(|v| v.as_array())
                    .into_iter()
                    .flatten()
                    .filter_map(move |ep| {
                        let episode = ep.get("number")?.as_i64()? as i32;
                        let at = ep.get("last_watched_at").and_then(|v| v.as_str()).and_then(iso_ms).unwrap_or(0);
                        Some((number, episode, at))
                    })
            })
            .filter(|(season, _, _)| *season >= 0)
            .collect();
        if let Some(item) = index.as_ref().and_then(|i| i.find("Series", &ids)) {
            let library = jellyfin.episode_index(&item.id).await.unwrap_or_default();
            for (season, episode, _) in &episodes {
                if let Some((id, _, _, played)) = library.iter().find(|(_, s, e, _)| s == season && e == episode) {
                    if *played || jellyfin.set_played(id, true).await.is_ok() {
                        report.episodes += 1;
                    }
                }
            }
            report.watched += 1;
            continue;
        }
        let Some(imdb) = ids.imdb.as_deref() else {
            report.unmatched += 1;
            continue;
        };
        let show = online_entry("series", imdb, media);
        // Newest first, so a full list keeps the recent ones.
        let mut episodes = episodes;
        episodes.sort_by(|a, b| b.2.cmp(&a.2));
        for (season, episode, at) in episodes {
            let entry = LibraryEntry {
                key: format!("{imdb}:{season}:{episode}"),
                series_name: Some(show.name.clone()),
                season: Some(season),
                episode: Some(episode),
                ..show.clone()
            };
            if online.flag(entry, false, true, if at > 0 { at } else { now }) {
                report.episodes += 1;
            }
        }
        report.watched += 1;
    }

    // Read, merge and write with no await in between, like every other library write.
    let (list, skipped) = online.replay(crate::addons::load_library(&app, &uid));
    report.skipped = skipped;
    crate::addons::replace_library(&app, &uid, list)?;
    let mut stored = load(&app, &uid);
    stored.last_import_ms = now;
    save(&app, &uid, &stored)?;
    let _ = app.emit(IMPORTED_EVENT, &report);
    Ok(report)
}

// ---- sending "watched" back ----

fn ids_json(ids: &Ids) -> Value {
    let mut out = serde_json::Map::new();
    if let Some(imdb) = &ids.imdb {
        out.insert("imdb".into(), json!(imdb));
    }
    for (k, v) in [("tmdb", &ids.tmdb), ("tvdb", &ids.tvdb)] {
        if let Some(n) = v.as_ref().and_then(|v| v.parse::<u64>().ok()) {
            out.insert(k.into(), json!(n));
        }
    }
    Value::Object(out)
}

fn provider_ids(map: &std::collections::BTreeMap<String, String>) -> Ids {
    let get = |k: &str| {
        map.iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(k))
            .map(|(_, v)| v.clone())
            .filter(|v| !v.is_empty())
    };
    Ids {
        imdb: get("Imdb").filter(|s| s.starts_with("tt")),
        tmdb: get("Tmdb"),
        tvdb: get("Tvdb"),
    }
}

/// Body of `/sync/history` for a film, a whole show, a season or one episode.
fn history_body(kind: &str, ids: &Ids, season: Option<i32>, episode: Option<i32>) -> Option<Value> {
    if ids.imdb.is_none() && ids.tmdb.is_none() && ids.tvdb.is_none() {
        return None;
    }
    let ids = ids_json(ids);
    Some(match (kind, season, episode) {
        ("movie", _, _) => json!({ "movies": [{ "ids": ids }] }),
        (_, Some(s), Some(e)) => json!({ "shows": [{ "ids": ids, "seasons": [{ "number": s, "episodes": [{ "number": e }] }] }] }),
        (_, Some(s), None) => json!({ "shows": [{ "ids": ids, "seasons": [{ "number": s }] }] }),
        _ => json!({ "shows": [{ "ids": ids }] }),
    })
}

/// Sends the body to the history of the active profile when it syncs back.
async fn push_history(app: &tauri::AppHandle, uid: &str, body: Value, watched: bool) {
    let stored = load(app, uid);
    if !stored.connected() || !stored.sync_back {
        return;
    }
    let path = if watched { "/sync/history" } else { "/sync/history/remove" };
    if let Err(err) = call(app, uid, reqwest::Method::POST, path, Some(&body)).await {
        eprintln!("trakt history: {err}");
    }
}

async fn sync_back_user(app: &tauri::AppHandle) -> Option<String> {
    let state = app.state::<AppState>();
    let uid = crate::settings_user(app, &state).await?;
    let stored = load(app, &uid);
    (stored.connected() && stored.sync_back).then_some(uid)
}

/// A Jellyfin item was marked (un)watched or played to the end.
pub fn spawn_jellyfin_history(app: &tauri::AppHandle, item_id: &str, watched: bool) {
    let app = app.clone();
    let item_id = item_id.to_string();
    tauri::async_runtime::spawn(async move {
        let Some(uid) = sync_back_user(&app).await else { return };
        let state = app.state::<AppState>();
        let Ok(item) = state.jellyfin.get_item(&item_id).await else { return };
        let body = match item.kind.as_str() {
            "Movie" => history_body("movie", &provider_ids(&item.provider_ids), None, None),
            "Series" => history_body("series", &provider_ids(&item.provider_ids), None, None),
            "Season" | "Episode" => {
                let Some(series_id) = item.series_id.as_deref() else { return };
                let Ok(series) = state.jellyfin.get_item(series_id).await else { return };
                let episode = if item.kind == "Episode" { item.episode_number } else { None };
                history_body("series", &provider_ids(&series.provider_ids), item.season_number, episode)
            }
            _ => None,
        };
        if let Some(body) = body {
            push_history(&app, &uid, body, watched).await;
        }
    });
}

fn spawn_online(app: &tauri::AppHandle, kind: String, imdb: Option<String>, season: Option<i32>, episode: Option<i32>, watched: bool) {
    let Some(imdb) = imdb.filter(|s| s.starts_with("tt")) else { return };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(uid) = sync_back_user(&app).await else { return };
        let ids = Ids { imdb: Some(imdb), ..Ids::default() };
        if let Some(body) = history_body(&kind, &ids, season, episode) {
            push_history(&app, &uid, body, watched).await;
        }
    });
}

/// An online title was ticked (or unticked) as watched.
pub fn spawn_entry_history(app: &tauri::AppHandle, entry: &LibraryEntry, watched: bool) {
    let imdb = entry.imdb.clone().or_else(|| Some(entry.meta_id.clone()));
    spawn_online(app, entry.kind.clone(), imdb, entry.season, entry.episode, watched);
}

/// An online title was played to the end.
pub fn spawn_resume_history(app: &tauri::AppHandle, entry: &ResumeEntry) {
    let imdb = entry.imdb.clone().or_else(|| Some(entry.meta_id.clone()));
    spawn_online(app, entry.kind.clone(), imdb, entry.season, entry.episode, true);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_iso_dates() {
        assert_eq!(iso_ms("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(iso_ms("2024-03-01T12:30:15.000Z"), Some(1_709_296_215_000));
        assert_eq!(iso_ms("bad"), None);
    }

    #[test]
    fn builds_history_bodies() {
        let ids = Ids { imdb: Some("tt0944947".into()), tmdb: Some("1399".into()), tvdb: None };
        let body = history_body("series", &ids, Some(1), Some(2)).unwrap();
        assert_eq!(body["shows"][0]["ids"]["tmdb"], json!(1399));
        assert_eq!(body["shows"][0]["seasons"][0]["episodes"][0]["number"], json!(2));
        assert!(history_body("movie", &Ids::default(), None, None).is_none());
    }
}
