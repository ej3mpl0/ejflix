mod jellyfin;
mod player;
mod protect;

use std::sync::Arc;
use std::time::Duration;

use jellyfin::{
    HomeData, JellyfinClient, Library, Movie, PublicInfo, PublicUser, SavedServer, Session,
    SessionView,
};
use player::{PlaybackContext, Player, PlayerState};
use serde::Deserialize;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;
use uuid::Uuid;

pub struct AppState {
    pub jellyfin: JellyfinClient,
    pub player: Arc<Player>,
}

impl AppState {
    fn new() -> Self {
        Self {
            jellyfin: JellyfinClient::new(),
            player: Arc::new(Player::new()),
        }
    }
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
) -> Result<SessionView, String> {
    let device_id = existing_device_id(&app).unwrap_or_else(|| Uuid::new_v4().to_string());
    let session = state
        .jellyfin
        .login(&url, &username, &password, &device_id)
        .await?;
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
    Ok(session.view())
}

#[tauri::command]
async fn session_restore(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Option<SessionView>, String> {
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
            Ok(Some(valid.view()))
        }
        Err(_) => {
            clear_session(&app)?;
            state.jellyfin.set_session(None).await;
            Ok(None)
        }
    }
}

#[tauri::command]
async fn logout(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let _ = state.player.stop().await;
    state.jellyfin.set_session(None).await;
    clear_session(&app)
}

#[tauri::command]
async fn logout_server(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let _ = state.player.stop().await;
    state.jellyfin.set_session(None).await;
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
    let start = args.start_seconds.unwrap_or(0.0);
    let play_session_id = Uuid::new_v4().to_string();
    let media_source_id = args
        .media_source_id
        .clone()
        .or(movie.media_source_id.clone());
    let ctx = PlaybackContext {
        item_id: movie.id.clone(),
        media_source_id: media_source_id.clone(),
        play_session_id: play_session_id.clone(),
    };
    state
        .player
        .start(
            &app,
            &movie.stream_url,
            &session.token,
            &args.title,
            start,
            ctx,
        )
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
    if let Some((ctx, ticks)) = state.player.stop().await? {
        let _ = state
            .jellyfin
            .report_stop(
                &ctx.item_id,
                ctx.media_source_id.as_deref(),
                &ctx.play_session_id,
                ticks,
            )
            .await;
    }
    if switching.unwrap_or(false) {
        return Ok(());
    }
    hide_player_overlay(&app);
    if let Some(window) = app.get_webview_window("main") {
        set_main_fullscreen(&window, false)?;
        let _ = window.set_background_color(Some(tauri::window::Color(11, 11, 14, 255)));
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
async fn player_toggle_pause(state: State<'_, AppState>) -> Result<(), String> {
    state.player.toggle_pause().await
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
    let store = app.store("session.json").map_err(|e| e.to_string())?;
    let raw = serde_json::to_vec(session).map_err(|e| e.to_string())?;
    let sealed = protect::protect(&raw)?;
    store.set(
        "data",
        serde_json::json!({
            "v": 2,
            "blob": protect::to_hex(&sealed),
        }),
    );
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

fn load_session(app: &tauri::AppHandle) -> Result<Option<Session>, String> {
    let store = app.store("session.json").map_err(|e| e.to_string())?;
    let Some(value) = store.get("data") else {
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
    let _ = save_session(app, &session);
    Ok(Some(session))
}

fn clear_session(app: &tauri::AppHandle) -> Result<(), String> {
    let store = app.store("session.json").map_err(|e| e.to_string())?;
    store.delete("data");
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
            let _ = jellyfin
                .report_progress(
                    &ctx.item_id,
                    ctx.media_source_id.as_deref(),
                    &ctx.play_session_id,
                    seconds_to_ticks(snap.time),
                    snap.paused,
                    snap.volume as i32,
                    snap.mute,
                )
                .await;
            let _ = app.emit("player://state", snap);
        }
    });
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
            get_libraries,
            get_home,
            get_item,
            get_seasons,
            get_episodes,
            get_next_episode,
            get_series_next_up,
            search_items,
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
            update_info,
            dismiss_update,
            locale_get,
            locale_set,
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
            start_progress_loop(handle, state.player.clone(), state.jellyfin.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ejFlix");
}
