//! Discord Rich Presence over Discord's local IPC pipe (`\\.\pipe\discord-ipc-N`), with
//! no SDK: a handshake frame, then `SET_ACTIVITY` commands. A background task owns the
//! connection; the rest of the app only describes the desired activity and the task
//! reconciles it (reconnecting with a backoff when Discord is not running). The pipe
//! opens as soon as presence is on and stays open between titles, because Discord can
//! take most of a minute to accept the handshake.

use std::sync::{Arc, OnceLock};
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
/// Discord answers the handshake of some applications only after 50-60 s (ejFlix's own
/// among them; others answer at once), so it gets far longer than a command.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_FRAME: usize = 64 * 1024;
/// Discord requires 2..=128 characters for `details` / `state`.
const MAX_TEXT: usize = 128;
/// Longest `large_image` Discord accepts; a longer one makes it reject the whole activity.
const MAX_IMAGE: usize = 256;
/// The ejFlix "j", fetched by Discord itself: the small badge over a poster, or the
/// picture when there is no poster to show.
pub const LOGO_URL: &str = "https://raw.githubusercontent.com/ej3mpl0/ejflix/main/src-tauri/icons/Square284x284Logo.png";

/// Whether Discord will take this image URL (it refuses the activity otherwise).
pub fn image_fits(url: &str) -> bool {
    url.len() <= MAX_IMAGE
}

/// What is playing, as far as the presence cares (filled by the play commands).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PresenceInfo {
    /// Movie title or series name.
    pub title: String,
    /// Live TV: the programme on air. Episodes use the fields below instead, so the line
    /// is written in the app's language when it is shown.
    pub episode: Option<String>,
    pub season: Option<i32>,
    pub episode_number: Option<i32>,
    pub episode_title: Option<String>,
    /// Episodes in that season, for Discord's own "(3 of 12)" after the state line.
    pub episode_count: Option<u32>,
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

impl PresenceInfo {
    /// "T1 E3 · Episode title" ("S1 E3" in English), the way Crunchyroll writes it; the
    /// programme for live TV.
    pub fn episode_line(&self, locale: &str) -> Option<String> {
        let season = if locale == "en" { "S" } else { "T" };
        let (code, number) = match (self.season, self.episode_number) {
            (Some(s), Some(e)) => (format!("{season}{s} E{e}"), e),
            (None, Some(e)) => (format!("E{e}"), e),
            _ => return self.episode.clone().filter(|line| !line.trim().is_empty()),
        };
        let title = self
            .episode_title
            .as_deref()
            .map(str::trim)
            .filter(|title| title.chars().count() > 1 && !generic_title(title, self.season, number));
        Some(match title {
            Some(title) => format!("{code} · {title}"),
            None => code,
        })
    }

    /// (episode, episodes in the season) when both are known and make sense.
    pub fn party_size(&self) -> Option<(u32, u32)> {
        let current = u32::try_from(self.episode_number?).ok()?;
        let max = self.episode_count?;
        (current >= 1 && current <= max).then_some((current, max))
    }
}

/// A title that only repeats the number ("Episode 3", "E03", "S01E03"): the code already says it.
fn generic_title(title: &str, season: Option<i32>, episode: i32) -> bool {
    let flat: String = title.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect();
    let word = flat.trim_end_matches(|c: char| c.is_ascii_digit());
    let same_number = flat[word.len()..].parse::<i32>().ok() == Some(episode);
    if same_number && ["", "e", "ep", "episode", "episodio", "capitulo", "capítulo", "chapter"].contains(&word) {
        return true;
    }
    let Some(season) = season else { return false };
    let mut codes = Vec::new();
    for letter in ["s", "t"] {
        codes.push(format!("{letter}{season}e{episode}"));
        codes.push(format!("{letter}{season:02}e{episode:02}"));
    }
    codes.contains(&flat)
}

/// Activity as sent to Discord.
#[derive(Debug, Clone)]
pub struct Activity {
    /// Shown as "Watching {name}". Discord drops the activity when this is missing.
    pub name: String,
    pub details: Option<String>,
    pub state: Option<String>,
    /// (start, end) unix seconds.
    pub timestamps: Option<(u64, Option<u64>)>,
    pub large_image: Option<String>,
    pub large_text: String,
    /// Badge in the corner of the large image (only sent next to one).
    pub small_image: Option<String>,
    pub small_text: String,
    /// Discord `status_display_type`: 0 = application name, 1 = state, 2 = details.
    pub status_display: u8,
    /// (current, max): Discord prints "(current of max)" after the state line.
    pub party: Option<(u32, u32)>,
}

/// Which optional fields this Discord client accepted. A rejected image or an
/// unknown `status_display_type` makes Discord throw away the whole activity,
/// so the pipe remembers the shape that actually stuck.
#[derive(Clone, Copy)]
struct Shape {
    small: bool,
    party: bool,
    assets: bool,
    status_display: bool,
    watching: bool,
}

impl Shape {
    fn full() -> Self {
        Self { small: true, party: true, assets: true, status_display: true, watching: true }
    }
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
        ts && self.name == other.name
            && self.details == other.details
            && self.state == other.state
            && self.large_image == other.large_image
            && self.large_text == other.large_text
            && self.small_image == other.small_image
            && self.small_text == other.small_text
            && self.status_display == other.status_display
            && self.party == other.party
    }

    /// `SET_ACTIVITY` body. Assets are omitted unless the image itself is usable:
    /// a hover text with no picture, or an empty hover text, is enough for Discord
    /// to refuse the activity and show nothing.
    fn command(&self, shape: Shape) -> Value {
        let mut activity = json!({
            "type": if shape.watching { 3 } else { 0 },
            "name": activity_name(&self.name),
            "instance": false,
        });
        if shape.status_display {
            let display = match self.status_display {
                1 if self.state.is_some() => 1,
                2 if self.details.is_some() => 2,
                _ => 0,
            };
            activity["status_display_type"] = json!(display);
        }
        if let Some(details) = &self.details {
            activity["details"] = Value::String(details.clone());
        }
        if let Some(state) = &self.state {
            activity["state"] = Value::String(state.clone());
        }
        if let Some((start, end)) = self.timestamps {
            let end_ok = match end {
                Some(end) => end > start,
                None => true,
            };
            if start > 0 && end_ok {
                let mut ts = json!({ "start": start });
                if let Some(end) = end {
                    ts["end"] = json!(end);
                }
                activity["timestamps"] = ts;
            }
        }
        if shape.assets {
            if let Some(image) = usable_image(self.large_image.as_deref()) {
                let mut assets = json!({ "large_image": image });
                if let Some(text) = clamp_text(self.large_text.clone()) {
                    assets["large_text"] = Value::String(text);
                }
                if let Some(small) = usable_image(self.small_image.as_deref()).filter(|_| shape.small) {
                    assets["small_image"] = json!(small);
                    if let Some(text) = clamp_text(self.small_text.clone()) {
                        assets["small_text"] = Value::String(text);
                    }
                }
                activity["assets"] = assets;
            }
        }
        if let Some((current, max)) = self.party.filter(|&(current, max)| shape.party && current >= 1 && current <= max) {
            activity["party"] = json!({ "id": party_id(), "size": [current, max] });
        }
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
    /// Presence switched on: the pipe is opened ahead of time and kept open.
    enabled: RwLock<bool>,
    desired: RwLock<Option<Activity>>,
    client_id: RwLock<String>,
    notify: Notify,
    status: Mutex<Status>,
}

impl Discord {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            enabled: RwLock::new(false),
            desired: RwLock::new(None),
            client_id: RwLock::new(DEFAULT_CLIENT_ID.to_string()),
            notify: Notify::new(),
            status: Mutex::new(Status::default()),
        })
    }

    /// Describe what Discord should show: `enabled` keeps the pipe open (connecting before
    /// anything plays), `activity` is what to show (`None` clears it). Cheap to call often.
    pub async fn set(&self, client_id: &str, enabled: bool, activity: Option<Activity>) {
        let client_id = if client_id.trim().is_empty() {
            DEFAULT_CLIENT_ID.to_string()
        } else {
            client_id.trim().to_string()
        };
        let activity = activity.filter(|_| enabled);
        let changed = {
            let mut on = self.enabled.write().await;
            let mut current = self.desired.write().await;
            let mut id = self.client_id.write().await;
            let same = match (&*current, &activity) {
                (None, None) => true,
                (Some(a), Some(b)) => a.same_as(b),
                _ => false,
            };
            let changed = !same || *id != client_id || *on != enabled;
            if changed {
                *on = enabled;
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
            let mut shape = Shape::full();
            let mut retry_after: Option<Instant> = None;
            loop {
                tokio::select! {
                    _ = me.notify.notified() => {}
                    _ = tokio::time::sleep(TICK) => {}
                }
                let enabled = *me.enabled.read().await;
                let desired = me.desired.read().await.clone();
                let client_id = me.client_id.read().await.clone();
                if !enabled {
                    // Switched off: closing the pipe takes the presence away.
                    conn = None;
                    sent = None;
                    retry_after = None;
                    me.set_status(false, None).await;
                    continue;
                }
                if conn.is_some() && connected_id != client_id {
                    conn = None;
                    sent = None;
                    shape = Shape::full();
                }
                if conn.is_none() {
                    if retry_after.is_some_and(|at| at > Instant::now()) {
                        continue;
                    }
                    me.set_status(false, None).await;
                    match connect(&client_id).await {
                        Ok(client) => {
                            conn = Some(client);
                            connected_id = client_id.clone();
                            retry_after = None;
                            me.set_status(true, None).await;
                            // The handshake may have taken a minute: act on what is wanted now.
                            me.notify.notify_one();
                        }
                        Err(err) => {
                            retry_after = Some(Instant::now() + RETRY);
                            me.set_status(false, Some(err)).await;
                        }
                    }
                    continue;
                }
                let Some(desired) = desired else {
                    // Nothing playing: clear what is shown and keep the pipe for the next title.
                    if sent.is_some() {
                        let Some(client) = conn.as_mut() else { continue };
                        sent = None;
                        if let Err(err) = clear_activity(client).await {
                            conn = None;
                            shape = Shape::full();
                            retry_after = Some(Instant::now() + Duration::from_secs(5));
                            me.set_status(false, Some(err)).await;
                        }
                    }
                    continue;
                };
                if sent.as_ref().is_some_and(|s| s.same_as(&desired)) {
                    continue;
                }
                // A new poster gets one more try, and so do the badge and the episode counter
                // that a rejection may have dropped along with it. The same rejected picture is
                // not sent again on every progress tick, or Discord would clear the presence each time.
                let image_changed = sent.as_ref().map(|prev| prev.large_image != desired.large_image).unwrap_or(true);
                if image_changed {
                    shape.small = true;
                    shape.party = true;
                    shape.assets = true;
                }
                let Some(client) = conn.as_mut() else { continue };
                match push_activity(client, &desired, shape).await {
                    Ok(used) => {
                        sent = Some(desired);
                        shape = used;
                        me.set_status(true, None).await;
                    }
                    Err(err) => {
                        conn = None;
                        sent = None;
                        shape = Shape::full();
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
    let (op, value) = read_frame(client, HANDSHAKE_TIMEOUT).await?;
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

enum SendFail {
    /// The pipe broke or Discord never answered. Reconnecting is the only recovery.
    Io(String),
    /// Discord parsed the frame and refused the activity. A smaller payload may pass.
    Rejected(String),
}

/// Sends the activity, dropping fields Discord refused until one shape is accepted.
async fn push_activity(client: &mut NamedPipeClient, activity: &Activity, mut shape: Shape) -> Result<Shape, String> {
    let mut previous = String::new();
    let mut last_error = "Discord rechazó la actividad".to_string();
    loop {
        let payload = activity.command(shape);
        let encoded = payload.to_string();
        if encoded == previous {
            if !degrade(&mut shape) {
                return Err(last_error);
            }
            continue;
        }
        previous = encoded;
        match send_payload(client, &payload).await {
            Ok(()) => return Ok(shape),
            Err(SendFail::Io(err)) => return Err(err),
            Err(SendFail::Rejected(err)) => {
                last_error = err;
                if !degrade(&mut shape) {
                    return Err(last_error);
                }
            }
        }
    }
}

fn degrade(shape: &mut Shape) -> bool {
    if shape.small {
        shape.small = false;
        return true;
    }
    if shape.party {
        shape.party = false;
        return true;
    }
    if shape.assets {
        shape.assets = false;
        return true;
    }
    if shape.status_display {
        shape.status_display = false;
        return true;
    }
    if shape.watching {
        shape.watching = false;
        return true;
    }
    false
}

/// `SET_ACTIVITY` with no activity: Discord stops showing one, the pipe stays usable.
async fn clear_activity(client: &mut NamedPipeClient) -> Result<(), String> {
    let payload = json!({
        "cmd": "SET_ACTIVITY",
        "args": { "pid": std::process::id() },
        "nonce": format!("{}", now_secs()),
    });
    match send_payload(client, &payload).await {
        Ok(()) | Err(SendFail::Rejected(_)) => Ok(()),
        Err(SendFail::Io(err)) => Err(err),
    }
}

async fn send_payload(client: &mut NamedPipeClient, payload: &Value) -> Result<(), SendFail> {
    write_frame(client, 1, payload).await.map_err(SendFail::Io)?;
    // Discord answers every command; draining the reply keeps the pipe healthy.
    let (_, value) = read_frame(client, IO_TIMEOUT).await.map_err(SendFail::Io)?;
    if value.get("evt").and_then(|v| v.as_str()) == Some("ERROR") {
        let message = value
            .pointer("/data/message")
            .and_then(|v| v.as_str())
            .unwrap_or("Discord rechazó la actividad");
        let message = match value.pointer("/data/code").and_then(|code| code.as_i64()) {
            Some(code) => format!("{message} ({code})"),
            None => message.to_string(),
        };
        return Err(SendFail::Rejected(message));
    }
    Ok(())
}

/// 1–128 characters. Watching is rendered as "Watching {name}"; without it Discord shows nothing.
fn activity_name(text: &str) -> String {
    let text: String = text.chars().filter(|c| !c.is_control()).take(MAX_TEXT).collect();
    let text = text.trim();
    if text.chars().count() < 2 {
        "ejFlix".to_string()
    } else {
        text.to_string()
    }
}

/// One id per run of the app: a shared id would put every ejFlix viewer in one "party".
fn party_id() -> &'static str {
    static ID: OnceLock<String> = OnceLock::new();
    ID.get_or_init(|| format!("ejflix-{}-{}", std::process::id(), now_secs()))
}

fn usable_image(url: Option<&str>) -> Option<&str> {
    let url = url?.trim();
    if url.starts_with("https://") && image_fits(url) && !url.contains(' ') {
        Some(url)
    } else {
        None
    }
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

async fn read_frame(client: &mut NamedPipeClient, timeout: Duration) -> Result<(u32, Value), String> {
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
    let (op, body) = tokio::time::timeout(timeout, read)
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
        .replace("{episode}", info.episode_line(locale).as_deref().unwrap_or(""))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Activity {
        Activity {
            name: "The Matrix".to_string(),
            details: Some("The Matrix".to_string()),
            state: None,
            timestamps: Some((1_700_000_000, Some(1_700_003_600))),
            large_image: None,
            large_text: "The Matrix".to_string(),
            small_image: None,
            small_text: "ejFlix".to_string(),
            status_display: 2,
            party: None,
        }
    }

    fn activity_of(value: &Value) -> &Value {
        value.pointer("/args/activity").unwrap()
    }

    #[test]
    fn a_title_without_a_poster_still_names_the_activity() {
        let value = sample().command(Shape::full());
        let activity = activity_of(&value);
        assert_eq!(activity["type"], json!(3));
        assert_eq!(activity["name"], json!("The Matrix"));
        assert_eq!(activity["details"], json!("The Matrix"));
        assert_eq!(activity["status_display_type"], json!(2));
        assert!(activity.get("assets").is_none());
        assert!(activity.get("state").is_none());
    }

    #[test]
    fn hover_text_is_sent_only_next_to_a_real_image() {
        let mut activity = sample();
        activity.large_image = Some("https://images.metahub.space/poster/medium/tt0133093/img".to_string());
        let with_image = activity.command(Shape::full());
        let with_image = activity_of(&with_image);
        assert_eq!(
            with_image["assets"]["large_image"],
            json!("https://images.metahub.space/poster/medium/tt0133093/img")
        );
        assert_eq!(with_image["assets"]["large_text"], json!("The Matrix"));

        activity.large_text = "x".to_string();
        let short = activity.command(Shape::full());
        let short = activity_of(&short);
        assert!(short["assets"].get("large_text").is_none());

        activity.large_image = Some(format!("https://example.com/{}", "a".repeat(300)));
        let long = activity.command(Shape::full());
        assert!(activity_of(&long).get("assets").is_none());

        activity.large_image = Some("http://192.168.1.20/poster.jpg".to_string());
        let local = activity.command(Shape::full());
        assert!(activity_of(&local).get("assets").is_none());
    }

    #[test]
    fn a_picky_client_can_drop_the_fields_that_get_the_activity_rejected() {
        let activity = sample();
        let bare = activity.command(Shape { small: false, party: false, assets: false, status_display: false, watching: true });
        let bare = activity_of(&bare);
        assert_eq!(bare["type"], json!(3));
        assert_eq!(bare["name"], json!("The Matrix"));
        assert!(bare.get("status_display_type").is_none());
        assert!(bare.get("assets").is_none());

        let playing = activity.command(Shape { small: false, party: false, assets: false, status_display: false, watching: false });
        let playing = activity_of(&playing);
        assert_eq!(playing["type"], json!(0));
        assert_eq!(playing["name"], json!("The Matrix"));
    }

    #[test]
    fn an_empty_name_still_leaves_something_discord_can_show() {
        let mut activity = sample();
        activity.name = "  ".to_string();
        activity.details = None;
        activity.status_display = 2;
        let value = activity.command(Shape::full());
        let value = activity_of(&value);
        assert_eq!(value["name"], json!("ejFlix"));
        assert_eq!(value["status_display_type"], json!(0));
    }

    #[test]
    fn the_logo_rides_on_the_poster_and_never_alone() {
        let mut activity = sample();
        activity.small_image = Some(LOGO_URL.to_string());
        let alone = activity.command(Shape::full());
        assert!(activity_of(&alone).get("assets").is_none());

        activity.large_image = Some("https://images.metahub.space/poster/medium/tt0133093/img".to_string());
        let both = activity.command(Shape::full());
        let assets = &activity_of(&both)["assets"];
        assert_eq!(assets["small_image"], json!(LOGO_URL));
        assert_eq!(assets["small_text"], json!("ejFlix"));

        let mut shape = Shape::full();
        assert!(degrade(&mut shape));
        let poster_only = activity.command(shape);
        let assets = &activity_of(&poster_only)["assets"];
        assert!(assets.get("small_image").is_none());
        assert!(assets.get("large_image").is_some());
    }

    #[test]
    fn the_episode_counter_needs_a_sensible_size() {
        let mut activity = sample();
        activity.party = Some((3, 12));
        let value = activity.command(Shape::full());
        assert_eq!(activity_of(&value)["party"]["size"], json!([3, 12]));
        assert!(activity_of(&value)["party"]["id"].as_str().is_some_and(|id| id.starts_with("ejflix-")));

        activity.party = Some((13, 12));
        assert!(activity_of(&activity.command(Shape::full())).get("party").is_none());
        activity.party = Some((0, 12));
        assert!(activity_of(&activity.command(Shape::full())).get("party").is_none());
    }

    #[test]
    fn episode_lines_follow_the_language() {
        let info = PresenceInfo {
            title: "Chainsmoker Cat".into(),
            season: Some(1),
            episode_number: Some(3),
            episode_title: Some("La Gata Fumadora".into()),
            episode_count: Some(12),
            kind: "series".into(),
            ..Default::default()
        };
        assert_eq!(info.episode_line("es").as_deref(), Some("T1 E3 · La Gata Fumadora"));
        assert_eq!(info.episode_line("en").as_deref(), Some("S1 E3 · La Gata Fumadora"));
        assert_eq!(info.party_size(), Some((3, 12)));
        assert_eq!(fill_template("{episode}", &info, "es"), "T1 E3 · La Gata Fumadora");

        let untitled = PresenceInfo { episode_title: Some("E3".into()), episode_count: Some(2), ..info.clone() };
        assert_eq!(untitled.episode_line("es").as_deref(), Some("T1 E3"));
        assert_eq!(untitled.party_size(), None);
        for generic in ["Episodio 3", "Episode 03", "S01E03", "t1:e3"] {
            let info = PresenceInfo { episode_title: Some(generic.into()), ..info.clone() };
            assert_eq!(info.episode_line("es").as_deref(), Some("T1 E3"), "{generic}");
        }
        let numbered = PresenceInfo { episode_title: Some("Episodio 30".into()), ..info.clone() };
        assert_eq!(numbered.episode_line("es").as_deref(), Some("T1 E3 · Episodio 30"));

        let live = PresenceInfo { title: "La 1".into(), episode: Some("Telediario".into()), kind: "live".into(), ..Default::default() };
        assert_eq!(live.episode_line("es").as_deref(), Some("Telediario"));

        let film = PresenceInfo { title: "F1".into(), year: Some(2025), kind: "movie".into(), ..Default::default() };
        assert_eq!(film.episode_line("es"), None);
        assert_eq!(fill_template("{type} · {year}", &film, "es"), "Película · 2025");
        let undated = PresenceInfo { year: None, ..film };
        assert_eq!(fill_template("{type} · {year}", &undated, "en"), "Movie");
    }

    #[test]
    fn a_backwards_clock_is_left_out() {
        let mut activity = sample();
        activity.timestamps = Some((50, Some(40)));
        assert!(activity_of(&activity.command(Shape::full())).get("timestamps").is_none());
    }
}
