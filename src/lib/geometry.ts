import type { Point, Polygon } from "../types";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Signed area (shoelace). Positive for counter-clockwise in a y-up system. */
export function signedArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function area(poly: Polygon): number {
  return Math.abs(signedArea(poly));
}

/** Area-weighted centroid; falls back to the vertex average for degenerate polygons. */
export function centroid(poly: Polygon): Point {
  const a = signedArea(poly);
  if (poly.length === 0) return { x: 0, y: 0 };
  if (Math.abs(a) < 1e-9) {
    const sx = poly.reduce((s, p) => s + p.x, 0);
    const sy = poly.reduce((s, p) => s + p.y, 0);
    return { x: sx / poly.length, y: sy / poly.length };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/**
 * A good spot for a label: the centroid when it lies inside the polygon,
 * otherwise the middle of the widest horizontal span through the polygon.
 */
export function labelPoint(poly: Polygon): Point {
  const c = centroid(poly);
  if (pointInPolygon(c, poly)) return c;
  const b = bbox(poly);
  let best: Point = c;
  let bestWidth = -1;
  const steps = 24;
  for (let i = 1; i < steps; i++) {
    const y = b.y + (b.height * i) / steps;
    const xs: number[] = [];
    for (let j = 0; j < poly.length; j++) {
      const p = poly[j];
      const q = poly[(j + 1) % poly.length];
      if ((p.y > y) !== (q.y > y)) {
        xs.push(p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y));
      }
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const w = xs[k + 1] - xs[k];
      if (w > bestWidth) {
        bestWidth = w;
        best = { x: (xs[k] + xs[k + 1]) / 2, y };
      }
    }
  }
  return best;
}

export function bbox(poly: Polygon): Box {
  if (poly.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Even-odd ray casting. */
export function pointInPolygon(pt: Point, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Returns the polygon with a consistent (positive signed area) winding. */
export function normalizeWinding(poly: Polygon): Polygon {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

export function rectPolygon(a: Point, b: Point): Polygon {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

export function circlePolygon(center: Point, radius: number, segments?: number): Polygon {
  const n = segments ?? Math.max(16, Math.min(64, Math.round(radius * 8)));
  const pts: Polygon = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push({ x: round3(center.x + Math.cos(t) * radius), y: round3(center.y + Math.sin(t) * radius) });
  }
  return pts;
}

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

/** Ramer–Douglas–Peucker polyline simplification. */
export function simplify(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points;
  let maxDist = 0;
  let index = 0;
  const last = points.length - 1;
  for (let i = 1; i < last; i++) {
    const d = perpendicularDistance(points[i], points[0], points[last]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > epsilon) {
    const left = simplify(points.slice(0, index + 1), epsilon);
    const right = simplify(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[last]];
}

/** Turns a freehand stroke into a closed polygon, or null when too small. */
export function freeformToPolygon(stroke: Point[], epsilon = 0.15): Polygon | null {
  if (stroke.length < 3) return null;
  const closed = [...stroke, stroke[0]];
  const simplified = simplify(closed, epsilon).slice(0, -1);
  const poly = simplified.map((p) => ({ x: round3(p.x), y: round3(p.y) }));
  if (poly.length < 3 || area(poly) < 0.05) return null;
  return poly;
}

export function snapValue(v: number, step: number): number {
  if (step <= 0) return v;
  return Math.round(v / step) * step;
}

export function snapPoint(p: Point, step: number): Point {
  return { x: snapValue(p.x, step), y: snapValue(p.y, step) };
}

export function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function translate(poly: Polygon, dx: number, dy: number): Polygon {
  return poly.map((p) => ({ x: round3(p.x + dx), y: round3(p.y + dy) }));
}

export function isValidPolygon(poly: Polygon): boolean {
  return poly.length >= 3 && area(poly) > 1e-6;
}

export interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

/**
 * View centred on `box` (world px) that fits it with generous padding, but
 * never zooms in beyond `maxScale` (so small things like doors keep context).
 */
export function focusView(box: Box, viewW: number, viewH: number, maxScale: number): ViewTransform {
  const scale = Math.min(fitBox(box, viewW, viewH, 0.25).scale, maxScale);
  return {
    scale,
    x: viewW / 2 - (box.x + box.width / 2) * scale,
    y: viewH / 2 - (box.y + box.height / 2) * scale,
  };
}

/**
 * Bounding box of `box` after rotating the world by `rotation` degrees
 * clockwise about the origin (screen coordinates, y down): (x, y) -> (-y, x).
 */
export function rotateBox(box: Box, rotation: number): Box {
  if (rotation % 360 === 0) return box;
  if (rotation % 360 === 90) return { x: -(box.y + box.height), y: box.x, width: box.height, height: box.width };
  throw new Error(`unsupported rotation ${rotation}`);
}

/** Transform that fits `box` (world units) into a viewport of the given pixel size. */
export function fitBox(box: Box, viewW: number, viewH: number, padding = 0.08): ViewTransform {
  const w = Math.max(box.width, 1e-6);
  const h = Math.max(box.height, 1e-6);
  const availW = viewW * (1 - padding * 2);
  const availH = viewH * (1 - padding * 2);
  const scale = Math.min(availW / w, availH / h);
  return {
    scale,
    x: viewW / 2 - (box.x + w / 2) * scale,
    y: viewH / 2 - (box.y + h / 2) * scale,
  };
}

/** Flattened [x0, y0, x1, y1, ...] in pixel space for Konva Line. */
export function toFlat(poly: Polygon, cell: number): number[] {
  const out: number[] = [];
  for (const p of poly) out.push(p.x * cell, p.y * cell);
  return out;
}
