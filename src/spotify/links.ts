/** Spotify share links and URIs: https://open.spotify.com/playlist/ID, spotify:track:ID, ... */

export type SpotifyKind = "playlist" | "track" | "album";

export interface SpotifyLink {
  kind: SpotifyKind;
  id: string;
  uri: string;
  url: string;
}

const URL_RE = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(playlist|track|album)\/([A-Za-z0-9]{10,40})(?:[/?#].*)?$/;
const URI_RE = /^spotify:(playlist|track|album):([A-Za-z0-9]{10,40})$/;

export function parseSpotifyLink(s: string): SpotifyLink | null {
  const t = s.trim();
  const m = URL_RE.exec(t) ?? URI_RE.exec(t);
  if (!m) return null;
  const kind = m[1] as SpotifyKind;
  const id = m[2];
  return { kind, id, uri: `spotify:${kind}:${id}`, url: `https://open.spotify.com/${kind}/${id}` };
}

export function playlistUrl(id: string): string {
  return `https://open.spotify.com/playlist/${id}`;
}

/** Markdown inserted by the [[ autocomplete for a playlist. */
export function playlistMarkdown(name: string, id: string): string {
  const safe = name.replace(/[[\]]/g, "");
  return `[🎵 ${safe}](${playlistUrl(id)})`;
}
