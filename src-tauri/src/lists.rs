//! Custom lists of a profile ("Weekend films", "For the kids"...) besides "My list", and
//! the moment the user last looked at the calendar (what counts as a new episode).
//!
//! A list holds Jellyfin items and online titles alike: each entry keeps enough of the
//! title to draw its card, and the Jellyfin id or the Stremio ids to open and play it.
//! Everything lives in the store per profile and travels with the account inside the
//! "lists" document (see `account.rs`).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri_plugin_store::StoreExt;

use crate::addons::now_ms;

const MAX_LISTS: usize = 50;
const MAX_ITEMS: usize = 300;
const MAX_NAME: usize = 60;
/// Marks a custom list inside the account's "lists" document, whose other items are
/// the online titles of "My list".
pub const SYNC_MARKER: &str = "customList";
const SYNC_PREFIX: &str = "customList:";

/// One title in a custom list.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ListItem {
    /// "jf:<item id>" for a Jellyfin item, the Stremio video id for an online title.
    pub key: String,
    /// "jellyfin" | "online"
    pub source: String,
    /// Jellyfin: "Movie" | "Series" | "Episode"; online: "movie" | "series".
    #[serde(rename = "type")]
    pub kind: String,
    pub item_id: Option<String>,
    pub meta_id: Option<String>,
    pub name: String,
    pub series_name: Option<String>,
    pub poster: Option<String>,
    pub year: Option<i32>,
    pub season: Option<i32>,
    pub episode: Option<i32>,
    pub imdb: Option<String>,
    pub added_ms: u64,
}

impl Default for ListItem {
    fn default() -> Self {
        Self {
            key: String::new(),
            source: "online".into(),
            kind: "movie".into(),
            item_id: None,
            meta_id: None,
            name: String::new(),
            series_name: None,
            poster: None,
            year: None,
            season: None,
            episode: None,
            imdb: None,
            added_ms: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CustomList {
    pub id: String,
    pub name: String,
    /// Newest first.
    pub items: Vec<ListItem>,
    pub created_ms: u64,
    pub updated_ms: u64,
}

fn lists_key(user_id: &str) -> String {
    format!("customLists.{user_id}")
}

fn seen_key(user_id: &str) -> String {
    format!("calendarSeen.{user_id}")
}

pub fn load(app: &tauri::AppHandle, user_id: &str) -> Vec<CustomList> {
    let Ok(store) = app.store(crate::store_path()) else {
        return vec![];
    };
    store
        .get(lists_key(user_id))
        .and_then(|v| serde_json::from_value::<Vec<CustomList>>(v).ok())
        .unwrap_or_default()
}

/// Saves the lists (oldest first, the order they were created in).
pub fn save(app: &tauri::AppHandle, user_id: &str, mut lists: Vec<CustomList>) -> Result<Vec<CustomList>, String> {
    lists.retain(|l| !l.id.is_empty());
    let mut seen = std::collections::HashSet::new();
    lists.retain(|l| seen.insert(l.id.clone()));
    lists.sort_by(|a, b| a.created_ms.cmp(&b.created_ms).then_with(|| a.id.cmp(&b.id)));
    lists.truncate(MAX_LISTS);
    for list in &mut lists {
        list.items.retain(|i| !i.key.is_empty());
        list.items.truncate(MAX_ITEMS);
    }
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.set(lists_key(user_id), serde_json::to_value(&lists).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())?;
    Ok(lists)
}

fn clean_name(name: &str) -> Result<String, String> {
    let name: String = name.trim().chars().take(MAX_NAME).collect();
    if name.is_empty() {
        return Err("La lista necesita un nombre".into());
    }
    Ok(name)
}

pub fn create(app: &tauri::AppHandle, user_id: &str, name: &str) -> Result<Vec<CustomList>, String> {
    let name = clean_name(name)?;
    let mut lists = load(app, user_id);
    if lists.len() >= MAX_LISTS {
        return Err("Has llegado al máximo de listas".into());
    }
    let now = now_ms();
    lists.push(CustomList {
        id: uuid::Uuid::new_v4().simple().to_string(),
        name,
        items: vec![],
        created_ms: now,
        updated_ms: now,
    });
    save(app, user_id, lists)
}

pub fn rename(app: &tauri::AppHandle, user_id: &str, id: &str, name: &str) -> Result<Vec<CustomList>, String> {
    let name = clean_name(name)?;
    let mut lists = load(app, user_id);
    let list = lists.iter_mut().find(|l| l.id == id).ok_or("La lista ya no existe")?;
    list.name = name;
    list.updated_ms = now_ms();
    save(app, user_id, lists)
}

pub fn delete(app: &tauri::AppHandle, user_id: &str, id: &str) -> Result<Vec<CustomList>, String> {
    let mut lists = load(app, user_id);
    lists.retain(|l| l.id != id);
    save(app, user_id, lists)
}

/// Adds (`on`) or removes one title; adding a title that is already there keeps its place.
pub fn set_item(
    app: &tauri::AppHandle,
    user_id: &str,
    id: &str,
    mut item: ListItem,
    on: bool,
) -> Result<Vec<CustomList>, String> {
    if item.key.is_empty() {
        return Err("La entrada no tiene identificador".into());
    }
    let mut lists = load(app, user_id);
    let list = lists.iter_mut().find(|l| l.id == id).ok_or("La lista ya no existe")?;
    let present = list.items.iter().any(|i| i.key == item.key);
    if on && !present {
        if list.items.len() >= MAX_ITEMS {
            return Err("La lista está llena".into());
        }
        item.added_ms = now_ms();
        list.items.insert(0, item);
    } else if !on && present {
        list.items.retain(|i| i.key != item.key);
    } else {
        return Ok(lists);
    }
    list.updated_ms = now_ms();
    save(app, user_id, lists)
}

/// When the calendar was last opened (ms); 0 before the first time.
pub fn calendar_seen(app: &tauri::AppHandle, user_id: &str) -> u64 {
    app.store(crate::store_path())
        .ok()
        .and_then(|store| store.get(seen_key(user_id)))
        .and_then(|v| v.as_u64())
        .unwrap_or(0)
}

pub fn set_calendar_seen(app: &tauri::AppHandle, user_id: &str, ms: u64) -> Result<(), String> {
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.set(seen_key(user_id), json!(ms));
    store.save().map_err(|e| e.to_string())
}

// ---- inside the account's "lists" document ----

/// The lists as items of the account document: an `id` the merge keys them by, the
/// marker, and `updatedMs` for "newest wins". Titles of "My list" carry a `key` and no
/// marker, so older versions of the app skip these items and keep them untouched.
pub fn to_sync_items(lists: &[CustomList]) -> Vec<Value> {
    lists
        .iter()
        .map(|list| {
            let mut value = serde_json::to_value(list).unwrap_or(Value::Null);
            if let Some(map) = value.as_object_mut() {
                map.insert("id".into(), Value::String(format!("{SYNC_PREFIX}{}", list.id)));
                map.insert(SYNC_MARKER.into(), Value::Bool(true));
            }
            value
        })
        .collect()
}

pub fn is_sync_item(item: &Value) -> bool {
    item.get(SYNC_MARKER).and_then(|v| v.as_bool()).unwrap_or(false)
}

/// Lists back from the account document (items that are not lists are ignored).
pub fn from_sync_items(items: &[Value]) -> Vec<CustomList> {
    items
        .iter()
        .filter(|item| is_sync_item(item))
        .filter_map(|item| {
            let mut value = item.clone();
            let map = value.as_object_mut()?;
            let id = map.get("id")?.as_str()?.strip_prefix(SYNC_PREFIX)?.to_string();
            map.insert("id".into(), Value::String(id));
            map.remove(SYNC_MARKER);
            // One entry the app cannot read must not take its whole list with it.
            let items: Vec<ListItem> = map
                .remove("items")
                .and_then(|v| v.as_array().cloned())
                .unwrap_or_default()
                .into_iter()
                .filter_map(|v| serde_json::from_value(v).ok())
                .collect();
            let mut list: CustomList = serde_json::from_value(value).ok()?;
            list.items = items;
            (!list.id.is_empty()).then_some(list)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> CustomList {
        CustomList {
            id: "abc".into(),
            name: "Finde".into(),
            items: vec![
                ListItem { key: "jf:0123456789".into(), source: "jellyfin".into(), kind: "Movie".into(), item_id: Some("0123456789".into()), name: "A".into(), ..ListItem::default() },
                ListItem { key: "tt1".into(), meta_id: Some("tt1".into()), name: "B".into(), ..ListItem::default() },
            ],
            created_ms: 1,
            updated_ms: 2,
        }
    }

    #[test]
    fn lists_round_trip_through_the_account_document() {
        let items = to_sync_items(&[sample()]);
        assert_eq!(items[0]["id"], json!("customList:abc"));
        assert_eq!(items[0]["updatedMs"], json!(2));
        assert!(items[0].get("key").is_none(), "older apps would take it for a saved title");
        let mut doc = items.clone();
        doc.push(json!({ "key": "tt9", "type": "movie", "saved": true, "updatedMs": 3 }));
        assert_eq!(from_sync_items(&doc), vec![sample()]);
    }

    #[test]
    fn an_unreadable_entry_does_not_drop_the_list() {
        let mut items = to_sync_items(&[sample()]);
        items[0]["items"].as_array_mut().unwrap().push(json!({ "key": 5 }));
        assert_eq!(from_sync_items(&items)[0].items.len(), 2);
    }
}
