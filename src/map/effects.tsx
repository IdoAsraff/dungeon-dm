/**
 * Visual effects shared by the DM map, the player window and the DM's
 * preview of it: pings, rooms fading in when revealed, and crossfading
 * handouts.
 */
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Circle, Group, Line } from "react-konva";
import type { Polygon } from "../types";
import { toFlat } from "../lib/geometry";
import { CELL } from "./constants";

// ---- animation clock -------------------------------------------------------------

/** Current time, re-rendering every frame while `active` is true. */
export function useAnimationNow(active: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    let frame = requestAnimationFrame(function tick(t) {
      setNow(t);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);
  return active ? now : performance.now();
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

// ---- pings ------------------------------------------------------------------------

export const PING_MS = 2000;
const PING_COLOR = "#b48cff";

export interface Ping {
  id: string;
  levelId: string;
  /** Position in grid squares. */
  x: number;
  y: number;
  /** performance.now() in the window that shows it. */
  at: number;
}

interface PingState {
  pings: Ping[];
  add: (p: Omit<Ping, "at">) => void;
}

/** Pings currently animating in this window (each window has its own copy). */
export const usePings = create<PingState>()((set) => ({
  pings: [],
  add: (p) => {
    const ping = { ...p, at: performance.now() };
    set((s) => ({ pings: [...s.pings.filter((x) => performance.now() - x.at < PING_MS), ping] }));
    setTimeout(() => set((s) => ({ pings: s.pings.filter((x) => x.id !== ping.id) })), PING_MS + 100);
  },
}));

/**
 * Expanding rings at each ping of `levelId`. Sizes are in screen pixels so
 * the ping looks the same at any zoom (`viewScale` is the stage scale).
 */
export function PingRings({ levelId, viewScale }: { levelId: string; viewScale: number }) {
  const pings = usePings((s) => s.pings).filter((p) => p.levelId === levelId);
  const now = useAnimationNow(pings.length > 0);
  const px = 1 / Math.max(viewScale, 0.01);
  return (
    <Group listening={false}>
      {pings.map((p) => {
        const t = (now - p.at) / PING_MS;
        if (t < 0 || t > 1) return null;
        const cx = p.x * CELL;
        const cy = p.y * CELL;
        return (
          <Group key={p.id}>
            {[0, 0.35].map((delay) => {
              const k = (t - delay) / (1 - 0.35);
              if (k <= 0 || k >= 1) return null;
              return (
                <Circle
                  key={delay}
                  x={cx}
                  y={cy}
                  radius={(6 + 38 * easeOut(k)) * px}
                  stroke={PING_COLOR}
                  strokeWidth={2 * px}
                  opacity={0.75 * (1 - k)}
                  shadowColor={PING_COLOR}
                  shadowBlur={4 * px}
                />
              );
            })}
            <Circle x={cx} y={cy} radius={4 * px} fill={PING_COLOR} opacity={0.85 * Math.min(1, (1 - t) * 2.5)} />
          </Group>
        );
      })}
    </Group>
  );
}

// ---- rooms fading in on reveal -----------------------------------------------------

export const REVEAL_MS = 1400;

/**
 * Tracks rooms that became known while this view was showing the level and
 * returns when each started fading in. Rooms already known when the level is
 * first shown do not fade.
 */
export function useRevealFades(levelId: string | null, roomIds: string[]): Map<string, number> {
  const seen = useRef<{ levelId: string | null; ids: Set<string> }>({ levelId: null, ids: new Set() });
  const fades = useRef(new Map<string, number>());
  if (seen.current.levelId !== levelId) {
    seen.current = { levelId, ids: new Set(roomIds) };
    fades.current = new Map();
  } else {
    for (const id of roomIds) {
      if (!seen.current.ids.has(id)) {
        seen.current.ids.add(id);
        fades.current.set(id, performance.now());
      }
    }
    // Concealed rooms may fade in again if they are revealed later.
    for (const id of [...seen.current.ids]) if (!roomIds.includes(id)) seen.current.ids.delete(id);
  }
  const now = performance.now();
  for (const [id, at] of fades.current) if (now - at > REVEAL_MS) fades.current.delete(id);
  return fades.current;
}

/** Black veils over newly revealed rooms that dissolve away. */
export function RevealVeils({ rooms, fades }: { rooms: { id: string; polygon: Polygon }[]; fades: Map<string, number> }) {
  const now = useAnimationNow(fades.size > 0);
  return (
    <Group listening={false}>
      {rooms.map((r) => {
        const at = fades.get(r.id);
        if (at === undefined) return null;
        const t = Math.min(1, (now - at) / REVEAL_MS);
        if (t >= 1) return null;
        return <Line key={r.id} points={toFlat(r.polygon, CELL)} closed fill="#000" opacity={1 - easeOut(t)} />;
      })}
    </Group>
  );
}

// ---- handouts ----------------------------------------------------------------------

const HANDOUT_MS = 600;

/** Full-screen handout image that fades in, fades out, and crossfades when it changes. */
export function HandoutLayer({ url }: { url: string | null }) {
  const [layers, setLayers] = useState<{ url: string; key: number; leaving: boolean }[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    setLayers((ls) => {
      const current = ls.find((l) => !l.leaving);
      if (current?.url === url) return ls;
      const next = ls.map((l) => ({ ...l, leaving: true }));
      if (url) next.push({ url, key: ++seq.current, leaving: false });
      return next;
    });
    const t = setTimeout(() => setLayers((ls) => ls.filter((l) => !l.leaving)), HANDOUT_MS + 50);
    return () => clearTimeout(t);
  }, [url]);
  return (
    <>
      {layers.map((l) => (
        <div key={l.key} className={`player-handout ${l.leaving ? "leaving" : "entering"}`} style={{ animationDuration: `${HANDOUT_MS}ms` }}>
          <img src={l.url} alt="" />
        </div>
      ))}
    </>
  );
}
