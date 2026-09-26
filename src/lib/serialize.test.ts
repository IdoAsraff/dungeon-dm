import { describe, expect, it } from "vitest";
import type { Dungeon, Session } from "../types";
import { diffFiles, parseDungeon, prettyJson, serializeDungeon, DungeonFormatError } from "./serialize";
import { normalizePath, toFileRelative, toRootRelative } from "./markdownPaths";
import { buildPlayerData } from "./playerData";
import { lowestFreeNumber } from "./ids";

const dungeon: Dungeon = {
  name: "Test Crypt",
  background: "# Lore\n\n![map](assets/overview.png) and [stats](https://example.com/goblin)",
  levels: [
    {
      id: "level-1",
      name: "Upper Crypt",
      width: 20,
      height: 10,
      scale: 5,
      description: "Damp.",
      dmImage: { path: "assets/l1.png", rect: { x: 0, y: 0, width: 20, height: 10 } },
      playerImage: null,
      rooms: [
        {
          id: "r-a",
          number: 1,
          polygon: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 4 },
            { x: 0, y: 4 },
          ],
          readAloud: "A cold room. ![door](assets/door.png)",
          dmNotes: "",
          playerKnown: true,
        },
        {
          id: "r-b",
          number: 2,
          polygon: [
            { x: 6, y: 0 },
            { x: 9.5, y: 0 },
            { x: 9.5, y: 3 },
          ],
          readAloud: "",
          dmNotes: "Secret: a *ghoul*.",
          playerKnown: false,
        },
      ],
      doors: [{ id: "d-1", polygon: [{ x: 4, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 2 }, { x: 4, y: 2 }], description: "Locked." }],
      objects: [{ id: "o-1", polygon: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }], description: "" }],
    },
  ],
};
const session: Session = { focus: { levelId: "level-1", roomId: "r-a" }, playerLevelId: "level-1" };

describe("markdown path rewriting", () => {
  it("normalizes paths", () => {
    expect(normalizePath("levels/a/../../assets/x.png")).toBe("assets/x.png");
    expect(normalizePath("../x")).toBeNull();
  });

  it("round-trips relative image paths and leaves URLs alone", () => {
    const md = "![a](assets/x.png) [web](https://x.y/z) [anchor](#top) ![b](<assets/with space.png>)";
    const onDisk = toFileRelative(md, "levels/l1/rooms/1.dm.md");
    expect(onDisk).toContain("](../../../assets/x.png)");
    expect(onDisk).toContain("(https://x.y/z)");
    expect(onDisk).toContain("(#top)");
    expect(onDisk).toContain("(<../../../assets/with space.png>)");
    expect(toRootRelative(onDisk, "levels/l1/rooms/1.dm.md")).toBe(md);
    expect(toFileRelative(md, "background.md")).toBe(md);
  });
});

describe("dungeon serialization", () => {
  it("lays files out as documented", () => {
    const files = serializeDungeon(dungeon, session);
    expect(Object.keys(files).sort()).toEqual(
      [
        "background.md",
        "dungeon.json",
        "levels/level-1/description.md",
        "levels/level-1/doors/d-1.md",
        "levels/level-1/level.json",
        "levels/level-1/rooms/1.read-aloud.md",
        "levels/level-1/rooms/2.dm.md",
      ].sort(),
    );
    expect(files["levels/level-1/rooms/1.read-aloud.md"]).toBe("A cold room. ![door](../../../assets/door.png)\n");
    expect(files["levels/level-1/level.json"]).toContain("[[0, 0], [4, 0], [4, 4], [0, 4]]");
  });

  it("round-trips through parse", () => {
    const files = serializeDungeon(dungeon, session);
    const parsed = parseDungeon(files);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.dungeon).toEqual(dungeon);
    expect(parsed.session).toEqual(session);
    expect(serializeDungeon(parsed.dungeon, parsed.session)).toEqual(files);
  });

  it("drops a focus that points at an unknown room", () => {
    const files = serializeDungeon(dungeon, { focus: { levelId: "level-1", roomId: "r-b" }, playerLevelId: null });
    expect(parseDungeon(files).session.focus).toBeNull();
  });

  it("reports missing level files and rejects non-dungeons", () => {
    const files = serializeDungeon(dungeon, session);
    delete files["levels/level-1/level.json"];
    const parsed = parseDungeon(files);
    expect(parsed.dungeon.levels).toHaveLength(0);
    expect(parsed.warnings[0]).toMatch(/missing/);
    expect(() => parseDungeon({})).toThrow(DungeonFormatError);
  });

  it("renumbering a room renames its files", () => {
    const before = serializeDungeon(dungeon, session);
    const renumbered: Dungeon = {
      ...dungeon,
      levels: [{ ...dungeon.levels[0], rooms: dungeon.levels[0].rooms.map((r) => (r.id === "r-b" ? { ...r, number: 7 } : r)) }],
    };
    const { writes, deletes } = diffFiles(before, serializeDungeon(renumbered, session));
    expect(deletes).toEqual(["levels/level-1/rooms/2.dm.md"]);
    expect(Object.keys(writes).sort()).toEqual(["levels/level-1/level.json", "levels/level-1/rooms/7.dm.md"]);
  });

  it("pretty-prints JSON with compact points", () => {
    expect(prettyJson({ p: [[1, 2], [3.5, -4]] })).toBe('{\n  "p": [[1, 2], [3.5, -4]]\n}\n');
  });
});

describe("player data", () => {
  it("includes only known rooms, without secrets", () => {
    const data = buildPlayerData(dungeon, { ...session, focusNonce: 3 }, (p) => `url:${p}`);
    expect(data.levels).toHaveLength(1);
    expect(data.levels[0].rooms.map((r) => r.id)).toEqual(["r-a"]);
    expect(JSON.stringify(data)).not.toContain("ghoul");
    expect(JSON.stringify(data)).not.toContain("Locked");
    expect(JSON.stringify(data)).not.toContain("l1.png"); // DM image never sent
    expect(data.focus).toEqual(session.focus);
    expect(data.focusNonce).toBe(3);
  });

  it("omits levels without known rooms", () => {
    const hidden: Dungeon = {
      ...dungeon,
      levels: [{ ...dungeon.levels[0], rooms: dungeon.levels[0].rooms.map((r) => ({ ...r, playerKnown: false })) }],
    };
    const data = buildPlayerData(hidden, { ...session, focusNonce: 0 }, (p) => p);
    expect(data.levels).toEqual([]);
    expect(data.focus).toBeNull();
  });
});

describe("ids", () => {
  it("finds the lowest free room number", () => {
    expect(lowestFreeNumber([])).toBe(1);
    expect(lowestFreeNumber([1, 2, 4])).toBe(3);
    expect(lowestFreeNumber([2, 3])).toBe(1);
  });
});
