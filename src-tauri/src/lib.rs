//! Backend for the dungeon DM tool: dungeon directory I/O, image import,
//! persisted settings, and multi-window / multi-display management.

use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

const DM_LABEL: &str = "dm";
const NOTES_DIR: &str = "notes";
const PLAYER_LABEL: &str = "player";

// ---------------------------------------------------------------------------
// Dungeon files
// ---------------------------------------------------------------------------

/// Joins a dungeon-relative path onto `root`, rejecting anything that could
/// escape the dungeon directory.
fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if rel.is_empty() || p.is_absolute() || p.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!("invalid dungeon path: {rel}"));
    }
    Ok(root.join(p))
}

fn is_managed_file(path: &Path) -> bool {
    matches!(path.extension().and_then(|e| e.to_str()), Some("json") | Some("md"))
}

/// Collects all .json/.md files below `dir` (skipping hidden entries and the
/// top-level assets folder) as dungeon-relative paths with `/` separators.
fn collect_files(root: &Path, dir: &Path, out: &mut HashMap<String, String>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            // Images live in assets/; notes are loaded separately (load_notes).
            if dir == root && (name == "assets" || name == NOTES_DIR) {
                continue;
            }
            collect_files(root, &path, out)?;
        } else if is_managed_file(&path) {
            let rel = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/");
            let content = fs::read_to_string(&path).map_err(|e| format!("cannot read {rel}: {e}"))?;
            out.insert(rel, content);
        }
    }
    Ok(())
}

fn allow_assets(app: &AppHandle, root: &Path) {
    if let Err(e) = app.asset_protocol_scope().allow_directory(root, true) {
        eprintln!("could not allow asset access to {}: {e}", root.display());
    }
}

fn read_dungeon_dir(root: &Path) -> Result<HashMap<String, String>, String> {
    if !root.join("dungeon.json").is_file() {
        return Err(format!("{} does not contain a dungeon.json — it is not a dungeon folder", root.display()));
    }
    let mut files = HashMap::new();
    collect_files(root, root, &mut files)?;
    Ok(files)
}

#[tauri::command]
fn load_dungeon(app: AppHandle, dir: String) -> Result<HashMap<String, String>, String> {
    let root = PathBuf::from(&dir);
    let files = read_dungeon_dir(&root)?;
    allow_assets(&app, &root);
    Ok(files)
}

#[tauri::command]
fn dungeon_exists(dir: String) -> bool {
    Path::new(&dir).join("dungeon.json").is_file()
}

/// Writes atomically (temp file + rename) so a crash never leaves a half-written file.
fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    let tmp = path.with_extension(format!(
        "{}.tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or("")
    ));
    fs::write(&tmp, content).map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("cannot write {}: {e}", path.display()))
}

/// Removes now-empty directories between `path`'s parent and `root` (exclusive).
fn prune_empty_dirs(root: &Path, path: &Path) {
    let mut dir = path.parent();
    while let Some(d) = dir {
        if d == root || !d.starts_with(root) {
            break;
        }
        if fs::remove_dir(d).is_err() {
            break; // not empty (or not removable) — stop
        }
        dir = d.parent();
    }
}

fn apply_changes(root: &Path, writes: &HashMap<String, String>, deletes: &[String]) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| format!("cannot create {}: {e}", root.display()))?;
    for (rel, content) in writes {
        write_atomic(&safe_join(root, rel)?, content)?;
    }
    for rel in deletes {
        let path = safe_join(root, rel)?;
        if path.is_file() {
            fs::remove_file(&path).map_err(|e| format!("cannot delete {rel}: {e}"))?;
        }
        prune_empty_dirs(root, &path);
    }
    Ok(())
}

#[tauri::command]
fn save_files(
    app: AppHandle,
    dir: String,
    writes: HashMap<String, String>,
    deletes: Vec<String>,
) -> Result<(), String> {
    let root = PathBuf::from(&dir);
    apply_changes(&root, &writes, &deletes)?;
    allow_assets(&app, &root);
    Ok(())
}

fn sanitize_file_name(name: &str) -> String {
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s, Some(e.to_ascii_lowercase())),
        _ => (name, None),
    };
    let mut clean: String = stem
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    while clean.contains("--") {
        clean = clean.replace("--", "-");
    }
    let clean = clean.trim_matches('-');
    let clean = if clean.is_empty() { "image" } else { clean };
    match ext {
        Some(e) => format!("{clean}.{e}"),
        None => clean.to_string(),
    }
}

fn rel_path(root: &Path, path: &Path) -> Result<String, String> {
    Ok(path
        .strip_prefix(root)
        .map_err(|e| e.to_string())?
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/"))
}

/// Writes `bytes` into `<root>/<subdir>/` under a sanitized, unique version
/// of `file_name` (reusing an identical existing file) and returns the
/// dungeon-relative path.
fn store_bytes(root: &Path, subdir: &str, file_name: &str, bytes: &[u8]) -> Result<String, String> {
    let folder = safe_join(root, subdir)?;
    fs::create_dir_all(&folder).map_err(|e| format!("cannot create {subdir}: {e}"))?;
    let clean = sanitize_file_name(file_name);
    let (stem, ext) = match clean.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (clean.clone(), String::new()),
    };
    let mut n = 1;
    loop {
        let name = if n == 1 { format!("{stem}{ext}") } else { format!("{stem}-{n}{ext}") };
        let target = folder.join(&name);
        if !target.exists() {
            fs::write(&target, bytes).map_err(|e| format!("cannot write {name}: {e}"))?;
            return Ok(format!("{subdir}/{name}"));
        }
        // Same file stored before: reuse it.
        if fs::read(&target).map(|existing| existing == bytes).unwrap_or(false) {
            return Ok(format!("{subdir}/{name}"));
        }
        n += 1;
    }
}

/// Copies an image into `<dungeon>/<subdir>/` (unless it already lives inside
/// the dungeon) and returns its dungeon-relative path.
fn import_asset_into(root: &Path, source: &Path, subdir: &str) -> Result<String, String> {
    let root = root.canonicalize().map_err(|e| format!("cannot open dungeon folder: {e}"))?;
    let source = source.canonicalize().map_err(|e| format!("cannot open {}: {e}", source.display()))?;
    if source.starts_with(&root) {
        return rel_path(&root, &source);
    }
    let file_name = source.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let bytes = fs::read(&source).map_err(|e| format!("cannot read {}: {e}", source.display()))?;
    store_bytes(&root, subdir, &file_name, &bytes)
}

#[tauri::command]
fn import_asset(app: AppHandle, dir: String, source: String, subdir: Option<String>) -> Result<String, String> {
    let root = PathBuf::from(&dir);
    let rel = import_asset_into(&root, Path::new(&source), subdir.as_deref().unwrap_or("assets"))?;
    allow_assets(&app, &root);
    Ok(rel)
}

/// Stores pasted / dropped image data (base64) and returns its dungeon-relative path.
#[tauri::command]
fn save_attachment(app: AppHandle, dir: String, subdir: String, name: String, base64: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("invalid image data: {e}"))?;
    let root = PathBuf::from(&dir);
    let rel = store_bytes(&root, &subdir, &name, &bytes)?;
    allow_assets(&app, &root);
    Ok(rel)
}

// ---------------------------------------------------------------------------
// Notes (an Obsidian-like folder of markdown files under <dungeon>/notes)
// ---------------------------------------------------------------------------

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
struct NotesListing {
    /// Note path (relative to notes/, `/`-separated) -> markdown content.
    files: HashMap<String, String>,
    /// Every folder, including empty ones.
    folders: Vec<String>,
    /// Every other file (images, PDFs, ...).
    attachments: Vec<String>,
}

fn walk_notes(notes_root: &Path, dir: &Path, out: &mut NotesListing) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue; // .trash, .obsidian, ...
        }
        let path = entry.path();
        let rel = rel_path(notes_root, &path)?;
        if path.is_dir() {
            out.folders.push(rel);
            walk_notes(notes_root, &path, out)?;
        } else if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("md")) == Some(true) {
            let content = fs::read_to_string(&path).map_err(|e| format!("cannot read {rel}: {e}"))?;
            out.files.insert(rel, content);
        } else {
            out.attachments.push(rel);
        }
    }
    Ok(())
}

fn list_notes(root: &Path) -> Result<NotesListing, String> {
    let notes_root = root.join(NOTES_DIR);
    let mut out = NotesListing::default();
    if notes_root.is_dir() {
        walk_notes(&notes_root, &notes_root, &mut out)?;
    }
    out.folders.sort();
    out.attachments.sort();
    Ok(out)
}

#[tauri::command]
fn load_notes(dir: String) -> Result<NotesListing, String> {
    list_notes(Path::new(&dir))
}

fn notes_path(root: &Path, rel: &str) -> Result<PathBuf, String> {
    safe_join(&root.join(NOTES_DIR), rel)
}

#[tauri::command]
fn notes_create_folder(dir: String, path: String) -> Result<(), String> {
    let target = notes_path(Path::new(&dir), &path)?;
    if target.exists() {
        return Err(format!("“{path}” already exists"));
    }
    fs::create_dir_all(&target).map_err(|e| format!("cannot create folder: {e}"))
}

/// Renames or moves a note or folder inside notes/.
fn move_in_notes(root: &Path, from: &str, to: &str) -> Result<(), String> {
    let src = notes_path(root, from)?;
    let dst = notes_path(root, to)?;
    if !src.exists() {
        return Err(format!("“{from}” does not exist"));
    }
    if dst.exists() {
        return Err(format!("“{to}” already exists"));
    }
    if dst.starts_with(&src) {
        return Err("cannot move a folder into itself".into());
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("cannot create folder: {e}"))?;
    }
    fs::rename(&src, &dst).map_err(|e| format!("cannot move: {e}"))
}

#[tauri::command]
fn notes_move(dir: String, from: String, to: String) -> Result<(), String> {
    move_in_notes(Path::new(&dir), &from, &to)
}

/// Moves a note or folder into notes/.trash (like Obsidian) instead of deleting it.
fn trash_in_notes(root: &Path, path: &str) -> Result<String, String> {
    let src = notes_path(root, path)?;
    if !src.exists() {
        return Err(format!("“{path}” does not exist"));
    }
    let trash = root.join(NOTES_DIR).join(".trash");
    fs::create_dir_all(&trash).map_err(|e| format!("cannot create trash: {e}"))?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let base = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let mut target = trash.join(format!("{stamp}-{base}"));
    let mut n = 2;
    while target.exists() {
        target = trash.join(format!("{stamp}-{n}-{base}"));
        n += 1;
    }
    fs::rename(&src, &target).map_err(|e| format!("cannot move to trash: {e}"))?;
    Ok(format!(".trash/{}", target.file_name().unwrap().to_string_lossy()))
}

#[tauri::command]
fn notes_trash(dir: String, path: String) -> Result<String, String> {
    trash_in_notes(Path::new(&dir), &path)
}

/// Reads a text file inside the dungeon (None if it does not exist).
#[tauri::command]
fn read_text(dir: String, path: String) -> Result<Option<String>, String> {
    let p = safe_join(Path::new(&dir), &path)?;
    if !p.is_file() {
        return Ok(None);
    }
    fs::read_to_string(&p).map(Some).map_err(|e| format!("cannot read {path}: {e}"))
}

// ---------------------------------------------------------------------------
// Settings (remembered between sessions)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
struct Settings {
    recent_dungeons: Vec<String>,
    dm_monitor: Option<String>,
    player_monitor: Option<String>,
    player_fullscreen: bool,
    /// Frontend preferences (sound effects, music, Spotify login...) kept as-is.
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

struct AppState {
    settings: Mutex<Settings>,
}

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

fn read_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app).ok_or("no config directory")?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    write_atomic(&path, &json)
}

fn merge_settings(current: &Settings, patch: serde_json::Value) -> Result<Settings, String> {
    let mut value = serde_json::to_value(current).map_err(|e| e.to_string())?;
    if let (Some(obj), serde_json::Value::Object(p)) = (value.as_object_mut(), patch) {
        for (k, v) in p {
            obj.insert(k, v);
        }
    }
    serde_json::from_value(value).map_err(|e| format!("invalid settings: {e}"))
}

fn update<F: FnOnce(&mut Settings)>(app: &AppHandle, state: &State<AppState>, f: F) -> Result<Settings, String> {
    let mut guard = state.settings.lock().map_err(|e| e.to_string())?;
    f(&mut guard);
    write_settings(app, &guard)?;
    Ok(guard.clone())
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Result<Settings, String> {
    Ok(state.settings.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
fn update_settings(app: AppHandle, state: State<AppState>, patch: serde_json::Value) -> Result<Settings, String> {
    let merged = merge_settings(&get_settings(state.clone())?, patch)?;
    update(&app, &state, |s| *s = merged)
}

// ---------------------------------------------------------------------------
// Windows & displays
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorInfo {
    name: String,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    scale_factor: f64,
    primary: bool,
}

fn monitor_name(m: &Monitor) -> String {
    m.name().cloned().unwrap_or_else(|| format!("Display at {},{}", m.position().x, m.position().y))
}

#[tauri::command]
fn list_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let primary = app.primary_monitor().ok().flatten().map(|m| monitor_name(&m));
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    Ok(monitors
        .iter()
        .map(|m| {
            let name = monitor_name(m);
            MonitorInfo {
                primary: primary.as_deref() == Some(name.as_str()),
                name,
                width: m.size().width,
                height: m.size().height,
                x: m.position().x,
                y: m.position().y,
                scale_factor: m.scale_factor(),
            }
        })
        .collect())
}

/// Moves `window` onto the named display and maximizes it there. Unknown or
/// missing displays leave the window where it is.
fn place_on_monitor(window: &WebviewWindow, monitor: Option<&str>) {
    let Some(target) = monitor else { return };
    let Ok(monitors) = window.available_monitors() else { return };
    let Some(m) = monitors.iter().find(|m| monitor_name(m) == target) else { return };
    let was_fullscreen = window.is_fullscreen().unwrap_or(false);
    if was_fullscreen {
        let _ = window.set_fullscreen(false);
    }
    let _ = window.unmaximize();
    let pos = m.position();
    let _ = window.set_position(PhysicalPosition::new(pos.x + 40, pos.y + 40));
    let _ = window.maximize();
    if was_fullscreen {
        let _ = window.set_fullscreen(true);
    }
}

fn player_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(w) = app.get_webview_window(PLAYER_LABEL) {
        return Ok(w);
    }
    WebviewWindowBuilder::new(app, PLAYER_LABEL, WebviewUrl::App("index.html".into()))
        .title("Dungeon — Player View")
        .inner_size(1100.0, 750.0)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn show_player_window(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let settings = get_settings(state)?;
    let window = player_window(&app)?;
    let was_visible = window.is_visible().unwrap_or(false);
    window.show().map_err(|e| e.to_string())?;
    let _ = app.emit("player:shown", ());
    if !was_visible {
        place_on_monitor(&window, settings.player_monitor.as_deref());
        if settings.player_fullscreen {
            let _ = window.set_fullscreen(true);
        }
        // Keep keyboard focus on the DM window.
        if let Some(dm) = app.get_webview_window(DM_LABEL) {
            let _ = dm.set_focus();
        }
    }
    Ok(())
}

#[tauri::command]
fn assign_monitor(app: AppHandle, state: State<AppState>, label: String, monitor: Option<String>) -> Result<(), String> {
    update(&app, &state, |s| match label.as_str() {
        PLAYER_LABEL => s.player_monitor = monitor.clone(),
        _ => s.dm_monitor = monitor.clone(),
    })?;
    if let Some(w) = app.get_webview_window(&label) {
        place_on_monitor(&w, monitor.as_deref());
    }
    Ok(())
}

#[tauri::command]
fn set_player_fullscreen(app: AppHandle, state: State<AppState>, on: bool) -> Result<(), String> {
    update(&app, &state, |s| s.player_fullscreen = on)?;
    if let Some(w) = app.get_webview_window(PLAYER_LABEL) {
        w.set_fullscreen(on).map_err(|e| e.to_string())?;
    }
    app.emit("dm:kiosk", serde_json::json!({ "kiosk": on })).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let settings = read_settings(app.handle());
            if let Some(dm) = app.get_webview_window(DM_LABEL) {
                place_on_monitor(&dm, settings.dm_monitor.as_deref());
            }
            app.manage(AppState { settings: Mutex::new(settings) });
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            // Closing the DM window quits the whole tool.
            (DM_LABEL, WindowEvent::Destroyed) => window.app_handle().exit(0),
            // Closing the player window only hides it, so it can be brought back instantly.
            (PLAYER_LABEL, WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let _ = window.set_fullscreen(false);
                let _ = window.hide();
                let _ = window.app_handle().emit("player:hidden", ());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            load_dungeon,
            dungeon_exists,
            save_files,
            import_asset,
            save_attachment,
            load_notes,
            notes_create_folder,
            notes_move,
            notes_trash,
            read_text,
            get_settings,
            update_settings,
            list_monitors,
            assign_monitor,
            set_player_fullscreen,
            show_player_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the dungeon DM tool");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_join_rejects_escapes() {
        let root = Path::new("/d");
        assert!(safe_join(root, "levels/a/level.json").is_ok());
        assert!(safe_join(root, "../x").is_err());
        assert!(safe_join(root, "a/../../x").is_err());
        assert!(safe_join(root, "/etc/passwd").is_err());
        assert!(safe_join(root, "").is_err());
    }

    #[test]
    fn sanitizes_file_names() {
        assert_eq!(sanitize_file_name("My Map (v2).PNG"), "My-Map-v2.png");
        assert_eq!(sanitize_file_name("???.jpg"), "image.jpg");
        assert_eq!(sanitize_file_name("plain"), "plain");
    }

    #[test]
    fn writes_reads_and_prunes() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let mut writes = HashMap::new();
        writes.insert("dungeon.json".to_string(), "{}".to_string());
        writes.insert("levels/l1/rooms/1.dm.md".to_string(), "hi".to_string());
        apply_changes(root, &writes, &[]).unwrap();

        fs::create_dir_all(root.join("assets")).unwrap();
        fs::write(root.join("assets/notes.md"), "ignored").unwrap();
        fs::write(root.join(".hidden.json"), "ignored").unwrap();

        let files = read_dungeon_dir(root).unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files["levels/l1/rooms/1.dm.md"], "hi");

        apply_changes(root, &HashMap::new(), &["levels/l1/rooms/1.dm.md".to_string()]).unwrap();
        assert!(!root.join("levels").exists(), "empty level folders are pruned");
        assert!(root.join("dungeon.json").exists());
    }

    #[test]
    fn imports_assets_once() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("dungeon");
        fs::create_dir_all(&root).unwrap();
        let src = tmp.path().join("Cave Map.png");
        fs::write(&src, b"png-bytes").unwrap();

        assert_eq!(import_asset_into(&root, &src, "assets").unwrap(), "assets/Cave-Map.png");
        assert_eq!(import_asset_into(&root, &src, "assets").unwrap(), "assets/Cave-Map.png");
        fs::write(&src, b"different").unwrap();
        assert_eq!(import_asset_into(&root, &src, "assets").unwrap(), "assets/Cave-Map-2.png");
        // Files already inside the dungeon are referenced in place.
        assert_eq!(
            import_asset_into(&root, &root.join("assets/Cave-Map.png"), "assets").unwrap(),
            "assets/Cave-Map.png"
        );
    }

    #[test]
    fn notes_listing_moves_and_trash() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let mut writes = HashMap::new();
        writes.insert("dungeon.json".to_string(), "{}".to_string());
        writes.insert("notes/NPCs/Belak.md".to_string(), "# Belak".to_string());
        writes.insert("notes/Background.md".to_string(), "lore".to_string());
        apply_changes(root, &writes, &[]).unwrap();
        fs::create_dir_all(root.join("notes/Empty")).unwrap();
        fs::create_dir_all(root.join("notes/attachments")).unwrap();
        fs::write(root.join("notes/attachments/map.png"), b"png").unwrap();
        fs::create_dir_all(root.join("notes/.obsidian")).unwrap();

        // Notes are not part of the dungeon file set.
        assert_eq!(read_dungeon_dir(root).unwrap().len(), 1);

        let l = list_notes(root).unwrap();
        assert_eq!(l.files.len(), 2);
        assert_eq!(l.files["NPCs/Belak.md"], "# Belak");
        assert_eq!(l.folders, vec!["Empty", "NPCs", "attachments"]);
        assert_eq!(l.attachments, vec!["attachments/map.png"]);

        move_in_notes(root, "NPCs/Belak.md", "Villains/Belak the Outcast.md").unwrap();
        assert!(root.join("notes/Villains/Belak the Outcast.md").is_file());
        assert!(move_in_notes(root, "Background.md", "Villains/Belak the Outcast.md").is_err(), "no overwrite");
        assert!(move_in_notes(root, "Villains", "Villains/Sub").is_err(), "no move into itself");
        assert!(move_in_notes(root, "../dungeon.json", "x.md").is_err(), "no escaping notes/");

        let trashed = trash_in_notes(root, "Villains").unwrap();
        assert!(trashed.starts_with(".trash/"));
        assert!(!root.join("notes/Villains").exists());
        assert!(root.join("notes").join(&trashed).join("Belak the Outcast.md").is_file());
        assert!(!list_notes(root).unwrap().folders.iter().any(|f| f.contains("trash")));
    }

    #[test]
    fn stores_attachments_uniquely() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        assert_eq!(store_bytes(root, "notes/attachments", "Pasted image.png", b"a").unwrap(), "notes/attachments/Pasted-image.png");
        assert_eq!(store_bytes(root, "notes/attachments", "Pasted image.png", b"a").unwrap(), "notes/attachments/Pasted-image.png");
        assert_eq!(store_bytes(root, "notes/attachments", "Pasted image.png", b"b").unwrap(), "notes/attachments/Pasted-image-2.png");
        assert!(store_bytes(root, "../outside", "x.png", b"a").is_err());
    }

    #[test]
    fn merges_settings_patches() {
        let s = Settings::default();
        let merged = merge_settings(&s, serde_json::json!({ "playerFullscreen": true, "dmMonitor": "Built-in" })).unwrap();
        assert!(merged.player_fullscreen);
        assert_eq!(merged.dm_monitor.as_deref(), Some("Built-in"));
        assert!(merged.recent_dungeons.is_empty());
        // Unknown keys are kept (frontend preferences).
        let merged = merge_settings(&merged, serde_json::json!({ "sfxVolume": 0.4, "generalPlaylists": [{ "id": "x" }] })).unwrap();
        assert_eq!(merged.extra["sfxVolume"], serde_json::json!(0.4));
        let again = merge_settings(&merged, serde_json::json!({ "sfxEnabled": false })).unwrap();
        assert_eq!(again.extra["generalPlaylists"][0]["id"], "x");
        assert_eq!(again.extra["sfxEnabled"], false);
    }
}
