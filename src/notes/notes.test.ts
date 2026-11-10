import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import type { Dungeon, Level } from "../types";
import { findMatches, globalSearch, normalizeForSearch } from "./search";
import { composeLevelDoc, fieldTexts, layoutField, levelDocExtensions, setLayout } from "./levelDoc";
import { buildIndex, levelDocNames, levelHeadingTarget, relabelLinks } from "./links";
import { minimalChange } from "./editors";

const level: Level = {
  id: "L1",
  name: "Grove Level",
  width: 10,
  height: 10,
  scale: 5,
  description: "Damp caves.",
  dmImage: null,
  playerImage: null,
  rooms: [
    { id: "b", label: "43", title: "", polygon: [], readAloud: "Blood smell.", dmNotes: "#### Creature\nBalsag the **bugbear**.", playerKnown: true },
    { id: "a", label: "42", title: "הגן המרכזי", polygon: [], readAloud: "", dmNotes: "Twig blights.", playerKnown: false },
  ],
  doors: [{ id: "d1", polygon: [], description: "Stuck stone door (DC 15)." }],
  objects: [],
};
const dungeon: Dungeon = { name: "Test", levels: [level], playlists: [] };

describe("search", () => {
  it("ignores case, accents and niqqud but reports original offsets", () => {
    expect(normalizeForSearch("Café").norm).toBe("cafe");
    const text = "שָׁלוֹם world, SHALOM";
    const hits = findMatches(text, "שלום");
    expect(hits).toHaveLength(1);
    expect(text.slice(hits[0].from, hits[0].to)).toBe("שָׁלוֹם");
    expect(findMatches(text, "shalom")[0].match).toBe("SHALOM");
  });

  it("searches notes, level texts and doors", () => {
    const res = globalSearch("bugbear", { "NPCs/Balsag.md": "A **bugbear** hunter." }, dungeon);
    expect(res.map((r) => r.target.kind).sort()).toEqual(["level-field", "note"]);
    const room = res.find((r) => r.target.kind === "level-field")!;
    expect(room.target).toEqual({ kind: "level-field", levelId: "L1", field: "dm:b" });
    expect(room.title).toContain("43 · Room 43");
    expect(globalSearch("stone door", {}, dungeon)[0].target.kind).toBe("map");
    expect(globalSearch("balsag", { "NPCs/Balsag.md": "x" }, dungeon)[0].titleMatch).toBe(true);
  });
});

describe("level documents", () => {
  const layout = composeLevelDoc(level, "Grove Level");

  it("lists the background and rooms in number order", () => {
    expect(layout.text.split("\n").filter(Boolean)).toEqual([
      "Grove Level",
      "Background",
      "Damp caves.",
      "Rooms",
      "42 · הגן המרכזי",
      "Read-aloud",
      "DM notes",
      "Twig blights.",
      "43 · Room 43",
      "Read-aloud",
      "Blood smell.",
      "DM notes",
      "#### Creature",
      "Balsag the **bugbear**.",
    ]);
    const f = layout.fields.find((x) => x.key === "dm:b")!;
    expect(layout.text.slice(f.from, f.to)).toBe(level.rooms[0].dmNotes);
  });

  function editorState() {
    let s = EditorState.create({ doc: layout.text, extensions: levelDocExtensions({ onShowRoom: () => {}, onBlockedEdit: () => {} }) });
    s = s.update({ effects: setLayout.of(layout) }).state;
    return s;
  }

  it("allows editing inside a section and tracks the new text", () => {
    let s = editorState();
    const f = s.field(layoutField).fields.find((x) => x.key === "read:a")!; // empty section
    s = s.update({ changes: { from: f.from, insert: "Glowing fungus." } }).state;
    expect(fieldTexts(s).get("read:a")).toBe("Glowing fungus.");
    expect(fieldTexts(s).get("dm:a")).toBe("Twig blights.");
  });

  it("blocks edits to the fixed structure", () => {
    const s = editorState();
    const locked = s.field(layoutField).locked.find((l) => l.kind === "room")!;
    const tr = s.update({ changes: { from: locked.from, to: locked.from + 2, insert: "" } });
    expect(tr.state.doc.toString()).toBe(layout.text);
    // Deleting across two sections is blocked too.
    const a = s.field(layoutField).fields.find((x) => x.key === "desc")!;
    const b = s.field(layoutField).fields.find((x) => x.key === "dm:a")!;
    expect(s.update({ changes: { from: a.from, to: b.to, insert: "" } }).state.doc.toString()).toBe(layout.text);
  });

  it("resolves headings to rooms and names documents uniquely", () => {
    expect(levelHeadingTarget(level, "42")).toEqual({ kind: "room", roomId: "a" });
    expect(levelHeadingTarget(level, "הגן המרכזי")).toEqual({ kind: "room", roomId: "a" });
    expect(levelHeadingTarget(level, "Background")).toEqual({ kind: "section", name: "background" });
    const two: Dungeon = { name: "x", levels: [level, { ...level, id: "L2" }], playlists: [] };
    expect([...levelDocNames(two).values()]).toEqual(["Grove Level", "Grove Level (2)"]);
    const idx = buildIndex(["Grove Level.md"], two);
    expect(idx.resolve("levels/Grove Level (2)")?.id).toBe("level:L2");
    expect(idx.resolve("Grove Level")?.id).toBe("note:Grove Level.md"); // shortest path wins
  });

  it("resolves complex room labels, with or without the title", () => {
    const l: Level = { ...level, rooms: [...level.rooms, { ...level.rooms[0], id: "c", label: "2-17C", title: "Throne" }, { ...level.rooms[0], id: "d", label: "2-17", title: "" }] };
    expect(levelHeadingTarget(l, "2-17C")).toEqual({ kind: "room", roomId: "c" });
    expect(levelHeadingTarget(l, "2-17c · Throne")).toEqual({ kind: "room", roomId: "c" });
    expect(levelHeadingTarget(l, "2-17 · Room 2-17")).toEqual({ kind: "room", roomId: "d" });
    expect(levelHeadingTarget(l, "2-1")).toBeNull();
  });

  it("rewrites links to a relabeled room", () => {
    const isLevel = (t: string) => t === "Grove Level";
    const text = "See [[Grove Level#42|the garden]], [[Grove Level#42|42]], [[Grove Level#42 · הגן המרכזי]], [[Grove Level#הגן המרכזי]], [[Grove Level#43]] and [[Other#42]].";
    expect(relabelLinks(text, isLevel, level, "a", "42", "2-17C")).toBe(
      "See [[Grove Level#2-17C|the garden]], [[Grove Level#2-17C|2-17C]], [[Grove Level#2-17C · הגן המרכזי]], [[Grove Level#הגן המרכזי]], [[Grove Level#43]] and [[Other#42]].",
    );
  });
});

describe("minimalChange", () => {
  it("replaces only the differing middle", () => {
    expect(minimalChange("abcdef", "abXdef")).toEqual({ from: 2, to: 3, insert: "X" });
    expect(minimalChange("same", "same")).toBeNull();
    expect(minimalChange("", "new")).toEqual({ from: 0, to: 0, insert: "new" });
  });
});
