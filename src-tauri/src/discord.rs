//! Discord Rich Presence over Discord's local IPC pipe (`\\.\pipe\discord-ipc-N`), with
//! no SDK: a handshake frame, then `SET_ACTIVITY` commands. A background task owns the
//! connection; the rest of the app only describes the desired activity and the task
//! reconciles it (reconnecting with a backoff when Discord is not running).

use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient};
use tokio::sync::{Mutex, Notify, RwLock};

/// Public application id used until the user pastes their own (shows the app name that
/// application was registered with; create one at discord.com/developers to show "ejFlix").
pub const DEFAULT_CLIENT_ID: &str = "1280587438863028236";
const TICK: Duration = Duration::from_secs(15);
const RETRY: Duration = Duration::from_secs(30);
const IO_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_FRAME: usize = 64 * 1024;
/// Discord requires 2..=128 characters for `details` / `state`.
const MAX_TEXT: usize = 128;

/// What is playing, as far as the presence cares (filled by the play commands).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PresenceInfo {
    /// Movie title or series name.
    pub title: String,
    /// "S1:E3 · Episode title" for episodes.
    pub episode: Option<String>,
    pub year: Option<i32>,
    /// "movie" | "series" | "live"
    pub kind: String,
    /// Publicly reachable poster (Discord fetches it through its own proxy).
    pub poster_url: Option<String>,
    /// Server name, "Online" or the IPTV list name.
    pub source: String,
    /// Live TV: programme boundaries (unix seconds) shown as the activity time.
    #[serde(default)]
    pub live_window: Option<(u64, u64)>,
}

/// Activity as sent to Discord.
#[derive(Debug, Clone)]
pub struct Activity {
    pub details: Option<String>,
    pub state: Option<String>,
    /// (start, end) unix seconds.
    pub timestamps: Option<(u64, Option<u64>)>,
    pub large_image: Option<String>,
    pub large_text: String,
    /// Discord `status_display_type`: 0 = application name, 1 = state, 2 = details.
    pub status_display: u8,
}

impl Activity {
    /// Equal enough not to resend: timestamps may drift a couple of seconds per tick.
    fn same_as(&self, other: &Activity) -> bool {
        let ts = match (self.timestamps, other.timestamps) {
            (None, None) => true,
            (Some((a, ae)), Some((b, be))) => {
                a.abs_diff(b) <= 3
                    && match (ae, be) {
                        (None, None) => true,
                        (Some(x), Some(y)) => x.abs_diff(y) <= 3,
                        _ => false,
                    }
            }
            _ => false,
        };
        ts && self.details == other.details
            && self.state == other.state
            && self.large_image == other.large_image
            && self.large_text == other.large_text
            && self.status_display == other.status_display
    }

    fn to_command(&self) -> Value {
        let mut activity = json!({
            "type": 3,
            "instance": false,
            "status_display_type": self.status_display,
        });
        if let Some(details) = &self.details {
            activity["details"] = Value::String(details.clone());
        }
        if let Some(state) = &self.state {
            activity["state"] = Value::String(state.clone());
        }
        if let Some((start, end)) = self.timestamps {
            let mut ts = json!({ "start": start });
            if let Some(end) = end {
                ts["end"] = json!(end);
            }
            activity["timestamps"] = ts;
        }
        let mut assets = json!({ "large_text": self.large_text });
        if let Some(image) = &self.large_image {
            assets["large_image"] = Value::String(image.clone());
        }
        activity["assets"] = assets;
        json!({
            "cmd": "SET_ACTIVITY",
            "args": { "pid": std::process::id(), "activity": activity },
            "nonce": format!("{}", now_secs()),
        })
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub connected: bool,
    pub error: Option<String>,
}

pub struct Discord {
    desired: RwLock<Option<Activity>>,
    client_id: RwLock<String>,
    notify: Notify,
    status: Mutex<Status>,
}

impl Discord {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            desired: RwLock::new(None),
            client_id: RwLock::new(DEFAULT_CLIENT_ID.to_string()),
            notify: Notify::new(),
            status: Mutex::new(Status::default()),
        })
    }

    /// Describe what Discord should show (`None` clears it). Cheap to call often.
    pub async fn set(&self, client_id: &str, activity: Option<Activity>) {
        let client_id = if client_id.trim().is_empty() {
            DEFAULT_CLIENT_ID.to_string()
        } else {
            client_id.trim().to_string()
        };
        let changed = {
            let mut current = self.desired.write().await;
            let mut id = self.client_id.write().await;
            let same = match (&*current, &activity) {
                (None, None) => true,
                (Some(a), Some(b)) => a.same_as(b),
                _ => false,
            };
            let changed = !same || *id != client_id;
            if changed {
                *current = activity;
                *id = client_id;
            }
            changed
        };
        if changed {
            self.notify.notify_one();
        }
    }

    pub async fn status(&self) -> Status {
        self.status.lock().await.clone()
    }

    /// Runs the reconciliation loop for the lifetime of the app.
    pub fn spawn(self: &Arc<Self>) {
        let me = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut conn: Option<NamedPipeClient> = None;
            let mut connected_id = String::new();
            let mut sent: Option<Activity> = None;
            let mut retry_after: Option<Instant> = None;
            loop {
                tokio::select! {
                    _ = me.notify.notified() => {}
                    _ = tokio::time::sleep(TICK) => {}
                }
                let desired = me.desired.read().await.clone();
                let client_id = me.client_id.read().await.clone();
                let Some(desired) = desired else {
                    // Closing the pipe is how presence goes away.
                    if conn.take().is_some() {
                        sent = None;
                        me.set_status(false, None).await;
                    }
                    continue;
                };
                if conn.is_some() && connected_id != client_id {
                    conn = None;
                    sent = None;
                }
                if conn.is_none() {
                    if retry_after.is_some_and(|at| at > Instant::now()) {
                        continue;
                    }
                    match connect(&client_id).await {
                        Ok(client) => {
                            conn = Some(client);
                            connected_id = client_id.clone();
                            retry_after = None;
                            me.set_status(true, None).await;
                        }
                        Err(err) => {
                            retry_after = Some(Instant::now() + RETRY);
                            me.set_status(false, Some(err)).await;
                            continue;
                        }
                    }
                }
                if sent.as_ref().is_some_and(|s| s.same_as(&desired)) {
                    continue;
                }
                let Some(client) = conn.as_mut() else { continue };
                match send_activity(client, &desired).await {
                    Ok(()) => sent = Some(desired),
                    Err(err) => {
                        conn = None;
                        sent = None;
                        retry_after = Some(Instant::now() + Duration::from_secs(5));
                        me.set_status(false, Some(err)).await;
                    }
                }
            }
        });
    }

    async fn set_status(&self, connected: bool, error: Option<String>) {
        *self.status.lock().await = Status { connected, error };
    }
}

async fn connect(client_id: &str) -> Result<NamedPipeClient, String> {
    let mut last = "Discord no está abierto".to_string();
    for i in 0..10 {
        let name = format!(r"\\.\pipe\discord-ipc-{i}");
        let Ok(mut client) = ClientOptions::new().open(&name) else {
            continue;
        };
        let hello = json!({ "v": 1, "client_id": client_id });
        match handshake(&mut client, &hello).await {
            Ok(()) => return Ok(client),
            Err(err) => last = err,
        }
    }
    Err(last)
}

async fn handshake(client: &mut NamedPipeClient, hello: &Value) -> Result<(), String> {
    write_frame(client, 0, hello).await?;
    let (op, value) = read_frame(client).await?;
    if op == 2 {
        let message = value
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Discord rechazó la conexión");
        return Err(message.to_string());
    }
    if value.get("evt").and_then(|v| v.as_str()) == Some("ERROR") {
        let message = value
            .pointer("/data/message")
            .and_then(|v| v.as_str())
            .unwrap_or("Application ID no válido");
        return Err(message.to_string());
    }
    Ok(())
}

async fn send_activity(client: &mut NamedPipeClient, activity: &Activity) -> Result<(), String> {
    write_frame(client, 1, &activity.to_command()).await?;
    // Discord answers every command; draining the reply keeps the pipe healthy.
    let (_, value) = read_frame(client).await?;
    if value.get("evt").and_then(|v| v.as_str()) == Some("ERROR") {
        let message = value
            .pointer("/data/message")
            .and_then(|v| v.as_str())
            .unwrap_or("Discord rechazó la actividad");
        return Err(message.to_string());
    }
    Ok(())
}

async fn write_frame(client: &mut NamedPipeClient, op: u32, payload: &Value) -> Result<(), String> {
    let body = payload.to_string();
    let mut buf = Vec::with_capacity(8 + body.len());
    buf.extend_from_slice(&op.to_le_bytes());
    buf.extend_from_slice(&(body.len() as u32).to_le_bytes());
    buf.extend_from_slice(body.as_bytes());
    tokio::time::timeout(IO_TIMEOUT, client.write_all(&buf))
        .await
        .map_err(|_| "Discord no responde".to_string())?
        .map_err(|e| format!("Discord: {e}"))
}

async fn read_frame(client: &mut NamedPipeClient) -> Result<(u32, Value), String> {
    let read = async {
        let mut head = [0u8; 8];
        client.read_exact(&mut head).await?;
        let op = u32::from_le_bytes([head[0], head[1], head[2], head[3]]);
        let len = u32::from_le_bytes([head[4], head[5], head[6], head[7]]) as usize;
        if len > MAX_FRAME {
            return Err(std::io::Error::other("frame too large"));
        }
        let mut body = vec![0u8; len];
        client.read_exact(&mut body).await?;
        Ok::<(u32, Vec<u8>), std::io::Error>((op, body))
    };
    let (op, body) = tokio::time::timeout(IO_TIMEOUT, read)
        .await
        .map_err(|_| "Discord no responde".to_string())?
        .map_err(|e| format!("Discord: {e}"))?;
    let value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    Ok((op, value))
}

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Fills a template such as `"{title} ({year})"` with the presence info.
pub fn fill_template(template: &str, info: &PresenceInfo, locale: &str) -> String {
    let kind = match (info.kind.as_str(), locale) {
        ("series", "en") => "TV show",
        ("series", _) => "Serie",
        ("live", "en") => "Live TV",
        ("live", _) => "TV en directo",
        (_, "en") => "Movie",
        _ => "Película",
    };
    let year = info.year.map(|y| y.to_string()).unwrap_or_default();
    let mut out = template
        .replace("{title}", &info.title)
        .replace("{episode}", info.episode.as_deref().unwrap_or(""))
        .replace("{year}", &year)
        .replace("{type}", kind)
        .replace("{source}", &info.source);
    // Collapse separators left behind by empty placeholders ("Title · " → "Title").
    loop {
        let trimmed = out
            .trim()
            .trim_end_matches(['·', '-', '|', '(', ')', ','])
            .trim_start_matches(['·', '-', '|', ','])
            .trim()
            .to_string();
        let trimmed = trimmed.replace("()", "");
        if trimmed == out {
            break;
        }
        out = trimmed;
    }
    out
}

/// 2..=128 characters or nothing at all (Discord rejects one-character fields).
pub fn clamp_text(text: String) -> Option<String> {
    let text = text.trim();
    if text.chars().count() < 2 {
        return None;
    }
    Some(text.chars().take(MAX_TEXT).collect())
}
