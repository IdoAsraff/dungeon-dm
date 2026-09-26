/**
 * The dungeon document store. Every mutation of dungeon content goes through
 * here so it is recorded in the undo history (zundo) and picked up by the
 * autosaver.
 */
import { create } from "zustand";
import { temporal } from "zundo";
import { produce, type Draft } from "immer";
import type { BackgroundImage, Door, Dungeon, EntityKind, GlobalObject, Level, Polygon, Room } from "../types";
import { lowestFreeNumber, newId } from "../lib/ids";

export interface NewLevelInput {
  name: string;
  width: number;
  height: number;
  scale: number;
  description: string;
  dmImage: BackgroundImage | null;
  playerImage: BackgroundImage | null;
}

export type LevelPatch = Partial<Omit<Level, "id" | "rooms" | "doors" | "objects">>;
export type RoomPatch = Partial<Pick<Room, "polygon" | "readAloud" | "dmNotes">>;
export type ShapePatch = Partial<Pick<Door, "polygon" | "description">>;

export interface DocState {
  dungeon: Dungeon | null;
  /** Replace the whole document (loading / closing). Clears undo history. */
  load: (dungeon: Dungeon | null) => void;

  setBackground: (md: string) => void;
  renameDungeon: (name: string) => void;

  addLevel: (input: NewLevelInput) => string;
  updateLevel: (levelId: string, patch: LevelPatch, coalesceKey?: string) => void;
  deleteLevel: (levelId: string) => void;

  addRoom: (levelId: string, polygon: Polygon) => Room;
  updateRoom: (levelId: string, roomId: string, patch: RoomPatch, coalesceKey?: string) => void;
  /** Returns false when the number is invalid or taken by another room on the level. */
  setRoomNumber: (levelId: string, roomId: string, number: number) => boolean;
  setRoomKnown: (levelId: string, roomId: string, known: boolean) => void;
  deleteRoom: (levelId: string, roomId: string) => void;

  addShape: (kind: "door" | "object", levelId: string, polygon: Polygon) => string;
  updateShape: (kind: "door" | "object", levelId: string, id: string, patch: ShapePatch, coalesceKey?: string) => void;
  deleteShape: (kind: "door" | "object", levelId: string, id: string) => void;

  setPolygon: (kind: EntityKind, levelId: string, id: string, polygon: Polygon) => void;
}

// ---- undo coalescing -------------------------------------------------------
// Text edits fire on every keystroke. Consecutive edits to the same field
// within a short window are merged into one undo step.
const COALESCE_MS = 1500;
let pendingKey: string | null = null;
let lastKey: string | null = null;
let lastTime = 0;

export function resetCoalescing() {
  lastKey = null;
  lastTime = 0;
}

function findLevel(d: Draft<Dungeon>, levelId: string): Draft<Level> {
  const level = d.levels.find((l) => l.id === levelId);
  if (!level) throw new Error(`Unknown level ${levelId}`);
  return level;
}

function listFor(level: Draft<Level>, kind: "door" | "object"): Draft<Door[] | GlobalObject[]> {
  return kind === "door" ? level.doors : level.objects;
}

export const useDoc = create<DocState>()(
  temporal(
    (set, get) => {
      const mutate = (fn: (d: Draft<Dungeon>) => void, coalesceKey?: string) => {
        const current = get().dungeon;
        if (!current) return;
        pendingKey = coalesceKey ?? null;
        try {
          set({ dungeon: produce(current, fn) });
        } finally {
          pendingKey = null;
        }
      };

      return {
        dungeon: null,

        load: (dungeon) => {
          useDoc.temporal.getState().pause();
          set({ dungeon });
          useDoc.temporal.getState().resume();
          useDoc.temporal.getState().clear();
          resetCoalescing();
        },

        setBackground: (md) => mutate((d) => void (d.background = md), "background"),
        renameDungeon: (name) => mutate((d) => void (d.name = name)),

        addLevel: (input) => {
          const id = newId("level");
          mutate((d) => {
            d.levels.push({ id, ...input, rooms: [], doors: [], objects: [] });
          });
          return id;
        },
        updateLevel: (levelId, patch, coalesceKey) =>
          mutate((d) => {
            Object.assign(findLevel(d, levelId), patch);
          }, coalesceKey),
        deleteLevel: (levelId) =>
          mutate((d) => {
            d.levels = d.levels.filter((l) => l.id !== levelId);
          }),

        addRoom: (levelId, polygon) => {
          const level = get().dungeon?.levels.find((l) => l.id === levelId);
          const room: Room = {
            id: newId("room"),
            number: lowestFreeNumber(level?.rooms.map((r) => r.number) ?? []),
            polygon,
            readAloud: "",
            dmNotes: "",
            playerKnown: false,
          };
          mutate((d) => void findLevel(d, levelId).rooms.push(room));
          return room;
        },
        updateRoom: (levelId, roomId, patch, coalesceKey) =>
          mutate((d) => {
            const room = findLevel(d, levelId).rooms.find((r) => r.id === roomId);
            if (room) Object.assign(room, patch);
          }, coalesceKey),
        setRoomNumber: (levelId, roomId, number) => {
          const level = get().dungeon?.levels.find((l) => l.id === levelId);
          if (!level || !Number.isInteger(number) || number < 0) return false;
          if (level.rooms.some((r) => r.id !== roomId && r.number === number)) return false;
          mutate((d) => {
            const room = findLevel(d, levelId).rooms.find((r) => r.id === roomId);
            if (room) room.number = number;
          });
          return true;
        },
        setRoomKnown: (levelId, roomId, known) =>
          mutate((d) => {
            const room = findLevel(d, levelId).rooms.find((r) => r.id === roomId);
            if (room) room.playerKnown = known;
          }),
        deleteRoom: (levelId, roomId) =>
          mutate((d) => {
            const level = findLevel(d, levelId);
            level.rooms = level.rooms.filter((r) => r.id !== roomId);
          }),

        addShape: (kind, levelId, polygon) => {
          const id = newId(kind);
          mutate((d) => void listFor(findLevel(d, levelId), kind).push({ id, polygon, description: "" }));
          return id;
        },
        updateShape: (kind, levelId, id, patch, coalesceKey) =>
          mutate((d) => {
            const item = listFor(findLevel(d, levelId), kind).find((o) => o.id === id);
            if (item) Object.assign(item, patch);
          }, coalesceKey),
        deleteShape: (kind, levelId, id) =>
          mutate((d) => {
            const level = findLevel(d, levelId);
            if (kind === "door") level.doors = level.doors.filter((o) => o.id !== id);
            else level.objects = level.objects.filter((o) => o.id !== id);
          }),

        setPolygon: (kind, levelId, id, polygon) =>
          mutate((d) => {
            const level = findLevel(d, levelId);
            const list: { id: string; polygon: Polygon }[] =
              kind === "room" ? level.rooms : kind === "door" ? level.doors : level.objects;
            const item = list.find((o) => o.id === id);
            if (item) item.polygon = polygon;
          }),
      };
    },
    {
      partialize: (s) => ({ dungeon: s.dungeon }),
      equality: (a, b) => a.dungeon === b.dungeon,
      limit: 300,
      handleSet: (inner) => (pastState, replace, currentState, deltaState) => {
        const now = Date.now();
        const key = pendingKey;
        if (key !== null && key === lastKey && now - lastTime < COALESCE_MS) {
          lastTime = now;
          return;
        }
        lastKey = key;
        lastTime = now;
        // zundo types `inner` as setState, but at runtime it is its internal
        // 4-argument _handleSet (see zundo/dist/index.js).
        (inner as unknown as (...args: unknown[]) => void)(pastState, replace, currentState, deltaState);
      },
    },
  ),
);

export function undo() {
  resetCoalescing();
  useDoc.temporal.getState().undo();
}

export function redo() {
  resetCoalescing();
  useDoc.temporal.getState().redo();
}

export function getLevel(levelId: string | null): Level | undefined {
  if (!levelId) return undefined;
  return useDoc.getState().dungeon?.levels.find((l) => l.id === levelId);
}
