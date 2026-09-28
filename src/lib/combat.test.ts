import { describe, expect, it } from "vitest";
import { applyHpInput, parseStartingHp } from "./combat";
import { useSession } from "../store/session";
import { DEFAULT_SESSION } from "../types";
import { parseDungeon, serializeDungeon } from "./serialize";

describe("combat HP input", () => {
  it("subtracts, adds or sets", () => {
    expect(applyHpInput(20, "-7")).toBe(13);
    expect(applyHpInput(20, "+5")).toBe(25);
    expect(applyHpInput(20, " - 25 ")).toBe(-5); // below zero is fine
    expect(applyHpInput(20, "12")).toBe(12);
    expect(applyHpInput(20, "=-3")).toBe(-3);
    expect(applyHpInput(20, "−4")).toBe(16); // typographic minus
    expect(applyHpInput(20, "")).toBeNull();
    expect(applyHpInput(20, "abc")).toBeNull();
  });

  it("parses starting HP", () => {
    expect(parseStartingHp("7")).toBe(7);
    expect(parseStartingHp("")).toBe(0);
    expect(parseStartingHp("x")).toBeNull();
  });
});

describe("combat list", () => {
  const s = () => useSession.getState();
  it("adds enemies, toggles sides, reorders, and clears only enemies", () => {
    s().setSession({ ...DEFAULT_SESSION });
    s().addCombatant(" Goblin ", 7);
    s().addCombatant("Rogue", 22);
    s().addCombatant("Bugbear", 27);
    expect(s().combat.map((c) => [c.name, c.hp, c.side])).toEqual([
      ["Goblin", 7, "enemy"],
      ["Rogue", 22, "enemy"],
      ["Bugbear", 27, "enemy"],
    ]);
    const rogue = s().combat[1].id;
    s().updateCombatant(rogue, { side: "party" });
    s().moveCombatant(rogue, 0);
    expect(s().combat.map((c) => c.name)).toEqual(["Rogue", "Goblin", "Bugbear"]);
    s().moveCombatant(rogue, 99);
    expect(s().combat.map((c) => c.name)).toEqual(["Goblin", "Bugbear", "Rogue"]);
    s().updateCombatant(s().combat[0].id, { hp: -3 });
    expect(s().combat[0].hp).toBe(-3); // not removed at or below 0
    s().clearEnemies();
    expect(s().combat.map((c) => c.name)).toEqual(["Rogue"]);
  });

  it("is saved with the dungeon", () => {
    const session = { ...DEFAULT_SESSION, combat: [{ id: "a", name: "בלאק", hp: -2, side: "enemy" as const }] };
    const files = serializeDungeon({ name: "D", levels: [] }, session);
    expect(parseDungeon(files).session.combat).toEqual(session.combat);
  });
});

describe("sound effect triggers", () => {
  it("detects rooms that became known, but not on load", async () => {
    const { newlyRevealed } = await import("../audio/triggers");
    const room = (id: string, known: boolean) => ({ id, number: 1, title: "", polygon: [], readAloud: "", dmNotes: "", playerKnown: known });
    const level = (rooms: ReturnType<typeof room>[]) => ({ id: "L", name: "L", width: 1, height: 1, scale: 5, description: "", dmImage: null, playerImage: null, rooms, doors: [], objects: [] });
    const a = { name: "D", levels: [level([room("r1", true), room("r2", false)])] };
    const b = { name: "D", levels: [level([room("r1", true), room("r2", true)])] };
    expect(newlyRevealed(a, b)).toEqual(["r2"]);
    expect(newlyRevealed(b, a)).toEqual([]); // concealing is silent
    expect(newlyRevealed(null, b)).toEqual([]); // loading is silent
  });
});
