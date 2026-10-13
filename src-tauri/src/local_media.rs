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
}
