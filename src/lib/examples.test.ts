import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseDungeon, type FileMap } from "./serialize";

const EXAMPLES = path.resolve(__dirname, "../../examples");

/**
 * The committed version of the example (the DM play-tests the sample in the
 * app, which leaves uncommitted changes); the files on disk without git.
 */
function readCommitted(root: string): FileMap | null {
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const files: FileMap = {};
    for (const f of git("ls-files", "--full-name", ".").trim().split("\n")) {
      const rel = path.relative(path.relative(git("rev-parse", "--show-toplevel").trim(), root), f).split(path.sep).join("/");
      if (/\.(json|md)$/.test(rel) && !rel.startsWith("notes/")) files[rel] = git("show", `HEAD:${f}`);
    }
    return files;
  } catch {
    return null;
  }
}

function readDungeonDir(root: string): FileMap {
  const committed = readCommitted(root);
  if (committed) return committed;
  const files: FileMap = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "notes") walk(full);
      }
      else if (/\.(json|md)$/.test(entry.name)) files[path.relative(root, full).split(path.sep).join("/")] = fs.readFileSync(full, "utf8");
    }
  };
  walk(root);
  return files;
}

describe("example dungeons", () => {
  it("sample-dungeon: 1 level, 2 rooms + 1 corridor, 2 doors", () => {
    const { dungeon, session, warnings } = parseDungeon(readDungeonDir(path.join(EXAMPLES, "sample-dungeon")));
    expect(warnings).toEqual([]);
    expect(dungeon.levels).toHaveLength(1);
    const [level] = dungeon.levels;
    expect(level.rooms.map((r) => r.number)).toEqual([1, 2, 3]);
    expect(level.doors).toHaveLength(2);
    expect(level.rooms.every((r) => r.readAloud.length > 0)).toBe(true);
    expect(level.doors.every((d) => d.description.length > 0)).toBe(true);
    expect(session.focus).toEqual({ levelId: "level-1", roomId: "entry-hall" });
    // Notes replaced the single background document.
    expect(fs.existsSync(path.join(EXAMPLES, "sample-dungeon/background.md"))).toBe(false);
    expect(fs.readFileSync(path.join(EXAMPLES, "sample-dungeon/notes/Background.md"), "utf8")).toContain("kuo-toa");
  });
});
