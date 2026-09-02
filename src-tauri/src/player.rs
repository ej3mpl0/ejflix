use std::ffi::c_void;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot, RwLock};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const WS_CHILD: u32 = 0x4000_0000;
const WS_CLIPSIBLINGS: u32 = 0x0400_0000;
const WS_CLIPCHILDREN: u32 = 0x0200_0000;
const SWP_NOSIZE: u32 = 0x0001;
const SWP_NOMOVE: u32 = 0x0002;
const SWP_NOACTIVATE: u32 = 0x0010;
const SW_HIDE: i32 = 0;
const SW_SHOWNA: i32 = 8;
const HWND_TOP: isize = 0;
const HWND_NOTOPMOST: isize = -2;
const WS_EX_NOACTIVATE: u32 = 0x0800_0000;
const WS_EX_TOPMOST: isize = 0x0000_0008;
const GWL_EXSTYLE: i32 = -20;
const GW_CHILD: u32 = 5;
const GW_HWNDNEXT: u32 = 2;
const VK_ESCAPE: i32 = 0x1B;
const VK_SPACE: i32 = 0x20;
const CS_VREDRAW: u32 = 0x0001;
const CS_HREDRAW: u32 = 0x0002;
const COLOR_VIDEO: u32 = 0x000E_0B0B;

#[repr(C)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[link(name = "user32")]
extern "system" {
    fn CreateWindowExW(
        dw_ex_style: u32,
        class_name: *const u16,
        window_name: *const u16,
        style: u32,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        parent: isize,
        menu: *mut c_void,
        instance: *mut c_void,
        param: *mut c_void,
    ) -> isize;
    fn SetWindowPos(
        hwnd: isize,
        insert_after: isize,
        x: i32,
        y: i32,
        cx: i32,
        cy: i32,
        flags: u32,
    ) -> i32;
    fn ShowWindow(hwnd: isize, cmd: i32) -> i32;
    fn MoveWindow(hwnd: isize, x: i32, y: i32, w: i32, h: i32, repaint: i32) -> i32;
    fn GetClientRect(hwnd: isize, rect: *mut Rect) -> i32;
    fn GetWindow(hwnd: isize, cmd: u32) -> isize;
    fn RegisterClassW(wnd: *const WndClassW) -> u16;
    fn DefWindowProcW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize;
    fn GetModuleHandleW(name: *const u16) -> isize;
    fn GetParent(hwnd: isize) -> isize;
    fn GetWindowLongPtrW(hwnd: isize, index: i32) -> isize;
    fn SetWindowLongPtrW(hwnd: isize, index: i32, value: isize) -> isize;
    fn GetAsyncKeyState(vkey: i32) -> i16;
    fn GetForegroundWindow() -> isize;
}

#[link(name = "gdi32")]
extern "system" {
    fn CreateSolidBrush(color: u32) -> isize;
}

#[repr(C)]
struct WndClassW {
    style: u32,
    wnd_proc: unsafe extern "system" fn(isize, u32, usize, isize) -> isize,
    cls_extra: i32,
    wnd_extra: i32,
    instance: isize,
    icon: isize,
    cursor: isize,
    background: isize,
    menu_name: *const u16,
    class_name: *const u16,
}

unsafe extern "system" fn video_wnd_proc(
    hwnd: isize,
    msg: u32,
    wparam: usize,
    lparam: isize,
) -> isize {
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerTrack {
    pub id: i64,
    pub kind: String,
    pub title: String,
    pub lang: Option<String>,
    pub selected: bool,
    pub codec: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
    pub time: f64,
    pub duration: f64,
    pub paused: bool,
    pub volume: f64,
    pub mute: bool,
    pub buffering: bool,
    pub eof: bool,
    pub tracks: Vec<PlayerTrack>,
    pub aid: i64,
    pub sid: i64,
    pub title: String,
    /// Absolute position (seconds) up to which the demuxer has cached data.
    pub cache_time: f64,
    pub speed: f64,
}

impl Default for PlayerState {
    fn default() -> Self {
        Self {
            time: 0.0,
            duration: 0.0,
            paused: false,
            volume: 100.0,
            mute: false,
            buffering: false,
            eof: false,
            tracks: vec![],
            aid: 0,
            sid: 0,
            title: String::new(),
            cache_time: 0.0,
            speed: 1.0,
        }
    }
}

#[derive(Clone)]
pub struct PlaybackContext {
    pub item_id: String,
    pub media_source_id: Option<String>,
    pub play_session_id: String,
}

struct IpcRequest {
    payload: Value,
    reply: Option<oneshot::Sender<Value>>,
}

pub struct Player {
    video_hwnd: Mutex<isize>,
    parent_hwnd: Mutex<isize>,
    child: Mutex<Option<Child>>,
    cmd_tx: Mutex<Option<mpsc::UnboundedSender<IpcRequest>>>,
    pub state: Arc<RwLock<PlayerState>>,
    pub context: Arc<RwLock<Option<PlaybackContext>>>,
    running: Arc<AtomicBool>,
    overlay_guard: Arc<AtomicBool>,
    overlay_gen: Arc<AtomicU64>,
    request_id: AtomicU64,
}

impl Player {
    pub fn new() -> Self {
        Self {
            video_hwnd: Mutex::new(0),
            parent_hwnd: Mutex::new(0),
            child: Mutex::new(None),
            cmd_tx: Mutex::new(None),
            state: Arc::new(RwLock::new(PlayerState::default())),
            context: Arc::new(RwLock::new(None)),
            running: Arc::new(AtomicBool::new(false)),
            overlay_guard: Arc::new(AtomicBool::new(false)),
            overlay_gen: Arc::new(AtomicU64::new(0)),
            request_id: AtomicU64::new(1),
        }
    }

    pub fn attach_window(&self, window: &tauri::WebviewWindow) -> Result<(), String> {
        let parent = parent_hwnd(window)?;
        if parent == 0 {
            return Err("HWND de ventana inválido".into());
        }
        *self.parent_hwnd.lock().unwrap() = parent;
        let (w, h) = client_size(parent);
        let video = create_video_host(parent, w, h)?;
        *self.video_hwnd.lock().unwrap() = video;
        unsafe {
            ShowWindow(video, SW_HIDE);
        }
        self.raise_video();
        Ok(())
    }

    fn raise_video(&self) {
        let parent = *self.parent_hwnd.lock().unwrap();
        let video = *self.video_hwnd.lock().unwrap();
        raise_video_in_main(parent, video);
    }

    pub fn resize(&self) {
        let parent = *self.parent_hwnd.lock().unwrap();
        let video = *self.video_hwnd.lock().unwrap();
        if parent == 0 || video == 0 {
            return;
        }
        let (w, h) = client_size(parent);
        unsafe {
            MoveWindow(video, 0, 0, w, h, 1);
        }
        self.raise_video();
    }

    pub fn show_video(&self, show: bool) {
        let video = *self.video_hwnd.lock().unwrap();
        if video == 0 {
            return;
        }
        unsafe {
            ShowWindow(video, if show { SW_SHOWNA } else { SW_HIDE });
        }
        self.resize();
    }

    fn start_overlay_guard(&self, app: &AppHandle) {
        self.overlay_guard.store(true, Ordering::SeqCst);
        let gen = self.overlay_gen.fetch_add(1, Ordering::SeqCst) + 1;
        let guard = self.overlay_guard.clone();
        let overlay_gen = self.overlay_gen.clone();
        let parent = *self.parent_hwnd.lock().unwrap();
        let video = *self.video_hwnd.lock().unwrap();
        let app = app.clone();
        std::thread::spawn(move || {
            let mut esc = false;
            let mut space = false;
            while guard.load(Ordering::SeqCst) && overlay_gen.load(Ordering::SeqCst) == gen {
                raise_video_in_main(parent, video);
                crate::sync_player_overlay(&app);
                let overlay = crate::overlay_hwnd(&app);
                // The overlay WebView handles its own keydown events; only poll the
                // keys when the main window (mpv side) owns the focus, otherwise every
                // Space/Esc would be delivered twice.
                if !foreground_is_ours(overlay) && foreground_is_ours(parent) {
                    let esc_down = unsafe { GetAsyncKeyState(VK_ESCAPE) } as u16 & 0x8000 != 0;
                    if esc_down && !esc {
                        let _ = app.emit("player://hotkey", "escape");
                    }
                    esc = esc_down;
                    let space_down = unsafe { GetAsyncKeyState(VK_SPACE) } as u16 & 0x8000 != 0;
                    if space_down && !space {
                        let _ = app.emit("player://hotkey", "space");
                    }
                    space = space_down;
                } else {
                    esc = false;
                    space = false;
                }
                std::thread::sleep(Duration::from_millis(120));
            }
        });
    }

    fn stop_overlay_guard(&self) {
        self.overlay_guard.store(false, Ordering::SeqCst);
        self.overlay_gen.fetch_add(1, Ordering::SeqCst);
    }

    pub async fn start(
        &self,
        app: &AppHandle,
        url: &str,
        token: &str,
        title: &str,
        start_seconds: f64,
        context: PlaybackContext,
    ) -> Result<(), String> {
        self.ensure_process(app).await?;
        {
            let mut state = self.state.write().await;
            *state = PlayerState {
                title: title.to_string(),
                volume: state.volume,
                mute: state.mute,
                // Until mpv reports time-pos, treat the resume point as the current
                // time so an immediate stop does not report position 0 to Jellyfin.
                time: start_seconds.max(0.0),
                ..PlayerState::default()
            };
            state.title = title.to_string();
        }
        *self.context.write().await = Some(context);
        self.show_video(true);
        let _ = self
            .command(
                json!(["set_property", "http-header-fields", format!("X-Emby-Token: {token}")]),
                false,
            )
            .await;
        // Resume position: `loadfile` returns before the file is actually loaded, so a
        // `seek` sent right after it is dropped by mpv ("no file loaded"). The `start`
        // option is applied by mpv itself when the next file loads, which is reliable.
        let start = if start_seconds > 1.0 {
            format!("{start_seconds:.3}")
        } else {
            "none".to_string()
        };
        let _ = self
            .command(json!(["set_property", "start", start]), false)
            .await;
        let _ = self
            .command(json!(["set_property", "speed", 1.0]), false)
            .await;
        self.command(json!(["loadfile", url, "replace"]), false)
            .await?;
        self.raise_video();
        self.start_overlay_guard(app);
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_focus();
        }
        let _ = self.command(json!(["set_property", "pause", false]), false).await;
        self.running.store(true, Ordering::SeqCst);
        let _ = app.emit("player://state", self.state.read().await.clone());
        Ok(())
    }

    pub async fn stop(&self) -> Result<Option<(PlaybackContext, i64)>, String> {
        self.stop_overlay_guard();
        self.running.store(false, Ordering::SeqCst);
        let ctx = self.context.write().await.take();
        let time = self.state.read().await.time;
        let _ = self.command(json!(["stop"]), false).await;
        self.show_video(false);
        Ok(ctx.map(|c| (c, seconds_to_ticks(time))))
    }

    pub async fn toggle_pause(&self) -> Result<(), String> {
        self.command(json!(["cycle", "pause"]), false).await?;
        Ok(())
    }

    /// `fast` uses a keyframe seek (cheap, used while scrubbing); otherwise the
    /// seek is exact thanks to `--hr-seek=yes`.
    pub async fn seek(&self, seconds: f64, relative: bool, fast: bool) -> Result<(), String> {
        let mode = match (relative, fast) {
            (true, _) => "relative",
            (false, false) => "absolute",
            (false, true) => "absolute+keyframes",
        };
        self.command(json!(["seek", seconds, mode]), false).await?;
        Ok(())
    }

    pub async fn set_speed(&self, speed: f64) -> Result<f64, String> {
        let speed = if speed.is_finite() { speed.clamp(0.25, 4.0) } else { 1.0 };
        self.command(json!(["set_property", "speed", speed]), false)
            .await?;
        self.state.write().await.speed = speed;
        Ok(speed)
    }

    pub async fn set_volume(&self, volume: f64) -> Result<f64, String> {
        let volume = volume.clamp(0.0, 100.0);
        self.command(json!(["set_property", "volume", volume]), false)
            .await?;
        self.state.write().await.volume = volume;
        Ok(volume)
    }

    pub async fn set_mute(&self, mute: bool) -> Result<(), String> {
        self.command(json!(["set_property", "mute", mute]), false)
            .await?;
        self.state.write().await.mute = mute;
        Ok(())
    }

    pub async fn set_track(&self, kind: &str, id: i64) -> Result<(), String> {
        let prop = match kind {
            "audio" => "aid",
            "sub" => "sid",
            _ => return Err("Pista no válida".into()),
        };
        if id <= 0 {
            self.command(json!(["set_property", prop, "no"]), false)
                .await?;
        } else {
            self.command(json!(["set_property", prop, id]), false)
                .await?;
        }
        Ok(())
    }

    pub async fn snapshot(&self) -> PlayerState {
        self.state.read().await.clone()
    }

    async fn ensure_process(&self, app: &AppHandle) -> Result<(), String> {
        if self.cmd_tx.lock().unwrap().is_some() {
            if let Some(child) = self.child.lock().unwrap().as_mut() {
                if child.try_wait().ok().flatten().is_none() {
                    return Ok(());
                }
            }
        }
        self.spawn(app).await
    }

    async fn spawn(&self, app: &AppHandle) -> Result<(), String> {
        let mpv = find_mpv(app)?;
        let pipe_name = format!(r"\\.\pipe\ejflix-mpv-{}", std::process::id());
        let video = *self.video_hwnd.lock().unwrap();
        let mut args = vec![
            "--idle=yes".into(),
            "--force-window=yes".into(),
            "--keep-open=yes".into(),
            "--no-border".into(),
            "--osc=no".into(),
            "--osd-level=0".into(),
            "--no-input-default-bindings".into(),
            "--input-vo-keyboard=no".into(),
            "--hwdec=d3d11va".into(),
            "--vo=gpu".into(),
            "--target-colorspace-hint=yes".into(),
            "--hdr-compute-peak=yes".into(),
            "--cache=yes".into(),
            "--demuxer-max-bytes=150MiB".into(),
            "--hr-seek=yes".into(),
            "--stop-screensaver".into(),
            "--cursor-autohide=no".into(),
            "--input-cursor=no".into(),
            "--ontop=no".into(),
            "--ao=wasapi".into(),
            "--audio-exclusive=no".into(),
            "--audio-channels=stereo".into(),
            "--audio-normalize-downmix=yes".into(),
            "--ad-lavc-downmix=yes".into(),
            format!("--input-ipc-server={pipe_name}"),
        ];
        if video != 0 {
            args.push(format!("--wid={}", video as usize));
        }

        let child = Command::new(&mpv)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("No se pudo iniciar mpv ({mpv}): {e}"))?;
        *self.child.lock().unwrap() = Some(child);

        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<IpcRequest>();
        *self.cmd_tx.lock().unwrap() = Some(cmd_tx);

        let state = self.state.clone();
        let app_handle = app.clone();
        let running = self.running.clone();
        let parent = *self.parent_hwnd.lock().unwrap();
        let video_hwnd = *self.video_hwnd.lock().unwrap();
        tauri::async_runtime::spawn(async move {
            if let Err(err) =
                ipc_loop(pipe_name, cmd_rx, state, app_handle, running, parent, video_hwnd).await
            {
                eprintln!("mpv ipc: {err}");
            }
        });

        // Give the pipe a moment, then observe properties.
        tokio::time::sleep(Duration::from_millis(250)).await;
        let observes = [
            "time-pos",
            "duration",
            "pause",
            "volume",
            "mute",
            "eof-reached",
            "paused-for-cache",
            "track-list",
            "aid",
            "sid",
            "demuxer-cache-time",
            "speed",
        ];
        for (i, name) in observes.iter().enumerate() {
            let _ = self
                .command(json!(["observe_property", i + 1, name]), false)
                .await;
        }
        Ok(())
    }

    async fn command(&self, command: Value, wait: bool) -> Result<Value, String> {
        let tx = self
            .cmd_tx
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "mpv no está listo".to_string())?;
        let id = self.request_id.fetch_add(1, Ordering::SeqCst);
        let payload = json!({
            "command": command,
            "request_id": id,
        });
        if wait {
            let (reply_tx, reply_rx) = oneshot::channel();
            tx.send(IpcRequest {
                payload,
                reply: Some(reply_tx),
            })
            .map_err(|_| "mpv ipc cerrado".to_string())?;
            reply_rx
                .await
                .map_err(|_| "sin respuesta de mpv".to_string())
        } else {
            tx.send(IpcRequest {
                payload,
                reply: None,
            })
            .map_err(|_| "mpv ipc cerrado".to_string())?;
            Ok(Value::Null)
        }
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}

async fn ipc_loop(
    pipe_name: String,
    mut cmd_rx: mpsc::UnboundedReceiver<IpcRequest>,
    state: Arc<RwLock<PlayerState>>,
    app: AppHandle,
    running: Arc<AtomicBool>,
    parent: isize,
    video: isize,
) -> Result<(), String> {
    let client = wait_for_pipe(&pipe_name).await?;
    let (reader, mut writer) = tokio::io::split(client);
    let mut lines = BufReader::new(reader).lines();
    let pending: Arc<Mutex<Vec<(u64, oneshot::Sender<Value>)>>> = Arc::new(Mutex::new(vec![]));

    let pending_w = pending.clone();
    let write_task = tauri::async_runtime::spawn(async move {
        while let Some(req) = cmd_rx.recv().await {
            if let Some(reply) = req.reply {
                if let Some(id) = req.payload.get("request_id").and_then(|v| v.as_u64()) {
                    pending_w.lock().unwrap().push((id, reply));
                }
            }
            let mut line = req.payload.to_string();
            line.push('\n');
            if writer.write_all(line.as_bytes()).await.is_err() {
                break;
            }
        }
    });

    while let Ok(Some(line)) = lines.next_line().await {
        if line.is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(id) = msg.get("request_id").and_then(|v| v.as_u64()) {
            let found = {
                let mut list = pending.lock().unwrap();
                list.iter()
                    .position(|(rid, _)| *rid == id)
                    .map(|idx| list.remove(idx))
            };
            if let Some((_, tx)) = found {
                let _ = tx.send(msg);
            }
            continue;
        }
        let event = msg.get("event").and_then(|v| v.as_str());
        if event == Some("file-loaded") || event == Some("playback-restart") {
            raise_video_in_main(parent, video);
            crate::sync_player_overlay(&app);
            if let Some(window) = app.get_webview_window("player-overlay") {
                let _ = window.set_focus();
            }
        }
        if event == Some("property-change") {
            apply_property(&state, &msg).await;
            if running.load(Ordering::SeqCst) {
                let snapshot = state.read().await.clone();
                let _ = app.emit("player://state", snapshot);
            }
        }
    }

    write_task.abort();
    Ok(())
}

async fn wait_for_pipe(
    name: &str,
) -> Result<tokio::net::windows::named_pipe::NamedPipeClient, String> {
    for _ in 0..50 {
        match tokio::net::windows::named_pipe::ClientOptions::new().open(name) {
            Ok(client) => return Ok(client),
            Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
        }
    }
    Err("mpv no abrió el pipe IPC".into())
}

async fn apply_property(state: &Arc<RwLock<PlayerState>>, msg: &Value) {
    let name = msg.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let data = msg.get("data");
    let mut state = state.write().await;
    match name {
        "time-pos" => state.time = data.and_then(|v| v.as_f64()).unwrap_or(state.time),
        "duration" => state.duration = data.and_then(|v| v.as_f64()).unwrap_or(state.duration),
        "pause" => state.paused = data.and_then(|v| v.as_bool()).unwrap_or(state.paused),
        "volume" => state.volume = data.and_then(|v| v.as_f64()).unwrap_or(state.volume),
        "mute" => state.mute = data.and_then(|v| v.as_bool()).unwrap_or(state.mute),
        "eof-reached" => state.eof = data.and_then(|v| v.as_bool()).unwrap_or(false),
        "paused-for-cache" => state.buffering = data.and_then(|v| v.as_bool()).unwrap_or(false),
        "aid" => state.aid = parse_track_id(data),
        "sid" => state.sid = parse_track_id(data),
        "demuxer-cache-time" => state.cache_time = data.and_then(|v| v.as_f64()).unwrap_or(0.0),
        "speed" => state.speed = data.and_then(|v| v.as_f64()).unwrap_or(state.speed),
        "track-list" => {
            if let Some(list) = data.and_then(|v| v.as_array()) {
                state.tracks = list
                    .iter()
                    .filter_map(|t| {
                        let kind = t.get("type")?.as_str()?.to_string();
                        if kind == "video" {
                            return None;
                        }
                        Some(PlayerTrack {
                            id: t.get("id")?.as_i64().unwrap_or(0),
                            kind,
                            title: t
                                .get("title")
                                .and_then(|v| v.as_str())
                                .or_else(|| t.get("lang").and_then(|v| v.as_str()))
                                .unwrap_or("Pista")
                                .to_string(),
                            lang: t.get("lang").and_then(|v| v.as_str()).map(|s| s.to_string()),
                            selected: t.get("selected").and_then(|v| v.as_bool()).unwrap_or(false),
                            codec: t.get("codec").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        })
                    })
                    .collect();
            }
        }
        _ => {}
    }
}

fn parse_track_id(data: Option<&Value>) -> i64 {
    match data {
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
        Some(Value::String(s)) if s == "no" || s == "auto" => 0,
        Some(Value::String(s)) => s.parse().unwrap_or(0),
        _ => 0,
    }
}

fn find_mpv(app: &AppHandle) -> Result<String, String> {
    if let Ok(path) = std::env::var("EJFLIX_MPV") {
        if PathBuf::from(&path).exists() {
            return Ok(path);
        }
    }
    if let Ok(dir) = app.path().resource_dir() {
        for candidate in [
            dir.join("mpv.exe"),
            dir.join("resources").join("mpv.exe"),
        ] {
            if candidate.exists() {
                return Ok(candidate.to_string_lossy().into_owned());
            }
        }
    }
    if PathBuf::from(r"C:\mpv\mpv.exe").exists() {
        return Ok(r"C:\mpv\mpv.exe".into());
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("mpv.exe");
            if candidate.exists() {
                return Ok(candidate.to_string_lossy().into_owned());
            }
        }
    }
    Err("No se encontró mpv.exe. Copia el binario a src-tauri/resources o instálalo en C:\\mpv.".into())
}

fn create_video_host(parent: isize, w: i32, h: i32) -> Result<isize, String> {
    register_video_class()?;
    let class = wide("ejflix_video");
    let name = wide("ejflix-video");
    let hwnd = unsafe {
        CreateWindowExW(
            WS_EX_NOACTIVATE,
            class.as_ptr(),
            name.as_ptr(),
            WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
            0,
            0,
            w.max(1),
            h.max(1),
            parent,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if hwnd == 0 {
        Err("No se pudo crear la ventana de vídeo".into())
    } else {
        Ok(hwnd)
    }
}

fn register_video_class() -> Result<(), String> {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| unsafe {
        let class_name = wide("ejflix_video");
        let class = WndClassW {
            style: CS_HREDRAW | CS_VREDRAW,
            wnd_proc: video_wnd_proc,
            cls_extra: 0,
            wnd_extra: 0,
            instance: GetModuleHandleW(std::ptr::null()),
            icon: 0,
            cursor: 0,
            background: CreateSolidBrush(COLOR_VIDEO),
            menu_name: std::ptr::null(),
            class_name: class_name.as_ptr(),
        };
        let _ = RegisterClassW(&class);
        std::mem::forget(class_name);
    });
    Ok(())
}

fn foreground_is_ours(parent: isize) -> bool {
    if parent == 0 {
        return false;
    }
    unsafe {
        let mut current = GetForegroundWindow();
        while current != 0 {
            if current == parent {
                return true;
            }
            current = GetParent(current);
        }
    }
    false
}

fn raise_video_in_main(parent: isize, video: isize) {
    if parent == 0 || video == 0 {
        return;
    }
    clear_topmost(video);
    unsafe {
        SetWindowPos(
            video,
            HWND_TOP,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

fn clear_topmost(hwnd: isize) {
    if hwnd == 0 {
        return;
    }
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        if ex & WS_EX_TOPMOST != 0 {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex & !WS_EX_TOPMOST);
        }
        SetWindowPos(
            hwnd,
            HWND_NOTOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
        let mut child = GetWindow(hwnd, GW_CHILD);
        while child != 0 {
            clear_topmost(child);
            child = GetWindow(child, GW_HWNDNEXT);
        }
    }
}

fn client_size(hwnd: isize) -> (i32, i32) {
    let mut rect = Rect {
        left: 0,
        top: 0,
        right: 1280,
        bottom: 720,
    };
    unsafe {
        GetClientRect(hwnd, &mut rect);
    }
    (rect.right.max(1), rect.bottom.max(1))
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn seconds_to_ticks(seconds: f64) -> i64 {
    (seconds * 10_000_000.0) as i64
}

fn parent_hwnd(window: &tauri::WebviewWindow) -> Result<isize, String> {
    let handle = window.window_handle().map_err(|e| e.to_string())?;
    match handle.as_raw() {
        RawWindowHandle::Win32(win) => Ok(win.hwnd.get()),
        _ => Err("HWND no disponible".into()),
    }
}
