import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Layer, Line, Rect, Stage, Text } from "react-konva";
import type Konva from "konva";
import { roomTitle, type EntityKind, type EntityRef, type Level, type Point, type Polygon } from "../types";
import {
  area,
  circlePolygon,
  fitBox,
  focusView,
  freeformToPolygon,
  isValidPolygon,
  labelPoint,
  rectPolygon,
  round3,
  snapPoint,
  snapValue,
  toFlat,
  translate,
} from "../lib/geometry";
import { CELL, FloorTiles, GridBackdrop, GridImage, GridLines, clipToPolygons, useElementSize, useViewTransform } from "../map/common";
import { assetUrl } from "../lib/backend";
import { useDoc } from "../store/doc";
import { useSession } from "../store/session";
import { useUi, type DrawMode } from "../store/ui";

const COLORS = {
  room: { r: 96, g: 160, b: 255 },
  roomKnown: { r: 90, g: 210, b: 140 },
  door: { r: 240, g: 150, b: 50 },
  object: { r: 200, g: 110, b: 240 },
};

const rgba = (c: { r: number; g: number; b: number }, a: number) => `rgba(${c.r},${c.g},${c.b},${a})`;

/** An in-progress drawing. */
type Draft =
  | { tool: "box"; start: Point; current: Point }
  | { tool: "circle"; center: Point; current: Point }
  | { tool: "freeform"; points: Point[] }
  | { tool: "polygon"; points: Point[]; cursor: Point | null };

export function entityPolygon(level: Level, ref: EntityRef): Polygon | undefined {
  const list: { id: string; polygon: Polygon }[] =
    ref.kind === "room" ? level.rooms : ref.kind === "door" ? level.doors : level.objects;
  return list.find((e) => e.id === ref.id)?.polygon;
}

export function DmMap({ level }: { level: Level }) {
  const dir = useUi((s) => s.dungeonDir)!;
  const selection = useUi((s) => s.selection);
  const hover = useUi((s) => s.hover);
  const draw = useUi((s) => s.draw);
  const editingShape = useUi((s) => s.editingShape);
  const snap = useUi((s) => s.snap);
  const setUi = useUi((s) => s.set);
  const focus = useSession((s) => s.focus);

  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const { view, viewRef, setView, animateTo, onWheel, zoomBy } = useViewTransform();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);

  const fitLevel = useCallback(
    (animate: boolean) => {
      if (size.width === 0) return;
      const t = fitBox({ x: 0, y: 0, width: level.width * CELL, height: level.height * CELL }, size.width, size.height, 0.04);
      if (animate) animateTo(t);
      else setView(t);
    },
    [level.width, level.height, size.width, size.height, animateTo, setView],
  );

  // Fit the whole level when switching levels (or on first layout).
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    if (size.width === 0 || fittedFor.current === level.id) return;
    fittedFor.current = level.id;
    fitLevel(false);
  }, [level.id, size.width, fitLevel]);

  // Zoom to the selection when asked from elsewhere (e.g. the room list).
  const zoomRequest = useUi((s) => s.zoomRequest);
  useEffect(() => {
    if (!zoomRequest || size.width === 0) return;
    const poly = entityPolygon(level, zoomRequest.target);
    if (!poly) return;
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    const box = {
      x: Math.min(...xs) * CELL,
      y: Math.min(...ys) * CELL,
      width: (Math.max(...xs) - Math.min(...xs)) * CELL,
      height: (Math.max(...ys) - Math.min(...ys)) * CELL,
    };
    animateTo(focusView(box, size.width, size.height, Math.max(viewRef.current.scale, 1.2)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomRequest]);

  useEffect(() => setDraft(null), [draw, level.id]);

  // ---- geometry helpers -----------------------------------------------------

  const pointer = (stage: Konva.Stage | null): Point | null => {
    const p = stage?.getRelativePointerPosition();
    return p ? { x: p.x / CELL, y: p.y / CELL } : null;
  };
  const snapped = (p: Point, e?: MouseEvent) => (e?.altKey || snap === 0 ? p : snapPoint(p, snap));
  const round = (p: Point): Point => ({ x: round3(p.x), y: round3(p.y) });

  // ---- finishing a drawing -------------------------------------------------

  const finish = useCallback(
    (mode: DrawMode, polygon: Polygon | null) => {
      setDraft(null);
      if (!polygon || !isValidPolygon(polygon)) {
        useUi.getState().showToast("That shape is too small — try again (Esc to cancel).");
        return;
      }
      const doc = useDoc.getState();
      const ui = useUi.getState();
      const purpose = mode.purpose;
      if (purpose.type === "reshape") {
        doc.setPolygon(purpose.target.kind, level.id, purpose.target.id, polygon);
        ui.set({ draw: null, selection: purpose.target });
        return;
      }
      if (purpose.kind === "room") {
        const room = doc.addRoom(level.id, polygon);
        ui.set({ draw: null, selection: { kind: "room", id: room.id }, focusTitleFor: room.id });
        ui.showToast(`Room ${room.number} created — type a title, or press Enter to keep “Room ${room.number}”`);
      } else {
        const id = doc.addShape(purpose.kind, level.id, polygon);
        ui.set({ draw: null, selection: { kind: purpose.kind, id } });
        ui.showToast(purpose.kind === "door" ? "Door created" : "Global object created");
      }
    },
    [level.id],
  );

  // Keyboard: Esc cancels, Enter closes a polygon, Backspace removes the last point, Space pans.
  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
    const onDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === "Space") {
        setSpaceHeld(true);
        e.preventDefault();
      }
      const ui = useUi.getState();
      if (e.key === "Escape") {
        if (ui.draw) ui.set({ draw: null });
        else if (ui.editingShape) ui.set({ editingShape: false });
        else if (ui.selection) ui.set({ selection: null });
        return;
      }
      if (!ui.draw || !draft || draft.tool !== "polygon") return;
      if (e.key === "Enter" && draft.points.length >= 3) finish(ui.draw, draft.points);
      if (e.key === "Backspace") {
        e.preventDefault();
        setDraft({ ...draft, points: draft.points.slice(0, -1) });
      }
    };
    const onUp = (e: KeyboardEvent) => e.code === "Space" && setSpaceHeld(false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [draft, finish]);

  // ---- stage mouse handlers (drawing) ---------------------------------------

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!draw || spaceHeld || e.evt.button !== 0) return;
    const p = pointer(e.target.getStage());
    if (!p) return;
    switch (draw.tool) {
      case "box": {
        const s = snapped(p, e.evt);
        setDraft({ tool: "box", start: s, current: s });
        break;
      }
      case "circle": {
        const c = snapped(p, e.evt);
        setDraft({ tool: "circle", center: c, current: c });
        break;
      }
      case "freeform":
        setDraft({ tool: "freeform", points: [round(p)] });
        break;
      case "polygon": {
        const s = round(snapped(p, e.evt));
        const pts = draft?.tool === "polygon" ? draft.points : [];
        const first = pts[0];
        const closeDist = 10 / (viewRef.current.scale * CELL);
        if (first && pts.length >= 3 && Math.hypot(first.x - p.x, first.y - p.y) <= Math.max(closeDist, 0.15)) {
          finish(draw, pts);
          return;
        }
        const last = pts[pts.length - 1];
        if (last && last.x === s.x && last.y === s.y) return;
        setDraft({ tool: "polygon", points: [...pts, s], cursor: s });
        break;
      }
    }
  };

  const onMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!draw || !draft) return;
    const p = pointer(e.target.getStage());
    if (!p) return;
    switch (draft.tool) {
      case "box":
        setDraft({ ...draft, current: snapped(p, e.evt) });
        break;
      case "circle":
        setDraft({ ...draft, current: p });
        break;
      case "freeform": {
        const last = draft.points[draft.points.length - 1];
        if (Math.hypot(last.x - p.x, last.y - p.y) > 0.08) setDraft({ ...draft, points: [...draft.points, round(p)] });
        break;
      }
      case "polygon":
        setDraft({ ...draft, cursor: snapped(p, e.evt) });
        break;
    }
  };

  const onMouseUp = () => {
    if (!draw || !draft) return;
    if (draft.tool === "box") {
      const poly = rectPolygon(draft.start, draft.current);
      if (area(poly) === 0) {
        setDraft(null);
        return;
      }
      finish(draw, poly);
    } else if (draft.tool === "circle") {
      let r = Math.hypot(draft.current.x - draft.center.x, draft.current.y - draft.center.y);
      if (snap > 0) r = Math.max(snap / 2, snapValue(r, snap / 2));
      if (r < 0.1) {
        setDraft(null);
        return;
      }
      finish(draw, circlePolygon(draft.center, r));
    } else if (draft.tool === "freeform") {
      finish(draw, freeformToPolygon(draft.points));
    }
  };

  const onDblClick = () => {
    if (draw && draft?.tool === "polygon" && draft.points.length >= 3) finish(draw, draft.points);
  };

  // ---- panning ------------------------------------------------------------

  const panEnabled = !draw || spaceHeld;
  const onDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const stage = e.target.getStage();
    if (e.target !== stage || !stage) return;
    setView({ ...viewRef.current, x: stage.x(), y: stage.y() });
  };

  const onStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (draw) return;
    if (e.target === e.target.getStage()) {
      setUi({ selection: null, editingShape: false });
    }
  };

  // ---- entity rendering -----------------------------------------------------

  const sortedRooms = useMemo(
    // Larger rooms underneath so that small overlapping rooms stay clickable.
    () => [...level.rooms].sort((a, b) => area(b.polygon) - area(a.polygon)),
    [level.rooms],
  );

  const isSel = (kind: EntityKind, id: string) => selection?.kind === kind && selection.id === id;
  const isHover = (kind: EntityKind, id: string) => hover?.kind === kind && hover.id === id;
  const handlers = (ref: EntityRef) => ({
    onMouseEnter: () => setUi({ hover: ref }),
    onMouseLeave: () => {
      if (useUi.getState().hover?.id === ref.id) setUi({ hover: null });
    },
    onClick: (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button !== 0) return;
      const cur = useUi.getState().selection;
      const same = cur?.kind === ref.kind && cur.id === ref.id;
      setUi({ selection: ref, editingShape: same ? useUi.getState().editingShape : false });
    },
  });

  const editTarget = editingShape && selection ? selection : null;
  const labelSize = 16 / view.scale;
  const strokeW = 2;

  const cursor = draw ? (spaceHeld ? "grab" : "crosshair") : hover ? "pointer" : "grab";

  return (
    <div className="map-container" ref={containerRef} style={{ cursor }}>
      {size.width > 0 && (
        <Stage
          width={size.width}
          height={size.height}
          x={view.x}
          y={view.y}
          scaleX={view.scale}
          scaleY={view.scale}
          draggable={panEnabled}
          dragDistance={4}
          onDragMove={onDragMove}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onDblClick={onDblClick}
          onClick={onStageClick}
        >
          <Layer listening={false}>
            <GridBackdrop width={level.width} height={level.height} fill="#23262d" />
            {!level.dmImage && level.rooms.length > 0 && (
              // No DM image: flagstones inside rooms, dark rock everywhere else.
              <Group clipFunc={clipToPolygons(level.rooms.map((r) => r.polygon))}>
                <FloorTiles box={{ x: 0, y: 0, width: level.width * CELL, height: level.height * CELL }} />
              </Group>
            )}
            {level.dmImage && (
              <GridImage
                url={assetUrl(dir, level.dmImage.path)}
                rect={level.dmImage.rect}
                gridWidth={level.width}
                gridHeight={level.height}
              />
            )}
            <GridLines
              width={level.width}
              height={level.height}
              color="rgba(255,255,255,0.22)"
              majorEvery={5}
              majorColor="rgba(255,255,255,0.38)"
              viewScale={view.scale}
            />
            <Rect
              x={0}
              y={0}
              width={level.width * CELL}
              height={level.height * CELL}
              stroke="rgba(255,255,255,0.6)"
              strokeWidth={2}
              strokeScaleEnabled={false}
            />
          </Layer>

          <Layer listening={!draw}>
            {sortedRooms.map((room) => {
              const ref: EntityRef = { kind: "room", id: room.id };
              const c = room.playerKnown ? COLORS.roomKnown : COLORS.room;
              const sel = isSel("room", room.id);
              const hov = isHover("room", room.id);
              const focused = focus?.levelId === level.id && focus.roomId === room.id && room.playerKnown;
              return (
                <Group key={room.id}>
                  <Line
                    points={toFlat(room.polygon, CELL)}
                    closed
                    fill={rgba(c, sel ? 0.42 : hov ? 0.34 : 0.16)}
                    stroke={rgba(c, sel || hov ? 1 : 0.8)}
                    strokeWidth={sel ? strokeW * 1.8 : strokeW}
                    strokeScaleEnabled={false}
                    {...handlers(ref)}
                  />
                  {focused && (
                    <Line
                      points={toFlat(room.polygon, CELL)}
                      closed
                      stroke="#ffd166"
                      strokeWidth={3}
                      dash={[10, 6]}
                      strokeScaleEnabled={false}
                      listening={false}
                    />
                  )}
                </Group>
              );
            })}
            {level.objects.map((o) => {
              const sel = isSel("object", o.id);
              const hov = isHover("object", o.id);
              return (
                <Line
                  key={o.id}
                  points={toFlat(o.polygon, CELL)}
                  closed
                  fill={rgba(COLORS.object, sel ? 0.4 : hov ? 0.3 : 0.14)}
                  stroke={rgba(COLORS.object, sel || hov ? 1 : 0.8)}
                  strokeWidth={sel ? strokeW * 1.8 : strokeW}
                  dash={[8, 5]}
                  strokeScaleEnabled={false}
                  {...handlers({ kind: "object", id: o.id })}
                />
              );
            })}
            {level.doors.map((d) => {
              const sel = isSel("door", d.id);
              const hov = isHover("door", d.id);
              return (
                <Line
                  key={d.id}
                  points={toFlat(d.polygon, CELL)}
                  closed
                  fill={rgba(COLORS.door, sel ? 0.9 : hov ? 0.8 : 0.6)}
                  stroke={sel || hov ? "#fff" : rgba(COLORS.door, 1)}
                  strokeWidth={sel ? strokeW * 1.8 : strokeW}
                  strokeScaleEnabled={false}
                  hitStrokeWidth={12}
                  {...handlers({ kind: "door", id: d.id })}
                />
              );
            })}
            {level.rooms.map((room) => {
              const lp = labelPoint(room.polygon);
              return (
                <Text
                  key={`label-${room.id}`}
                  x={lp.x * CELL}
                  y={lp.y * CELL}
                  text={String(room.number)}
                  fontSize={labelSize}
                  fontStyle="bold"
                  fill="#fff"
                  stroke="rgba(0,0,0,0.85)"
                  strokeWidth={3 / view.scale}
                  fillAfterStrokeEnabled
                  width={labelSize * 4}
                  offsetX={labelSize * 2}
                  offsetY={labelSize / 2}
                  align="center"
                  listening={false}
                />
              );
            })}
          </Layer>

          <Layer>
            {draft && draw && <DraftPreview draft={draft} scale={view.scale} snap={snap} />}
            {editTarget && !draw && (
              <ShapeEditor key={`${editTarget.kind}-${editTarget.id}`} level={level} target={editTarget} scale={view.scale} snap={snap} />
            )}
          </Layer>
        </Stage>
      )}
      <MapHud
        level={level}
        draw={draw}
        draft={draft}
        onFit={() => fitLevel(true)}
        onZoom={(f) => zoomBy(f, size.width, size.height)}
      />
    </div>
  );
}

function DraftPreview({ draft, scale, snap }: { draft: Draft; scale: number; snap: number }) {
  const stroke = "#ffd166";
  const common = { stroke, strokeWidth: 2, strokeScaleEnabled: false, listening: false, fill: "rgba(255,209,102,0.18)" };
  switch (draft.tool) {
    case "box":
      return <Line points={toFlat(rectPolygon(draft.start, draft.current), CELL)} closed {...common} />;
    case "circle": {
      let r = Math.hypot(draft.current.x - draft.center.x, draft.current.y - draft.center.y);
      if (snap > 0) r = Math.max(snap / 2, snapValue(r, snap / 2));
      return <Line points={toFlat(circlePolygon(draft.center, r), CELL)} closed {...common} />;
    }
    case "freeform":
      return <Line points={toFlat(draft.points, CELL)} {...common} fill={undefined} />;
    case "polygon": {
      const pts = draft.cursor ? [...draft.points, draft.cursor] : draft.points;
      return (
        <Group listening={false}>
          <Line points={toFlat(pts, CELL)} closed={pts.length >= 3} {...common} dash={[6, 4]} />
          {draft.points.map((p, i) => (
            <Circle
              key={i}
              x={p.x * CELL}
              y={p.y * CELL}
              radius={(i === 0 ? 7 : 4) / scale}
              fill={i === 0 ? "#ffd166" : "#fff"}
              stroke="#000"
              strokeWidth={1 / scale}
            />
          ))}
        </Group>
      );
    }
  }
}

/** Vertex editing: drag vertices, click midpoints to add, double-click a vertex to remove, drag the body to move. */
function ShapeEditor({ level, target, scale, snap }: { level: Level; target: EntityRef; scale: number; snap: number }) {
  const polygon = entityPolygon(level, target);
  const [temp, setTemp] = useState<Polygon | null>(null);
  if (!polygon) return null;
  const poly = temp ?? polygon;
  const commit = (p: Polygon) => {
    setTemp(null);
    if (isValidPolygon(p)) useDoc.getState().setPolygon(target.kind, level.id, target.id, p);
  };
  const snapIt = (p: Point, alt: boolean) => {
    const q = alt || snap === 0 ? p : snapPoint(p, snap);
    return { x: round3(q.x), y: round3(q.y) };
  };
  const r = 6 / scale;
  return (
    <Group>
      <Line
        points={toFlat(poly, CELL)}
        closed
        fill="rgba(255,209,102,0.15)"
        stroke="#ffd166"
        strokeWidth={2}
        strokeScaleEnabled={false}
        draggable
        onMouseEnter={(e) => {
          const c = e.target.getStage()?.container();
          if (c) c.style.cursor = "move";
        }}
        onMouseLeave={(e) => {
          const c = e.target.getStage()?.container();
          if (c) c.style.cursor = "";
        }}
        onDragMove={(e) => {
          const node = e.target;
          let dx = node.x() / CELL;
          let dy = node.y() / CELL;
          if (snap > 0 && !e.evt.altKey) {
            dx = snapValue(dx, snap);
            dy = snapValue(dy, snap);
            node.position({ x: dx * CELL, y: dy * CELL });
          }
        }}
        onDragEnd={(e) => {
          const node = e.target;
          const dx = node.x() / CELL;
          const dy = node.y() / CELL;
          node.position({ x: 0, y: 0 });
          if (dx !== 0 || dy !== 0) commit(translate(polygon, dx, dy));
        }}
      />
      {poly.map((p, i) => {
        const q = poly[(i + 1) % poly.length];
        return (
          <Circle
            key={`mid-${i}`}
            x={((p.x + q.x) / 2) * CELL}
            y={((p.y + q.y) / 2) * CELL}
            radius={r * 0.7}
            fill="rgba(255,255,255,0.5)"
            stroke="#000"
            strokeWidth={1 / scale}
            onClick={() => {
              const next = [...poly];
              next.splice(i + 1, 0, { x: round3((p.x + q.x) / 2), y: round3((p.y + q.y) / 2) });
              commit(next);
            }}
          />
        );
      })}
      {poly.map((p, i) => (
        <Circle
          key={`v-${i}`}
          x={p.x * CELL}
          y={p.y * CELL}
          radius={r}
          fill="#ffd166"
          stroke="#000"
          strokeWidth={1 / scale}
          draggable
          onDragMove={(e) => {
            const node = e.target;
            const s = snapIt({ x: node.x() / CELL, y: node.y() / CELL }, e.evt.altKey);
            node.position({ x: s.x * CELL, y: s.y * CELL });
            const next = [...poly];
            next[i] = s;
            setTemp(next);
          }}
          onDragEnd={() => temp && commit(temp)}
          onDblClick={() => {
            if (poly.length > 3) commit(poly.filter((_, j) => j !== i));
          }}
        />
      ))}
    </Group>
  );
}

const TOOL_HINTS: Record<string, string> = {
  box: "Drag to draw a rectangle.",
  circle: "Drag from the center outwards.",
  freeform: "Hold the mouse button and draw the outline; release to close it.",
  polygon: "Click to add corners. Click the first corner, double-click or press Enter to close. Backspace removes the last corner.",
};

function firstLine(md: string): string {
  return (
    md
      .split("\n")
      .map((l) => l.replace(/^[#>*\-\s]+/, "").replace(/[*_`]/g, "").trim())
      .find((l) => l.length > 0) ?? ""
  );
}

function hoverLabel(level: Level, ref: EntityRef): string | null {
  if (ref.kind === "room") {
    const room = level.rooms.find((r) => r.id === ref.id);
    return room ? `${room.number} · ${roomTitle(room)}` : null;
  }
  const list = ref.kind === "door" ? level.doors : level.objects;
  const item = list.find((o) => o.id === ref.id);
  if (!item) return null;
  const name = ref.kind === "door" ? "Door" : "Object";
  const text = firstLine(item.description);
  return text ? `${name} · ${text}` : name;
}

function SnapSelect() {
  const snap = useUi((s) => s.snap);
  return (
    <select
      value={snap}
      title="Snap drawn points to the grid (hold Alt while drawing to ignore)"
      onChange={(e) => useUi.getState().set({ snap: Number(e.target.value) })}
    >
      <option value={1}>Snap: 1 square</option>
      <option value={0.5}>Snap: ½ square</option>
      <option value={0.25}>Snap: ¼ square</option>
      <option value={0}>Snap: off</option>
    </select>
  );
}

function MapHud({
  level,
  draw,
  draft,
  onFit,
  onZoom,
}: {
  level: Level;
  draw: DrawMode | null;
  draft: Draft | null;
  onFit: () => void;
  onZoom: (f: number) => void;
}) {
  const editingShape = useUi((s) => s.editingShape);
  const hover = useUi((s) => s.hover);
  const hovered = hover ? hoverLabel(level, hover) : null;
  const what = draw
    ? draw.purpose.type === "reshape"
      ? `Redrawing ${draw.purpose.target.kind}`
      : `New ${draw.purpose.kind === "object" ? "global object" : draw.purpose.kind}`
    : null;
  return (
    <>
      {draw && (
        <div className="map-banner">
          <div>
            <b>{what}</b> — {TOOL_HINTS[draw.tool]}{" "}
            {draft?.tool === "polygon" && draft.points.length > 0 && <span>({draft.points.length} corners) </span>}
            <span className="muted">Hold Alt to disable snapping · Space+drag to pan · Esc to cancel</span>
          </div>
          <div className="map-banner-actions">
            <SnapSelect />
            <button className="warn" onClick={() => useUi.getState().set({ draw: null })}>
              Cancel (Esc)
            </button>
          </div>
        </div>
      )}
      {!draw && editingShape && (
        <div className="map-banner">
          <div>
            <b>Editing shape</b> — drag corners to move them, click a midpoint to add a corner, double-click a corner to
            remove it, drag the shape to move it. <span className="muted">Alt disables snapping · Esc to finish</span>
          </div>
          <div className="map-banner-actions">
            <SnapSelect />
            <button onClick={() => useUi.getState().set({ editingShape: false })}>Done</button>
          </div>
        </div>
      )}
      {hovered && !draw && (
        <div className="map-hover" dir="auto">
          {hovered}
        </div>
      )}
      <div className="map-zoom">
        <button onClick={() => onZoom(1.25)} title="Zoom in">
          +
        </button>
        <button onClick={() => onZoom(0.8)} title="Zoom out">
          −
        </button>
        <button onClick={onFit} title="Fit level">
          ⤢
        </button>
      </div>
      <div className="map-info">
        {level.width}×{level.height} squares · {level.scale} ft/square · {level.width * level.scale}×
        {level.height * level.scale} ft
      </div>
    </>
  );
}
