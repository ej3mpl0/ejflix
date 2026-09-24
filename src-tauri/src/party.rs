//! Watch party: a few people watch the same title in step.
//!
//! There is no server of our own behind it. The party rides on Supabase Realtime:
//! Broadcast carries the messages and Presence says who is in. The one websocket of a
//! party lives here, so the webview's CSP stays closed and the account token (sent
//! along when the profile is signed in) never reaches it. Rust only carries messages
//! and keeps the member list; the player overlay decides what they mean (the host's
//! player is the clock, the guests' follow it).

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Emitter, Manager, State};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::{protocol::WebSocketConfig, Message};

use crate::account::{SUPABASE_ANON_KEY, SUPABASE_URL};
use crate::jellyfin::Movie;
use crate::AppState;

/// Phoenix drops a socket that stays quiet for 60 s.
const HEARTBEAT: Duration = Duration::from_secs(25);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const JOIN_TIMEOUT: Duration = Duration::from_secs(12);
/// A guest who finds nobody hosting after this long typed a code that is not live.
const HOST_WAIT: Duration = Duration::from_secs(10);
/// How long the host may be gone (a network blip, their socket coming back) before the
/// party is over for everyone.
const HOST_GRACE: Duration = Duration::from_secs(45);
/// Presence needs a moment after a (re)join before "the host is not here" means anything.
const PRESENCE_SETTLE: Duration = Duration::from_secs(3);
/// The access token of a long party is renewed well before it expires.
const TOKEN_REFRESH: Duration = Duration::from_secs(10 * 60);
const MAX_BACKOFF_SECS: u64 = 30;
/// Offline from the start: give up after this many tries instead of spinning forever.
const FIRST_JOIN_TRIES: u32 = 3;
const MAX_DATA_BYTES: usize = 8 * 1024;
/// No 0/O nor 1/I/L: the code is read aloud and typed by hand.
const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/// 12 symbols of 31 are ~59 bits: the code is also the channel, so it must not be guessable.
const CODE_LEN: usize = 12;
/// What the webview may send; the rest (title, hello, end) is the party's own plumbing.
const APP_EVENTS: &[&str] = &["sync", "sync_req", "control", "chat", "react", "ping", "pong"];

// ---- codes ----

/// A fresh party code (uppercase, no separators).
fn random_code() -> String {
    let mut out = String::with_capacity(CODE_LEN);
    while out.len() < CODE_LEN {
        let bytes = uuid::Uuid::new_v4().into_bytes();
        // Bytes 6 and 8 carry the UUID version and variant bits: not random.
        for (i, b) in bytes.into_iter().enumerate() {
            // 248 = 31 * 8: dropping the rest keeps every symbol equally likely.
            if i == 6 || i == 8 || usize::from(b) >= ALPHABET.len() * 8 || out.len() >= CODE_LEN {
                continue;
            }
            out.push(char::from(ALPHABET[usize::from(b) % ALPHABET.len()]));
        }
    }
    out
}

/// What the person typed or pasted, as a code: case, spaces and dashes do not matter.
fn normalize_code(input: &str) -> Option<String> {
    let code: String = input
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-' && *c != '·' && *c != '.')
        .map(|c| c.to_ascii_uppercase())
        .collect();
    (code.len() == CODE_LEN && code.bytes().all(|b| ALPHABET.contains(&b))).then_some(code)
}

/// `ABCD-EFGH-JKMN`: easier to read out than twelve letters in a row.
fn format_code(code: &str) -> String {
    code.as_bytes()
        .chunks(4)
        .map(|chunk| String::from_utf8_lossy(chunk).into_owned())
        .collect::<Vec<_>>()
        .join("-")
}

fn topic_of(code: &str) -> String {
    format!("realtime:ejflix-party-{}", code.to_ascii_lowercase())
}

// ---- Phoenix protocol (vsn 1.0.0: one JSON object per frame) ----

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct PhxMessage {
    topic: String,
    event: String,
    #[serde(default)]
    payload: Value,
    #[serde(rename = "ref", default)]
    reference: Option<String>,
    #[serde(default)]
    join_ref: Option<String>,
}

impl PhxMessage {
    fn new(topic: &str, event: &str, payload: Value) -> Self {
        Self {
            topic: topic.to_string(),
            event: event.to_string(),
            payload,
            reference: None,
            join_ref: None,
        }
    }

    fn refs(mut self, reference: String, join_ref: Option<&str>) -> Self {
        self.reference = Some(reference);
        self.join_ref = join_ref.map(str::to_string);
        self
    }

    fn encode(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    fn decode(text: &str) -> Option<Self> {
        serde_json::from_str(text).ok()
    }

    /// `ok` / `error` of a `phx_reply`, with the server's reason for an error.
    fn reply(&self) -> Option<Result<(), String>> {
        if self.event != "phx_reply" {
            return None;
        }
        let status = self.payload.get("status").and_then(|v| v.as_str()).unwrap_or("");
        if status == "ok" {
            return Some(Ok(()));
        }
        let response = self.payload.get("response");
        let reason = response
            .and_then(|r| r.get("reason").or_else(|| r.get("message")))
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .or_else(|| response.map(|r| r.to_string()))
            .unwrap_or_else(|| status.to_string());
        Some(Err(reason))
    }
}

fn join_payload(member: &str, private: bool, token: Option<&str>) -> Value {
    let mut payload = json!({
        "config": {
            "broadcast": { "self": false, "ack": false },
            "presence": { "key": member, "enabled": true },
            "postgres_changes": [],
            "private": private,
        }
    });
    if let Some(token) = token {
        payload["access_token"] = json!(token);
    }
    payload
}

fn broadcast_payload(event: &str, from: &str, data: &Value) -> Value {
    json!({ "type": "broadcast", "event": event, "payload": { "from": from, "data": data } })
}

fn track_payload(meta: &Value) -> Value {
    json!({ "type": "presence", "event": "track", "payload": meta })
}

/// Event, sender and data of a received broadcast (`None` for anything malformed).
fn broadcast_of(payload: &Value) -> Option<(String, String, Value)> {
    let event = payload.get("event")?.as_str()?;
    let body = payload.get("payload")?;
    let from = body.get("from")?.as_str()?;
    if event.len() > 32 || from.is_empty() || from.len() > 64 {
        return None;
    }
    Some((event.to_string(), from.to_string(), body.get("data").cloned().unwrap_or(Value::Null)))
}

/// Why a join was turned down, and what to do about it.
#[derive(Debug, PartialEq)]
enum JoinFailure {
    /// The project only takes private channels: try again as one with the account token.
    TryPrivate,
    /// Private channels need a signed-in ejFlix account.
    NeedsAccount,
    /// Even signed in, the project's policies keep us out of the channel.
    Denied,
    Other(String),
}

fn classify_join_error(reason: &str, private: bool, signed_in: bool) -> JoinFailure {
    let lower = reason.to_ascii_lowercase();
    let private_only = lower.contains("privateonly") || lower.contains("private channel") || lower.contains("only allows private");
    if private_only && !private {
        return if signed_in { JoinFailure::TryPrivate } else { JoinFailure::NeedsAccount };
    }
    let denied = lower.contains("unauthorized") || lower.contains("permission") || lower.contains("forbidden");
    if denied {
        return if private || signed_in { JoinFailure::Denied } else { JoinFailure::NeedsAccount };
    }
    JoinFailure::Other(reason.chars().take(200).collect())
}

// ---- presence ----

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: String,
    pub name: String,
    /// Only preset avatars (`preset:n`) travel: a picture URL would not load elsewhere.
    pub avatar: Option<String>,
    pub host: bool,
}

/// Who is in the channel: per presence key, the member and the `phx_ref` of each of
/// its connections (a member that reconnects is briefly there twice).
#[derive(Debug, Default)]
struct Presence {
    members: BTreeMap<String, (Member, HashSet<String>)>,
}

fn member_of(key: &str, meta: &Value) -> Member {
    let text = |k: &str| meta.get(k).and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let name: String = text("name").chars().take(40).collect();
    let avatar = Some(text("avatar")).filter(|a| a.starts_with("preset:") && a.len() <= 12);
    Member {
        id: key.chars().take(64).collect(),
        name: if name.is_empty() { "?".into() } else { name },
        avatar,
        host: meta.get("host").and_then(|v| v.as_bool()).unwrap_or(false),
    }
}

/// `(phx_ref, meta)` of each connection listed under a presence key.
fn metas_of(entry: &Value) -> Vec<(String, &Value)> {
    entry
        .get("metas")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .map(|meta| {
            let reference = meta.get("phx_ref").and_then(|v| v.as_str()).unwrap_or("").to_string();
            (reference, meta)
        })
        .collect()
}

impl Presence {
    /// `presence_state`: the whole list, right after a join.
    fn sync(&mut self, state: &Value) {
        self.members.clear();
        self.join(state);
    }

    /// `presence_diff`: who came and who went since.
    fn diff(&mut self, diff: &Value) {
        if let Some(joins) = diff.get("joins") {
            self.join(joins);
        }
        let Some(leaves) = diff.get("leaves").and_then(|v| v.as_object()) else {
            return;
        };
        for (key, entry) in leaves {
            let Some((_, refs)) = self.members.get_mut(key) else {
                continue;
            };
            for (reference, _) in metas_of(entry) {
                refs.remove(&reference);
            }
            if refs.is_empty() {
                self.members.remove(key);
            }
        }
    }

    fn join(&mut self, entries: &Value) {
        let Some(entries) = entries.as_object() else {
            return;
        };
        for (key, entry) in entries {
            for (reference, meta) in metas_of(entry) {
                let slot = self
                    .members
                    .entry(key.clone())
                    .or_insert_with(|| (member_of(key, meta), HashSet::new()));
                // The newest connection speaks for the member (a renamed profile...).
                slot.0 = member_of(key, meta);
                slot.1.insert(reference);
            }
        }
    }

    fn host_id(&self) -> Option<&str> {
        self.members.values().find(|(m, _)| m.host).map(|(m, _)| m.id.as_str())
    }

    /// The host first, then everyone else by name.
    fn list(&self) -> Vec<Member> {
        let mut list: Vec<Member> = self.members.values().map(|(m, _)| m.clone()).collect();
        list.sort_by(|a, b| b.host.cmp(&a.host).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        list
    }
}

// ---- state shared with the commands ----

/// What the frontend sees.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PartyStatus {
    pub active: bool,
    /// "idle" | "connecting" | "live" | "reconnecting" | "ended"
    pub phase: String,
    /// Formatted, `ABCD-EFGH-JKMN`.
    pub code: String,
    pub host: bool,
    pub self_id: String,
    pub members: Vec<Member>,
    /// What the host is playing (a descriptor the guests resolve on their side).
    pub title: Option<Value>,
    /// Joined as a private channel (the project requires it; needs the account).
    pub private: bool,
    /// Guests: the host dropped out and may come back.
    pub host_away: bool,
    /// Host: everyone may pause, play and seek (the guests learn it from the heartbeat).
    pub open: bool,
    /// Why the party ended (`party:*`), or why it could not start.
    pub error: Option<String>,
}

enum Cmd {
    Send { event: String, data: Value },
    Title(Value),
    Leave,
}

#[derive(Default)]
struct Party {
    /// Bumped per party: a task of a party already left must not touch the status.
    generation: u64,
    tx: Option<mpsc::UnboundedSender<Cmd>>,
    status: PartyStatus,
    /// Recent chat / reaction sends, for the rate limit.
    sent: HashMap<&'static str, VecDeque<Instant>>,
}

static PARTY: LazyLock<Mutex<Party>> = LazyLock::new(|| {
    Mutex::new(Party {
        status: PartyStatus {
            phase: "idle".into(),
            ..PartyStatus::default()
        },
        ..Party::default()
    })
});

fn lock() -> std::sync::MutexGuard<'static, Party> {
    PARTY.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Changes the status of party `generation` (if it is still the current one) and tells
/// every window.
fn update(app: &tauri::AppHandle, generation: u64, change: impl FnOnce(&mut PartyStatus)) {
    let snapshot = {
        let mut party = lock();
        if party.generation != generation {
            return;
        }
        change(&mut party.status);
        party.status.clone()
    };
    let _ = app.emit("party://status", &snapshot);
}

fn finish(app: &tauri::AppHandle, generation: u64, error: Option<String>) {
    update(app, generation, |s| {
        s.active = false;
        s.phase = "ended".into();
        s.members.clear();
        s.host_away = false;
        s.error = error;
    });
    let mut party = lock();
    if party.generation == generation {
        party.tx = None;
    }
}

/// At most `max` sends of `kind` within `window`: chat and reactions are for people,
/// and the Realtime project has a message quota to share.
fn allow(sent: &mut HashMap<&'static str, VecDeque<Instant>>, kind: &'static str, max: usize, window: Duration) -> bool {
    let now = Instant::now();
    let list = sent.entry(kind).or_default();
    while list.front().is_some_and(|t| now.duration_since(*t) > window) {
        list.pop_front();
    }
    if list.len() >= max {
        return false;
    }
    list.push_back(now);
    true
}

// ---- the connection ----

struct Config {
    generation: u64,
    topic: String,
    self_id: String,
    host: bool,
    name: String,
    avatar: Option<String>,
}

/// What survives from one connection to the next.
#[derive(Default)]
struct Link {
    private: bool,
    attempt: u32,
    joined_once: bool,
    saw_host: bool,
    host_gone: Option<Instant>,
    /// Host: the title to hand to whoever says hello.
    title: Option<Value>,
}

enum Outcome {
    Left,
    Ended(String),
    RetryPrivate,
    Dropped,
}

type Sink = futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    Message,
>;

fn socket_url() -> String {
    let base = SUPABASE_URL.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1);
    format!("{base}/realtime/v1/websocket?apikey={SUPABASE_ANON_KEY}&vsn=1.0.0")
}

/// rustls with an explicit provider: two of them are compiled in (other crates bring
/// aws-lc), and then rustls refuses to pick one on its own.
fn tls_connector() -> Result<tokio_tungstenite::Connector, String> {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(tokio_tungstenite::Connector::Rustls(Arc::new(config)))
}

fn backoff(attempt: u32) -> Duration {
    let secs = 1u64 << attempt.saturating_sub(1).min(5);
    // Some jitter, so a whole party does not come back in the same instant.
    let jitter = u64::from(uuid::Uuid::new_v4().as_bytes()[0]) * 4;
    Duration::from_secs(secs.min(MAX_BACKOFF_SECS)) + Duration::from_millis(jitter)
}

async fn send(sink: &mut Sink, msg: PhxMessage) -> bool {
    sink.send(Message::text(msg.encode())).await.is_ok()
}

async fn fresh_token(app: &tauri::AppHandle) -> Option<String> {
    let state = app.state::<AppState>();
    state.account.access_token(app).await.ok()
}

async fn run(app: tauri::AppHandle, cfg: Config, mut rx: mpsc::UnboundedReceiver<Cmd>) {
    let mut link = Link {
        saw_host: cfg.host,
        ..Link::default()
    };
    loop {
        match connect_once(&app, &cfg, &mut rx, &mut link).await {
            Outcome::Left => {
                finish(&app, cfg.generation, None);
                return;
            }
            Outcome::Ended(code) => {
                finish(&app, cfg.generation, Some(code));
                return;
            }
            Outcome::RetryPrivate => {
                link.private = true;
            }
            Outcome::Dropped => {
                link.attempt += 1;
                if !link.joined_once && link.attempt >= FIRST_JOIN_TRIES {
                    finish(&app, cfg.generation, Some("party:offline".into()));
                    return;
                }
                update(&app, cfg.generation, |s| {
                    s.phase = "reconnecting".into();
                    s.members.clear();
                });
                let wait = tokio::time::sleep(backoff(link.attempt));
                tokio::pin!(wait);
                loop {
                    tokio::select! {
                        _ = &mut wait => break,
                        cmd = rx.recv() => match cmd {
                            None | Some(Cmd::Leave) => {
                                finish(&app, cfg.generation, None);
                                return;
                            }
                            Some(Cmd::Title(title)) => link.title = Some(title),
                            // Sync and chat are about now: nothing to queue.
                            Some(Cmd::Send { .. }) => {}
                        },
                    }
                }
            }
        }
    }
}

async fn connect_once(
    app: &tauri::AppHandle,
    cfg: &Config,
    rx: &mut mpsc::UnboundedReceiver<Cmd>,
    link: &mut Link,
) -> Outcome {
    let token = fresh_token(app).await;
    if link.private && token.is_none() {
        return Outcome::Ended("party:needs_account".into());
    }
    let connector = match tls_connector() {
        Ok(connector) => connector,
        Err(err) => return Outcome::Ended(format!("party:tls {err}")),
    };
    let config = WebSocketConfig::default().max_message_size(Some(256 * 1024));
    let connect = tokio_tungstenite::connect_async_tls_with_config(socket_url(), Some(config), true, Some(connector));
    let (mut sink, mut stream) = match tokio::time::timeout(CONNECT_TIMEOUT, connect).await {
        Ok(Ok((socket, _))) => socket.split(),
        _ => return Outcome::Dropped,
    };

    let mut refs = 0u64;
    let mut next_ref = move || {
        refs += 1;
        refs.to_string()
    };
    let join_ref = next_ref();
    let join = PhxMessage::new(&cfg.topic, "phx_join", join_payload(&cfg.self_id, link.private, token.as_deref()))
        .refs(join_ref.clone(), Some(&join_ref));
    if !send(&mut sink, join).await {
        return Outcome::Dropped;
    }

    // Wait for the join reply; anything for the channel that beats it is kept for after.
    let deadline = tokio::time::Instant::now() + JOIN_TIMEOUT;
    let mut early = Vec::new();
    loop {
        let frame = match tokio::time::timeout_at(deadline, stream.next()).await {
            Ok(Some(Ok(frame))) => frame,
            _ => return Outcome::Dropped,
        };
        let Some(msg) = frame.to_text().ok().and_then(PhxMessage::decode) else {
            continue;
        };
        if msg.topic != cfg.topic {
            continue;
        }
        let failure = match (msg.reply(), msg.event.as_str()) {
            (Some(Ok(())), _) if msg.reference.as_deref() == Some(join_ref.as_str()) => break,
            (Some(Err(reason)), _) if msg.reference.as_deref() == Some(join_ref.as_str()) => reason,
            (_, "system") if msg.payload.get("status").and_then(|v| v.as_str()) == Some("error") => msg
                .payload
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("error")
                .to_string(),
            (_, "phx_close" | "phx_error") => return Outcome::Dropped,
            _ => {
                early.push(msg);
                continue;
            }
        };
        let _ = sink.close().await;
        return match classify_join_error(&failure, link.private, token.is_some()) {
            JoinFailure::TryPrivate => Outcome::RetryPrivate,
            JoinFailure::NeedsAccount => Outcome::Ended("party:needs_account".into()),
            JoinFailure::Denied => Outcome::Ended("party:denied".into()),
            JoinFailure::Other(reason) => {
                eprintln!("party: join refused: {reason}");
                // A code nobody else can reach is worth a retry only once it was live.
                if link.joined_once {
                    Outcome::Dropped
                } else {
                    Outcome::Ended("party:join_failed".into())
                }
            }
        };
    }

    link.attempt = 0;
    link.joined_once = true;
    let joined_at = Instant::now();
    let mut presence = Presence::default();
    update(app, cfg.generation, |s| {
        s.phase = "live".into();
        s.private = link.private;
        s.error = None;
    });

    let meta = json!({ "name": cfg.name, "avatar": cfg.avatar, "host": cfg.host });
    let track = PhxMessage::new(&cfg.topic, "presence", track_payload(&meta)).refs(next_ref(), Some(&join_ref));
    if !send(&mut sink, track).await {
        return Outcome::Dropped;
    }
    // The host (re)announces what is on; a guest asks for it.
    let hello = if cfg.host {
        link.title.as_ref().map(|title| ("title", title.clone()))
    } else {
        Some(("hello", Value::Null))
    };
    if let Some((event, data)) = hello {
        let msg = PhxMessage::new(&cfg.topic, "broadcast", broadcast_payload(event, &cfg.self_id, &data))
            .refs(next_ref(), Some(&join_ref));
        if !send(&mut sink, msg).await {
            return Outcome::Dropped;
        }
    }

    let mut heartbeat = tokio::time::interval(HEARTBEAT);
    heartbeat.tick().await;
    let mut pending_beat: Option<String> = None;
    let mut refresh = tokio::time::interval(TOKEN_REFRESH);
    refresh.tick().await;
    let mut check = tokio::time::interval(Duration::from_secs(1));
    let mut queue: VecDeque<PhxMessage> = early.into();

    loop {
        // Messages that came in with the join reply go first.
        let incoming = if let Some(msg) = queue.pop_front() {
            Some(msg)
        } else {
            tokio::select! {
                _ = heartbeat.tick() => {
                    if pending_beat.is_some() {
                        // The last one never came back: the socket is dead without knowing it.
                        return Outcome::Dropped;
                    }
                    let reference = next_ref();
                    pending_beat = Some(reference.clone());
                    if !send(&mut sink, PhxMessage::new("phoenix", "heartbeat", json!({})).refs(reference, None)).await {
                        return Outcome::Dropped;
                    }
                    None
                }
                _ = refresh.tick(), if token.is_some() => {
                    if let Some(token) = fresh_token(app).await {
                        let msg = PhxMessage::new(&cfg.topic, "access_token", json!({ "access_token": token }))
                            .refs(next_ref(), Some(&join_ref));
                        if !send(&mut sink, msg).await {
                            return Outcome::Dropped;
                        }
                    }
                    None
                }
                _ = check.tick(), if !cfg.host => {
                    if let Some(outcome) = check_host(app, cfg, link, &presence, joined_at) {
                        let _ = sink.close().await;
                        return outcome;
                    }
                    None
                }
                cmd = rx.recv() => {
                    let (event, data) = match cmd {
                        None | Some(Cmd::Leave) => {
                            if cfg.host {
                                let end = PhxMessage::new(&cfg.topic, "broadcast", broadcast_payload("end", &cfg.self_id, &Value::Null))
                                    .refs(next_ref(), Some(&join_ref));
                                let _ = send(&mut sink, end).await;
                            }
                            let leave = PhxMessage::new(&cfg.topic, "phx_leave", json!({})).refs(next_ref(), Some(&join_ref));
                            let _ = send(&mut sink, leave).await;
                            let _ = sink.close().await;
                            return Outcome::Left;
                        }
                        Some(Cmd::Title(title)) => {
                            link.title = Some(title.clone());
                            ("title".to_string(), title)
                        }
                        Some(Cmd::Send { event, data }) => (event, data),
                    };
                    let msg = PhxMessage::new(&cfg.topic, "broadcast", broadcast_payload(&event, &cfg.self_id, &data))
                        .refs(next_ref(), Some(&join_ref));
                    if !send(&mut sink, msg).await {
                        return Outcome::Dropped;
                    }
                    None
                }
                frame = stream.next() => match frame {
                    Some(Ok(Message::Text(text))) => PhxMessage::decode(text.as_str()),
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return Outcome::Dropped,
                    Some(Ok(_)) => None,
                },
            }
        };
        let Some(msg) = incoming else {
            continue;
        };
        if msg.topic == "phoenix" {
            if msg.event == "phx_reply" && msg.reference.is_some() && msg.reference == pending_beat {
                pending_beat = None;
            }
            continue;
        }
        if msg.topic != cfg.topic {
            continue;
        }
        match msg.event.as_str() {
            "presence_state" | "presence_diff" => {
                if msg.event == "presence_state" {
                    presence.sync(&msg.payload);
                } else {
                    presence.diff(&msg.payload);
                }
                let members = presence.list();
                update(app, cfg.generation, |s| s.members = members);
            }
            "broadcast" => {
                let Some((event, from, data)) = broadcast_of(&msg.payload) else {
                    continue;
                };
                if from == cfg.self_id {
                    continue;
                }
                // Until presence has named the host, a guest takes the host's word from
                // whoever speaks as one; after that only the host's messages count.
                let from_host = match presence.host_id() {
                    Some(host) => host == from,
                    None => !cfg.host,
                };
                match event.as_str() {
                    "hello" if cfg.host => {
                        if let Some(title) = link.title.clone() {
                            let msg = PhxMessage::new(&cfg.topic, "broadcast", broadcast_payload("title", &cfg.self_id, &title))
                                .refs(next_ref(), Some(&join_ref));
                            if !send(&mut sink, msg).await {
                                return Outcome::Dropped;
                            }
                        }
                    }
                    "title" if !cfg.host && from_host => {
                        update(app, cfg.generation, |s| s.title = Some(data));
                    }
                    "end" if !cfg.host && from_host => {
                        let _ = sink.close().await;
                        return Outcome::Ended("party:host_ended".into());
                    }
                    e if APP_EVENTS.contains(&e) => {
                        let _ = app.emit(
                            "party://message",
                            json!({ "event": event, "from": from, "fromHost": from_host, "data": data }),
                        );
                    }
                    _ => {}
                }
            }
            "phx_close" | "phx_error" => return Outcome::Dropped,
            "system" => {
                let failed = msg.payload.get("status").and_then(|v| v.as_str()) == Some("error");
                let text = msg.payload.get("message").and_then(|v| v.as_str()).unwrap_or("");
                if failed {
                    eprintln!("party: realtime says: {text}");
                    // An expired token closes the channel; the next join brings a fresh one.
                    if text.to_ascii_lowercase().contains("token") {
                        let _ = sink.close().await;
                        return Outcome::Dropped;
                    }
                }
            }
            _ => {}
        }
    }
}

/// Guests: a code nobody hosts, or a host gone for too long, ends the party.
fn check_host(app: &tauri::AppHandle, cfg: &Config, link: &mut Link, presence: &Presence, joined_at: Instant) -> Option<Outcome> {
    if presence.host_id().is_some() {
        link.saw_host = true;
        if link.host_gone.take().is_some() {
            update(app, cfg.generation, |s| s.host_away = false);
        }
        return None;
    }
    if joined_at.elapsed() < PRESENCE_SETTLE {
        return None;
    }
    if !link.saw_host {
        return (joined_at.elapsed() > HOST_WAIT).then(|| Outcome::Ended("party:not_found".into()));
    }
    let since = *link.host_gone.get_or_insert_with(|| {
        update(app, cfg.generation, |s| s.host_away = true);
        Instant::now()
    });
    (since.elapsed() > HOST_GRACE).then(|| Outcome::Ended("party:host_left".into()))
}

fn begin(app: tauri::AppHandle, code: String, host: bool, name: String, avatar: Option<String>) -> PartyStatus {
    let self_id = uuid::Uuid::new_v4().simple().to_string();
    let (tx, rx) = mpsc::unbounded_channel();
    let (generation, snapshot) = {
        let mut party = lock();
        // One party at a time: joining another leaves (or ends) the current one.
        if let Some(old) = party.tx.take() {
            let _ = old.send(Cmd::Leave);
        }
        party.generation += 1;
        party.tx = Some(tx);
        party.sent.clear();
        party.status = PartyStatus {
            active: true,
            phase: "connecting".into(),
            code: format_code(&code),
            host,
            self_id: self_id.clone(),
            ..PartyStatus::default()
        };
        (party.generation, party.status.clone())
    };
    let _ = app.emit("party://status", &snapshot);
    let name: String = name.trim().chars().take(40).collect();
    let cfg = Config {
        generation,
        topic: topic_of(&code),
        self_id,
        host,
        name,
        avatar: avatar.filter(|a| a.starts_with("preset:") && a.len() <= 12),
    };
    tauri::async_runtime::spawn(run(app, cfg, rx));
    snapshot
}

// ---- commands ----

#[tauri::command]
pub fn party_start(app: tauri::AppHandle, name: String, avatar: Option<String>) -> PartyStatus {
    begin(app, random_code(), true, name, avatar)
}

#[tauri::command]
pub fn party_join(app: tauri::AppHandle, code: String, name: String, avatar: Option<String>) -> Result<PartyStatus, String> {
    let code = normalize_code(&code).ok_or_else(|| "party:bad_code".to_string())?;
    Ok(begin(app, code, false, name, avatar))
}

#[tauri::command]
pub fn party_leave(app: tauri::AppHandle) {
    let snapshot = {
        let mut party = lock();
        if let Some(tx) = party.tx.take() {
            let _ = tx.send(Cmd::Leave);
        }
        // The task still says goodbye on the socket, but no longer speaks for the status.
        party.generation += 1;
        party.status = PartyStatus {
            phase: "idle".into(),
            ..PartyStatus::default()
        };
        party.status.clone()
    };
    let _ = app.emit("party://status", &snapshot);
}

#[tauri::command]
pub fn party_status() -> PartyStatus {
    lock().status.clone()
}

#[tauri::command]
pub fn party_send(event: String, data: Value) -> Result<(), String> {
    let Some(kind) = APP_EVENTS.iter().copied().find(|e| *e == event) else {
        return Err("party:bad_event".into());
    };
    if data.to_string().len() > MAX_DATA_BYTES {
        return Err("party:too_big".into());
    }
    let mut party = lock();
    let limited = match kind {
        "chat" => !allow(&mut party.sent, kind, 5, Duration::from_secs(10)),
        "react" => !allow(&mut party.sent, kind, 8, Duration::from_secs(5)),
        _ => false,
    };
    if limited {
        return Err("party:rate_limited".into());
    }
    let tx = party.tx.as_ref().ok_or_else(|| "party:not_active".to_string())?;
    tx.send(Cmd::Send { event, data }).map_err(|_| "party:not_active".to_string())
}

/// Host: what is playing now, for the guests to open on their side.
#[tauri::command]
pub fn party_set_title(app: tauri::AppHandle, title: Value) -> Result<(), String> {
    if title.to_string().len() > MAX_DATA_BYTES {
        return Err("party:too_big".into());
    }
    let generation = {
        let party = lock();
        if !party.status.host {
            return Err("party:not_host".into());
        }
        let tx = party.tx.as_ref().ok_or_else(|| "party:not_active".to_string())?;
        tx.send(Cmd::Title(title.clone())).map_err(|_| "party:not_active".to_string())?;
        party.generation
    };
    update(&app, generation, |s| s.title = Some(title));
    Ok(())
}

/// Host: let the guests pause, play and seek too.
#[tauri::command]
pub fn party_set_open(app: tauri::AppHandle, open: bool) -> Result<(), String> {
    let generation = {
        let party = lock();
        if !party.status.active || !party.status.host {
            return Err("party:not_host".into());
        }
        party.generation
    };
    update(&app, generation, |s| s.open = open);
    Ok(())
}

/// Guests follow the host's pause state with this rather than a toggle.
#[tauri::command]
pub async fn party_player_pause(state: State<'_, AppState>, paused: bool) -> Result<(), String> {
    state.player.set_pause(paused).await
}

/// The host's title in this person's own Jellyfin library, matched by IMDb / TMDb /
/// TVDb id (and season / episode number for an episode). `None` when there is no
/// server or the library does not have it.
#[tauri::command]
pub async fn party_find_library_item(
    state: State<'_, AppState>,
    kind: String,
    ids: BTreeMap<String, String>,
    season: Option<i32>,
    episode: Option<i32>,
) -> Result<Option<Movie>, String> {
    if state.jellyfin.require_session().await.is_err() {
        return Ok(None);
    }
    let wanted: Vec<(String, String)> = ids
        .into_iter()
        .map(|(k, v)| (k.to_ascii_lowercase(), v.trim().to_string()))
        .filter(|(k, v)| ["imdb", "tmdb", "tvdb"].contains(&k.as_str()) && !v.is_empty())
        .collect();
    if wanted.is_empty() {
        return Ok(None);
    }
    let item_kind = if kind == "series" { "Series" } else { "Movie" };
    let index = state.jellyfin.provider_index().await?;
    let found = index.into_iter().find(|item| {
        item.kind == item_kind
            && item.provider_ids.iter().any(|(k, v)| {
                let k = k.to_ascii_lowercase();
                wanted.iter().any(|(wk, wv)| *wk == k && wv == v)
            })
    });
    let Some(item) = found else {
        return Ok(None);
    };
    if item_kind == "Movie" {
        return state.jellyfin.get_item(&item.id).await.map(Some);
    }
    let (Some(season), Some(episode)) = (season, episode) else {
        return Ok(None);
    };
    let episodes = state.jellyfin.episode_index(&item.id).await?;
    match episodes.into_iter().find(|(_, s, e, _)| *s == season && *e == episode) {
        Some((id, ..)) => state.jellyfin.get_item(&id).await.map(Some),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_unambiguous_and_round_trip() {
        for _ in 0..50 {
            let code = random_code();
            assert_eq!(code.len(), CODE_LEN);
            assert!(code.bytes().all(|b| ALPHABET.contains(&b)));
            let shown = format_code(&code);
            assert_eq!(shown.len(), CODE_LEN + 2);
            assert_eq!(normalize_code(&shown).as_deref(), Some(code.as_str()));
        }
        assert_eq!(normalize_code(" abcd-efgh jkmn "), Some("ABCDEFGHJKMN".into()));
        // O, I, L, 0 and 1 are never part of a code.
        assert_eq!(normalize_code("ABCD-EFGH-JKMO"), None);
        assert_eq!(normalize_code("ABCD-EFGH-JK10"), None);
        assert_eq!(normalize_code("ABCD-EFGH"), None);
        assert_eq!(topic_of("ABCDEFGHJKMN"), "realtime:ejflix-party-abcdefghjkmn");
    }

    #[test]
    fn encodes_and_decodes_phoenix_messages() {
        let join = PhxMessage::new("realtime:room", "phx_join", join_payload("me", false, Some("jwt")))
            .refs("1".into(), Some("1"));
        let text = join.encode();
        let value: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["ref"], "1");
        assert_eq!(value["join_ref"], "1");
        assert_eq!(value["payload"]["config"]["presence"]["key"], "me");
        assert_eq!(value["payload"]["config"]["broadcast"]["self"], false);
        assert_eq!(value["payload"]["config"]["private"], false);
        assert_eq!(value["payload"]["access_token"], "jwt");
        assert_eq!(PhxMessage::decode(&text), Some(join));

        let anonymous = join_payload("me", true, None);
        assert!(anonymous.get("access_token").is_none());
        assert_eq!(anonymous["config"]["private"], true);

        let beat = PhxMessage::new("phoenix", "heartbeat", json!({})).refs("7".into(), None);
        let value: Value = serde_json::from_str(&beat.encode()).unwrap();
        assert_eq!(value["join_ref"], Value::Null);
        assert_eq!(PhxMessage::decode("not json"), None);
        // A server push without refs still decodes.
        let push = PhxMessage::decode(r#"{"topic":"realtime:room","event":"presence_diff","payload":{}}"#).unwrap();
        assert_eq!(push.reference, None);
    }

    #[test]
    fn reads_replies_and_broadcasts() {
        let ok = PhxMessage::decode(r#"{"topic":"t","event":"phx_reply","payload":{"status":"ok","response":{}},"ref":"1"}"#).unwrap();
        assert_eq!(ok.reply(), Some(Ok(())));
        let err = PhxMessage::decode(
            r#"{"topic":"t","event":"phx_reply","payload":{"status":"error","response":{"reason":"PrivateOnly: This project only allows private channels"}},"ref":"1"}"#,
        )
        .unwrap();
        assert_eq!(err.reply(), Some(Err("PrivateOnly: This project only allows private channels".into())));
        assert_eq!(PhxMessage::new("t", "broadcast", json!({})).reply(), None);

        let sent = broadcast_payload("chat", "abc", &json!({ "text": "hola" }));
        let (event, from, data) = broadcast_of(&sent).unwrap();
        assert_eq!((event.as_str(), from.as_str()), ("chat", "abc"));
        assert_eq!(data["text"], "hola");
        assert_eq!(broadcast_of(&json!({ "event": "chat", "payload": {} })), None);
        assert_eq!(track_payload(&json!({ "name": "Ana" }))["event"], "track");
    }

    #[test]
    fn classifies_join_errors() {
        let private_only = "PrivateOnly: This project only allows private channels";
        assert_eq!(classify_join_error(private_only, false, true), JoinFailure::TryPrivate);
        assert_eq!(classify_join_error(private_only, false, false), JoinFailure::NeedsAccount);
        let unauthorized = "Unauthorized: You do not have permissions to read from this Channel topic: x";
        assert_eq!(classify_join_error(unauthorized, true, true), JoinFailure::Denied);
        assert_eq!(classify_join_error(unauthorized, false, false), JoinFailure::NeedsAccount);
        assert!(matches!(classify_join_error("TenantNotFound", false, true), JoinFailure::Other(_)));
    }

    #[test]
    fn follows_presence() {
        let mut presence = Presence::default();
        presence.sync(&json!({
            "h": { "metas": [{ "phx_ref": "a", "name": "Host", "host": true, "avatar": "preset:3" }] },
            "g": { "metas": [{ "phx_ref": "b", "name": "Guest", "avatar": "http://jfimg.localhost/x" }] },
        }));
        assert_eq!(presence.host_id(), Some("h"));
        let list = presence.list();
        assert_eq!(list[0].name, "Host");
        assert_eq!(list[0].avatar.as_deref(), Some("preset:3"));
        // Picture URLs do not travel.
        assert_eq!(list[1].avatar, None);

        // The guest reconnects: the new connection joins before the old one leaves.
        presence.diff(&json!({ "joins": { "g": { "metas": [{ "phx_ref": "c", "name": "Guest" }] } }, "leaves": {} }));
        presence.diff(&json!({ "joins": {}, "leaves": { "g": { "metas": [{ "phx_ref": "b" }] } } }));
        assert_eq!(presence.list().len(), 2);
        presence.diff(&json!({ "joins": {}, "leaves": { "h": { "metas": [{ "phx_ref": "a" }] } } }));
        assert_eq!(presence.host_id(), None);
        assert_eq!(presence.list().len(), 1);
    }

    #[test]
    fn rate_limits_sends() {
        let mut sent = HashMap::new();
        for _ in 0..3 {
            assert!(allow(&mut sent, "chat", 3, Duration::from_secs(10)));
        }
        assert!(!allow(&mut sent, "chat", 3, Duration::from_secs(10)));
        assert!(allow(&mut sent, "react", 3, Duration::from_secs(10)));
    }
}
