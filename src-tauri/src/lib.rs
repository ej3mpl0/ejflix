mod account;
mod addons;
mod discord;
mod downloads;
mod errors;
mod inflate;
mod iptv;
mod jellyfin;
mod opensubs;
mod lists;
mod player;
mod profiles;
mod protect;
mod segments;
mod settings;
mod torrent;
mod update;
mod parental;
mod trakt;
mod party;

use std::sync::Arc;
use std::time::Duration;

use jellyfin::{
    BrowseArgs, HomeData, JellyfinClient, Library, Movie, PublicInfo, PublicUser, SavedServer,
    Session,
};
use profiles::{LocalProfile, LocalProfileView, ProfilePatch};
use addons::{AddonClient, AddonInfo, AddonMeta, AddonMetaFull, AddonStream, ResumeEntry};
use iptv::{ChannelPage, ChannelQuery, EpgNow, GroupInfo, IptvSourceInput, IptvSourceView, IptvState, Programme, XtreamAccount};
use player::{PlaybackContext, PlaybackPrefs, PlaybackSource, Player, PlayerState};
use segments::{MediaSegment, SegmentsCache};
use serde::Deserialize;
use settings::Settings;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;
use uuid::Uuid;

/// Store file with everything the app remembers. `EJFLIX_DATA_DIR` points it at another
/// folder (a throwaway profile for tests and screenshots) instead of the app data dir.
pub fn store_path() -> std::path::PathBuf {
    match std::env::var("EJFLIX_DATA_DIR") {
        Ok(dir) if !dir.trim().is_empty() => std::path::PathBuf::from(dir).join("session.json"),
        _ => std::path::PathBuf::from("session.json"),
    }
}

/// Guards `session.json` against a torn write (saves are atomic now, see `save_store`, so
/// this is the second line of defence: when the plugin cannot parse the file it starts
/// empty and the next save would put that over everything). Runs
/// before anything opens the store: a file that reads is copied to `session.json.bak`;
/// one that does not is set aside as `session.json.corrupt` and the backup put back.
fn protect_store_file(app: &tauri::AppHandle) {
    let Ok(path) = app.path().resolve(store_path(), tauri::path::BaseDirectory::AppData) else {
        return;
    };
    let with_suffix = |suffix: &str| {
        let mut name = path.clone().into_os_string();
        name.push(suffix);
        std::path::PathBuf::from(name)
    };
    let (backup, corrupt) = (with_suffix(".bak"), with_suffix(".corrupt"));
    let reads = |file: &std::path::Path| {
        std::fs::read(file)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Map<String, serde_json::Value>>(&bytes).ok())
            .is_some()
    };
    if !path.exists() {
        return;
    }
    if reads(&path) {
        // Copy then rename, so the backup itself is never half written.
        let tmp = with_suffix(".bak.tmp");
        if std::fs::copy(&path, &tmp).is_ok() {
            let _ = std::fs::rename(&tmp, &backup);
        }
        return;
    }
    let _ = std::fs::rename(&path, &corrupt);
    if reads(&backup) {
        let _ = std::fs::copy(&backup, &path);
    }
}

/// Absolute path of `session.json`, resolved once in setup for `save_store`.
static STORE_FILE: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();
/// Serializes snapshot + write, so two saves never interleave on the temp file and a
/// later snapshot can never be overwritten by an earlier one.
static STORE_WRITE: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Serializer given to the store plugin itself. The plugin writes with a plain in-place
/// `fs::write` (a crash mid-write tears the file) and also saves every store on exit, so
/// it is refused here: nothing reaches disk except through `save_store`.
fn refuse_plugin_save(
    _: &std::collections::HashMap<String, serde_json::Value>,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    Err("session.json is saved through crate::save_store".into())
}

/// Opens the one store instance the whole app shares. The plugin caches stores by path,
/// so building it here first (with auto-save off and plugin saves refused) makes every
/// later `app.store(store_path())` return this same instance.
fn open_store(app: &tauri::AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .resolve(store_path(), tauri::path::BaseDirectory::AppData)
        .map_err(|e| e.to_string())?;
    let _ = STORE_FILE.set(path);
    tauri_plugin_store::StoreBuilder::new(app, store_path())
        .disable_auto_save()
        .serialize(refuse_plugin_save)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Writes the store to `session.json` atomically: the entries go to `session.json.tmp`,
/// which is flushed to disk and then renamed over the real file (on Windows `rename`
/// replaces the target in one step), so a crash leaves either the old or the new file,
/// never a torn one. Every save in the app goes through here.
pub fn save_store<R: tauri::Runtime>(store: &tauri_plugin_store::Store<R>) -> Result<(), String> {
    use std::io::Write;
    let path = STORE_FILE.get().ok_or("store not opened")?;
    let _guard = STORE_WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let entries: serde_json::Map<String, serde_json::Value> = store.entries().into_iter().collect();
    let bytes = serde_json::to_vec_pretty(&entries).map_err(|e| e.to_string())?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut tmp_name = path.clone().into_os_string();
    tmp_name.push(".tmp");
    let tmp = std::path::PathBuf::from(tmp_name);
    {
        let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    // An antivirus or indexer briefly holding the file makes the replace fail with
    // "access denied"; a couple of short retries ride that out.
    let mut attempt = 0;
    loop {
        match std::fs::rename(&tmp, path) {
            Ok(()) => return Ok(()),
            Err(_) if attempt < 3 => {
                attempt += 1;
                std::thread::sleep(std::time::Duration::from_millis(40));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

pub struct AppState {
    pub jellyfin: JellyfinClient,
    pub player: Arc<Player>,
    /// Serializes the read-modify-write of `settings_set` (both windows may write).
    pub settings_lock: tokio::sync::Mutex<()>,
    pub segments: Arc<SegmentsCache>,
    pub addons: Arc<AddonClient>,
    /// Active local ("online") profile; a Jellyfin session may be linked to it.
    pub local: tokio::sync::RwLock<Option<LocalProfile>>,
    pub discord: Arc<discord::Discord>,
    pub updater: Arc<update::Updater>,
    pub iptv: Arc<IptvState>,
    /// Online sources saved to disk.
    pub downloads: Arc<downloads::Downloads>,
    /// ejFlix account of the active profile (sign-in, 2FA, sync).
    pub account: account::AccountState,
    /// Built-in BitTorrent engine for addon sources that come as a bare info hash.
    pub torrents: Arc<torrent::TorrentEngine>,
}

impl AppState {
    fn new() -> Self {
        Self {
            updater: Arc::new(update::Updater::new(env!("CARGO_PKG_VERSION").to_string())),
            jellyfin: JellyfinClient::new(),
            player: Arc::new(Player::new()),
            settings_lock: tokio::sync::Mutex::new(()),
            segments: Arc::new(SegmentsCache::new()),
            addons: Arc::new(AddonClient::new()),
            local: tokio::sync::RwLock::new(None),
            discord: discord::Discord::new(),
            iptv: Arc::new(IptvState::new()),
            downloads: Arc::new(downloads::Downloads::new()),
            account: account::AccountState::new(),
            torrents: Arc::new(torrent::TorrentEngine::new()),
        }
    }
}

/// Recomputes the Discord activity from what is playing and the profile's preferences.
async fn refresh_presence(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let prefs = match settings_user(app, &state).await {
        Some(uid) => settings::load(app, &uid).unwrap_or_default().discord,
        None => Settings::default().discord,
    };
    if !prefs.enabled {
        state.discord.set(&prefs.client_id, None).await;
        return;
    }
    let ctx = state.player.context.read().await.clone();
    let Some(ctx) = ctx else {
        state.discord.set(&prefs.client_id, None).await;
        return;
    };
    let snap = state.player.snapshot().await;
    if snap.paused && !prefs.show_paused {
        state.discord.set(&prefs.client_id, None).await;
        return;
    }
    let locale = load_locale(app).unwrap_or_default();
    let mut info = ctx.presence.clone();
    if let PlaybackSource::Live { channel_id } = &ctx.source {
        // The programme changes while the channel plays: refresh it from the guide.
        let now = addons::now_ms() / 1000;
        let epg = state.iptv.epg_now(std::slice::from_ref(channel_id), now).await;
        match epg.get(channel_id).and_then(|e| e.now.as_ref()) {
            Some(programme) => {
                info.episode = Some(programme.title.clone());
                info.live_window = Some((programme.start, programme.stop));
            }
            None => {
                info.episode = None;
                info.live_window = None;
            }
        }
    }
    let info = &info;
    let details = discord::clamp_text(discord::fill_template(&prefs.details, info, &locale));
    let mut state_text = discord::fill_template(&prefs.state, info, &locale);
    if snap.paused {
        let paused = if locale == "en" { "Paused" } else { "Pausado" };
        state_text = if state_text.trim().is_empty() {
            paused.to_string()
        } else {
            format!("{} · {paused}", state_text.trim())
        };
    }
    let state_text = discord::clamp_text(state_text);
    let timestamps = if prefs.show_time && !snap.paused && snap.duration > 0.0 {
        let now = discord::now_secs();
        let start = now.saturating_sub(snap.time.max(0.0) as u64);
        let end = now + (snap.duration - snap.time).max(0.0) as u64;
        Some((start, Some(end)))
    } else if prefs.show_time && !snap.paused {
        // Live TV: the programme's own time window when the guide knows it.
        info.live_window.map(|(start, stop)| (start, Some(stop)))
    } else {
        None
    };
    let large_image = if prefs.show_poster {
        info.poster_url
            .clone()
            .filter(|u| u.starts_with("https://") || u.starts_with("http://"))
    } else {
        None
    };
    let activity = discord::Activity {
        details,
        state: state_text,
        timestamps,
        large_image,
        large_text: info.title.chars().take(128).collect(),
        status_display: match prefs.header.as_str() {
            "name" => 0,
            "state" => 1,
            _ => 2,
        },
    };
    state.discord.set(&prefs.client_id, Some(activity)).await;
}

#[tauri::command]
async fn discord_status(state: State<'_, AppState>) -> Result<discord::Status, String> {
    Ok(state.discord.status().await)
}

/// Presence description of a Jellyfin item (poster through the server, not the local proxy).
fn presence_for_item(session: &Session, movie: &Movie, server_name: Option<String>) -> discord::PresenceInfo {
    let is_episode = movie.kind == "Episode";
    let poster_item = if is_episode {
        movie.series_id.clone().unwrap_or_else(|| movie.id.clone())
    } else {
        movie.id.clone()
    };
    let episode = if is_episode {
        let code = match (movie.season_number, movie.episode_number) {
            (Some(s), Some(e)) => format!("S{s}:E{e}"),
            (_, Some(e)) => format!("E{e}"),
            _ => String::new(),
        };
        Some([code, movie.name.clone()].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" · "))
    } else {
        None
    };
    discord::PresenceInfo {
        title: if is_episode {
            movie.series_name.clone().unwrap_or_else(|| movie.name.clone())
        } else {
            movie.name.clone()
        },
        episode,
        year: movie.year,
        kind: if is_episode || movie.kind == "Series" { "series".into() } else { "movie".into() },
        poster_url: Some(format!(
            "{}/Items/{poster_item}/Images/Primary?maxHeight=512&quality=80",
            session.server_url
        )),
        source: server_name.unwrap_or_else(|| "Jellyfin".to_string()),
        live_window: None,
    }
}

fn presence_for_entry(entry: &ResumeEntry) -> discord::PresenceInfo {
    let is_episode = entry.kind == "series" && entry.season.is_some();
    let episode = if is_episode {
        let code = match (entry.season, entry.episode) {
            (Some(s), Some(e)) => format!("S{s}:E{e}"),
            _ => String::new(),
        };
        Some([code, entry.name.clone()].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" · "))
    } else {
        None
    };
    discord::PresenceInfo {
        title: if is_episode {
            entry.series_name.clone().unwrap_or_else(|| entry.name.clone())
        } else {
            entry.name.clone()
        },
        episode,
        year: None,
        kind: if entry.kind == "series" { "series".into() } else { "movie".into() },
        poster_url: entry.poster.clone(),
        source: "Online".into(),
        live_window: None,
    }
}

/// Who is using the app: a Jellyfin user, or a local profile (with or without a linked
/// Jellyfin account). `server_url` is `None` when there is no server at all.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    /// "jellyfin" | "local"
    pub mode: &'static str,
    pub user_id: String,
    pub user_name: String,
    pub avatar_url: Option<String>,
    pub device_id: String,
    pub server_url: Option<String>,
    pub server_name: Option<String>,
    /// Name of the Jellyfin user behind a linked local profile.
    pub jellyfin_user_name: Option<String>,
}

async fn account_view(app: &tauri::AppHandle, state: &AppState) -> Option<AccountView> {
    let jf = state.jellyfin.session().await;
    let server_name = load_server(app).ok().flatten().map(|s| s.server_name);
    if let Some(profile) = state.local.read().await.clone() {
        return Some(AccountView {
            mode: "local",
            user_id: profile.id,
            user_name: profile.name,
            avatar_url: Some(profile.avatar),
            device_id: jf.as_ref().map(|s| s.device_id.clone()).unwrap_or_default(),
            server_url: jf.as_ref().map(|s| s.server_url.clone()),
            server_name: jf.as_ref().and(server_name),
            jellyfin_user_name: jf.as_ref().map(|s| s.user_name.clone()),
        });
    }
    jf.map(|s| AccountView {
        mode: "jellyfin",
        user_id: s.user_id,
        user_name: s.user_name,
        avatar_url: s.avatar_url,
        device_id: s.device_id,
        server_url: Some(s.server_url),
        server_name,
        jellyfin_user_name: None,
    })
}

/// Intro / recap / credits ranges for an item. Always succeeds (empty when unknown).
#[tauri::command]
async fn get_media_segments(
    state: State<'_, AppState>,
    item_id: String,
) -> Result<Vec<MediaSegment>, String> {
    if !jellyfin::valid_item_id(&item_id) {
        return Ok(vec![]);
    }
    Ok(state.segments.resolve(&state.jellyfin, &item_id).await)
}

/// User whose settings apply right now: the active session, else the last user that
/// saved settings (so Login/Profiles keep the last theme).
async fn settings_user(app: &tauri::AppHandle, state: &AppState) -> Option<String> {
    if let Some(profile) = state.local.read().await.as_ref() {
        return Some(profile.id.clone());
    }
    if let Some(session) = state.jellyfin.session().await {
        return Some(session.user_id);
    }
    settings::last_user(app)
}

#[tauri::command]
async fn settings_get(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Settings, String> {
    match settings_user(&app, &state).await {
        Some(uid) => settings::load(&app, &uid),
        None => Ok(Settings::default()),
    }
}

#[tauri::command]
async fn settings_set(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    patch: serde_json::Value,
) -> Result<Settings, String> {
    let uid = settings_user(&app, &state)
        .await
        .ok_or_else(|| crate::errors::code("noSession"))?;
    let _guard = state.settings_lock.lock().await;
    let saved = settings::merge_and_save(&app, &uid, patch)?;
    let _ = app.emit("settings://changed", &saved);
    drop(_guard);
    refresh_presence(&app).await;
    // Bandwidth caps and sharing apply to a running torrent engine at once.
    state.torrents.apply_limits(torrent::EngineOptions::from(&saved.torrents)).await;
    if !saved.torrents.enabled {
        state.torrents.pause_idle().await;
    }
    Ok(saved)
}

/// "Test connection": the same check as connecting, without remembering the server.
#[tauri::command]
async fn probe_server_only(state: State<'_, AppState>, url: String) -> Result<PublicInfo, String> {
    let url = jellyfin::normalize_url(&url)?;
    state.jellyfin.probe(&url).await
}

#[tauri::command]
async fn probe_server(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> Result<PublicInfo, String> {
    let url = jellyfin::normalize_url(&url)?;
    let info = state.jellyfin.probe(&url).await?;
    save_server(&app, &url, &info.server_name)?;
    Ok(info)
}

#[tauri::command]
async fn login(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: String,
    username: String,
    password: String,
) -> Result<AccountView, String> {
    let device_id = existing_device_id(&app).unwrap_or_else(|| Uuid::new_v4().to_string());
    let session = state
        .jellyfin
        .login(&url, &username, &password, &device_id)
        .await?;
    *state.local.write().await = None;
    let _ = profiles::set_active(&app, None);
    save_session(&app, &session)?;
    save_server(&app, &session.server_url, "")?;
    save_device_id(&app, &session.device_id)?;
    state.account.activate(&app, &session.user_id).await;
    upsert_profile(
        &app,
        PublicUser {
            id: session.user_id.clone(),
            name: session.user_name.clone(),
            has_password: !password.is_empty(),
            avatar_url: session.avatar_url.clone(),
        },
    )?;
    account_view(&app, &state)
        .await
        .ok_or_else(|| crate::errors::code("noSession"))
}

// ---- local profiles ----

#[tauri::command]
fn local_profiles_list(app: tauri::AppHandle) -> Result<Vec<LocalProfileView>, String> {
    Ok(profiles::list(&app)?.iter().map(|p| p.view(&app)).collect())
}

#[tauri::command]
fn local_profile_create(
    app: tauri::AppHandle,
    name: String,
    avatar: String,
    pin: Option<String>,
    parental_pin: Option<String>,
) -> Result<LocalProfileView, String> {
    parental::check_create(&app, parental_pin.as_deref())?;
    let profile = profiles::create(&app, &name, &avatar, pin.as_deref())?;
    Ok(profile.view(&app))
}

#[tauri::command]
async fn local_profile_update(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    patch: ProfilePatch,
) -> Result<LocalProfileView, String> {
    // Changing or removing the PIN of a profile that is not open takes that PIN:
    // otherwise anyone could clear it from the profile picker and walk in.
    if patch.pin.is_some() || patch.clear_pin {
        let open = state.local.read().await.as_ref().is_some_and(|p| p.id == id);
        let profile = profiles::get(&app, &id)?.ok_or_else(|| "Perfil no encontrado".to_string())?;
        if !open && !profile.verify_pin(patch.current_pin.as_deref()) {
            return Err("PIN incorrecto".into());
        }
    }
    let updated = profiles::update(&app, &id, patch)?;
    let mut active = state.local.write().await;
    if active.as_ref().is_some_and(|p| p.id == id) {
        *active = Some(updated.clone());
    }
    Ok(updated.view(&app))
}

#[tauri::command]
async fn local_profile_delete(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    pin: Option<String>,
    parental_pin: Option<String>,
) -> Result<(), String> {
    let is_active = state.local.read().await.as_ref().is_some_and(|p| p.id == id);
    if let Some(profile) = profiles::get(&app, &id)? {
        if !is_active && !profile.verify_pin(pin.as_deref()) {
            return Err("PIN incorrecto".into());
        }
    }
    parental::check_delete(&app, &id, parental_pin.as_deref())?;
    if is_active {
        let _ = state.player.stop().await;
        *state.local.write().await = None;
        state.jellyfin.set_session(None).await;
        state.account.deactivate().await;
    }
    account::forget_profile(&app, &id);
    profiles::delete(&app, &id)
}

/// Checks a profile's PIN without opening it (editing it from the profile picker).
#[tauri::command]
fn local_profile_check_pin(app: tauri::AppHandle, id: String, pin: String) -> Result<(), String> {
    let profile = profiles::get(&app, &id)?.ok_or_else(|| "Perfil no encontrado".to_string())?;
    if profile.verify_pin(Some(&pin)) {
        Ok(())
    } else {
        Err("PIN incorrecto".into())
    }
}

/// Opens a local profile (after checking its PIN) and restores its linked Jellyfin
/// account, if any. Becomes the profile restored on the next launch.
#[tauri::command]
async fn local_profile_enter(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    pin: Option<String>,
) -> Result<AccountView, String> {
    let profile = profiles::get(&app, &id)?.ok_or_else(|| "Perfil no encontrado".to_string())?;
    if !profile.verify_pin(pin.as_deref()) {
        return Err("PIN incorrecto".into());
    }
    let _ = state.player.stop().await;
    state.jellyfin.set_session(None).await;
    state.segments.clear().await;
    state.iptv.clear().await;
    profiles::set_active(&app, Some(&profile.id))?;
    *state.local.write().await = Some(profile.clone());
    restore_linked_session(&app, &state, &profile.id).await;
    state.account.activate(&app, &profile.id).await;
    account_view(&app, &state)
        .await
        .ok_or_else(|| crate::errors::code("noSession"))
}

/// Puts the Jellyfin account linked to a local profile back in memory, dropping the
/// link when the server no longer accepts the token.
async fn restore_linked_session(app: &tauri::AppHandle, state: &AppState, profile_id: &str) {
    let key = profiles::session_key(profile_id);
    let Ok(Some(session)) = load_session_at(app, &key) else {
        return;
    };
    state.jellyfin.set_session(Some(session)).await;
    match state.jellyfin.validate().await {
        Ok(valid) => {
            let _ = save_session_at(app, &key, &valid);
            let _ = save_server(app, &valid.server_url, "");
        }
        Err(_) => {
            state.jellyfin.set_session(None).await;
            let _ = clear_session_at(app, &key);
        }
    }
}

/// Links a Jellyfin account to the active local profile: the library shows up next to
/// the addons while the profile keeps its own settings and progress.
#[tauri::command]
async fn link_server(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: String,
    username: String,
    password: String,
) -> Result<AccountView, String> {
    let profile = state
        .local
        .read()
        .await
        .clone()
        .ok_or_else(|| "No hay un perfil local activo".to_string())?;
    let device_id = existing_device_id(&app).unwrap_or_else(|| Uuid::new_v4().to_string());
    let session = state
        .jellyfin
        .login(&url, &username, &password, &device_id)
        .await?;
    save_session_at(&app, &profiles::session_key(&profile.id), &session)?;
    save_server(&app, &session.server_url, "")?;
    save_device_id(&app, &session.device_id)?;
    let _ = upsert_profile(
        &app,
        PublicUser {
            id: session.user_id.clone(),
            name: session.user_name.clone(),
            has_password: !password.is_empty(),
            avatar_url: session.avatar_url.clone(),
        },
    );
    state.segments.clear().await;
    account_view(&app, &state)
        .await
        .ok_or_else(|| crate::errors::code("noSession"))
}

#[tauri::command]
async fn unlink_server(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<AccountView, String> {
    let profile = state
        .local
        .read()
        .await
        .clone()
        .ok_or_else(|| "No hay un perfil local activo".to_string())?;
    let _ = state.player.stop().await;
    state.jellyfin.set_session(None).await;
    state.segments.clear().await;
    clear_session_at(&app, &profiles::session_key(&profile.id))?;
    account_view(&app, &state)
        .await
        .ok_or_else(|| crate::errors::code("noSession"))
}

#[tauri::command]
async fn browse_items(state: State<'_, AppState>, args: BrowseArgs) -> Result<Vec<Movie>, String> {
    state.jellyfin.browse(&args).await
}

#[tauri::command]
async fn get_genres(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    state.jellyfin.genres().await
}

#[tauri::command]
async fn session_restore(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Option<AccountView>, String> {
    if let Some(id) = profiles::active_id(&app) {
        match profiles::get(&app, &id)? {
            Some(profile) => {
                *state.local.write().await = Some(profile.clone());
                restore_linked_session(&app, &state, &profile.id).await;
                state.account.activate(&app, &profile.id).await;
                return Ok(account_view(&app, &state).await);
            }
            None => {
                let _ = profiles::set_active(&app, None);
            }
        }
    }
    let Some(session) = load_session(&app)? else {
        return Ok(None);
    };
    state.jellyfin.set_session(Some(session.clone())).await;
    match state.jellyfin.validate().await {
        Ok(valid) => {
            save_session(&app, &valid)?;
            save_server(&app, &valid.server_url, "")?;
            save_device_id(&app, &valid.device_id)?;
            let _ = upsert_profile(
                &app,
                PublicUser {
                    id: valid.user_id.clone(),
                    name: valid.user_name.clone(),
                    has_password: true,
                    avatar_url: valid.avatar_url.clone(),
                },
            );
            state.account.activate(&app, &valid.user_id).await;
            Ok(account_view(&app, &state).await)
        }
        Err(_) => {
            clear_session(&app)?;
            state.jellyfin.set_session(None).await;
            Ok(None)
        }
    }
}

/// Back to the profile picker. A local profile keeps its linked account for next time.
#[tauri::command]
async fn logout(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let _ = state.player.stop().await;
    let was_local = state.local.write().await.take().is_some();
    state.jellyfin.set_session(None).await;
    state.account.deactivate().await;
    opensubs::forget_token();
    state.segments.clear().await;
    state.iptv.clear().await;
    profiles::set_active(&app, None)?;
    if was_local {
        return Ok(());
    }
    clear_session(&app)
}

/// Forgets the Jellyfin server (its users and the session), keeping local profiles.
#[tauri::command]
async fn logout_server(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let _ = state.player.stop().await;
    *state.local.write().await = None;
    state.jellyfin.set_session(None).await;
    state.account.deactivate().await;
    state.segments.clear().await;
    opensubs::forget_token();
    profiles::set_active(&app, None)?;
    // The ejFlix accounts those users signed into go with them: nothing would be
    // left on screen to sign them out, and a later login must not pick them up.
    for user in load_profiles(&app).unwrap_or_default() {
        account::forget_profile(&app, &user.id);
    }
    if let Ok(Some(session)) = load_session(&app) {
        account::forget_profile(&app, &session.user_id);
    }
    clear_session(&app)?;
    clear_profiles(&app)?;
    clear_server(&app)
}

/// The active session as the frontend sees it, with no side effects (the account
/// sync may have linked a server since the profile was opened).
#[tauri::command]
async fn session_current(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Option<AccountView>, String> {
    Ok(account_view(&app, &state).await)
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct TorrentResolveArgs {
    info_hash: String,
    file_idx: Option<usize>,
    sources: Vec<String>,
}

/// Turns an addon's bare torrent into a local URL the player can open. Waits for the
/// torrent's file list, so it can take a while on a poorly seeded one.
#[tauri::command]
async fn torrent_resolve(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    args: TorrentResolveArgs,
) -> Result<torrent::Resolved, String> {
    let prefs = match settings_user(&app, &state).await {
        Some(uid) => settings::load(&app, &uid).unwrap_or_default().torrents,
        None => settings::TorrentPrefs::default(),
    };
    if !prefs.enabled {
        return Err("Los torrents están desactivados en Ajustes › Torrents".into());
    }
    let limit = u64::from(prefs.cache_gb) * 1024 * 1024 * 1024;
    let dir = torrent::cache_dir(&app);
    state
        .torrents
        .resolve(&dir, &args.info_hash, args.file_idx, &args.sources, limit, torrent::EngineOptions::from(&prefs))
        .await
}

/// Pauses every torrent that is not being watched (the switch was turned off, or the
/// player closed).
#[tauri::command]
async fn torrent_pause_all(state: State<'_, AppState>) -> Result<(), String> {
    state.torrents.pause_idle().await;
    Ok(())
}

#[tauri::command]
async fn torrent_cache_info(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<torrent::CacheInfo, String> {
    Ok(state.torrents.cache_info(&torrent::cache_dir(&app)))
}

#[tauri::command]
async fn torrent_cache_clear(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<torrent::CacheInfo, String> {
    let dir = torrent::cache_dir(&app);
    state.torrents.cache_clear(&dir).await;
    Ok(state.torrents.cache_info(&dir))
}

#[tauri::command]
fn saved_server(app: tauri::AppHandle) -> Result<Option<SavedServer>, String> {
    load_server(&app)
}

#[tauri::command]
async fn list_public_users(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> Result<Vec<PublicUser>, String> {
    let saved = load_profiles(&app)?;
    let public = state.jellyfin.list_public_users(&url).await.unwrap_or_default();
    Ok(merge_profiles(saved, public))
}

#[tauri::command]
async fn get_libraries(state: State<'_, AppState>) -> Result<Vec<Library>, String> {
    state.jellyfin.libraries().await
}

#[tauri::command]
async fn get_home(
    state: State<'_, AppState>,
    library: Option<Library>,
) -> Result<HomeData, String> {
    if let Some(lib) = &library {
        if !jellyfin::valid_item_id(&lib.id) {
            return Err("Biblioteca no válida".into());
        }
    }
    state.jellyfin.home(library.as_ref()).await
}

#[tauri::command]
async fn get_seasons(state: State<'_, AppState>, series_id: String) -> Result<Vec<Movie>, String> {
    state.jellyfin.seasons(&series_id).await
}

#[tauri::command]
async fn get_episodes(
    state: State<'_, AppState>,
    series_id: String,
    season_id: String,
) -> Result<Vec<Movie>, String> {
    state.jellyfin.episodes(&series_id, &season_id).await
}

#[tauri::command]
async fn get_next_episode(
    state: State<'_, AppState>,
    series_id: String,
    episode_id: String,
) -> Result<Option<Movie>, String> {
    state.jellyfin.next_episode(&series_id, &episode_id).await
}

#[tauri::command]
async fn get_series_next_up(
    state: State<'_, AppState>,
    series_id: String,
) -> Result<Option<Movie>, String> {
    state.jellyfin.series_next_up(&series_id).await
}

#[tauri::command]
async fn get_item(state: State<'_, AppState>, id: String) -> Result<Movie, String> {
    state.jellyfin.get_item(&id).await
}

#[tauri::command]
async fn search_items(state: State<'_, AppState>, query: String) -> Result<Vec<Movie>, String> {
    state.jellyfin.search(&query).await
}

#[tauri::command]
async fn person_items(state: State<'_, AppState>, id: String) -> Result<Vec<Movie>, String> {
    state.jellyfin.person_items(&id).await
}

#[tauri::command]
async fn get_similar(state: State<'_, AppState>, id: String) -> Result<Vec<Movie>, String> {
    state.jellyfin.similar(&id).await
}

#[tauri::command]
async fn get_favorites(state: State<'_, AppState>) -> Result<Vec<Movie>, String> {
    state.jellyfin.favorites().await
}

#[tauri::command]
async fn set_favorite(
    state: State<'_, AppState>,
    item_id: String,
    favorite: bool,
) -> Result<bool, String> {
    state.jellyfin.set_favorite(&item_id, favorite).await
}

#[tauri::command]
async fn set_played(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    item_id: String,
    played: bool,
) -> Result<bool, String> {
    let confirmed = state.jellyfin.set_played(&item_id, played).await?;
    trakt::spawn_jellyfin_history(&app, &item_id, confirmed);
    Ok(confirmed)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlayArgs {
    item_id: String,
    title: String,
    start_seconds: Option<f64>,
    media_source_id: Option<String>,
}

#[tauri::command]
async fn player_start(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    args: PlayArgs,
) -> Result<PlayerState, String> {
    if !jellyfin::valid_item_id(&args.item_id) {
        return Err(crate::errors::code("invalidItem"));
    }
    let movie = state.jellyfin.get_item(&args.item_id).await?;
    let session = state.jellyfin.require_session().await?;
    let playback = settings::load(&app, &session.user_id)
        .unwrap_or_default()
        .playback;
    let mut prefs = PlaybackPrefs::from_settings(&playback);
    apply_sync_offsets(&app, &state, &movie.id, &mut prefs).await;
    let start = args.start_seconds.unwrap_or(0.0);
    let play_session_id = Uuid::new_v4().to_string();
    // Version picker: play the requested media source when the item has it, else the first.
    let source = args
        .media_source_id
        .as_deref()
        .and_then(|id| movie.media_sources.iter().find(|s| s.id == id))
        .or_else(|| movie.media_sources.first());
    let media_source_id = source.map(|s| s.id.clone()).or(movie.media_source_id.clone());
    let stream_url = JellyfinClient::stream_url_for(&session, &movie.id, source);
    let ctx = PlaybackContext {
        source: PlaybackSource::Jellyfin {
            item_id: movie.id.clone(),
            media_source_id: media_source_id.clone(),
            play_session_id: play_session_id.clone(),
        },
        presence: presence_for_item(
            &session,
            &movie,
            load_server(&app).ok().flatten().map(|s| s.server_name),
        ),
    };
    let headers = vec![("X-Emby-Token".to_string(), session.token.clone())];
    state
        .player
        .start(&app, &stream_url, &headers, &args.title, start, ctx, prefs)
        .await?;
    let _ = state
        .jellyfin
        .report_start(
            &movie.id,
            media_source_id.as_deref(),
            &play_session_id,
            seconds_to_ticks(start),
        )
        .await;
    show_player_overlay(&app);
    refresh_presence(&app).await;
    Ok(state.player.snapshot().await)
}

/// Stops playback. With `switching` (next episode) the window stays as it is:
/// fullscreen and the overlay are kept for the item that starts right after.
#[tauri::command]
async fn player_stop(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    switching: Option<bool>,
) -> Result<(), String> {
    let credits = state.player.credits_start();
    if let Some((ctx, time, duration)) = state.player.stop().await? {
        let uid = settings_user(&app, &state).await;
        let threshold = match &uid {
            Some(uid) => settings::load(&app, uid).unwrap_or_default().playback.watched_threshold,
            None => settings::Settings::default().playback.watched_threshold,
        };
        let watched = player::counts_as_watched(time, duration, threshold, credits);
        match ctx.source {
            PlaybackSource::Jellyfin {
                item_id,
                media_source_id,
                play_session_id,
            } => {
                if watched {
                    trakt::spawn_jellyfin_history(&app, &item_id, true);
                }
                let _ = state
                    .jellyfin
                    .report_stop(
                        &item_id,
                        media_source_id.as_deref(),
                        &play_session_id,
                        seconds_to_ticks(time),
                    )
                    .await;
                // The server only marks it played past its own resume limit; stopping in
                // the credits or past the profile's threshold counts too.
                if watched && state.jellyfin.set_played(&item_id, true).await.is_ok() {
                    let _ = app.emit("player://watched", serde_json::json!({ "itemId": item_id }));
                }
            }
            PlaybackSource::Addon { entry } if watched => {
                trakt::spawn_resume_history(&app, &entry);
                if let Some(uid) = uid {
                    let _ = addons::remove_progress(&app, &uid, &entry.key);
                    let library = addons::LibraryEntry {
                        key: entry.key.clone(),
                        kind: entry.kind.clone(),
                        meta_id: entry.meta_id.clone(),
                        name: entry.name.clone(),
                        series_name: entry.series_name.clone(),
                        poster: entry.poster.clone(),
                        background: entry.background.clone(),
                        logo: entry.logo.clone(),
                        season: entry.season,
                        episode: entry.episode,
                        imdb: entry.imdb.clone(),
                        ..addons::LibraryEntry::default()
                    };
                    if addons::set_library_flags(&app, &uid, library, None, Some(true)).is_ok() {
                        let _ = app.emit("player://watched", serde_json::json!({ "key": entry.key }));
                    }
                }
            }
            PlaybackSource::Addon { entry } => {
                if let Some(uid) = uid {
                    let _ = addons::upsert_progress(
                        &app,
                        &uid,
                        addons::ResumeEntry {
                            position_seconds: time,
                            duration_seconds: duration,
                            updated_ms: addons::now_ms(),
                            ..entry
                        },
                    );
                }
            }
            PlaybackSource::Live { .. } => {}
        }
    }
    // A torrent nobody is reading any more stops using the connection right away.
    state.torrents.pause_idle().await;
    refresh_presence(&app).await;
    if switching.unwrap_or(false) {
        return Ok(());
    }
    let _ = state.player.exit_mini(&app, false).await;
    hide_player_overlay(&app);
    if let Some(window) = app.get_webview_window("main") {
        set_main_fullscreen(&window, false)?;
        let _ = window.set_background_color(Some(tauri::window::Color(13, 13, 13, 255)));
    }
    let _ = app.emit("player://close", ());
    Ok(())
}

/// Borderless fullscreen for the undecorated main window.
///
/// On Windows 11 an undecorated window *with shadow* keeps a 1px top inset (and
/// side frame insets) even in fullscreen, which shows up as a thin light line at
/// the top of the screen and shifts the client area under the overlay. Dropping
/// the shadow while fullscreen removes those insets; it is restored on exit.
fn set_main_fullscreen(window: &tauri::WebviewWindow, fullscreen: bool) -> Result<(), String> {
    if fullscreen {
        let _ = window.set_shadow(false);
        window.set_fullscreen(true).map_err(|e| e.to_string())?;
    } else {
        window.set_fullscreen(false).map_err(|e| e.to_string())?;
        let _ = window.set_shadow(true);
    }
    Ok(())
}

#[tauri::command]
async fn player_set_fullscreen(app: tauri::AppHandle, fullscreen: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        set_main_fullscreen(&window, fullscreen)?;
    }
    sync_player_overlay(&app);
    Ok(())
}

#[tauri::command]
async fn player_set_speed(state: State<'_, AppState>, speed: f64) -> Result<f64, String> {
    state.player.set_speed(speed).await
}

#[tauri::command]
async fn player_set_aspect(state: State<'_, AppState>, mode: String) -> Result<(), String> {
    if !player::ASPECT_MODES.contains(&mode.as_str()) {
        return Err("Relación de aspecto no válida".into());
    }
    state.player.set_aspect(&mode).await
}

#[tauri::command]
async fn player_toggle_pause(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.player.toggle_pause().await?;
    // mpv confirms the new pause state asynchronously; give it a moment before reporting.
    tokio::time::sleep(Duration::from_millis(150)).await;
    refresh_presence(&app).await;
    Ok(())
}

#[tauri::command]
async fn player_seek(
    state: State<'_, AppState>,
    seconds: f64,
    relative: bool,
    fast: Option<bool>,
) -> Result<(), String> {
    state.player.seek(seconds, relative, fast.unwrap_or(false)).await
}

#[tauri::command]
async fn player_set_volume(state: State<'_, AppState>, volume: f64) -> Result<f64, String> {
    state.player.set_volume(volume).await
}

#[tauri::command]
async fn player_set_mute(state: State<'_, AppState>, mute: bool) -> Result<(), String> {
    state.player.set_mute(mute).await
}

#[tauri::command]
async fn player_set_track(state: State<'_, AppState>, kind: String, id: i64) -> Result<(), String> {
    state.player.set_track(&kind, id).await
}

/// Delays and subtitle look while playing (whitelisted mpv properties).
#[tauri::command]
async fn player_set_prop(state: State<'_, AppState>, name: String, value: serde_json::Value) -> Result<(), String> {
    state.player.set_prop(&name, value).await
}

/// Technical numbers for the player's stats panel.
#[tauri::command]
async fn player_props(state: State<'_, AppState>) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    Ok(state.player.props().await)
}

/// Loads a subtitle file the person picked: the webview only has its text, so it is
/// written to a temporary file first.
#[tauri::command]
async fn player_sub_add_text(state: State<'_, AppState>, name: String, content: String) -> Result<(), String> {
    if content.len() > 8 * 1024 * 1024 {
        return Err(crate::errors::code("subTooLarge"));
    }
    let ext = std::path::Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| ["srt", "vtt", "ass", "ssa", "sub"].contains(&e.as_str()))
        .ok_or_else(|| crate::errors::code("subFormat"))?;
    let dir = std::env::temp_dir().join("ejflix-subs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.{ext}", Uuid::new_v4()));
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    state.player.sub_add(&path.to_string_lossy()).await
}

// ---- player extras: sync offsets, night mode, watched rule, mini player, OpenSubtitles ----

/// The subtitle / audio delays remembered for a title, into the prefs of its start.
async fn apply_sync_offsets(app: &tauri::AppHandle, state: &AppState, key: &str, prefs: &mut PlaybackPrefs) {
    if let Some(uid) = settings_user(app, state).await {
        if let Some(offset) = player::load_offset(app, &uid, key) {
            prefs.sub_delay = offset.sub;
            prefs.audio_delay = offset.audio;
        }
    }
}

/// Sets the subtitle ("sub") or audio delay and remembers both for the title playing.
#[tauri::command]
async fn player_set_delay(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    kind: String,
    seconds: f64,
) -> Result<f64, String> {
    let value = state.player.set_delay(&kind, seconds).await?;
    let key = state
        .player
        .context
        .read()
        .await
        .as_ref()
        .and_then(|ctx| ctx.source.title_key());
    if let (Some(key), Some(uid)) = (key, settings_user(&app, &state).await) {
        let snap = state.player.snapshot().await;
        let _ = player::save_offset(&app, &uid, &key, snap.sub_delay, snap.audio_delay);
    }
    Ok(value)
}

#[tauri::command]
async fn player_set_night(state: State<'_, AppState>, on: bool) -> Result<(), String> {
    state.player.set_night(on).await
}

/// Where the credits of the file playing start (seconds), for the "watched" rule.
#[tauri::command]
fn player_set_credits(state: State<'_, AppState>, start: Option<f64>) {
    state.player.set_credits_start(start);
}

/// Mini player on or off. Returns whether the window is fullscreen afterwards.
#[tauri::command]
async fn player_set_mini(app: tauri::AppHandle, state: State<'_, AppState>, on: bool) -> Result<bool, String> {
    if on {
        state.player.enter_mini(&app).await?;
        Ok(false)
    } else {
        state.player.exit_mini(&app, true).await
    }
}

/// Moves the mini player: the press happens on the overlay, but the main window (the
/// video) is what moves; the overlay follows it.
#[tauri::command]
fn player_mini_drag(app: tauri::AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Ventana no disponible".to_string())?;
    main.start_dragging().map_err(|e| e.to_string())
}

async fn opensubtitles_prefs(app: &tauri::AppHandle, state: &AppState) -> Result<(String, settings::Playback), String> {
    let uid = settings_user(app, state)
        .await
        .ok_or_else(|| crate::errors::code("noProfile"))?;
    let playback = settings::load(app, &uid).unwrap_or_default().playback;
    if playback.opensubtitles_api_key.is_empty() {
        return Err(crate::errors::code("osNoApiKey"));
    }
    Ok((uid, playback))
}

#[tauri::command]
async fn opensubtitles_search(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    query: opensubs::SearchQuery,
) -> Result<Vec<opensubs::SubtitleResult>, String> {
    let (_, playback) = opensubtitles_prefs(&app, &state).await?;
    opensubs::search(&playback.opensubtitles_api_key, &query).await
}

/// Downloads a search result and loads it into the player (selected).
#[tauri::command]
async fn opensubtitles_download(app: tauri::AppHandle, state: State<'_, AppState>, file_id: u64) -> Result<(), String> {
    let (uid, playback) = opensubtitles_prefs(&app, &state).await?;
    let password = opensubs::load_password(&app, &uid);
    let login = match (playback.opensubtitles_user.as_str(), password.as_deref()) {
        ("", _) | (_, None) => None,
        (user, Some(password)) => Some((user, password)),
    };
    let path = opensubs::download(&playback.opensubtitles_api_key, &uid, login, file_id).await?;
    state.player.sub_add(&path.to_string_lossy()).await
}

/// Whether an OpenSubtitles password is saved for the profile.
#[tauri::command]
async fn opensubtitles_has_password(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    Ok(match settings_user(&app, &state).await {
        Some(uid) => opensubs::load_password(&app, &uid).is_some(),
        None => false,
    })
}

/// Saves the OpenSubtitles password (empty forgets it), encrypted and outside the synced settings.
#[tauri::command]
async fn opensubtitles_set_password(app: tauri::AppHandle, state: State<'_, AppState>, password: String) -> Result<(), String> {
    let uid = settings_user(&app, &state)
        .await
        .ok_or_else(|| crate::errors::code("noProfile"))?;
    opensubs::save_password(&app, &uid, &password)
}

/// Peers, speed and progress of a torrent being opened or played.
#[tauri::command]
async fn torrent_status(state: State<'_, AppState>, info_hash: String) -> Result<torrent::TorrentStatus, String> {
    Ok(state.torrents.status(&info_hash))
}

#[tauri::command]
async fn player_state(state: State<'_, AppState>) -> Result<PlayerState, String> {
    Ok(state.player.snapshot().await)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    current: String,
    show_notes: bool,
}

#[tauri::command]
fn update_info(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    let last = load_last_seen_version(&app)?;
    let show_notes = match last.as_deref() {
        Some(seen) => seen != current,
        None => true,
    };
    Ok(UpdateInfo { current, show_notes })
}

#[tauri::command]
fn dismiss_update(app: tauri::AppHandle) -> Result<(), String> {
    let current = app.package_info().version.to_string();
    save_last_seen_version(&app, &current)
}

fn load_update_prefs(app: &tauri::AppHandle) -> Result<update::UpdatePrefs, String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    let auto = store
        .get("updateAuto")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let skipped = store
        .get("updateSkipped")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .filter(|s| !s.is_empty());
    Ok(update::UpdatePrefs { auto, skipped })
}

/// Latest release on GitHub compared with this build. `force` bypasses the cache
/// (manual "check now"); the automatic launch check reuses a recent answer.
#[tauri::command]
async fn update_check(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    force: bool,
) -> Result<update::UpdateCheck, String> {
    let prefs = load_update_prefs(&app)?;
    state.updater.check(force, prefs.skipped.as_deref()).await
}

#[tauri::command]
fn update_prefs(app: tauri::AppHandle) -> Result<update::UpdatePrefs, String> {
    load_update_prefs(&app)
}

#[tauri::command]
fn update_set_auto(app: tauri::AppHandle, auto: bool) -> Result<update::UpdatePrefs, String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.set("updateAuto", serde_json::Value::Bool(auto));
    crate::save_store(&store)?;
    load_update_prefs(&app)
}

/// Remember (or forget, with an empty string) a version the user does not want to see again.
#[tauri::command]
fn update_skip(app: tauri::AppHandle, version: String) -> Result<update::UpdatePrefs, String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    let clean = update::parse_version(&version)
        .map(|(a, b, c)| format!("{a}.{b}.{c}"))
        .unwrap_or_default();
    store.set("updateSkipped", serde_json::Value::String(clean));
    crate::save_store(&store)?;
    load_update_prefs(&app)
}

#[tauri::command]
async fn update_download(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<update::Downloaded, String> {
    state.updater.download(&app).await
}

/// Stops playback, launches the downloaded installer and quits so it can replace the files.
#[tauri::command]
async fn update_install(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let _ = state.player.stop().await;
    update::Updater::launch_installer(&path)?;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(400)).await;
        app.exit(0);
    });
    Ok(())
}

/// Opens a web page in the default browser. Only GitHub and Discord pages, which are
/// the ones the UI links to.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    const ALLOWED: [&str; 4] = [
        "https://github.com/",
        "https://discord.com/developers/",
        "https://introdb.app/",
        "https://x.com/",
    ];
    if !ALLOWED.iter().any(|p| url.starts_with(p)) || url.chars().any(|c| c.is_control() || c == '"') {
        return Err("Enlace no permitido".into());
    }
    std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn locale_get(app: tauri::AppHandle) -> Result<String, String> {
    load_locale(&app)
}

#[tauri::command]
fn locale_set(app: tauri::AppHandle, locale: String) -> Result<(), String> {
    if locale != "en" && locale != "es" {
        return Err("Idioma no válido".into());
    }
    save_locale(&app, &locale)
}

fn save_session(app: &tauri::AppHandle, session: &Session) -> Result<(), String> {
    save_session_at(app, "data", session)
}

fn save_session_at(app: &tauri::AppHandle, key: &str, session: &Session) -> Result<(), String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    let raw = serde_json::to_vec(session).map_err(|e| e.to_string())?;
    let sealed = protect::protect(&raw)?;
    store.set(
        key,
        serde_json::json!({
            "v": 2,
            "blob": protect::to_hex(&sealed),
        }),
    );
    crate::save_store(&store)?;
    Ok(())
}

fn load_session(app: &tauri::AppHandle) -> Result<Option<Session>, String> {
    load_session_at(app, "data")
}

fn load_session_at(app: &tauri::AppHandle, key: &str) -> Result<Option<Session>, String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    let Some(value) = store.get(key) else {
        return Ok(None);
    };
    if value.get("v").and_then(|v| v.as_i64()) == Some(2) {
        let hex = value
            .get("blob")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Sesión corrupta".to_string())?;
        let sealed = protect::from_hex(hex)?;
        let raw = protect::unprotect(&sealed)?;
        let session = serde_json::from_slice(&raw).map_err(|e| e.to_string())?;
        return Ok(Some(session));
    }
    let session: Session = serde_json::from_value(value).map_err(|e| e.to_string())?;
    let _ = save_session_at(app, key, &session);
    Ok(Some(session))
}

fn clear_session(app: &tauri::AppHandle) -> Result<(), String> {
    clear_session_at(app, "data")
}

fn clear_session_at(app: &tauri::AppHandle, key: &str) -> Result<(), String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.delete(key);
    crate::save_store(&store)?;
    Ok(())
}

fn save_server(app: &tauri::AppHandle, url: &str, name: &str) -> Result<(), String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.set("serverUrl", serde_json::Value::String(url.to_string()));
    if !name.is_empty() {
        store.set("serverName", serde_json::Value::String(name.to_string()));
    }
    crate::save_store(&store)?;
    Ok(())
}

fn load_server(app: &tauri::AppHandle) -> Result<Option<SavedServer>, String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    let Some(url) = store.get("serverUrl").and_then(|v| v.as_str().map(|s| s.to_string())) else {
        return Ok(None);
    };
    if url.is_empty() {
        return Ok(None);
    }
    let server_name = store
        .get("serverName")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Jellyfin".to_string());
    Ok(Some(SavedServer {
        server_url: url,
        server_name,
    }))
}

fn clear_server(app: &tauri::AppHandle) -> Result<(), String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.delete("serverUrl");
    store.delete("serverName");
    crate::save_store(&store)?;
    Ok(())
}

fn load_profiles(app: &tauri::AppHandle) -> Result<Vec<PublicUser>, String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    match store.get("profiles") {
        Some(value) => serde_json::from_value(value).map_err(|e| e.to_string()),
        None => Ok(vec![]),
    }
}

fn upsert_profile(app: &tauri::AppHandle, profile: PublicUser) -> Result<(), String> {
    let mut profiles = load_profiles(app)?;
    if let Some(existing) = profiles.iter_mut().find(|item| item.id == profile.id) {
        *existing = profile;
    } else {
        profiles.push(profile);
    }
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.set(
        "profiles",
        serde_json::to_value(&profiles).map_err(|e| e.to_string())?,
    );
    crate::save_store(&store)?;
    Ok(())
}

fn clear_profiles(app: &tauri::AppHandle) -> Result<(), String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.delete("profiles");
    crate::save_store(&store)?;
    Ok(())
}

fn merge_profiles(saved: Vec<PublicUser>, public: Vec<PublicUser>) -> Vec<PublicUser> {
    let mut merged = saved;
    for user in public {
        if let Some(existing) = merged.iter_mut().find(|item| item.id == user.id) {
            if user.avatar_url.is_some() {
                existing.avatar_url = user.avatar_url;
            }
            existing.name = user.name;
            existing.has_password = user.has_password;
        } else {
            merged.push(user);
        }
    }
    merged
}

fn existing_device_id(app: &tauri::AppHandle) -> Option<String> {
    if let Some(id) = load_device_id(app) {
        return Some(id);
    }
    load_session(app)
        .ok()
        .flatten()
        .map(|s| s.device_id)
}

/// The device id, minted and kept on first use (a PC with only local profiles never
/// logged into a server, so it had none).
pub fn device_id_or_create(app: &tauri::AppHandle) -> String {
    if let Some(id) = existing_device_id(app) {
        return id;
    }
    let id = Uuid::new_v4().to_string();
    let _ = save_device_id(app, &id);
    id
}

fn load_device_id(app: &tauri::AppHandle) -> Option<String> {
    let store = app.store(crate::store_path()).ok()?;
    store
        .get("deviceId")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .filter(|s| !s.is_empty())
}

fn save_device_id(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.set("deviceId", serde_json::Value::String(id.to_string()));
    crate::save_store(&store)?;
    Ok(())
}

fn load_last_seen_version(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    Ok(store
        .get("lastSeenVersion")
        .and_then(|v| v.as_str().map(|s| s.to_string())))
}

fn load_locale(app: &tauri::AppHandle) -> Result<String, String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    Ok(store
        .get("locale")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .filter(|s| s == "en" || s == "es")
        .unwrap_or_default())
}

fn save_locale(app: &tauri::AppHandle, locale: &str) -> Result<(), String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.set("locale", serde_json::Value::String(locale.to_string()));
    crate::save_store(&store)?;
    Ok(())
}

fn save_last_seen_version(app: &tauri::AppHandle, version: &str) -> Result<(), String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.set("lastSeenVersion", serde_json::Value::String(version.to_string()));
    crate::save_store(&store)?;
    Ok(())
}

fn create_player_overlay(app: &tauri::AppHandle, main: &tauri::WebviewWindow) -> Result<(), String> {
    if app.get_webview_window("player-overlay").is_some() {
        return Ok(());
    }
    let overlay = WebviewWindowBuilder::new(app, "player-overlay", WebviewUrl::App("index.html".into()))
        .title("ejFlix")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        .visible(false)
        .resizable(false)
        .owner(main)
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    let _ = overlay.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
    sync_player_overlay(app);
    Ok(())
}

pub(crate) fn sync_player_overlay(app: &tauri::AppHandle) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let Some(overlay) = app.get_webview_window("player-overlay") else {
        return;
    };
    // Match the *client* rect of the main window: that is where the mpv child
    // window lives, so the controls line up with the video even when the
    // undecorated frame adds hidden insets.
    if let Ok(pos) = main.inner_position() {
        let _ = overlay.set_position(pos);
    }
    if let Ok(size) = main.inner_size() {
        let _ = overlay.set_size(size);
    }
}

fn show_player_overlay(app: &tauri::AppHandle) {
    sync_player_overlay(app);
    if let Some(overlay) = app.get_webview_window("player-overlay") {
        let _ = overlay.show();
        let _ = overlay.set_focus();
    }
}

fn hide_player_overlay(app: &tauri::AppHandle) {
    if let Some(overlay) = app.get_webview_window("player-overlay") {
        let _ = overlay.hide();
    }
}

pub(crate) fn overlay_hwnd(app: &tauri::AppHandle) -> isize {
    let Some(window) = app.get_webview_window("player-overlay") else {
        return 0;
    };
    match window.window_handle() {
        Ok(handle) => match handle.as_raw() {
            RawWindowHandle::Win32(win) => win.hwnd.get(),
            _ => 0,
        },
        Err(_) => 0,
    }
}

async fn proxy_jellyfin_image(
    app: &tauri::AppHandle,
    uri: &tauri::http::Uri,
) -> tauri::http::Response<Vec<u8>> {
    let deny = |status: u16| {
        tauri::http::Response::builder()
            .status(status)
            .header("cache-control", "no-store")
            .body(Vec::new())
            .expect("empty image response")
    };
    if !jellyfin::allowed_image_path(uri.path()) {
        return deny(404);
    }
    let query = jellyfin::sanitize_image_query(uri.query());
    // Trickplay tiles never change for a given item; cache them for a day.
    let cache = if uri.path().contains("/Trickplay/") {
        "private, max-age=86400"
    } else {
        "private, max-age=3600"
    };
    let state = app.state::<AppState>();
    match state.jellyfin.fetch_local_image(uri.path(), &query).await {
        Ok((bytes, content_type)) => tauri::http::Response::builder()
            .status(200)
            .header("content-type", content_type)
            .header("cache-control", cache)
            // Lets the app draw backdrops on a canvas (dominant colour) without tainting it;
            // the protocol is only reachable from the app's own webviews.
            .header("access-control-allow-origin", "*")
            .body(bytes)
            .unwrap_or_else(|_| deny(500)),
        Err(_) => deny(404),
    }
}

fn seconds_to_ticks(seconds: f64) -> i64 {
    (seconds * 10_000_000.0) as i64
}

fn start_progress_loop(app: tauri::AppHandle, state: Arc<Player>, jellyfin: JellyfinClient) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(10));
        loop {
            interval.tick().await;
            let ctx = state.context.read().await.clone();
            let Some(ctx) = ctx else { continue };
            let snap = state.snapshot().await;
            match ctx.source {
                PlaybackSource::Jellyfin {
                    item_id,
                    media_source_id,
                    play_session_id,
                } => {
                    let _ = jellyfin
                        .report_progress(
                            &item_id,
                            media_source_id.as_deref(),
                            &play_session_id,
                            seconds_to_ticks(snap.time),
                            snap.paused,
                            snap.volume as i32,
                            snap.mute,
                        )
                        .await;
                }
                PlaybackSource::Addon { entry } => {
                    let uid = settings_user(&app, &app.state::<AppState>()).await;
                    if let Some(uid) = uid {
                        let _ = addons::upsert_progress(
                            &app,
                            &uid,
                            addons::ResumeEntry {
                                position_seconds: snap.time,
                                duration_seconds: snap.duration,
                                updated_ms: addons::now_ms(),
                                ..entry
                            },
                        );
                    }
                }
                PlaybackSource::Live { .. } => {}
            }
            let _ = app.emit("player://state", snap);
            refresh_presence(&app).await;
        }
    });
}

// ---- Stremio addons ----

async fn addon_prefs(app: &tauri::AppHandle, state: &AppState) -> settings::AddonPrefs {
    match settings_user(app, state).await {
        Some(uid) => settings::load(app, &uid).unwrap_or_default().addons,
        None => settings::Settings::default().addons,
    }
}

/// Manifest URLs to consult, in priority order (built-in Cinemeta last). Addons the
/// profile switched off are left out.
async fn addon_urls(app: &tauri::AppHandle, state: &AppState) -> Vec<(String, bool)> {
    let prefs = addon_prefs(app, state).await;
    let mut list: Vec<(String, bool)> = prefs
        .urls
        .iter()
        .filter(|u| !prefs.disabled.contains(u))
        .map(|u| (u.clone(), false))
        .collect();
    if prefs.cinemeta && !list.iter().any(|(u, _)| u == addons::CINEMETA_URL) {
        list.push((addons::CINEMETA_URL.to_string(), true));
    }
    list
}

/// Every configured addon, the switched-off ones included, for Settings.
#[tauri::command]
async fn addons_all(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Vec<AddonInfo>, String> {
    let prefs = addon_prefs(&app, &state).await;
    let mut out = Vec::new();
    for url in &prefs.urls {
        if let Ok(mut info) = state.addons.manifest(url, false).await {
            info.enabled = !prefs.disabled.contains(url);
            out.push(info);
        }
    }
    if prefs.cinemeta && !prefs.urls.iter().any(|u| u == addons::CINEMETA_URL) {
        if let Ok(info) = state.addons.manifest(addons::CINEMETA_URL, true).await {
            out.push(info);
        }
    }
    Ok(out)
}

async fn loaded_addons(app: &tauri::AppHandle, state: &AppState) -> Vec<AddonInfo> {
    let mut out = Vec::new();
    for (url, builtin) in addon_urls(app, state).await {
        if let Ok(info) = state.addons.manifest(&url, builtin).await {
            out.push(info);
        }
    }
    out
}

#[tauri::command]
async fn addons_list(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Vec<AddonInfo>, String> {
    Ok(loaded_addons(&app, &state).await)
}

/// Validates the manifest, stores the URL with the profile settings and returns the addon.
#[tauri::command]
async fn addon_add(app: tauri::AppHandle, state: State<'_, AppState>, url: String) -> Result<AddonInfo, String> {
    let url = addons::normalize_manifest_url(&url)?;
    let info = state.addons.manifest(&url, false).await?;
    let uid = settings_user(&app, &state)
        .await
        .ok_or_else(|| crate::errors::code("noSession"))?;
    let _guard = state.settings_lock.lock().await;
    let mut urls = settings::load(&app, &uid)?.addons.urls;
    if !urls.contains(&url) {
        urls.push(url);
    }
    let saved = settings::merge_and_save(&app, &uid, serde_json::json!({ "addons": { "urls": urls } }))?;
    let _ = app.emit("settings://changed", &saved);
    Ok(info)
}

/// Addons of a Stremio account, for the import in the first-run setup and in Settings.
#[tauri::command]
async fn stremio_addons(
    state: State<'_, AppState>,
    email: String,
    password: String,
) -> Result<Vec<addons::ImportedAddon>, String> {
    if email.trim().is_empty() || password.is_empty() {
        return Err("stremio_auth".into());
    }
    state.addons.stremio_collection(&email, &password).await
}

#[tauri::command]
async fn addon_remove(app: tauri::AppHandle, state: State<'_, AppState>, url: String) -> Result<(), String> {
    let url = addons::normalize_manifest_url(&url)?;
    let uid = settings_user(&app, &state)
        .await
        .ok_or_else(|| crate::errors::code("noSession"))?;
    let _guard = state.settings_lock.lock().await;
    let current = settings::load(&app, &uid)?.addons;
    let urls: Vec<String> = current.urls.into_iter().filter(|u| u != &url).collect();
    let disabled: Vec<String> = current.disabled.into_iter().filter(|u| u != &url).collect();
    let cinemeta = if url == addons::CINEMETA_URL { false } else { current.cinemeta };
    let saved = settings::merge_and_save(
        &app,
        &uid,
        serde_json::json!({ "addons": { "urls": urls, "disabled": disabled, "cinemeta": cinemeta } }),
    )?;
    state.addons.forget(&url);
    let _ = app.emit("settings://changed", &saved);
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogArgs {
    addon_url: String,
    #[serde(rename = "type")]
    kind: String,
    id: String,
    #[serde(default)]
    search: Option<String>,
    #[serde(default)]
    genre: Option<String>,
    #[serde(default)]
    skip: Option<u32>,
}

#[tauri::command]
async fn addon_catalog(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    args: CatalogArgs,
) -> Result<Vec<AddonMeta>, String> {
    let url = addons::normalize_manifest_url(&args.addon_url)?;
    let known = addon_urls(&app, &state).await;
    let builtin = known.iter().find(|(u, _)| u == &url).map(|(_, b)| *b);
    let Some(builtin) = builtin else {
        return Err("Addon no configurado".into());
    };
    let info = state.addons.manifest(&url, builtin).await?;
    let mut extra = Vec::new();
    if let Some(search) = args.search.filter(|s| !s.trim().is_empty()) {
        extra.push(("search".to_string(), search.trim().to_string()));
    }
    if let Some(genre) = args.genre.filter(|s| !s.is_empty()) {
        extra.push(("genre".to_string(), genre));
    }
    if let Some(skip) = args.skip.filter(|s| *s > 0) {
        extra.push(("skip".to_string(), skip.to_string()));
    }
    state.addons.catalog(&info, &args.kind, &args.id, &extra).await
}

#[tauri::command]
async fn addon_meta(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    kind: String,
    id: String,
) -> Result<AddonMetaFull, String> {
    let addons = loaded_addons(&app, &state).await;
    state.addons.meta(&addons, &kind, &id).await
}

#[tauri::command]
async fn addon_streams(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    kind: String,
    id: String,
) -> Result<Vec<AddonStream>, String> {
    let addons = loaded_addons(&app, &state).await;
    Ok(state.addons.streams(&addons, &kind, &id).await)
}

#[tauri::command]
async fn addon_progress_list(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Vec<ResumeEntry>, String> {
    // Local entries carry no rating: a profile that hides unrated titles hides them.
    if parental::current().is_some_and(|r| r.hide_unrated) {
        return Ok(vec![]);
    }
    Ok(match settings_user(&app, &state).await {
        Some(uid) => addons::load_progress(&app, &uid),
        None => vec![],
    })
}

#[tauri::command]
async fn addon_progress_remove(app: tauri::AppHandle, state: State<'_, AppState>, key: String) -> Result<(), String> {
    match settings_user(&app, &state).await {
        Some(uid) => addons::remove_progress(&app, &uid, &key),
        None => Ok(()),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetasArgs {
    kind: String,
    ids: Vec<String>,
}

#[tauri::command]
async fn addon_metas(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    args: MetasArgs,
) -> Result<Vec<AddonMeta>, String> {
    let addons = loaded_addons(&app, &state).await;
    Ok(state.addons.metas(&addons, &args.kind, &args.ids).await)
}

#[tauri::command]
async fn addon_library_list(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<addons::LibraryEntry>, String> {
    if parental::current().is_some_and(|r| r.hide_unrated) {
        return Ok(vec![]);
    }
    Ok(match settings_user(&app, &state).await {
        Some(uid) => addons::load_library(&app, &uid),
        None => vec![],
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LibraryFlagArgs {
    entry: addons::LibraryEntry,
    #[serde(default)]
    saved: Option<bool>,
    #[serde(default)]
    watched: Option<bool>,
}

#[tauri::command]
async fn addon_library_set(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    args: LibraryFlagArgs,
) -> Result<Vec<addons::LibraryEntry>, String> {
    let uid = settings_user(&app, &state)
        .await
        .ok_or_else(|| crate::errors::code("noProfile"))?;
    if let Some(watched) = args.watched {
        trakt::spawn_entry_history(&app, &args.entry, watched);
    }
    addons::set_library_flags(&app, &uid, args.entry, args.saved, args.watched)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExternalPlayArgs {
    url: String,
    title: String,
    #[serde(default)]
    headers: Vec<(String, String)>,
    #[serde(default)]
    start_seconds: Option<f64>,
    /// Identity of what is playing, kept with the local progress.
    entry: ResumeEntry,
}

/// Plays an online stream (Stremio addon). The Jellyfin token is never sent along.
#[tauri::command]
async fn player_start_url(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    args: ExternalPlayArgs,
) -> Result<PlayerState, String> {
    if !(args.url.starts_with("http://") || args.url.starts_with("https://")) {
        return Err("Solo se pueden reproducir enlaces http o https".into());
    }
    if args.entry.key.is_empty() {
        return Err("Falta el identificador del título".into());
    }
    let playback = match settings_user(&app, &state).await {
        Some(uid) => settings::load(&app, &uid).unwrap_or_default().playback,
        None => settings::Settings::default().playback,
    };
    let mut prefs = PlaybackPrefs::from_settings(&playback);
    apply_sync_offsets(&app, &state, &args.entry.key, &mut prefs).await;
    let headers: Vec<(String, String)> = args
        .headers
        .into_iter()
        .filter(|(k, _)| !k.eq_ignore_ascii_case("x-emby-token"))
        .collect();
    let ctx = PlaybackContext {
        source: PlaybackSource::Addon {
            entry: args.entry.clone(),
        },
        presence: presence_for_entry(&args.entry),
    };
    state
        .player
        .start(
            &app,
            &args.url,
            &headers,
            &args.title,
            args.start_seconds.unwrap_or(0.0),
            ctx,
            prefs,
        )
        .await?;
    show_player_overlay(&app);
    refresh_presence(&app).await;
    Ok(state.player.snapshot().await)
}

/// Segments for an online episode, by the show's IMDb id (IntroDB only).
#[tauri::command]
async fn get_media_segments_external(
    state: State<'_, AppState>,
    imdb: String,
    season: i32,
    episode: i32,
) -> Result<Vec<MediaSegment>, String> {
    if !imdb.starts_with("tt") || imdb.len() > 16 || !imdb[2..].bytes().all(|b| b.is_ascii_digit()) {
        return Ok(vec![]);
    }
    Ok(state.segments.resolve_external(&imdb, season, episode).await)
}

// ---- IPTV ----

async fn iptv_user(app: &tauri::AppHandle, state: &AppState) -> Result<String, String> {
    settings_user(app, state)
        .await
        .ok_or_else(|| crate::errors::code("noSession"))
}

async fn iptv_prefs(app: &tauri::AppHandle, uid: &str) -> settings::IptvPrefs {
    settings::load(app, uid).unwrap_or_default().iptv
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct IptvStatus {
    sources: Vec<IptvSourceView>,
    loading: bool,
}

/// Sources of the active profile with their loaded state. Puts cached playlists in
/// memory and refreshes missing or stale ones in the background.
#[tauri::command]
async fn iptv_status(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<IptvStatus, String> {
    let uid = iptv_user(&app, &state).await?;
    let sources = iptv::list_sources(&app, &uid);
    let prefs = iptv_prefs(&app, &uid).await;
    state.iptv.ensure(&app, &sources, prefs.auto_refresh, prefs.epg).await;
    Ok(IptvStatus {
        sources: state.iptv.views(&sources).await,
        loading: state.iptv.is_loading().await,
    })
}

/// Creates or edits a source and downloads it right away.
#[tauri::command]
async fn iptv_source_save(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: IptvSourceInput,
) -> Result<IptvSourceView, String> {
    let uid = iptv_user(&app, &state).await?;
    let source = iptv::save_source(&app, &uid, input)?;
    let prefs = iptv_prefs(&app, &uid).await;
    state.iptv.forget(&app, &source.id).await;
    if source.enabled {
        state.iptv.spawn_refresh(&app, source.clone(), prefs.epg).await;
    } else {
        let _ = app.emit(iptv::CHANGED_EVENT, ());
    }
    let views = state.iptv.views(std::slice::from_ref(&source)).await;
    views.into_iter().next().ok_or_else(|| "No se pudo guardar la lista".to_string())
}

/// Imports the content of a playlist file chosen in the UI (there is no file dialog).
#[tauri::command]
async fn iptv_source_import(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: Option<String>,
    name: String,
    file_name: String,
    text: String,
) -> Result<IptvSourceView, String> {
    let uid = iptv_user(&app, &state).await?;
    let source = iptv::import_playlist(&app, &uid, id.as_deref(), &name, &file_name, &text)?;
    let prefs = iptv_prefs(&app, &uid).await;
    state.iptv.forget(&app, &source.id).await;
    state.iptv.spawn_refresh(&app, source.clone(), prefs.epg).await;
    let views = state.iptv.views(std::slice::from_ref(&source)).await;
    views.into_iter().next().ok_or_else(|| "No se pudo importar la lista".to_string())
}

#[tauri::command]
async fn iptv_source_remove(app: tauri::AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    let uid = iptv_user(&app, &state).await?;
    iptv::remove_source(&app, &uid, &id)?;
    state.iptv.forget(&app, &id).await;
    let _ = app.emit(iptv::CHANGED_EVENT, ());
    Ok(())
}

/// Downloads a source again (or every enabled one without `source_id`).
#[tauri::command]
async fn iptv_refresh(app: tauri::AppHandle, state: State<'_, AppState>, source_id: Option<String>) -> Result<(), String> {
    let uid = iptv_user(&app, &state).await?;
    let prefs = iptv_prefs(&app, &uid).await;
    for source in iptv::list_sources(&app, &uid) {
        if !source.enabled || source_id.as_deref().is_some_and(|id| id != source.id) {
            continue;
        }
        state.iptv.spawn_refresh(&app, source, prefs.epg).await;
    }
    Ok(())
}

/// Signs in to an Xtream Codes server without saving anything.
#[tauri::command]
async fn iptv_xtream_check(
    state: State<'_, AppState>,
    url: String,
    username: String,
    password: String,
    user_agent: Option<String>,
) -> Result<XtreamAccount, String> {
    let (base, url_user, url_pass) = iptv::parse_xtream_url(&url)?;
    let username = if username.trim().is_empty() { url_user.unwrap_or_default() } else { username.trim().to_string() };
    let password = if password.is_empty() { url_pass.unwrap_or_default() } else { password };
    if username.is_empty() || password.is_empty() {
        return Err("Xtream Codes necesita usuario y contraseña".into());
    }
    let sealed = protect::protect(password.as_bytes())?;
    let source = iptv::IptvSource {
        kind: iptv::SourceKind::Xtream,
        url: base,
        username,
        password: protect::to_hex(&sealed),
        user_agent: user_agent.unwrap_or_default(),
        ..iptv::IptvSource::default()
    };
    state.iptv.xtream_check(&source).await
}

#[tauri::command]
async fn iptv_groups(app: tauri::AppHandle, state: State<'_, AppState>, source_id: Option<String>) -> Result<Vec<GroupInfo>, String> {
    let uid = iptv_user(&app, &state).await?;
    let sources = iptv::list_sources(&app, &uid);
    Ok(state.iptv.groups(&sources, source_id.as_deref()).await)
}

#[tauri::command]
async fn iptv_channels(app: tauri::AppHandle, state: State<'_, AppState>, query: ChannelQuery) -> Result<ChannelPage, String> {
    let uid = iptv_user(&app, &state).await?;
    let sources = iptv::list_sources(&app, &uid);
    let favorites = iptv::favorites(&app, &uid);
    let recent = iptv::recent(&app, &uid);
    Ok(state.iptv.channels(&sources, &query, &favorites, &recent).await)
}

/// Current and next programme of each channel (only channels with a guide are returned).
#[tauri::command]
async fn iptv_epg_now(state: State<'_, AppState>, ids: Vec<String>) -> Result<std::collections::HashMap<String, EpgNow>, String> {
    let now = addons::now_ms() / 1000;
    Ok(state.iptv.epg_now(&ids, now).await)
}

#[tauri::command]
async fn iptv_epg_channel(state: State<'_, AppState>, id: String) -> Result<Vec<Programme>, String> {
    let now = addons::now_ms() / 1000;
    Ok(state.iptv.epg_channel(&id, now).await)
}

#[tauri::command]
async fn iptv_favorite(app: tauri::AppHandle, state: State<'_, AppState>, id: String, on: bool) -> Result<Vec<String>, String> {
    let uid = iptv_user(&app, &state).await?;
    if iptv::source_of(&id).is_none() {
        return Err("Canal no válido".into());
    }
    iptv::set_favorite(&app, &uid, &id, on)
}

/// Plays a channel: the stream URL (with the Xtream credentials) is resolved here.
#[tauri::command]
async fn iptv_play(app: tauri::AppHandle, state: State<'_, AppState>, id: String) -> Result<PlayerState, String> {
    let uid = iptv_user(&app, &state).await?;
    let (channel, _) = state
        .iptv
        .find(&id)
        .await
        .ok_or_else(|| crate::errors::code("channelNotFound"))?;
    if parental::hides_adult() && iptv::is_adult(&channel) {
        return Err(parental::BLOCKED.into());
    }
    let source = iptv::list_sources(&app, &uid)
        .into_iter()
        .find(|s| s.id == channel.source_id)
        .ok_or_else(|| crate::errors::code("channelListGone"))?;
    let (url, headers) = iptv::stream_for(&source, &channel)?;
    let playback = settings::load(&app, &uid).unwrap_or_default().playback;
    let prefs = PlaybackPrefs {
        // Live TV always plays at normal speed.
        remember_speed: false,
        last_speed: 1.0,
        ..PlaybackPrefs::from_settings(&playback)
    };
    let now = addons::now_ms() / 1000;
    let epg = state.iptv.epg_now(std::slice::from_ref(&id), now).await;
    let programme = epg.get(&id).and_then(|e| e.now.clone());
    let ctx = PlaybackContext {
        source: PlaybackSource::Live { channel_id: id.clone() },
        presence: discord::PresenceInfo {
            title: channel.name.clone(),
            episode: programme.as_ref().map(|p| p.title.clone()),
            year: None,
            kind: "live".into(),
            poster_url: channel.logo.clone().filter(|u| u.starts_with("https://") || u.starts_with("http://")),
            source: source.name.clone(),
            live_window: programme.as_ref().map(|p| (p.start, p.stop)),
        },
    };
    state
        .player
        .start(&app, &url, &headers, &channel.name, 0.0, ctx, prefs)
        .await?;
    let _ = iptv::push_recent(&app, &uid, &id);
    show_player_overlay(&app);
    refresh_presence(&app).await;
    Ok(state.player.snapshot().await)
}

// ---- IPTV: reminders, catch-up and multi-view ----

/// Profile with an open session (reminders never go off on the profile picker).
async fn active_user(state: &AppState) -> Option<String> {
    if let Some(profile) = state.local.read().await.as_ref() {
        return Some(profile.id.clone());
    }
    state.jellyfin.session().await.map(|s| s.user_id)
}

/// Playback preferences for live streams (always normal speed).
fn live_prefs(app: &tauri::AppHandle, uid: &str) -> PlaybackPrefs {
    let playback = settings::load(app, uid).unwrap_or_default().playback;
    PlaybackPrefs {
        remember_speed: false,
        last_speed: 1.0,
        ..PlaybackPrefs::from_settings(&playback)
    }
}

#[tauri::command]
async fn iptv_reminders(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Vec<iptv::Reminder>, String> {
    let uid = iptv_user(&app, &state).await?;
    let hide_adult = parental::hides_adult();
    Ok(iptv::reminders(&app, &uid, addons::now_ms() / 1000)
        .into_iter()
        .filter(|r| !(hide_adult && r.is_adult()))
        .collect())
}

#[tauri::command]
async fn iptv_reminder_set(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    reminder: iptv::Reminder,
) -> Result<Vec<iptv::Reminder>, String> {
    let uid = iptv_user(&app, &state).await?;
    if parental::hides_adult() && reminder.is_adult() {
        return Err(parental::BLOCKED.into());
    }
    let list = iptv::set_reminder(&app, &uid, reminder, addons::now_ms() / 1000)?;
    let _ = app.emit(iptv::REMINDERS_EVENT, ());
    Ok(list)
}

#[tauri::command]
async fn iptv_reminder_remove(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    channel_id: String,
    start: u64,
) -> Result<Vec<iptv::Reminder>, String> {
    let uid = iptv_user(&app, &state).await?;
    let list = iptv::remove_reminder(&app, &uid, &channel_id, start, addons::now_ms() / 1000)?;
    let _ = app.emit(iptv::REMINDERS_EVENT, ());
    Ok(list)
}

/// Checks the reminders of the active profile every few seconds: the ones due are
/// announced to both windows (in-app card with "Watch now") and as a Windows notification.
fn start_reminder_loop(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(15)).await;
            let state = app.state::<AppState>();
            let Some(uid) = active_user(&state).await else { continue };
            let due = iptv::take_due_reminders(&app, &uid, addons::now_ms() / 1000);
            if due.is_empty() {
                continue;
            }
            let en = load_locale(&app).unwrap_or_default() == "en";
            // A restricted profile is never offered an adult channel.
            let hide_adult = parental::hides_adult();
            for reminder in due.iter().filter(|r| !(hide_adult && r.is_adult())) {
                let _ = app.emit(iptv::REMINDER_EVENT, reminder);
                use tauri_plugin_notification::NotificationExt;
                let title = if en { "Starting now" } else { "Empieza ahora" };
                let _ = app
                    .notification()
                    .builder()
                    .title(title)
                    .body(format!("{} · {}", reminder.title, reminder.channel_name))
                    .show();
            }
            let _ = app.emit(iptv::REMINDERS_EVENT, ());
        }
    });
}

/// Plays a past programme of a channel with catch-up (Xtream timeshift or the M3U
/// `catchup-source`). The URL, with the credentials, is built here.
#[tauri::command]
async fn iptv_play_catchup(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    start: u64,
    stop: u64,
    title: String,
) -> Result<PlayerState, String> {
    let uid = iptv_user(&app, &state).await?;
    let (channel, catalog) = state
        .iptv
        .find(&id)
        .await
        .ok_or_else(|| crate::errors::code("channelNotFound"))?;
    if parental::hides_adult() && iptv::is_adult(&channel) {
        return Err(parental::BLOCKED.into());
    }
    let source = iptv::list_sources(&app, &uid)
        .into_iter()
        .find(|s| s.id == channel.source_id)
        .ok_or_else(|| crate::errors::code("channelListGone"))?;
    let now = addons::now_ms() / 1000;
    let url = iptv::catchup_url(&source, &channel, start, stop, now, catalog.server_offset)?;
    let (_, headers) = iptv::stream_for(&source, &channel)?;
    let label = format!("{} · {}", channel.name, title);
    let ctx = PlaybackContext {
        source: PlaybackSource::Live { channel_id: id.clone() },
        presence: discord::PresenceInfo {
            title: channel.name.clone(),
            episode: Some(title.clone()),
            year: None,
            kind: "live".into(),
            poster_url: channel.logo.clone().filter(|u| u.starts_with("https://") || u.starts_with("http://")),
            source: source.name.clone(),
            live_window: None,
        },
    };
    state
        .player
        .start(&app, &url, &headers, &label, 0.0, ctx, live_prefs(&app, &uid))
        .await?;
    show_player_overlay(&app);
    refresh_presence(&app).await;
    Ok(state.player.snapshot().await)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MultiviewStart {
    state: PlayerState,
    /// Channels actually on screen, in cell order (dead streams are left out).
    ids: Vec<String>,
}

/// Watches 2–4 channels at once in a mosaic. Every stream is tried first: mpv fails the
/// whole mosaic when one input cannot be opened.
#[tauri::command]
async fn iptv_multiview(app: tauri::AppHandle, state: State<'_, AppState>, ids: Vec<String>) -> Result<MultiviewStart, String> {
    let uid = iptv_user(&app, &state).await?;
    if !(2..=4).contains(&ids.len()) {
        return Err(crate::errors::code("multiviewCount"));
    }
    let sources = iptv::list_sources(&app, &uid);
    let mut resolved = Vec::new();
    for id in &ids {
        let (channel, catalog) = state
            .iptv
            .find(id)
            .await
            .ok_or_else(|| crate::errors::code("channelNotFound"))?;
        if parental::hides_adult() && iptv::is_adult(&channel) {
            return Err(parental::BLOCKED.into());
        }
        let source = sources
            .iter()
            .find(|s| s.id == channel.source_id)
            .ok_or_else(|| crate::errors::code("channelListGone"))?;
        let (url, headers) = iptv::stream_for(source, &channel)?;
        resolved.push((id.clone(), channel, url, headers, catalog.account.clone()));
    }
    // An Xtream account only serves so many streams at once.
    for (_, channel, _, _, account) in &resolved {
        if let Some(max) = account.as_ref().and_then(|a| a.max_connections).filter(|&m| m > 0) {
            let wanted = resolved.iter().filter(|(_, c, ..)| c.source_id == channel.source_id).count();
            if wanted > max as usize {
                return Err(crate::errors::detail("multiviewConnections", max));
            }
        }
    }
    let targets: Vec<(String, Vec<(String, String)>)> =
        resolved.iter().map(|(_, _, url, headers, _)| (url.clone(), headers.clone())).collect();
    let alive = state.iptv.probe(&targets).await;
    let resolved: Vec<_> = resolved.into_iter().zip(alive).filter(|(_, ok)| *ok).map(|(r, _)| r).collect();
    if resolved.len() < 2 {
        return Err(crate::errors::code("multiviewTooFew"));
    }
    let urls: Vec<String> = resolved.iter().map(|(_, _, url, ..)| url.clone()).collect();
    let names: Vec<String> = resolved.iter().map(|(_, c, ..)| c.name.clone()).collect();
    let (first_id, first, _, headers, _) = &resolved[0];
    let title = names.join(" · ");
    let ctx = PlaybackContext {
        source: PlaybackSource::Live { channel_id: first_id.clone() },
        presence: discord::PresenceInfo {
            title: title.clone(),
            episode: None,
            year: None,
            kind: "live".into(),
            poster_url: first.logo.clone().filter(|u| u.starts_with("https://") || u.starts_with("http://")),
            source: String::new(),
            live_window: None,
        },
    };
    state
        .player
        .start_multiview(&app, &urls, headers, &title, ctx, live_prefs(&app, &uid))
        .await?;
    show_player_overlay(&app);
    refresh_presence(&app).await;
    Ok(MultiviewStart {
        state: state.player.snapshot().await,
        ids: resolved.into_iter().map(|(id, ..)| id).collect(),
    })
}

#[tauri::command]
async fn player_multiview_audio(state: State<'_, AppState>, index: usize) -> Result<(), String> {
    state.player.multiview_audio(index).await
}

// ---- downloads ----

/// Saves an online source (an addon stream) to the Downloads folder. The URL and the
/// addon headers stay in Rust; the Jellyfin token is never attached.
#[tauri::command]
async fn download_stream(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    args: downloads::StartArgs,
) -> Result<downloads::DownloadItem, String> {
    state.downloads.start(&app, args)
}

#[tauri::command]
async fn downloads_list(state: State<'_, AppState>) -> Result<Vec<downloads::DownloadItem>, String> {
    Ok(state.downloads.list())
}

#[tauri::command]
async fn download_cancel(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.downloads.cancel(&app, &id);
    Ok(())
}

/// Drops the entry. A finished file stays on disk; a partial one is deleted.
#[tauri::command]
async fn download_remove(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.downloads.remove(&app, &id);
    Ok(())
}

#[tauri::command]
async fn downloads_clear(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.downloads.clear_finished(&app);
    Ok(())
}

/// Opens the file in Explorer (selected), or its folder while it is still downloading.
#[tauri::command]
async fn download_reveal(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.downloads.reveal(&id)
}

// ---- discovery: custom lists, calendar, shuffle, recommendations ----

/// Profile whose lists are being edited; unlike reads, writes need an active one.
async fn lists_user(app: &tauri::AppHandle, state: &AppState) -> Result<String, String> {
    if state.local.read().await.is_none() && state.jellyfin.session().await.is_none() {
        return Err(crate::errors::code("noProfile"));
    }
    settings_user(app, state).await.ok_or_else(|| crate::errors::code("noProfile"))
}

#[tauri::command]
async fn custom_lists_get(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Vec<lists::CustomList>, String> {
    Ok(match settings_user(&app, &state).await {
        Some(uid) => lists::load(&app, &uid),
        None => vec![],
    })
}

#[tauri::command]
async fn custom_list_create(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    name: String,
) -> Result<Vec<lists::CustomList>, String> {
    let uid = lists_user(&app, &state).await?;
    lists::create(&app, &uid, &name)
}

#[tauri::command]
async fn custom_list_rename(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<Vec<lists::CustomList>, String> {
    let uid = lists_user(&app, &state).await?;
    lists::rename(&app, &uid, &id, &name)
}

#[tauri::command]
async fn custom_list_delete(app: tauri::AppHandle, state: State<'_, AppState>, id: String) -> Result<Vec<lists::CustomList>, String> {
    let uid = lists_user(&app, &state).await?;
    lists::delete(&app, &uid, &id)
}

#[tauri::command]
async fn custom_list_set_item(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    item: lists::ListItem,
    on: bool,
) -> Result<Vec<lists::CustomList>, String> {
    let uid = lists_user(&app, &state).await?;
    lists::set_item(&app, &uid, &id, item, on)
}

#[tauri::command]
async fn calendar_seen_get(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<u64, String> {
    Ok(match settings_user(&app, &state).await {
        Some(uid) => lists::calendar_seen(&app, &uid),
        None => 0,
    })
}

#[tauri::command]
async fn calendar_seen_set(app: tauri::AppHandle, state: State<'_, AppState>, ms: u64) -> Result<(), String> {
    let uid = lists_user(&app, &state).await?;
    lists::set_calendar_seen(&app, &uid, ms)
}

#[tauri::command]
async fn get_items_by_ids(state: State<'_, AppState>, ids: Vec<String>) -> Result<Vec<Movie>, String> {
    state.jellyfin.items_by_ids(&ids).await
}

#[tauri::command]
async fn get_random_episode(
    state: State<'_, AppState>,
    series_id: String,
    exclude: Vec<String>,
) -> Result<Option<Movie>, String> {
    state.jellyfin.random_episode(&series_id, &exclude).await
}

#[tauri::command]
async fn get_calendar(state: State<'_, AppState>, days_back: u32) -> Result<jellyfin::CalendarData, String> {
    state.jellyfin.calendar(days_back).await
}

#[tauri::command]
async fn get_recommendations(state: State<'_, AppState>) -> Result<Vec<jellyfin::RecommendationRow>, String> {
    state.jellyfin.recommendations().await
}

#[tauri::command]
async fn search_people(state: State<'_, AppState>, query: String) -> Result<Vec<jellyfin::Person>, String> {
    state.jellyfin.search_people(&query).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState::new())
        .register_asynchronous_uri_scheme_protocol(jellyfin::IMAGE_SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                responder.respond(proxy_jellyfin_image(&app, request.uri()).await);
            });
        })
        .invoke_handler(tauri::generate_handler![
            probe_server,
            login,
            session_restore,
            logout,
            logout_server,
            saved_server,
            list_public_users,
            local_profiles_list,
            local_profile_create,
            local_profile_update,
            local_profile_delete,
            local_profile_enter,
            link_server,
            unlink_server,
            browse_items,
            get_genres,
            discord_status,
            get_libraries,
            get_home,
            get_item,
            get_seasons,
            get_episodes,
            get_next_episode,
            get_series_next_up,
            search_items,
            get_similar,
            get_favorites,
            set_favorite,
            set_played,
            get_media_segments,
            get_media_segments_external,
            addons_list,
            addon_add,
            addon_remove,
            stremio_addons,
            probe_server_only,
            person_items,
            player_set_prop,
            player_props,
            player_sub_add_text,
            torrent_status,
            addon_catalog,
            addon_meta,
            addon_streams,
            addon_progress_list,
            addon_progress_remove,
            addon_metas,
            addon_library_list,
            addon_library_set,
            iptv_status,
            iptv_source_save,
            iptv_source_import,
            iptv_source_remove,
            iptv_refresh,
            iptv_xtream_check,
            iptv_groups,
            iptv_channels,
            iptv_epg_now,
            iptv_epg_channel,
            iptv_favorite,
            iptv_play,
            download_stream,
            downloads_list,
            download_cancel,
            download_remove,
            downloads_clear,
            download_reveal,
            player_start_url,
            player_start,
            player_stop,
            player_toggle_pause,
            player_seek,
            player_set_volume,
            player_set_mute,
            player_set_track,
            player_state,
            player_set_fullscreen,
            player_set_speed,
            player_set_aspect,
            update_info,
            dismiss_update,
            update_check,
            update_prefs,
            update_set_auto,
            update_skip,
            update_download,
            update_install,
            open_external,
            locale_get,
            locale_set,
            settings_get,
            settings_set,
            account::account_status,
            account::account_sign_up,
            account::account_sign_in,
            account::account_mfa_verify,
            account::account_mfa_enroll,
            account::account_mfa_confirm,
            account::account_mfa_disable,
            account::account_resend_confirmation,
            account::account_reset_password,
            account::account_sign_out,
            account::account_delete,
            account::account_set_credentials,
            account::account_dismiss_prompt,
            account::account_sync_now,
            session_current,
            torrent_resolve,
            torrent_cache_info,
            torrent_cache_clear,
            torrent_pause_all,
            addons_all,
            // profiles & integrations
            local_profile_check_pin,
            parental::parental_status,
            parental::parental_set,
            trakt::trakt_status,
            trakt::trakt_set_app,
            trakt::trakt_device_start,
            trakt::trakt_device_poll,
            trakt::trakt_disconnect,
            trakt::trakt_set_sync_back,
            trakt::trakt_import,
            trakt::trakt_open,
            // player
            player_set_delay,
            player_set_night,
            player_set_credits,
            player_set_mini,
            player_mini_drag,
            opensubtitles_search,
            opensubtitles_download,
            opensubtitles_has_password,
            opensubtitles_set_password,
            // discovery
            custom_lists_get,
            custom_list_create,
            custom_list_rename,
            custom_list_delete,
            custom_list_set_item,
            calendar_seen_get,
            calendar_seen_set,
            get_items_by_ids,
            get_random_episode,
            get_calendar,
            get_recommendations,
            search_people,
            // livetv
            iptv_reminders,
            iptv_reminder_set,
            iptv_reminder_remove,
            iptv_play_catchup,
            iptv_multiview,
            player_multiview_audio,
            // watch party
            party::party_start,
            party::party_join,
            party::party_leave,
            party::party_status,
            party::party_send,
            party::party_set_title,
            party::party_set_open,
            party::party_player_pause,
            party::party_find_library_item,
        ])
        .setup(|app| {
            let state = app.state::<AppState>();
            let handle = app.handle().clone();
            protect_store_file(&handle);
            if let Err(err) = open_store(&handle) {
                eprintln!("store: {err}");
            }
            if let Some(window) = app.get_webview_window("main") {
                if let Err(err) = create_player_overlay(&handle, &window) {
                    eprintln!("player overlay: {err}");
                }
                let _ = state.player.attach_window(&window);
                let player = state.player.clone();
                let events = handle.clone();
                window.on_window_event(move |event| {
                    if matches!(
                        event,
                        tauri::WindowEvent::Resized(_)
                            | tauri::WindowEvent::Moved(_)
                            | tauri::WindowEvent::ScaleFactorChanged { .. }
                    ) {
                        player.resize();
                        sync_player_overlay(&events);
                    }
                });
            }
            state.downloads.load(&handle);
            state.discord.spawn();
            account::start_sync_loop(handle.clone());
            start_reminder_loop(handle.clone());
            start_progress_loop(handle, state.player.clone(), state.jellyfin.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ejFlix");
}
