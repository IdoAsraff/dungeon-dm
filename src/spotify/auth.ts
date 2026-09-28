/**
 * Spotify login: Authorization Code with PKCE (no client secret). The
 * browser is sent to Spotify, which redirects back to a one-shot listener on
 * http://127.0.0.1:8888/callback run by the Rust backend.
 */
import { invoke } from "@tauri-apps/api/core";
import { usePrefs, type SpotifyAuth } from "../lib/prefs";
import { rawFetch } from "./http";

export const REDIRECT_URI = "http://127.0.0.1:8888/callback";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

export const SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
];

export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

export function authorizeUrl(clientId: string, challenge: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SCOPES.join(" "),
    state,
  });
  return `https://accounts.spotify.com/authorize?${q}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await rawFetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `Spotify login failed (${res.status})`);
  }
  return json;
}

function store(clientId: string, t: TokenResponse, previousRefresh?: string) {
  const auth: SpotifyAuth = {
    clientId,
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? previousRefresh,
    expiresAt: Date.now() + (t.expires_in - 60) * 1000,
  };
  usePrefs.getState().update({ spotify: auth });
  return auth;
}

/** Runs the whole login: browser approval, code exchange, token storage. */
export async function connectSpotify(clientId: string): Promise<void> {
  const id = clientId.trim();
  if (!/^[0-9a-f]{32}$/i.test(id)) throw new Error("That doesn't look like a Spotify Client ID (32 letters and digits).");
  usePrefs.getState().update({ spotify: { clientId: id } });
  const { verifier, challenge } = await pkcePair();
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const query = await invoke<string>("spotify_authorize", { authUrl: authorizeUrl(id, challenge, state) });
  const params = new URLSearchParams(query);
  if (params.get("state") !== state) throw new Error("Spotify's answer didn't match this login attempt. Try again.");
  const error = params.get("error");
  if (error) throw new Error(error === "access_denied" ? "You declined the permission request." : `Spotify said: ${error}`);
  const code = params.get("code");
  if (!code) throw new Error("Spotify didn't send a login code. Try again.");
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, client_id: id, code_verifier: verifier });
  store(id, t);
}

let refreshing: Promise<string> | null = null;

/** A valid access token, refreshing it when needed. Throws when not connected. */
export async function accessToken(force = false): Promise<string> {
  const auth = usePrefs.getState().spotify;
  if (!auth?.refreshToken) throw new Error("Spotify is not connected.");
  if (!force && auth.accessToken && auth.expiresAt && Date.now() < auth.expiresAt) return auth.accessToken;
  refreshing ??= tokenRequest({ grant_type: "refresh_token", refresh_token: auth.refreshToken, client_id: auth.clientId })
    .then((t) => store(auth.clientId, t, auth.refreshToken).accessToken!)
    .catch((e) => {
      // A revoked or expired refresh token means logging in again.
      if (/invalid_grant|revoked|expired/i.test(String(e))) usePrefs.getState().update({ spotify: { clientId: auth.clientId } });
      throw e;
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

export function disconnectSpotify() {
  const auth = usePrefs.getState().spotify;
  usePrefs.getState().update({ spotify: auth ? { clientId: auth.clientId } : null });
}

export function isConnected(auth: SpotifyAuth | null): boolean {
  return !!auth?.refreshToken;
}
