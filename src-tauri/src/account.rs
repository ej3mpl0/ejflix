//! ejFlix account: sign-up, sign-in, second factor (TOTP), password recovery and the
//! sync of a profile's servers, addons, IPTV sources, lists, progress and settings
//! with Supabase.
//!
//! The webview never sees a token. Each profile keeps its account sealed with DPAPI
//! in the store (`account.<profile>`), the active one lives decrypted in memory, and
//! every request to Supabase leaves from here. Sync works per kind of document: a
//! side that did not change since the last sync takes the other's copy, and when both
//! moved the documents are merged item by item against what that last sync left, so
//! a removal on one PC is not undone by the other and the newer entry wins.

use std::collections::{HashMap, HashSet};
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
    /// kind -> what the last sync left on both sides, for three-way merges: per item
    /// its `updatedMs` and a hash of its content, or the whole settings document.
    pub sync_base: HashMap<String, Value>,
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
        crate::parental::activate(app, user_id);
        let account = load_account(app, user_id);
        {
            // Both fields under the `user` lock: a sync still running for the previous
            // profile checks that lock before it writes to memory.
            let mut user = self.user.write().await;
            *self.current.write().await = account.clone();
            *user = Some(user_id.to_string());
        }
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
        crate::parental::deactivate();
        let mut user = self.user.write().await;
        *self.current.write().await = None;
        *user = None;
    }

    /// True while `user_id` is the profile whose account is loaded.
    async fn is_active(&self, user_id: &str) -> bool {
        self.user.read().await.as_deref() == Some(user_id)
    }

    /// The account of `user_id`: the copy in memory while that profile is active,
    /// otherwise its sealed copy in the store.
    async fn account_of(&self, app: &tauri::AppHandle, user_id: &str) -> Option<Account> {
        let user = self.user.read().await;
        if user.as_deref() == Some(user_id) {
            self.current.read().await.clone()
        } else {
            load_account(app, user_id)
        }
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

    /// Saves the account of the active profile.
    async fn store(&self, app: &tauri::AppHandle, account: Option<Account>) -> Result<(), String> {
        let uid = self.user_id().await?;
        self.store_for(app, &uid, account).await
    }

    /// Saves the account of `user_id` in the store, and in memory only while that
    /// profile is still the active one: a sync can outlive a profile switch.
    async fn store_for(&self, app: &tauri::AppHandle, user_id: &str, account: Option<Account>) -> Result<(), String> {
        match &account {
            Some(acc) => save_account(app, user_id, acc)?,
            None => clear_account(app, user_id)?,
        }
        let user = self.user.read().await;
        if user.as_deref() == Some(user_id) {
            *self.current.write().await = account;
        }
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

    /// Access token of the active profile, refreshed when about to expire.
    async fn access_token(&self, app: &tauri::AppHandle) -> Result<String, String> {
        let uid = self.user_id().await?;
        let mut account = self.account().await?;
        self.fresh_token(app, &uid, &mut account).await
    }

    /// Access token of `account` (the caller's copy, which gets the new tokens too),
    /// refreshed and saved for `user_id` when about to expire. A refresh the server
    /// turns down signs that profile out; a network hiccup does not.
    async fn fresh_token(&self, app: &tauri::AppHandle, user_id: &str, account: &mut Account) -> Result<String, String> {
        if account.tokens.expires_at > now_secs() + 60 {
            return Ok(account.tokens.access.clone());
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
                apply_session(account, &session)?;
                // Only the session goes back: another command may have changed the
                // rest of the account while the request was out.
                let Some(mut latest) = self.account_of(app, user_id).await else {
                    return Err("auth:not_signed_in".into());
                };
                latest.tokens = account.tokens.clone();
                latest.aal = account.aal.clone();
                latest.factor_id = account.factor_id.clone();
                latest.user_id = account.user_id.clone();
                latest.email = account.email.clone();
                self.store_for(app, user_id, Some(latest)).await?;
                Ok(account.tokens.access.clone())
            }
            Err(err) if refresh_rejected(&err) => {
                let _ = self.store_for(app, user_id, None).await;
                emit_status(app).await;
                Err("auth:session_expired".into())
            }
            Err(err) => Err(err),
        }
    }
}

/// Whether GoTrue turned the refresh token down for good, as opposed to a hiccup (no
/// network, a timeout, a rate limit or a server error) that must keep the session.
fn refresh_rejected(err: &str) -> bool {
    if err == "auth:timeout" || err == "auth:offline" || err.starts_with("auth:over_") {
        return false;
    }
    if err.starts_with("HTTP 429") || err.starts_with("HTTP 5") {
        return false;
    }
    err.starts_with("auth:") || err.starts_with("HTTP 4")
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
    // Account data with no life of its own on this PC goes with it.
    store.delete(addons_off_key(user_id));
    store.save().map_err(|e| e.to_string())
}

/// Drops the sealed account of a deleted (or forgotten) profile.
pub fn forget_profile(app: &tauri::AppHandle, user_id: &str) {
    if let Ok(store) = app.store(crate::store_path()) {
        store.delete(account_key(user_id));
        store.delete(prompt_key(user_id));
        store.delete(addons_off_key(user_id));
        let _ = store.save();
    }
}

/// Where 0.6.2 kept the addons the website had switched off; they live in the
/// profile settings (`addons.disabled`) now, so the key is only ever cleaned up.
fn addons_off_key(user_id: &str) -> String {
    format!("addonsOff.{user_id}")
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
    let uid = state.account.user_id().await?;
    let mut account = state.account.account().await?;
    let factor_id = account
        .factor_id
        .clone()
        .ok_or_else(|| "auth:mfa_not_enrolled".to_string())?;
    let token = state.account.fresh_token(&app, &uid, &mut account).await?;
    let session = verify_code(&state.account, &factor_id, &code, &token).await?;
    apply_session(&mut account, &session)?;
    state.account.store(&app, Some(account)).await?;
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
    let uid = state.account.user_id().await?;
    let mut account = state.account.account().await?;
    let token = state.account.fresh_token(&app, &uid, &mut account).await?;
    let session = verify_code(&state.account, &factor_id, &code, &token).await?;
    apply_session(&mut account, &session)?;
    account.factor_id = Some(factor_id);
    state.account.store(&app, Some(account)).await?;
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
    let uid = state.account.user_id().await?;
    let mut account = state.account.account().await?;
    let factor_id = account
        .factor_id
        .clone()
        .ok_or_else(|| "auth:mfa_not_enrolled".to_string())?;
    let mut token = state.account.fresh_token(&app, &uid, &mut account).await?;
    if account.aal != "aal2" {
        let session = verify_code(&state.account, &factor_id, &code, &token).await?;
        apply_session(&mut account, &session)?;
        token = account.tokens.access.clone();
    }
    state.account.auth_delete(&format!("/factors/{factor_id}"), &token).await?;
    account.factor_id = None;
    state.account.store(&app, Some(account)).await?;
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
    let was = account.sync_credentials;
    account.sync_credentials = enabled;
    if enabled && !was {
        // The documents that carry secrets change shape: push them again. Switching
        // it off changes nothing in the account (this PC just keeps its own to itself).
        account.sync_hash.remove("iptv");
        account.sync_hash.remove("servers");
    }
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
        // A factor enrolled on the website shows up with the next token refresh: say
        // so, or the profile would look synced while nothing moves.
        *acc.last_error.write().await = Some("auth:mfa_required".into());
        emit_status(app).await;
        return Ok(SyncReport { skipped: Some("mfa_required".into()), ..SyncReport::default() });
    }
    acc.syncing.store(true, std::sync::atomic::Ordering::Relaxed);
    let _ = app.emit("account://changed", &status(app, state).await);
    let result = sync_inner(app, state, &uid, account).await;
    acc.syncing.store(false, std::sync::atomic::Ordering::Relaxed);
    // The profile may have changed while this ran: its status is not ours to touch.
    if acc.is_active(&uid).await {
        *acc.last_error.write().await = match &result {
            Ok(report) if report.skipped.as_deref().is_some_and(|s| s.ends_with(":too_large")) => {
                Some("auth:doc_too_large".into())
            }
            Ok(_) => None,
            Err(err) => Some(err.clone()),
        };
        emit_status(app).await;
        if let Ok(report) = &result {
            let _ = app.emit("account://synced", report);
        }
    }
    result
}

async fn sync_inner(app: &tauri::AppHandle, state: &AppState, uid: &str, mut account: Account) -> Result<SyncReport, String> {
    let acc = &state.account;
    let local_profile = state.local.read().await.clone();
    let credentials = account.sync_credentials;
    let token = acc.fresh_token(app, uid, &mut account).await?;
    let rows: Vec<ServerRow> = serde_json::from_value(
        acc.rest_get("/user_data?select=kind,data,updated_at", &token).await?,
    )
    .map_err(|_| "Respuesta de sincronización no válida".to_string())?;
    let server: HashMap<String, ServerRow> = rows.into_iter().map(|r| (r.kind.clone(), r)).collect();

    let device = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "windows".into());
    let mut report = SyncReport::default();
    let mut to_push: Vec<Value> = Vec::new();

    for kind in KINDS {
        if !acc.is_active(uid).await {
            // Another profile took over while the requests were out: nothing of this
            // one may land in it.
            return Ok(SyncReport { skipped: Some("profile_changed".into()), ..SyncReport::default() });
        }
        let local_doc = build_doc(app, state, uid, kind, credentials, local_profile.as_ref()).await;
        let local_hash = doc_hash(&local_doc);
        // A first sync only counts a document with something in it; after that any
        // change does, an emptied list included.
        let local_changed = match account.sync_hash.get(kind) {
            Some(hash) => *hash != local_hash,
            None => !doc_is_empty(&local_doc),
        };
        let row = server.get(kind);
        let server_changed = row.is_some_and(|r| account.sync_stamp.get(kind) != Some(&r.updated_at));
        let base = account.sync_base.get(kind);
        let final_doc: Option<(Value, bool)> = match (row, server_changed, local_changed) {
            (Some(r), true, false) => Some((r.data.clone(), false)),
            // A push always merges with what the account holds: this PC cannot keep
            // every item (other servers, addons switched off on the website) itself.
            (Some(r), _, true) => Some((merge_docs(kind, &r.data, &local_doc, base), true)),
            (None, _, true) => Some((local_doc.clone(), true)),
            _ => None,
        };
        let Some((doc, push)) = final_doc else {
            continue;
        };
        if doc != local_doc {
            apply_doc(app, state, uid, kind, &doc, credentials, local_profile.as_ref()).await?;
            report.pulled.push(kind.to_string());
        }
        // What this PC ended up holding: the yardstick for the next sync.
        let applied = build_doc(app, state, uid, kind, credentials, local_profile.as_ref()).await;
        if push {
            let mut upload = doc;
            if let (false, Some(r)) = (credentials, row) {
                carry_secrets(kind, &mut upload, &r.data);
            }
            if serde_json::to_vec(&upload).map(|v| v.len()).unwrap_or(0) > MAX_DOC_BYTES {
                // Not marked as synced: it is tried again once it fits.
                report.skipped = Some(format!("{kind}:too_large"));
                continue;
            }
            to_push.push(json!({ "user_id": account.user_id, "kind": kind, "data": upload, "device": device }));
            report.pushed.push(kind.to_string());
        }
        account.sync_hash.insert(kind.to_string(), doc_hash(&applied));
        account.sync_base.insert(kind.to_string(), base_of(kind, &applied));
        if let Some(r) = row {
            account.sync_stamp.insert(kind.to_string(), r.updated_at.clone());
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

    // Tokens may have been refreshed and settings toggled while this ran: take the
    // account as it is now and add only what the sync learnt.
    let Some(mut latest) = acc.account_of(app, uid).await else {
        return Ok(report);
    };
    latest.sync_hash = account.sync_hash;
    latest.sync_stamp = account.sync_stamp;
    latest.sync_base = account.sync_base;
    latest.last_sync_ms = addons::now_ms();
    acc.store_for(app, uid, Some(latest)).await?;

    // This PC shows up under "Devices" on the website. Not worth failing a sync over.
    let device_id = crate::device_id_or_create(app);
    let _ = acc
        .rest_rpc_with(
            "touch_device",
            json!({ "p_id": device_id, "p_name": device, "p_platform": "windows", "p_version": env!("CARGO_PKG_VERSION") }),
            &token,
        )
        .await;
    Ok(report)
}

/// FNV-1a over the canonical JSON: stable across Rust versions and key order, unlike
/// `DefaultHasher`, so an update never makes every document look changed.
fn doc_hash(doc: &Value) -> u64 {
    let mut text = String::new();
    canonical(doc, &mut text);
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    hash
}

fn canonical(value: &Value, out: &mut String) {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (i, key) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String((*key).clone()).to_string());
                out.push(':');
                canonical(&map[*key], out);
            }
            out.push('}');
        }
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                canonical(item, out);
            }
            out.push(']');
        }
        other => out.push_str(&other.to_string()),
    }
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

/// Items of a document keyed by id, whether it holds an array (`id` / `key`) or an
/// object (progress).
fn doc_items(doc: &Value) -> Vec<(String, Value)> {
    match doc.get("items") {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| {
                let id = item_id(item);
                (!id.is_empty()).then(|| (id, item.clone()))
            })
            .collect(),
        Some(Value::Object(items)) => items.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
        _ => Vec::new(),
    }
}

fn item_time(item: &Value) -> u64 {
    item.get("updatedMs").and_then(|v| v.as_u64()).unwrap_or(0)
}

/// What the last sync left, per item: its `updatedMs` and a hash of its content. For
/// settings the whole document, section by section.
fn base_of(kind: &str, applied: &Value) -> Value {
    if kind == "settings" {
        return applied.get("items").cloned().unwrap_or(Value::Null);
    }
    let mut map = serde_json::Map::new();
    for (id, item) in doc_items(applied) {
        map.insert(id, json!({ "t": item_time(&item), "h": doc_hash(&item) }));
    }
    Value::Object(map)
}

/// (`updatedMs`, content hash) the base recorded for an item.
fn base_entry(base: Option<&Value>, id: &str) -> Option<(u64, u64)> {
    let entry = base?.get(id)?;
    Some((
        entry.get("t").and_then(|v| v.as_u64()).unwrap_or(0),
        entry.get("h").and_then(|v| v.as_u64()).unwrap_or(0),
    ))
}

/// Merges the account's document with this PC's, item by item, against what the last
/// sync left (`base`): a side that still matches the base yields to the other; when
/// both moved, the newer `updatedMs` wins and the local copy breaks ties; an item one
/// side removed stays gone unless the other side touched it since. Without a base
/// (the first sync on a PC) nothing is dropped.
fn merge_docs(kind: &str, server: &Value, local: &Value, base: Option<&Value>) -> Value {
    if kind == "settings" {
        return merge_settings(server, local, base);
    }
    let server_items = doc_items(server);
    let local_items = doc_items(local);
    let server_map: HashMap<&str, &Value> = server_items.iter().map(|(id, v)| (id.as_str(), v)).collect();
    let local_map: HashMap<&str, &Value> = local_items.iter().map(|(id, v)| (id.as_str(), v)).collect();
    let mut merged: Vec<(String, Value)> = Vec::new();
    let mut seen = HashSet::new();
    // Local order first, then whatever only the account has.
    for (id, _) in local_items.iter().chain(server_items.iter()) {
        if !seen.insert(id.clone()) {
            continue;
        }
        let picked = match (local_map.get(id.as_str()), server_map.get(id.as_str())) {
            (Some(l), Some(s)) => match base_entry(base, id) {
                Some((_, hash)) if doc_hash(l) == hash => Some((*s).clone()),
                Some((_, hash)) if doc_hash(s) == hash => Some((*l).clone()),
                _ if item_time(s) > item_time(l) => Some((*s).clone()),
                _ => Some((*l).clone()),
            },
            (Some(l), None) => match base_entry(base, id) {
                // The other side removed it, and this PC left it alone since.
                Some((time, _)) if item_time(l) <= time => None,
                _ => Some((*l).clone()),
            },
            (None, Some(s)) => match base_entry(base, id) {
                // Removed on this PC, and nobody touched it since.
                Some((time, _)) if item_time(s) <= time => None,
                _ => Some((*s).clone()),
            },
            (None, None) => None,
        };
        if let Some(item) = picked {
            merged.push((id.clone(), item));
        }
    }
    let keyed = server.get("items").is_some_and(Value::is_object) || local.get("items").is_some_and(Value::is_object);
    if keyed {
        let map: serde_json::Map<String, Value> = merged.into_iter().collect();
        json!({ "kind": kind, "items": map })
    } else {
        let items: Vec<Value> = merged.into_iter().map(|(_, v)| v).collect();
        json!({ "kind": kind, "items": items })
    }
}

/// Settings merge section by section (appearance, playback, favourites...), so a theme
/// changed on one PC and a favourite added on another both survive. A section both
/// sides changed goes to the account.
fn merge_settings(server: &Value, local: &Value, base: Option<&Value>) -> Value {
    let s = items_object(server);
    let l = items_object(local);
    let b = base.and_then(|v| v.as_object());
    let mut keys: Vec<String> = l.keys().cloned().collect();
    keys.extend(s.keys().filter(|k| !l.contains_key(*k)).cloned());
    let mut out = serde_json::Map::new();
    for key in keys {
        let sv = s.get(&key);
        let lv = l.get(&key);
        let bv = b.and_then(|m| m.get(&key));
        let picked = if key == "iptvFavorites" {
            merge_favorites(sv, lv, bv)
        } else {
            match (sv, lv) {
                (Some(sv), Some(lv)) => {
                    if lv == sv || bv == Some(lv) {
                        sv.clone()
                    } else if bv == Some(sv) {
                        lv.clone()
                    } else {
                        sv.clone()
                    }
                }
                (Some(sv), None) => sv.clone(),
                (None, Some(lv)) => lv.clone(),
                (None, None) => continue,
            }
        };
        out.insert(key, picked);
    }
    json!({ "kind": "settings", "items": out })
}

/// Favourite channels as a set: kept when both sides have it or one side added it,
/// gone when one side dropped something the base had.
fn merge_favorites(server: Option<&Value>, local: Option<&Value>, base: Option<&Value>) -> Value {
    let ids = |v: Option<&Value>| -> Vec<String> {
        v.and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
            .unwrap_or_default()
    };
    let s = ids(server);
    let l = ids(local);
    let b: HashSet<String> = ids(base).into_iter().collect();
    let in_s: HashSet<&String> = s.iter().collect();
    let in_l: HashSet<&String> = l.iter().collect();
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for id in l.iter().chain(s.iter()) {
        if !seen.insert(id.clone()) {
            continue;
        }
        let keep = (in_l.contains(id) && in_s.contains(id)) || !b.contains(id);
        if keep {
            out.push(Value::String(id.clone()));
        }
    }
    Value::Array(out)
}

/// A PC that keeps its passwords to itself must not blank the ones another PC put in
/// the account: an empty secret in what it uploads takes the account's value.
fn carry_secrets(kind: &str, doc: &mut Value, server: &Value) {
    let field = match kind {
        "iptv" => "password",
        "servers" => "token",
        _ => return,
    };
    let held: HashMap<String, String> = doc_items(server)
        .into_iter()
        .filter_map(|(id, item)| {
            item.get(field)
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| (id, s.to_string()))
        })
        .collect();
    let Some(items) = doc.get_mut("items").and_then(|v| v.as_array_mut()) else {
        return;
    };
    for item in items.iter_mut().filter(|i| i.is_object()) {
        let empty = item.get(field).and_then(|v| v.as_str()).is_none_or(str::is_empty);
        if let (true, Some(secret)) = (empty, held.get(&item_id(item))) {
            item[field] = Value::String(secret.clone());
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

/// A Jellyfin session as the servers document lists it.
fn server_item(app: &tauri::AppHandle, session: &crate::jellyfin::Session, credentials: bool) -> Value {
    let name = crate::load_server(app)
        .ok()
        .flatten()
        .filter(|s| s.server_url == session.server_url)
        .map(|s| s.server_name)
        .unwrap_or_default();
    json!({
        "id": format!("jellyfin:{}", session.user_id),
        "type": "jellyfin",
        "name": name,
        "url": session.server_url,
        "userId": session.user_id,
        "userName": session.user_name,
        "deviceId": session.device_id,
        "token": if credentials { session.token.clone() } else { String::new() },
    })
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
            let prefs = settings::load(app, uid).map(|s| s.addons).unwrap_or_default();
            let items: Vec<Value> = prefs
                .urls
                .iter()
                .map(|u| json!({ "id": u, "manifestUrl": u, "name": host_of(u), "enabled": !prefs.disabled.contains(u) }))
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
            match local_profile {
                Some(profile) => {
                    let key = profiles::session_key(&profile.id);
                    if let Ok(Some(session)) = crate::load_session_at(app, &key) {
                        items.push(server_item(app, &session, credentials));
                    }
                }
                // Signed in straight to a server: that session is the server.
                None => {
                    if let Some(session) = state.jellyfin.session().await {
                        items.push(server_item(app, &session, credentials));
                    }
                }
            }
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
            let items = items_array(doc);
            let enabled = |i: &Value| i.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
            let url_of = |i: &Value| i.get("manifestUrl").and_then(|v| v.as_str()).map(str::to_string);
            let urls: Vec<String> = items.iter().filter_map(url_of).collect();
            let disabled: Vec<String> = items.iter().filter(|i| !enabled(i)).filter_map(url_of).collect();
            let _guard = state.settings_lock.lock().await;
            let saved = settings::merge_and_save(app, uid, json!({ "addons": { "urls": urls, "disabled": disabled } }))?;
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
            let saved = match settings::merge_and_save(app, uid, Value::Object(patch.clone())) {
                Ok(saved) => Some(saved),
                Err(_) => {
                    // One section the app cannot read must not block the others.
                    let mut last = None;
                    for (key, value) in patch {
                        if let Ok(saved) = settings::merge_and_save(app, uid, json!({ key: value })) {
                            last = Some(saved);
                        }
                    }
                    last
                }
            };
            if let Some(saved) = saved {
                let _ = app.emit("settings://changed", &saved);
            }
            if let Some(favorites) = items.get("iptvFavorites").and_then(|v| v.as_array()) {
                let ids: Vec<String> = favorites.iter().filter_map(|v| v.as_str().map(str::to_string)).collect();
                iptv::set_favorites_list(app, uid, ids)?;
                let _ = app.emit("iptv://changed", ());
            }
        }
        "lists" => {
            // Entry by entry: one the app cannot read must not empty the list.
            let list: Vec<addons::LibraryEntry> = items_array(doc)
                .into_iter()
                .filter_map(|v| serde_json::from_value(v).ok())
                .collect();
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
            // Signed in straight to a server there is nothing to link: the account
            // just remembers this one along with the others.
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

#[cfg(test)]
mod tests {
    use super::*;

    fn list(items: Vec<Value>) -> Value {
        json!({ "kind": "lists", "items": items })
    }

    fn entry(key: &str, watched: bool, updated: u64) -> Value {
        json!({ "key": key, "type": "movie", "saved": true, "watched": watched, "updatedMs": updated })
    }

    fn keys(doc: &Value) -> Vec<String> {
        doc_items(doc).into_iter().map(|(id, _)| id).collect()
    }

    #[test]
    fn hash_ignores_key_order_and_is_stable() {
        let a = json!({ "b": 1, "a": [ { "y": 2, "x": 1 } ] });
        let b = json!({ "a": [ { "x": 1, "y": 2 } ], "b": 1 });
        assert_eq!(doc_hash(&a), doc_hash(&b));
        // FNV-1a of "{}": a changed algorithm would make every install re-merge.
        assert_eq!(doc_hash(&json!({})), 645_223_143_103_797_797);
    }

    #[test]
    fn refresh_errors_that_keep_the_session() {
        assert!(!refresh_rejected("auth:offline"));
        assert!(!refresh_rejected("auth:timeout"));
        assert!(!refresh_rejected("auth:over_request_rate_limit"));
        assert!(!refresh_rejected("HTTP 429: slow down"));
        assert!(!refresh_rejected("HTTP 503: down"));
        assert!(!refresh_rejected("Error de red: reset"));
        assert!(refresh_rejected("auth:refresh_token_already_used"));
        assert!(refresh_rejected("auth:invalid_grant"));
        assert!(refresh_rejected("HTTP 400: bad"));
    }

    #[test]
    fn first_merge_without_base_keeps_everything_newest_wins() {
        let server = list(vec![entry("a", true, 20), entry("b", false, 5)]);
        let local = list(vec![entry("a", false, 10), entry("c", false, 1)]);
        let merged = merge_docs("lists", &server, &local, None);
        assert_eq!(keys(&merged), vec!["a", "c", "b"]);
        let a = &doc_items(&merged)[0].1;
        assert_eq!(a["watched"], json!(true));
    }

    #[test]
    fn removal_on_one_side_wins_over_an_untouched_copy() {
        let before = list(vec![entry("a", false, 10), entry("b", false, 10)]);
        let base = base_of("lists", &before);
        // Locally "a" was removed; the account still has both, unchanged.
        let local = list(vec![entry("b", false, 10)]);
        let merged = merge_docs("lists", &before, &local, Some(&base));
        assert_eq!(keys(&merged), vec!["b"]);
        // The account dropped "b" while this PC left it alone.
        let server = list(vec![entry("a", false, 10)]);
        let merged = merge_docs("lists", &server, &before, Some(&base));
        assert_eq!(keys(&merged), vec!["a"]);
    }

    #[test]
    fn an_update_after_the_base_beats_a_removal() {
        let before = list(vec![entry("a", false, 10)]);
        let base = base_of("lists", &before);
        let server = list(vec![entry("a", true, 30)]);
        let local = list(vec![]);
        let merged = merge_docs("lists", &server, &local, Some(&base));
        assert_eq!(keys(&merged), vec!["a"]);
        assert_eq!(doc_items(&merged)[0].1["watched"], json!(true));
    }

    #[test]
    fn the_side_that_did_not_move_yields() {
        let before = list(vec![entry("a", false, 10)]);
        let base = base_of("lists", &before);
        // Website ticked "a" watched with an older stamp than a local no-op copy.
        let server = list(vec![entry("a", true, 10)]);
        let merged = merge_docs("lists", &server, &before, Some(&base));
        assert_eq!(doc_items(&merged)[0].1["watched"], json!(true));
        // And the other way round: local changed, account untouched.
        let local = list(vec![entry("a", true, 12)]);
        let merged = merge_docs("lists", &before, &local, Some(&base));
        assert_eq!(doc_items(&merged)[0].1["updatedMs"], json!(12));
    }

    #[test]
    fn progress_stays_keyed_and_forgets_finished_titles() {
        let before = json!({ "kind": "progress", "items": { "f": { "key": "f", "positionSeconds": 40.0, "updatedMs": 5 }, "g": { "key": "g", "positionSeconds": 1.0, "updatedMs": 5 } } });
        let base = base_of("progress", &before);
        let local = json!({ "kind": "progress", "items": { "g": { "key": "g", "positionSeconds": 2.0, "updatedMs": 9 } } });
        let merged = merge_docs("progress", &before, &local, Some(&base));
        assert!(merged["items"].is_object());
        assert_eq!(keys(&merged), vec!["g"]);
        assert_eq!(merged["items"]["g"]["positionSeconds"], json!(2.0));
    }

    #[test]
    fn settings_merge_section_by_section() {
        let before = json!({ "kind": "settings", "items": { "appearance": { "theme": "crimson" }, "playback": { "speed": 1 }, "iptvFavorites": ["a", "b"] } });
        let base = base_of("settings", &before);
        let server = json!({ "kind": "settings", "items": { "appearance": { "theme": "ocean" }, "playback": { "speed": 1 }, "iptvFavorites": ["a", "b", "c"] } });
        let local = json!({ "kind": "settings", "items": { "appearance": { "theme": "crimson" }, "playback": { "speed": 2 }, "iptvFavorites": ["b", "d"] } });
        let merged = merge_docs("settings", &server, &local, Some(&base));
        assert_eq!(merged["items"]["appearance"]["theme"], json!("ocean"));
        assert_eq!(merged["items"]["playback"]["speed"], json!(2));
        assert_eq!(merged["items"]["iptvFavorites"], json!(["b", "d", "c"]));
    }

    #[test]
    fn settings_conflict_goes_to_the_account() {
        let server = json!({ "kind": "settings", "items": { "appearance": { "theme": "ocean" } } });
        let local = json!({ "kind": "settings", "items": { "appearance": { "theme": "jade" }, "discord": { "enabled": true } } });
        let merged = merge_docs("settings", &server, &local, None);
        assert_eq!(merged["items"]["appearance"]["theme"], json!("ocean"));
        assert_eq!(merged["items"]["discord"]["enabled"], json!(true));
    }

    #[test]
    fn other_servers_survive_a_push_from_a_pc_that_holds_one() {
        let server = json!({ "kind": "servers", "items": [ { "id": "jellyfin:u", "type": "jellyfin", "url": "http://a" }, { "id": "plex:x", "type": "plex", "url": "http://p" } ] });
        let local = json!({ "kind": "servers", "items": [ { "id": "jellyfin:u", "type": "jellyfin", "url": "http://a", "token": "t" } ] });
        let base = base_of("servers", &json!({ "kind": "servers", "items": [ { "id": "jellyfin:u", "type": "jellyfin", "url": "http://a" } ] }));
        let merged = merge_docs("servers", &server, &local, Some(&base));
        assert_eq!(keys(&merged), vec!["jellyfin:u", "plex:x"]);
        assert_eq!(doc_items(&merged)[0].1["token"], json!("t"));
    }

    #[test]
    fn secrets_the_account_holds_are_not_blanked() {
        let server = json!({ "kind": "iptv", "items": [ { "id": "1", "password": "pw" }, { "id": "2", "password": "" } ] });
        let mut upload = json!({ "kind": "iptv", "items": [ { "id": "1", "password": "" }, { "id": "2", "password": "" }, { "id": "3", "password": "" } ] });
        carry_secrets("iptv", &mut upload, &server);
        let items = items_array(&upload);
        assert_eq!(items[0]["password"], json!("pw"));
        assert_eq!(items[1]["password"], json!(""));
        assert_eq!(items[2]["password"], json!(""));
    }
}
