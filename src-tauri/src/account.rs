//! ejFlix account: sign-up, sign-in, second factor (TOTP), password recovery and the
//! sync of a profile's servers, addons, IPTV sources, lists, progress and settings
//! with Supabase.
//!
//! The webview never sees a token. Each profile keeps its account sealed with DPAPI
//! in the store (`account.<profile>`), the active one lives decrypted in memory, and
//! every request to Supabase leaves from here. Sync is "last writer wins" per kind of
//! document, with a union when both sides changed and a per-title merge for progress.

use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Emitter, Manager, State};
use tauri_plugin_store::StoreExt;

use crate::{addons, iptv, profiles, protect, settings, AppState};

/// Public project values (row level security protects every table). Override at build
/// time with EJFLIX_SUPABASE_URL / EJFLIX_SUPABASE_ANON_KEY / EJFLIX_SITE_URL.
pub const SUPABASE_URL: &str = match option_env!("EJFLIX_SUPABASE_URL") {
    Some(v) => v,
    None => "https://echxltnuadslbqksjwda.supabase.co",
};
pub const SUPABASE_ANON_KEY: &str = match option_env!("EJFLIX_SUPABASE_ANON_KEY") {
    Some(v) => v,
    None => "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjaHhsdG51YWRzbGJxa3Nqd2RhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1NjQ3NTUsImV4cCI6MjEwNTE0MDc1NX0.E0QcA_F8srRTtoB-HT8S4Q8F8MvXoXUJS6QX2hBSCS8",
};
/// Website where confirmation and recovery links land.
pub const SITE_URL: &str = match option_env!("EJFLIX_SITE_URL") {
    Some(v) => v,
    None => "https://ejflix.xyz",
};

const SYNC_INTERVAL: Duration = Duration::from_secs(180);
const KINDS: [&str; 6] = ["servers", "addons", "iptv", "lists", "progress", "settings"];
const MAX_DOC_BYTES: usize = 240 * 1024;

// ---- what is stored ----

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Tokens {
    pub access: String,
    pub refresh: String,
    /// Unix seconds.
    pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Account {
    pub user_id: String,
    pub email: String,
    pub tokens: Tokens,
    /// "aal1" until the second factor has been passed in this session.
    pub aal: String,
    /// Verified TOTP factor, when the user enrolled one.
    pub factor_id: Option<String>,
    /// Send IPTV passwords and the Jellyfin token along (the user decides).
    pub sync_credentials: bool,
    pub last_sync_ms: u64,
    /// kind -> hash of the document last pushed or applied.
    pub sync_hash: HashMap<String, u64>,
    /// kind -> server `updated_at` of the document last pushed or applied.
    pub sync_stamp: HashMap<String, String>,
}

impl Account {
    fn mfa_pending(&self) -> bool {
        self.factor_id.is_some() && self.aal != "aal2"
    }
}

/// What the frontend sees.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    pub signed_in: bool,
    pub email: Option<String>,
    pub mfa_enabled: bool,
    /// Signed in, but the code of the second factor is still due.
    pub mfa_required: bool,
    pub sync_credentials: bool,
    pub last_sync_ms: u64,
    pub syncing: bool,
    pub last_error: Option<String>,
    pub prompt_dismissed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignUpResult {
    /// The address must be confirmed through the email before signing in.
    pub confirm_email: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInResult {
    pub mfa_required: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MfaEnrollment {
    pub factor_id: String,
    /// `data:image/svg+xml;utf-8,...` for an `<img>`.
    pub qr_code: String,
    pub secret: String,
    pub uri: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub pushed: Vec<String>,
    pub pulled: Vec<String>,
    pub skipped: Option<String>,
}

// ---- state ----

pub struct AccountState {
    http: reqwest::Client,
    /// Account of the active profile, decrypted.
    current: tokio::sync::RwLock<Option<Account>>,
    /// Profile the current account belongs to.
    user: tokio::sync::RwLock<Option<String>>,
    sync_lock: tokio::sync::Mutex<()>,
    syncing: std::sync::atomic::AtomicBool,
    last_error: tokio::sync::RwLock<Option<String>>,
}

impl AccountState {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(25))
                .user_agent(format!("ejFlix/{}", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("http client"),
            current: tokio::sync::RwLock::new(None),
            user: tokio::sync::RwLock::new(None),
            sync_lock: tokio::sync::Mutex::new(()),
            syncing: std::sync::atomic::AtomicBool::new(false),
            last_error: tokio::sync::RwLock::new(None),
        }
    }

    /// Loads the account sealed for `user_id` (a profile just opened) and syncs soon.
    pub async fn activate(&self, app: &tauri::AppHandle, user_id: &str) {
        let account = load_account(app, user_id);
        *self.user.write().await = Some(user_id.to_string());
        *self.current.write().await = account.clone();
        *self.last_error.write().await = None;
        if account.is_some() {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(2)).await;
                let state = app.state::<AppState>();
                let _ = sync(&app, &state).await;
            });
        }
    }

    /// The profile closed: forget the decrypted account (the store keeps it).
    pub async fn deactivate(&self) {
        *self.user.write().await = None;
        *self.current.write().await = None;
    }

    async fn user_id(&self) -> Result<String, String> {
        self.user
            .read()
            .await
            .clone()
            .ok_or_else(|| "No hay sesión activa".to_string())
    }

    async fn account(&self) -> Result<Account, String> {
        self.current
            .read()
            .await
            .clone()
            .ok_or_else(|| "auth:not_signed_in".to_string())
    }

    async fn store(&self, app: &tauri::AppHandle, account: Option<Account>) -> Result<(), String> {
        let uid = self.user_id().await?;
        match &account {
            Some(acc) => save_account(app, &uid, acc)?,
            None => clear_account(app, &uid)?,
        }
        *self.current.write().await = account;
        Ok(())
    }

    // ---- HTTP ----

    async fn auth_post(&self, path: &str, body: Value, bearer: Option<&str>) -> Result<Value, String> {
        let res = self
            .http
            .post(format!("{SUPABASE_URL}/auth/v1{path}"))
            .header("apikey", SUPABASE_ANON_KEY)
            .bearer_auth(bearer.unwrap_or(SUPABASE_ANON_KEY))
            .json(&body)
            .send()
            .await
            .map_err(net_error)?;
        read_json(res).await
    }

    async fn auth_get(&self, path: &str, bearer: &str) -> Result<Value, String> {
        let res = self
            .http
            .get(format!("{SUPABASE_URL}/auth/v1{path}"))
            .header("apikey", SUPABASE_ANON_KEY)
            .bearer_auth(bearer)
            .send()
            .await
            .map_err(net_error)?;
        read_json(res).await
    }

    async fn auth_delete(&self, path: &str, bearer: &str) -> Result<Value, String> {
        let res = self
            .http
            .delete(format!("{SUPABASE_URL}/auth/v1{path}"))
            .header("apikey", SUPABASE_ANON_KEY)
            .bearer_auth(bearer)
            .send()
            .await
            .map_err(net_error)?;
        read_json(res).await
    }

    async fn rest_get(&self, path: &str, bearer: &str) -> Result<Value, String> {
        let res = self
            .http
            .get(format!("{SUPABASE_URL}/rest/v1{path}"))
            .header("apikey", SUPABASE_ANON_KEY)
            .bearer_auth(bearer)
            .send()
            .await
            .map_err(net_error)?;
        read_json(res).await
    }

    async fn rest_upsert(&self, rows: Value, bearer: &str) -> Result<Value, String> {
        let res = self
            .http
            .post(format!("{SUPABASE_URL}/rest/v1/user_data?on_conflict=user_id,kind"))
            .header("apikey", SUPABASE_ANON_KEY)
            .header("Prefer", "resolution=merge-duplicates,return=representation")
            .bearer_auth(bearer)
            .json(&rows)
            .send()
            .await
            .map_err(net_error)?;
        read_json(res).await
    }

    async fn rest_rpc(&self, name: &str, bearer: &str) -> Result<Value, String> {
        self.rest_rpc_with(name, json!({}), bearer).await
    }

    async fn rest_rpc_with(&self, name: &str, args: Value, bearer: &str) -> Result<Value, String> {
        let res = self
            .http
            .post(format!("{SUPABASE_URL}/rest/v1/rpc/{name}"))
            .header("apikey", SUPABASE_ANON_KEY)
            .bearer_auth(bearer)
            .json(&args)
            .send()
            .await
            .map_err(net_error)?;
        read_json(res).await
    }

    /// Access token, refreshed when it is about to expire. Signs the profile out when
    /// the refresh token is no longer accepted.
    async fn access_token(&self, app: &tauri::AppHandle) -> Result<String, String> {
        let account = self.account().await?;
        if account.tokens.expires_at > now_secs() + 60 {
            return Ok(account.tokens.access);
        }
        match self
            .auth_post(
                "/token?grant_type=refresh_token",
                json!({ "refresh_token": account.tokens.refresh }),
                None,
            )
            .await
        {
            Ok(session) => {
                let mut updated = account;
                apply_session(&mut updated, &session)?;
                let token = updated.tokens.access.clone();
                self.store(app, Some(updated)).await?;
                Ok(token)
            }
            Err(err) if err.starts_with("auth:") || err.starts_with("HTTP 4") => {
                let _ = self.store(app, None).await;
                emit_status(app).await;
                Err("auth:session_expired".into())
            }
            Err(err) => Err(err),
        }
    }
}

fn net_error(err: reqwest::Error) -> String {
    if err.is_timeout() {
        "auth:timeout".into()
    } else if err.is_connect() {
        "auth:offline".into()
    } else {
        format!("Error de red: {err}")
    }
}

async fn read_json(res: reqwest::Response) -> Result<Value, String> {
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    let value: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if status.is_success() {
        return Ok(value);
    }
    let code = value
        .get("error_code")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("code").and_then(|v| v.as_str()))
        .filter(|c| !c.is_empty() && c.bytes().all(|b| b.is_ascii_lowercase() || b == b'_'));
    if let Some(code) = code {
        return Err(format!("auth:{code}"));
    }
    let message = value
        .get("msg")
        .or_else(|| value.get("message"))
        .or_else(|| value.get("error_description"))
        .or_else(|| value.get("error"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
    Err(format!("HTTP {}: {message}", status.as_u16()))
}

fn now_secs() -> u64 {
    addons::now_ms() / 1000
}

/// Claims of a JWT, without verifying it (it comes straight from Supabase over TLS).
fn jwt_claims(token: &str) -> Value {
    let Some(payload) = token.split('.').nth(1) else {
        return Value::Null;
    };
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(Value::Null)
}

/// Copies a GoTrue session (`access_token`, `refresh_token`, `user`) into the account.
fn apply_session(account: &mut Account, session: &Value) -> Result<(), String> {
    let access = session
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Respuesta de sesión no válida".to_string())?;
    let refresh = session
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .unwrap_or(&account.tokens.refresh);
    let expires_at = session
        .get("expires_at")
        .and_then(|v| v.as_u64())
        .or_else(|| session.get("expires_in").and_then(|v| v.as_u64()).map(|s| now_secs() + s))
        .unwrap_or(now_secs() + 3600);
    account.tokens = Tokens {
        access: access.to_string(),
        refresh: refresh.to_string(),
        expires_at,
    };
    let claims = jwt_claims(access);
    account.aal = claims
        .get("aal")
        .and_then(|v| v.as_str())
        .unwrap_or("aal1")
        .to_string();
    if let Some(user) = session.get("user") {
        apply_user(account, user);
    }
    Ok(())
}

fn apply_user(account: &mut Account, user: &Value) {
    if let Some(id) = user.get("id").and_then(|v| v.as_str()) {
        account.user_id = id.to_string();
    }
    if let Some(email) = user.get("email").and_then(|v| v.as_str()) {
        account.email = email.to_string();
    }
    account.factor_id = user
        .get("factors")
        .and_then(|v| v.as_array())
        .and_then(|factors| {
            factors.iter().find(|f| {
                f.get("status").and_then(|s| s.as_str()) == Some("verified")
                    && f.get("factor_type").and_then(|s| s.as_str()) == Some("totp")
            })
        })
        .and_then(|f| f.get("id").and_then(|v| v.as_str()))
        .map(str::to_string);
}

// ---- store ----

fn account_key(user_id: &str) -> String {
    format!("account.{user_id}")
}

fn prompt_key(user_id: &str) -> String {
    format!("accountPrompt.{user_id}")
}

fn load_account(app: &tauri::AppHandle, user_id: &str) -> Option<Account> {
    let store = app.store(crate::store_path()).ok()?;
    let value = store.get(account_key(user_id))?;
    let hex = value.get("blob").and_then(|v| v.as_str())?;
    let sealed = protect::from_hex(hex).ok()?;
    let raw = protect::unprotect(&sealed).ok()?;
    serde_json::from_slice(&raw).ok()
}

fn save_account(app: &tauri::AppHandle, user_id: &str, account: &Account) -> Result<(), String> {
    let raw = serde_json::to_vec(account).map_err(|e| e.to_string())?;
    let sealed = protect::protect(&raw)?;
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.set(account_key(user_id), json!({ "v": 1, "blob": protect::to_hex(&sealed) }));
    store.save().map_err(|e| e.to_string())
}

fn clear_account(app: &tauri::AppHandle, user_id: &str) -> Result<(), String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.delete(account_key(user_id));
    store.save().map_err(|e| e.to_string())
}

/// Drops the sealed account of a deleted profile.
pub fn forget_profile(app: &tauri::AppHandle, user_id: &str) {
    if let Ok(store) = app.store(crate::store_path()) {
        store.delete(account_key(user_id));
        store.delete(prompt_key(user_id));
        let _ = store.save();
    }
}

fn prompt_dismissed(app: &tauri::AppHandle, user_id: &str) -> bool {
    app.store(crate::store_path())
        .ok()
        .and_then(|s| s.get(prompt_key(user_id)))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

async fn status(app: &tauri::AppHandle, state: &AppState) -> AccountStatus {
    let acc = &state.account;
    let account = acc.current.read().await.clone();
    let user = acc.user.read().await.clone();
    let prompt = user.as_deref().map(|u| prompt_dismissed(app, u)).unwrap_or(true);
    match account {
        Some(a) => AccountStatus {
            signed_in: true,
            mfa_enabled: a.factor_id.is_some(),
            mfa_required: a.mfa_pending(),
            email: Some(a.email.clone()),
            sync_credentials: a.sync_credentials,
            last_sync_ms: a.last_sync_ms,
            syncing: acc.syncing.load(std::sync::atomic::Ordering::Relaxed),
            last_error: acc.last_error.read().await.clone(),
            prompt_dismissed: prompt,
        },
        None => AccountStatus {
            prompt_dismissed: prompt,
            ..AccountStatus::default()
        },
    }
}

async fn emit_status(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let current = status(app, &state).await;
    let _ = app.emit("account://changed", &current);
}

fn site_page(language: &str, page: &str) -> String {
    match (language, page) {
        ("en", "account") => format!("{SITE_URL}/en/account"),
        ("en", "reset") => format!("{SITE_URL}/en/account/reset"),
        (_, "reset") => format!("{SITE_URL}/account/reset"),
        _ => format!("{SITE_URL}/account"),
    }
}

fn valid_email(email: &str) -> bool {
    let email = email.trim();
    email.len() <= 254 && email.contains('@') && email.split('@').nth(1).is_some_and(|d| d.contains('.'))
}

// ---- commands: session ----

#[tauri::command]
pub async fn account_status(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<AccountStatus, String> {
    Ok(status(&app, &state).await)
}

#[tauri::command]
pub async fn account_sign_up(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    email: String,
    password: String,
    language: String,
) -> Result<SignUpResult, String> {
    state.account.user_id().await?;
    let email = email.trim().to_ascii_lowercase();
    if !valid_email(&email) {
        return Err("auth:validation_failed".into());
    }
    if password.chars().count() < 8 {
        return Err("auth:weak_password".into());
    }
    let language = if language == "en" { "en" } else { "es" };
    let redirect = site_page(language, "account");
    let value = state
        .account
        .auth_post(
            &format!("/signup?redirect_to={}", url_encode(&redirect)),
            json!({ "email": email, "password": password, "data": { "language": language } }),
            None,
        )
        .await?;
    if value.get("access_token").is_some() {
        // Confirmations are off on the project: the session is ready.
        let mut account = Account::default();
        apply_session(&mut account, &value)?;
        state.account.store(&app, Some(account)).await?;
        emit_status(&app).await;
        return Ok(SignUpResult { confirm_email: false });
    }
    Ok(SignUpResult { confirm_email: true })
}

#[tauri::command]
pub async fn account_sign_in(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    email: String,
    password: String,
) -> Result<SignInResult, String> {
    state.account.user_id().await?;
    let email = email.trim().to_ascii_lowercase();
    if !valid_email(&email) || password.is_empty() {
        return Err("auth:invalid_credentials".into());
    }
    let value = state
        .account
        .auth_post("/token?grant_type=password", json!({ "email": email, "password": password }), None)
        .await?;
    let mut account = Account { sync_credentials: true, ..Account::default() };
    apply_session(&mut account, &value)?;
    let mfa_required = account.mfa_pending();
    state.account.store(&app, Some(account)).await?;
    emit_status(&app).await;
    if !mfa_required {
        spawn_sync(&app);
    }
    Ok(SignInResult { mfa_required })
}

/// Second step of a sign-in on an account with a second factor.
#[tauri::command]
pub async fn account_mfa_verify(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    code: String,
) -> Result<AccountStatus, String> {
    let account = state.account.account().await?;
    let factor_id = account
        .factor_id
        .clone()
        .ok_or_else(|| "auth:mfa_not_enrolled".to_string())?;
    let token = state.account.access_token(&app).await?;
    let session = verify_code(&state.account, &factor_id, &code, &token).await?;
    let mut updated = account;
    apply_session(&mut updated, &session)?;
    state.account.store(&app, Some(updated)).await?;
    emit_status(&app).await;
    spawn_sync(&app);
    Ok(status(&app, &state).await)
}

async fn verify_code(acc: &AccountState, factor_id: &str, code: &str, token: &str) -> Result<Value, String> {
    let code: String = code.chars().filter(|c| c.is_ascii_digit()).collect();
    if code.len() != 6 {
        return Err("auth:mfa_verification_failed".into());
    }
    let challenge = acc
        .auth_post(&format!("/factors/{factor_id}/challenge"), json!({}), Some(token))
        .await?;
    let challenge_id = challenge
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Respuesta de verificación no válida".to_string())?;
    acc.auth_post(
        &format!("/factors/{factor_id}/verify"),
        json!({ "challenge_id": challenge_id, "code": code }),
        Some(token),
    )
    .await
}

#[tauri::command]
pub async fn account_mfa_enroll(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<MfaEnrollment, String> {
    let token = state.account.access_token(&app).await?;
    // A previous attempt that was never confirmed would block the name: clear it.
    if let Ok(user) = state.account.auth_get("/user", &token).await {
        let factors = user.get("factors").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        for factor in factors {
            let unverified = factor.get("status").and_then(|v| v.as_str()) == Some("unverified");
            if let (true, Some(id)) = (unverified, factor.get("id").and_then(|v| v.as_str())) {
                let _ = state.account.auth_delete(&format!("/factors/{id}"), &token).await;
            }
        }
    }
    let value = state
        .account
        .auth_post(
            "/factors",
            json!({ "factor_type": "totp", "friendly_name": "ejFlix", "issuer": "ejFlix" }),
            Some(&token),
        )
        .await?;
    let totp = value.get("totp").cloned().unwrap_or(Value::Null);
    let text = |v: &Value, key: &str| v.get(key).and_then(|x| x.as_str()).unwrap_or_default().to_string();
    // Supabase answers with the raw SVG; an <img> wants a data URI.
    let qr = text(&totp, "qr_code");
    let qr_code = if qr.starts_with("data:") {
        qr
    } else {
        format!(
            "data:image/svg+xml;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(qr.as_bytes())
        )
    };
    Ok(MfaEnrollment {
        factor_id: text(&value, "id"),
        qr_code,
        secret: text(&totp, "secret"),
        uri: text(&totp, "uri"),
    })
}

/// Confirms the enrollment with the first code from the authenticator app.
#[tauri::command]
pub async fn account_mfa_confirm(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    factor_id: String,
    code: String,
) -> Result<AccountStatus, String> {
    let account = state.account.account().await?;
    let token = state.account.access_token(&app).await?;
    let session = verify_code(&state.account, &factor_id, &code, &token).await?;
    let mut updated = account;
    apply_session(&mut updated, &session)?;
    updated.factor_id = Some(factor_id);
    state.account.store(&app, Some(updated)).await?;
    emit_status(&app).await;
    Ok(status(&app, &state).await)
}

/// Removes the second factor. Needs a fresh code when the session is still aal1.
#[tauri::command]
pub async fn account_mfa_disable(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    code: String,
) -> Result<AccountStatus, String> {
    let account = state.account.account().await?;
    let factor_id = account
        .factor_id
        .clone()
        .ok_or_else(|| "auth:mfa_not_enrolled".to_string())?;
    let mut token = state.account.access_token(&app).await?;
    let mut updated = account.clone();
    if account.aal != "aal2" {
        let session = verify_code(&state.account, &factor_id, &code, &token).await?;
        apply_session(&mut updated, &session)?;
        token = updated.tokens.access.clone();
    }
    state.account.auth_delete(&format!("/factors/{factor_id}"), &token).await?;
    updated.factor_id = None;
    state.account.store(&app, Some(updated)).await?;
    emit_status(&app).await;
    Ok(status(&app, &state).await)
}

#[tauri::command]
pub async fn account_resend_confirmation(state: State<'_, AppState>, email: String) -> Result<(), String> {
    let email = email.trim().to_ascii_lowercase();
    if !valid_email(&email) {
        return Err("auth:validation_failed".into());
    }
    state
        .account
        .auth_post("/resend", json!({ "type": "signup", "email": email }), None)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn account_reset_password(state: State<'_, AppState>, email: String, language: String) -> Result<(), String> {
    let email = email.trim().to_ascii_lowercase();
    if !valid_email(&email) {
        return Err("auth:validation_failed".into());
    }
    let language = if language == "en" { "en" } else { "es" };
    let redirect = site_page(language, "reset");
    state
        .account
        .auth_post(&format!("/recover?redirect_to={}", url_encode(&redirect)), json!({ "email": email }), None)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn account_sign_out(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<AccountStatus, String> {
    if let Ok(account) = state.account.account().await {
        let _ = state
            .account
            .auth_post("/logout?scope=local", json!({}), Some(&account.tokens.access))
            .await;
    }
    state.account.store(&app, None).await?;
    emit_status(&app).await;
    Ok(status(&app, &state).await)
}

/// Deletes the account and everything synced (a database function the user calls on
/// themselves), then signs out. Local data stays on this PC.
#[tauri::command]
pub async fn account_delete(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<AccountStatus, String> {
    let token = state.account.access_token(&app).await?;
    state.account.rest_rpc("delete_own_account", &token).await?;
    state.account.store(&app, None).await?;
    emit_status(&app).await;
    Ok(status(&app, &state).await)
}

#[tauri::command]
pub async fn account_set_credentials(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<AccountStatus, String> {
    let mut account = state.account.account().await?;
    account.sync_credentials = enabled;
    // The documents that carry secrets change shape: push them again.
    account.sync_hash.remove("iptv");
    account.sync_hash.remove("servers");
    state.account.store(&app, Some(account)).await?;
    spawn_sync(&app);
    Ok(status(&app, &state).await)
}

#[tauri::command]
pub async fn account_dismiss_prompt(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let uid = state.account.user_id().await?;
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.set(prompt_key(&uid), Value::Bool(true));
    store.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn account_sync_now(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<SyncReport, String> {
    sync(&app, &state).await
}

fn url_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 3);
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

// ---- sync ----

pub fn spawn_sync(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let _ = sync(&app, &state).await;
    });
}

/// Every few minutes, while a profile with an account is open.
pub fn start_sync_loop(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(SYNC_INTERVAL).await;
            let state = app.state::<AppState>();
            if state.account.current.read().await.is_some() {
                let _ = sync(&app, &state).await;
            }
        }
    });
}

#[derive(Debug, Clone, Deserialize)]
struct ServerRow {
    kind: String,
    data: Value,
    updated_at: String,
}

pub async fn sync(app: &tauri::AppHandle, state: &AppState) -> Result<SyncReport, String> {
    let acc = &state.account;
    let _guard = acc.sync_lock.lock().await;
    let uid = acc.user_id().await?;
    let account = acc.account().await?;
    if account.mfa_pending() {
        return Ok(SyncReport { skipped: Some("mfa_required".into()), ..SyncReport::default() });
    }
    acc.syncing.store(true, std::sync::atomic::Ordering::Relaxed);
    let _ = app.emit("account://changed", &status(app, state).await);
    let result = sync_inner(app, state, &uid, account).await;
    acc.syncing.store(false, std::sync::atomic::Ordering::Relaxed);
    *acc.last_error.write().await = result.as_ref().err().cloned();
    emit_status(app).await;
    result
}

async fn sync_inner(app: &tauri::AppHandle, state: &AppState, uid: &str, mut account: Account) -> Result<SyncReport, String> {
    let acc = &state.account;
    let token = acc.access_token(app).await?;
    let rows: Vec<ServerRow> = serde_json::from_value(
        acc.rest_get("/user_data?select=kind,data,updated_at", &token).await?,
    )
    .map_err(|_| "Respuesta de sincronización no válida".to_string())?;
    let server: HashMap<String, ServerRow> = rows.into_iter().map(|r| (r.kind.clone(), r)).collect();

    let local_profile = state.local.read().await.clone();
    let credentials = account.sync_credentials;
    let device = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "windows".into());
    let mut report = SyncReport::default();
    let mut to_push: Vec<Value> = Vec::new();

    for kind in KINDS {
        let local_doc = build_doc(app, state, uid, kind, credentials, local_profile.as_ref()).await;
        let local_hash = doc_hash(&local_doc);
        let local_changed = account.sync_hash.get(kind) != Some(&local_hash) && !doc_is_empty(&local_doc);
        let row = server.get(kind);
        let server_changed = match row {
            Some(r) => account.sync_stamp.get(kind) != Some(&r.updated_at),
            None => false,
        };
        let final_doc: Option<(Value, bool)> = match (row, server_changed, local_changed) {
            (Some(r), true, false) => Some((r.data.clone(), false)),
            (Some(r), true, true) => Some((merge_docs(kind, &r.data, &local_doc), true)),
            (_, false, true) => Some((local_doc.clone(), true)),
            (None, _, false) if account.sync_hash.get(kind).is_none() && !doc_is_empty(&local_doc) => {
                Some((local_doc.clone(), true))
            }
            _ => None,
        };
        let Some((doc, push)) = final_doc else {
            continue;
        };
        if doc != local_doc {
            apply_doc(app, state, uid, kind, &doc, credentials, local_profile.as_ref()).await?;
            report.pulled.push(kind.to_string());
        }
        let applied = build_doc(app, state, uid, kind, credentials, local_profile.as_ref()).await;
        account.sync_hash.insert(kind.to_string(), doc_hash(&applied));
        if let Some(r) = row {
            account.sync_stamp.insert(kind.to_string(), r.updated_at.clone());
        }
        if push {
            if serde_json::to_vec(&applied).map(|v| v.len()).unwrap_or(0) > MAX_DOC_BYTES {
                report.skipped = Some(format!("{kind}:too_large"));
                continue;
            }
            to_push.push(json!({ "user_id": account.user_id, "kind": kind, "data": applied, "device": device }));
            report.pushed.push(kind.to_string());
        }
    }

    if !to_push.is_empty() {
        let saved = acc.rest_upsert(Value::Array(to_push), &token).await?;
        for row in saved.as_array().cloned().unwrap_or_default() {
            if let (Some(kind), Some(stamp)) = (
                row.get("kind").and_then(|v| v.as_str()),
                row.get("updated_at").and_then(|v| v.as_str()),
            ) {
                account.sync_stamp.insert(kind.to_string(), stamp.to_string());
            }
        }
    }
    account.last_sync_ms = addons::now_ms();
    acc.store(app, Some(account)).await?;

    // This PC shows up under "Devices" on the website. Not worth failing a sync over.
    let device_id = crate::existing_device_id(app).unwrap_or_else(|| "windows".into());
    let _ = acc
        .rest_rpc_with(
            "touch_device",
            json!({ "p_id": device_id, "p_name": device, "p_platform": "windows", "p_version": env!("CARGO_PKG_VERSION") }),
            &token,
        )
        .await;
    Ok(report)
}

fn doc_hash(doc: &Value) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    doc.to_string().hash(&mut hasher);
    hasher.finish()
}

fn doc_is_empty(doc: &Value) -> bool {
    match doc.get("items") {
        Some(Value::Array(items)) => items.is_empty(),
        Some(Value::Object(items)) => items.is_empty(),
        _ => true,
    }
}

fn items_array(doc: &Value) -> Vec<Value> {
    doc.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default()
}

fn items_object(doc: &Value) -> serde_json::Map<String, Value> {
    doc.get("items").and_then(|v| v.as_object()).cloned().unwrap_or_default()
}

fn item_id(item: &Value) -> String {
    item.get("id")
        .or_else(|| item.get("key"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}

/// Both sides changed since the last sync: union by id (local wins on the same id),
/// newest entry per title for progress, the server's values for settings.
fn merge_docs(kind: &str, server: &Value, local: &Value) -> Value {
    match kind {
        "progress" => {
            let mut merged = items_object(server);
            for (key, entry) in items_object(local) {
                let newer = merged
                    .get(&key)
                    .and_then(|s| s.get("updatedMs"))
                    .and_then(|v| v.as_u64())
                    .map(|s| entry.get("updatedMs").and_then(|v| v.as_u64()).unwrap_or(0) >= s)
                    .unwrap_or(true);
                if newer {
                    merged.insert(key, entry);
                }
            }
            json!({ "kind": kind, "items": merged })
        }
        "settings" => server.clone(),
        _ => {
            let mut seen = HashSet::new();
            let mut items = Vec::new();
            for item in items_array(local).into_iter().chain(items_array(server)) {
                let id = item_id(&item);
                if !id.is_empty() && seen.insert(id) {
                    items.push(item);
                }
            }
            json!({ "kind": kind, "items": items })
        }
    }
}

fn host_of(url: &str) -> String {
    url.split("//")
        .nth(1)
        .unwrap_or(url)
        .split('/')
        .next()
        .unwrap_or(url)
        .to_string()
}

/// The profile's data as the document the account stores for `kind`.
async fn build_doc(
    app: &tauri::AppHandle,
    state: &AppState,
    uid: &str,
    kind: &str,
    credentials: bool,
    local_profile: Option<&profiles::LocalProfile>,
) -> Value {
    match kind {
        "addons" => {
            let urls = settings::load(app, uid).map(|s| s.addons.urls).unwrap_or_default();
            let items: Vec<Value> = urls
                .iter()
                .map(|u| json!({ "id": u, "manifestUrl": u, "name": host_of(u), "enabled": true }))
                .collect();
            json!({ "kind": "addons", "items": items })
        }
        "settings" => {
            let s = settings::load(app, uid).unwrap_or_default();
            json!({
                "kind": "settings",
                "items": {
                    "appearance": s.appearance,
                    "playback": s.playback,
                    "addons": { "cinemeta": s.addons.cinemeta },
                    "discord": s.discord,
                    "iptv": s.iptv,
                    "iptvFavorites": iptv::favorites(app, uid),
                }
            })
        }
        "lists" => {
            let mut list = addons::load_library(app, uid);
            list.sort_by(|a, b| a.key.cmp(&b.key));
            json!({ "kind": "lists", "items": list })
        }
        "progress" => {
            let mut items = serde_json::Map::new();
            for entry in addons::load_progress(app, uid) {
                items.insert(entry.key.clone(), serde_json::to_value(&entry).unwrap_or(Value::Null));
            }
            json!({ "kind": "progress", "items": items })
        }
        "iptv" => {
            let items: Vec<Value> = iptv::list_sources(app, uid)
                .into_iter()
                .filter(|s| !matches!(s.kind, iptv::SourceKind::M3uFile))
                .map(|s| {
                    json!({
                        "id": s.id,
                        "type": s.kind,
                        "name": s.name,
                        "url": s.url,
                        "username": s.username,
                        "password": if credentials { s.password_plain() } else { String::new() },
                        "epgUrl": s.epg_url,
                        "output": s.output,
                        "userAgent": s.user_agent,
                        "includeVod": s.include_vod,
                        "enabled": s.enabled,
                        "createdMs": s.created_ms,
                    })
                })
                .collect();
            json!({ "kind": "iptv", "items": items })
        }
        "servers" => {
            let mut items = Vec::new();
            if let Some(profile) = local_profile {
                let key = profiles::session_key(&profile.id);
                if let Ok(Some(session)) = crate::load_session_at(app, &key) {
                    let name = crate::load_server(app)
                        .ok()
                        .flatten()
                        .filter(|s| s.server_url == session.server_url)
                        .map(|s| s.server_name)
                        .unwrap_or_default();
                    items.push(json!({
                        "id": format!("jellyfin:{}", session.user_id),
                        "type": "jellyfin",
                        "name": name,
                        "url": session.server_url,
                        "userId": session.user_id,
                        "userName": session.user_name,
                        "deviceId": session.device_id,
                        "token": if credentials { session.token } else { String::new() },
                    }));
                }
            }
            let _ = state;
            json!({ "kind": "servers", "items": items })
        }
        _ => json!({ "kind": kind, "items": [] }),
    }
}

/// Writes a document from the account into the profile.
async fn apply_doc(
    app: &tauri::AppHandle,
    state: &AppState,
    uid: &str,
    kind: &str,
    doc: &Value,
    credentials: bool,
    local_profile: Option<&profiles::LocalProfile>,
) -> Result<(), String> {
    match kind {
        "addons" => {
            let urls: Vec<String> = items_array(doc)
                .iter()
                .filter(|i| i.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true))
                .filter_map(|i| i.get("manifestUrl").and_then(|v| v.as_str()).map(str::to_string))
                .collect();
            let _guard = state.settings_lock.lock().await;
            let saved = settings::merge_and_save(app, uid, json!({ "addons": { "urls": urls } }))?;
            let _ = app.emit("settings://changed", &saved);
        }
        "settings" => {
            let items = items_object(doc);
            let mut patch = serde_json::Map::new();
            for key in ["appearance", "playback", "addons", "discord", "iptv"] {
                if let Some(v) = items.get(key) {
                    patch.insert(key.to_string(), v.clone());
                }
            }
            let _guard = state.settings_lock.lock().await;
            let saved = settings::merge_and_save(app, uid, Value::Object(patch))?;
            let _ = app.emit("settings://changed", &saved);
            if let Some(favorites) = items.get("iptvFavorites").and_then(|v| v.as_array()) {
                let ids: Vec<String> = favorites.iter().filter_map(|v| v.as_str().map(str::to_string)).collect();
                iptv::set_favorites_list(app, uid, ids)?;
                let _ = app.emit("iptv://changed", ());
            }
        }
        "lists" => {
            let list: Vec<addons::LibraryEntry> = serde_json::from_value(Value::Array(items_array(doc))).unwrap_or_default();
            addons::replace_library(app, uid, list)?;
        }
        "progress" => {
            let list: Vec<addons::ResumeEntry> = items_object(doc)
                .into_values()
                .filter_map(|v| serde_json::from_value(v).ok())
                .collect();
            addons::replace_progress(app, uid, list)?;
        }
        "iptv" => {
            let items: Vec<iptv::SyncedSource> = items_array(doc)
                .into_iter()
                .filter_map(|v| serde_json::from_value(v).ok())
                .collect();
            if iptv::apply_synced(app, uid, items)? {
                state.iptv.clear().await;
                let _ = app.emit("iptv://changed", ());
            }
        }
        "servers" => {
            let Some(profile) = local_profile else {
                return Ok(());
            };
            if !credentials {
                return Ok(());
            }
            let key = profiles::session_key(&profile.id);
            if crate::load_session_at(app, &key).ok().flatten().is_some() {
                return Ok(());
            }
            let Some(item) = items_array(doc).into_iter().find(|i| {
                i.get("type").and_then(|v| v.as_str()) == Some("jellyfin")
                    && i.get("token").and_then(|v| v.as_str()).is_some_and(|t| !t.is_empty())
            }) else {
                return Ok(());
            };
            let text = |k: &str| item.get(k).and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let session = crate::jellyfin::Session {
                server_url: text("url"),
                token: text("token"),
                user_id: text("userId"),
                user_name: text("userName"),
                device_id: if text("deviceId").is_empty() { uuid::Uuid::new_v4().to_string() } else { text("deviceId") },
                avatar_url: None,
            };
            if session.server_url.is_empty() || session.user_id.is_empty() {
                return Ok(());
            }
            crate::save_session_at(app, &key, &session)?;
            let _ = crate::save_server(app, &session.server_url, &text("name"));
            crate::restore_linked_session(app, state, &profile.id).await;
        }
        _ => {}
    }
    Ok(())
}
