/**
 * HTTP to Spotify. Requests go through Tauri's HTTP plugin (native, scoped to
 * Spotify's domains) so browser CORS rules don't apply. Tests can replace the
 * transport with `window.__spotifyFetch`.
 */
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { accessToken } from "./auth";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export function rawFetch(url: string, init?: RequestInit): Promise<Response> {
  const override = (globalThis as unknown as { __spotifyFetch?: Fetcher }).__spotifyFetch;
  return (override ?? (tauriFetch as Fetcher))(url, init);
}

export class SpotifyError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason?: string,
  ) {
    super(message);
  }
}

const API = "https://api.spotify.com/v1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Calls the Web API. Returns parsed JSON, or null for empty (204/202)
 * responses. Retries once after a 401 (expired token) or 429 (rate limit).
 */
export async function api<T>(
  method: string,
  path: string,
  opts: { query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
): Promise<T | null> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) q.set(k, String(v));
  const url = `${API}${path}${q.toString() ? `?${q}` : ""}`;
  for (let attempt = 0; ; attempt++) {
    const token = await accessToken(attempt > 0);
    const res = await rawFetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401 && attempt === 0) continue;
    if (res.status === 429 && attempt === 0) {
      await sleep(Math.min(5, Number(res.headers.get("Retry-After") ?? 1)) * 1000);
      continue;
    }
    if (res.status === 204 || res.status === 202) return null;
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const err = (json as { error?: { message?: string; reason?: string } } | null)?.error;
      throw new SpotifyError(res.status, err?.message ?? `Spotify error ${res.status}`, err?.reason);
    }
    return json as T;
  }
}
