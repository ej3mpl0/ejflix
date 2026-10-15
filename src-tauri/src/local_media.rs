//! A file the user picked or dropped, played by mpv as a local path.
//!
//! The webview never receives the bytes. Drag-and-drop and the file dialog hand back
//! a path, and only a real file with a video or audio extension is accepted.

use std::ffi::c_void;
use std::path::{Path, PathBuf};

use crate::errors;

/// Containers mpv is asked to open. Subtitles and playlists stay out: this tab plays a file.
const VIDEO_EXTS: &[&str] = &[
    "mkv", "mp4", "m4v", "mov", "avi", "webm", "ts", "m2ts", "mts", "mpg", "mpeg", "wmv", "flv", "ogv", "3gp", "vob",
    "mk3d",
];
const AUDIO_EXTS: &[&str] = &["mp3", "m4a", "flac", "wav", "aac", "opus", "ogg", "wma", "aiff", "alac"];

const OFN_HIDEREADONLY: u32 = 0x0000_0004;
const OFN_NOCHANGEDIR: u32 = 0x0000_0008;
const OFN_PATHMUSTEXIST: u32 = 0x0000_0800;
const OFN_FILEMUSTEXIST: u32 = 0x0000_1000;
const OFN_EXPLORER: u32 = 0x0008_0000;

#[repr(C)]
struct OpenFileNameW {
    struct_size: u32,
    owner: isize,
    instance: isize,
    filter: *const u16,
    custom_filter: *mut u16,
    max_custom_filter: u32,
    filter_index: u32,
    file: *mut u16,
    max_file: u32,
    file_title: *mut u16,
    max_file_title: u32,
    initial_dir: *const u16,
    title: *const u16,
    flags: u32,
    file_offset: u16,
    file_extension: u16,
    def_ext: *const u16,
    cust_data: isize,
    hook: *mut c_void,
    template_name: *const u16,
    reserved: *mut c_void,
    reserved_flags: u32,
    flags_ex: u32,
}

#[link(name = "comdlg32")]
extern "system" {
    fn GetOpenFileNameW(ofn: *mut OpenFileNameW) -> i32;
    fn CommDlgExtendedError() -> u32;
}

fn is_media_ext(ext: &str) -> bool {
    VIDEO_EXTS.iter().chain(AUDIO_EXTS).any(|candidate| candidate.eq_ignore_ascii_case(ext))
}

pub fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| AUDIO_EXTS.iter().any(|candidate| candidate.eq_ignore_ascii_case(ext)))
}

/// `canonicalize` on Windows prefixes `\\?\`, which mpv does not need. UNC keeps its slashes.
fn plain_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest.to_string());
    }
    path.to_path_buf()
}

/// Absolute path of a media file that exists. Anything else is refused before mpv sees it.
pub fn media_path(raw: &str) -> Result<PathBuf, String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.len() > 32_000 || raw.contains('\0') || raw.contains('\n') || raw.contains('\r') {
        return Err(errors::code("notMedia"));
    }
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(errors::code("notMedia"));
    }
    let canon = std::fs::canonicalize(&path).map_err(|_| errors::code("fileNotFound"))?;
    let meta = std::fs::metadata(&canon).map_err(|_| errors::code("fileNotFound"))?;
    if !meta.is_file() {
        return Err(errors::code("notMedia"));
    }
    let ext = canon.extension().and_then(|ext| ext.to_str()).unwrap_or("");
    if !is_media_ext(ext) {
        return Err(errors::code("notMedia"));
    }
    let plain = plain_path(&canon);
    match plain.to_str() {
        Some(text) if !text.is_empty() => Ok(plain),
        _ => Err(errors::code("notMedia")),
    }
}

/// Title shown in the player: the one the UI asked for, else the file name without its extension.
pub fn display_title(requested: &str, path: &Path) -> String {
    let clean: String = requested.chars().filter(|c| !c.is_control()).take(180).collect();
    let clean = clean.trim();
    if !clean.is_empty() {
        return clean.to_string();
    }
    path.file_stem()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("ejFlix")
        .chars()
        .take(180)
        .collect()
}

/// A release filename boiled down to the title a catalog can search.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseGuess {
    pub title: String,
    pub year: Option<i32>,
    pub season: Option<i32>,
    pub episode: Option<i32>,
}

/// Lowest score that still means "this catalog row is the file", not a nearby title.
pub const RELEASE_MATCH_MIN: i32 = 40;

/// `The.Matrix.1999.1080p.BluRay` → title, year and, for `S01E02` / `1x02`, the episode.
/// `None` when the name is empty or just a word like "video".
pub fn parse_release(name: &str) -> Option<ReleaseGuess> {
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    let (head, season, episode) = split_episode(name);
    let tokens = tokenize(&unwrap_groups(&head));
    if tokens.is_empty() {
        return None;
    }
    // The year stays even when a language tag sits in front of it ("Latino.1972"):
    // cutting at the first tag first would throw the year away with the tag.
    let mut end = tokens.len();
    let mut year = None;
    if let Some(pos) = tokens.iter().rposition(|token| year_of(&token.raw).is_some()) {
        if pos > 0 {
            year = year_of(&tokens[pos].raw);
            end = pos;
        }
    }
    // "YTS.The.Matrix…" — a group glued to the front is not the title.
    let mut start = 0;
    while start < end && is_tag_at(&tokens, start) {
        start += 1;
    }
    if let Some(rel) = tag_index(&tokens[start..end]) {
        end = start + rel;
    }
    while end > start && is_group(&tokens[end - 1]) {
        end -= 1;
    }
    let title = tokens[start..end].iter().map(|token| token.raw.as_str()).collect::<Vec<_>>().join(" ");
    let title = title.trim().trim_matches(|c: char| matches!(c, '-' | '.' | '_')).trim();
    if title.chars().count() < 2 || !title.chars().any(|c| c.is_alphabetic()) || generic_title(title) {
        return None;
    }
    Some(ReleaseGuess {
        title: title.to_string(),
        year,
        season,
        episode,
    })
}

/// One catalog row the release search returned, in the order the catalog ranked it.
pub struct ReleaseCandidate {
    pub name: String,
    pub year: Option<i32>,
}

/// How well `name` (and its year) is the release `query`. 0 means it is a different title.
pub fn release_match_score(query: &str, year: Option<i32>, name: &str, meta_year: Option<i32>) -> i32 {
    let query_words = words(query);
    let name_words = words(name);
    if query_words.is_empty() || name_words.is_empty() {
        return 0;
    }
    if query_words.iter().any(|word| !name_words.iter().any(|other| other == word)) {
        return 0;
    }
    let extra = name_words.len().saturating_sub(query_words.len()) as i32;
    let mut score = 40 - extra * 8;
    if extra == 0 {
        score += 40;
    }
    match (year, meta_year) {
        (Some(want), Some(got)) if want == got => score += 30,
        (Some(want), Some(got)) if (want - got).abs() == 1 => score += 10,
        // A namesake from another year ("El padrino", 2004) is a different film.
        // The penalty has to sink an exact word match under `RELEASE_MATCH_MIN`.
        (Some(want), Some(got)) if (want - got).abs() >= 2 => score -= 50,
        _ => {}
    }
    score
}

/// Which search row is this file. `None` when none of them is the film.
///
/// The catalog's first row is its best guess, including a title it only knows in
/// another language: "El Padrino" (1972) comes back as "The Godfather". That row
/// shares no words with the file, so the word score is zero, but the year is the
/// file's year. A later row that copies the words and misses the year loses.
pub fn choose_release(guess: &ReleaseGuess, candidates: &[ReleaseCandidate]) -> Option<usize> {
    let mut best: Option<(i32, usize)> = None;
    for (index, candidate) in candidates.iter().take(12).enumerate() {
        let mut score = release_match_score(&guess.title, guess.year, &candidate.name, candidate.year);
        let same_year = matches!((guess.year, candidate.year), (Some(want), Some(got)) if want == got);
        if same_year && index == 0 && score < RELEASE_MATCH_MIN {
            score = RELEASE_MATCH_MIN;
        }
        if score < RELEASE_MATCH_MIN {
            continue;
        }
        if best.as_ref().map(|(current, _)| score > *current).unwrap_or(true) {
            best = Some((score, index));
        }
    }
    best.map(|(_, index)| index)
}

struct Tok {
    raw: String,
}

fn tag_index(tokens: &[Tok]) -> Option<usize> {
    (0..tokens.len()).find(|index| is_tag_at(tokens, *index))
}

fn tokenize(input: &str) -> Vec<Tok> {
    input
        .split(|c: char| c.is_whitespace() || matches!(c, '.' | '_' | '[' | ']' | '(' | ')' | '{' | '}'))
        .filter(|part| !part.is_empty())
        .flat_map(expand_glued)
        .map(|raw| Tok { raw })
        .collect()
}

/// `Tenet4KUHDRIp2kadfasd` is one token: the quality tags were glued to the title.
/// Peel those tags off so the search word is `Tenet`. A dotted name never reaches this.
fn expand_glued(raw: &str) -> Vec<String> {
    if raw.is_empty() {
        return Vec::new();
    }
    let mut pieces = Vec::new();
    let mut rest = raw;
    let mut peeled = false;
    while !rest.is_empty() {
        let take = tag_prefix_len(rest);
        if take > 0 {
            pieces.push(rest[..take].to_string());
            rest = &rest[take..];
            peeled = true;
            continue;
        }
        match first_glued_cut(rest) {
            Some(pos) if pos > 0 => {
                pieces.push(rest[..pos].to_string());
                rest = &rest[pos..];
                peeled = true;
            }
            _ => {
                // "2kadfasd" after a tag is a group suffix, not part of the title.
                if !(peeled && !title_word(rest)) {
                    pieces.push(rest.to_string());
                }
                break;
            }
        }
    }
    if pieces.is_empty() { vec![raw.to_string()] } else { pieces }
}

fn title_word(text: &str) -> bool {
    let mut letters = 0;
    for c in text.chars() {
        if c.is_alphabetic() {
            letters += 1;
        } else if c.is_ascii_digit() || !matches!(c, '\'' | '-' | '&') {
            return false;
        }
    }
    letters >= 2
}

/// Earliest index, after at least two letters, where a quality tag or a year starts.
fn first_glued_cut(token: &str) -> Option<usize> {
    let mut letters = 0;
    let mut start = None;
    for (idx, ch) in token.char_indices() {
        if ch.is_alphabetic() {
            letters += 1;
        }
        if letters >= 2 {
            start = Some(idx + ch.len_utf8());
            break;
        }
    }
    let mut i = start?;
    while i < token.len() {
        if token.is_char_boundary(i) && tag_prefix_len(&token[i..]) > 0 {
            return Some(i);
        }
        let ch = token[i..].chars().next()?;
        i += ch.len_utf8();
    }
    None
}

fn tag_prefix_len(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }
    let lower = text.to_ascii_lowercase();
    let mut best = safe_prefix_len(&lower, text);
    for tag in GLUED_SHORT {
        if lower.starts_with(tag) {
            let after = &text[tag.len()..];
            let after_lower = &lower[tag.len()..];
            let followed = after.is_empty()
                || after.starts_with(|c: char| c.is_ascii_digit())
                || safe_prefix_len(after_lower, after) > 0;
            if followed {
                best = best.max(tag.len());
            }
        }
    }
    best
}

fn safe_prefix_len(lower: &str, original: &str) -> usize {
    glued_tag_len(lower).max(resolution_prefix_len(lower)).max(year_prefix_len(original))
}

fn glued_tag_len(lower: &str) -> usize {
    GLUED.iter().filter(|tag| lower.starts_with(*tag)).map(|tag| tag.len()).max().unwrap_or(0)
}

fn resolution_prefix_len(lower: &str) -> usize {
    let bytes = lower.as_bytes();
    let mut i = 0;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if (3..=4).contains(&i) && bytes.get(i) == Some(&b'p') {
        i + 1
    } else {
        0
    }
}

fn year_prefix_len(text: &str) -> usize {
    let bytes = text.as_bytes();
    if bytes.len() < 4 || !bytes[..4].iter().all(|b| b.is_ascii_digit()) || year_of(&text[..4]).is_none() {
        return 0;
    }
    let after = &text[4..];
    let after_lower = after.to_ascii_lowercase();
    // "20204K" — the next digit begins a tag, not a longer number. "20010" does not.
    if after.starts_with(|c: char| c.is_ascii_digit())
        && glued_tag_len(&after_lower) == 0
        && resolution_prefix_len(&after_lower) == 0
    {
        return 0;
    }
    4
}

/// `(1999)` stays as a year. `[1080p]` and other brackets go away.
fn unwrap_groups(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        if matches!(chars[i], '(' | '[' | '{') {
            let close = match chars[i] {
                '(' => ')',
                '[' => ']',
                _ => '}',
            };
            if let Some(end) = chars[i + 1..].iter().position(|c| *c == close) {
                let inner: String = chars[i + 1..i + 1 + end].iter().collect();
                if year_of(inner.trim()).is_some() {
                    out.push(' ');
                    out.push_str(inner.trim());
                    out.push(' ');
                }
                i += end + 2;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

fn split_episode(name: &str) -> (String, Option<i32>, Option<i32>) {
    for (i, _) in name.char_indices() {
        let boundary = i == 0 || name[..i].chars().next_back().is_some_and(|c| !c.is_ascii_alphanumeric());
        if !boundary {
            continue;
        }
        if let Some((season, episode)) = episode_at(&name[i..]) {
            let head = name[..i].trim_matches(|c: char| matches!(c, '.' | '_' | '-' | ' '));
            if !head.is_empty() {
                return (head.to_string(), Some(season), Some(episode));
            }
        }
    }
    (name.to_string(), None, None)
}

fn episode_at(text: &str) -> Option<(i32, i32)> {
    let bytes = text.as_bytes();
    if bytes.first()?.eq_ignore_ascii_case(&b's') {
        let (season, season_len) = take_digits(&bytes[1..], 1, 2)?;
        let rest = &bytes[1 + season_len..];
        let mut skip = 0;
        while skip < rest.len() && matches!(rest[skip], b'.' | b'_' | b'-' | b' ') {
            skip += 1;
        }
        if rest.get(skip)?.eq_ignore_ascii_case(&b'e') {
            let (episode, episode_len) = take_digits(&rest[skip + 1..], 1, 3)?;
            let used = 1 + season_len + skip + 1 + episode_len;
            if boundary_after(bytes, used) && (1..=80).contains(&season) {
                return Some((season, episode));
            }
        }
    }
    let (left, left_len) = take_digits(bytes, 1, 2)?;
    if bytes.get(left_len)?.eq_ignore_ascii_case(&b'x') {
        let (right, right_len) = take_digits(&bytes[left_len + 1..], 2, 2)?;
        let used = left_len + 1 + right_len;
        if boundary_after(bytes, used) && (1..=80).contains(&left) {
            return Some((left, right));
        }
    }
    None
}

fn boundary_after(bytes: &[u8], used: usize) -> bool {
    match bytes.get(used) {
        None => true,
        Some(c) => !c.is_ascii_alphanumeric(),
    }
}

fn take_digits(bytes: &[u8], min: usize, max: usize) -> Option<(i32, usize)> {
    let mut len = 0;
    while len < max && len < bytes.len() && bytes[len].is_ascii_digit() {
        len += 1;
    }
    if len < min {
        return None;
    }
    let text = std::str::from_utf8(&bytes[..len]).ok()?;
    Some((text.parse().ok()?, len))
}

fn year_of(token: &str) -> Option<i32> {
    if token.len() != 4 || !token.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let year: i32 = token.parse().ok()?;
    (1888..=2035).contains(&year).then_some(year)
}

fn is_tag_at(tokens: &[Tok], index: usize) -> bool {
    let Some(token) = tokens.get(index) else { return false };
    let lower = token.raw.to_ascii_lowercase();
    if TAGS.iter().any(|tag| *tag == lower) || is_resolution(&lower) || is_audio_codec(&lower) {
        return true;
    }
    if matches!(lower.as_str(), "h" | "x") {
        let next = tokens.get(index + 1).map(|token| token.raw.as_str());
        return matches!(next, Some("264" | "265"));
    }
    false
}

fn is_resolution(lower: &str) -> bool {
    let Some(number) = lower.strip_suffix('p') else { return false };
    (3..=4).contains(&number.len()) && number.bytes().all(|b| b.is_ascii_digit())
}

fn is_audio_codec(lower: &str) -> bool {
    const PREFIXES: &[&str] = &["ddp", "aac", "ac3", "eac3", "dts", "truehd", "flac", "opus", "mp3"];
    PREFIXES.iter().any(|prefix| {
        lower == *prefix
            || lower
                .strip_prefix(prefix)
                .is_some_and(|rest| !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()))
    })
}

fn is_group(token: &Tok) -> bool {
    let raw = token.raw.as_str();
    let len = raw.len();
    (3..=15).contains(&len)
        && raw.bytes().all(|b| b.is_ascii_alphanumeric())
        && raw.bytes().any(|b| b.is_ascii_uppercase())
        && !raw.bytes().any(|b| b.is_ascii_lowercase())
        && !is_roman(raw)
        && year_of(raw).is_none()
}

fn is_roman(token: &str) -> bool {
    !token.is_empty() && token.len() <= 6 && token.bytes().all(|b| matches!(b, b'I' | b'V' | b'X'))
}

fn generic_title(title: &str) -> bool {
    let words = words(title);
    words.is_empty() || words.iter().all(|word| GENERIC.iter().any(|item| item == word))
}

fn fold_char(c: char) -> char {
    match c {
        'á' | 'à' | 'ä' | 'â' | 'ã' => 'a',
        'é' | 'è' | 'ë' | 'ê' => 'e',
        'í' | 'ì' | 'ï' | 'î' => 'i',
        'ó' | 'ò' | 'ö' | 'ô' | 'õ' => 'o',
        'ú' | 'ù' | 'ü' | 'û' => 'u',
        'ñ' => 'n',
        'ç' => 'c',
        other => other,
    }
}

fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .chars()
        .map(fold_char)
        .map(|c| if c.is_ascii_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .filter(|word| !STOP.iter().any(|item| item == word))
        .map(|word| word.to_string())
        .collect()
}

/// Quality and codec tags that stay recognizable when a release glues them to the title.
const GLUED: &[&str] = &[
    "hdr10plus", "hdr10", "blu-ray", "bluray", "bdremux", "web-rip", "webrip", "web-dl", "webdl", "bdrip", "brrip",
    "hdrip", "dvdrip", "dvdscr", "hdcam", "telesync", "truehd", "2160p", "1080p", "720p", "480p", "576p", "10bit",
    "12bit", "8bit", "x264", "x265", "h264", "h265", "hevc", "xvid", "divx", "uhd", "hdr", "hlg", "dovi", "avc",
    "remux", "hdtv", "4k", "8k", "amzn", "dsnp", "hmax", "atvp", "yify", "yts",
];

/// Short tags that are also ordinary words. Only peel them when a real tag follows.
const GLUED_SHORT: &[&str] = &["rip"];

const TAGS: &[&str] = &[
    "4k", "8k", "uhd", "hdr", "hdr10", "hdr10plus", "hlg", "dovi", "bluray", "blu-ray", "bdrip", "brrip", "bdremux",
    "remux", "webrip", "web-dl", "webdl", "web-rip", "hdtv", "hdrip", "dvdrip", "dvdscr", "hdcam", "cam", "telesync",
    "x264", "x265", "h264", "h265", "hevc", "avc", "xvid", "divx", "atmos", "10bit", "8bit", "12bit", "yify", "yts",
    "rarbg", "ettv", "eztv", "amzn", "dsnp", "hmax", "atvp", "proper", "repack", "rerip", "extended", "unrated",
    "theatrical", "remastered", "subbed", "dubbed", "latino", "latina", "castellano", "spanish", "espanol", "español",
    "multi", "dual", "dualaudio", "subs", "vose", "vostfr", "truefrench",
];

const STOP: &[&str] = &["the", "a", "an", "of", "and", "el", "la", "los", "las", "de", "del", "y"];

const GENERIC: &[&str] = &[
    "video", "movie", "movies", "sample", "trailer", "clip", "test", "track", "audio", "temp", "download",
    "downloads", "file", "files", "videos", "series", "tv", "peliculas", "pelis", "desktop", "descargas", "ejflix",
];

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

fn label(raw: &str, fallback: &str) -> String {
    let clean: String = raw.chars().filter(|c| *c != '\0' && !c.is_control()).take(40).collect();
    let clean = clean.trim();
    if clean.is_empty() {
        fallback.to_string()
    } else {
        clean.to_string()
    }
}

fn usable_dir(raw: Option<&str>) -> Option<PathBuf> {
    let raw = raw?.trim();
    if raw.is_empty() || raw.contains('\0') || raw.len() > 32_000 {
        return None;
    }
    let path = PathBuf::from(raw);
    path.is_dir().then_some(path)
}

fn extension_filter(exts: &[&str]) -> String {
    exts.iter().map(|ext| format!("*.{ext}")).collect::<Vec<_>>().join(";")
}

/// Native open dialog. `Ok(None)` is the user cancelling. Must run off the UI thread:
/// the dialog runs its own message loop and would stall the window if called on it.
pub fn pick_media_file(
    owner: isize,
    title: &str,
    video_label: &str,
    audio_label: &str,
    initial_dir: Option<&str>,
) -> Result<Option<String>, String> {
    let title = label(title, "ejFlix");
    let video_label = label(video_label, "Video");
    let audio_label = label(audio_label, "Audio");
    let filter_text = format!(
        "{video_label}\0{}\0{audio_label}\0{}\0",
        extension_filter(VIDEO_EXTS),
        extension_filter(AUDIO_EXTS),
    );
    let filter = wide(&filter_text);
    let title_w = wide(&title);
    let initial = usable_dir(initial_dir);
    let initial_w = initial.as_ref().map(|dir| wide(&dir.to_string_lossy()));
    let mut buffer = vec![0_u16; 32_768];
    let mut ofn = OpenFileNameW {
        struct_size: std::mem::size_of::<OpenFileNameW>() as u32,
        owner,
        instance: 0,
        filter: filter.as_ptr(),
        custom_filter: std::ptr::null_mut(),
        max_custom_filter: 0,
        filter_index: 1,
        file: buffer.as_mut_ptr(),
        max_file: buffer.len() as u32,
        file_title: std::ptr::null_mut(),
        max_file_title: 0,
        initial_dir: initial_w.as_ref().map(|text| text.as_ptr()).unwrap_or(std::ptr::null()),
        title: title_w.as_ptr(),
        flags: OFN_HIDEREADONLY | OFN_NOCHANGEDIR | OFN_PATHMUSTEXIST | OFN_FILEMUSTEXIST | OFN_EXPLORER,
        file_offset: 0,
        file_extension: 0,
        def_ext: std::ptr::null(),
        cust_data: 0,
        hook: std::ptr::null_mut(),
        template_name: std::ptr::null(),
        reserved: std::ptr::null_mut(),
        reserved_flags: 0,
        flags_ex: 0,
    };
    let ok = unsafe { GetOpenFileNameW(&mut ofn) };
    if ok == 0 {
        let err = unsafe { CommDlgExtendedError() };
        // 0 means the user closed the dialog. Anything else is the dialog itself failing.
        return if err == 0 {
            Ok(None)
        } else {
            Err(errors::detail("mediaDialog", err))
        };
    }
    let end = buffer.iter().position(|unit| *unit == 0).unwrap_or(buffer.len());
    let path = String::from_utf16_lossy(&buffer[..end]);
    if path.is_empty() {
        Ok(None)
    } else {
        Ok(Some(path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dialog_struct_matches_the_windows_layout() {
        assert_eq!(std::mem::size_of::<OpenFileNameW>(), 152);
        assert_eq!(std::mem::align_of::<OpenFileNameW>(), 8);
        assert_eq!(std::mem::offset_of!(OpenFileNameW, flags), 96);
        assert_eq!(std::mem::offset_of!(OpenFileNameW, def_ext), 104);
        assert_eq!(std::mem::offset_of!(OpenFileNameW, flags_ex), 148);
    }

    #[test]
    fn rejects_paths_that_are_not_a_local_media_file() {
        assert!(media_path("").is_err());
        assert!(media_path("movie.mkv").is_err());
        assert!(media_path("C:\\ejflix-does-not-exist\\movie.mkv").is_err());
        assert!(media_path("C:\\movie.mkv\0hidden").is_err());
    }

    #[test]
    fn accepts_a_real_video_and_refuses_other_files() {
        let dir = std::env::temp_dir();
        let video = dir.join(format!("ejflix-media-{}.MKV", std::process::id()));
        let text = dir.join(format!("ejflix-media-{}.txt", std::process::id()));
        std::fs::write(&video, b"not a real mkv").unwrap();
        std::fs::write(&text, b"notes").unwrap();
        let got = media_path(&video.to_string_lossy()).unwrap();
        let shown = got.to_string_lossy();
        assert!(got.is_absolute());
        assert!(!shown.starts_with(r"\\?\"));
        assert!(shown.to_ascii_lowercase().ends_with(".mkv"));
        assert!(media_path(&text.to_string_lossy()).is_err());
        let _ = std::fs::remove_file(&video);
        let _ = std::fs::remove_file(&text);
    }

    #[test]
    fn title_prefers_the_requested_name() {
        let path = Path::new(r"C:\Videos\release.mkv");
        assert_eq!(display_title("  Dune  ", path), "Dune");
        assert_eq!(display_title(" \n ", path), "release");
        assert_eq!(display_title("", Path::new(r"C:\")), "ejFlix");
    }

    #[test]
    fn release_names_become_a_title_year_and_episode() {
        let matrix = parse_release("The.Matrix.1999.1080p.BluRay.x264-RARBG").unwrap();
        assert_eq!(matrix.title, "The Matrix");
        assert_eq!(matrix.year, Some(1999));
        assert_eq!(matrix.season, None);

        let dune = parse_release("Dune.Part.Two.2024.2160p.WEB-DL").unwrap();
        assert_eq!(dune.title, "Dune Part Two");
        assert_eq!(dune.year, Some(2024));

        let odyssey = parse_release("2001.A.Space.Odyssey.1968.1080p").unwrap();
        assert_eq!(odyssey.title, "2001 A Space Odyssey");
        assert_eq!(odyssey.year, Some(1968));

        let episode = parse_release("Breaking.Bad.S02E05.720p").unwrap();
        assert_eq!(episode.title, "Breaking Bad");
        assert_eq!(episode.season, Some(2));
        assert_eq!(episode.episode, Some(5));

        let short = parse_release("Show.Name.1x02").unwrap();
        assert_eq!(short.season, Some(1));
        assert_eq!(short.episode, Some(2));

        let paren = parse_release("The Matrix (1999) [1080p]").unwrap();
        assert_eq!(paren.title, "The Matrix");
        assert_eq!(paren.year, Some(1999));

        assert!(parse_release("video").is_none());
        assert!(parse_release("sample").is_none());
    }

    #[test]
    fn a_glued_release_name_keeps_the_movie_word() {
        let tenet = parse_release("Tenet4KUHDRIp2kadfasd").unwrap();
        assert_eq!(tenet.title, "Tenet");
        assert_eq!(tenet.year, None);

        let dated = parse_release("Tenet20204K").unwrap();
        assert_eq!(dated.title, "Tenet");
        assert_eq!(dated.year, Some(2020));

        let yts = parse_release("YTS.The.Matrix.1999.1080p.BluRay").unwrap();
        assert_eq!(yts.title, "The Matrix");
        assert_eq!(yts.year, Some(1999));

        let padrino = parse_release("El.Padrino.Latino.1972.1080p").unwrap();
        assert_eq!(padrino.title, "El Padrino");
        assert_eq!(padrino.year, Some(1972));

        assert!(parse_release("Movies").is_none());
        assert!(parse_release("Peliculas").is_none());
    }

    #[test]
    fn a_spanish_query_prefers_the_film_from_that_year() {
        assert!(release_match_score("El Padrino", Some(1972), "El padrino", Some(2004)) < RELEASE_MATCH_MIN);
        let candidates = [
            ReleaseCandidate { name: "The Godfather".to_string(), year: Some(1972) },
            ReleaseCandidate { name: "El padrino".to_string(), year: Some(2004) },
        ];
        let guess = ReleaseGuess { title: "El Padrino".to_string(), year: Some(1972), season: None, episode: None };
        assert_eq!(choose_release(&guess, &candidates), Some(0));

        let dunes = [
            ReleaseCandidate { name: "Dune: Part Two".to_string(), year: Some(2024) },
            ReleaseCandidate { name: "Dune".to_string(), year: Some(2021) },
        ];
        let dune = ReleaseGuess { title: "Dune".to_string(), year: Some(2021), season: None, episode: None };
        assert_eq!(choose_release(&dune, &dunes), Some(1));
    }

    #[test]
    fn a_nearby_title_does_not_count_as_the_file() {
        assert!(release_match_score("The Matrix", Some(1999), "The Matrix", Some(1999)) >= RELEASE_MATCH_MIN);
        assert!(release_match_score("The Matrix", Some(1999), "The Matrix Reloaded", Some(2003)) < RELEASE_MATCH_MIN);
        assert!(release_match_score("Dune", None, "Dune", Some(2021)) >= RELEASE_MATCH_MIN);
        assert!(release_match_score("Dune", None, "Dune: Part Two", Some(2024)) < RELEASE_MATCH_MIN);
        assert!(release_match_score("Dune", Some(2021), "Dune: Part Two", Some(2024)) < RELEASE_MATCH_MIN);
        assert!(release_match_score("Harry Potter", Some(2001), "Harry Potter and the Sorcerer's Stone", Some(2001)) >= RELEASE_MATCH_MIN);
        assert!(release_match_score("Harry Potter", Some(2001), "Harry Potter and the Chamber of Secrets", Some(2002)) < RELEASE_MATCH_MIN);
    }
}
