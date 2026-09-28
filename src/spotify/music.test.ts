import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePrefs } from "../lib/prefs";
import { useDoc } from "../store/doc";
import { createFakeSpotify } from "./fakeSpotify";
import {
  addTrackToPlaylist,
  canEdit,
  loadLibrary,
  openPlaylist,
  removeTrackFromPlaylist,
  runSearch,
  pin,
  pinnedPlaylists,
  playlistCompletions,
  spotifyLinkLabel,
  playContext,
  playTrack,
  refreshPlayer,
  reorderPinned,
  togglePlay,
  unpin,
  useMusic,
} from "./music";

vi.mock("../lib/backend", () => ({ backend: { updateSettings: async () => {}, getSettings: async () => ({}) } }));

const t = (id: string, name = id) => ({ id: `${id}0000000000`, name, artist: "Bard" });
const uri = (id: string) => `spotify:track:${id}0000000000`;
let fake: ReturnType<typeof createFakeSpotify>;

beforeEach(() => {
  fake = createFakeSpotify({
    playlists: [
      { id: "tavern", name: "Tavern", tracks: [t("a"), t("b"), t("c")] },
      { id: "battle", name: "Battle", tracks: [t("x"), t("y")] },
      { id: "spotifymix", name: "Daily Mix", owner: "spotify", tracks: [t("z")], unreadable: true },
    ],
  });
  (globalThis as unknown as { __spotifyFetch: unknown }).__spotifyFetch = fake.fetch;
  usePrefs.setState({
    spotify: { clientId: "c", refreshToken: "r", accessToken: "tok", expiresAt: Date.now() + 3_600_000 },
    musicTransition: "cut",
    generalPlaylists: [],
  });
  useDoc.setState({ dungeon: { name: "D", levels: [], playlists: [] } });
  useMusic.getState().set({ player: null, open: null, noDevice: false });
});

const playing = async () => {
  await refreshPlayer();
  const p = useMusic.getState().player!;
  return { context: p.contextUri, track: p.track?.uri, playing: p.isPlaying, pos: p.progressMs };
};

describe("playback", () => {
  it("starts on this Mac's Spotify when no device is active", async () => {
    await playContext("spotify:playlist:tavern");
    expect(fake.devices[0].is_active).toBe(true);
    expect(await playing()).toMatchObject({ context: "spotify:playlist:tavern", track: uri("a"), playing: true });
  });

  it("reports a missing Spotify app instead of failing silently", async () => {
    fake.devices.splice(0);
    const toast = vi.fn();
    const { useUi } = await import("../store/ui");
    useUi.setState({ showToast: toast });
    await playContext("spotify:playlist:tavern");
    expect(useMusic.getState().noDevice).toBe(true);
    expect(toast.mock.calls[0][0]).toMatch(/Open Spotify/);
  });

  it("resumes a playlist where it was left", async () => {
    await playContext("spotify:playlist:tavern", { trackUri: uri("b") });
    fake.player.positionMs = 42_000;
    fake.player.since = Date.now();
    await refreshPlayer();
    await playContext("spotify:playlist:battle");
    expect((await playing()).track).toBe(uri("x"));
    await playContext("spotify:playlist:tavern");
    const now = await playing();
    expect(now.track).toBe(uri("b"));
    expect(now.pos).toBeGreaterThanOrEqual(42_000);
    // "From the start" ignores the saved spot.
    await playContext("spotify:playlist:tavern", { resume: false });
    expect((await playing()).track).toBe(uri("a"));
  });

  it("plays single songs and pauses/continues without a fade", async () => {
    usePrefs.setState({ musicTransition: "slow" });
    await playTrack(uri("y"));
    await refreshPlayer();
    fake.log.length = 0;
    await togglePlay();
    expect(fake.log).toEqual(["PUT /me/player/pause"]);
    await togglePlay();
    expect(fake.log.filter((l) => l.includes("volume"))).toEqual([]);
    expect((await playing()).playing).toBe(true);
  });

  it("fades out, switches and fades back in", async () => {
    await playContext("spotify:playlist:tavern");
    await refreshPlayer();
    usePrefs.setState({ musicTransition: "short" });
    vi.useFakeTimers();
    fake.log.length = 0;
    const done = playContext("spotify:playlist:battle");
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    const volumes = fake.log.filter((l) => l.includes("volume")).map((l) => Number(l.split("=")[1]));
    const playAt = fake.log.indexOf("PUT /me/player/play");
    expect(volumes[0]).toBeLessThan(60);
    expect(Math.min(...volumes)).toBe(0);
    expect(volumes.at(-1)).toBe(60);
    // The switch happens at the bottom of the fade.
    expect(fake.log.slice(0, playAt).filter((l) => l.includes("volume")).map((l) => Number(l.split("=")[1])).at(-1)).toBe(0);
    expect(fake.devices[0].volume_percent).toBe(60);
  });

  it("cuts when the device has no volume control", async () => {
    await playContext("spotify:playlist:tavern");
    await refreshPlayer();
    fake.devices[0].supports_volume = false;
    await refreshPlayer();
    usePrefs.setState({ musicTransition: "slow" });
    fake.log.length = 0;
    await playContext("spotify:playlist:battle");
    expect(fake.log.filter((l) => l.includes("volume"))).toEqual([]);
  });
});

describe("pinned lists", () => {
  it("pins, orders and unpins in both lists without duplicates", () => {
    pin("dungeon", { id: "tavern", name: "Tavern", image: null });
    pin("dungeon", { id: "battle", name: "Battle", image: null });
    pin("dungeon", { id: "battle", name: "Battle", image: null });
    pin("general", { id: "battle", name: "Battle", image: null });
    pin("general", { id: "calm", name: "Calm", image: null });
    expect(useDoc.getState().dungeon!.playlists.map((p) => p.id)).toEqual(["tavern", "battle"]);
    reorderPinned("dungeon", 1, 0);
    expect(useDoc.getState().dungeon!.playlists.map((p) => p.id)).toEqual(["battle", "tavern"]);
    expect(pinnedPlaylists().map((p) => `${p.where}:${p.ref.id}`)).toEqual(["dungeon:battle", "dungeon:tavern", "general:calm"]);
    unpin("general", "calm");
    expect(usePrefs.getState().generalPlaylists.map((p) => p.id)).toEqual(["battle"]);
  });
});

describe("open playlist", () => {
  it("lists the songs, or explains when Spotify refuses", async () => {
    await openPlaylist("tavern", { id: "tavern", name: "Tavern", image: null });
    expect(useMusic.getState().open?.tracks.map((x) => x.name)).toEqual(["a", "b", "c"]);
    await openPlaylist("spotifymix", { id: "spotifymix", name: "Daily Mix", image: null });
    const open = useMusic.getState().open!;
    expect(open.ref?.name).toBe("Daily Mix");
    expect(open.error).toMatch(/can still play it/);
  });
});

describe("editing and search", () => {
  it("adds and removes songs on your own playlists only", async () => {
    await loadLibrary();
    const mine = useMusic.getState().myPlaylists;
    expect(canEdit(mine.find((p) => p.id === "tavern")!)).toBe(true);
    expect(canEdit(mine.find((p) => p.id === "spotifymix")!)).toBe(false);
    await openPlaylist("tavern");
    const x = { uri: uri("x"), id: "x", name: "x", artists: "Bard", album: "", image: null, durationMs: 1 };
    await addTrackToPlaylist("tavern", x);
    expect(useMusic.getState().open!.tracks.map((t) => t.name)).toEqual(["a", "b", "c", "x"]);
    expect(fake.playlists[0].tracks.map((t) => t.name)).toEqual(["a", "b", "c", "x"]);
    expect(useMusic.getState().myPlaylists.find((p) => p.id === "tavern")!.total).toBe(4);
    await removeTrackFromPlaylist("tavern", useMusic.getState().open!.tracks[0]);
    expect(fake.playlists[0].tracks.map((t) => t.name)).toEqual(["b", "c", "x"]);
    expect(useMusic.getState().open!.tracks).toHaveLength(3);
  });

  it("searches songs and playlists and ignores stale answers", async () => {
    const first = runSearch("bat");
    const second = runSearch("a");
    await Promise.all([first, second]);
    const r = useMusic.getState().results!;
    expect(useMusic.getState().center).toBe("search");
    expect(r.tracks.map((t) => t.name)).toContain("a");
    expect(r.playlists.map((p) => p.name)).toEqual(["Tavern", "Battle", "Daily Mix"]);
    await runSearch("");
    expect(useMusic.getState().center).toBe("open");
  });
});

describe("links in text", () => {
  it("labels bare links with the name, fetched once", async () => {
    pin("general", { id: "37i9dQZF1DX", name: "Tavern", image: null });
    expect(spotifyLinkLabel("https://open.spotify.com/playlist/37i9dQZF1DX")).toBe("🎵 Tavern");
    const song = `https://open.spotify.com/track/${"a0000000000"}`;
    expect(spotifyLinkLabel(song)).toBe("Spotify song");
    await vi.waitFor(() => expect(spotifyLinkLabel(song)).toBe("a — Bard"));
    expect(fake.log.filter((l) => l.startsWith("GET /tracks"))).toHaveLength(1);
  });

  it("offers pinned playlists as markdown links", () => {
    pin("dungeon", { id: "battle", name: "Battle", image: null });
    pin("general", { id: "tavern", name: "Tavern", image: null });
    expect(playlistCompletions()).toEqual([
      { name: "Battle", markdown: "[🎵 Battle](https://open.spotify.com/playlist/battle)", detail: "This dungeon" },
      { name: "Tavern", markdown: "[🎵 Tavern](https://open.spotify.com/playlist/tavern)", detail: "General" },
    ]);
  });
});
