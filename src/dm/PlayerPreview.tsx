import { useEffect, useMemo, useRef, useState } from "react";
import { useDoc } from "../store/doc";
import { useSession } from "../store/session";
import { useUi } from "../store/ui";
import { assetUrl, backend } from "../lib/backend";
import { brightnessFilter, buildPlayerData } from "../lib/playerData";
import { MAX_BRIGHTNESS, MIN_BRIGHTNESS } from "../types";
import { compassSizeFor, PlayerMapView } from "../map/PlayerMapView";

const STORAGE_KEY = "dm.playerPreview";

interface PreviewPrefs {
  width: number;
  minimized: boolean;
  brightnessOpen: boolean;
}

function loadPrefs(): PreviewPrefs {
  const defaults: PreviewPrefs = { width: 320, minimized: false, brightnessOpen: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return defaults;
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
      <button
        className={`preview-pill ${data.blackout ? "blackout" : ""}`}
        onClick={() => setPrefs({ ...prefs, minimized: false })}
        title="Show player view preview"
      >
        ▣ Player view{data.blackout ? " · BLACKED OUT" : ""}
        {data.brightness !== 1 ? ` · ☀ ${Math.round(data.brightness * 100)}%` : ""}
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
        {data.blackout && <span className="preview-flag">BLACKED OUT</span>}
        <span className="grow" />
        <button
          className={`icon-btn brightness-btn ${prefs.brightnessOpen || data.brightness !== 1 ? "on" : ""}`}
          title="Player window brightness"
          onClick={() => setPrefs({ ...prefs, brightnessOpen: !prefs.brightnessOpen })}
        >
          ☀{data.brightness !== 1 ? ` ${Math.round(data.brightness * 100)}%` : ""}
        </button>
        <button className="icon-btn" title="Minimize" onClick={() => setPrefs({ ...prefs, minimized: true })}>
          ▁
        </button>
      </div>
      {prefs.brightnessOpen && <BrightnessRow value={data.brightness} />}
      <div className="preview-body" style={{ height, filter: brightnessFilter(data.brightness) }}>
        {vp ? (
          <PlayerMapView
            level={level}
            focusRoomId={focusRoomId}
            width={width}
            height={height}
            view={view}
            rotation={vp.rotation ?? 0}
            compass={data.compass}
            compassSize={compassSizeFor(vp.width, vp.height) * f}
            blackout={data.blackout}
            handout={data.handout?.url ?? null}
            blackoutLabel="Players see a black screen"
            interactive={false}
          />
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

/** Slider row for the player window's brightness. */
function BrightnessRow({ value }: { value: number }) {
  const set = (v: number) => useSession.getState().setBrightness(v);
  return (
    <div className="brightness-row">
      <span className="brightness-icon dim">☀</span>
      <input
        type="range"
        min={MIN_BRIGHTNESS}
        max={MAX_BRIGHTNESS}
        step={0.05}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        onDoubleClick={() => set(1)}
        title="Player window brightness · double-click for normal"
      />
      <span className="brightness-icon">☀</span>
      <span className="brightness-value">{Math.round(value * 100)}%</span>
      <button disabled={value === 1} onClick={() => set(1)} title="Back to normal brightness">
        Reset
      </button>
    </div>
  );
}
