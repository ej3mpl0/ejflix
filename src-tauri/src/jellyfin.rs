use std::sync::Arc;
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::RwLock;

const CLIENT_NAME: &str = "ejFlix";
const CLIENT_VERSION: &str = "0.1.11";
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
pub struct SessionView {
    pub server_url: String,
    pub user_id: String,
    pub user_name: String,
    pub device_id: String,
    pub avatar_url: Option<String>,
}

impl Session {
    pub fn view(&self) -> SessionView {
        SessionView {
            server_url: self.server_url.clone(),
            user_id: self.user_id.clone(),
            user_name: self.user_name.clone(),
            device_id: self.device_id.clone(),
            avatar_url: self.avatar_url.clone(),
        }
    }
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
pub struct Movie {
    pub id: String,
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
    pub badges: Vec<String>,
    pub video_label: Option<String>,
    pub audio_label: Option<String>,
    pub subtitle_labels: Vec<String>,
    pub directors: Vec<String>,
    pub cast: Vec<String>,
    pub kind: String,
    pub series_id: Option<String>,
    pub series_name: Option<String>,
    pub season_id: Option<String>,
    pub season_number: Option<i32>,
    pub episode_number: Option<i32>,
    pub child_count: Option<i32>,
    pub played: bool,
    #[serde(skip_serializing)]
    pub stream_url: String,
    pub media_source_id: Option<String>,
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
    pub featured: Option<Movie>,
    pub resume: Vec<Movie>,
    pub latest: Vec<Movie>,
    pub latest_series: Vec<Movie>,
    pub next_up: Vec<Movie>,
    pub genres: Vec<GenreRow>,
    pub all: Vec<Movie>,
    pub series: Vec<Movie>,
}

#[derive(Clone)]
pub struct JellyfinClient {
    http: reqwest::Client,
    http_local: reqwest::Client,
    session: Arc<RwLock<Option<Session>>>,
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

    pub async fn home(&self) -> Result<HomeData, String> {
        let session = self.require_session().await?;
        let fields = item_fields();
        let resume_path = format!(
            "/Users/{}/Items/Resume?IncludeItemTypes=Movie,Episode&Limit=16&Fields={fields}",
            session.user_id
        );
        let all_path = format!(
            "/Users/{}/Items?IncludeItemTypes=Movie&Recursive=true&SortBy=SortName&SortOrder=Ascending&Limit=80&Fields={fields}&EnableImageTypes=Primary,Backdrop,Logo",
            session.user_id
        );
        let series_path = format!(
            "/Users/{}/Items?IncludeItemTypes=Series&Recursive=true&SortBy=SortName&SortOrder=Ascending&Limit=80&Fields={fields}&EnableImageTypes=Primary,Backdrop,Logo",
            session.user_id
        );
        let next_up_path = format!(
            "/Shows/NextUp?UserId={}&Limit=16&Fields={fields}&EnableImageTypes=Primary,Backdrop,Thumb,Logo",
            session.user_id
        );
        let (resume, latest, latest_series, all, series, next_up, genres) = tokio::try_join!(
            self.items_query(&resume_path),
            self.latest_items(&session, fields, "Movie", 18),
            self.latest_items(&session, fields, "Series", 18),
            self.items_query(&all_path),
            self.items_query(&series_path),
            self.items_query(&next_up_path),
            self.genre_rows(&session, fields),
        )?;

        let featured = latest
            .iter()
            .find(|m| m.backdrop_url.is_some())
            .cloned()
            .or_else(|| latest_series.iter().find(|m| m.backdrop_url.is_some()).cloned())
            .or_else(|| all.iter().find(|m| m.backdrop_url.is_some()).cloned())
            .or_else(|| series.iter().find(|m| m.backdrop_url.is_some()).cloned())
            .or_else(|| latest.first().cloned())
            .or_else(|| latest_series.first().cloned())
            .or_else(|| all.first().cloned())
            .or_else(|| series.first().cloned());

        Ok(HomeData {
            featured,
            resume,
            latest,
            latest_series,
            next_up,
            genres,
            all,
            series,
        })
    }

    pub async fn get_item(&self, id: &str) -> Result<Movie, String> {
        if !valid_item_id(id) {
            return Err("Ítem no válido".into());
        }
        let session = self.require_session().await?;
        let fields = item_fields();
        let res = self
            .get(&format!(
                "/Users/{}/Items/{id}?Fields={fields}",
                session.user_id
            ))
            .await?;
        if !res.status().is_success() {
            return Err("No se encontró el título".into());
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
            "/Users/{}/Items?SearchTerm={q}&IncludeItemTypes=Movie,Series,Episode&Recursive=true&Limit=48&Fields={fields}",
            session.user_id
        ))
        .await
    }

    pub async fn get_seasons(&self, series_id: &str) -> Result<Vec<Movie>, String> {
        if !valid_item_id(series_id) {
            return Err("Ítem no válido".into());
        }
        let session = self.require_session().await?;
        let fields = item_fields();
        self.items_query(&format!(
            "/Shows/{series_id}/Seasons?UserId={}&Fields={fields}&EnableImages=true",
            session.user_id
        ))
        .await
    }

    pub async fn get_episodes(&self, series_id: &str, season_id: Option<&str>) -> Result<Vec<Movie>, String> {
        if !valid_item_id(series_id) {
            return Err("Ítem no válido".into());
        }
        if let Some(season_id) = season_id {
            if !valid_item_id(season_id) {
                return Err("Ítem no válido".into());
            }
        }
        let session = self.require_session().await?;
        let fields = item_fields();
        let season = season_id
            .map(|id| format!("&SeasonId={id}"))
            .unwrap_or_default();
        self.items_query(&format!(
            "/Shows/{series_id}/Episodes?UserId={}&Fields={fields}&EnableImageTypes=Primary,Backdrop,Thumb{season}",
            session.user_id
        ))
        .await
    }

    pub async fn resolve_playable(&self, id: &str) -> Result<Movie, String> {
        let item = self.get_item(id).await?;
        match item.kind.as_str() {
            "Movie" | "Episode" => Ok(item),
            "Series" => self.playable_for_series(&item.id).await,
            "Season" => {
                let series_id = item
                    .series_id
                    .clone()
                    .ok_or_else(|| "Temporada sin serie".to_string())?;
                let episodes = self.get_episodes(&series_id, Some(&item.id)).await?;
                episodes
                    .iter()
                    .find(|ep| !ep.played)
                    .cloned()
                    .or_else(|| episodes.into_iter().next())
                    .ok_or_else(|| "Esta temporada no tiene capítulos".to_string())
            }
            _ => Err("Este título no se puede reproducir".into()),
        }
    }

    async fn playable_for_series(&self, series_id: &str) -> Result<Movie, String> {
        let session = self.require_session().await?;
        let fields = item_fields();
        let next = self
            .items_query(&format!(
                "/Shows/NextUp?UserId={}&SeriesId={series_id}&Limit=1&Fields={fields}&EnableImageTypes=Primary,Backdrop,Thumb",
                session.user_id
            ))
            .await
            .unwrap_or_default();
        if let Some(ep) = next.into_iter().next() {
            return Ok(ep);
        }
        let seasons = self.get_seasons(series_id).await?;
        for season in seasons {
            let episodes = self.get_episodes(series_id, Some(&season.id)).await?;
            if let Some(ep) = episodes.iter().find(|ep| !ep.played).cloned() {
                return Ok(ep);
            }
            if let Some(ep) = episodes.into_iter().next() {
                return Ok(ep);
            }
        }
        Err("Esta serie no tiene capítulos".into())
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

    async fn latest_items(
        &self,
        session: &Session,
        fields: &str,
        item_type: &str,
        limit: u32,
    ) -> Result<Vec<Movie>, String> {
        let res = self
            .get(&format!(
                "/Users/{}/Items/Latest?IncludeItemTypes={item_type}&Limit={limit}&Fields={fields}&EnableImageTypes=Primary,Backdrop,Logo",
                session.user_id
            ))
            .await?;
        if !res.status().is_success() {
            return Err(format!("Jellyfin Latest {item_type}: {}", res.status()));
        }
        let value: Value = res.json().await.map_err(|e| e.to_string())?;
        let items = if value.is_array() {
            value.as_array().cloned().unwrap_or_default()
        } else {
            value
                .get("Items")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default()
        };
        items.iter().map(|v| self.map_item(&session, v)).collect()
    }

    async fn genre_rows(&self, session: &Session, fields: &str) -> Result<Vec<GenreRow>, String> {
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
                    "/Users/{}/Items?GenreIds={id}&IncludeItemTypes=Movie,Series&Recursive=true&Limit=18&SortBy=CommunityRating,SortName&SortOrder=Descending&Fields={fields}",
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
        let media_source_id = sources
            .first()
            .and_then(|s| s.get("Id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let container = sources
            .first()
            .and_then(|s| s.get("Container"))
            .and_then(|v| v.as_str())
            .unwrap_or("mkv");

        let people = value
            .get("People")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let directors = people
            .iter()
            .filter(|p| p.get("Type").and_then(|v| v.as_str()) == Some("Director"))
            .filter_map(|p| p.get("Name")?.as_str().map(|s| s.to_string()))
            .collect();
        let cast = people
            .iter()
            .filter(|p| p.get("Type").and_then(|v| v.as_str()) == Some("Actor"))
            .filter_map(|p| p.get("Name")?.as_str().map(|s| s.to_string()))
            .take(8)
            .collect();

        let (badges, video_label, audio_label, subtitle_labels) = quality_from_streams(&streams);

        Ok(Movie {
            poster_url: image_url(
                session,
                &id,
                "Primary",
                400,
                image_tags.get("Primary").and_then(|v| v.as_str()),
            ),
            backdrop_url: backdrop_tags
                .first()
                .and_then(|tag| image_url(session, &id, "Backdrop", 1920, tag.as_str()))
                .or_else(|| {
                    let parent_id = value
                        .get("ParentBackdropItemId")
                        .and_then(|v| v.as_str())
                        .or_else(|| value.get("SeriesId").and_then(|v| v.as_str()))?;
                    let tag = value
                        .get("ParentBackdropImageTags")
                        .and_then(|v| v.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|v| v.as_str());
                    image_url(session, parent_id, "Backdrop", 1920, tag)
                }),
            logo_url: image_url(
                session,
                &id,
                "Logo",
                600,
                image_tags.get("Logo").and_then(|v| v.as_str()),
            ),
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
            badges,
            video_label,
            audio_label,
            subtitle_labels,
            directors,
            cast,
            kind: value
                .get("Type")
                .and_then(|v| v.as_str())
                .unwrap_or("Movie")
                .to_string(),
            series_id: value
                .get("SeriesId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            series_name: value
                .get("SeriesName")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            season_id: value
                .get("SeasonId")
                .and_then(|v| v.as_str())
                .or_else(|| {
                    let kind = value.get("Type").and_then(|v| v.as_str()).unwrap_or("");
                    if kind == "Episode" {
                        value.get("ParentId").and_then(|v| v.as_str())
                    } else {
                        None
                    }
                })
                .map(|s| s.to_string()),
            season_number: {
                let kind = value.get("Type").and_then(|v| v.as_str()).unwrap_or("");
                if kind == "Season" {
                    value
                        .get("IndexNumber")
                        .and_then(|v| v.as_i64())
                        .map(|n| n as i32)
                } else {
                    value
                        .get("ParentIndexNumber")
                        .and_then(|v| v.as_i64())
                        .map(|n| n as i32)
                }
            },
            episode_number: {
                let kind = value.get("Type").and_then(|v| v.as_str()).unwrap_or("");
                if kind == "Episode" {
                    value
                        .get("IndexNumber")
                        .and_then(|v| v.as_i64())
                        .map(|n| n as i32)
                } else {
                    None
                }
            },
            child_count: value
                .get("ChildCount")
                .and_then(|v| v.as_i64())
                .or_else(|| value.get("RecursiveItemCount").and_then(|v| v.as_i64()))
                .map(|n| n as i32),
            played: user_data
                .and_then(|u| u.get("Played"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
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

fn item_fields() -> &'static str {
    "Overview,Genres,MediaStreams,MediaSources,ProductionYear,RunTimeTicks,OfficialRating,CommunityRating,CriticRating,People,ImageTags,BackdropImageTags,ChildCount,RecursiveItemCount,SeriesStatus,SeriesName,ParentIndexNumber,IndexNumber,SeriesId,ParentId,ParentBackdropImageTags,ParentBackdropItemId,SeriesPrimaryImageTag"
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
        ["Users", id, "Images", "Primary"] if valid_item_id(id) => true,
        _ => false,
    }
}

pub fn sanitize_image_query(query: Option<&str>) -> String {
    let mut kept = Vec::new();
    for pair in query.unwrap_or("").split('&').filter(|p| !p.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if matches!(
            key,
            "maxWidth" | "maxHeight" | "quality" | "tag" | "fillWidth" | "fillHeight"
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

fn urlencoding_lite(s: &str) -> String {
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
