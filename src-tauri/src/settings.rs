//! Per-profile user settings, stored in the app data store under `settings.<userId>`.
//!
//! The frontend sends partial patches (`settings_set`); Rust deep-merges them into the
//! stored object, fills every missing field with its default and clamps anything a
//! hand-edited or outdated file could contain, so both windows always see a complete,
//! valid `Settings` value.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AddonPrefs {
    /// Stremio addon manifest URLs, in priority order.
    pub urls: Vec<String>,
    /// Keep Cinemeta (Stremio's public catalog/metadata addon) as a built-in addon.
    pub cinemeta: bool,
}

impl Default for AddonPrefs {
    fn default() -> Self {
        Self {
            urls: Vec::new(),
            cinemeta: true,
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
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            theme: DEFAULT_THEME.to_string(),
            amoled: false,
            poster_size: PosterSize::Medium,
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
    let store = app.store("session.json").map_err(|e| e.to_string())?;
    let Some(value) = store.get(key(user_id)) else {
        return Ok(Settings::default());
    };
    let settings: Settings = serde_json::from_value(value).unwrap_or_default();
    Ok(settings.sanitized())
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
    let store = app.store("session.json").map_err(|e| e.to_string())?;
    let mut current = store.get(key(user_id)).unwrap_or_else(|| json!({}));
    if !current.is_object() {
        current = json!({});
    }
    deep_merge(&mut current, patch);
    let settings: Settings = serde_json::from_value(current).unwrap_or_default();
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
    let store = app.store("session.json").ok()?;
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
