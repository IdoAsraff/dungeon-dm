/**
 * The toolbar's Music tab doubles as a mini-player: while a song is loaded it
 * shows the song's name, with play/pause and next beside it, on every view.
 */
import { usePrefs } from "../lib/prefs";
import { isConnected } from "../spotify/auth";
import { skipNext, togglePlay, useMusic } from "../spotify/music";

export function MusicTab({ on, onClick }: { on: boolean; onClick: () => void }) {
  const connected = usePrefs((s) => isConnected(s.spotify));
  const player = useMusic((s) => s.player);
  const switching = useMusic((s) => s.switching);
  const t = connected ? player?.track : null;
  return (
    <>
      <button className={on ? "on" : ""} onClick={onClick} title={t ? `Music (⌘3)\nNow ${player!.isPlaying ? "playing" : "paused"}: ${t.name} — ${t.artists}` : "Music (⌘3)"}>
        🎵 {t ? <span className="music-tab-track">{t.name}</span> : "Music"}
      </button>
      {t && (
        <span className="mini-player" role="group" aria-label="Music controls">
          <button title={player!.isPlaying ? "Pause music" : "Play music"} onClick={() => void togglePlay()} disabled={switching}>
            {player!.isPlaying ? "⏸" : "▶"}
          </button>
          <button title="Next song" onClick={() => void skipNext()}>
            ⏭
          </button>
        </span>
      )}
    </>
  );
}
