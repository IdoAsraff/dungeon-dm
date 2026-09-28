/**
 * An in-memory stand-in for the Spotify Web API, used by tests (installed as
 * `globalThis.__spotifyFetch`). Not part of the app bundle.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface FakeTrack {
  id: string;
  name: string;
  artist: string;
  album?: string;
  durationMs?: number;
}
export interface FakePlaylist {
  id: string;
  name: string;
  owner?: string;
  collaborative?: boolean;
  tracks: FakeTrack[];
  /** Simulates a Spotify-made playlist the dev-mode API refuses to list. */
  unreadable?: boolean;
}
export interface FakeDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number | null;
  supports_volume: boolean;
}

export function createFakeSpotify(init: { playlists: FakePlaylist[]; devices?: FakeDevice[]; me?: string; premium?: boolean }) {
  const me = init.me ?? "dm";
  const playlists = init.playlists.map((p) => ({ owner: me, ...p, tracks: [...p.tracks] }));
  const devices: FakeDevice[] = init.devices ?? [{ id: "mac", name: "MacBook", type: "Computer", is_active: false, volume_percent: 60, supports_volume: true }];
  const player = {
    playing: false,
    contextUri: null as string | null,
    queue: [] as FakeTrack[],
    index: 0,
    positionMs: 0,
    since: Date.now(),
    shuffle: false,
  };
  const log: string[] = [];
  const allTracks = () => playlists.flatMap((p) => p.tracks);

  const trackJson = (t: FakeTrack) => ({
    type: "track",
    uri: `spotify:track:${t.id}`,
    id: t.id,
    name: t.name,
    artists: [{ name: t.artist }],
    album: { name: t.album ?? "Album", images: [] },
    duration_ms: t.durationMs ?? 180_000,
  });
  const playlistJson = (p: (typeof playlists)[number]) => ({
    id: p.id,
    uri: `spotify:playlist:${p.id}`,
    name: p.name,
    images: [],
    owner: { id: p.owner, display_name: p.owner },
    collaborative: !!p.collaborative,
    items: { total: p.tracks.length },
  });
  const position = () => (player.playing ? player.positionMs + (Date.now() - player.since) : player.positionMs);
  const active = () => devices.find((d) => d.is_active) ?? null;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const empty = () => new Response(null, { status: 204 });
  const fail = (status: number, message: string, reason?: string) => json({ error: { status, message, reason } }, status);

  function pickDevice(id: string | null) {
    const d = id ? devices.find((x) => x.id === id) : active();
    if (!d) return null;
    for (const x of devices) x.is_active = x === d;
    return d;
  }

  function handle(method: string, path: string, q: URLSearchParams, body: any): Response {
    if (path === "/me") return json({ id: me, display_name: "The DM" });
    if (path === "/me/playlists") return json({ items: playlists.map(playlistJson), next: null });
    let m = /^\/playlists\/([^/]+)(\/items)?$/.exec(path);
    if (m) {
      const p = playlists.find((x) => x.id === m![1]);
      if (!p || p.unreadable) return fail(404, "Resource not found");
      if (!m[2]) return json(playlistJson(p));
      if (method === "GET") return json({ items: p.tracks.map((t) => ({ item: trackJson(t) })), next: null });
      if (p.owner !== me && !p.collaborative) return fail(403, "You cannot edit this playlist");
      if (method === "POST") {
        for (const uri of body.uris as string[]) {
          const t = allTracks().find((x) => `spotify:track:${x.id}` === uri) ?? { id: uri.split(":")[2], name: uri, artist: "?" };
          p.tracks.push(t);
        }
        return json({ snapshot_id: "s" }, 201);
      }
      if (method === "DELETE") {
        const uris = new Set((body.items as { uri: string }[]).map((x) => x.uri));
        p.tracks = p.tracks.filter((t) => !uris.has(`spotify:track:${t.id}`));
        return json({ snapshot_id: "s" });
      }
    }
    m = /^\/tracks\/([^/]+)$/.exec(path);
    if (m) {
      const t = allTracks().find((x) => x.id === m![1]);
      return t ? json(trackJson(t)) : fail(404, "Resource not found");
    }
    m = /^\/albums\/([^/]+)$/.exec(path);
    if (m) return json({ id: m[1], uri: `spotify:album:${m[1]}`, name: "An Album", artists: [{ name: "Band" }], images: [], tracks: { items: allTracks().slice(0, 2).map(trackJson) } });
    if (path === "/search") {
      const needle = (q.get("q") ?? "").toLowerCase();
      return json({
        tracks: { items: allTracks().filter((t) => t.name.toLowerCase().includes(needle)).slice(0, 10).map(trackJson) },
        playlists: { items: playlists.filter((p) => p.name.toLowerCase().includes(needle)).map(playlistJson) },
        albums: { items: [] },
      });
    }
    if (path === "/me/player/devices") return json({ devices });
    if (path === "/me/player" && method === "GET") {
      const d = active();
      if (!d) return empty();
      const t = player.queue[player.index];
      return json({
        is_playing: player.playing,
        device: d,
        context: player.contextUri ? { uri: player.contextUri } : null,
        item: t ? trackJson(t) : null,
        progress_ms: Math.round(position()),
        shuffle_state: player.shuffle,
      });
    }
    if (path === "/me/player" && method === "PUT") {
      const d = pickDevice(body.device_ids[0]);
      if (!d) return fail(404, "Device not found");
      if (body.play) player.playing = true;
      return empty();
    }
    if (path.startsWith("/me/player/")) {
      if (init.premium === false) return fail(403, "Player command failed: Premium required", "PREMIUM_REQUIRED");
      const d = pickDevice(q.get("device_id"));
      if (!d) return fail(404, "Player command failed: No active device found", "NO_ACTIVE_DEVICE");
      const verb = path.slice("/me/player/".length);
      if (verb === "play") {
        if (body?.context_uri) {
          const id = body.context_uri.split(":")[2];
          const p = playlists.find((x) => x.id === id);
          player.contextUri = body.context_uri;
          player.queue = p ? p.tracks : allTracks().slice(0, 2);
        } else if (body?.uris) {
          player.contextUri = null;
          player.queue = body.uris.map((u: string) => allTracks().find((t) => `spotify:track:${t.id}` === u) ?? { id: u.split(":")[2], name: u, artist: "?" });
        }
        if (body?.offset?.uri) player.index = Math.max(0, player.queue.findIndex((t) => `spotify:track:${t.id}` === body.offset.uri));
        else if (body?.context_uri || body?.uris) player.index = 0;
        if (body?.context_uri || body?.uris) player.positionMs = body?.position_ms ?? 0;
        else player.positionMs = position();
        player.playing = true;
        player.since = Date.now();
        return empty();
      }
      if (verb === "pause") {
        player.positionMs = position();
        player.playing = false;
        return empty();
      }
      if (verb === "next" || verb === "previous") {
        player.index = Math.max(0, Math.min(player.queue.length - 1, player.index + (verb === "next" ? 1 : -1)));
        player.positionMs = 0;
        player.since = Date.now();
        return empty();
      }
      if (verb === "seek") {
        player.positionMs = Number(q.get("position_ms"));
        player.since = Date.now();
        return empty();
      }
      if (verb === "volume") {
        if (!d.supports_volume) return fail(403, "Cannot control device volume", "VOLUME_CONTROL_DISALLOW");
        d.volume_percent = Number(q.get("volume_percent"));
        return empty();
      }
      if (verb === "shuffle") {
        player.shuffle = q.get("state") === "true";
        return empty();
      }
    }
    return fail(404, `Fake Spotify has no ${method} ${path}`);
  }

  const fetch = async (url: string, reqInit?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const method = reqInit?.method ?? "GET";
    if (u.host === "accounts.spotify.com") {
      log.push(`${method} token`);
      return json({ access_token: `tok${log.length}`, refresh_token: "refresh", expires_in: 3600 });
    }
    const path = u.pathname.replace(/^\/v1/, "");
    const body = typeof reqInit?.body === "string" && reqInit.body ? JSON.parse(reqInit.body) : undefined;
    const qs = [...u.searchParams].filter(([k]) => k !== "device_id").map(([k, v]) => `${k}=${v}`).join("&");
    log.push(`${method} ${path}${qs ? `?${qs}` : ""}`);
    return handle(method, path, u.searchParams, body);
  };

  return { fetch, log, devices, playlists, player };
}
