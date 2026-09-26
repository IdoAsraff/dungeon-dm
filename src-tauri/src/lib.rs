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
            if dir == root && name == "assets" {
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

/// Copies an image into `<dungeon>/assets/` (unless it already lives inside
/// the dungeon) and returns its dungeon-relative path.
fn import_asset_into(root: &Path, source: &Path) -> Result<String, String> {
    let root = root.canonicalize().map_err(|e| format!("cannot open dungeon folder: {e}"))?;
    let source = source.canonicalize().map_err(|e| format!("cannot open {}: {e}", source.display()))?;
    if let Ok(rel) = source.strip_prefix(&root) {
        return Ok(rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/"));
    }
    let assets = root.join("assets");
    fs::create_dir_all(&assets).map_err(|e| format!("cannot create assets folder: {e}"))?;
    let file_name = source.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let clean = sanitize_file_name(&file_name);
    let (stem, ext) = match clean.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (clean.clone(), String::new()),
    };
    let bytes = fs::read(&source).map_err(|e| format!("cannot read {}: {e}", source.display()))?;
    let mut n = 1;
    loop {
        let name = if n == 1 { format!("{stem}{ext}") } else { format!("{stem}-{n}{ext}") };
        let target = assets.join(&name);
        if !target.exists() {
            fs::write(&target, &bytes).map_err(|e| format!("cannot copy image: {e}"))?;
            return Ok(format!("assets/{name}"));
        }
        // Same image imported before: reuse it.
        if fs::read(&target).map(|existing| existing == bytes).unwrap_or(false) {
            return Ok(format!("assets/{name}"));
        }
        n += 1;
    }
}

#[tauri::command]
fn import_asset(app: AppHandle, dir: String, source: String) -> Result<String, String> {
    let root = PathBuf::from(&dir);
    let rel = import_asset_into(&root, Path::new(&source))?;
    allow_assets(&app, &root);
    Ok(rel)
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

        assert_eq!(import_asset_into(&root, &src).unwrap(), "assets/Cave-Map.png");
        assert_eq!(import_asset_into(&root, &src).unwrap(), "assets/Cave-Map.png");
        fs::write(&src, b"different").unwrap();
        assert_eq!(import_asset_into(&root, &src).unwrap(), "assets/Cave-Map-2.png");
        // Files already inside the dungeon are referenced in place.
        assert_eq!(
            import_asset_into(&root, &root.join("assets/Cave-Map.png")).unwrap(),
            "assets/Cave-Map.png"
        );
    }

    #[test]
    fn merges_settings_patches() {
        let s = Settings::default();
        let merged = merge_settings(&s, serde_json::json!({ "playerFullscreen": true, "dmMonitor": "Built-in" })).unwrap();
        assert!(merged.player_fullscreen);
        assert_eq!(merged.dm_monitor.as_deref(), Some("Built-in"));
        assert!(merged.recent_dungeons.is_empty());
    }
}
