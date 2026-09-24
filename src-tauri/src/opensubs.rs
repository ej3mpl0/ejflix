//! OpenSubtitles.com (REST API v1): subtitle search and download for the player.
//!
//! Every request carries the user's own API key. Downloading works without an account
//! (a small daily quota per IP); with a username and password the app logs in and the
//! quota is the account's. The password is kept encrypted with DPAPI, apart from the
//! settings (which the ejFlix account syncs), and the login token only in memory.

use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri_plugin_store::StoreExt;

const API: &str = "https://api.opensubtitles.com/api/v1";
const MAX_SUBTITLE_BYTES: usize = 8 * 1024 * 1024;
/// Tokens last 24 hours; renew a bit earlier.
const TOKEN_TTL: Duration = Duration::from_secs(20 * 3600);

static HTTP: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        // OpenSubtitles asks for "AppName vX.Y" and rejects requests without one.
        .user_agent(format!("ejFlix v{}", env!("CARGO_PKG_VERSION")))
        .build()
        .unwrap_or_default()
});

/// Login token of the current account: (username, token, API host, obtained at).
/// Login token of the last account used: (profile id, username, token, API host, when).
/// Keyed by profile too, so another profile with the same username never reuses it.
static TOKEN: LazyLock<Mutex<Option<(String, String, String, String, Instant)>>> = LazyLock::new(|| Mutex::new(None));

/// What the player knows about the title being searched.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchQuery {
    /// IMDb id of the film or the episode itself ("tt0133093").
    pub imdb: Option<String>,
    /// IMDb id of the show, with `season` / `episode`.
    pub parent_imdb: Option<String>,
    pub season: Option<i32>,
    pub episode: Option<i32>,
    /// Free text when no id is known.
    pub title: Option<String>,
    /// ISO 639-2 codes ("spa") or 639-1 ("es"); empty = every language.
    pub languages: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleResult {
    pub file_id: u64,
    pub release: String,
    /// OpenSubtitles language code ("es", "en", "pt-BR"...).
    pub language: String,
    pub downloads: u64,
    pub hearing_impaired: bool,
    pub machine_translated: bool,
    pub trusted: bool,
    pub fps: Option<f64>,
}

/// The language codes OpenSubtitles uses for a profile language (639-2 or 639-1).
fn os_languages(code: &str) -> Vec<&'static str> {
    match code.trim().to_ascii_lowercase().as_str() {
        "spa" | "es" => vec!["es", "ea"],
        "eng" | "en" => vec!["en"],
        "fra" | "fre" | "fr" => vec!["fr"],
        "deu" | "ger" | "de" => vec!["de"],
        "ita" | "it" => vec!["it"],
        "por" | "pt" => vec!["pt-pt", "pt-br"],
        "jpn" | "ja" => vec!["ja"],
        "kor" | "ko" => vec!["ko"],
        "zho" | "chi" | "zh" => vec!["zh-cn", "zh-tw"],
        "nld" | "dut" | "nl" => vec!["nl"],
        "rus" | "ru" => vec!["ru"],
        "cat" | "ca" => vec!["ca"],
        "eus" | "baq" | "eu" => vec!["eu"],
        "glg" | "gl" => vec!["gl"],
        "ara" | "ar" => vec!["ar"],
        "hin" | "hi" => vec!["hi"],
        "tur" | "tr" => vec!["tr"],
        "pol" | "pl" => vec!["pl"],
        "swe" | "sv" => vec!["sv"],
        "nor" | "no" => vec!["no"],
        "dan" | "da" => vec!["da"],
        "fin" | "fi" => vec!["fi"],
        "ell" | "gre" | "el" => vec!["el"],
        "heb" | "he" => vec!["he"],
        "ces" | "cze" | "cs" => vec!["cs"],
        "hun" | "hu" => vec!["hu"],
        "ron" | "rum" | "ro" => vec!["ro"],
        "ukr" | "uk" => vec!["uk"],
        "tha" | "th" => vec!["th"],
        "vie" | "vi" => vec!["vi"],
        "ind" | "id" => vec!["id"],
        _ => vec![],
    }
}

/// "tt0133093" → "133093" (the API wants the number without leading zeros).
fn imdb_number(id: &str) -> Option<String> {
    let digits = id.trim().trim_start_matches("tt");
    if digits.is_empty() || digits.len() > 10 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let trimmed = digits.trim_start_matches('0');
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// Query parameters, sorted by name as the API recommends (it redirects otherwise).
fn search_params(query: &SearchQuery) -> Result<Vec<(&'static str, String)>, String> {
    let mut params: Vec<(&'static str, String)> = Vec::new();
    let episode = query.season.zip(query.episode);
    if let Some(id) = query.imdb.as_deref().and_then(imdb_number) {
        params.push(("imdb_id", id));
    } else if let (Some(parent), Some((season, episode))) =
        (query.parent_imdb.as_deref().and_then(imdb_number), episode)
    {
        params.push(("parent_imdb_id", parent));
        params.push(("season_number", season.to_string()));
        params.push(("episode_number", episode.to_string()));
    } else if let Some(title) = query.title.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        params.push(("query", title.chars().take(120).collect::<String>().to_lowercase()));
        if let Some((season, episode)) = episode {
            params.push(("season_number", season.to_string()));
            params.push(("episode_number", episode.to_string()));
        }
    } else {
        return Err(crate::errors::code("osNothingToSearch"));
    }
    let mut langs: Vec<&str> = query.languages.iter().flat_map(|l| os_languages(l)).collect();
    langs.sort_unstable();
    langs.dedup();
    if !langs.is_empty() {
        params.push(("languages", langs.join(",")));
    }
    params.sort_by(|a, b| a.0.cmp(b.0));
    Ok(params)
}

fn api_error(status: reqwest::StatusCode, body: &Value) -> String {
    let message = body
        .get("message")
        .or_else(|| body.get("errors").and_then(|e| e.get(0)))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    match status.as_u16() {
        401 | 403 if message.is_empty() => crate::errors::code("osRejected"),
        429 => crate::errors::code("osRateLimited"),
        _ if !message.is_empty() => crate::errors::detail("osMessage", message),
        code => crate::errors::detail("osStatus", code),
    }
}

pub async fn search(api_key: &str, query: &SearchQuery) -> Result<Vec<SubtitleResult>, String> {
    let params = search_params(query)?;
    let res = HTTP
        .get(format!("{API}/subtitles"))
        .header("Api-Key", api_key)
        .header("Accept", "application/json")
        .query(&params)
        .send()
        .await
        .map_err(|_| crate::errors::code("osUnreachable"))?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(api_error(status, &body));
    }
    let list = body.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default();
    let mut out: Vec<SubtitleResult> = list
        .iter()
        .filter_map(|item| {
            let attrs = item.get("attributes")?;
            let file = attrs.get("files")?.as_array()?.first()?;
            let flag = |name: &str| attrs.get(name).and_then(|v| v.as_bool()).unwrap_or(false);
            Some(SubtitleResult {
                file_id: file.get("file_id")?.as_u64()?,
                release: attrs
                    .get("release")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.trim().is_empty())
                    .or_else(|| file.get("file_name").and_then(|v| v.as_str()))
                    .unwrap_or("")
                    .chars()
                    .take(200)
                    .collect(),
                language: attrs.get("language").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                downloads: attrs.get("download_count").and_then(|v| v.as_u64()).unwrap_or(0),
                hearing_impaired: flag("hearing_impaired"),
                machine_translated: flag("machine_translated") || flag("ai_translated"),
                trusted: flag("from_trusted"),
                fps: attrs.get("fps").and_then(|v| v.as_f64()).filter(|f| *f > 0.0),
            })
        })
        .collect();
    // Human translations first, then the most downloaded.
    out.sort_by(|a, b| {
        a.machine_translated
            .cmp(&b.machine_translated)
            .then(b.downloads.cmp(&a.downloads))
    });
    Ok(out)
}

/// Login token and API host for the account, logging in when there is none yet.
async fn token(api_key: &str, profile: &str, username: &str, password: &str) -> Result<(String, String), String> {
    if let Some((owner, user, token, host, at)) = TOKEN.lock().unwrap().clone() {
        if owner == profile && user == username && at.elapsed() < TOKEN_TTL {
            return Ok((token, host));
        }
    }
    let res = HTTP
        .post(format!("{API}/login"))
        .header("Api-Key", api_key)
        .header("Accept", "application/json")
        .json(&json!({ "username": username, "password": password }))
        .send()
        .await
        .map_err(|_| crate::errors::code("osUnreachable"))?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(if status.as_u16() == 401 {
            crate::errors::code("osWrongCredentials")
        } else {
            api_error(status, &body)
        });
    }
    let token = body
        .get("token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| crate::errors::code("osNoSession"))?
        .to_string();
    // VIP accounts are served from their own host; only accept OpenSubtitles hosts.
    let host = body
        .get("base_url")
        .and_then(|v| v.as_str())
        .map(|h| h.trim().trim_start_matches("https://").trim_end_matches('/').to_string())
        .filter(|h| h == "api.opensubtitles.com" || h == "vip-api.opensubtitles.com")
        .unwrap_or_else(|| "api.opensubtitles.com".into());
    *TOKEN.lock().unwrap() = Some((profile.to_string(), username.to_string(), token.clone(), host.clone(), Instant::now()));
    Ok((token, host))
}

pub fn forget_token() {
    *TOKEN.lock().unwrap() = None;
}

/// Downloads one subtitle file to a temporary path and returns it. `profile` owns `login`.
pub async fn download(
    api_key: &str,
    profile: &str,
    login: Option<(&str, &str)>,
    file_id: u64,
) -> Result<std::path::PathBuf, String> {
    let (auth, base) = match login {
        Some((user, password)) => {
            let (token, host) = token(api_key, profile, user, password).await?;
            (Some(token), format!("https://{host}/api/v1"))
        }
        None => (None, API.to_string()),
    };
    let mut req = HTTP
        .post(format!("{base}/download"))
        .header("Api-Key", api_key)
        .header("Accept", "application/json")
        .json(&json!({ "file_id": file_id }));
    if let Some(token) = &auth {
        req = req.bearer_auth(token);
    }
    let res = req
        .send()
        .await
        .map_err(|_| crate::errors::code("osUnreachable"))?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        if status.as_u16() == 401 {
            forget_token();
        }
        return Err(api_error(status, &body));
    }
    let link = body
        .get("link")
        .and_then(|v| v.as_str())
        .filter(|l| l.starts_with("https://"))
        .ok_or_else(|| crate::errors::code("osNoLink"))?;
    let ext = body
        .get("file_name")
        .and_then(|v| v.as_str())
        .and_then(|name| std::path::Path::new(name).extension().and_then(|e| e.to_str()))
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| ["srt", "vtt", "ass", "ssa", "sub"].contains(&e.as_str()))
        .unwrap_or_else(|| "srt".into());
    let file = HTTP
        .get(link)
        .send()
        .await
        .map_err(|_| crate::errors::code("subDownloadFailed"))?;
    if !file.status().is_success() {
        return Err(crate::errors::code("subDownloadFailed"));
    }
    let bytes = file.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_SUBTITLE_BYTES {
        return Err(crate::errors::code("subTooLarge"));
    }
    let dir = std::env::temp_dir().join("ejflix-subs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("os-{file_id}.{ext}"));
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

// ---- the account password, encrypted per profile ----

fn password_key(user_id: &str) -> String {
    format!("opensubtitlesPassword.{user_id}")
}

pub fn load_password(app: &tauri::AppHandle, user_id: &str) -> Option<String> {
    let store = app.store(crate::store_path()).ok()?;
    let hex = store.get(password_key(user_id))?;
    let sealed = crate::protect::from_hex(hex.as_str()?).ok()?;
    let raw = crate::protect::unprotect(&sealed).ok()?;
    String::from_utf8(raw).ok().filter(|p| !p.is_empty())
}

/// Saves the password (empty removes it).
pub fn save_password(app: &tauri::AppHandle, user_id: &str, password: &str) -> Result<(), String> {
    if password.len() > 256 {
        return Err(crate::errors::code("passwordTooLong"));
    }
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    if password.is_empty() {
        store.delete(password_key(user_id));
    } else {
        let sealed = crate::protect::protect(password.as_bytes())?;
        store.set(password_key(user_id), Value::String(crate::protect::to_hex(&sealed)));
    }
    forget_token();
    crate::save_store(&store)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imdb_ids_lose_prefix_and_zeros() {
        assert_eq!(imdb_number("tt0133093").as_deref(), Some("133093"));
        assert_eq!(imdb_number("0944947").as_deref(), Some("944947"));
        assert_eq!(imdb_number("tt"), None);
        assert_eq!(imdb_number("tt12ab"), None);
    }

    #[test]
    fn episode_search_uses_the_show() {
        let query = SearchQuery {
            parent_imdb: Some("tt0944947".into()),
            season: Some(1),
            episode: Some(2),
            languages: vec!["spa".into(), "eng".into()],
            ..SearchQuery::default()
        };
        let params = search_params(&query).unwrap();
        assert_eq!(
            params,
            vec![
                ("episode_number", "2".to_string()),
                ("languages", "ea,en,es".to_string()),
                ("parent_imdb_id", "944947".to_string()),
                ("season_number", "1".to_string()),
            ]
        );
    }

    #[test]
    fn title_search_when_no_id() {
        let query = SearchQuery {
            title: Some("  The Matrix ".into()),
            ..SearchQuery::default()
        };
        assert_eq!(search_params(&query).unwrap(), vec![("query", "the matrix".to_string())]);
        assert!(search_params(&SearchQuery::default()).is_err());
    }
}
