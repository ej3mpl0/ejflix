//! Intro / recap / credits ranges for the "skip" prompt.
//!
//! Sources, merged per kind with the first one winning:
//! 1. Jellyfin native media segments (10.10+, filled by the Intro Skipper or TheIntroDB
//!    plugins), with the legacy Intro Skipper endpoint as a fallback on older servers.
//! 2. IntroDB.app, a public community database keyed by the show's IMDb id.
//!
//! Everything here is best effort: a failure of any kind yields an empty list, complete
//! results (including empty ones) are cached per item, and IntroDB gets a global backoff
//! when it is slow or down so playback never waits on it twice. A result missing a source
//! because it failed is not cached, so a later playback asks again.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tokio::sync::RwLock;

use crate::jellyfin::{JellyfinClient, Movie};

const INTRODB_URL: &str = "https://api.introdb.app/segments";
/// IntroDB entries below this confidence are ignored.
const INTRODB_MIN_CONFIDENCE: f64 = 0.3;
const INTRODB_BACKOFF: Duration = Duration::from_secs(5 * 60);
const MIN_SEGMENT_SECONDS: f64 = 2.0;
const MAX_SEGMENTS: usize = 32;
const MAX_CACHED_ITEMS: usize = 512;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSegment {
    /// "intro" | "recap" | "outro" | "preview" | "commercial"
    pub kind: String,
    pub start_seconds: f64,
    pub end_seconds: f64,
    /// "jellyfin" | "introdb"
    pub source: String,
}

pub struct SegmentsCache {
    http: reqwest::Client,
    items: RwLock<HashMap<String, Vec<MediaSegment>>>,
    series_imdb: RwLock<HashMap<String, Option<String>>>,
    introdb_down_until: Mutex<Option<Instant>>,
}

impl SegmentsCache {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .user_agent(format!("ejFlix/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("http client");
        Self {
            http,
            items: RwLock::new(HashMap::new()),
            series_imdb: RwLock::new(HashMap::new()),
            introdb_down_until: Mutex::new(None),
        }
    }

    pub async fn clear(&self) {
        self.items.write().await.clear();
        self.series_imdb.write().await.clear();
    }

    /// Never fails: any error is an empty list.
    pub async fn resolve(&self, jf: &JellyfinClient, item_id: &str) -> Vec<MediaSegment> {
        if let Some(cached) = self.items.read().await.get(item_id) {
            return cached.clone();
        }
        let Ok(movie) = jf.get_item(item_id).await else {
            return vec![];
        };
        let (native, community) = tokio::join!(from_jellyfin(jf, item_id), self.from_introdb(jf, &movie));
        let complete = native.is_some() && community.is_some();
        let merged = sanitize(
            merge(native.unwrap_or_default(), community.unwrap_or_default()),
            movie.runtime_ticks.map(|t| t as f64 / 10_000_000.0),
        );
        if complete {
            let mut items = self.items.write().await;
            if items.len() >= MAX_CACHED_ITEMS {
                items.clear();
            }
            items.insert(item_id.to_string(), merged.clone());
        }
        merged
    }

    /// Segments for an episode known only by IMDb id (online titles): IntroDB alone.
    pub async fn resolve_external(&self, imdb: &str, season: i32, episode: i32) -> Vec<MediaSegment> {
        let key = format!("{imdb}:{season}:{episode}");
        if let Some(cached) = self.items.read().await.get(&key) {
            return cached.clone();
        }
        let found = self.introdb(imdb, season, episode).await;
        let complete = found.is_some();
        let list = sanitize(found.unwrap_or_default(), None);
        if complete {
            let mut items = self.items.write().await;
            if items.len() >= MAX_CACHED_ITEMS {
                items.clear();
            }
            items.insert(key, list.clone());
        }
        list
    }

    /// `None` when IntroDB failed or is backed off (the answer is unknown, not empty).
    async fn from_introdb(&self, jf: &JellyfinClient, movie: &Movie) -> Option<Vec<MediaSegment>> {
        if movie.kind != "Episode" {
            return Some(vec![]);
        }
        let (Some(series_id), Some(season), Some(episode)) =
            (movie.series_id.as_deref(), movie.season_number, movie.episode_number)
        else {
            return Some(vec![]);
        };
        if season < 0 || episode <= 0 {
            return Some(vec![]);
        }
        if let Some(until) = *self.introdb_down_until.lock().unwrap() {
            if Instant::now() < until {
                return None;
            }
        }
        let imdb = {
            let cached = self.series_imdb.read().await.get(series_id).cloned();
            match cached {
                Some(value) => value,
                None => {
                    let value = jf.series_imdb_id(series_id).await;
                    self.series_imdb
                        .write()
                        .await
                        .insert(series_id.to_string(), value.clone());
                    value
                }
            }
        };
        let Some(imdb) = imdb else {
            return Some(vec![]);
        };
        self.introdb(&imdb, season, episode).await
    }

    /// `None` on a network error, a bad answer or during the backoff; `Some` otherwise
    /// (empty when IntroDB has nothing for the episode).
    async fn introdb(&self, imdb: &str, season: i32, episode: i32) -> Option<Vec<MediaSegment>> {
        if let Some(until) = *self.introdb_down_until.lock().unwrap() {
            if Instant::now() < until {
                return None;
            }
        }
        let request = self
            .http
            .get(INTRODB_URL)
            .query(&[
                ("imdb_id", imdb),
                ("season", &season.to_string()),
                ("episode", &episode.to_string()),
            ])
            .send()
            .await;
        let response = match request {
            Ok(res) => res,
            Err(_) => {
                self.mark_introdb_down();
                return None;
            }
        };
        let status = response.status();
        if status.as_u16() == 429 || status.is_server_error() {
            self.mark_introdb_down();
            return None;
        }
        if !status.is_success() {
            return Some(vec![]);
        }
        let Ok(value) = response.json::<Value>().await else {
            return None;
        };
        let list: Vec<MediaSegment> = ["intro", "recap", "outro"]
            .iter()
            .filter_map(|kind| {
                let seg = value.get(*kind)?;
                if seg.is_null() {
                    return None;
                }
                let confidence = seg.get("confidence").and_then(|v| v.as_f64()).unwrap_or(1.0);
                if confidence < INTRODB_MIN_CONFIDENCE {
                    return None;
                }
                let start = seg
                    .get("start_ms")
                    .and_then(|v| v.as_f64())
                    .map(|ms| ms / 1000.0)
                    .or_else(|| seg.get("start_sec").and_then(|v| v.as_f64()))?;
                let end = seg
                    .get("end_ms")
                    .and_then(|v| v.as_f64())
                    .map(|ms| ms / 1000.0)
                    .or_else(|| seg.get("end_sec").and_then(|v| v.as_f64()))?;
                Some(MediaSegment {
                    kind: kind.to_string(),
                    start_seconds: start,
                    end_seconds: end,
                    source: "introdb".to_string(),
                })
            })
            .collect();
        Some(list)
    }

    fn mark_introdb_down(&self) {
        *self.introdb_down_until.lock().unwrap() = Some(Instant::now() + INTRODB_BACKOFF);
    }
}

/// `None` when the server could not be asked (the answer is unknown, not empty).
async fn from_jellyfin(jf: &JellyfinClient, item_id: &str) -> Option<Vec<MediaSegment>> {
    match jf.media_segments(item_id).await {
        Ok(Some(list)) => Some(
            list.into_iter()
                .filter_map(|(kind, start, end)| {
                    Some(MediaSegment {
                        kind: map_jellyfin_kind(&kind)?.to_string(),
                        start_seconds: start,
                        end_seconds: end,
                        source: "jellyfin".to_string(),
                    })
                })
                .collect(),
        ),
        // No MediaSegments API (server < 10.10): try the Intro Skipper plugin directly.
        Ok(None) => {
            let (intro, credits) = tokio::join!(
                jf.intro_skipper_range(item_id, false),
                jf.intro_skipper_range(item_id, true)
            );
            let mut out = Vec::new();
            if let Some((start, end)) = intro {
                out.push(MediaSegment {
                    kind: "intro".into(),
                    start_seconds: start,
                    end_seconds: end,
                    source: "jellyfin".into(),
                });
            }
            if let Some((start, end)) = credits {
                out.push(MediaSegment {
                    kind: "outro".into(),
                    start_seconds: start,
                    end_seconds: end,
                    source: "jellyfin".into(),
                });
            }
            Some(out)
        }
        Err(_) => None,
    }
}

fn map_jellyfin_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "Intro" => Some("intro"),
        "Outro" => Some("outro"),
        "Recap" => Some("recap"),
        "Preview" => Some("preview"),
        "Commercial" => Some("commercial"),
        _ => None,
    }
}

/// Per kind, the first source that has it wins (Jellyfin over IntroDB).
fn merge(primary: Vec<MediaSegment>, secondary: Vec<MediaSegment>) -> Vec<MediaSegment> {
    let mut out = primary;
    for seg in secondary {
        if !out.iter().any(|s| s.kind == seg.kind) {
            out.push(seg);
        }
    }
    out
}

fn sanitize(list: Vec<MediaSegment>, duration: Option<f64>) -> Vec<MediaSegment> {
    let mut out: Vec<MediaSegment> = list
        .into_iter()
        .filter(|s| s.start_seconds.is_finite() && s.end_seconds.is_finite())
        .filter(|s| s.start_seconds >= 0.0 && s.end_seconds - s.start_seconds >= MIN_SEGMENT_SECONDS)
        .filter(|s| duration.map_or(true, |d| d <= 0.0 || s.start_seconds < d))
        .collect();
    out.sort_by(|a, b| a.start_seconds.partial_cmp(&b.start_seconds).unwrap_or(std::cmp::Ordering::Equal));
    out.truncate(MAX_SEGMENTS);
    out
}
