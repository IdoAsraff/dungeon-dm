import type { ReactNode } from "react";
import { Group, Layer, Rect, Stage } from "react-konva";
import type Konva from "konva";
import type { PlayerLevel } from "../lib/playerData";
import type { PlayerRotation } from "../types";
import { bbox, fitBox, rotateBox, unionBox, type Box, type ViewTransform } from "../lib/geometry";
import { CELL, FloorTiles, GridImage, GridLines, clipToPolygons } from "./common";
import { HandoutLayer, PingRings, RevealVeils, useRevealFades } from "./effects";

/** Pixel-space bounding box of all known rooms on the level. */
export function knownBounds(level: PlayerLevel): Box {
  const b = unionBox(level.rooms.map((r) => bbox(r.polygon)));
  if (!b) return { x: 0, y: 0, width: level.width * CELL, height: level.height * CELL };
  return { x: b.x * CELL, y: b.y * CELL, width: b.width * CELL, height: b.height * CELL };
}

/** View that shows every known room of the level. */
export function fitKnown(level: PlayerLevel, w: number, h: number, rotation: PlayerRotation): ViewTransform {
  return fitBox(rotateBox(knownBounds(level), rotation), w, h, 0.06);
}

/** View that makes the room fill the window. */
export function fitRoom(level: PlayerLevel, roomId: string, w: number, h: number, rotation: PlayerRotation): ViewTransform | null {
  const room = level.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const b = bbox(room.polygon);
  const box = { x: b.x * CELL, y: b.y * CELL, width: b.width * CELL, height: b.height * CELL };
  return fitBox(rotateBox(box, rotation), w, h, 0.06);
}

/** Compass diameter for a player window of the given size. */
export function compassSizeFor(width: number, height: number): number {
  return Math.max(44, Math.min(110, Math.min(width, height) * 0.12));
}

/** Background of revealed areas: the player image, or flagstones when there is none. */
function Floor({ level, viewScale }: { level: PlayerLevel; viewScale: number }) {
  const grid = { x: 0, y: 0, width: level.width * CELL, height: level.height * CELL };
  return (
    <>
      {level.image ? (
        <>
          <Rect {...(unionBox([knownBounds(level), grid]) as Box)} fill="#15171b" />
          <GridImage url={level.image.url} rect={level.image.rect} gridWidth={level.width} gridHeight={level.height} />
        </>
      ) : (
        <FloorTiles box={unionBox([knownBounds(level), grid])!} />
      )}
      <GridLines width={level.width} height={level.height} color="rgba(0,0,0,0.4)" viewScale={viewScale} />
    </>
  );
}

/**
 * The fog-of-war map the players see. Only known rooms are visible; the
 * focused room is shown normally and every other known room is dimmed and
 * slightly desaturated. With no focused room, all known rooms are shown
 * normally. Everything else is black.
 */
export function PlayerMapView({
  level,
  focusRoomId,
  width,
  height,
  view,
  rotation,
  compass,
  compassSize,
  blackout,
  handout,
  blackoutLabel,
  interactive,
  onWheel,
  onDragMove,
  children,
}: {
  level: PlayerLevel | null;
  focusRoomId: string | null;
  width: number;
  height: number;
  view: ViewTransform;
  rotation: PlayerRotation;
  compass: boolean;
  /** Override the compass diameter (the DM preview scales the player's). */
  compassSize?: number;
  blackout: boolean;
  /** Image shown full-screen over the map. */
  handout?: string[] | null;
  /** Text shown on the black screen (used by the DM preview only). */
  blackoutLabel?: string;
  interactive: boolean;
  onWheel?: (e: Konva.KonvaEventObject<WheelEvent>) => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  children?: ReactNode;
}) {
  const fades = useRevealFades(level?.id ?? null, level?.rooms.map((r) => r.id) ?? []);
  if (width <= 0 || height <= 0) return null;
  const focused = level?.rooms.find((r) => r.id === focusRoomId) ?? null;
  const knownClip = level ? clipToPolygons(level.rooms.map((r) => r.polygon)) : undefined;
  const big = level ? unionBox([knownBounds(level), { x: 0, y: 0, width: level.width * CELL, height: level.height * CELL }])! : null;
  return (
    <div className="player-map" style={{ width, height }}>
      <Stage
        width={width}
        height={height}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        draggable={interactive}
        onWheel={onWheel}
        onDragMove={onDragMove}
        listening={interactive}
      >
        <Layer listening={false}>
          {level && (
            <Group rotation={rotation}>
              <Group clipFunc={knownClip}>
                <Floor level={level} viewScale={view.scale} />
                {focused && (
                  <>
                    {/* Dim everything, then paint the focused room again on top. */}
                    <Rect {...big!} fill="#808080" opacity={0.25} globalCompositeOperation="saturation" />
                    <Rect {...big!} fill="#000" opacity={0.45} />
                  </>
                )}
              </Group>
              {focused && (
                <Group clipFunc={clipToPolygons([focused.polygon])}>
                  <Floor level={level} viewScale={view.scale} />
                </Group>
              )}
              <RevealVeils rooms={level.rooms} fades={fades} />
              <PingRings levelId={level.id} viewScale={view.scale} />
            </Group>
          )}
        </Layer>
      </Stage>
      {compass && level && <Compass rotation={rotation} size={compassSize ?? compassSizeFor(width, height)} />}
      <HandoutLayer urls={handout ?? null} />
      <div className={`player-blackout ${blackout ? "on" : ""}`}>{blackoutLabel}</div>
      {children}
    </div>
  );
}

/** A compass rose whose needle follows the map rotation; letters stay upright. */
export function Compass({ rotation, size }: { rotation: number; size: number }) {
  const r = size / 2;
  const letter = (label: string, deg: number) => {
    const a = ((deg + rotation - 90) * Math.PI) / 180;
    const d = r * 0.78;
    return (
      <text
        key={label}
        x={r + Math.cos(a) * d}
        y={r + Math.sin(a) * d}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={label === "N" ? size * 0.2 : size * 0.14}
        fontWeight={label === "N" ? 700 : 500}
        fill={label === "N" ? "#f0c46a" : "#d8d2c4"}
        fontFamily="Georgia, serif"
      >
        {label}
      </text>
    );
  };
  const n = size * 0.52; // needle half-length
  return (
    <svg className="player-compass" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={r} cy={r} r={r - 1} fill="rgba(10,10,12,0.72)" stroke="rgba(240,196,106,0.55)" strokeWidth={1.5} />
      <g transform={`rotate(${rotation} ${r} ${r})`}>
        <polygon points={`${r},${r - n * 0.62} ${r + size * 0.07},${r} ${r - size * 0.07},${r}`} fill="#d94f3d" />
        <polygon points={`${r},${r + n * 0.62} ${r + size * 0.07},${r} ${r - size * 0.07},${r}`} fill="#d8d2c4" />
        <circle cx={r} cy={r} r={size * 0.035} fill="#1b1b1f" />
      </g>
      {letter("N", 0)}
      {letter("E", 90)}
      {letter("S", 180)}
      {letter("W", 270)}
    </svg>
  );
}
