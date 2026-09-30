import { beforeEach, describe, expect, it, vi } from "vitest";
import { redo, undo, useDoc } from "./doc";
import { rectPolygon } from "../lib/geometry";

const box = (x: number) => rectPolygon({ x, y: 0 }, { x: x + 2, y: 2 });
const doc = () => useDoc.getState();
const level = () => doc().dungeon!.levels[0];

beforeEach(() => {
  vi.useRealTimers();
  doc().load({ name: "D", levels: [], playlists: [] });
  doc().addLevel({ name: "L1", width: 10, height: 10, scale: 5, description: "", dmImage: null, playerImage: null });
  useDoc.temporal.getState().clear();
});

describe("doc store", () => {
  it("numbers new rooms with the lowest free number", () => {
    const a = doc().addRoom(level().id, box(0));
    const b = doc().addRoom(level().id, box(3));
    const c = doc().addRoom(level().id, box(6));
    expect([a.number, b.number, c.number]).toEqual([1, 2, 3]);
    doc().deleteRoom(level().id, b.id);
    expect(doc().addRoom(level().id, box(9)).number).toBe(2);
  });

  it("refuses duplicate room numbers", () => {
    const a = doc().addRoom(level().id, box(0));
    const b = doc().addRoom(level().id, box(3));
    expect(doc().setRoomNumber(level().id, b.id, a.number)).toBe(false);
    expect(doc().setRoomNumber(level().id, b.id, 12)).toBe(true);
    expect(level().rooms.find((r) => r.id === b.id)!.number).toBe(12);
  });

  it("undoes and redoes structural changes", () => {
    const a = doc().addRoom(level().id, box(0));
    doc().setRoomKnown(level().id, a.id, true);
    expect(level().rooms[0].playerKnown).toBe(true);
    undo();
    expect(level().rooms[0].playerKnown).toBe(false);
    undo();
    expect(level().rooms).toHaveLength(0);
    redo();
    redo();
    expect(level().rooms[0].playerKnown).toBe(true);
  });

  it("coalesces rapid text edits into one undo step", () => {
    const a = doc().addRoom(level().id, box(0));
    for (const text of ["H", "He", "Hel", "Hell", "Hello"]) {
      doc().updateRoom(level().id, a.id, { readAloud: text }, `read-${a.id}`);
    }
    expect(level().rooms[0].readAloud).toBe("Hello");
    undo();
    expect(level().rooms[0].readAloud).toBe("");
    undo();
    expect(level().rooms).toHaveLength(0);
  });

  it("does not coalesce edits to different fields", () => {
    const a = doc().addRoom(level().id, box(0));
    doc().updateRoom(level().id, a.id, { readAloud: "x" }, `read-${a.id}`);
    doc().updateRoom(level().id, a.id, { dmNotes: "y" }, `dm-${a.id}`);
    undo();
    expect(level().rooms[0].readAloud).toBe("x");
    expect(level().rooms[0].dmNotes).toBe("");
  });

  it("starts a new undo step after a pause", () => {
    vi.useFakeTimers();
    const a = doc().addRoom(level().id, box(0));
    doc().updateRoom(level().id, a.id, { readAloud: "one" }, "k");
    vi.advanceTimersByTime(5000);
    doc().updateRoom(level().id, a.id, { readAloud: "one two" }, "k");
    undo();
    expect(level().rooms[0].readAloud).toBe("one");
  });

  it("manages doors, objects and polygons", () => {
    const d = doc().addShape("door", level().id, box(0));
    const o = doc().addShape("object", level().id, box(3));
    doc().updateShape("door", level().id, d, { description: "Locked" });
    doc().setPolygon("object", level().id, o, box(5));
    expect(level().doors[0].description).toBe("Locked");
    expect(level().objects[0].polygon).toEqual(box(5));
    doc().deleteShape("door", level().id, d);
    expect(level().doors).toHaveLength(0);
    undo();
    expect(level().doors).toHaveLength(1);
  });

  it("loading clears history", () => {
    doc().addRoom(level().id, box(0));
    doc().load({ name: "Other", levels: [], playlists: [] });
    expect(useDoc.temporal.getState().pastStates).toHaveLength(0);
    undo();
    expect(doc().dungeon!.name).toBe("Other");
  });
});

describe("session view commands", () => {
  it("focus, show whole level and rotation issue distinct camera commands", async () => {
    const { useSession } = await import("./session");
    const s = () => useSession.getState();
    s().setSession({ focus: null, playerLevelId: "L", blackout: false, rotation: 0, compass: false, combat: [], brightness: 1 });
    const n0 = s().viewNonce;
    s().focusRoom({ levelId: "L", roomId: "r1" });
    expect(s().viewCommand).toEqual({ kind: "room", levelId: "L", roomId: "r1" });
    s().toggleRotation();
    expect(s().rotation).toBe(90);
    expect(s().viewCommand).toEqual({ kind: "room", levelId: "L", roomId: "r1" }); // re-fit to the same room
    s().showWholeLevel("L");
    expect(s().focus).toBeNull();
    expect(s().viewCommand).toEqual({ kind: "level", levelId: "L" });
    s().toggleRotation();
    expect(s().rotation).toBe(0);
    expect(s().viewCommand).toEqual({ kind: "level", levelId: "L" });
    expect(s().viewNonce).toBe(n0 + 4);
  });

  it("room titles are undoable edits", () => {
    const a = doc().addRoom(level().id, box(0));
    expect(a.title).toBe("");
    doc().updateRoom(level().id, a.id, { title: "Crypt" }, `title-${a.id}`);
    expect(level().rooms[0].title).toBe("Crypt");
    undo();
    expect(level().rooms[0].title).toBe("");
  });
});
