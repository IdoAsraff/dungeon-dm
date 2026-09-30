import { describe, expect, it } from "vitest";
import { abilityMod, composeStatNote, crXp, emptyStatblock, formatMod, isStatblockNote, parseStatNote, proficiencyBonus, statblockFromYaml } from "./statblock";
import { SRD_CONDITION_LIST, SRD_MONSTER_LIST, srdLinkTargets, srdMonster } from "./srd";
import { buildIndex } from "../notes/links";
import { parseStatblockText } from "./pasteStatblock";

describe("statblock math", () => {
  it("computes modifiers, XP and proficiency", () => {
    expect([abilityMod(8), abilityMod(10), abilityMod(15), abilityMod(1)]).toEqual([-1, 0, 2, -5]);
    expect(formatMod(2)).toBe("+2");
    expect(formatMod(-1)).toBe("−1");
    expect(crXp("1/4")).toBe(50);
    expect(crXp("10")).toBe(5900);
    expect([proficiencyBonus("1/4"), proficiencyBonus("4"), proficiencyBonus("5"), proficiencyBonus("17")]).toEqual([2, 2, 3, 6]);
  });
});

describe("stat block notes", () => {
  it("round-trips through the note format", () => {
    const sb = {
      ...emptyStatblock("Nokk the Goblin"),
      size: "Small",
      type: "humanoid (goblinoid)",
      alignment: "neutral evil",
      ac: 15,
      acNote: "leather armor, shield",
      hp: 12,
      hitDice: "3d6 + 2",
      stats: [8, 14, 10, 10, 8, 8] as [number, number, number, number, number, number],
      saves: "Dex +4, Wis -1",
      skills: "Stealth +6, Sleight of Hand +4",
      cr: "1/2",
      traits: [{ name: "Nimble Escape", desc: "Disengage or Hide as a bonus action." }],
      actions: [{ name: "Scimitar", desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage." }],
      image: "nokk.png",
    };
    const text = composeStatNote(sb, "Nokk hates [[Belak]].\n");
    expect(isStatblockNote(text)).toBe(true);
    expect(text).toContain("subtype: goblinoid");
    expect(text).toContain("image: \"[[nokk.png]]\"");
    const back = parseStatNote(text);
    expect(back.error).toBeNull();
    expect(back.body).toBe("Nokk hates [[Belak]].\n");
    expect(back.statblock).toEqual({ ...sb, description: "Nokk hates [[Belak]].\n" });
  });

  it("reads Fantasy Statblocks YAML written elsewhere", () => {
    const sb = statblockFromYaml(`name: Owlbear
size: Large
type: monstrosity
alignment: unaligned
ac: 13 (natural armor)
hp: 59
hit_dice: 7d10 + 21
speed: 40 ft.
stats: [20, 12, 17, 3, 12, 7]
saves:
  - dexterity: 3
skillsaves:
  - perception: 3
senses: darkvision 60 ft., passive Perception 13
cr: 3
traits:
  - name: Keen Sight and Smell
    desc: Advantage on Perception checks that rely on sight or smell.
`);
    expect(sb).toMatchObject({ name: "Owlbear", ac: 13, acNote: "natural armor", hp: 59, cr: "3", saves: "Dex +3", skills: "Perception +3" });
    expect(sb.traits[0].name).toBe("Keen Sight and Smell");
  });

  it("reports malformed YAML instead of failing", () => {
    const r = parseStatNote("```statblock\nname: [oops\n```\nText");
    expect(r.statblock).toBeNull();
    expect(r.error).toBeTruthy();
    expect(r.body).toBe("Text");
    expect(parseStatNote("# Just a note").statblock).toBeNull();
  });
});

describe("SRD", () => {
  it("bundles the 2014 monsters and conditions", () => {
    expect(SRD_MONSTER_LIST.length).toBeGreaterThan(300);
    expect(SRD_CONDITION_LIST.map((c) => c.id)).toContain("exhaustion");
    expect(srdMonster("goblin")).toMatchObject({ name: "Goblin", ac: 15, hp: 7, hitDice: "2d6", cr: "1/4", type: "humanoid (goblinoid)" });
    const dragon = srdMonster("adult-red-dragon")!;
    expect(dragon.legendaryActions.length).toBe(3);
    expect(dragon.actions.some((a) => a.name === "Fire Breath (Recharge 5–6)")).toBe(true);
  });

  it("links resolve to SRD pages unless a note has the same name", () => {
    const idx = buildIndex([], null);
    expect(idx.resolve("Goblin")?.id).toBe("srd:monster:goblin");
    expect(idx.resolve("Prone")?.id).toBe("srd:condition:prone");
    expect(idx.resolve("SRD/Monsters/Succubus-Incubus")?.id).toBe("srd:monster:succubus-incubus");
    const withNote = buildIndex(["Stats/Goblin.md"], null);
    expect(withNote.resolve("Goblin")?.id).toBe("note:Stats/Goblin.md");
    expect(withNote.resolve("SRD/Monsters/Goblin")?.id).toBe("srd:monster:goblin");
    expect(srdLinkTargets().length).toBe(SRD_MONSTER_LIST.length + SRD_CONDITION_LIST.length);
  });
});


describe("pasting a stat block", () => {
  it("reads a D&D Beyond copy (labels and values on separate lines)", () => {
    const text = `Goblin
Small Humanoid (Goblinoid), Neutral Evil
Armor Class
15 (Leather Armor, Shield)
Hit Points
7 (2d6)
Speed
30 ft.
STR
8 (-1)
DEX
14 (+2)
CON
10 (+0)
INT
10 (+0)
WIS
8 (-1)
CHA
8 (-1)
Skills
Stealth +6
Senses
Darkvision 60 ft., Passive Perception 9
Languages
Common, Goblin
Challenge
1/4 (50 XP)
Proficiency Bonus
+2
Nimble Escape. The goblin can take the Disengage or Hide action as a bonus action on each of its turns.
Actions
Scimitar. Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.
Shortbow. Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target. Hit: 5 (1d6 + 2) piercing damage.
Monster Tags:
Goblinoid`;
    const sb = parseStatblockText(text)!;
    expect(sb).toMatchObject({
      name: "Goblin",
      size: "Small",
      type: "humanoid (goblinoid)",
      alignment: "neutral evil",
      ac: 15,
      acNote: "leather armor, shield",
      hp: 7,
      hitDice: "2d6",
      speed: "30 ft.",
      stats: [8, 14, 10, 10, 8, 8],
      skills: "Stealth +6",
      senses: "Darkvision 60 ft., Passive Perception 9",
      languages: "Common, Goblin",
      cr: "1/4",
    });
    expect(sb.traits.map((t) => t.name)).toEqual(["Nimble Escape"]);
    expect(sb.actions.map((t) => t.name)).toEqual(["Scimitar", "Shortbow"]);
  });

  it("reads book-style text with abilities in one row and wrapped lines", () => {
    const text = `BUGBEAR
Medium humanoid (goblinoid), chaotic evil
Armor Class 16 (hide armor, shield)
Hit Points 27 (5d8 + 5)
Speed 30 ft.
STR DEX CON INT WIS CHA
15 (+2) 14 (+2) 13 (+1) 8 (−1) 11 (+0) 9 (−1)
Skills Stealth +6, Survival +2
Senses darkvision 60 ft., passive Perception 10
Languages Common, Goblin
Challenge 1 (200 XP)
Brute. A melee weapon deals one extra die of its damage when the bugbear hits
with it (included in the attack).
Surprise Attack (1/Day). If the bugbear surprises a creature and hits it with an attack during the first round of combat, the target takes an extra 7 (2d6) damage from the attack.
ACTIONS
Morningstar. Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 11 (2d8 + 2) piercing damage.
LEGENDARY ACTIONS
The bugbear can take 1 legendary action.
Smash. It smashes.`;
    const sb = parseStatblockText(text)!;
    expect(sb).toMatchObject({ name: "BUGBEAR", ac: 16, hp: 27, hitDice: "5d8 + 5", stats: [15, 14, 13, 8, 11, 9], cr: "1" });
    expect(sb.traits.map((t) => t.name)).toEqual(["Brute", "Surprise Attack (1/Day)"]);
    expect(sb.traits[0].desc).toContain("\nwith it");
    expect(sb.actions[0].name).toBe("Morningstar");
    expect(sb.legendaryIntro).toBe("The bugbear can take 1 legendary action.");
    expect(sb.legendaryActions[0].name).toBe("Smash");
  });
});
