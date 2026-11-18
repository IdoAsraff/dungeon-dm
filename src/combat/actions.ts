/** Combat actions shared by the Combat tab and the Dungeon view's combat panel. */
import { useSession, type NewCombatant } from "../store/session";
import { useUi } from "../store/ui";
import { numberedNames, parseNameCount } from "../lib/combat";
import { resolveStats, type StatsOption } from "../rules/statNotes";
import { statImagePath } from "../rules/StatNotePane";
import { srdCondition } from "../rules/srd";
import type { CombatCondition, Combatant } from "../types";

/** Adds one or more combatants from the add row: "Goblin x4", optional stats, starting HP, optional initiative (shared). */
export function addFromRow(nameInput: string, stats: StatsOption | null, hp: number, initiative: number | null = null): string[] {
  const { name: typed, count } = parseNameCount(nameInput);
  const base = typed || stats?.name || "";
  if (!base) return [];
  const existing = useSession.getState().combat.map((c) => c.name);
  const names = numberedNames(base, count, existing);
  const list: NewCombatant[] = names.map((name) => ({
    name,
    hp,
    ...(hp > 0 ? { maxHp: hp } : {}),
    ...(stats ? { stats: stats.key, statsName: stats.name, ac: stats.ac } : {}),
  }));
  const ids = useSession.getState().addCombatants(list);
  if (initiative !== null) useSession.getState().setInitiatives(Object.fromEntries(ids.map((id) => [id, initiative])), dexScore);
  return ids;
}

/** Dexterity score from a combatant's stat block, if it has one. */
export function dexScore(c: Combatant): number | null {
  const dex = resolveStats(c.stats)?.sb.stats[1];
  return typeof dex === "number" && Number.isFinite(dex) ? dex : null;
}

/** Sets one combatant's initiative (null clears it) and moves it to its place. */
export function setInitiative(id: string, value: number | null) {
  useSession.getState().setInitiatives({ [id]: value }, dexScore);
}

/** The image of a combatant's stat block (dungeon-root-relative), if any. */
export function combatantImage(c: Combatant): string | null {
  const r = resolveStats(c.stats);
  return r ? statImagePath(r.sb) : null;
}

/** Images of every enemy still standing, without duplicates (4 goblins → 1 goblin picture). */
export function enemyImages(combat: Combatant[]): string[] {
  const out: string[] = [];
  for (const c of combat) {
    if (c.side !== "enemy" || c.hp <= 0) continue;
    const img = combatantImage(c);
    if (img && !out.includes(img)) out.push(img);
  }
  return out;
}

export function sameImages(a: string[] | null, b: string[]): boolean {
  return !!a && a.length === b.length && a.every((x, i) => x === b[i]);
}

export function conditionName(k: Pick<CombatCondition, "key" | "label" | "level">): string {
  if (k.key === "custom") return k.label || "Custom";
  if (k.key === "concentrating") return "Concentrating";
  const name = srdCondition(k.key)?.name ?? k.key;
  return k.key === "exhaustion" && k.level ? `${name} ${k.level}` : name;
}

/** Next turn, telling the DM about conditions that ran out. */
export function advanceTurn() {
  const s = useSession.getState();
  if (!s.combat.length) return;
  const r = s.nextTurn();
  if (r.expired.length) {
    useUi.getState().showToast(r.expired.map((e) => `${e.combatant} is no longer ${conditionName(e.condition)}`).join(" · "));
  }
}
