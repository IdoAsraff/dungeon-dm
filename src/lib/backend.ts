/** Thin typed wrappers around the Rust commands in src-tauri/src/lib.rs. */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { FileMap } from "./serialize";

export interface Settings {
  recentDungeons: string[];
  dmMonitor: string | null;
  playerMonitor: string | null;
  playerFullscreen: boolean;
}

export interface MonitorInfo {
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  scaleFactor: number;
  primary: boolean;
}

export interface NotesListing {
  /** Note path relative to notes/ -> markdown. */
  files: Record<string, string>;
  folders: string[];
  /** Non-markdown files (images, PDFs...) relative to notes/. */
  attachments: string[];
}

export const backend = {
  loadDungeon: (dir: string) => invoke<FileMap>("load_dungeon", { dir }),
  dungeonExists: (dir: string) => invoke<boolean>("dungeon_exists", { dir }),
  saveFiles: (dir: string, writes: FileMap, deletes: string[]) =>
    invoke<void>("save_files", { dir, writes, deletes }),
  /** Copies an image into `<dungeon>/<subdir>` (default assets/); returns its root-relative path. */
  importAsset: (dir: string, source: string, subdir?: string) =>
    invoke<string>("import_asset", { dir, source, subdir: subdir ?? null }),
  /** Stores pasted/dropped image data (base64) under `<dungeon>/<subdir>`; returns its root-relative path. */
  saveAttachment: (dir: string, subdir: string, name: string, base64: string) =>
    invoke<string>("save_attachment", { dir, subdir, name, base64 }),
  loadNotes: (dir: string) => invoke<NotesListing>("load_notes", { dir }),
  notesCreateFolder: (dir: string, path: string) => invoke<void>("notes_create_folder", { dir, path }),
  notesMove: (dir: string, from: string, to: string) => invoke<void>("notes_move", { dir, from, to }),
  /** Moves a note or folder into notes/.trash; returns its path there. */
  notesTrash: (dir: string, path: string) => invoke<string>("notes_trash", { dir, path }),
  readText: (dir: string, path: string) => invoke<string | null>("read_text", { dir, path }),
  getSettings: () => invoke<Settings>("get_settings"),
  updateSettings: (patch: Partial<Settings>) => invoke<Settings>("update_settings", { patch }),
  listMonitors: () => invoke<MonitorInfo[]>("list_monitors"),
  /** Moves a window to the named monitor and remembers the choice. */
  assignMonitor: (label: "dm" | "player", monitor: string | null) =>
    invoke<void>("assign_monitor", { label, monitor }),
  setPlayerFullscreen: (on: boolean) => invoke<void>("set_player_fullscreen", { on }),
  showPlayerWindow: () => invoke<void>("show_player_window"),
};

const joinPath = (dir: string, rel: string) => `${dir.replace(/[\\/]+$/, "")}/${rel}`;

/** URL the webview can load for a root-relative dungeon asset path. */
export function assetUrl(dir: string, rel: string): string {
  if (/^([a-z][a-z0-9+.-]*:)/i.test(rel)) return rel;
  return convertFileSrc(joinPath(dir, rel));
}

/** Reverse of assetUrl for paths inside `dir`; returns null for anything else. */
export function assetUrlToPath(dir: string, url: string): string | null {
  const prefix = convertFileSrc(joinPath(dir, ""));
  if (!url.startsWith(prefix)) return null;
  return decodeURIComponent(url.slice(prefix.length));
}
