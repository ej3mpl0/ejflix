//! Local ("online") profiles: identities that live only inside the app, for people who
//! watch through Stremio addons without a Jellyfin server. A profile can be protected
//! with a 4-digit PIN and can later link a Jellyfin account (kept per profile).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri_plugin_store::StoreExt;

pub const MAX_PROFILES: usize = 8;
const MAX_NAME: usize = 40;
const MAX_AVATAR_BYTES: usize = 400 * 1024;
const PRESET_COUNT: u32 = 12;
const PROFILES_KEY: &str = "localProfiles";
const ACTIVE_KEY: &str = "activeLocalProfile";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalProfile {
    pub id: String,
    pub name: String,
    /// `preset:<n>` or a `data:image/…;base64,…` picture chosen by the user.
    pub avatar: String,
    /// DPAPI-protected PIN (hex); `None` when the profile opens without one.
    #[serde(default)]
    pub pin: Option<String>,
    #[serde(default)]
    pub created_ms: u64,
}

/// What the frontend sees (never the PIN).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalProfileView {
    pub id: String,
    pub name: String,
    pub avatar: String,
    pub has_pin: bool,
    /// A Jellyfin account is linked to this profile.
    pub linked: bool,
}

/// Partial update sent by the profile editor.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProfilePatch {
    pub name: Option<String>,
    pub avatar: Option<String>,
    /// New PIN (4 digits). Ignored when `clear_pin` is set.
    pub pin: Option<String>,
    pub clear_pin: bool,
    /// The PIN the profile has now, to change or remove it while it is not open.
    pub current_pin: Option<String>,
}

impl LocalProfile {
    pub fn view(&self, app: &tauri::AppHandle) -> LocalProfileView {
        LocalProfileView {
            id: self.id.clone(),
            name: self.name.clone(),
            avatar: self.avatar.clone(),
            has_pin: self.pin.is_some(),
            linked: has_linked_session(app, &self.id),
        }
    }

    pub fn verify_pin(&self, pin: Option<&str>) -> bool {
        match &self.pin {
            None => true,
            Some(sealed) => {
                let Some(pin) = pin else { return false };
                let Ok(bytes) = crate::protect::from_hex(sealed) else {
                    return false;
                };
                let Ok(raw) = crate::protect::unprotect(&bytes) else {
                    return false;
                };
                raw == pin.as_bytes()
            }
        }
    }
}

/// Store key of the Jellyfin session linked to a local profile.
pub fn session_key(id: &str) -> String {
    format!("localSession.{id}")
}

fn has_linked_session(app: &tauri::AppHandle, id: &str) -> bool {
    app.store(crate::store_path())
        .ok()
        .map(|store| store.get(session_key(id)).is_some())
        .unwrap_or(false)
}

pub fn list(app: &tauri::AppHandle) -> Result<Vec<LocalProfile>, String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    match store.get(PROFILES_KEY) {
        Some(value) => Ok(serde_json::from_value::<Vec<LocalProfile>>(value).unwrap_or_default()),
        None => Ok(vec![]),
    }
}

fn save_list(app: &tauri::AppHandle, list: &[LocalProfile]) -> Result<(), String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.set(
        PROFILES_KEY,
        serde_json::to_value(list).map_err(|e| e.to_string())?,
    );
    crate::save_store(&store)
}

pub fn get(app: &tauri::AppHandle, id: &str) -> Result<Option<LocalProfile>, String> {
    Ok(list(app)?.into_iter().find(|p| p.id == id))
}

pub fn create(
    app: &tauri::AppHandle,
    name: &str,
    avatar: &str,
    pin: Option<&str>,
) -> Result<LocalProfile, String> {
    let mut profiles = list(app)?;
    if profiles.len() >= MAX_PROFILES {
        return Err(format!("Máximo {MAX_PROFILES} perfiles"));
    }
    let profile = LocalProfile {
        id: uuid::Uuid::new_v4().to_string(),
        name: clean_name(name)?,
        avatar: clean_avatar(avatar)?,
        pin: seal_pin(pin)?,
        created_ms: crate::addons::now_ms(),
    };
    profiles.push(profile.clone());
    save_list(app, &profiles)?;
    Ok(profile)
}

pub fn update(app: &tauri::AppHandle, id: &str, patch: ProfilePatch) -> Result<LocalProfile, String> {
    let mut profiles = list(app)?;
    let profile = profiles
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| "Perfil no encontrado".to_string())?;
    if let Some(name) = patch.name {
        profile.name = clean_name(&name)?;
    }
    if let Some(avatar) = patch.avatar {
        profile.avatar = clean_avatar(&avatar)?;
    }
    if patch.clear_pin {
        profile.pin = None;
    } else if let Some(pin) = patch.pin {
        profile.pin = seal_pin(Some(&pin))?;
    }
    let updated = profile.clone();
    save_list(app, &profiles)?;
    Ok(updated)
}

/// Removes the profile with its settings, addon progress and linked session.
pub fn delete(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let mut profiles = list(app)?;
    profiles.retain(|p| p.id != id);
    save_list(app, &profiles)?;
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.delete(session_key(id));
    store.delete(format!("settings.{id}"));
    store.delete(format!("addonProgress.{id}"));
    drop(store);
    crate::iptv::delete_profile_data(app, id);
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    if active_id(app).as_deref() == Some(id) {
        store.delete(ACTIVE_KEY);
    }
    crate::save_store(&store)
}

/// Profile restored on the next launch.
pub fn active_id(app: &tauri::AppHandle) -> Option<String> {
    let store = app.store(crate::store_path()).ok()?;
    store
        .get(ACTIVE_KEY)
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .filter(|s| !s.is_empty())
}

pub fn set_active(app: &tauri::AppHandle, id: Option<&str>) -> Result<(), String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    match id {
        Some(id) => store.set(ACTIVE_KEY, Value::String(id.to_string())),
        None => {
            store.delete(ACTIVE_KEY);
        }
    }
    crate::save_store(&store)
}

fn clean_name(name: &str) -> Result<String, String> {
    let name: String = name.trim().chars().take(MAX_NAME).collect();
    if name.is_empty() {
        return Err("Escribe un nombre para el perfil".into());
    }
    Ok(name)
}

fn clean_avatar(avatar: &str) -> Result<String, String> {
    let avatar = avatar.trim();
    if let Some(n) = avatar.strip_prefix("preset:") {
        return match n.parse::<u32>() {
            Ok(n) if n < PRESET_COUNT => Ok(avatar.to_string()),
            _ => Ok("preset:0".to_string()),
        };
    }
    let ok_prefix = avatar.starts_with("data:image/jpeg;base64,")
        || avatar.starts_with("data:image/png;base64,")
        || avatar.starts_with("data:image/webp;base64,");
    if !ok_prefix {
        return Err("Imagen de perfil no válida".into());
    }
    if avatar.len() > MAX_AVATAR_BYTES {
        return Err("La foto es demasiado grande".into());
    }
    if !avatar.bytes().all(|b| b.is_ascii_graphic()) {
        return Err("Imagen de perfil no válida".into());
    }
    Ok(avatar.to_string())
}

fn seal_pin(pin: Option<&str>) -> Result<Option<String>, String> {
    let Some(pin) = pin.map(str::trim).filter(|p| !p.is_empty()) else {
        return Ok(None);
    };
    if pin.len() != 4 || !pin.bytes().all(|b| b.is_ascii_digit()) {
        return Err("El PIN debe tener 4 dígitos".into());
    }
    let sealed = crate::protect::protect(pin.as_bytes())?;
    Ok(Some(crate::protect::to_hex(&sealed)))
}
