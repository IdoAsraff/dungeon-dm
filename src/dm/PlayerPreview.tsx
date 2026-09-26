import { useEffect, useMemo, useRef, useState } from "react";
import { useDoc } from "../store/doc";
import { useSession } from "../store/session";
import { useUi } from "../store/ui";
import { assetUrl, backend } from "../lib/backend";
import { buildPlayerData } from "../lib/playerData";
import { PlayerMapView } from "../map/PlayerMapView";

const STORAGE_KEY = "dm.playerPreview";

function loadPrefs(): { width: number; minimized: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { width: 320, minimized: false, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { width: 320, minimized: false };
}

/** A small, resizable mirror of exactly what the player window currently shows. */
export function PlayerPreview() {
  const [prefs, setPrefs] = useState(loadPrefs);
  const dungeon = useDoc((s) => s.dungeon);
  const session = useSession();
  const dir = useUi((s) => s.dungeonDir);
  const vp = useUi((s) => s.playerViewport);
  const resizing = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!resizing.current) return;
      const w = Math.max(180, Math.min(1000, resizing.current.startW + (e.clientX - resizing.current.startX)));
      setPrefs((p) => ({ ...p, width: w }));
    };
    const up = () => (resizing.current = null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  const data = useMemo(
    () => buildPlayerData(dungeon, session, (p) => (dir ? assetUrl(dir, p) : p)),
    [dungeon, session, dir],
  );

  if (prefs.minimized) {
    return (
      <button className="preview-pill" onClick={() => setPrefs({ ...prefs, minimized: false })} title="Show player view preview">
        ▣ Player view
      </button>
    );
  }

  const aspect = vp && vp.width > 0 && vp.height > 0 ? vp.height / vp.width : 10 / 16;
  const width = prefs.width;
  const height = Math.round(width * aspect);
  const level = vp ? (data.levels.find((l) => l.id === vp.levelId) ?? null) : null;
  const f = vp && vp.width > 0 ? width / vp.width : 1;
  const view = vp ? { x: vp.x * f, y: vp.y * f, scale: vp.scale * f } : { x: 0, y: 0, scale: 1 };
  const focusRoomId = data.focus && level && data.focus.levelId === level.id ? data.focus.roomId : null;

  return (
    <div className="player-preview" style={{ width }}>
      <div className="preview-header">
        <span>Player view{level ? ` · ${level.name}` : ""}</span>
        <span className="grow" />
        <button className="icon-btn" title="Minimize" onClick={() => setPrefs({ ...prefs, minimized: true })}>
          ▁
        </button>
      </div>
      <div className="preview-body" style={{ height }}>
        {vp ? (
          <PlayerMapView level={level} focusRoomId={focusRoomId} width={width} height={height} view={view} interactive={false} />
        ) : (
          <div className="preview-empty">
            <span>Player window not open</span>
            <button onClick={() => void backend.showPlayerWindow()}>Open it</button>
          </div>
        )}
      </div>
      <div
        className="preview-resize"
        title="Drag to resize"
        onMouseDown={(e) => {
          e.preventDefault();
          resizing.current = { startX: e.clientX, startW: prefs.width };
        }}
      />
    </div>
  );
}
