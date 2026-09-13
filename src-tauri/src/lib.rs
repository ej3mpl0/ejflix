mod addons;
mod discord;
mod jellyfin;
mod player;
mod profiles;
mod protect;
mod segments;
mod settings;
mod update;

use std::sync::Arc;
use std::time::Duration;

use jellyfin::{
    BrowseArgs, HomeData, JellyfinClient, Library, Movie, PublicInfo, PublicUser, SavedServer,
    Session,
};
use profiles::{LocalProfile, LocalProfileView, ProfilePatch};
use addons::{AddonClient, AddonInfo, AddonMeta, AddonMetaFull, AddonStream, ResumeEntry};
use player::{PlaybackContext, PlaybackPrefs, PlaybackSource, Player, PlayerState};
use segments::{MediaSegment, SegmentsCache};
use serde::Deserialize;
use settings::Settings;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;
use uuid::Uuid;

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
    let info = &ctx.presence;
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
        .ok_or_else(|| "No hay sesión activa".to_string())?;
    let _guard = state.settings_lock.lock().await;
    let saved = settings::merge_and_save(&app, &uid, patch)?;
    let _ = app.emit("settings://changed", &saved);
    drop(_guard);
    refresh_presence(&app).await;
    Ok(saved)
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
        .ok_or_else(|| "No hay sesión activa".to_string())
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
) -> Result<LocalProfileView, String> {
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
) -> Result<(), String> {
    let is_active = state.local.read().await.as_ref().is_some_and(|p| p.id == id);
    if is_active {
        let _ = state.player.stop().await;
        *state.local.write().await = None;
        state.jellyfin.set_session(None).await;
    }
    profiles::delete(&app, &id)
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
    profiles::set_active(&app, Some(&profile.id))?;
    *state.local.write().await = Some(profile.clone());
    restore_linked_session(&app, &state, &profile.id).await;
    account_view(&app, &state)
        .await
        .ok_or_else(|| "No hay sesión activa".to_string())
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
        .ok_or_else(|| "No hay sesión activa".to_string())
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
        .ok_or_else(|| "No hay sesión activa".to_string())
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
    state.segments.clear().await;
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
    state.segments.clear().await;
    profiles::set_active(&app, None)?;
    clear_session(&app)?;
    clear_profiles(&app)?;
    clear_server(&app)
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
async fn set_played(state: State<'_, AppState>, item_id: String, played: bool) -> Result<bool, String> {
    state.jellyfin.set_played(&item_id, played).await
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
        return Err("Ítem no válido".into());
    }
    let movie = state.jellyfin.get_item(&args.item_id).await?;
    let session = state.jellyfin.require_session().await?;
    let playback = settings::load(&app, &session.user_id)
        .unwrap_or_default()
        .playback;
    let prefs = PlaybackPrefs {
        audio_language: playback.audio_language,
        subtitle_language: playback.subtitle_language,
        remember_speed: playback.remember_speed,
        last_speed: playback.last_speed,
    };
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
    if let Some((ctx, time, duration)) = state.player.stop().await? {
        match ctx.source {
            PlaybackSource::Jellyfin {
                item_id,
                media_source_id,
                play_session_id,
            } => {
                let _ = state
                    .jellyfin
                    .report_stop(
                        &item_id,
                        media_source_id.as_deref(),
                        &play_session_id,
                        seconds_to_ticks(time),
                    )
                    .await;
            }
            PlaybackSource::Addon { entry } => {
                if let Some(uid) = settings_user(&app, &state).await {
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
        }
    }
    refresh_presence(&app).await;
    if switching.unwrap_or(false) {
        return Ok(());
    }
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
    let store = app.store("session.json").map_err(|e| e.to_string())?;
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
    let store = app.store("session.json").map_err(|e| e.to_string())?;
    store.set("updateAuto", serde_json::Value::Bool(auto));
    store.save().map_err(|e| e.to_string())?;
    load_update_prefs(&app)
}

/// Remember (or forget, with an empty string) a version the user does not want to see again.
#[tauri::command]
fn update_skip(app: tauri::AppHandle, version: String) -> Result<update::UpdatePrefs, String> {
    let store = app.store("session.json").map_err(|e| e.to_string())?;
    let clean = update::parse_version(&version)
        .map(|(a, b, c)| format!("{a}.{b}.{c}"))
        .unwrap_or_default();
    store.set("updateSkipped", serde_json::Value::String(clean));
    store.save().map_err(|e| e.to_string())?;
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
    const ALLOWED: [&str; 3] = [
        "https://github.com/",
        "https://discord.com/developers/",
        "https://introdb.app/",
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
    let store = app.store("session.json").map_err(|e| e.to_string())?;
    let raw = serde_json::to_vec(session).map_err(|e| e.to_string())?;
    let sealed = protect::protect(&raw)?;
    store.set(
        key,
        serde_json::json!({
            "v": 2,
            "blob": protect::to_hex(&sealed),
        }),
    );
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

fn load_session(app: &tauri::AppHandle) -> Result<Option<Session>, String> {
    load_session_at(app, "data")
}

fn load_session_at(app: &tauri::AppHandle, key: &str) -> Result<Option<Session>, String> {
    let store = app.store("session.json").map_err(|e| e.to_string())?;
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
    let store = app.store("session.json").map_err(|e| e.to_string())?;
    store.delete(key);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

fn save_server(app: &tauri::AppHandle, url: &str, name: &str) -> Result<(), String> {
    let store = app.store("session.json").map_err(|e| e.to_string())?;
    store.set("serverUrl", serde_json::Value::String(url.to_string()));
    if !name.is_empty() {
        store.set("serverName", serde_json::Value::String(name.to_string()));
    }
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

fn load_server(app: &tauri::AppHandle) -> Result<Option<SavedServer>, String> {
    let store = app.store("session.json").map_err(|e| e.to_string())?;
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
    let store = app.store("session.json").map_err(|e| e.to_string())?;
    store.delete("serverUrl");
    store.delete("serverName");
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

fn load_profiles(app: &tauri::AppHandle) -> Result<Vec<PublicUser>, String> {
    let store = app.store("session.json").map_err(|e| e.to_string())?;
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
    let store = app.store("session.json").map_err(|e| e.to_string())?;
    store.set(
        "profiles",
        serde_json::to_value(&profiles).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

fn clear_profiles(app: &tauri::AppHandle) -> Result<(), String> {
    let store = app.store("session.json").map_err(|e| e.to_string())?;
    store.delete("profiles");
    store.save().map_err(|e| e.to_string())?;
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

fn load_device_id(app: &tauri::AppHandle) -> Option<String> {
    let store = app.store("session.json").ok()?;
    store
        .get("deviceId")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .filter(|s| !s.is_empty())
}

fn save_device_id(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let store = app.store("session.json").map_err(|e| e.to_string())?;
    store.set("deviceId", serde_json::Value::String(id.to_string()));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

fn load_last_seen_version(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    let store = app.store("session.json").map_err(|e| e.to_string())?;
    Ok(store
        .get("lastSeenVersion")
        .and_then(|v| v.as_str().map(|s| s.to_string())))
}

fn load_locale(app: &tauri::AppHandle) -> Result<String, String> {
    let store = app.store("session.json").map_err(|e| e.to_string())?;
    Ok(store
        .get("locale")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .filter(|s| s == "en" || s == "es")
        .unwrap_or_default())
}

fn save_locale(app: &tauri::AppHandle, locale: &str) -> Result<(), String> {
    let store = app.store("session.json").map_err(|e| e.to_string())?;
    store.set("locale", serde_json::Value::String(locale.to_string()));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

fn save_last_seen_version(app: &tauri::AppHandle, version: &str) -> Result<(), String> {
    let store = app.store("session.json").map_err(|e| e.to_string())?;
    store.set("lastSeenVersion", serde_json::Value::String(version.to_string()));
    store.save().map_err(|e| e.to_string())?;
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
            }
            let _ = app.emit("player://state", snap);
            refresh_presence(&app).await;
        }
    });
}

// ---- Stremio addons ----

/// Manifest URLs to consult, in priority order (built-in Cinemeta last).
async fn addon_urls(app: &tauri::AppHandle, state: &AppState) -> Vec<(String, bool)> {
    let prefs = match settings_user(app, state).await {
        Some(uid) => settings::load(app, &uid).unwrap_or_default().addons,
        None => settings::Settings::default().addons,
    };
    let mut list: Vec<(String, bool)> = prefs.urls.into_iter().map(|u| (u, false)).collect();
    if prefs.cinemeta && !list.iter().any(|(u, _)| u == addons::CINEMETA_URL) {
        list.push((addons::CINEMETA_URL.to_string(), true));
    }
    list
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
        .ok_or_else(|| "No hay sesión activa".to_string())?;
    let _guard = state.settings_lock.lock().await;
    let mut urls = settings::load(&app, &uid)?.addons.urls;
    if !urls.contains(&url) {
        urls.push(url);
    }
    let saved = settings::merge_and_save(&app, &uid, serde_json::json!({ "addons": { "urls": urls } }))?;
    let _ = app.emit("settings://changed", &saved);
    Ok(info)
}

#[tauri::command]
async fn addon_remove(app: tauri::AppHandle, state: State<'_, AppState>, url: String) -> Result<(), String> {
    let url = addons::normalize_manifest_url(&url)?;
    let uid = settings_user(&app, &state)
        .await
        .ok_or_else(|| "No hay sesión activa".to_string())?;
    let _guard = state.settings_lock.lock().await;
    let current = settings::load(&app, &uid)?.addons;
    let urls: Vec<String> = current.urls.into_iter().filter(|u| u != &url).collect();
    let cinemeta = if url == addons::CINEMETA_URL { false } else { current.cinemeta };
    let saved = settings::merge_and_save(
        &app,
        &uid,
        serde_json::json!({ "addons": { "urls": urls, "cinemeta": cinemeta } }),
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
    let prefs = PlaybackPrefs {
        audio_language: playback.audio_language,
        subtitle_language: playback.subtitle_language,
        remember_speed: playback.remember_speed,
        last_speed: playback.last_speed,
    };
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
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
            addon_catalog,
            addon_meta,
            addon_streams,
            addon_progress_list,
            addon_progress_remove,
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
        ])
        .setup(|app| {
            let state = app.state::<AppState>();
            let handle = app.handle().clone();
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
            state.discord.spawn();
            start_progress_loop(handle, state.player.clone(), state.jellyfin.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ejFlix");
}
