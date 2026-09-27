import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Image as KImage, Rect, Shape } from "react-konva";
import type Konva from "konva";
import type { ImageRect, Polygon } from "../types";
import { normalizeWinding, type Box, type ViewTransform } from "../lib/geometry";
import { floorPattern } from "./floorTile";

import { CELL } from "./constants";

export { CELL };

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;

export function useImageElement(url: string | null | undefined): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) {
      setImg(null);
      return;
    }
    let cancelled = false;
    const el = new window.Image();
    el.onload = () => !cancelled && setImg(el);
    el.onerror = () => !cancelled && setImg(null);
    el.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);
  return img;
}

/** Background image placed on the grid and clipped to the grid bounds. */
export function GridImage({
  url,
  rect,
  gridWidth,
  gridHeight,
  opacity = 1,
}: {
  url: string;
  rect: ImageRect;
  gridWidth: number;
  gridHeight: number;
  opacity?: number;
}) {
  const img = useImageElement(url);
  if (!img) return null;
  return (
    <Group clip={{ x: 0, y: 0, width: gridWidth * CELL, height: gridHeight * CELL }} listening={false}>
      <KImage
        image={img}
        x={rect.x * CELL}
        y={rect.y * CELL}
        width={rect.width * CELL}
        height={rect.height * CELL}
        opacity={opacity}
      />
    </Group>
  );
}

/** Grid lines drawn in a single shape for speed. Stroke width stays ~1 screen px. */
export function GridLines({
  width,
  height,
  color,
  viewScale,
  majorEvery = 0,
  majorColor,
}: {
  width: number;
  height: number;
  color: string;
  viewScale: number;
  majorEvery?: number;
  majorColor?: string;
}) {
  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(ctx) => {
        const lw = 1 / Math.max(viewScale, 0.01);
        const draw = (major: boolean) => {
          ctx.beginPath();
          for (let x = 0; x <= width; x++) {
            if (majorEvery > 0 && (x % majorEvery === 0) !== major) continue;
            if (majorEvery === 0 && major) continue;
            ctx.moveTo(x * CELL, 0);
            ctx.lineTo(x * CELL, height * CELL);
          }
          for (let y = 0; y <= height; y++) {
            if (majorEvery > 0 && (y % majorEvery === 0) !== major) continue;
            if (majorEvery === 0 && major) continue;
            ctx.moveTo(0, y * CELL);
            ctx.lineTo(width * CELL, y * CELL);
          }
          ctx.strokeStyle = major ? (majorColor ?? color) : color;
          ctx.lineWidth = major ? lw * 1.6 : lw;
          ctx.stroke();
        };
        draw(false);
        if (majorEvery > 0) draw(true);
      }}
    />
  );
}

/** Flagstone floor covering `box` (world px), aligned to the grid. */
export function FloorTiles({ box }: { box: Box }) {
  const x0 = Math.floor(box.x / CELL) * CELL;
  const y0 = Math.floor(box.y / CELL) * CELL;
  const x1 = Math.ceil((box.x + box.width) / CELL) * CELL;
  const y1 = Math.ceil((box.y + box.height) / CELL) * CELL;
  return (
    <Rect
      x={x0}
      y={y0}
      width={x1 - x0}
      height={y1 - y0}
      fillPatternImage={floorPattern() as unknown as HTMLImageElement}
      fillPatternRepeat="repeat"
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}

/** Konva clipFunc drawing the union of the given polygons (grid units). */
export function clipToPolygons(polys: Polygon[]) {
  const normalized = polys.map(normalizeWinding);
  return (ctx: Konva.Context) => {
    ctx.beginPath();
    for (const poly of normalized) {
      poly.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * CELL, p.y * CELL) : ctx.lineTo(p.x * CELL, p.y * CELL)));
      ctx.closePath();
    }
  };
}

export function GridBackdrop({ width, height, fill }: { width: number; height: number; fill: string }) {
  return <Rect x={0} y={0} width={width * CELL} height={height * CELL} fill={fill} listening={false} />;
}

/** Observes an element's size. */
export function useElementSize<T extends HTMLElement>(): [React.RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/**
 * Pan/zoom state for a Konva stage, with wheel zoom around the cursor and
 * animated transitions.
 */
export function useViewTransform(initial: ViewTransform = { x: 0, y: 0, scale: 0.5 }) {
  const [view, setViewState] = useState<ViewTransform>(initial);
  const viewRef = useRef(view);
  const anim = useRef<number | null>(null);

  const setView = useCallback((v: ViewTransform) => {
    if (anim.current !== null) cancelAnimationFrame(anim.current);
    anim.current = null;
    viewRef.current = v;
    setViewState(v);
  }, []);

  const animateTo = useCallback((target: ViewTransform, ms = 450) => {
    if (anim.current !== null) cancelAnimationFrame(anim.current);
    const from = viewRef.current;
    const start = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const k = ease(t);
      // Interpolate scale logarithmically so zooms feel even.
      const scale = Math.exp(Math.log(from.scale) + (Math.log(target.scale) - Math.log(from.scale)) * k);
      // Keep the interpolated world-center path straight.
      const cx0 = -from.x / from.scale;
      const cy0 = -from.y / from.scale;
      const cx1 = -target.x / target.scale;
      const cy1 = -target.y / target.scale;
      const v = {
        scale,
        x: -(cx0 + (cx1 - cx0) * k) * scale,
        y: -(cy0 + (cy1 - cy0) * k) * scale,
      };
      if (t >= 1) {
        viewRef.current = target;
        setViewState(target);
        anim.current = null;
        return;
      }
      viewRef.current = v;
      setViewState(v);
      anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }, []);

  const onWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (!pointer) return;
      const v = viewRef.current;
      // Pinch gestures arrive as ctrl+wheel with small deltas; mouse wheels with large ones.
      const intensity = e.evt.ctrlKey ? 0.01 : 0.0015;
      const factor = Math.exp(-e.evt.deltaY * intensity);
      const scale = clampScale(v.scale * factor);
      const wx = (pointer.x - v.x) / v.scale;
      const wy = (pointer.y - v.y) / v.scale;
      setView({ scale, x: pointer.x - wx * scale, y: pointer.y - wy * scale });
    },
    [setView],
  );

  const zoomBy = useCallback(
    (factor: number, viewW: number, viewH: number) => {
      const v = viewRef.current;
      const scale = clampScale(v.scale * factor);
      const wx = (viewW / 2 - v.x) / v.scale;
      const wy = (viewH / 2 - v.y) / v.scale;
      setView({ scale, x: viewW / 2 - wx * scale, y: viewH / 2 - wy * scale });
    },
    [setView],
  );

  return { view, viewRef, setView, animateTo, onWheel, zoomBy };
}

/** Converts a world-space (grid unit) box to a stage view that fits it. */
export function scaleForBox(t: ViewTransform): ViewTransform {
  return { ...t, scale: clampScale(t.scale) };
}
