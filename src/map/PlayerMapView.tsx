import { Group, Layer, Line, Rect, Stage } from "react-konva";
import type Konva from "konva";
import type { PlayerLevel } from "../lib/playerData";
import { bbox, fitBox, normalizeWinding, toFlat, unionBox, type ViewTransform } from "../lib/geometry";
import { CELL, GridImage, GridLines } from "./common";

/** Pixel-space bounding box of all known rooms on the level. */
export function knownBounds(level: PlayerLevel) {
  const b = unionBox(level.rooms.map((r) => bbox(r.polygon)));
  if (!b) return { x: 0, y: 0, width: level.width * CELL, height: level.height * CELL };
  return { x: b.x * CELL, y: b.y * CELL, width: b.width * CELL, height: b.height * CELL };
}

export function fitKnown(level: PlayerLevel, w: number, h: number): ViewTransform {
  return fitBox(knownBounds(level), w, h, 0.06);
}

export function fitRoom(level: PlayerLevel, roomId: string, w: number, h: number): ViewTransform | null {
  const room = level.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const b = bbox(room.polygon);
  return fitBox({ x: b.x * CELL, y: b.y * CELL, width: b.width * CELL, height: b.height * CELL }, w, h, 0.06);
}

/**
 * The fog-of-war map the players see: only known rooms are visible, showing
 * the player background image and grid; everything else is black.
 */
export function PlayerMapView({
  level,
  focusRoomId,
  width,
  height,
  view,
  interactive,
  onWheel,
  onDragMove,
}: {
  level: PlayerLevel | null;
  focusRoomId: string | null;
  width: number;
  height: number;
  view: ViewTransform;
  interactive: boolean;
  onWheel?: (e: Konva.KonvaEventObject<WheelEvent>) => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
}) {
  if (width <= 0 || height <= 0) return null;
  const polys = level ? level.rooms.map((r) => normalizeWinding(r.polygon)) : [];
  const px = 1 / Math.max(view.scale, 0.01); // one screen pixel in world units
  const floor = level
    ? unionBox([knownBounds(level), { x: 0, y: 0, width: level.width * CELL, height: level.height * CELL }])
    : null;
  return (
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
          <>
            <Group
              clipFunc={(ctx) => {
                // Union of all known rooms (same winding, nonzero rule).
                ctx.beginPath();
                for (const poly of polys) {
                  poly.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * CELL, p.y * CELL) : ctx.lineTo(p.x * CELL, p.y * CELL)));
                  ctx.closePath();
                }
              }}
            >
              {/* Neutral floor under known rooms that lack a background image. */}
              <Rect
                x={floor!.x}
                y={floor!.y}
                width={floor!.width}
                height={floor!.height}
                fill="#3a342c"
              />
              {level.image && (
                <GridImage url={level.image.url} rect={level.image.rect} gridWidth={level.width} gridHeight={level.height} />
              )}
              <GridLines width={level.width} height={level.height} color="rgba(0,0,0,0.45)" viewScale={view.scale} />
            </Group>
            {level.rooms.map((r) => {
              const focused = r.id === focusRoomId;
              return (
                <Line
                  key={r.id}
                  points={toFlat(r.polygon, CELL)}
                  closed
                  fill={focused ? "rgba(255,214,120,0.16)" : "rgba(255,244,220,0.07)"}
                  stroke={focused ? "rgba(255,214,120,0.95)" : "rgba(255,244,220,0.45)"}
                  strokeWidth={(focused ? 3 : 1.5) * px}
                  shadowColor={focused ? "#ffd166" : undefined}
                  shadowBlur={focused ? 12 * px : 0}
                  shadowEnabled={focused}
                />
              );
            })}
          </>
        )}
      </Layer>
    </Stage>
  );
}
