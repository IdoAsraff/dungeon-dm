/**
 * Boots the real app (src/main.tsx) in an iframe with the Tauri backend mocked.
 * The dungeon folder is the in-memory `top.__fs` built by fixture.mjs; Spotify is
 * src/spotify/fakeSpotify.ts. Add a `case` below when the app calls a new command.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { createFakeSpotify } from "../../src/spotify/fakeSpotify";

const DIR = "/tools/e2e/fx";
const label = new URLSearchParams(location.search).get("label")!;
mockWindows(label);
mockConvertFileSrc("macos");
// Asset URLs are plain paths, so Vite serves the fixture's images.
(window as any).__TAURI_INTERNALS__.convertFileSrc = (p: string) => p;
const top = window.top as any;
const fs: { dungeon: Record<string, string>; notes: Record<string, string>; attachments: string[] } = top.__fs;

// Fake Spotify (playlist ids must be ≥10 characters or link parsing ignores them).
const T = (id: string, name: string, artist = "Bard", durationMs = 200_000) => ({ id: id.padEnd(22, "0"), name, artist, durationMs });
if (label === "dm") {
  top.__fake = createFakeSpotify({
    playlists: [
      { id: "tavernnights", name: "Tavern Nights", tracks: [T("t1", "The Drunken Dwarf"), T("t2", "Hearth and Ale", "Minstrels"), T("t3", "Rainy Inn")] },
      { id: "epicbattle1", name: "Epic Battle", tracks: [T("b1", "Steel Rain", "War Drums"), T("b2", "Last Stand", "War Drums")] },
      { id: "dungeonamb1", name: "Dungeon Ambience", tracks: [T("d1", "Dripping Caves", "Dark"), T("d2", "Deep Halls", "Dark")] },
      { id: "friendsmix1", name: "Friend's Mix", owner: "friend", tracks: [T("f1", "Borrowed Tune", "Friend")] },
      { id: "spotifymix1", name: "Daily Mix 1", owner: "spotify", unreadable: true, tracks: [T("s1", "Algorithmic Song")] },
    ],
  });
  (window as any).__spotifyFetch = top.__fake.fetch;
}

const listeners = new Map<string, number[]>();
(window as any).__deliver = (event: string, payload: unknown) => {
  for (const h of listeners.get(event) ?? []) (window as any).__TAURI_INTERNALS__.runCallback(h, { event, id: h, payload });
};
top.__settings ??= {
  recentDungeons: [DIR],
  dmMonitor: null,
  playerMonitor: null,
  playerFullscreen: false,
  ...(top.__spotifyMode === "connected"
    ? { spotify: { clientId: "0123456789abcdef0123456789abcdef", refreshToken: "refresh", accessToken: "tok", expiresAt: Date.now() + 3_600_000 } }
    : {}),
};

const folders = () => [...new Set(Object.keys(fs.notes).flatMap((p) => p.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"))))];

mockIPC(async (cmd, args: any) => {
  top.__calls.push(cmd);
  switch (cmd) {
    case "plugin:event|listen":
      listeners.set(args.event, [...(listeners.get(args.event) ?? []), args.handler]);
      return args.handler;
    case "plugin:event|emit":
      top.__bus(args.event, args.payload);
      return null;
    case "load_dungeon":
      return { ...fs.dungeon };
    case "dungeon_exists":
      return true;
    case "load_notes":
      return { files: { ...fs.notes }, folders: folders(), attachments: fs.attachments };
    case "read_text":
      return fs.dungeon[args.path] ?? null;
    case "save_files":
      top.__saved.push(args.writes);
      for (const [p, c] of Object.entries(args.writes as Record<string, string>)) {
        fs.dungeon[p] = c;
        if (p.startsWith("notes/")) fs.notes[p.slice(6)] = c;
      }
      for (const p of (args.deletes ?? []) as string[]) {
        delete fs.dungeon[p];
        if (p.startsWith("notes/")) delete fs.notes[p.slice(6)];
      }
      return null;
    case "get_settings":
      return top.__settings;
    case "update_settings":
      Object.assign(top.__settings, args.patch);
      return top.__settings;
    case "spotify_authorize": {
      top.__authUrl = args.authUrl;
      const state = new URL(args.authUrl).searchParams.get("state");
      await new Promise((r) => setTimeout(r, 400));
      return `code=fakecode&state=${state}`;
    }
    case "open_spotify":
      top.__fake.devices.push({ id: "mac", name: "MacBook", type: "Computer", is_active: false, volume_percent: 60, supports_volume: true });
      return null;
    default:
      // list_monitors, show_player_window, notes_move/trash, import_asset, ... are no-ops here.
      return null;
  }
});

await import("../../src/main.tsx");
