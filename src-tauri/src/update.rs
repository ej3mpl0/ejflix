//! Update check against GitHub Releases, installer download and hand-off to NSIS.
//!
//! No updater plugin: the app asks the public GitHub API for the latest release of
//! the repository, compares the tag with its own version and, when the user agrees,
//! downloads the `*-setup.exe` asset into the temp folder and launches it in passive
//! mode (`/P /R`), which closes the running app, installs and relaunches ejFlix.

use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::Emitter;
use tokio::sync::Mutex;

/// GitHub repository that hosts the releases (`owner/name`).
pub const REPO: &str = "ej3mpl0/ejflix";
/// Page the "See on GitHub" buttons open.
pub const RELEASES_URL: &str = "https://github.com/ej3mpl0/ejflix/releases";
/// A manual check always hits the API; automatic ones reuse a result this recent.
const CACHE_TTL: Duration = Duration::from_secs(30 * 60);
/// Emitted while downloading with `{ received, total }` bytes.
pub const PROGRESS_EVENT: &str = "update://progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    /// Version of the running app.
    pub current: String,
    /// Version of the latest published release.
    pub latest: String,
    /// `latest` is newer than `current`.
    pub available: bool,
    /// The user chose "skip this version" for `latest`.
    pub skipped: bool,
    /// Release notes as written on GitHub (markdown).
    pub notes: String,
    /// Release page.
    pub url: String,
    pub asset_url: Option<String>,
    pub asset_name: Option<String>,
    pub asset_size: Option<u64>,
    /// SHA-256 GitHub reports for the installer (lowercase hex), when it has one.
    #[serde(skip)]
    pub asset_sha256: Option<String>,
    pub published_at: Option<String>,
    pub checked_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePrefs {
    /// Check GitHub on launch.
    pub auto: bool,
    /// Version the user asked not to be reminded about.
    pub skipped: Option<String>,
}

impl Default for UpdatePrefs {
    fn default() -> Self {
        Self { auto: true, skipped: None }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Downloaded {
    pub path: String,
    pub size: u64,
}

pub struct Updater {
    http: reqwest::Client,
    current: String,
    last: Mutex<Option<(Instant, UpdateCheck)>>,
    /// Serializes downloads (a second click must not write the same file twice).
    download_lock: Mutex<()>,
}

/// Parses `v0.3.1`, `0.3.1`, `ejFlix 0.3.1` or `0.3.1-beta.2` into numeric parts.
pub fn parse_version(raw: &str) -> Option<(u64, u64, u64)> {
    let start = raw.find(|c: char| c.is_ascii_digit())?;
    let core = raw[start..]
        .split(|c: char| c == '-' || c == '+' || c.is_whitespace())
        .next()
        .unwrap_or("");
    let mut parts = core.split('.').map(|p| {
        let digits: String = p.chars().take_while(|c| c.is_ascii_digit()).collect();
        digits.parse::<u64>().ok()
    });
    let major = parts.next().flatten()?;
    let minor = parts.next().flatten().unwrap_or(0);
    let patch = parts.next().flatten().unwrap_or(0);
    Some((major, minor, patch))
}

/// `0.4.0-beta.2` (a pre-release comes before the release of the same number).
fn is_prerelease(raw: &str) -> bool {
    raw.find(|c: char| c.is_ascii_digit())
        .map(|start| raw[start..].split(['+', ' ']).next().unwrap_or("").contains('-'))
        .unwrap_or(false)
}

/// `latest` is strictly newer than `current`. Unparseable input never reports an update.
pub fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_version(latest), parse_version(current)) {
        (Some(l), Some(c)) => l > c || (l == c && is_prerelease(current) && !is_prerelease(latest)),
        _ => false,
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The Windows installer among the release assets.
fn pick_asset(assets: &[serde_json::Value]) -> Option<(String, String, u64)> {
    let mut candidates: Vec<(String, String, u64)> = assets
        .iter()
        .filter_map(|a| {
            let name = a.get("name")?.as_str()?.to_string();
            let url = a.get("browser_download_url")?.as_str()?.to_string();
            let size = a.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
            let lower = name.to_ascii_lowercase();
            if lower.ends_with(".exe") && lower.contains("setup") {
                Some((name, url, size))
            } else {
                None
            }
        })
        .collect();
    // Prefer the x64 build if several installers are attached.
    candidates.sort_by_key(|(name, _, _)| !name.to_ascii_lowercase().contains("x64"));
    candidates.into_iter().next()
}

/// `sha256:<hex>` digest GitHub lists for the asset called `name` (assets uploaded
/// before GitHub started computing digests have none).
fn asset_digest(assets: &[serde_json::Value], name: &str) -> Option<String> {
    let asset = assets
        .iter()
        .find(|a| a.get("name").and_then(|n| n.as_str()) == Some(name))?;
    let hex = asset.get("digest")?.as_str()?.strip_prefix("sha256:")?.to_ascii_lowercase();
    (hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit())).then_some(hex)
}

fn sha256_hex(bytes: &[u8]) -> String {
    crate::protect::to_hex(&Sha256::digest(bytes))
}

impl Updater {
    pub fn new(current: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent(format!("ejFlix/{current} (+https://github.com/{REPO})"))
            .build()
            .expect("http client");
        Self {
            http,
            current,
            last: Mutex::new(None),
            download_lock: Mutex::new(()),
        }
    }

    pub fn current(&self) -> &str {
        &self.current
    }

    /// Latest release from GitHub. `force` skips the 30 minute cache.
    pub async fn check(&self, force: bool, skipped: Option<&str>) -> Result<UpdateCheck, String> {
        if !force {
            if let Some((at, cached)) = self.last.lock().await.as_ref() {
                if at.elapsed() < CACHE_TTL {
                    let mut out = cached.clone();
                    out.skipped = skipped == Some(out.latest.as_str());
                    return Ok(out);
                }
            }
        }
        let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
        let resp = self
            .http
            .get(&url)
            .header("accept", "application/vnd.github+json")
            .header("x-github-api-version", "2022-11-28")
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    "GitHub no responde".to_string()
                } else if e.is_connect() {
                    "Sin conexión".to_string()
                } else {
                    e.to_string()
                }
            })?;
        let status = resp.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err("No hay versiones publicadas".into());
        }
        if status == reqwest::StatusCode::FORBIDDEN || status.as_u16() == 429 {
            return Err("GitHub ha limitado las consultas; prueba más tarde".into());
        }
        if !status.is_success() {
            return Err(format!("GitHub respondió {}", status.as_u16()));
        }
        let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let tag = body
            .get("tag_name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let latest = parse_version(&tag)
            .map(|(a, b, c)| format!("{a}.{b}.{c}"))
            .ok_or_else(|| format!("Etiqueta de versión no reconocida: {tag}"))?;
        let assets = body
            .get("assets")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let asset = pick_asset(&assets);
        let check = UpdateCheck {
            current: self.current.clone(),
            available: is_newer(&latest, &self.current),
            skipped: skipped == Some(latest.as_str()),
            latest,
            notes: body
                .get("body")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            url: body
                .get("html_url")
                .and_then(|v| v.as_str())
                .unwrap_or(RELEASES_URL)
                .to_string(),
            asset_url: asset.as_ref().map(|a| a.1.clone()),
            asset_name: asset.as_ref().map(|a| a.0.clone()),
            asset_size: asset.as_ref().map(|a| a.2).filter(|s| *s > 0),
            asset_sha256: asset.as_ref().and_then(|a| asset_digest(&assets, &a.0)),
            published_at: body
                .get("published_at")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            checked_at_ms: now_ms(),
        };
        *self.last.lock().await = Some((Instant::now(), check.clone()));
        Ok(check)
    }

    /// Where the installer of the last checked release is (or will be) stored.
    fn target_path(name: &str) -> PathBuf {
        // Keep only the file name: the asset name comes from the network.
        let safe: String = name
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
            .collect();
        std::env::temp_dir()
            .join("ejflix-update")
            .join(if safe.is_empty() { "ejFlix-setup.exe".to_string() } else { safe })
    }

    /// Downloads the installer of the latest checked release, reporting progress
    /// through `update://progress`. Returns the local path.
    pub async fn download(&self, app: &tauri::AppHandle) -> Result<Downloaded, String> {
        let _guard = self.download_lock.lock().await;
        let check = self
            .last
            .lock()
            .await
            .as_ref()
            .map(|(_, c)| c.clone())
            .ok_or("Comprueba primero si hay actualizaciones")?;
        if !check.available {
            return Err("Ya tienes la última versión".into());
        }
        let (url, name) = match (check.asset_url, check.asset_name) {
            (Some(u), Some(n)) => (u, n),
            _ => return Err("Esta versión no incluye instalador".into()),
        };
        if !url.starts_with("https://github.com/") && !url.starts_with("https://objects.githubusercontent.com/") {
            return Err("Origen del instalador no permitido".into());
        }
        let path = Self::target_path(&name);
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        // Already downloaded and complete (and, when GitHub gives a digest, intact): reuse it.
        if let (Ok(meta), Some(size)) = (std::fs::metadata(&path), check.asset_size) {
            let intact = match &check.asset_sha256 {
                Some(expected) => std::fs::read(&path).is_ok_and(|bytes| &sha256_hex(&bytes) == expected),
                None => true,
            };
            if meta.len() == size && intact {
                let _ = app.emit(PROGRESS_EVENT, serde_json::json!({ "received": size, "total": size }));
                return Ok(Downloaded { path: path.to_string_lossy().into_owned(), size });
            }
        }
        let partial = path.with_extension("part");
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(600))
            .connect_timeout(Duration::from_secs(15))
            .user_agent(format!("ejFlix/{}", self.current))
            .build()
            .map_err(|e| e.to_string())?;
        let mut resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let total = resp.content_length().or(check.asset_size).unwrap_or(0);
        let mut file = std::fs::File::create(&partial).map_err(|e| e.to_string())?;
        let mut received: u64 = 0;
        let mut hasher = Sha256::new();
        let mut last_emit = Instant::now() - Duration::from_secs(1);
        while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
            file.write_all(&chunk).map_err(|e| e.to_string())?;
            hasher.update(&chunk);
            received += chunk.len() as u64;
            if last_emit.elapsed() >= Duration::from_millis(150) {
                last_emit = Instant::now();
                let _ = app.emit(PROGRESS_EVENT, serde_json::json!({ "received": received, "total": total }));
            }
        }
        file.flush().map_err(|e| e.to_string())?;
        drop(file);
        if let Some(size) = check.asset_size {
            if received != size {
                let _ = std::fs::remove_file(&partial);
                return Err(format!("Descarga incompleta ({received} de {size} bytes)"));
            }
        }
        if let Some(expected) = &check.asset_sha256 {
            if &crate::protect::to_hex(&hasher.finalize()) != expected {
                let _ = std::fs::remove_file(&partial);
                return Err("El instalador descargado no coincide con el publicado".into());
            }
        }
        std::fs::rename(&partial, &path).map_err(|e| e.to_string())?;
        let _ = app.emit(PROGRESS_EVENT, serde_json::json!({ "received": received, "total": received }));
        Ok(Downloaded { path: path.to_string_lossy().into_owned(), size: received })
    }

    /// Launches a downloaded installer in passive mode. The caller exits the app.
    pub fn launch_installer(path: &str) -> Result<(), String> {
        let expected_dir = std::env::temp_dir().join("ejflix-update");
        let file = PathBuf::from(path);
        let inside = file
            .parent()
            .and_then(|p| p.canonicalize().ok())
            .zip(expected_dir.canonicalize().ok())
            .map(|(a, b)| a == b)
            .unwrap_or(false);
        if !inside || !file.is_file() {
            return Err("Instalador no encontrado".into());
        }
        // /P passive (progress only), /R relaunch when done, /UPDATE keeps user data untouched.
        std::process::Command::new(&file)
            .args(["/P", "/R", "/UPDATE"])
            .spawn()
            .map_err(|e| format!("No se pudo abrir el instalador: {e}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tags() {
        assert_eq!(parse_version("v0.3.1"), Some((0, 3, 1)));
        assert_eq!(parse_version("ejFlix 1.2"), Some((1, 2, 0)));
        assert_eq!(parse_version("0.4.0-beta.1"), Some((0, 4, 0)));
        assert_eq!(parse_version("latest"), None);
    }

    #[test]
    fn compares() {
        assert!(is_newer("0.3.1", "0.3.0"));
        assert!(is_newer("v1.0.0", "0.9.9"));
        assert!(!is_newer("0.3.0", "0.3.0"));
        assert!(!is_newer("0.2.9", "0.3.0"));
        assert!(!is_newer("nope", "0.3.0"));
        assert!(is_newer("0.4.0", "0.4.0-beta.1"));
        assert!(!is_newer("0.4.0-beta.2", "0.4.0-beta.1"));
        assert!(!is_newer("0.4.0", "0.4.0"));
    }
}
