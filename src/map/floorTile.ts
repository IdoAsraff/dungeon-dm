/**
 * Procedurally drawn grey-blue flagstone floor, used when a level has no
 * background image. One pattern tile covers TILES x TILES grid squares with
 * per-stone variation, so the repetition is hard to spot.
 */
import { CELL } from "./constants";

const TILES = 8;
let cached: HTMLCanvasElement | null = null;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function floorPattern(): HTMLCanvasElement {
  if (cached) return cached;
  const size = TILES * CELL;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = rng(1337);

  // Grout.
  ctx.fillStyle = "#20252d";
  ctx.fillRect(0, 0, size, size);

  const gap = 2;
  for (let ty = 0; ty < TILES; ty++) {
    for (let tx = 0; tx < TILES; tx++) {
      const x = tx * CELL + gap;
      const y = ty * CELL + gap;
      const w = CELL - gap * 2;
      const light = 36 + rand() * 10; // lightness %
      const hue = 208 + rand() * 14;
      const sat = 10 + rand() * 8;
      const grad = ctx.createLinearGradient(x, y, x + w, y + w);
      grad.addColorStop(0, `hsl(${hue} ${sat}% ${light + 4}%)`);
      grad.addColorStop(1, `hsl(${hue} ${sat}% ${light - 4}%)`);
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, w);

      // Bevel: light top/left edge, dark bottom/right edge.
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(x, y, w, 2);
      ctx.fillRect(x, y, 2, w);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(x, y + w - 2, w, 2);
      ctx.fillRect(x + w - 2, y, 2, w);

      // Speckles and the occasional crack.
      for (let i = 0; i < 40; i++) {
        const a = rand() * 0.12;
        ctx.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.7})`;
        const r = 0.6 + rand() * 1.6;
        ctx.fillRect(x + 3 + rand() * (w - 6), y + 3 + rand() * (w - 6), r, r);
      }
      if (rand() < 0.22) {
        ctx.strokeStyle = "rgba(10,12,16,0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        let cx = x + 6 + rand() * (w - 12);
        let cy = y + 6 + rand() * (w - 12);
        ctx.moveTo(cx, cy);
        for (let k = 0; k < 4; k++) {
          cx = Math.min(x + w - 3, Math.max(x + 3, cx + (rand() - 0.5) * 18));
          cy = Math.min(y + w - 3, Math.max(y + 3, cy + (rand() - 0.5) * 18));
          ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
    }
  }
  cached = canvas;
  return canvas;
}
