import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSpotifyLink, playlistMarkdown } from "./links";
import { toPlaylist, toTrack } from "./api";
import { authorizeUrl, base64url, pkcePair } from "./auth";
import { api, SpotifyError } from "./http";
import { usePrefs } from "../lib/prefs";

describe("spotify links", () => {
  it("parses share URLs and URIs", () => {
    expect(parseSpotifyLink("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc")).toEqual({
      kind: "playlist",
      id: "37i9dQZF1DXcBWIGoYBM5M",
      uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
      url: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
    });
    expect(parseSpotifyLink("https://open.spotify.com/intl-he/track/4uLU6hMCjMI75M1A2tKUQC")?.kind).toBe("track");
    expect(parseSpotifyLink("spotify:album:1DFixLWuPkv3KT3TnV35m3")?.uri).toBe("spotify:album:1DFixLWuPkv3KT3TnV35m3");
    expect(parseSpotifyLink("https://open.spotify.com/artist/0OdUWJ0sBjDrqHygGUXeCF")).toBeNull();
    expect(parseSpotifyLink("https://example.com/playlist/37i9dQZF1DXcBWIGoYBM5M")).toBeNull();
  });

  it("builds the autocomplete markdown", () => {
    expect(playlistMarkdown("Tavern [night]", "abc123abc123")).toBe("[🎵 Tavern night](https://open.spotify.com/playlist/abc123abc123)");
  });
});

describe("normalizers", () => {
  it("accept both the old and the renamed playlist fields", () => {
    const base = { id: "p1", name: "Cave", owner: { id: "me", display_name: "Me" }, images: [{ url: "big", width: 640 }, { url: "mid", width: 300 }] };
    expect(toPlaylist({ ...base, items: { total: 4 } })).toMatchObject({ id: "p1", uri: "spotify:playlist:p1", image: "mid", ownerId: "me", total: 4 });
    expect(toPlaylist({ ...base, tracks: { total: 7 } })?.total).toBe(7);
    expect(toPlaylist(null)).toBeNull();
  });

  it("skips episodes and local files", () => {
    const t = { uri: "spotify:track:t1", id: "t1", name: "Drums", artists: [{ name: "A" }, { name: "B" }], album: { name: "X", images: [] }, duration_ms: 1000 };
    expect(toTrack(t)).toMatchObject({ name: "Drums", artists: "A, B", album: "X", image: null });
    expect(toTrack({ ...t, type: "episode" })).toBeNull();
    expect(toTrack({ ...t, is_local: true })).toBeNull();
  });
});

describe("auth", () => {
  it("encodes base64url without padding", () => {
    expect(base64url(new Uint8Array([251, 255, 191]))).toBe("-_-_");
    expect(base64url(new Uint8Array([1]))).toBe("AQ");
  });

  it("makes an S256 challenge from the verifier", async () => {
    const { verifier, challenge } = await pkcePair();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    expect(challenge).toBe(base64url(new Uint8Array(digest)));
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  });

  it("builds the authorize URL", () => {
    const u = new URL(authorizeUrl("cid", "chal", "st"));
    expect(u.origin + u.pathname).toBe("https://accounts.spotify.com/authorize");
    expect(u.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8888/callback");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).toContain("user-modify-playback-state");
  });
});

describe("api", () => {
  const g = globalThis as unknown as { __spotifyFetch?: unknown };
  afterEach(() => delete g.__spotifyFetch);

  it("refreshes the token once after a 401 and reports errors", async () => {
    usePrefs.setState({ spotify: { clientId: "c", refreshToken: "r", accessToken: "old", expiresAt: Date.now() + 60_000 } });
    usePrefs.setState({ update: (p) => usePrefs.setState(p) });
    const calls: string[] = [];
    g.__spotifyFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/token")) return new Response(JSON.stringify({ access_token: "new", expires_in: 3600 }));
      const auth = (init?.headers as Record<string, string>).Authorization;
      calls.push(auth);
      if (auth === "Bearer old") return new Response("", { status: 401 });
      if (url.includes("/me/player")) return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ error: { status: 404, message: "Not found" } }), { status: 404 });
    });
    expect(await api("GET", "/me/player")).toBeNull();
    expect(calls).toEqual(["Bearer old", "Bearer new"]);
    expect(usePrefs.getState().spotify?.refreshToken).toBe("r");
    await expect(api("GET", "/playlists/x")).rejects.toBeInstanceOf(SpotifyError);
  });
});
