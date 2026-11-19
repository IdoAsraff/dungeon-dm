import { describe, expect, it } from "vitest";
import {
  applyDamage,
  applyHpInput,
  applyInitiatives,
  nextTurn,
  numberedNames,
  parseInitiative,
  parseNameCount,
  parseStartingHp,
  previousTurn,
  type TurnState,
} from "./combat";
import { useSession } from "../store/session";
import { DEFAULT_SESSION, type Combatant } from "../types";
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

describe("initiative", () => {
  type C = { id: string; name?: string; initiative?: number | null; side?: "enemy" | "party"; stats?: string };
  const make = (list: C[]): Combatant[] => list.map((x) => ({ name: x.id.toUpperCase(), hp: 5, side: "enemy" as const, ...x }));
  const order = (list: Combatant[]) => list.map((c) => (c.initiative == null ? c.id : `${c.id}${c.initiative}`)).join(" ");

  it("understands typed numbers", () => {
    expect(["14", " 7 ", "-1", "+3", "−2", "0"].map(parseInitiative)).toEqual([14, 7, -1, 3, -2, 0]);
    expect(["", "abc", "123", "1.5", "--2"].map(parseInitiative)).toEqual([null, null, null, null, null]);
  });

  it("moves each line to its place as the numbers are typed", () => {
    let list = make([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]);
    list = applyInitiatives(list, { a: 5 });
    expect(order(list)).toBe("a5 b c d"); // the first number goes to the top
    list = applyInitiatives(list, { b: 18 });
    expect(order(list)).toBe("b18 a5 c d");
    list = applyInitiatives(list, { c: 11 });
    expect(order(list)).toBe("b18 c11 a5 d");
    list = applyInitiatives(list, { d: 2 });
    expect(order(list)).toBe("b18 c11 a5 d2");
    // Retyping one moves it again; the others stay sorted.
    list = applyInitiatives(list, { b: 3 });
    expect(order(list)).toBe("c11 a5 b3 d2");
  });

  it("leaves lines without initiative where they are", () => {
    const list = make([{ id: "a", initiative: 15 }, { id: "n" }, { id: "b", initiative: 10 }, { id: "x" }]);
    expect(order(applyInitiatives(list, { x: 12 }))).toBe("a15 n x12 b10");
    expect(order(applyInitiatives(list, { x: 1 }))).toBe("a15 n b10 x1");
  });

  it("clearing a number keeps the line in place", () => {
    const list = applyInitiatives(make([{ id: "a", initiative: 15 }, { id: "b", initiative: 10 }]), { a: null });
    expect(order(list)).toBe("a b10");
    expect("initiative" in list[0]).toBe(false); // nothing saved for it
  });

  it("breaks ties by Dex score when both are known, otherwise after the others", () => {
    const dex = (c: Combatant) => ({ fast: 16, slow: 8 })[c.id as "fast" | "slow"] ?? null;
    const list = make([{ id: "slow", initiative: 12 }, { id: "pc", initiative: 12 }, { id: "fast" }]);
    expect(order(applyInitiatives(list, { fast: 12 }, dex))).toBe("fast12 slow12 pc12");
    expect(order(applyInitiatives(list, { fast: 12 }))).toBe("slow12 pc12 fast12");
  });

  it("keeps a group together when they share a number", () => {
    const list = make([{ id: "pc", initiative: 14 }, { id: "g1" }, { id: "g2" }, { id: "g3" }, { id: "low", initiative: 3 }]);
    expect(order(applyInitiatives(list, { g1: 14, g2: 14, g3: 14 }))).toBe("pc14 g114 g214 g314 low3");
  });

  it("is set through the store, saved, and cleared when combat ends", () => {
    const s = useSession.getState;
    s().setSession({ ...DEFAULT_SESSION });
    const [a, b] = s().addCombatants([{ name: "A", hp: 5 }, { name: "B", hp: 5 }]);
    s().setInitiatives({ [a]: 3, [b]: 17 });
    expect(s().combat.map((c) => [c.name, c.initiative])).toEqual([["B", 17], ["A", 3]]);
    s().nextTurn();
    const back = parseDungeon(serializeDungeon({ name: "D", levels: [], playlists: [] }, s())).session;
    expect(back.combat.map((c) => c.initiative)).toEqual([17, 3]);
    s().endCombat();
    expect(s().combat.map((c) => [c.name, c.initiative])).toEqual([["B", undefined], ["A", undefined]]);
  });

  it("reads saved values tolerantly", () => {
    const files = serializeDungeon({ name: "D", levels: [], playlists: [] }, { ...DEFAULT_SESSION });
    const dj = JSON.parse(files["dungeon.json"]);
    dj.session.combat = [
      { id: "a", name: "A", hp: 1, initiative: "abc" },
      { id: "b", name: "B", hp: 1, initiative: 500 },
      { id: "c", name: "C", hp: 1, initiative: "7" },
      { id: "d", name: "D", hp: 1, initiative: null },
    ];
    const back = parseDungeon({ ...files, "dungeon.json": JSON.stringify(dj) }).session;
    expect(back.combat.map((c) => c.initiative)).toEqual([undefined, 99, 7, undefined]);
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
    const room = (id: string, known: boolean) => ({ id, label: "1", title: "", polygon: [], readAloud: "", dmNotes: "", playerKnown: known });
    const level = (rooms: ReturnType<typeof room>[]) => ({ id: "L", name: "L", width: 1, height: 1, scale: 5, description: "", dmImage: null, playerImage: null, rooms, doors: [], objects: [] });
    const a = { name: "D", levels: [level([room("r1", true), room("r2", false)])], playlists: [] };
    const b = { name: "D", levels: [level([room("r1", true), room("r2", true)])], playlists: [] };
    expect(newlyRevealed(a, b)).toEqual(["r2"]);
    expect(newlyRevealed(b, a)).toEqual([]); // concealing is silent
    expect(newlyRevealed(null, b)).toEqual([]); // loading is silent
  });
});
