import { describe, expect, it } from "vitest";
import { applyDamage, applyHpInput, nextTurn, numberedNames, parseNameCount, parseStartingHp, previousTurn, type TurnState } from "./combat";
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
    s().addCombatants([{ name: " Goblin ", hp: 7 }, { name: "Rogue", hp: 22 }]);
    s().addCombatants([{ name: "Bugbear", hp: 27 }]);
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

  it("is saved with the dungeon, including stats, conditions and the turn", () => {
    const session = {
      ...DEFAULT_SESSION,
      combat: [
        { id: "a", name: "בלאק", hp: -2, side: "enemy" as const },
        {
          id: "b",
          name: "Nokk",
          hp: 5,
          side: "enemy" as const,
          maxHp: 7,
          tempHp: 3,
          ac: 15,
          stats: "srd:monster:goblin",
          statsName: "Goblin",
          note: "has the key",
          conditions: [{ id: "k1", key: "frightened", rounds: 2 }, { id: "k2", key: "exhaustion", level: 3 }, { id: "k3", key: "custom", label: "Blessed" }],
        },
      ],
      round: 3,
      turn: "b",
    };
    const files = serializeDungeon({ name: "D", levels: [], playlists: [] }, session);
    const back = parseDungeon(files).session;
    expect(back.combat).toEqual(session.combat);
    expect([back.round, back.turn]).toEqual([3, "b"]);
  });

  it("reads old combat lists", () => {
    const files = serializeDungeon({ name: "D", levels: [], playlists: [] }, { ...DEFAULT_SESSION });
    const dj = JSON.parse(files["dungeon.json"]);
    dj.session.combat = [{ id: "x", name: "Old", hp: 4, side: "party" }, { name: "Bad" }];
    delete dj.session.round;
    delete dj.session.turn;
    const back = parseDungeon({ ...files, "dungeon.json": JSON.stringify(dj) }).session;
    expect(back.combat).toEqual([{ id: "x", name: "Old", hp: 4, side: "party" }]);
    expect([back.round, back.turn]).toEqual([0, null]);
  });

  it("adds several of the same creature with numbers", () => {
    expect(parseNameCount("Goblin x4")).toEqual({ name: "Goblin", count: 4 });
    expect(parseNameCount("Goblin ×2")).toEqual({ name: "Goblin", count: 2 });
    expect(parseNameCount("Axe")).toEqual({ name: "Axe", count: 1 });
    expect(numberedNames("Goblin", 3, [])).toEqual(["Goblin 1", "Goblin 2", "Goblin 3"]);
    expect(numberedNames("Goblin", 2, ["Goblin 1", "Goblin 2", "goblin 5"])).toEqual(["Goblin 6", "Goblin 7"]);
    expect(numberedNames("Nokk", 1, ["Nokk"])).toEqual(["Nokk"]);
  });

  it("uses temporary HP first and caps healing at max HP", () => {
    expect(applyDamage({ hp: 10, tempHp: 5, maxHp: 10 }, 7)).toEqual({ hp: 8, tempHp: 0 });
    expect(applyDamage({ hp: 10, tempHp: 5, maxHp: 10 }, 3)).toEqual({ hp: 10, tempHp: 2 });
    expect(applyDamage({ hp: 4, maxHp: 10 }, -20)).toEqual({ hp: 10, tempHp: 0 });
    expect(applyDamage({ hp: 4 }, -20)).toEqual({ hp: 24, tempHp: 0 });
  });
});

describe("turns", () => {
  const c = (id: string, conditions: { id: string; key: string; rounds?: number | null }[] = []) => ({ id, name: id.toUpperCase(), hp: 5, side: "enemy" as const, conditions });
  it("walks the list, counts rounds and expires timed conditions at the end of a turn", () => {
    let st: TurnState = { combat: [c("a", [{ id: "f", key: "frightened", rounds: 2 }, { id: "p", key: "prone" }]), c("b")], round: 0, turn: null as string | null };
    let r = nextTurn(st);
    expect([r.round, r.turn]).toEqual([1, "a"]); // starts combat
    r = nextTurn(r);
    expect([r.round, r.turn]).toEqual([1, "b"]);
    expect(r.combat[0].conditions!.map((x) => [x.key, x.rounds])).toEqual([["frightened", 1], ["prone", undefined]]);
    r = nextTurn(r);
    expect([r.round, r.turn]).toEqual([2, "a"]);
    r = nextTurn(r);
    expect(r.expired.map((e) => `${e.combatant}:${e.condition.key}`)).toEqual(["A:frightened"]);
    expect(r.combat[0].conditions!.map((x) => x.key)).toEqual(["prone"]);
    st = previousTurn(r);
    expect([st.round, st.turn]).toEqual([2, "a"]);
    st = previousTurn(st);
    expect([st.round, st.turn]).toEqual([1, "b"]);
  });

  it("stat block links follow renamed notes and folders", () => {
    const s = useSession.getState();
    s.setSession({ ...DEFAULT_SESSION });
    s.addCombatants([
      { name: "A", hp: 1, stats: "note:Stats/Nokk.md" },
      { name: "B", hp: 1, stats: "srd:monster:goblin" },
      { name: "C", hp: 1, stats: "note:Stats/Sub/Boss.md" },
    ]);
    useSession.getState().remapStats("Stats/Nokk.md", "Stats/Nokk the Bold.md");
    useSession.getState().remapStats("Stats", "Creatures");
    expect(useSession.getState().combat.map((c) => c.stats)).toEqual(["note:Creatures/Nokk the Bold.md", "srd:monster:goblin", "note:Creatures/Sub/Boss.md"]);
  });

  it("removing whoever's turn it is passes it on", () => {
    const s = useSession.getState();
    s.setSession({ ...DEFAULT_SESSION });
    const [a, b] = s.addCombatants([{ name: "A", hp: 1 }, { name: "B", hp: 1 }]);
    useSession.getState().nextTurn();
    expect(useSession.getState().turn).toBe(a);
    useSession.getState().removeCombatant(a);
    expect(useSession.getState().turn).toBe(b);
  });
});

describe("sound effect triggers", () => {
  it("detects rooms that became known, but not on load", async () => {
    const { newlyRevealed } = await import("../audio/triggers");
    const room = (id: string, known: boolean) => ({ id, number: 1, title: "", polygon: [], readAloud: "", dmNotes: "", playerKnown: known });
    const level = (rooms: ReturnType<typeof room>[]) => ({ id: "L", name: "L", width: 1, height: 1, scale: 5, description: "", dmImage: null, playerImage: null, rooms, doors: [], objects: [] });
    const a = { name: "D", levels: [level([room("r1", true), room("r2", false)])], playlists: [] };
    const b = { name: "D", levels: [level([room("r1", true), room("r2", true)])], playlists: [] };
    expect(newlyRevealed(a, b)).toEqual(["r2"]);
    expect(newlyRevealed(b, a)).toEqual([]); // concealing is silent
    expect(newlyRevealed(null, b)).toEqual([]); // loading is silent
  });
});
