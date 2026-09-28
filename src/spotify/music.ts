/**
 * Music state: Spotify connection, playlists, the open playlist, search,
 * and playback on the user's Spotify device (with fades and resume).
 */
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { usePrefs, type PlaylistRef, type Transition } from "../lib/prefs";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { useNotes } from "../notes/store";
import * as sp from "./api";
import { SpotifyError } from "./http";
import { isConnected } from "./auth";
import { parseSpotifyLink, playlistMarkdown, type SpotifyLink } from "./links";

/** The playlist or album shown in the middle of the Music view. */
export interface OpenList {
  kind: "playlist" | "album";
  id: string;
  uri: string;
  /** Name/cover known before loading (from a pinned list). */
  ref: PlaylistRef | null;
  meta: sp.SpPlaylist | sp.SpAlbum | null;
  tracks: sp.SpTrack[];
  loading: boolean;
  error: string | null;
}

interface MusicState {
  me: { id: string; name: string } | null;
  myPlaylists: sp.SpPlaylist[];
  loadingPlaylists: boolean;
  open: OpenList | null;
  searchQuery: string;
  results: { tracks: sp.SpTrack[]; playlists: sp.SpPlaylist[]; albums: sp.SpAlbum[] } | null;
  searching: boolean;
  /** What the middle of the Music view shows. */
  center: "open" | "search";
  player: sp.SpPlayer | null;
  /** When `player` was fetched (to advance the progress bar between polls). */
  polledAt: number;
  devices: sp.SpDevice[];
  /** Set when there is no Spotify app to play on. */
  noDevice: boolean;
  /** A transition (fade) is running. */
  switching: boolean;
  error: string | null;
  set: (p: Partial<MusicState>) => void;
}

export const useMusic = create<MusicState>()((set) => ({
  me: null,
  myPlaylists: [],
  loadingPlaylists: false,
  open: null,
  searchQuery: "",
  results: null,
  searching: false,
  center: "open",
  player: null,
  polledAt: 0,
  devices: [],
  noDevice: false,
  switching: false,
  error: null,
  set: (p) => set(p),
}));

const get = () => useMusic.getState();
const patch = (p: Partial<MusicState>) => useMusic.getState().set(p);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function describe(e: unknown): string {
  if (e instanceof SpotifyError) {
    if (e.status === 403 && /premium/i.test(e.message + (e.reason ?? ""))) return "Spotify Premium is needed to control playback.";
    if (e.status === 404 && /device/i.test(e.message)) return "No active Spotify device. Open Spotify and try again.";
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

function report(e: unknown) {
  const msg = describe(e);
  patch({ error: msg });
  useUi.getState().showToast(`🎵 ${msg}`);
}

// ---- loading -----------------------------------------------------------------------

export async function loadLibrary() {
  if (!isConnected(usePrefs.getState().spotify)) return;
  patch({ loadingPlaylists: true, error: null });
  try {
    const [me, myPlaylists] = await Promise.all([sp.getMe(), sp.getMyPlaylists()]);
    patch({ me, myPlaylists });
  } catch (e) {
    report(e);
  } finally {
    patch({ loadingPlaylists: false });
  }
}

export async function openPlaylist(id: string, known?: sp.SpPlaylist | PlaylistRef) {
  const meta = known && "uri" in known ? known : (get().myPlaylists.find((p) => p.id === id) ?? null);
  const ref = known ? toRef(known) : null;
  const base: OpenList = { kind: "playlist", id, uri: `spotify:playlist:${id}`, ref, meta, tracks: [], loading: true, error: null };
  patch({ open: base, center: "open" });
  const still = () => get().open?.kind === "playlist" && get().open?.id === id;
  try {
    const [m, tracks] = await Promise.all([meta ? Promise.resolve(meta) : sp.getPlaylist(id).catch(() => null), sp.getPlaylistTracks(id)]);
    if (still()) patch({ open: { ...base, meta: m, tracks, loading: false } });
  } catch (e) {
    const msg =
      e instanceof SpotifyError && (e.status === 404 || e.status === 403)
        ? "Spotify doesn't let this tool list the songs of this playlist (playlists made by Spotify often can't be read). You can still play it with ▶."
        : describe(e);
    if (still()) patch({ open: { ...base, loading: false, error: msg } });
  }
}

export async function openAlbum(id: string) {
  const base: OpenList = { kind: "album", id, uri: `spotify:album:${id}`, ref: null, meta: null, tracks: [], loading: true, error: null };
  patch({ open: base, center: "open" });
  const still = () => get().open?.kind === "album" && get().open?.id === id;
  try {
    const { album, tracks } = await sp.getAlbum(id);
    if (still()) patch({ open: { ...base, meta: album, tracks, loading: false } });
  } catch (e) {
    if (still()) patch({ open: { ...base, loading: false, error: describe(e) } });
  }
}

let searchSeq = 0;
export async function runSearch(q: string) {
  patch({ searchQuery: q });
  const query = q.trim();
  if (!query) return patch({ results: null, searching: false, center: "open" });
  patch({ center: "search" });
  const seq = ++searchSeq;
  patch({ searching: true });
  try {
    const results = await sp.search(query);
    if (seq === searchSeq) patch({ results });
  } catch (e) {
    if (seq === searchSeq) report(e);
  } finally {
    if (seq === searchSeq) patch({ searching: false });
  }
}

// ---- polling ---------------------------------------------------------------------------

/** Where each playlist/album was left: resumed when you switch back to it. */
const resumeAt = new Map<string, { trackUri: string; positionMs: number }>();
let lastPoll = 0;

function remember(p: sp.SpPlayer | null) {
  if (p?.contextUri && p.track) resumeAt.set(p.contextUri, { trackUri: p.track.uri, positionMs: p.progressMs });
}

export async function refreshPlayer() {
  if (!isConnected(usePrefs.getState().spotify)) return;
  try {
    const player = await sp.getPlayer();
    lastPoll = Date.now();
    if (player?.isPlaying) remember(player);
    patch({ player, polledAt: lastPoll, noDevice: player ? false : get().noDevice });
  } catch (e) {
    if (!(e instanceof SpotifyError && e.status === 401)) console.warn("player poll failed", e);
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
/** Polls the player: often while music plays or the Music view is open, rarely otherwise. */
export function startPolling() {
  if (pollTimer) return;
  void refreshPlayer();
  pollTimer = setInterval(() => {
    if (get().switching) return;
    const busy = get().player?.isPlaying || useNotes.getState().mainView === "music";
    if (Date.now() - lastPoll > (busy ? 2000 : 10000)) void refreshPlayer();
  }, 2500);
}
export function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// ---- playback ---------------------------------------------------------------------------

/** One command at a time, so fades and clicks don't interleave. */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T | undefined> {
  const run = queue.then(fn).catch((e) => {
    report(e);
    return undefined;
  });
  queue = run;
  return run;
}

/** Picks a device to play on: the active one, else this Mac's Spotify, else any. */
async function targetDevice(): Promise<sp.SpDevice | null> {
  const active = get().player?.device;
  if (active?.isActive) return active;
  const devices = await sp.getDevices();
  patch({ devices });
  const pick = devices.find((d) => d.isActive) ?? devices.find((d) => d.type === "Computer") ?? devices[0] ?? null;
  patch({ noDevice: !pick });
  return pick;
}

const FADE_MS: Record<Transition, number> = { cut: 0, short: 1500, slow: 4000 };

async function ramp(deviceId: string, from: number, to: number, ms: number) {
  const steps = Math.max(2, Math.round(ms / 180));
  for (let i = 1; i <= steps; i++) {
    await sp.setVolume(from + ((to - from) * i) / steps, deviceId);
    await sleep(ms / steps);
  }
}

/**
 * Starts `what` on the user's device, fading out whatever is playing first
 * and fading back in (according to the Transition preference).
 */
async function startPlayback(what: { contextUri?: string; uris?: string[]; offsetUri?: string; positionMs?: number }) {
  const device = await targetDevice();
  if (!device) throw new Error("No Spotify app is open. Click “Open Spotify”, then try again.");
  const current = get().player;
  remember(current?.isPlaying ? { ...current, progressMs: current.progressMs + (Date.now() - lastPoll) } : null);
  const fade = FADE_MS[usePrefs.getState().musicTransition];
  const volume = device.volume ?? current?.device?.volume ?? null;
  const canFade = fade > 0 && !!current?.isPlaying && device.supportsVolume && volume !== null && volume > 0;
  patch({ switching: true });
  try {
    if (canFade) await ramp(device.id, volume!, 0, fade / 2);
    await sp.play({ deviceId: device.id, ...what });
    if (canFade) {
      await sleep(350);
      await ramp(device.id, 0, volume!, fade / 2);
    }
  } finally {
    patch({ switching: false });
    setTimeout(() => void refreshPlayer(), 400);
  }
}

/** Plays a playlist or album, resuming where it was left (unless a track is given). */
export function playContext(contextUri: string, opts: { trackUri?: string; resume?: boolean } = {}) {
  return enqueue(async () => {
    const saved = opts.resume === false || opts.trackUri ? undefined : resumeAt.get(contextUri);
    await startPlayback({
      contextUri,
      offsetUri: opts.trackUri ?? saved?.trackUri,
      positionMs: opts.trackUri ? undefined : saved?.positionMs,
    });
  });
}

export function playTrack(uri: string) {
  return enqueue(() => startPlayback({ uris: [uri] }));
}

export function playLink(link: SpotifyLink) {
  return link.kind === "track" ? playTrack(link.uri) : playContext(link.uri);
}

export function togglePlay() {
  return enqueue(async () => {
    const p = get().player;
    if (p?.isPlaying) {
      await sp.pause(p.device?.id);
      patch({ player: { ...p, isPlaying: false } });
    } else {
      const device = await targetDevice();
      if (!device) throw new Error("No Spotify app is open. Click “Open Spotify”, then try again.");
      await sp.play({ deviceId: device.id });
      if (p) patch({ player: { ...p, isPlaying: true } });
    }
    setTimeout(() => void refreshPlayer(), 400);
  });
}

export const skipNext = () => enqueue(async () => (await sp.next(get().player?.device?.id), setTimeout(() => void refreshPlayer(), 500)));
export const skipPrevious = () => enqueue(async () => (await sp.previous(get().player?.device?.id), setTimeout(() => void refreshPlayer(), 500)));
export const seekTo = (ms: number) => enqueue(async () => (await sp.seek(ms, get().player?.device?.id), setTimeout(() => void refreshPlayer(), 300)));
export const changeVolume = (v: number) =>
  enqueue(async () => {
    const p = get().player;
    await sp.setVolume(v, p?.device?.id);
    if (p?.device) patch({ player: { ...p, device: { ...p.device, volume: v } } });
  });
export const toggleShuffle = () =>
  enqueue(async () => {
    const p = get().player;
    await sp.setShuffle(!p?.shuffle, p?.device?.id);
    if (p) patch({ player: { ...p, shuffle: !p.shuffle } });
  });
export const switchDevice = (id: string) => enqueue(async () => (await sp.transfer(id, !!get().player?.isPlaying), setTimeout(() => void refreshPlayer(), 600)));

export async function loadDevices() {
  try {
    patch({ devices: await sp.getDevices() });
  } catch (e) {
    report(e);
  }
}

export async function openSpotifyApp() {
  try {
    await invoke("open_spotify");
    patch({ noDevice: false });
    // Give the app a moment to register as a device.
    setTimeout(() => void loadDevices(), 3000);
  } catch (e) {
    report(e);
  }
}

// ---- editing playlists ------------------------------------------------------------------

/** Your playlists you can add songs to (your own and collaborative ones). */
export function editablePlaylists(): sp.SpPlaylist[] {
  return get().myPlaylists.filter(canEdit);
}

export function canEdit(p: sp.SpPlaylist | null): boolean {
  const me = get().me;
  return !!p && !!me && (p.ownerId === me.id || p.collaborative);
}

function bumpTotal(playlistId: string, by: number) {
  patch({ myPlaylists: get().myPlaylists.map((p) => (p.id === playlistId && p.total !== null ? { ...p, total: Math.max(0, p.total + by) } : p)) });
}

export async function addTrackToPlaylist(playlistId: string, track: sp.SpTrack) {
  try {
    await sp.addToPlaylist(playlistId, [track.uri]);
    const open = get().open;
    if (open?.kind === "playlist" && open.id === playlistId && !open.loading) patch({ open: { ...open, tracks: [...open.tracks, track] } });
    bumpTotal(playlistId, 1);
    const name = get().myPlaylists.find((p) => p.id === playlistId)?.name ?? "the playlist";
    useUi.getState().showToast(`Added “${track.name}” to ${name}`);
  } catch (e) {
    report(e);
  }
}

export async function removeTrackFromPlaylist(playlistId: string, track: sp.SpTrack) {
  try {
    await sp.removeFromPlaylist(playlistId, track.uri);
    const open = get().open;
    const removed = open?.kind === "playlist" && open.id === playlistId ? open.tracks.filter((t) => t.uri === track.uri).length : 1;
    if (open?.kind === "playlist" && open.id === playlistId) patch({ open: { ...open, tracks: open.tracks.filter((t) => t.uri !== track.uri) } });
    bumpTotal(playlistId, -removed);
  } catch (e) {
    report(e);
  }
}

// ---- pinned lists ("This dungeon" and "General") ---------------------------------------------

export function toRef(p: sp.SpPlaylist | PlaylistRef): PlaylistRef {
  return { id: p.id, name: p.name, image: p.image ?? null };
}

export function dungeonPlaylists(): PlaylistRef[] {
  return useDoc.getState().dungeon?.playlists ?? [];
}

export function pin(where: "dungeon" | "general", p: sp.SpPlaylist | PlaylistRef) {
  const ref = toRef(p);
  if (where === "dungeon") {
    const list = dungeonPlaylists();
    if (!list.some((x) => x.id === ref.id)) useDoc.getState().setPlaylists([...list, ref]);
  } else {
    const list = usePrefs.getState().generalPlaylists;
    if (!list.some((x) => x.id === ref.id)) usePrefs.getState().update({ generalPlaylists: [...list, ref] });
  }
}

export function unpin(where: "dungeon" | "general", id: string) {
  if (where === "dungeon") useDoc.getState().setPlaylists(dungeonPlaylists().filter((p) => p.id !== id));
  else usePrefs.getState().update({ generalPlaylists: usePrefs.getState().generalPlaylists.filter((p) => p.id !== id) });
}

export function reorderPinned(where: "dungeon" | "general", from: number, to: number) {
  const list = where === "dungeon" ? [...dungeonPlaylists()] : [...usePrefs.getState().generalPlaylists];
  const [item] = list.splice(from, 1);
  if (!item) return;
  list.splice(Math.max(0, Math.min(to, list.length)), 0, item);
  if (where === "dungeon") useDoc.getState().setPlaylists(list);
  else usePrefs.getState().update({ generalPlaylists: list });
}

/** Playlists offered by the [[ autocomplete: this dungeon's first, then General. */
export function pinnedPlaylists(): { ref: PlaylistRef; where: "dungeon" | "general" }[] {
  const seen = new Set<string>();
  const out: { ref: PlaylistRef; where: "dungeon" | "general" }[] = [];
  for (const ref of dungeonPlaylists()) if (!seen.has(ref.id)) (seen.add(ref.id), out.push({ ref, where: "dungeon" }));
  for (const ref of usePrefs.getState().generalPlaylists) if (!seen.has(ref.id)) (seen.add(ref.id), out.push({ ref, where: "general" }));
  return out;
}

// ---- links in text ------------------------------------------------------------------------

/** Plays a Spotify link from a note or room text; with `open`, shows it in the Music view. */
export function playSpotifyLink(url: string, opts: { open: boolean }) {
  const link = parseSpotifyLink(url);
  if (!link) return;
  if (!isConnected(usePrefs.getState().spotify)) {
    useNotes.getState().set({ mainView: "music" });
    useUi.getState().showToast("🎵 Connect Spotify first to play music links.");
    return;
  }
  if (!opts.open) return void playLink(link);
  useNotes.getState().set({ mainView: "music" });
  if (link.kind === "playlist") {
    const known = get().myPlaylists.find((p) => p.id === link.id) ?? pinnedPlaylists().find((p) => p.ref.id === link.id)?.ref;
    void openPlaylist(link.id, known);
  } else if (link.kind === "album") void openAlbum(link.id);
  else
    void sp
      .getTrack(link.id)
      .then((t) => t && runSearch(`${t.name} ${t.artists}`))
      .catch(report);
}

/** Names of linked songs/playlists/albums, looked up once per app run. */
const linkNames = new Map<string, string>();
const lookedUp = new Set<string>();
let redrawTimer: ReturnType<typeof setTimeout> | null = null;

function redrawEditors() {
  if (redrawTimer) return;
  redrawTimer = setTimeout(() => {
    redrawTimer = null;
    useNotes.getState().set({ indexVersion: useNotes.getState().indexVersion + 1 });
  }, 150);
}

const KIND_LABEL = { playlist: "Spotify playlist", track: "Spotify song", album: "Spotify album" } as const;

/** What a bare Spotify URL in text shows as. */
export function spotifyLinkLabel(url: string): string {
  const link = parseSpotifyLink(url);
  if (!link) return "Spotify";
  const cached = linkNames.get(link.uri);
  if (cached) return cached;
  if (link.kind === "playlist") {
    const known = pinnedPlaylists().find((p) => p.ref.id === link.id)?.ref ?? get().myPlaylists.find((p) => p.id === link.id);
    if (known) return `🎵 ${known.name}`;
  }
  if (isConnected(usePrefs.getState().spotify) && !lookedUp.has(link.uri)) {
    lookedUp.add(link.uri);
    const lookup =
      link.kind === "track"
        ? sp.getTrack(link.id).then((t) => t && `${t.name} — ${t.artists}`)
        : link.kind === "album"
          ? sp.getAlbum(link.id).then(({ album }) => album && `💿 ${album.name}`)
          : sp.getPlaylist(link.id).then((p) => p && `🎵 ${p.name}`);
    lookup
      .then((name) => {
        if (name) (linkNames.set(link.uri, name), redrawEditors());
      })
      .catch(() => {});
  }
  return KIND_LABEL[link.kind];
}

export function playlistCompletions() {
  return pinnedPlaylists().map(({ ref, where }) => ({
    name: ref.name,
    markdown: playlistMarkdown(ref.name, ref.id),
    detail: where === "dungeon" ? "This dungeon" : "General",
  }));
}
