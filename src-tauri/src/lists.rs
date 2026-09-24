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
/// Top-level field of the "lists" document with the lists deleted lately.
pub const DELETED_FIELD: &str = "deletedLists";
/// How long a deletion is remembered. A PC that stays offline longer than this may
/// bring a deleted list (or title) back, which is the safe way to be wrong.
const TOMBSTONE_TTL_MS: u64 = 90 * 24 * 60 * 60 * 1000;

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
    /// Titles removed lately (key and when), so a sync can tell "removed here" from
    /// "never seen by the other side".
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub removed: Vec<Removed>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Removed {
    pub key: String,
    pub removed_ms: u64,
}

/// A list deleted on some device: the merge drops copies older than this.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Tombstone {
    pub id: String,
    pub deleted_ms: u64,
}

fn lists_key(user_id: &str) -> String {
    format!("customLists.{user_id}")
}

fn seen_key(user_id: &str) -> String {
    format!("calendarSeen.{user_id}")
}

fn deleted_key(user_id: &str) -> String {
    format!("customListsDeleted.{user_id}")
}

/// Lists deleted on this PC (or learnt from the account) in the last days.
pub fn tombstones(app: &tauri::AppHandle, user_id: &str) -> Vec<Tombstone> {
    app.store(crate::store_path())
        .ok()
        .and_then(|store| store.get(deleted_key(user_id)))
        .and_then(|v| serde_json::from_value::<Vec<Tombstone>>(v).ok())
        .unwrap_or_default()
}

pub fn save_tombstones(app: &tauri::AppHandle, user_id: &str, tombs: Vec<Tombstone>) -> Result<(), String> {
    let tombs = merge_tombstones(&tombs, &[], now_ms());
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    if tombs.is_empty() {
        store.delete(deleted_key(user_id));
    } else {
        store.set(deleted_key(user_id), serde_json::to_value(&tombs).map_err(|e| e.to_string())?);
    }
    crate::save_store(&store)
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
    let cutoff = now_ms().saturating_sub(TOMBSTONE_TTL_MS);
    for list in &mut lists {
        list.items.retain(|i| !i.key.is_empty());
        list.items.truncate(MAX_ITEMS);
        list.removed.retain(|r| !r.key.is_empty() && r.removed_ms >= cutoff);
    }
    let store = app.store(crate::store_path()).map_err(|e| e.to_string())?;
    store.set(lists_key(user_id), serde_json::to_value(&lists).map_err(|e| e.to_string())?);
    crate::save_store(&store)?;
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
        removed: vec![],
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
    // Remembered, or the next sync would take the account's copy for a list this PC
    // simply never had and bring it back.
    let mut tombs = tombstones(app, user_id);
    tombs.push(Tombstone { id: id.to_string(), deleted_ms: now_ms() });
    save_tombstones(app, user_id, tombs)?;
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
        list.removed.retain(|r| r.key != item.key);
        list.items.insert(0, item);
    } else if !on && present {
        list.items.retain(|i| i.key != item.key);
        list.removed.retain(|r| r.key != item.key);
        list.removed.push(Removed { key: item.key.clone(), removed_ms: now_ms() });
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
    crate::save_store(&store)
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
            let removed: Vec<Removed> = map
                .remove("removed")
                .and_then(|v| v.as_array().cloned())
                .unwrap_or_default()
                .into_iter()
                .filter_map(|v| serde_json::from_value(v).ok())
                .collect();
            let mut list: CustomList = serde_json::from_value(value).ok()?;
            list.items = items;
            list.removed = removed;
            (!list.id.is_empty()).then_some(list)
        })
        .collect()
}

/// Deleted lists a "lists" document carries.
pub fn tombstones_in(doc: &Value) -> Vec<Tombstone> {
    doc.get(DELETED_FIELD)
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| serde_json::from_value(v.clone()).ok()).collect())
        .unwrap_or_default()
}

/// Both sets of deletions as one: the latest per list, without the expired ones.
pub fn merge_tombstones(a: &[Tombstone], b: &[Tombstone], now: u64) -> Vec<Tombstone> {
    let cutoff = now.saturating_sub(TOMBSTONE_TTL_MS);
    let mut latest: std::collections::HashMap<&str, u64> = std::collections::HashMap::new();
    for t in a.iter().chain(b) {
        if t.id.is_empty() || t.deleted_ms < cutoff {
            continue;
        }
        let ms = latest.entry(t.id.as_str()).or_insert(0);
        *ms = (*ms).max(t.deleted_ms);
    }
    let mut out: Vec<Tombstone> = latest
        .into_iter()
        .map(|(id, deleted_ms)| Tombstone { id: id.to_string(), deleted_ms })
        .collect();
    out.sort_by(|a, b| a.deleted_ms.cmp(&b.deleted_ms).then_with(|| a.id.cmp(&b.id)));
    out
}

/// One list both sides hold: every title either side has stays, unless the other
/// removed it after it was added; the name of the newer copy wins.
fn merge_list(local: &CustomList, server: &CustomList, now: u64) -> CustomList {
    let cutoff = now.saturating_sub(TOMBSTONE_TTL_MS);
    let mut removed: Vec<Removed> = Vec::new();
    for r in local.removed.iter().chain(&server.removed) {
        if r.key.is_empty() || r.removed_ms < cutoff {
            continue;
        }
        match removed.iter_mut().find(|x| x.key == r.key) {
            Some(x) => x.removed_ms = x.removed_ms.max(r.removed_ms),
            None => removed.push(r.clone()),
        }
    }
    let mut seen = std::collections::HashSet::new();
    let mut items: Vec<ListItem> = local
        .items
        .iter()
        .chain(&server.items)
        .filter(|i| seen.insert(i.key.clone()))
        .filter(|i| !removed.iter().any(|r| r.key == i.key && r.removed_ms >= i.added_ms))
        .cloned()
        .collect();
    // Newest first, as the list shows them (stable: ties keep this PC's order).
    items.sort_by(|a, b| b.added_ms.cmp(&a.added_ms));
    // A title added back after its removal needs no tombstone any more.
    removed.retain(|r| !items.iter().any(|i| i.key == r.key));
    let newer = if server.updated_ms > local.updated_ms { server } else { local };
    let created = [local.created_ms, server.created_ms].into_iter().filter(|&t| t > 0).min().unwrap_or(0);
    CustomList {
        id: local.id.clone(),
        name: newer.name.clone(),
        items,
        created_ms: created,
        updated_ms: local.updated_ms.max(server.updated_ms),
        removed,
    }
}

/// Custom lists of the account merged with this PC's. A list only one side has is
/// kept (the other side may simply not know about custom lists: the website, an older
/// version) unless a deletion newer than its last change says otherwise. Returns the
/// lists and the deletions still worth remembering (`tombs` is both sides' already).
pub fn merge_synced(
    server: &[CustomList],
    local: &[CustomList],
    tombs: &[Tombstone],
    now: u64,
) -> (Vec<CustomList>, Vec<Tombstone>) {
    let mut out: Vec<CustomList> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for list in local.iter().chain(server) {
        if !seen.insert(list.id.clone()) {
            continue;
        }
        let l = local.iter().find(|x| x.id == list.id);
        let s = server.iter().find(|x| x.id == list.id);
        let merged = match (l, s) {
            (Some(l), Some(s)) => merge_list(l, s, now),
            (Some(one), None) | (None, Some(one)) => one.clone(),
            (None, None) => continue,
        };
        let deleted = tombs.iter().any(|t| t.id == merged.id && t.deleted_ms >= merged.updated_ms);
        if !deleted {
            out.push(merged);
        }
    }
    // A list changed after it was deleted elsewhere lives on: forget that deletion.
    let tombs = tombs.iter().filter(|t| !out.iter().any(|l| l.id == t.id)).cloned().collect();
    (out, tombs)
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
            removed: vec![],
        }
    }

    fn item(key: &str, added: u64) -> ListItem {
        ListItem { key: key.into(), name: key.into(), added_ms: added, ..ListItem::default() }
    }

    fn keys(list: &CustomList) -> Vec<&str> {
        list.items.iter().map(|i| i.key.as_str()).collect()
    }

    /// Too early for anything in these tests to have expired.
    const NOW: u64 = 1_000;
    const DAY: u64 = 24 * 60 * 60 * 1000;

    #[test]
    fn a_list_the_other_side_does_not_know_is_kept() {
        let (lists, tombs) = merge_synced(&[], &[sample()], &[], NOW);
        assert_eq!(lists, vec![sample()]);
        assert!(tombs.is_empty());
        let (lists, _) = merge_synced(&[sample()], &[], &[], NOW);
        assert_eq!(lists, vec![sample()]);
    }

    #[test]
    fn a_tombstone_removes_the_list_unless_it_changed_later() {
        let tomb = Tombstone { id: "abc".into(), deleted_ms: 5 };
        let (lists, tombs) = merge_synced(&[], &[sample()], &[tomb.clone()], NOW);
        assert!(lists.is_empty());
        assert_eq!(tombs, vec![tomb.clone()]);
        let mut edited = sample();
        edited.updated_ms = 9;
        let (lists, tombs) = merge_synced(&[edited.clone()], &[], &[tomb], NOW);
        assert_eq!(lists, vec![edited]);
        assert!(tombs.is_empty());
    }

    #[test]
    fn concurrent_edits_keep_both_additions_and_honour_removals() {
        let mut local = sample();
        local.items = vec![item("a", 10), item("b", 5)];
        local.updated_ms = 10;
        let mut server = local.clone();
        // The other device renamed it, added "c" and removed "b".
        server.name = "Otra".into();
        server.items = vec![item("c", 20), item("a", 10)];
        server.removed = vec![Removed { key: "b".into(), removed_ms: 20 }];
        server.updated_ms = 20;
        // Meanwhile this PC added "d".
        local.items.insert(0, item("d", 15));
        local.updated_ms = 15;
        let (lists, _) = merge_synced(&[server], &[local], &[], NOW);
        assert_eq!(keys(&lists[0]), vec!["c", "d", "a"]);
        assert_eq!(lists[0].name, "Otra");
        assert_eq!(lists[0].removed, vec![Removed { key: "b".into(), removed_ms: 20 }]);
    }

    #[test]
    fn a_title_added_back_beats_its_older_removal() {
        let mut local = sample();
        local.items = vec![item("a", 30)];
        let mut server = sample();
        server.items = vec![];
        server.removed = vec![Removed { key: "a".into(), removed_ms: 20 }];
        let (lists, _) = merge_synced(&[server], &[local], &[], NOW);
        assert_eq!(keys(&lists[0]), vec!["a"]);
        assert!(lists[0].removed.is_empty());
    }

    #[test]
    fn old_tombstones_expire() {
        let now = 100 * DAY;
        let old = Tombstone { id: "x".into(), deleted_ms: 1 };
        let fresh = Tombstone { id: "y".into(), deleted_ms: now - 1 };
        let newer = Tombstone { id: "y".into(), deleted_ms: now };
        assert_eq!(merge_tombstones(&[old, fresh], &[newer.clone()], now), vec![newer]);
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
