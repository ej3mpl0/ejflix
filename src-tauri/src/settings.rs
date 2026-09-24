//! Per-profile user settings, stored in the app data store under `settings.<userId>`.
//!
//! The frontend sends partial patches (`settings_set`); Rust deep-merges them into the
//! stored object, fills every missing field with its default and clamps anything a
//! hand-edited or outdated file could contain, so both windows always see a complete,
//! valid `Settings` value.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri_plugin_store::StoreExt;

pub const THEME_IDS: &[&str] = &[
    "white", "gold", "jade", "rose_gold", "arctic", "graphite", "crimson", "ocean", "violet",
    "emerald", "amber", "rose",
];
pub const DEFAULT_THEME: &str = "crimson";
pub const COUNTDOWNS: &[u32] = &[0, 5, 10, 15];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub appearance: Appearance,
    pub playback: Playback,
    pub library: LibraryPrefs,
    pub addons: AddonPrefs,
    pub discord: DiscordPrefs,
    pub iptv: IptvPrefs,
    pub torrents: TorrentPrefs,
    pub onboarding: OnboardingPrefs,
}

/// First-run setup of a profile (torrents, addon import).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OnboardingPrefs {
    /// The setup step was completed or skipped. Profiles saved before the step existed
    /// count as done (see `legacy_done`), so updating never shows it to them.
    pub setup_done: bool,
}

/// A stored settings object from before the setup step has no `onboarding` key.
fn legacy_done(value: &Value, settings: &mut Settings) {
    if value.get("onboarding").is_none() {
        settings.onboarding.setup_done = true;
    }
}

/// Built-in torrent playback (addon sources that come as a bare info hash).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TorrentPrefs {
    pub enabled: bool,
    /// Upload to other peers while watching.
    pub share: bool,
    /// Disk the downloaded files may take before the oldest are dropped.
    pub cache_gb: u32,
    /// Upload cap in KB/s while sharing; 0 = none. Capped by default: a saturated
    /// upload link stalls every other request the app makes.
    pub upload_kbps: u32,
    /// Download cap in KB/s; 0 = none.
    pub download_kbps: u32,
}

impl Default for TorrentPrefs {
    fn default() -> Self {
        Self {
            enabled: true,
            share: true,
            cache_gb: 5,
            upload_kbps: 512,
            download_kbps: 0,
        }
    }
}

/// Live TV (IPTV lists).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IptvPrefs {
    /// Download the playlists and guides again on launch when older than 12 hours.
    pub auto_refresh: bool,
    /// Fetch the XMLTV programme guide (can be large).
    pub epg: bool,
    /// Zapping with the mouse wheel over the video (instead of volume).
    pub wheel_zap: bool,
}

impl Default for IptvPrefs {
    fn default() -> Self {
        Self {
            auto_refresh: true,
            epg: true,
            wheel_zap: false,
        }
    }
}

/// Discord Rich Presence. Templates accept `{title}`, `{episode}`, `{year}`, `{type}`
/// and `{source}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DiscordPrefs {
    pub enabled: bool,
    /// Kept for stores written by older versions; the app always uses its own
    /// application id, so that Discord shows the ejFlix name and artwork.
    #[serde(skip_serializing)]
    pub client_id: String,
    pub details: String,
    pub state: String,
    pub show_poster: bool,
    pub show_time: bool,
    /// Keep the presence (marked as paused) while playback is paused.
    pub show_paused: bool,
    /// What Discord prints after "Watching": "name" (the application), "details" or "state".
    pub header: String,
}

impl Default for DiscordPrefs {
    fn default() -> Self {
        Self {
            enabled: false,
            client_id: String::new(),
            details: "{title}".into(),
            state: "{episode}".into(),
            show_poster: true,
            show_time: true,
            show_paused: true,
            header: "details".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AddonPrefs {
    /// Stremio addon manifest URLs, in priority order.
    pub urls: Vec<String>,
    /// Keep Cinemeta (Stremio's public catalog/metadata addon) as a built-in addon.
    pub cinemeta: bool,
    /// Addons kept in `urls` but switched off: no catalogs, no sources.
    pub disabled: Vec<String>,
}

impl Default for AddonPrefs {
    fn default() -> Self {
        Self {
            urls: Vec::new(),
            cinemeta: true,
            disabled: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Appearance {
    /// One of `THEME_IDS`.
    pub theme: String,
    pub amoled: bool,
    pub poster_size: PosterSize,
    /// Muted trailers play behind the Home hero and the details backdrop
    /// (a missing field takes the struct default: on).
    pub autoplay_trailers: bool,
    /// The accent follows the artwork on screen instead of `theme`.
    pub auto_accent: bool,
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            theme: DEFAULT_THEME.to_string(),
            amoled: false,
            poster_size: PosterSize::Medium,
            autoplay_trailers: true,
            auto_accent: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PosterSize {
    Small,
    Large,
    #[default]
    #[serde(other)]
    Medium,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkipMode {
    Auto,
    Off,
    #[default]
    #[serde(other)]
    Ask,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Playback {
    pub skip_intro: SkipMode,
    pub skip_recap: SkipMode,
    pub skip_outro: SkipMode,
    /// Seconds before the next episode starts by itself; 0 = never (manual).
    pub next_episode_countdown: u32,
    /// "" = file default, else an ISO 639-2 code such as "spa".
    pub audio_language: String,
    /// "" = file default, "off" = no subtitles, else an ISO 639-2 code.
    pub subtitle_language: String,
    pub remember_speed: bool,
    pub last_speed: f64,
    pub show_time_remaining: bool,
    /// Subtitle size factor (mpv sub-scale), 0.5 to 2.5.
    pub sub_scale: f64,
    /// Subtitle text colour, "#RRGGBB".
    pub sub_color: String,
    /// "outline", "shadow" or "box".
    pub sub_background: String,
    /// Seconds the arrow keys and the seek buttons jump: 5, 10, 15 or 30.
    pub seek_step: u32,
    /// Percentage of the runtime past which stopping marks the title watched
    /// (80, 85, 90 or 95); stopping inside the detected credits counts too.
    #[serde(default = "default_watched_threshold")]
    pub watched_threshold: u32,
    /// Night mode (dynamic range compression) on when playback starts.
    #[serde(default)]
    pub night_mode: bool,
    /// Vertical subtitle position (mpv sub-pos): 100 = bottom, lower = higher up.
    #[serde(default = "default_sub_pos")]
    pub sub_pos: f64,
    /// Subtitle outline thickness (mpv sub-outline-size), 0 to 6.
    #[serde(default = "default_sub_outline")]
    pub sub_outline: f64,
    /// Apply the look to styled (ASS/SSA) subtitles as well.
    #[serde(default)]
    pub sub_ass_override: bool,
    /// OpenSubtitles.com API key for the online subtitle search ("" = not set).
    #[serde(default)]
    pub opensubtitles_api_key: String,
    /// Optional OpenSubtitles.com username (the password is kept apart, encrypted).
    #[serde(default)]
    pub opensubtitles_user: String,
}

fn default_watched_threshold() -> u32 {
    90
}

fn default_sub_pos() -> f64 {
    100.0
}

fn default_sub_outline() -> f64 {
    3.0
}

impl Default for Playback {
    fn default() -> Self {
        Self {
            skip_intro: SkipMode::Ask,
            skip_recap: SkipMode::Ask,
            skip_outro: SkipMode::Ask,
            next_episode_countdown: 5,
            audio_language: String::new(),
            subtitle_language: String::new(),
            remember_speed: false,
            last_speed: 1.0,
            show_time_remaining: false,
            sub_scale: 1.0,
            sub_color: "#FFFFFF".into(),
            sub_background: "outline".into(),
            seek_step: 10,
            watched_threshold: default_watched_threshold(),
            night_mode: false,
            sub_pos: default_sub_pos(),
            sub_outline: default_sub_outline(),
            sub_ass_override: false,
            opensubtitles_api_key: String::new(),
            opensubtitles_user: String::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LibraryPrefs {
    /// Ids of the Jellyfin libraries pinned as header tabs.
    pub pinned: Vec<String>,
}

impl Settings {
    /// Clamp / coerce everything a hand-edited or old file could contain.
    pub fn sanitized(mut self) -> Self {
        if !THEME_IDS.contains(&self.appearance.theme.as_str()) {
            self.appearance.theme = DEFAULT_THEME.to_string();
        }
        if !COUNTDOWNS.contains(&self.playback.next_episode_countdown) {
            self.playback.next_episode_countdown = 5;
        }
        self.playback.audio_language = lang_or_empty(&self.playback.audio_language, false);
        self.playback.subtitle_language = lang_or_empty(&self.playback.subtitle_language, true);
        self.playback.last_speed = if self.playback.last_speed.is_finite() {
            self.playback.last_speed.clamp(0.25, 4.0)
        } else {
            1.0
        };
        self.playback.sub_scale = if self.playback.sub_scale.is_finite() {
            self.playback.sub_scale.clamp(0.5, 2.5)
        } else {
            1.0
        };
        if !crate::player::valid_sub_color(&self.playback.sub_color) {
            self.playback.sub_color = "#FFFFFF".into();
        }
        if ![5, 10, 15, 30].contains(&self.playback.seek_step) {
            self.playback.seek_step = 10;
        }
        if !["outline", "shadow", "box"].contains(&self.playback.sub_background.as_str()) {
            self.playback.sub_background = "outline".into();
        }
        if ![80, 85, 90, 95].contains(&self.playback.watched_threshold) {
            self.playback.watched_threshold = default_watched_threshold();
        }
        self.playback.sub_pos = if self.playback.sub_pos.is_finite() {
            self.playback.sub_pos.clamp(50.0, 100.0).round()
        } else {
            default_sub_pos()
        };
        self.playback.sub_outline = if self.playback.sub_outline.is_finite() {
            self.playback.sub_outline.clamp(0.0, 6.0)
        } else {
            default_sub_outline()
        };
        // API keys are short alphanumeric tokens; anything else is a paste accident.
        let key = self.playback.opensubtitles_api_key.trim();
        self.playback.opensubtitles_api_key = if key.len() <= 128 && key.bytes().all(|b| b.is_ascii_alphanumeric()) {
            key.to_string()
        } else {
            String::new()
        };
        self.playback.opensubtitles_user = self.playback.opensubtitles_user.trim().chars().take(100).collect();
        self.library.pinned.retain(|id| crate::jellyfin::valid_item_id(id));
        let mut seen = std::collections::HashSet::new();
        self.library.pinned.retain(|id| seen.insert(id.clone()));
        self.library.pinned.truncate(24);
        self.addons.urls = self
            .addons
            .urls
            .iter()
            .filter_map(|u| crate::addons::normalize_manifest_url(u).ok())
            .collect();
        let mut seen_urls = std::collections::HashSet::new();
        self.addons.urls.retain(|u| seen_urls.insert(u.clone()));
        self.addons.urls.truncate(30);
        let urls = self.addons.urls.clone();
        let mut disabled: Vec<String> = self
            .addons
            .disabled
            .iter()
            .filter_map(|u| crate::addons::normalize_manifest_url(u).ok())
            .filter(|u| urls.contains(u))
            .collect();
        let mut seen_off = std::collections::HashSet::new();
        disabled.retain(|u| seen_off.insert(u.clone()));
        self.addons.disabled = disabled;
        self.torrents.upload_kbps = self.torrents.upload_kbps.min(1_000_000);
        self.torrents.download_kbps = self.torrents.download_kbps.min(1_000_000);
        // Always ejFlix's own application, whatever an older store may hold.
        self.discord.client_id = String::new();
        self.discord.details = self.discord.details.chars().take(128).collect();
        self.discord.state = self.discord.state.chars().take(128).collect();
        if !["name", "details", "state"].contains(&self.discord.header.as_str()) {
            self.discord.header = "details".into();
        }
        self.torrents.cache_gb = self.torrents.cache_gb.clamp(1, 500);
        self
    }
}

/// Two or three lowercase ASCII letters, or "off" when allowed; anything else is "".
fn lang_or_empty(code: &str, allow_off: bool) -> String {
    let code = code.trim().to_ascii_lowercase();
    if allow_off && code == "off" {
        return code;
    }
    if (2..=3).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_lowercase()) {
        code
    } else {
        String::new()
    }
}

fn key(user_id: &str) -> String {
    format!("settings.{user_id}")
}

const LAST_USER_KEY: &str = "settingsLastUser";

pub fn load(app: &tauri::AppHandle, user_id: &str) -> Result<Settings, String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    let Some(value) = store.get(key(user_id)) else {
        return Ok(Settings::default());
    };
    Ok(from_stored(&value).sanitized())
}

/// The stored object as `Settings`. A section that no longer reads (hand-edited, or a
/// field whose type changed) falls back to its defaults alone instead of taking every
/// other section with it.
fn from_stored(value: &Value) -> Settings {
    let mut settings: Settings = serde_json::from_value(value.clone()).unwrap_or_else(|_| {
        let mut kept = serde_json::Map::new();
        for (key, section) in value.as_object().into_iter().flatten() {
            let mut probe = serde_json::Map::new();
            probe.insert(key.clone(), section.clone());
            if serde_json::from_value::<Settings>(Value::Object(probe)).is_ok() {
                kept.insert(key.clone(), section.clone());
            }
        }
        serde_json::from_value(Value::Object(kept)).unwrap_or_default()
    });
    legacy_done(value, &mut settings);
    settings
}

/// Deep-merges `patch` into the stored object, validates and saves. Returns the result.
pub fn merge_and_save(
    app: &tauri::AppHandle,
    user_id: &str,
    patch: Value,
) -> Result<Settings, String> {
    if !patch.is_object() {
        return Err("Ajustes no válidos".into());
    }
    if patch.to_string().len() > 32 * 1024 {
        return Err("Ajustes demasiado grandes".into());
    }
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    // Start from what the store holds as the app reads it (a damaged section falls back
    // to its defaults, as `load` does), then apply the patch; a patch the app cannot
    // read is refused.
    let stored: Settings = store
        .get(key(user_id))
        .map(|v| from_stored(&v))
        .unwrap_or_default();
    let mut current = serde_json::to_value(&stored).map_err(|e| e.to_string())?;
    deep_merge(&mut current, patch);
    let settings: Settings = serde_json::from_value(current).map_err(|_| "Ajustes no válidos".to_string())?;
    let settings = settings.sanitized();
    store.set(
        key(user_id),
        serde_json::to_value(&settings).map_err(|e| e.to_string())?,
    );
    store.set(LAST_USER_KEY, Value::String(user_id.to_string()));
    store.save().map_err(|e| e.to_string())?;
    Ok(settings)
}

/// User whose settings were saved most recently (used before a session exists, so the
/// login and profile screens keep the last theme instead of flashing the default).
pub fn last_user(app: &tauri::AppHandle) -> Option<String> {
    let store = app.store(crate::store_path()).ok()?;
    store
        .get(LAST_USER_KEY)
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .filter(|s| !s.is_empty())
}

fn deep_merge(target: &mut Value, patch: Value) {
    match (target, patch) {
        (Value::Object(base), Value::Object(extra)) => {
            for (k, v) in extra {
                match base.get_mut(&k) {
                    Some(existing) if existing.is_object() && v.is_object() => deep_merge(existing, v),
                    _ => {
                        base.insert(k, v);
                    }
                }
            }
        }
        (target, patch) => *target = patch,
    }
}
