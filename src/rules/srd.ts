/**
 * The bundled 5e System Reference Document 5.1 (2014) data: monsters and
 * conditions. SRD content by Wizards of the Coast, CC-BY-4.0 (see README).
 */
import monstersJson from "./data/monsters.json";
import conditionsJson from "./data/conditions.json";
import conditionIconsJson from "./data/conditionIcons.json";
import { safeFileName } from "../lib/wikiLinks";
import type { Statblock } from "./statblock";

export const SRD_FOLDER = "SRD";
export const SRD_MONSTERS = `${SRD_FOLDER}/Monsters`;
export const SRD_CONDITIONS = `${SRD_FOLDER}/Conditions`;

export const SRD_CREDIT =
  "Monster and condition rules text: System Reference Document 5.1 by Wizards of the Coast LLC, licensed under CC-BY-4.0. Condition and quick-reference icons: game-icons.net (CC BY 3.0). Quick reference: crobi/dnd5e-quickref (MIT).";

export type SrdMonster = Statblock & { id: string };
export interface SrdCondition {
  id: string;
  name: string;
  /** Markdown ("- " bullet lines). */
  desc: string;
}

export const SRD_MONSTER_LIST = monstersJson as unknown as SrdMonster[];
export const SRD_CONDITION_LIST = conditionsJson as SrdCondition[];
const monsterById = new Map(SRD_MONSTER_LIST.map((m) => [m.id, m]));
const conditionById = new Map(SRD_CONDITION_LIST.map((c) => [c.id, c]));

/** Icon file name (in /rules-icons) for each condition id, plus "concentrating". */
export const CONDITION_ICONS = conditionIconsJson as Record<string, string>;

export function srdMonster(id: string): SrdMonster | null {
  return monsterById.get(id) ?? null;
}

export function srdCondition(id: string): SrdCondition | null {
  return conditionById.get(id) ?? null;
}

export function iconUrl(icon: string): string {
  return `/rules-icons/${icon}.png`;
}

/** SRD documents shown in the Notes tree: "monster:goblin", "condition:prone". */
export type SrdDocId = `monster:${string}` | `condition:${string}`;

export function srdDocTitle(id: string): string {
  const [kind, key] = splitSrdId(id);
  if (kind === "monster") return srdMonster(key)?.name ?? key;
  return srdCondition(key)?.name ?? key;
}

export function splitSrdId(id: string): ["monster" | "condition", string] {
  const i = id.indexOf(":");
  return [id.slice(0, i) as "monster" | "condition", id.slice(i + 1)];
}

/** Link paths (without .md) of every SRD document, for the link index. */
export function srdLinkTargets(): { id: string; path: string }[] {
  return [
    ...SRD_MONSTER_LIST.map((m) => ({ id: `srd:monster:${m.id}`, path: `${SRD_MONSTERS}/${safeFileName(m.name)}` })),
    ...SRD_CONDITION_LIST.map((c) => ({ id: `srd:condition:${c.id}`, path: `${SRD_CONDITIONS}/${c.name}` })),
  ];
}
