import { useCallback, useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import type Konva from "konva";
import { backend } from "../lib/backend";
import { EVENTS, type PlayerData } from "../lib/playerData";
import type { PlayerViewport } from "../store/ui";
import { useElementSize, useViewTransform } from "../map/common";
import { fitKnown, fitRoom, PlayerMapView } from "../map/PlayerMapView";

const IDLE_MS = 2500;

/** The view-only player window. All data comes from the DM window via events. */
export function PlayerApp() {
  const [data, setData] = useState<PlayerData | null>(null);
  const [levelId, setLevelId] = useState<string | null>(null);
  const [kiosk, setKiosk] = useState(false);
  const [idle, setIdle] = useState(false);
  const [shownCount, setShownCount] = useState(0);
  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const { view, viewRef, setView, animateTo, onWheel, zoomBy } = useViewTransform();

  // Pending "fit" to apply once the window has a size / the level has rendered.
  const pendingFit = useRef<{ kind: "room"; roomId: string; animate: boolean } | { kind: "level"; animate: boolean } | null>(
    null,
  );
  const lastNonce = useRef<number | null>(null);
  const levelIdRef = useRef(levelId);
  levelIdRef.current = levelId;

  // ---- data from the DM -----------------------------------------------------
  useEffect(() => {
    const handle = (d: PlayerData) => {
      setData(d);
      const available = d.levels.map((l) => l.id);
      const first = lastNonce.current === null;
      if (d.focus && (first || d.focusNonce !== lastNonce.current)) {
        setLevelId(d.focus.levelId);
        pendingFit.current = { kind: "room", roomId: d.focus.roomId, animate: !first };
      } else if (first || !levelIdRef.current || !available.includes(levelIdRef.current)) {
        const next =
          d.preferredLevelId && available.includes(d.preferredLevelId) ? d.preferredLevelId : (available[0] ?? null);
        if (next !== levelIdRef.current || first) pendingFit.current = { kind: "level", animate: false };
        setLevelId(next);
      }
      lastNonce.current = d.focusNonce;
    };
    const unlisteners = [
      listen<PlayerData>(EVENTS.playerData, (e) => handle(e.payload)),
      listen<{ kiosk: boolean }>(EVENTS.kiosk, (e) => setKiosk(e.payload.kiosk)),
      listen(EVENTS.playerShown, () => setShownCount((n) => n + 1)),
    ];
    void emit(EVENTS.playerReady);
    backend
      .getSettings()
      .then((s) => setKiosk(s.playerFullscreen))
      .catch(() => {});
    return () => unlisteners.forEach((u) => void u.then((f) => f()));
  }, []);

  const level = data?.levels.find((l) => l.id === levelId) ?? null;

  // Apply pending fits once we know the window size.
  useEffect(() => {
    const p = pendingFit.current;
    if (!p || !level || size.width === 0) return;
    pendingFit.current = null;
    const t = p.kind === "room" ? fitRoom(level, p.roomId, size.width, size.height) : fitKnown(level, size.width, size.height);
    if (!t) return;
    if (p.animate) animateTo(t, 700);
    else setView(t);
  }, [data, level, size.width, size.height, animateTo, setView]);

  // ---- report the viewport to the DM (for the preview panel) ----------------
  useEffect(() => {
    const vp: PlayerViewport = { levelId, ...view, width: size.width, height: size.height };
    const t = setTimeout(() => void emit(EVENTS.playerViewport, vp), 30);
    return () => clearTimeout(t);
  }, [view, size.width, size.height, levelId, shownCount]);

  // ---- idle handling: hide controls (and cursor in kiosk mode) ---------------
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), IDLE_MS);
    };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("mousedown", wake);
    window.addEventListener("wheel", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("mousedown", wake);
      window.removeEventListener("wheel", wake);
    };
  }, []);

  const toggleFullscreen = useCallback(() => void backend.setPlayerFullscreen(!kiosk), [kiosk]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F") toggleFullscreen();
      if (e.key === "Escape" && kiosk) void backend.setPlayerFullscreen(false);
      if (e.key === "+" || e.key === "=") zoomBy(1.25, size.width, size.height);
      if (e.key === "-") zoomBy(0.8, size.width, size.height);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen, kiosk, zoomBy, size.width, size.height]);

  const switchLevel = (id: string) => {
    const l = data?.levels.find((x) => x.id === id);
    setLevelId(id);
    if (l && size.width > 0) setView(fitKnown(l, size.width, size.height));
  };

  const onDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const stage = e.target.getStage();
    if (stage && e.target === stage) setView({ ...viewRef.current, x: stage.x(), y: stage.y() });
  };

  const focusRoomId = data?.focus && data.focus.levelId === levelId ? data.focus.roomId : null;
  const levels = data?.levels ?? [];

  return (
    <div className={`player-root ${kiosk && idle ? "hide-cursor" : ""}`} ref={containerRef}>
      <PlayerMapView
        level={level}
        focusRoomId={focusRoomId}
        width={size.width}
        height={size.height}
        view={view}
        interactive
        onWheel={onWheel}
        onDragMove={onDragMove}
      />
      {!level && (
        <div className="player-empty">
          <div className="player-title">{data?.dungeonName ?? ""}</div>
        </div>
      )}
      <div className={`player-controls ${idle ? "hidden" : ""}`}>
        {levels.length > 1 &&
          levels.map((l) => (
            <button key={l.id} className={l.id === levelId ? "active" : ""} onClick={() => switchLevel(l.id)}>
              {l.name}
            </button>
          ))}
        {levels.length === 1 && <span className="player-level-name">{levels[0].name}</span>}
        <span className="spacer" />
        <button onClick={() => zoomBy(1.25, size.width, size.height)} title="Zoom in (+)">
          +
        </button>
        <button onClick={() => zoomBy(0.8, size.width, size.height)} title="Zoom out (−)">
          −
        </button>
        {level && (
          <button onClick={() => setView(fitKnown(level, size.width, size.height))} title="Show everything">
            ⤢
          </button>
        )}
        <button onClick={toggleFullscreen} title="Toggle fullscreen (F)">
          {kiosk ? "Exit fullscreen" : "Fullscreen"}
        </button>
      </div>
    </div>
  );
}
