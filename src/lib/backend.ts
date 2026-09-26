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

export const backend = {
  loadDungeon: (dir: string) => invoke<FileMap>("load_dungeon", { dir }),
  dungeonExists: (dir: string) => invoke<boolean>("dungeon_exists", { dir }),
  saveFiles: (dir: string, writes: FileMap, deletes: string[]) =>
    invoke<void>("save_files", { dir, writes, deletes }),
  /** Copies an image into the dungeon's assets/ folder; returns its root-relative path. */
  importAsset: (dir: string, source: string) => invoke<string>("import_asset", { dir, source }),
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
