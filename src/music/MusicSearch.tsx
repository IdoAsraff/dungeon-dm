/** Spotify search (songs, playlists, albums) and the "add to playlist" menu. */
import { useEffect, useState } from "react";
import { usePrefs } from "../lib/prefs";
import { useDoc } from "../store/doc";
import { Dropdown } from "../components/ui";
import type { SpTrack } from "../spotify/api";
import { addTrackToPlaylist, editablePlaylists, openAlbum, openPlaylist, pin, playContext, playTrack, runSearch, useMusic } from "../spotify/music";
import { Cover, fmtTime } from "./parts";

const EMPTY: never[] = [];

/** ＋ on a song: add it to one of your playlists. */
export function AddToPlaylist({ track }: { track: SpTrack }) {
  useMusic((s) => s.myPlaylists);
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();
  return (
    <Dropdown label="＋" title="Add to one of your playlists" className="music-add track-add" align="right">
      {(close) => {
        const list = editablePlaylists().filter((p) => !q || p.name.toLowerCase().includes(q));
        return (
          <div className="music-picker">
            <input autoFocus placeholder={`Add “${track.name}” to…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="music-picker-list">
              {list.map((p) => (
                <button
                  key={p.id}
                  className="menu-item"
                  onClick={() => {
                    close();
                    void addTrackToPlaylist(p.id, track);
                  }}
                >
                  <Cover src={p.image} size={24} /> <span className="grow ellipsis">{p.name}</span>
                </button>
              ))}
              {list.length === 0 && <div className="menu-empty">No playlists you can edit.</div>}
            </div>
          </div>
        );
      }}
    </Dropdown>
  );
}

export function SearchBox() {
  const query = useMusic((s) => s.searchQuery);
  const [draft, setDraft] = useState(query);
  useEffect(() => setDraft(query), [query]);
  useEffect(() => {
    if (draft === useMusic.getState().searchQuery) return;
    const t = setTimeout(() => void runSearch(draft), 350);
    return () => clearTimeout(t);
  }, [draft]);
  return (
    <div className="music-search">
      <input
        type="search"
        placeholder="Search Spotify: songs, playlists, albums"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void runSearch(draft);
          if (e.key === "Escape") (setDraft(""), void runSearch(""));
        }}
        onFocus={() => useMusic.getState().results && useMusic.getState().set({ center: "search" })}
      />
    </div>
  );
}

export function SearchResults() {
  const results = useMusic((s) => s.results);
  const searching = useMusic((s) => s.searching);
  const nowUri = useMusic((s) => s.player?.track?.uri);
  const pinned = useDoc((s) => s.dungeon?.playlists ?? EMPTY);
  const general = usePrefs((s) => s.generalPlaylists);
  if (!results) return <div className="music-empty">{searching ? "Searching…" : ""}</div>;
  const nothing = !results.tracks.length && !results.playlists.length && !results.albums.length;
  return (
    <div className="music-results">
      {nothing && <p className="muted">{searching ? "Searching…" : "Nothing found."}</p>}
      {results.tracks.length > 0 && (
        <section>
          <h3>Songs</h3>
          <div className="track-list">
            {results.tracks.map((t) => (
              <div key={t.uri} className={`track-row result ${nowUri === t.uri ? "current" : ""}`} onDoubleClick={() => void playTrack(t.uri)}>
                <span className="track-num">
                  <button className="icon-btn music-play always" title={`Play ${t.name}`} onClick={() => void playTrack(t.uri)}>
                    ▶
                  </button>
                </span>
                <Cover src={t.image} size={32} />
                <span className="track-title">
                  <span className="ellipsis">{t.name}</span>
                  <span className="muted ellipsis">{t.artists}</span>
                </span>
                <span className="track-album muted ellipsis">{t.album}</span>
                <span className="track-actions">
                  <AddToPlaylist track={t} />
                </span>
                <span className="track-time muted">{fmtTime(t.durationMs)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {results.playlists.length > 0 && (
        <section>
          <h3>Playlists</h3>
          <div className="result-grid">
            {results.playlists.map((p) => (
              <div key={p.id} className="result-card" onClick={() => void openPlaylist(p.id, p)} title={p.name}>
                <Cover src={p.image} size={48} />
                <span className="result-text">
                  <span className="ellipsis">{p.name}</span>
                  <span className="muted ellipsis small">{p.ownerName}</span>
                </span>
                <span className="result-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="icon-btn music-play" title="Play" onClick={() => void playContext(p.uri)}>
                    ▶
                  </button>
                  <button className="pin-btn" disabled={pinned.some((x) => x.id === p.id)} title="Pin to this dungeon's list" onClick={() => pin("dungeon", p)}>
                    {pinned.some((x) => x.id === p.id) ? "✓" : "+"}Dungeon
                  </button>
                  <button className="pin-btn" disabled={general.some((x) => x.id === p.id)} title="Pin to the General list" onClick={() => pin("general", p)}>
                    {general.some((x) => x.id === p.id) ? "✓" : "+"}General
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
      {results.albums.length > 0 && (
        <section>
          <h3>Albums</h3>
          <div className="result-grid">
            {results.albums.map((a) => (
              <div key={a.id} className="result-card" onClick={() => void openAlbum(a.id)} title={a.name}>
                <Cover src={a.image} size={48} />
                <span className="result-text">
                  <span className="ellipsis">{a.name}</span>
                  <span className="muted ellipsis small">{a.artists}</span>
                </span>
                <span className="result-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="icon-btn music-play" title="Play" onClick={() => void playContext(a.uri)}>
                    ▶
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
