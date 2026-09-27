import { describe, expect, it } from "vitest";
import {
  area,
  bbox,
  centroid,
  circlePolygon,
  fitBox,
  freeformToPolygon,
  isValidPolygon,
  labelPoint,
  normalizeWinding,
  pointInPolygon,
  rectPolygon,
  signedArea,
  simplify,
  snapPoint,
  translate,
} from "./geometry";

const square = rectPolygon({ x: 0, y: 0 }, { x: 4, y: 2 });

describe("geometry", () => {
  it("builds rectangles from any two corners", () => {
    expect(rectPolygon({ x: 4, y: 2 }, { x: 0, y: 0 })).toEqual(square);
    expect(area(square)).toBe(8);
    expect(bbox(square)).toEqual({ x: 0, y: 0, width: 4, height: 2 });
  });

  it("computes centroids", () => {
    expect(centroid(square)).toEqual({ x: 2, y: 1 });
  });

  it("finds a label point inside concave shapes", () => {
    // U shape: centroid lies in the empty middle.
    const u = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 4 },
      { x: 3, y: 4 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 5 },
      { x: 0, y: 5 },
    ];
    expect(pointInPolygon(centroid(u), u)).toBe(false);
    expect(pointInPolygon(labelPoint(u), u)).toBe(true);
  });

  it("tests point containment", () => {
    expect(pointInPolygon({ x: 1, y: 1 }, square)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 1 }, square)).toBe(false);
  });

  it("normalizes winding", () => {
    const reversed = [...square].reverse();
    expect(Math.sign(signedArea(normalizeWinding(reversed)))).toBe(Math.sign(signedArea(normalizeWinding(square))));
    expect(signedArea(normalizeWinding(reversed))).toBeGreaterThan(0);
  });

  it("approximates circles", () => {
    const c = circlePolygon({ x: 5, y: 5 }, 2, 64);
    expect(c).toHaveLength(64);
    expect(area(c)).toBeCloseTo(Math.PI * 4, 0);
  });

  it("simplifies strokes and converts freeform drawings", () => {
    const line = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0 }));
    expect(simplify(line, 0.1)).toEqual([line[0], line[19]]);
    const stroke = [
      ...Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0 })),
      ...Array.from({ length: 10 }, (_, i) => ({ x: 10, y: i })),
      ...Array.from({ length: 10 }, (_, i) => ({ x: 10 - i, y: 10 })),
    ];
    const poly = freeformToPolygon(stroke)!;
    expect(poly.length).toBeGreaterThanOrEqual(3);
    expect(poly.length).toBeLessThan(8);
    expect(freeformToPolygon([{ x: 0, y: 0 }, { x: 0.01, y: 0 }])).toBeNull();
  });

  it("snaps and translates", () => {
    expect(snapPoint({ x: 1.26, y: 2.74 }, 0.5)).toEqual({ x: 1.5, y: 2.5 });
    expect(snapPoint({ x: 1.26, y: 2.74 }, 0)).toEqual({ x: 1.26, y: 2.74 });
    expect(translate(square, 1, 1)[0]).toEqual({ x: 1, y: 1 });
  });

  it("validates polygons", () => {
    expect(isValidPolygon(square)).toBe(true);
    expect(isValidPolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
    expect(isValidPolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }])).toBe(false);
  });

  it("fits a box into a viewport", () => {
    const t = fitBox({ x: 0, y: 0, width: 100, height: 50 }, 200, 200, 0);
    expect(t.scale).toBe(2);
    expect(t.x).toBe(0);
    expect(t.y).toBe(50);
  });
});

describe("rotation", () => {
  it("rotates boxes 90° clockwise", async () => {
    const { rotateBox } = await import("./geometry");
    const b = { x: 2, y: 3, width: 10, height: 4 };
    expect(rotateBox(b, 0)).toEqual(b);
    // Corners (2,3) and (12,7) map to (-3,2) and (-7,12).
    expect(rotateBox(b, 90)).toEqual({ x: -7, y: 2, width: 4, height: 10 });
  });
});

describe("focusView (zoom to an item from the sidebar)", () => {
  it("keeps small, far-away items centred when the zoom is capped", async () => {
    const { focusView } = await import("./geometry");
    // A door-sized box far from the origin: fitting it alone would zoom in hugely.
    const box = { x: 3000, y: 2200, width: 64, height: 26 };
    const t = focusView(box, 1000, 800, 1.2);
    expect(t.scale).toBe(1.2);
    // The box centre must land in the middle of the viewport.
    expect((box.x + box.width / 2) * t.scale + t.x).toBeCloseTo(500);
    expect((box.y + box.height / 2) * t.scale + t.y).toBeCloseTo(400);
  });

  it("zooms out further for items bigger than the viewport", async () => {
    const { focusView } = await import("./geometry");
    const t = focusView({ x: 0, y: 0, width: 4000, height: 4000 }, 1000, 800, 1.2);
    expect(t.scale).toBeLessThan(0.2);
  });
});
