/**
 * Typed wrappers around the Spotify Web API calls the Music view needs,
 * normalized into small shapes (and tolerant of the February 2026 renames:
 * playlist `tracks` → `items`, playlist item `track` → `item`).
 */
import { api } from "./http";

export interface SpImage {
  url: string;
}
export interface SpTrack {
  uri: string;
  id: string;
  name: string;
  artists: string;
  album: string;
  image: string | null;
  durationMs: number;
}
export interface SpPlaylist {
  id: string;
  uri: string;
  name: string;
  image: string | null;
  ownerId: string;
  ownerName: string;
  collaborative: boolean;
  total: number | null;
}
export interface SpAlbum {
  id: string;
  uri: string;
  name: string;
  artists: string;
  image: string | null;
}
export interface SpDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  volume: number | null;
  supportsVolume: boolean;
}
export interface SpPlayer {
  isPlaying: boolean;
  device: SpDevice | null;
  contextUri: string | null;
  track: SpTrack | null;
  progressMs: number;
  shuffle: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const pickImage = (images: SpImage[] | undefined, prefer = 300): string | null => {
  if (!images?.length) return null;
  const sorted = [...images].sort((a: any, b: any) => Math.abs((a.width ?? prefer) - prefer) - Math.abs((b.width ?? prefer) - prefer));
  return sorted[0]?.url ?? null;
};

export function toTrack(t: any): SpTrack | null {
  if (!t || t.type === "episode" || !t.uri || t.is_local) return null;
  return {
    uri: t.uri,
    id: t.id,
    name: t.name,
    artists: (t.artists ?? []).map((a: any) => a.name).join(", "),
    album: t.album?.name ?? "",
    image: pickImage(t.album?.images, 64),
    durationMs: t.duration_ms ?? 0,
  };
}

export function toPlaylist(p: any): SpPlaylist | null {
  if (!p?.id) return null;
  const total = p.items?.total ?? p.tracks?.total ?? null;
  return {
    id: p.id,
    uri: p.uri ?? `spotify:playlist:${p.id}`,
    name: p.name ?? "Untitled playlist",
    image: pickImage(p.images),
    ownerId: p.owner?.id ?? "",
    ownerName: p.owner?.display_name ?? p.owner?.id ?? "",
    collaborative: !!p.collaborative,
    total,
  };
}

export function toAlbum(a: any): SpAlbum | null {
  if (!a?.id) return null;
  return { id: a.id, uri: a.uri, name: a.name, artists: (a.artists ?? []).map((x: any) => x.name).join(", "), image: pickImage(a.images) };
}

function toDevice(d: any): SpDevice | null {
  if (!d?.id) return null;
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    isActive: !!d.is_active,
    volume: typeof d.volume_percent === "number" ? d.volume_percent : null,
    supportsVolume: d.supports_volume !== false,
  };
}

export async function getMe(): Promise<{ id: string; name: string }> {
  const me = await api<any>("GET", "/me");
  return { id: me?.id ?? "", name: me?.display_name ?? me?.id ?? "" };
}

export async function getMyPlaylists(): Promise<SpPlaylist[]> {
  const out: SpPlaylist[] = [];
  for (let offset = 0; offset < 1000; offset += 50) {
    const page = await api<any>("GET", "/me/playlists", { query: { limit: 50, offset } });
    for (const p of page?.items ?? []) {
      const pl = toPlaylist(p);
      if (pl) out.push(pl);
    }
    if (!page?.next) break;
  }
  return out;
}

export async function getPlaylist(id: string): Promise<SpPlaylist | null> {
  return toPlaylist(await api<any>("GET", `/playlists/${id}`, { query: { fields: "id,uri,name,images,owner(id,display_name),collaborative,items(total),tracks(total)" } }));
}

export async function getPlaylistTracks(id: string): Promise<SpTrack[]> {
  const out: SpTrack[] = [];
  for (let offset = 0; offset < 2000; offset += 50) {
    const page = await api<any>("GET", `/playlists/${id}/items`, { query: { limit: 50, offset } });
    for (const it of page?.items ?? []) {
      const t = toTrack(it.item ?? it.track);
      if (t) out.push(t);
    }
    if (!page?.next) break;
  }
  return out;
}

export async function getAlbum(id: string): Promise<{ album: SpAlbum | null; tracks: SpTrack[] }> {
  const a = await api<any>("GET", `/albums/${id}`);
  const album = toAlbum(a);
  const tracks = (a?.tracks?.items ?? []).map((t: any) => toTrack({ ...t, album: a })).filter(Boolean) as SpTrack[];
  return { album, tracks };
}

export async function getTrack(id: string): Promise<SpTrack | null> {
  return toTrack(await api<any>("GET", `/tracks/${id}`));
}

export async function search(q: string): Promise<{ tracks: SpTrack[]; playlists: SpPlaylist[]; albums: SpAlbum[] }> {
  const r = await api<any>("GET", "/search", { query: { q, type: "track,playlist,album", limit: 10 } });
  return {
    tracks: (r?.tracks?.items ?? []).map(toTrack).filter(Boolean),
    playlists: (r?.playlists?.items ?? []).map(toPlaylist).filter(Boolean),
    albums: (r?.albums?.items ?? []).map(toAlbum).filter(Boolean),
  };
}

export async function addToPlaylist(playlistId: string, uris: string[]) {
  await api("POST", `/playlists/${playlistId}/items`, { body: { uris } });
}

export async function removeFromPlaylist(playlistId: string, uri: string) {
  await api("DELETE", `/playlists/${playlistId}/items`, { body: { items: [{ uri }] } });
}

// ---- player ------------------------------------------------------------------------

export async function getPlayer(): Promise<SpPlayer | null> {
  const p = await api<any>("GET", "/me/player");
  if (!p) return null;
  return {
    isPlaying: !!p.is_playing,
    device: toDevice(p.device),
    contextUri: p.context?.uri ?? null,
    track: toTrack(p.item),
    progressMs: p.progress_ms ?? 0,
    shuffle: !!p.shuffle_state,
  };
}

export async function getDevices(): Promise<SpDevice[]> {
  const r = await api<any>("GET", "/me/player/devices");
  return (r?.devices ?? []).map(toDevice).filter(Boolean);
}

export async function play(opts: { deviceId?: string; contextUri?: string; uris?: string[]; offsetUri?: string; positionMs?: number }) {
  const body: Record<string, unknown> = {};
  if (opts.contextUri) body.context_uri = opts.contextUri;
  if (opts.uris) body.uris = opts.uris;
  if (opts.offsetUri) body.offset = { uri: opts.offsetUri };
  if (opts.positionMs) body.position_ms = Math.max(0, Math.round(opts.positionMs));
  await api("PUT", "/me/player/play", { query: { device_id: opts.deviceId }, body: Object.keys(body).length ? body : undefined });
}

export const pause = (deviceId?: string) => api("PUT", "/me/player/pause", { query: { device_id: deviceId } });
export const next = (deviceId?: string) => api("POST", "/me/player/next", { query: { device_id: deviceId } });
export const previous = (deviceId?: string) => api("POST", "/me/player/previous", { query: { device_id: deviceId } });
export const seek = (ms: number, deviceId?: string) => api("PUT", "/me/player/seek", { query: { position_ms: Math.round(ms), device_id: deviceId } });
export const setVolume = (percent: number, deviceId?: string) =>
  api("PUT", "/me/player/volume", { query: { volume_percent: Math.max(0, Math.min(100, Math.round(percent))), device_id: deviceId } });
export const setShuffle = (on: boolean, deviceId?: string) => api("PUT", "/me/player/shuffle", { query: { state: on, device_id: deviceId } });
export const transfer = (deviceId: string, playNow: boolean) => api("PUT", "/me/player", { body: { device_ids: [deviceId], play: playNow } });
