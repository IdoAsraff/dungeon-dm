/** The Music view (⌘3): pinned playlists, the open playlist and the now-playing bar. */
import { useEffect, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { usePrefs, type PlaylistRef, type Transition } from "../lib/prefs";
import { useDoc } from "../store/doc";
import { confirmAsync, Dropdown } from "../components/ui";
import { AddToPlaylist, SearchBox, SearchResults } from "./MusicSearch";
import { Cover, fmtTime } from "./parts";
import { connectSpotify, disconnectSpotify, isConnected, REDIRECT_URI } from "../spotify/auth";
import { parseSpotifyLink } from "../spotify/links";
import { getPlaylist, type SpPlaylist, type SpTrack } from "../spotify/api";
import { sfx } from "../audio/triggers";
import {
  canEdit,
  changeVolume,
  loadDevices,
  loadLibrary,
  openPlaylist,
  openSpotifyApp,
  pin,
  playContext,
  playTrack,
  removeTrackFromPlaylist,
  reorderPinned,
  seekTo,
  skipNext,
  skipPrevious,
  startPolling,
  stopPolling,
  switchDevice,
  toggleShuffle,
  togglePlay,
  unpin,
  useMusic,
} from "../spotify/music";

const EMPTY: PlaylistRef[] = [];

export const playlistUri = (id: string) => `spotify:playlist:${id}`;

/** Loads the library and polls the player while Spotify is connected. */
export function useMusicLifecycle() {
  const connected = usePrefs((s) => isConnected(s.spotify));
  useEffect(() => {
    if (!connected) {
      useMusic.getState().set({ me: null, myPlaylists: [], open: null, player: null, results: null });
      return;
    }
    void loadLibrary();
    startPolling();
    return stopPolling;
  }, [connected]);
}

/** Progress of the current song, advanced locally between polls. */
export function useProgress(): number {
  const player = useMusic((s) => s.player);
  const polledAt = useMusic((s) => s.polledAt);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!player?.isPlaying) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [player?.isPlaying]);
  if (!player?.track) return 0;
  const p = player.isPlaying ? player.progressMs + Math.max(0, now - polledAt) : player.progressMs;
  return Math.min(p, player.track.durationMs);
}

/** A slider that updates while dragging and sends the value once the hand stops. */
function LiveRange({ value, max, onCommit, title, className }: { value: number; max: number; onCommit: (v: number) => void; title: string; className?: string }) {
  const [draft, setDraft] = useState<number | null>(null);
  useEffect(() => {
    if (draft === null) return;
    const t = setTimeout(() => {
      onCommit(draft);
      setTimeout(() => setDraft(null), 1200);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  return (
    <input
      type="range"
      className={className}
      min={0}
      max={max || 1}
      value={draft ?? value}
      title={title}
      onChange={(e) => setDraft(Number(e.target.value))}
    />
  );
}

// ---- connect -------------------------------------------------------------------------

function ConnectScreen() {
  const saved = usePrefs((s) => s.spotify?.clientId ?? "");
  const [clientId, setClientId] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await connectSpotify(clientId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="music-connect">
      <div className="music-connect-card">
        <h2>🎵 Connect Spotify</h2>
        <p>
          Play your playlists from here. The tool remote-controls the Spotify app on this Mac (or any other Spotify device of yours), so keep Spotify
          open. Spotify Premium is required.
        </p>
        <ol>
          <li>
            Open{" "}
            <a href="#" onClick={(e) => (e.preventDefault(), void openUrl("https://developer.spotify.com/dashboard"))}>
              developer.spotify.com/dashboard
            </a>{" "}
            and log in.
          </li>
          <li>
            <b>Create app</b>: any name and description, Redirect URI <code>{REDIRECT_URI}</code>, and tick <b>Web API</b>.
          </li>
          <li>Copy the app's Client ID into the box below.</li>
        </ol>
        <div className="row">
          <input
            className="grow"
            value={clientId}
            placeholder="Client ID"
            spellCheck={false}
            onChange={(e) => setClientId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && void connect()}
          />
          <button className="primary" disabled={busy || !clientId.trim()} onClick={() => void connect()}>
            {busy ? "Waiting for Spotify…" : "Connect"}
          </button>
        </div>
        {busy && <p className="hint">Your browser opened Spotify's permission page. Approve it there, then come back here.</p>}
        {error && <div className="error small">{error}</div>}
        <p className="hint">The Client ID and login stay in this Mac's app settings, never in the dungeon folder.</p>
      </div>
    </div>
  );
}

// ---- left column --------------------------------------------------------------------

function PlaylistRow({
  item,
  actions,
  meta,
  draggable,
  onDragStart,
  onDropHere,
}: {
  item: PlaylistRef | SpPlaylist;
  actions?: ReactNode;
  meta?: ReactNode;
  draggable?: boolean;
  onDragStart?: () => void;
  onDropHere?: () => void;
}) {
  const open = useMusic((s) => s.open);
  const contextUri = useMusic((s) => s.player?.contextUri);
  const isPlaying = useMusic((s) => !!s.player?.isPlaying);
  const uri = playlistUri(item.id);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`music-row ${open?.kind === "playlist" && open.id === item.id ? "selected" : ""} ${contextUri === uri ? "current" : ""} ${over ? "drop" : ""}`}
      onClick={() => void openPlaylist(item.id, item)}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", item.id);
        onDragStart?.();
      }}
      onDragOver={onDropHere ? (e) => (e.preventDefault(), setOver(true)) : undefined}
      onDragLeave={() => setOver(false)}
      onDrop={
        onDropHere
          ? (e) => {
              e.preventDefault();
              setOver(false);
              onDropHere();
            }
          : undefined
      }
      title={item.name}
    >
      <Cover src={item.image} size={32} />
      <span className="music-row-name">
        {item.name}
        {meta && <span className="music-row-meta">{meta}</span>}
      </span>
      <span className="music-row-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className="icon-btn music-play"
          title={contextUri === uri && isPlaying ? "Playing" : `Play ${item.name}`}
          onClick={() => void playContext(uri)}
        >
          {contextUri === uri && isPlaying ? "♫" : "▶"}
        </button>
        {actions}
      </span>
    </div>
  );
}

/** ＋ menu: pick one of your playlists or paste a Spotify link. */
function AddPinned({ where }: { where: "dungeon" | "general" }) {
  const mine = useMusic((s) => s.myPlaylists);
  const pinned = useDoc((s) => s.dungeon?.playlists ?? EMPTY);
  const general = usePrefs((s) => s.generalPlaylists);
  const taken = new Set((where === "dungeon" ? pinned : general).map((p) => p.id));
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const q = filter.trim().toLowerCase();
  const link = parseSpotifyLink(filter);

  const addLink = async (close: () => void) => {
    if (!link || link.kind !== "playlist") return setError("Paste a link to a Spotify playlist.");
    const known = mine.find((p) => p.id === link.id) ?? (await getPlaylist(link.id).catch(() => null));
    pin(where, known ?? { id: link.id, name: "Spotify playlist", image: null });
    setFilter("");
    close();
  };

  return (
    <Dropdown label="＋" title={`Add a playlist to ${where === "dungeon" ? "this dungeon" : "General"}`} className="music-add">
      {(close) => (
        <div className="music-picker">
          <input
            autoFocus
            placeholder="Filter your playlists, or paste a Spotify link"
            value={filter}
            onChange={(e) => (setFilter(e.target.value), setError(null))}
            onKeyDown={(e) => e.key === "Enter" && link && void addLink(close)}
          />
          {error && <div className="error small">{error}</div>}
          <div className="music-picker-list">
            {link ? (
              <button className="menu-item" onClick={() => void addLink(close)}>
                ＋ Add the linked {link.kind}
              </button>
            ) : (
              mine
                .filter((p) => !q || p.name.toLowerCase().includes(q))
                .map((p) => (
                  <button
                    key={p.id}
                    className="menu-item"
                    disabled={taken.has(p.id)}
                    onClick={() => {
                      pin(where, p);
                      close();
                    }}
                  >
                    <Cover src={p.image} size={24} /> <span className="grow ellipsis">{p.name}</span>
                    {taken.has(p.id) && <span className="menu-meta">added</span>}
                  </button>
                ))
            )}
            {!link && mine.length === 0 && <div className="menu-empty">No playlists found in your Spotify library.</div>}
          </div>
        </div>
      )}
    </Dropdown>
  );
}

function PinnedSection({ where, title, list, empty }: { where: "dungeon" | "general"; title: string; list: PlaylistRef[]; empty: string }) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  return (
    <section className="music-section">
      <header>
        <span className="music-section-title">{title}</span>
        <AddPinned where={where} />
      </header>
      {list.length === 0 && <p className="hint">{empty}</p>}
      {list.map((p, i) => (
        <PlaylistRow
          key={p.id}
          item={p}
          draggable
          onDragStart={() => setDragFrom(i)}
          onDropHere={() => dragFrom !== null && dragFrom !== i && reorderPinned(where, dragFrom, i)}
          actions={
            <button className="icon-btn danger-hover" title="Remove from this list (the playlist stays in Spotify)" onClick={() => unpin(where, p.id)}>
              ✕
            </button>
          }
        />
      ))}
    </section>
  );
}

function AllPlaylists() {
  const mine = useMusic((s) => s.myPlaylists);
  const loading = useMusic((s) => s.loadingPlaylists);
  const pinned = useDoc((s) => s.dungeon?.playlists ?? EMPTY);
  const general = usePrefs((s) => s.generalPlaylists);
  const [open, setOpen] = useState(pinned.length + general.length === 0);
  const inDungeon = new Set(pinned.map((p) => p.id));
  const inGeneral = new Set(general.map((p) => p.id));
  return (
    <section className="music-section">
      <header>
        <button className="music-collapse" onClick={() => setOpen(!open)}>
          <span className="caret">{open ? "▾" : "▸"}</span> All my playlists <span className="muted">{mine.length || ""}</span>
        </button>
        <button className="icon-btn" title="Reload your playlists from Spotify" onClick={() => void loadLibrary()} disabled={loading}>
          ⟳
        </button>
      </header>
      {open && loading && mine.length === 0 && <p className="hint">Loading…</p>}
      {open &&
        mine.map((p) => (
          <PlaylistRow
            key={p.id}
            item={p}
            meta={p.total !== null ? `${p.total} songs` : undefined}
            actions={
              <>
                <button className="pin-btn" disabled={inDungeon.has(p.id)} title="Pin to this dungeon's list" onClick={() => pin("dungeon", p)}>
                  {inDungeon.has(p.id) ? "✓" : "+"}Dungeon
                </button>
                <button className="pin-btn" disabled={inGeneral.has(p.id)} title="Pin to the General list (all dungeons)" onClick={() => pin("general", p)}>
                  {inGeneral.has(p.id) ? "✓" : "+"}General
                </button>
              </>
            }
          />
        ))}
    </section>
  );
}

function SfxSettings() {
  const enabled = usePrefs((s) => s.sfxEnabled);
  const volume = usePrefs((s) => s.sfxVolume);
  const update = usePrefs((s) => s.update);
  return (
    <section className="music-section music-sfx">
      <header>
        <span className="music-section-title">Sound effects</span>
      </header>
      <label className="menu-check" title="Sounds on room reveals, handouts and pings">
        <input type="checkbox" checked={enabled} onChange={(e) => update({ sfxEnabled: e.target.checked })} /> On
      </label>
      <div className="row">
        <input
          type="range"
          className="grow"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          disabled={!enabled}
          title={`Volume ${Math.round(volume * 100)}%`}
          onChange={(e) => update({ sfxVolume: Number(e.target.value) })}
        />
        <Dropdown label="Test" title="Hear the sounds" disabled={!enabled} align="right">
          {(close) =>
            (
              [
                ["reveal", "Room revealed"],
                ["handout", "Handout shown"],
                ["ping", "Ping"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                className="menu-item"
                onClick={() => {
                  close();
                  sfx(k);
                }}
              >
                {label}
              </button>
            ))
          }
        </Dropdown>
      </div>
    </section>
  );
}

function Sidebar() {
  const pinned = useDoc((s) => s.dungeon?.playlists ?? EMPTY);
  const general = usePrefs((s) => s.generalPlaylists);
  const me = useMusic((s) => s.me);
  return (
    <aside className="music-sidebar">
      <div className="music-sidebar-scroll">
        <PinnedSection where="dungeon" title="This dungeon" list={pinned} empty="Pin playlists for this dungeon with ＋ (saved in the dungeon folder)." />
        <PinnedSection where="general" title="General" list={general} empty="Pin playlists you use in every dungeon with ＋." />
        <AllPlaylists />
      </div>
      <SfxSettings />
      <div className="music-account">
        <span className="muted ellipsis">Spotify: {me?.name ?? "connected"}</span>
        <button className="icon-btn" title="Log out of Spotify in this tool" onClick={disconnectSpotify}>
          Disconnect
        </button>
      </div>
    </aside>
  );
}

// ---- open playlist -----------------------------------------------------------------------

function TrackRow({ t, i, contextUri, actions }: { t: SpTrack; i: number; contextUri: string | null; actions?: ReactNode }) {
  const current = useMusic((s) => s.player?.track?.uri === t.uri);
  const isPlaying = useMusic((s) => !!s.player?.isPlaying);
  const play = () => void (contextUri ? playContext(contextUri, { trackUri: t.uri }) : playTrack(t.uri));
  return (
    <div className={`track-row ${current ? "current" : ""}`} onDoubleClick={play}>
      <span className="track-num">
        <span className="n">{current && isPlaying ? "♫" : i + 1}</span>
        <button className="icon-btn music-play" title={`Play ${t.name}`} onClick={play}>
          ▶
        </button>
      </span>
      <Cover src={t.image} size={32} />
      <span className="track-title">
        <span className="ellipsis">{t.name}</span>
        <span className="muted ellipsis">{t.artists}</span>
      </span>
      <span className="track-album muted ellipsis">{t.album}</span>
      <span className="track-actions">{actions}</span>
      <span className="track-time muted">{fmtTime(t.durationMs)}</span>
    </div>
  );
}

function OpenPanel() {
  const open = useMusic((s) => s.open);
  const pinned = useDoc((s) => s.dungeon?.playlists ?? EMPTY);
  const general = usePrefs((s) => s.generalPlaylists);
  const contextUri = useMusic((s) => s.player?.contextUri);
  const isPlaying = useMusic((s) => !!s.player?.isPlaying);
  const hasResults = useMusic((s) => !!s.results);
  if (!open) {
    return (
      <div className="music-empty">
        <p>Pick a playlist on the left.</p>
        <p className="hint">▶ plays it (resuming where it was left). Links to Spotify playlists and songs in your notes play too.</p>
      </div>
    );
  }
  const name = open.meta?.name ?? open.ref?.name ?? "";
  const image = open.meta?.image ?? open.ref?.image ?? null;
  const pl = open.kind === "playlist" ? (open.meta as SpPlaylist | null) : null;
  const sub = open.kind === "album" ? `Album · ${(open.meta as { artists?: string } | null)?.artists ?? ""}` : pl ? `Playlist · ${pl.ownerName}` : "Playlist";
  const here = contextUri === open.uri;
  const ref: PlaylistRef = { id: open.id, name: name || "Spotify playlist", image };
  const editable = canEdit(pl);
  const remove = async (t: SpTrack) => {
    const ok = await confirmAsync(
      <>
        Remove <b>{t.name}</b> from <b>{name}</b> in Spotify?
      </>,
      { confirmLabel: "Remove", danger: true },
    );
    if (ok) void removeTrackFromPlaylist(open.id, t);
  };
  return (
    <div className="music-open">
      {hasResults && (
        <button className="icon-btn music-back" onClick={() => useMusic.getState().set({ center: "search" })}>
          ← Search results
        </button>
      )}
      <header className="music-open-head">
        <Cover src={image} size={96} />
        <div className="grow">
          <div className="muted small">{sub}</div>
          <h2>{name || "…"}</h2>
          <div className="muted small">{open.loading ? "Loading…" : `${open.tracks.length} songs`}</div>
          <div className="row music-open-actions">
            <button className="primary" onClick={() => (here ? void togglePlay() : void playContext(open.uri))}>
              {here && isPlaying ? "⏸ Pause" : "▶ Play"}
            </button>
            <button onClick={() => void playContext(open.uri, { resume: false })} title="Play from the first song">
              ⏮ From the start
            </button>
            {open.kind === "playlist" && (
              <>
                {!pinned.some((p) => p.id === open.id) && <button onClick={() => pin("dungeon", pl ?? ref)}>＋ This dungeon</button>}
                {!general.some((p) => p.id === open.id) && <button onClick={() => pin("general", pl ?? ref)}>＋ General</button>}
              </>
            )}
            <button className="icon-btn" title="Open in Spotify" onClick={() => void openUrl(`https://open.spotify.com/${open.kind}/${open.id}`)}>
              ↗ Spotify
            </button>
          </div>
        </div>
      </header>
      {open.error && <div className="error small">{open.error}</div>}
      <div className="track-list">
        {open.tracks.map((t, i) => (
          <TrackRow
            key={`${t.uri}-${i}`}
            t={t}
            i={i}
            contextUri={open.uri}
            actions={
              <>
                <AddToPlaylist track={t} />
                {editable && (
                  <button className="icon-btn danger-hover" title="Remove from this playlist (in Spotify)" onClick={() => void remove(t)}>
                    ✕
                  </button>
                )}
              </>
            }
          />
        ))}
      </div>
    </div>
  );
}

// ---- now playing ---------------------------------------------------------------------

const TRANSITIONS: { value: Transition; label: string }[] = [
  { value: "cut", label: "Immediate cut" },
  { value: "short", label: "Short fade" },
  { value: "slow", label: "Slow fade" },
];

function DevicePicker() {
  const devices = useMusic((s) => s.devices);
  const current = useMusic((s) => s.player?.device);
  return (
    <div onMouseDown={() => void loadDevices()}>
      <Dropdown label={<>🔈 {current?.name ?? "No device"}</>} title="Where the music plays" align="right" className="device-picker">
        {(close) => (
          <>
            {devices.length === 0 && <div className="menu-empty">No Spotify devices. Open the Spotify app.</div>}
            {devices.map((d) => (
              <button
                key={d.id}
                className="menu-item"
                onClick={() => {
                  close();
                  void switchDevice(d.id);
                }}
              >
                {d.isActive ? "✓" : " "} {d.name} <span className="menu-meta">{d.type}</span>
              </button>
            ))}
            <div className="menu-divider" />
            <button
              className="menu-item"
              onClick={() => {
                close();
                void openSpotifyApp();
              }}
            >
              Open Spotify on this Mac
            </button>
          </>
        )}
      </Dropdown>
    </div>
  );
}

function NowPlayingBar() {
  const player = useMusic((s) => s.player);
  const noDevice = useMusic((s) => s.noDevice);
  const switching = useMusic((s) => s.switching);
  const transition = usePrefs((s) => s.musicTransition);
  const progress = useProgress();
  const track = player?.track;
  const hasDevice = !!player?.device;
  return (
    <footer className="now-playing">
      <div className="np-track">
        {track ? (
          <>
            <Cover src={track.image} size={44} />
            <div className="np-text">
              <b className="ellipsis">{track.name}</b>
              <span className="muted ellipsis">{track.artists}</span>
            </div>
          </>
        ) : (
          <span className="muted">Nothing playing</span>
        )}
      </div>
      <div className="np-center">
        {hasDevice || !noDevice ? (
          <>
            <div className="np-buttons">
              <button className={`icon-btn ${player?.shuffle ? "on" : ""}`} title="Shuffle" onClick={() => void toggleShuffle()} disabled={!player}>
                ⤮
              </button>
              <button className="icon-btn" title="Previous" onClick={() => void skipPrevious()} disabled={!player}>
                ⏮
              </button>
              <button className="np-play" title={player?.isPlaying ? "Pause" : "Play"} onClick={() => void togglePlay()} disabled={switching}>
                {player?.isPlaying ? "⏸" : "▶"}
              </button>
              <button className="icon-btn" title="Next" onClick={() => void skipNext()} disabled={!player}>
                ⏭
              </button>
            </div>
            <div className="np-seek">
              <span className="muted">{fmtTime(progress)}</span>
              <LiveRange className="grow" value={progress} max={track?.durationMs ?? 0} onCommit={(v) => void seekTo(v)} title="Seek" />
              <span className="muted">{fmtTime(track?.durationMs ?? 0)}</span>
            </div>
          </>
        ) : (
          <div className="np-nodevice">
            <span>No Spotify app is open.</span>
            <button className="primary" onClick={() => void openSpotifyApp()}>
              Open Spotify
            </button>
          </div>
        )}
      </div>
      <div className="np-right">
        {player?.device?.supportsVolume !== false && (
          <span className="np-volume" title="Spotify volume">
            🔊
            <LiveRange value={player?.device?.volume ?? 0} max={100} onCommit={(v) => void changeVolume(v)} title="Spotify volume" />
          </span>
        )}
        <DevicePicker />
        <select
          value={transition}
          title="How the music changes when you switch playlists or songs"
          onChange={(e) => usePrefs.getState().update({ musicTransition: e.target.value as Transition })}
        >
          {TRANSITIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
    </footer>
  );
}

export function MusicView() {
  const loaded = usePrefs((s) => s.loaded);
  const connected = usePrefs((s) => isConnected(s.spotify));
  const center = useMusic((s) => s.center);
  if (!loaded) return <div className="music-view" />;
  if (!connected) return <ConnectScreen />;
  return (
    <div className="music-view">
      <div className="music-body">
        <Sidebar />
        <main className="music-main">
          <SearchBox />
          <div className="music-center">{center === "search" ? <SearchResults /> : <OpenPanel />}</div>
        </main>
      </div>
      <NowPlayingBar />
    </div>
  );
}
