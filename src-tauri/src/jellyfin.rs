use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::RwLock;

const CLIENT_NAME: &str = "ejFlix";
const CLIENT_VERSION: &str = "0.4.0";
const DEVICE_NAME: &str = "Windows";
pub const IMAGE_SCHEME: &str = "jfimg";
const IMAGE_ORIGIN: &str = "http://jfimg.localhost";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub server_url: String,
    pub token: String,
    pub user_id: String,
    pub user_name: String,
    pub device_id: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicInfo {
    pub server_name: String,
    pub version: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedServer {
    pub server_url: String,
    pub server_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicUser {
    pub id: String,
    pub name: String,
    pub has_password: bool,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrickplayLevel {
    pub width: u32,
    pub height: u32,
    pub tile_width: u32,
    pub tile_height: u32,
    pub thumbnail_count: u32,
    pub interval: u32,
    pub bandwidth: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrickplayInfo {
    pub media_source_id: String,
    pub levels: Vec<TrickplayLevel>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub index: u32,
    pub start_seconds: f64,
    pub name: Option<String>,
    pub image_tag: Option<String>,
}

/// A user view (library) on the server, e.g. "Películas" or "Series".
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub id: String,
    pub name: String,
    /// Jellyfin `CollectionType`: "movies", "tvshows", "mixed" or None (plain folder).
    pub collection_type: Option<String>,
}

impl Library {
    pub fn is_tv(&self) -> bool {
        self.collection_type.as_deref() == Some("tvshows")
    }
}

/// Cast / crew entry (Jellyfin `People`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub id: String,
    pub name: String,
    pub role: Option<String>,
    /// "Actor", "Director", "Writer", ...
    pub kind: String,
    pub image_url: Option<String>,
}

/// One playable version of an item (Jellyfin `MediaSources`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSourceInfo {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing)]
    pub container: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Movie {
    pub id: String,
    /// Jellyfin item type: "Movie", "Series", "Season" or "Episode".
    pub kind: String,
    pub series_id: Option<String>,
    pub series_name: Option<String>,
    pub season_id: Option<String>,
    /// Season number (episodes: `ParentIndexNumber`; seasons: `IndexNumber`).
    pub season_number: Option<i32>,
    pub episode_number: Option<i32>,
    /// 16:9 still of an episode (its own Primary image), if it has one.
    pub thumb_url: Option<String>,
    pub name: String,
    pub overview: Option<String>,
    pub year: Option<i32>,
    pub runtime_ticks: Option<i64>,
    pub official_rating: Option<String>,
    pub community_rating: Option<f32>,
    pub critic_rating: Option<f32>,
    pub genres: Vec<String>,
    pub poster_url: Option<String>,
    pub backdrop_url: Option<String>,
    pub logo_url: Option<String>,
    pub playback_position_ticks: i64,
    pub played_percentage: f64,
    /// `UserData.IsFavorite` ("My list").
    pub favorite: bool,
    /// `UserData.Played`.
    pub played: bool,
    /// `UserData.UnplayedItemCount` (series and seasons).
    pub unplayed_count: Option<i32>,
    pub badges: Vec<String>,
    pub video_label: Option<String>,
    pub audio_label: Option<String>,
    pub subtitle_labels: Vec<String>,
    pub directors: Vec<String>,
    pub writers: Vec<String>,
    pub studios: Vec<String>,
    pub cast: Vec<Person>,
    /// External ids (`ProviderIds`): "Imdb", "Tmdb", "Tvdb"...
    pub provider_ids: BTreeMap<String, String>,
    pub remote_trailers: Vec<String>,
    /// Seasons: episode count; series: season count.
    pub child_count: Option<i32>,
    /// Series: "Continuing" | "Ended".
    pub status: Option<String>,
    pub tagline: Option<String>,
    /// Series: year of `EndDate`.
    pub end_year: Option<i32>,
    #[serde(skip_serializing)]
    pub stream_url: String,
    pub media_source_id: Option<String>,
    pub media_sources: Vec<MediaSourceInfo>,
    /// ISO-8601 date the item was added to the library (`DateCreated`).
    pub date_created: Option<String>,
    pub trickplay: Option<TrickplayInfo>,
    pub chapters: Vec<Chapter>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenreRow {
    pub id: String,
    pub name: String,
    pub items: Vec<Movie>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeData {
    /// Hero carousel items (newest with a backdrop; rotation offset per app launch).
    pub featured: Vec<Movie>,
    pub resume: Vec<Movie>,
    /// Next episodes to watch (TV libraries only).
    pub next_up: Vec<Movie>,
    pub latest: Vec<Movie>,
    pub genres: Vec<GenreRow>,
    pub all: Vec<Movie>,
}

#[derive(Clone)]
pub struct JellyfinClient {
    http: reqwest::Client,
    http_local: reqwest::Client,
    session: Arc<RwLock<Option<Session>>>,
}

/// Filters of the Discover tab.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BrowseArgs {
    /// "movie" | "series"
    #[serde(rename = "type")]
    pub kind: String,
    pub genre: Option<String>,
    pub year: Option<u32>,
    /// "popular" | "newest" | "year" | "name"
    pub sort: String,
    pub start: u32,
    pub limit: u32,
}

impl Default for BrowseArgs {
    fn default() -> Self {
        Self {
            kind: "movie".into(),
            genre: None,
            year: None,
            sort: "popular".into(),
            start: 0,
            limit: 40,
        }
    }
}

impl JellyfinClient {
    /// Library browse with genre / year filters (Discover tab).
    pub async fn browse(&self, args: &BrowseArgs) -> Result<Vec<Movie>, String> {
        let session = self.require_session().await?;
        let fields = item_fields();
        let item_type = if args.kind == "series" { "Series" } else { "Movie" };
        let (sort_by, order) = match args.sort.as_str() {
            "newest" => ("DateCreated,SortName", "Descending"),
            "year" => ("ProductionYear,SortName", "Descending"),
            "name" => ("SortName", "Ascending"),
            _ => ("CommunityRating,SortName", "Descending"),
        };
        let mut path = format!(
            "/Users/{}/Items?IncludeItemTypes={item_type}&Recursive=true&SortBy={sort_by}&SortOrder={order}&StartIndex={}&Limit={}&Fields={fields}&EnableImageTypes=Primary,Backdrop,Logo",
            session.user_id,
            args.start,
            args.limit.clamp(1, 60)
        );
        if let Some(genre) = args.genre.as_deref().map(str::trim).filter(|g| !g.is_empty()) {
            path.push_str("&Genres=");
            path.push_str(&urlencoding_lite(genre));
        }
        if let Some(year) = args.year.filter(|y| (1880..=2100).contains(y)) {
            path.push_str(&format!("&Years={year}"));
        }
        self.items_query(&path).await
    }

    /// Genre names of the whole library (movies and series).
    pub async fn genres(&self) -> Result<Vec<String>, String> {
        let session = self.require_session().await?;
        let res = self
            .get(&format!(
                "/Genres?IncludeItemTypes=Movie,Series&UserId={}&Recursive=true&SortBy=SortName",
                session.user_id
            ))
            .await?;
        if !res.status().is_success() {
            return Ok(vec![]);
        }
        let value: Value = res.json().await.map_err(|e| e.to_string())?;
        Ok(value
            .get("Items")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
            .filter_map(|g| g.get("Name").and_then(|v| v.as_str()).map(|s| s.to_string()))
            .collect())
    }
}

impl JellyfinClient {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .expect("http client");
        let http_local = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(Duration::from_secs(20))
            .build()
            .expect("http client");
        Self {
            http,
            http_local,
            session: Arc::new(RwLock::new(None)),
        }
    }

    fn client_for(&self, url: &str) -> &reqwest::Client {
        if allows_insecure_tls(url) {
            &self.http_local
        } else {
            &self.http
        }
    }

    pub async fn session(&self) -> Option<Session> {
        self.session.read().await.clone()
    }

    pub async fn set_session(&self, session: Option<Session>) {
        *self.session.write().await = session;
    }

    pub async fn require_session(&self) -> Result<Session, String> {
        self.session()
            .await
            .ok_or_else(|| "No hay sesión activa".to_string())
    }

    pub async fn probe(&self, url: &str) -> Result<PublicInfo, String> {
        let url = normalize_url(url)?;
        let res = self
            .client_for(&url)
            .get(format!("{url}/System/Info/Public"))
            .send()
            .await
            .map_err(|e| format!("No se puede conectar a Jellyfin: {e}"))?;
        if !res.status().is_success() {
            return Err(format!("El servidor respondió {}", res.status()));
        }
        let value: Value = res
            .json()
            .await
            .map_err(|e| format!("Respuesta inválida: {e}"))?;
        Ok(PublicInfo {
            server_name: value
                .get("ServerName")
                .and_then(|v| v.as_str())
                .unwrap_or("Jellyfin")
                .to_string(),
            version: value
                .get("Version")
                .and_then(|v| v.as_str())
                .unwrap_or("?")
                .to_string(),
            id: value
                .get("Id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
        })
    }

    pub async fn list_public_users(&self, url: &str) -> Result<Vec<PublicUser>, String> {
        let server_url = normalize_url(url)?;
        let res = self
            .client_for(&server_url)
            .get(format!("{server_url}/Users/Public"))
            .send()
            .await
            .map_err(|e| format!("No se pueden leer los perfiles: {e}"))?;
        if !res.status().is_success() {
            return Err(format!("El servidor respondió {}", res.status()));
        }
        let value: Value = res
            .json()
            .await
            .map_err(|e| format!("Respuesta inválida: {e}"))?;
        let users = value
            .as_array()
            .or_else(|| value.get("Items").and_then(|v| v.as_array()))
            .or_else(|| value.get("Users").and_then(|v| v.as_array()));
        let Some(users) = users else {
            return Ok(vec![]);
        };
        Ok(users
            .iter()
            .filter_map(|user| map_public_user(user, &server_url))
            .collect())
    }

    pub async fn login(
        &self,
        url: &str,
        username: &str,
        password: &str,
        device_id: &str,
    ) -> Result<Session, String> {
        let server_url = normalize_url(url)?;
        let headers = auth_headers(device_id, None);
        let res = self
            .client_for(&server_url)
            .post(format!("{server_url}/Users/AuthenticateByName"))
            .headers(headers)
            .json(&json!({ "Username": username, "Pw": password }))
            .send()
            .await
            .map_err(|e| format!("No se puede conectar: {e}"))?;
        if !res.status().is_success() {
            return Err("Usuario o contraseña incorrectos".into());
        }
        let value: Value = res
            .json()
            .await
            .map_err(|e| format!("Respuesta inválida: {e}"))?;
        let token = value
            .get("AccessToken")
            .and_then(|v| v.as_str())
            .ok_or("El servidor no devolvió token")?
            .to_string();
        let user = value.get("User").ok_or("El servidor no devolvió usuario")?;
        let user_id = user
            .get("Id")
            .and_then(|v| v.as_str())
            .ok_or("Falta el id de usuario")?
            .to_string();
        let user_name = user
            .get("Name")
            .and_then(|v| v.as_str())
            .unwrap_or(username)
            .to_string();
        let tag = user.get("PrimaryImageTag").and_then(|v| v.as_str());
        let session = Session {
            server_url: server_url.clone(),
            token: token.clone(),
            user_id: user_id.clone(),
            user_name,
            device_id: device_id.to_string(),
            avatar_url: Some(user_image_url(&user_id, tag)),
        };
        self.set_session(Some(session.clone())).await;
        Ok(session)
    }

    pub async fn validate(&self) -> Result<Session, String> {
        let mut session = self.require_session().await?;
        let res = self
            .get(&format!("/Users/{}", session.user_id))
            .await?;
        if !res.status().is_success() {
            self.set_session(None).await;
            return Err("Sesión caducada".into());
        }
        if let Ok(value) = res.json::<Value>().await {
            if let Some(name) = value.get("Name").and_then(|v| v.as_str()) {
                session.user_name = name.to_string();
            }
            session.avatar_url = Some(user_image_url(
                &session.user_id,
                value.get("PrimaryImageTag").and_then(|v| v.as_str()),
            ));
            self.set_session(Some(session.clone())).await;
        }
        Ok(session)
    }

    /// Libraries (user views) that ejFlix can browse: movies, TV shows, mixed or plain folders.
    pub async fn libraries(&self) -> Result<Vec<Library>, String> {
        let session = self.require_session().await?;
        let res = self
            .get(&format!("/Users/{}/Views", session.user_id))
            .await?;
        if !res.status().is_success() {
            return Err(format!("Jellyfin Views: {}", res.status()));
        }
        let value: Value = res.json().await.map_err(|e| e.to_string())?;
        let libraries = value
            .get("Items")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
            .filter_map(|view| {
                let id = view.get("Id")?.as_str()?.to_string();
                if !valid_item_id(&id) {
                    return None;
                }
                let name = view.get("Name")?.as_str()?.to_string();
                let collection_type = view
                    .get("CollectionType")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                match collection_type.as_deref() {
                    Some("movies") | Some("tvshows") | Some("mixed") | None => Some(Library {
                        id,
                        name,
                        collection_type,
                    }),
                    _ => None,
                }
            })
            .collect();
        Ok(libraries)
    }

    /// Home feed. Without a library it covers every movie the user can see; with one it
    /// is scoped to that library (`ParentId`), showing series instead of movies for TV.
    pub async fn home(&self, library: Option<&Library>) -> Result<HomeData, String> {
        let session = self.require_session().await?;
        let fields = item_fields();
        let tv = library.is_some_and(|l| l.is_tv());
        let parent = library
            .map(|l| format!("&ParentId={}", l.id))
            .unwrap_or_default();
        let main_type = if tv { "Series" } else { "Movie" };
        let resume_type = if tv { "Episode" } else { "Movie" };
        let resume_path = format!(
            "/Users/{}/Items/Resume?IncludeItemTypes={resume_type}&Limit=16&Fields={fields}{parent}",
            session.user_id
        );
        let all_path = format!(
            "/Users/{}/Items?IncludeItemTypes={main_type}&Recursive=true&SortBy=SortName&SortOrder=Ascending&Limit=80&Fields={fields}&EnableImageTypes=Primary,Backdrop,Logo{parent}",
            session.user_id
        );
        let next_up_path = format!(
            "/Shows/NextUp?UserId={}&Limit=18&Fields={fields}&EnableImageTypes=Primary,Backdrop,Logo,Thumb{parent}",
            session.user_id
        );
        let next_up = async {
            if tv {
                self.items_query(&next_up_path).await
            } else {
                Ok(Vec::new())
            }
        };
        let (resume, next_up, latest, all, genres) = tokio::try_join!(
            self.items_query(&resume_path),
            next_up,
            self.latest_items(&session, fields, main_type, &parent),
            self.items_query(&all_path),
            self.genre_rows(&session, fields, main_type, &parent),
        )?;

        // Hero carousel: the newest items with a backdrop, rotated per app launch so the
        // first slide is not always the same title. Stable within a session, so the
        // background refresh after playback does not reshuffle it.
        let mut candidates: Vec<Movie> = latest
            .iter()
            .filter(|m| m.backdrop_url.is_some())
            .take(8)
            .cloned()
            .collect();
        if candidates.is_empty() {
            candidates = all
                .iter()
                .filter(|m| m.backdrop_url.is_some())
                .take(8)
                .cloned()
                .collect();
        }
        if candidates.is_empty() {
            if let Some(first) = latest.first().or_else(|| all.first()) {
                candidates.push(first.clone());
            }
        }
        if !candidates.is_empty() {
            let offset = (launch_seed() % candidates.len() as u64) as usize;
            candidates.rotate_left(offset);
        }
        let featured = candidates;

        Ok(HomeData {
            featured,
            resume,
            next_up,
            latest,
            genres,
            all,
        })
    }

    pub async fn seasons(&self, series_id: &str) -> Result<Vec<Movie>, String> {
        if !valid_item_id(series_id) {
            return Err("Ítem no válido".into());
        }
        let session = self.require_session().await?;
        let fields = item_fields();
        self.items_query(&format!(
            "/Shows/{series_id}/Seasons?UserId={}&Fields={fields}",
            session.user_id
        ))
        .await
    }

    pub async fn episodes(&self, series_id: &str, season_id: &str) -> Result<Vec<Movie>, String> {
        if !valid_item_id(series_id) || !valid_item_id(season_id) {
            return Err("Ítem no válido".into());
        }
        let session = self.require_session().await?;
        let fields = item_fields();
        self.items_query(&format!(
            "/Shows/{series_id}/Episodes?SeasonId={season_id}&UserId={}&Fields={fields}",
            session.user_id
        ))
        .await
    }

    /// Episode that follows `episode_id` in series order (crosses seasons), if any.
    pub async fn next_episode(&self, series_id: &str, episode_id: &str) -> Result<Option<Movie>, String> {
        if !valid_item_id(series_id) || !valid_item_id(episode_id) {
            return Err("Ítem no válido".into());
        }
        let session = self.require_session().await?;
        let fields = item_fields();
        let items = self
            .items_query(&format!(
                "/Shows/{series_id}/Episodes?UserId={}&StartItemId={episode_id}&Limit=2&Fields={fields}",
                session.user_id
            ))
            .await?;
        Ok(items.into_iter().find(|m| m.id != episode_id))
    }

    /// Episode to play when pressing Play on a series: Jellyfin's "next up" (first
    /// unwatched after the last watched), else the first episode of the show.
    pub async fn series_next_up(&self, series_id: &str) -> Result<Option<Movie>, String> {
        if !valid_item_id(series_id) {
            return Err("Ítem no válido".into());
        }
        let session = self.require_session().await?;
        let fields = item_fields();
        let next_up = self
            .items_query(&format!(
                "/Shows/NextUp?UserId={}&SeriesId={series_id}&Limit=1&Fields={fields}",
                session.user_id
            ))
            .await
            .unwrap_or_default();
        if let Some(episode) = next_up.into_iter().next() {
            return Ok(Some(episode));
        }
        let first = self
            .items_query(&format!(
                "/Shows/{series_id}/Episodes?UserId={}&Limit=1&Fields={fields}",
                session.user_id
            ))
            .await?;
        Ok(first.into_iter().next())
    }

    /// Items Jellyfin considers similar ("More like this").
    pub async fn similar(&self, id: &str) -> Result<Vec<Movie>, String> {
        if !valid_item_id(id) {
            return Err("Ítem no válido".into());
        }
        let session = self.require_session().await?;
        let fields = item_fields();
        self.items_query(&format!(
            "/Items/{id}/Similar?UserId={}&Limit=12&Fields={fields}",
            session.user_id
        ))
        .await
    }

    /// Everything the user marked as favorite ("My list"), newest first.
    pub async fn favorites(&self) -> Result<Vec<Movie>, String> {
        let session = self.require_session().await?;
        let fields = item_fields();
        self.items_query(&format!(
            "/Users/{}/Items?Filters=IsFavorite&Recursive=true&IncludeItemTypes=Movie,Series,Episode&SortBy=DateCreated,SortName&SortOrder=Descending&Limit=100&Fields={fields}&EnableImageTypes=Primary,Backdrop,Logo,Thumb",
            session.user_id
        ))
        .await
    }

    pub async fn set_favorite(&self, item_id: &str, favorite: bool) -> Result<bool, String> {
        self.user_flag("UserFavoriteItems", "FavoriteItems", item_id, favorite, "IsFavorite")
            .await
    }

    /// Marks an item (or every child of a season/series) as played or unplayed.
    pub async fn set_played(&self, item_id: &str, played: bool) -> Result<bool, String> {
        self.user_flag("UserPlayedItems", "PlayedItems", item_id, played, "Played")
            .await
    }

    /// POST/DELETE a per-user flag: the 10.9+ route first, the legacy one on 404.
    /// Both answer with the updated `UserItemDataDto`; the flag is read back from it.
    async fn user_flag(
        &self,
        modern: &str,
        legacy: &str,
        item_id: &str,
        on: bool,
        field: &str,
    ) -> Result<bool, String> {
        if !valid_item_id(item_id) {
            return Err("Ítem no válido".into());
        }
        let session = self.require_session().await?;
        let method = if on {
            reqwest::Method::POST
        } else {
            reqwest::Method::DELETE
        };
        let modern_path = format!("/{modern}/{item_id}?userId={}", session.user_id);
        let legacy_path = format!("/Users/{}/{legacy}/{item_id}", session.user_id);
        let mut res = self.send_empty(method.clone(), &modern_path).await?;
        if res.status().as_u16() == 404 {
            res = self.send_empty(method, &legacy_path).await?;
        }
        if !res.status().is_success() {
            return Err(format!("Jellyfin {modern}: {}", res.status()));
        }
        let value: Value = res.json().await.unwrap_or(Value::Null);
        Ok(value.get(field).and_then(|v| v.as_bool()).unwrap_or(on))
    }

    /// Series-level IMDb id (episodes carry their own ids, IntroDB is keyed by the show).
    pub async fn series_imdb_id(&self, series_id: &str) -> Option<String> {
        let series = self.get_item(series_id).await.ok()?;
        series
            .provider_ids
            .get("Imdb")
            .filter(|id| id.starts_with("tt"))
            .cloned()
    }

    /// Native media segments (Jellyfin 10.10+): `(type, start_seconds, end_seconds)`.
    /// `Ok(None)` when the server has no MediaSegments API (404 on older versions).
    pub async fn media_segments(
        &self,
        item_id: &str,
    ) -> Result<Option<Vec<(String, f64, f64)>>, String> {
        if !valid_item_id(item_id) {
            return Err("Ítem no válido".into());
        }
        let res = self.get(&format!("/MediaSegments/{item_id}")).await?;
        if res.status().as_u16() == 404 {
            return Ok(None);
        }
        if !res.status().is_success() {
            return Err(format!("Jellyfin MediaSegments: {}", res.status()));
        }
        let value: Value = res.json().await.map_err(|e| e.to_string())?;
        let items = value
            .get("Items")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
            .filter_map(|seg| {
                let kind = seg.get("Type")?.as_str()?.to_string();
                let start = seg.get("StartTicks")?.as_f64()? / 10_000_000.0;
                let end = seg.get("EndTicks")?.as_f64()? / 10_000_000.0;
                Some((kind, start, end))
            })
            .collect();
        Ok(Some(items))
    }

    /// Intro Skipper plugin API on servers without native segments.
    /// `credits` selects the end-credits range; `None` on any failure.
    pub async fn intro_skipper_range(&self, item_id: &str, credits: bool) -> Option<(f64, f64)> {
        if !valid_item_id(item_id) {
            return None;
        }
        let mode = if credits { "?mode=Credits" } else { "" };
        let res = self
            .get(&format!("/Episode/{item_id}/IntroTimestamps/v1{mode}"))
            .await
            .ok()?;
        if !res.status().is_success() {
            return None;
        }
        let value: Value = res.json().await.ok()?;
        if value.get("Valid").and_then(|v| v.as_bool()) != Some(true) {
            return None;
        }
        let start = value.get("IntroStart")?.as_f64()?;
        let end = value.get("IntroEnd")?.as_f64()?;
        Some((start, end))
    }

    /// Direct-play URL for a specific version of an item.
    pub fn stream_url_for(session: &Session, item_id: &str, source: Option<&MediaSourceInfo>) -> String {
        let container = source.map(|s| s.container.as_str()).unwrap_or("mkv");
        let mut url = format!(
            "{}/Videos/{item_id}/stream.{container}?static=true",
            session.server_url
        );
        if let Some(source) = source {
            url.push_str(&format!("&MediaSourceId={}", source.id));
        }
        url
    }

    pub async fn get_item(&self, id: &str) -> Result<Movie, String> {
        if !valid_item_id(id) {
            return Err("Ítem no válido".into());
        }
        let session = self.require_session().await?;
        let fields = detail_fields();
        let res = self
            .get(&format!(
                "/Users/{}/Items/{id}?Fields={fields}",
                session.user_id
            ))
            .await?;
        if !res.status().is_success() {
            return Err("No se encontró la película".into());
        }
        let value: Value = res.json().await.map_err(|e| e.to_string())?;
        self.map_item(&session, &value)
    }

    pub async fn fetch_local_image(&self, path: &str, query: &str) -> Result<(Vec<u8>, String), String> {
        if !allowed_image_path(path) {
            return Err("Ruta de imagen no permitida".into());
        }
        let session = self.require_session().await?;
        let qs = if query.is_empty() {
            String::new()
        } else {
            format!("?{query}")
        };
        let url = format!("{}{path}{qs}", session.server_url);
        let res = self
            .client_for(&url)
            .get(&url)
            .headers(auth_headers(&session.device_id, Some(&session.token)))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("Imagen {}", res.status()));
        }
        let content_type = res
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("image/jpeg")
            .to_string();
        let bytes = res.bytes().await.map_err(|e| e.to_string())?;
        if bytes.len() > 12 * 1024 * 1024 {
            return Err("Imagen demasiado grande".into());
        }
        Ok((bytes.to_vec(), content_type))
    }

    pub async fn search(&self, query: &str) -> Result<Vec<Movie>, String> {
        let session = self.require_session().await?;
        let trimmed = query.trim();
        if trimmed.len() > 200 {
            return Err("Búsqueda demasiado larga".into());
        }
        let q = urlencoding_lite(trimmed);
        if q.is_empty() {
            return Ok(vec![]);
        }
        let fields = item_fields();
        self.items_query(&format!(
            "/Users/{}/Items?SearchTerm={q}&IncludeItemTypes=Movie,Series&Recursive=true&Limit=48&Fields={fields}",
            session.user_id
        ))
        .await
    }

    pub async fn report_start(
        &self,
        item_id: &str,
        media_source_id: Option<&str>,
        play_session_id: &str,
        position_ticks: i64,
    ) -> Result<(), String> {
        let body = json!({
            "ItemId": item_id,
            "MediaSourceId": media_source_id,
            "PlaySessionId": play_session_id,
            "PlayMethod": "DirectPlay",
            "CanSeek": true,
            "IsPaused": false,
            "IsMuted": false,
            "PositionTicks": position_ticks,
            "VolumeLevel": 100,
        });
        self.post_json("/Sessions/Playing", &body).await
    }

    pub async fn report_progress(
        &self,
        item_id: &str,
        media_source_id: Option<&str>,
        play_session_id: &str,
        position_ticks: i64,
        paused: bool,
        volume: i32,
        muted: bool,
    ) -> Result<(), String> {
        let body = json!({
            "ItemId": item_id,
            "MediaSourceId": media_source_id,
            "PlaySessionId": play_session_id,
            "PlayMethod": "DirectPlay",
            "CanSeek": true,
            "IsPaused": paused,
            "IsMuted": muted,
            "PositionTicks": position_ticks,
            "VolumeLevel": volume,
            "EventName": "TimeUpdate",
        });
        self.post_json("/Sessions/Playing/Progress", &body).await
    }

    pub async fn report_stop(
        &self,
        item_id: &str,
        media_source_id: Option<&str>,
        play_session_id: &str,
        position_ticks: i64,
    ) -> Result<(), String> {
        let body = json!({
            "ItemId": item_id,
            "MediaSourceId": media_source_id,
            "PlaySessionId": play_session_id,
            "PositionTicks": position_ticks,
        });
        self.post_json("/Sessions/Playing/Stopped", &body).await
    }

    /// Newest additions ordered by date added. Uses `/Items` instead of `/Items/Latest`:
    /// the Latest endpoint hides played items by default (a per-user server setting) and
    /// groups results, so the row barely changed and did not reflect what was really added.
    /// Series sort by the date their newest episode arrived.
    async fn latest_items(
        &self,
        session: &Session,
        fields: &str,
        item_type: &str,
        parent: &str,
    ) -> Result<Vec<Movie>, String> {
        let sort = if item_type == "Series" {
            "DateLastContentAdded,DateCreated,SortName"
        } else {
            "DateCreated,SortName"
        };
        self.items_query(&format!(
            "/Users/{}/Items?IncludeItemTypes={item_type}&Recursive=true&SortBy={sort}&SortOrder=Descending&Limit=18&Fields={fields}&EnableImageTypes=Primary,Backdrop,Logo{parent}",
            session.user_id
        ))
        .await
    }

    async fn genre_rows(
        &self,
        session: &Session,
        fields: &str,
        item_type: &str,
        parent: &str,
    ) -> Result<Vec<GenreRow>, String> {
        let res = self
            .get(&format!(
                "/Genres?IncludeItemTypes={item_type}&UserId={}&Recursive=true&SortBy=SortName{parent}",
                session.user_id
            ))
            .await?;
        if !res.status().is_success() {
            return Ok(vec![]);
        }
        let value: Value = res.json().await.map_err(|e| e.to_string())?;
        let genres: Vec<(String, String)> = value
            .get("Items")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
            .filter_map(|g| {
                let id = g.get("Id")?.as_str()?.to_string();
                let name = g.get("Name")?.as_str()?.to_string();
                Some((id, name))
            })
            .take(6)
            .collect();

        let mut rows = Vec::new();
        for (id, name) in genres {
            let items = self
                .items_query(&format!(
                    "/Users/{}/Items?GenreIds={id}&IncludeItemTypes={item_type}&Recursive=true&Limit=18&SortBy=CommunityRating,SortName&SortOrder=Descending&Fields={fields}{parent}",
                    session.user_id
                ))
                .await
                .unwrap_or_default();
            if !items.is_empty() {
                rows.push(GenreRow { id, name, items });
            }
        }
        Ok(rows)
    }

    async fn items_query(&self, path: &str) -> Result<Vec<Movie>, String> {
        let session = self.require_session().await?;
        let res = self.get(path).await?;
        if !res.status().is_success() {
            return Err(format!("Jellyfin {}: {}", path, res.status()));
        }
        let value: Value = res.json().await.map_err(|e| e.to_string())?;
        let items = value
            .get("Items")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        items.iter().map(|v| self.map_item(&session, v)).collect()
    }

    fn map_item(&self, session: &Session, value: &Value) -> Result<Movie, String> {
        let id = value
            .get("Id")
            .and_then(|v| v.as_str())
            .ok_or("Ítem sin id")?
            .to_string();
        let image_tags = value
            .get("ImageTags")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();
        let backdrop_tags = value
            .get("BackdropImageTags")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let user_data = value.get("UserData");
        let streams = value
            .get("MediaStreams")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let sources = value
            .get("MediaSources")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let media_sources: Vec<MediaSourceInfo> = sources
            .iter()
            .filter_map(|s| {
                let id = s.get("Id")?.as_str()?.to_string();
                let container = s
                    .get("Container")
                    .and_then(|v| v.as_str())
                    .filter(|c| !c.is_empty())
                    .unwrap_or("mkv")
                    .to_string();
                let name = s
                    .get("Name")
                    .and_then(|v| v.as_str())
                    .filter(|n| !n.is_empty())
                    .map(|n| n.to_string())
                    .unwrap_or_else(|| container.to_uppercase());
                Some(MediaSourceInfo { id, name, container })
            })
            .collect();
        let media_source_id = media_sources.first().map(|s| s.id.clone());
        let container = media_sources
            .first()
            .map(|s| s.container.as_str())
            .unwrap_or("mkv");

        let people = value
            .get("People")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let names_of = |kind: &str| -> Vec<String> {
            people
                .iter()
                .filter(|p| p.get("Type").and_then(|v| v.as_str()) == Some(kind))
                .filter_map(|p| p.get("Name")?.as_str().map(|s| s.to_string()))
                .collect()
        };
        let directors = names_of("Director");
        let writers = names_of("Writer");
        let cast: Vec<Person> = people
            .iter()
            .filter(|p| p.get("Type").and_then(|v| v.as_str()) == Some("Actor"))
            .filter_map(|p| {
                let person_id = p.get("Id")?.as_str()?.to_string();
                let name = p.get("Name")?.as_str()?.to_string();
                let tag = p.get("PrimaryImageTag").and_then(|v| v.as_str()).filter(|t| !t.is_empty());
                // Only when the person has a picture: avoids 404 spam through the image proxy.
                let image_url = tag.and_then(|tag| image_url(session, &person_id, "Primary", 240, Some(tag)));
                Some(Person {
                    id: person_id,
                    name,
                    role: p
                        .get("Role")
                        .and_then(|v| v.as_str())
                        .filter(|r| !r.is_empty())
                        .map(|r| r.to_string()),
                    kind: "Actor".to_string(),
                    image_url,
                })
            })
            .take(20)
            .collect();
        let studios = value
            .get("Studios")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
            .filter_map(|s| s.get("Name")?.as_str().map(|n| n.to_string()))
            .collect();
        let provider_ids: BTreeMap<String, String> = value
            .get("ProviderIds")
            .and_then(|v| v.as_object())
            .into_iter()
            .flatten()
            .filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string())))
            .collect();
        let remote_trailers = value
            .get("RemoteTrailers")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
            .filter_map(|t| t.get("Url")?.as_str().map(|u| u.to_string()))
            .collect();

        let (badges, video_label, audio_label, subtitle_labels) = quality_from_streams(&streams);
        let trickplay = parse_trickplay(value.get("Trickplay"), media_source_id.as_deref());
        let chapters = parse_chapters(value.get("Chapters"));

        let kind = value
            .get("Type")
            .and_then(|v| v.as_str())
            .unwrap_or("Movie")
            .to_string();
        let is_episode = kind == "Episode";
        let text = |name: &str| value.get(name).and_then(|v| v.as_str()).map(|s| s.to_string());
        let number = |name: &str| value.get(name).and_then(|v| v.as_i64()).map(|n| n as i32);
        let series_id = text("SeriesId");
        let primary_tag = image_tags.get("Primary").and_then(|v| v.as_str());
        // Episodes: the series poster stands in as "poster"; their own Primary is a 16:9 still.
        let poster_url = match (is_episode, &series_id, text("SeriesPrimaryImageTag")) {
            (true, Some(sid), Some(tag)) => image_url(session, sid, "Primary", 400, Some(&tag)),
            (true, _, _) => None,
            _ => image_url(session, &id, "Primary", 400, primary_tag),
        };
        let thumb_url = if is_episode && primary_tag.is_some() {
            image_url(session, &id, "Primary", 640, primary_tag)
        } else {
            None
        };
        let backdrop_url = backdrop_tags
            .first()
            .and_then(|tag| image_url(session, &id, "Backdrop", 1920, tag.as_str()))
            .or_else(|| {
                let parent_id = text("ParentBackdropItemId")?;
                let tags = value.get("ParentBackdropImageTags")?.as_array()?;
                let tag = tags.first()?.as_str()?;
                image_url(session, &parent_id, "Backdrop", 1920, Some(tag))
            });
        let logo_url = image_url(session, &id, "Logo", 600, image_tags.get("Logo").and_then(|v| v.as_str()))
            .or_else(|| {
                let parent_id = text("ParentLogoItemId")?;
                let tag = text("ParentLogoImageTag")?;
                image_url(session, &parent_id, "Logo", 600, Some(&tag))
            });

        Ok(Movie {
            trickplay,
            chapters,
            series_name: text("SeriesName"),
            season_id: text("SeasonId"),
            season_number: if is_episode {
                number("ParentIndexNumber")
            } else if kind == "Season" {
                number("IndexNumber")
            } else {
                None
            },
            episode_number: if is_episode { number("IndexNumber") } else { None },
            series_id,
            kind,
            thumb_url,
            date_created: text("DateCreated"),
            poster_url,
            backdrop_url,
            logo_url,
            stream_url: format!(
                "{}/Videos/{id}/stream.{container}?static=true",
                session.server_url
            ),
            media_source_id,
            name: value
                .get("Name")
                .and_then(|v| v.as_str())
                .unwrap_or("Sin título")
                .to_string(),
            overview: value
                .get("Overview")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            year: value
                .get("ProductionYear")
                .and_then(|v| v.as_i64())
                .map(|y| y as i32),
            runtime_ticks: value.get("RunTimeTicks").and_then(|v| v.as_i64()),
            official_rating: value
                .get("OfficialRating")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            community_rating: value
                .get("CommunityRating")
                .and_then(|v| v.as_f64())
                .map(|n| n as f32),
            critic_rating: value
                .get("CriticRating")
                .and_then(|v| v.as_f64())
                .map(|n| n as f32),
            genres: value
                .get("Genres")
                .and_then(|v| v.as_array())
                .into_iter()
                .flatten()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect(),
            playback_position_ticks: user_data
                .and_then(|u| u.get("PlaybackPositionTicks"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0),
            played_percentage: user_data
                .and_then(|u| u.get("PlayedPercentage"))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0),
            favorite: user_data
                .and_then(|u| u.get("IsFavorite"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            played: user_data
                .and_then(|u| u.get("Played"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            unplayed_count: user_data
                .and_then(|u| u.get("UnplayedItemCount"))
                .and_then(|v| v.as_i64())
                .map(|n| n as i32),
            badges,
            video_label,
            audio_label,
            subtitle_labels,
            directors,
            writers,
            studios,
            cast,
            provider_ids,
            remote_trailers,
            child_count: number("ChildCount"),
            status: text("Status"),
            tagline: value
                .get("Taglines")
                .and_then(|v| v.as_array())
                .and_then(|list| list.first())
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string()),
            end_year: text("EndDate")
                .and_then(|date| date.get(0..4).and_then(|y| y.parse::<i32>().ok())),
            media_sources,
            id,
        })
    }

    async fn get(&self, path: &str) -> Result<reqwest::Response, String> {
        let session = self.require_session().await?;
        let url = format!("{}{path}", session.server_url);
        self.client_for(&url)
            .get(&url)
            .headers(auth_headers(&session.device_id, Some(&session.token)))
            .send()
            .await
            .map_err(|e| format!("Error de red: {e}"))
    }

    /// Body-less request (POST/DELETE toggles). Returns the raw response.
    async fn send_empty(
        &self,
        method: reqwest::Method,
        path: &str,
    ) -> Result<reqwest::Response, String> {
        let session = self.require_session().await?;
        let url = format!("{}{path}", session.server_url);
        self.client_for(&url)
            .request(method, &url)
            .headers(auth_headers(&session.device_id, Some(&session.token)))
            .header(reqwest::header::CONTENT_LENGTH, "0")
            .send()
            .await
            .map_err(|e| format!("Error de red: {e}"))
    }

    async fn post_json(&self, path: &str, body: &Value) -> Result<(), String> {
        let session = self.require_session().await?;
        let url = format!("{}{path}", session.server_url);
        let res = self
            .client_for(&url)
            .post(&url)
            .headers(auth_headers(&session.device_id, Some(&session.token)))
            .json(body)
            .send()
            .await
            .map_err(|e| format!("Error de red: {e}"))?;
        if res.status().is_success() || res.status().as_u16() == 204 {
            Ok(())
        } else {
            Err(format!("Jellyfin {path}: {}", res.status()))
        }
    }
}

/// Pseudo-random value fixed for the lifetime of the process (hero rotation).
fn launch_seed() -> u64 {
    static SEED: std::sync::OnceLock<u64> = std::sync::OnceLock::new();
    *SEED.get_or_init(|| {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);
        nanos ^ (std::process::id() as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15)
    })
}

fn item_fields() -> &'static str {
    "Overview,Genres,MediaStreams,MediaSources,ProductionYear,RunTimeTicks,OfficialRating,CommunityRating,CriticRating,People,ImageTags,BackdropImageTags,DateCreated,Studios,ProviderIds,RemoteTrailers,ChildCount,Status,Taglines,EndDate"
}

/// Fields for a single item: adds trickplay tiles and chapters (used by the player timeline).
fn detail_fields() -> String {
    format!("{},Trickplay,Chapters", item_fields())
}

fn parse_trickplay(value: Option<&Value>, media_source_id: Option<&str>) -> Option<TrickplayInfo> {
    let map = value?.as_object()?;
    if map.is_empty() {
        return None;
    }
    let (key, levels) = media_source_id
        .and_then(|id| map.get(id).map(|v| (id.to_string(), v)))
        .or_else(|| map.iter().next().map(|(k, v)| (k.clone(), v)))?;
    let levels = levels.as_object()?;
    let num = |v: &Value, name: &str| v.get(name).and_then(|n| n.as_u64()).unwrap_or(0) as u32;
    let mut parsed: Vec<TrickplayLevel> = levels
        .values()
        .filter_map(|level| {
            let info = TrickplayLevel {
                width: num(level, "Width"),
                height: num(level, "Height"),
                tile_width: num(level, "TileWidth"),
                tile_height: num(level, "TileHeight"),
                thumbnail_count: num(level, "ThumbnailCount"),
                interval: num(level, "Interval"),
                bandwidth: num(level, "Bandwidth"),
            };
            let valid = info.width > 0
                && info.height > 0
                && info.tile_width > 0
                && info.tile_height > 0
                && info.thumbnail_count > 0
                && info.interval > 0;
            valid.then_some(info)
        })
        .collect();
    if parsed.is_empty() {
        return None;
    }
    parsed.sort_by_key(|l| l.width);
    Some(TrickplayInfo {
        media_source_id: key,
        levels: parsed,
    })
}

fn parse_chapters(value: Option<&Value>) -> Vec<Chapter> {
    let Some(list) = value.and_then(|v| v.as_array()) else {
        return vec![];
    };
    list.iter()
        .enumerate()
        .map(|(index, chapter)| Chapter {
            index: index as u32,
            start_seconds: chapter
                .get("StartPositionTicks")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0)
                / 10_000_000.0,
            name: chapter
                .get("Name")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string()),
            image_tag: chapter
                .get("ImageTag")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string()),
        })
        .collect()
}

fn user_image_url(user_id: &str, tag: Option<&str>) -> String {
    match tag.filter(|t| !t.is_empty()) {
        Some(tag) => format!("{IMAGE_ORIGIN}/Users/{user_id}/Images/Primary?tag={tag}&quality=90"),
        None => format!("{IMAGE_ORIGIN}/Users/{user_id}/Images/Primary?quality=90"),
    }
}

fn map_public_user(user: &Value, server_url: &str) -> Option<PublicUser> {
    let id = user.get("Id")?.as_str()?.to_string();
    let name = user.get("Name")?.as_str()?.to_string();
    let has_password = user
        .get("HasPassword")
        .and_then(|v| v.as_bool())
        .or_else(|| user.get("HasConfiguredPassword").and_then(|v| v.as_bool()))
        .unwrap_or(true);
    let avatar_url = user
        .get("PrimaryImageTag")
        .and_then(|v| v.as_str())
        .filter(|tag| !tag.is_empty())
        .map(|tag| format!("{server_url}/Users/{id}/Images/Primary?tag={tag}&quality=90"))
        .or_else(|| Some(format!("{server_url}/Users/{id}/Images/Primary?quality=90")));
    Some(PublicUser {
        id,
        name,
        has_password,
        avatar_url,
    })
}

pub fn valid_item_id(id: &str) -> bool {
    let id = id.trim();
    (8..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

pub fn normalize_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() || trimmed.len() > 2048 {
        return Err("URL no válida".into());
    }
    let mut u = trimmed.trim_end_matches('/').to_string();
    if !u.starts_with("http://") && !u.starts_with("https://") {
        if u.contains("://") {
            return Err("Solo se permiten URLs http o https".into());
        }
        u = format!("http://{u}");
    }
    if !u.starts_with("http://") && !u.starts_with("https://") {
        return Err("Solo se permiten URLs http o https".into());
    }
    if has_userinfo(&u) {
        return Err("La URL no debe incluir usuario ni contraseña".into());
    }
    if host_of(&u).is_none() {
        return Err("URL no válida".into());
    }
    Ok(u)
}

fn has_userinfo(url: &str) -> bool {
    let Some((_, rest)) = url.split_once("://") else {
        return false;
    };
    rest.split('/').next().unwrap_or("").contains('@')
}

fn host_of(url: &str) -> Option<String> {
    let rest = url.split_once("://")?.1;
    let authority = rest.split('/').next().unwrap_or("");
    let host = if let Some(inner) = authority.strip_prefix('[') {
        inner.split(']').next()?.to_string()
    } else {
        authority.split(':').next()?.to_string()
    };
    if host.is_empty() {
        None
    } else {
        Some(host)
    }
}

fn allows_insecure_tls(url: &str) -> bool {
    let Some(host) = host_of(url) else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    if host == "localhost" || host == "::1" || host.ends_with(".local") {
        return true;
    }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        return match ip {
            std::net::IpAddr::V4(v) => v.is_loopback() || v.is_private() || v.is_link_local(),
            std::net::IpAddr::V6(v) => v.is_loopback() || is_unique_local_v6(v),
        };
    }
    false
}

fn is_unique_local_v6(ip: std::net::Ipv6Addr) -> bool {
    let segments = ip.octets();
    segments[0] & 0xfe == 0xfc
}

pub fn allowed_image_path(path: &str) -> bool {
    let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    match parts.as_slice() {
        ["Items", id, "Images", kind]
            if valid_item_id(id)
                && matches!(*kind, "Primary" | "Logo" | "Thumb" | "Banner" | "Art" | "Disc") =>
        {
            true
        }
        ["Items", id, "Images", "Backdrop", "0"] if valid_item_id(id) => true,
        ["Items", id, "Images", "Chapter", index] if valid_item_id(id) && is_small_number(index) => {
            true
        }
        ["Videos", id, "Trickplay", width, file]
            if valid_item_id(id)
                && is_small_number(width)
                && file.strip_suffix(".jpg").is_some_and(is_small_number) =>
        {
            true
        }
        ["Users", id, "Images", "Primary"] if valid_item_id(id) => true,
        _ => false,
    }
}

fn is_small_number(s: &str) -> bool {
    !s.is_empty() && s.len() <= 6 && s.bytes().all(|b| b.is_ascii_digit())
}

pub fn sanitize_image_query(query: Option<&str>) -> String {
    let mut kept = Vec::new();
    for pair in query.unwrap_or("").split('&').filter(|p| !p.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if matches!(
            key,
            "maxWidth" | "maxHeight" | "quality" | "tag" | "fillWidth" | "fillHeight" | "mediaSourceId"
        ) && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            kept.push(format!("{key}={value}"));
        }
    }
    kept.join("&")
}

fn auth_headers(device_id: &str, token: Option<&str>) -> HeaderMap {
    let mut headers = HeaderMap::new();
    let token_part = token
        .map(|t| format!(", Token=\"{t}\""))
        .unwrap_or_default();
    let value = format!(
        "MediaBrowser Client=\"{CLIENT_NAME}\", Device=\"{DEVICE_NAME}\", DeviceId=\"{device_id}\", Version=\"{CLIENT_VERSION}\"{token_part}"
    );
    if let Ok(v) = HeaderValue::from_str(&value) {
        headers.insert(AUTHORIZATION, v.clone());
        headers.insert("X-Emby-Authorization", v);
    }
    if let Some(token) = token {
        if let Ok(v) = HeaderValue::from_str(token) {
            headers.insert("X-Emby-Token", v);
        }
    }
    headers
}

fn image_url(
    _session: &Session,
    id: &str,
    kind: &str,
    max_width: u32,
    tag: Option<&str>,
) -> Option<String> {
    if kind != "Primary" && tag.is_none() {
        return None;
    }
    let path = if kind == "Backdrop" {
        format!("/Items/{id}/Images/Backdrop/0")
    } else {
        format!("/Items/{id}/Images/{kind}")
    };
    let mut url = format!("{IMAGE_ORIGIN}{path}?maxWidth={max_width}&quality=90");
    if let Some(tag) = tag {
        url.push_str(&format!("&tag={tag}"));
    }
    Some(url)
}

fn quality_from_streams(streams: &[Value]) -> (Vec<String>, Option<String>, Option<String>, Vec<String>) {
    let mut badges = Vec::new();
    let mut video_label = None;
    let mut audio_label = None;
    let mut subtitle_labels = Vec::new();

    for stream in streams {
        let kind = stream.get("Type").and_then(|v| v.as_str()).unwrap_or("");
        match kind {
            "Video" => {
                let width = stream.get("Width").and_then(|v| v.as_i64()).unwrap_or(0);
                let height = stream.get("Height").and_then(|v| v.as_i64()).unwrap_or(0);
                let codec = stream
                    .get("Codec")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_uppercase();
                let profile = stream
                    .get("Profile")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let range = stream
                    .get("VideoRangeType")
                    .and_then(|v| v.as_str())
                    .or_else(|| stream.get("VideoRange").and_then(|v| v.as_str()))
                    .unwrap_or("");
                if width >= 3840 || height >= 2160 {
                    push_unique(&mut badges, "4K");
                } else if width >= 1920 {
                    push_unique(&mut badges, "1080P");
                }
                let range_u = range.to_uppercase();
                if range_u.contains("DOVI") || range_u.contains("DOLBY") {
                    push_unique(&mut badges, "DOLBY VISION");
                } else if range_u.contains("HDR10+") {
                    push_unique(&mut badges, "HDR10+");
                } else if range_u.contains("HDR10") {
                    push_unique(&mut badges, "HDR10");
                } else if range_u.contains("HLG") {
                    push_unique(&mut badges, "HLG");
                } else if range_u.contains("HDR") {
                    push_unique(&mut badges, "HDR");
                }
                video_label = Some(format!(
                    "{width}×{height} {codec}{profile}{hdr}",
                    profile = if profile.is_empty() {
                        String::new()
                    } else {
                        format!(" {profile}")
                    },
                    hdr = if range.is_empty() {
                        String::new()
                    } else {
                        format!(" · {range}")
                    }
                ));
            }
            "Audio" => {
                let codec = stream.get("Codec").and_then(|v| v.as_str()).unwrap_or("");
                let title = stream
                    .get("DisplayTitle")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let layout = stream
                    .get("ChannelLayout")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let channels = stream.get("Channels").and_then(|v| v.as_i64()).unwrap_or(0);
                let blob = format!("{codec} {title} {layout}").to_lowercase();
                if blob.contains("atmos") {
                    push_unique(&mut badges, "ATMOS");
                }
                if layout.contains("7.1") || channels >= 8 {
                    push_unique(&mut badges, "7.1");
                } else if layout.contains("5.1") || channels == 6 {
                    push_unique(&mut badges, "5.1");
                }
                if audio_label.is_none() {
                    audio_label = Some(if !title.is_empty() {
                        title.to_string()
                    } else {
                        format!(
                            "{} {}",
                            codec.to_uppercase(),
                            if layout.is_empty() {
                                String::new()
                            } else {
                                layout.to_string()
                            }
                        )
                    });
                }
            }
            "Subtitle" => {
                let title = stream
                    .get("DisplayTitle")
                    .and_then(|v| v.as_str())
                    .or_else(|| stream.get("Language").and_then(|v| v.as_str()))
                    .unwrap_or("Subtítulo");
                subtitle_labels.push(title.to_string());
            }
            _ => {}
        }
    }

    (badges, video_label, audio_label, subtitle_labels)
}

fn push_unique(list: &mut Vec<String>, value: &str) {
    if !list.iter().any(|v| v == value) {
        list.push(value.to_string());
    }
}

pub(crate) fn urlencoding_lite(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
