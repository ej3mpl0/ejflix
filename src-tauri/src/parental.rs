//! Parental controls: a maximum age rating per profile (local profiles and Jellyfin
//! users alike, keyed by the id their settings use).
//!
//! Every official rating (MPAA, US TV, the Spanish/European ages, "APTA"...) is turned
//! into an age and compared with the profile's limit. Titles without a rating pass
//! unless the profile hides them. The rules of the open profile live in memory, so the
//! Jellyfin and addon layers can filter what they map without being handed any state.
//!
//! Changing a restriction asks for the parental PIN: one PIN for the whole app, chosen
//! the first time a restriction is turned on. It is separate from the profile PINs on
//! purpose: a child knows the PIN of their own profile, since they open it with it.

use std::sync::{Mutex, RwLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, State};
use tauri_plugin_store::StoreExt;

use crate::AppState;

const STORE_KEY: &str = "parental";
/// Ages a profile can be limited to. 18 means no limit.
pub const LEVELS: [u8; 5] = [0, 7, 12, 16, 18];
pub const UNRESTRICTED: u8 = 18;
pub const CHANGED_EVENT: &str = "parental://changed";
/// Error of an item the active profile may not open (details, playback).
pub const BLOCKED: &str = "parental_blocked";
const MAX_FAILS: u32 = 5;
const LOCKOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Rule {
    pub max_age: u8,
    /// Hide titles that carry no rating at all.
    pub hide_unrated: bool,
}

impl Default for Rule {
    fn default() -> Self {
        Self {
            max_age: UNRESTRICTED,
            hide_unrated: false,
        }
    }
}

impl Rule {
    pub fn restricts(&self) -> bool {
        self.max_age < UNRESTRICTED
    }

    pub fn allows(&self, rating: Option<&str>) -> bool {
        if !self.restricts() {
            return true;
        }
        match rating.and_then(rating_age) {
            Some(age) => age <= self.max_age,
            None => !self.hide_unrated,
        }
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Stored {
    /// DPAPI-protected parental PIN (hex).
    pin: Option<String>,
    rules: std::collections::BTreeMap<String, Rule>,
}

/// What Settings shows for the open profile.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParentalView {
    pub max_age: u8,
    pub hide_unrated: bool,
    /// A parental PIN exists (changing a restriction asks for it).
    pub pin_set: bool,
    pub active: bool,
}

static ACTIVE: RwLock<Option<Rule>> = RwLock::new(None);
static FAILS: Mutex<(u32, Option<Instant>)> = Mutex::new((0, None));

/// The restriction of the open profile, when it has one.
pub fn current() -> Option<Rule> {
    ACTIVE.read().ok().and_then(|r| *r)
}

/// True when the open profile may see a title with this rating.
pub fn allows(rating: Option<&str>) -> bool {
    current().map(|r| r.allows(rating)).unwrap_or(true)
}

/// Loads the rule of the profile that was just opened.
pub fn activate(app: &tauri::AppHandle, user_id: &str) {
    let rule = load(app).rules.get(user_id).copied().filter(Rule::restricts);
    if let Ok(mut active) = ACTIVE.write() {
        *active = rule;
    }
}

pub fn deactivate() {
    if let Ok(mut active) = ACTIVE.write() {
        *active = None;
    }
}

fn load(app: &tauri::AppHandle) -> Stored {
    app.store(crate::store_path())
        .ok()
        .and_then(|store| store.get(STORE_KEY))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn save(app: &tauri::AppHandle, stored: &Stored) -> Result<(), String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.set(STORE_KEY, serde_json::to_value(stored).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())
}

fn valid_pin(pin: &str) -> bool {
    pin.len() == 4 && pin.bytes().all(|b| b.is_ascii_digit())
}

fn seal(pin: &str) -> Result<String, String> {
    if !valid_pin(pin) {
        return Err("El PIN debe tener 4 dígitos".into());
    }
    Ok(crate::protect::to_hex(&crate::protect::protect(pin.as_bytes())?))
}

/// Checks the parental PIN, refusing for a minute after five wrong tries in a row.
fn verify(stored: &Stored, pin: Option<&str>) -> Result<(), String> {
    let Some(sealed) = &stored.pin else {
        return Ok(());
    };
    let mut fails = FAILS.lock().map_err(|_| "parental_locked".to_string())?;
    if let Some(until) = fails.1 {
        if Instant::now() < until {
            return Err("parental_locked".into());
        }
        *fails = (0, None);
    }
    let Some(pin) = pin.filter(|p| !p.is_empty()) else {
        return Err("parental_pin_required".into());
    };
    let ok = crate::protect::from_hex(sealed)
        .and_then(|bytes| crate::protect::unprotect(&bytes))
        .map(|raw| raw == pin.as_bytes())
        .unwrap_or(false);
    if ok {
        *fails = (0, None);
        return Ok(());
    }
    fails.0 += 1;
    if fails.0 >= MAX_FAILS {
        fails.1 = Some(Instant::now() + LOCKOUT);
    }
    Err("parental_pin_wrong".into())
}

/// Creating a profile would sidestep every restriction, so while one exists it takes
/// the parental PIN.
pub fn check_create(app: &tauri::AppHandle, pin: Option<&str>) -> Result<(), String> {
    let stored = load(app);
    if stored.rules.values().any(Rule::restricts) {
        verify(&stored, pin)?;
    }
    Ok(())
}

/// Deleting a restricted profile (to make a new one without limits) takes the PIN too.
/// The rule goes with the profile.
pub fn check_delete(app: &tauri::AppHandle, user_id: &str, pin: Option<&str>) -> Result<(), String> {
    let mut stored = load(app);
    if stored.rules.get(user_id).is_some_and(Rule::restricts) {
        verify(&stored, pin)?;
    }
    if stored.rules.remove(user_id).is_some() {
        save(app, &stored)?;
    }
    Ok(())
}

fn view(stored: &Stored, user_id: Option<&str>) -> ParentalView {
    let rule = user_id
        .and_then(|id| stored.rules.get(id).copied())
        .unwrap_or_default();
    ParentalView {
        max_age: rule.max_age,
        hide_unrated: rule.hide_unrated,
        pin_set: stored.pin.is_some(),
        active: rule.restricts(),
    }
}

#[tauri::command]
pub async fn parental_status(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<ParentalView, String> {
    let uid = crate::settings_user(&app, &state).await;
    Ok(view(&load(&app), uid.as_deref()))
}

/// Changes the restriction of the open profile. `pin` is the parental PIN, or the new
/// one when none exists yet; `new_pin` replaces it.
#[tauri::command]
pub async fn parental_set(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    pin: String,
    max_age: u8,
    hide_unrated: bool,
    new_pin: Option<String>,
) -> Result<ParentalView, String> {
    let uid = crate::settings_user(&app, &state)
        .await
        .ok_or_else(|| "No hay sesión activa".to_string())?;
    if !LEVELS.contains(&max_age) {
        return Err("Nivel no válido".into());
    }
    let mut stored = load(&app);
    if stored.pin.is_some() {
        verify(&stored, Some(&pin))?;
    } else {
        stored.pin = Some(seal(&pin)?);
    }
    if let Some(next) = new_pin.filter(|p| !p.is_empty()) {
        stored.pin = Some(seal(&next)?);
    }
    let rule = Rule { max_age, hide_unrated };
    if rule.restricts() {
        stored.rules.insert(uid.clone(), rule);
    } else {
        stored.rules.remove(&uid);
    }
    save(&app, &stored)?;
    activate(&app, &uid);
    let result = view(&stored, Some(&uid));
    let _ = app.emit(CHANGED_EVENT, &result);
    Ok(result)
}

/// Age a rating stands for, `None` when it is not a rating ("NR", "Unrated", empty).
///
/// Covers the MPAA and US TV ratings, UK/EU ages, Spain's "APTA"/"TP" and the forms
/// Jellyfin stores them in ("ES-12", "de/16", "FSK 12").
pub fn rating_age(raw: &str) -> Option<u8> {
    let text = raw.trim().to_ascii_uppercase();
    if text.is_empty() {
        return None;
    }
    if let Some(age) = known(&text) {
        return age;
    }
    // "US:PG-13", "de/12": the rating after the country.
    let tail = text.rsplit([':', '/']).next().unwrap_or(&text).trim();
    if let Some(age) = known(tail) {
        return age;
    }
    // "ES-12", "DE-16", "GB-15".
    let bytes = tail.as_bytes();
    if bytes.len() > 3 && bytes[..2].iter().all(u8::is_ascii_alphabetic) && (bytes[2] == b'-' || bytes[2] == b' ') {
        if let Some(age) = known(&tail[3..]) {
            return age;
        }
    }
    // Any other form carrying an age ("FSK 12", "K-15", "12 años").
    let digits: String = tail
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse::<u8>().ok().filter(|n| *n <= 21).map(|n| n.min(18))
}

/// `Some(None)` for a known "not rated" label, `Some(Some(age))` for a known rating.
fn known(label: &str) -> Option<Option<u8>> {
    let label = label.trim();
    let age = match label {
        "NR" | "UR" | "UNRATED" | "NOT RATED" | "NONE" | "N/A" | "-" | "SC" | "SIN CALIFICAR" => return Some(None),
        "G" | "TV-G" | "TV-Y" | "TP" | "APTA" | "ATP" | "A" | "AL" | "U" | "E" | "ALL" | "TODOS" | "L" | "0" | "0+" | "+0" => 0,
        "6" | "+6" | "6+" => 6,
        "TV-Y7" | "TV-Y7-FV" | "TV-Y7 FV" | "7" | "+7" | "7+" | "7I" => 7,
        "PG" | "TV-PG" | "10" | "+10" | "10+" => 10,
        "12" | "12A" | "+12" | "12+" | "PG-12" => 12,
        "PG-13" | "13" | "+13" | "13+" => 13,
        "TV-14" | "14" | "+14" | "14+" => 14,
        "15" | "+15" | "15+" | "MA15+" | "M" => 15,
        "16" | "+16" | "16+" => 16,
        "R" | "TV-MA" | "17" | "+17" | "17+" => 17,
        "NC-17" | "18" | "+18" | "18+" | "X" | "XXX" | "R18" | "R18+" | "ADULT" | "AO" => 18,
        _ => return None,
    };
    Some(Some(age))
}

/// IPTV group (or channel) name that marks adult content: "XXX", "Adultos", "+18"...
pub fn is_adult_label(name: &str) -> bool {
    let lower = name.to_lowercase();
    if lower.contains("xxx") || lower.contains("porn") {
        return true;
    }
    lower
        .split(|c: char| !(c.is_alphanumeric() || c == '+'))
        .filter(|w| !w.is_empty())
        .any(|word| {
            matches!(
                word,
                "adult" | "adults" | "adulto" | "adultos" | "adulta" | "adultas" | "+18" | "18+" | "erotic"
                    | "erotica" | "erotico" | "erótico" | "erótica" | "hentai"
            )
        })
}

/// True while the open profile has a restriction (adult IPTV groups are then hidden).
pub fn hides_adult() -> bool {
    current().is_some()
}

/// Age-rating fields some addons put in their metas. Stremio has no standard one;
/// titles without any count as unrated.
pub fn meta_rating(v: &Value) -> Option<String> {
    ["certification", "contentRating", "officialRating", "mpaa", "rated", "ageRating"]
        .iter()
        .find_map(|key| match v.get(*key)? {
            Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_ratings_to_ages() {
        assert_eq!(rating_age("G"), Some(0));
        assert_eq!(rating_age("TV-Y"), Some(0));
        assert_eq!(rating_age("APTA"), Some(0));
        assert_eq!(rating_age("TP"), Some(0));
        assert_eq!(rating_age("TV-Y7"), Some(7));
        assert_eq!(rating_age("7"), Some(7));
        assert_eq!(rating_age("PG"), Some(10));
        assert_eq!(rating_age("ES-12"), Some(12));
        assert_eq!(rating_age("PG-13"), Some(13));
        assert_eq!(rating_age("TV-14"), Some(14));
        assert_eq!(rating_age("de/16"), Some(16));
        assert_eq!(rating_age("FSK 16"), Some(16));
        assert_eq!(rating_age("R"), Some(17));
        assert_eq!(rating_age("TV-MA"), Some(17));
        assert_eq!(rating_age("NC-17"), Some(18));
        assert_eq!(rating_age("US:18"), Some(18));
        assert_eq!(rating_age("NR"), None);
        assert_eq!(rating_age("Unrated"), None);
        assert_eq!(rating_age(""), None);
    }

    #[test]
    fn applies_the_limit() {
        let rule = Rule { max_age: 12, hide_unrated: false };
        assert!(rule.allows(Some("PG")));
        assert!(rule.allows(Some("12")));
        assert!(!rule.allows(Some("PG-13")));
        assert!(rule.allows(None));
        let strict = Rule { max_age: 0, hide_unrated: true };
        assert!(strict.allows(Some("TV-G")));
        assert!(!strict.allows(Some("TV-Y7")));
        assert!(!strict.allows(Some("NR")));
        assert!(Rule::default().allows(Some("NC-17")));
    }

    #[test]
    fn spots_adult_groups() {
        assert!(is_adult_label("XXX Movies"));
        assert!(is_adult_label("ES | Adultos"));
        assert!(is_adult_label("+18"));
        assert!(is_adult_label("VOD 18+"));
        assert!(!is_adult_label("Deportes"));
        assert!(!is_adult_label("Cine 2018"));
    }
}
