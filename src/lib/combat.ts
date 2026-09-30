import type { CombatCondition, Combatant } from "../types";

/**
 * HP entry in the combat tracker:
 *   "-7"  subtracts 7      "+5"  adds 5
 *   "12"  sets 12          "=-3" sets -3 (a plain "-3" would subtract)
 * Returns the new HP, or null if the input is not understood (or empty).
 */
export function applyHpInput(current: number, input: string): number | null {
  const s = input.replace(/\s+/g, "").replace(/[−–]/g, "-");
  if (!s) return null;
  let m = /^([+-])(\d+)$/.exec(s);
  if (m) return current + (m[1] === "+" ? 1 : -1) * Number(m[2]);
  m = /^=?(-?\d+)$/.exec(s);
  if (m) return Number(m[1]);
  return null;
}

/** HP typed when adding a combatant: a plain number (default 0). */
export function parseStartingHp(input: string): number | null {
  const s = input.trim();
  if (!s) return 0;
  return /^-?\d+$/.test(s) ? Number(s) : null;
}

/** "Goblin x4" → { name: "Goblin", count: 4 }. */
export function parseNameCount(input: string): { name: string; count: number } {
  const m = /^(.*?)\s*[x×]\s*(\d{1,2})$/i.exec(input.trim());
  if (m && Number(m[2]) >= 1) return { name: m[1].trim(), count: Math.min(20, Number(m[2])) };
  return { name: input.trim(), count: 1 };
}

/** Names for `count` new combatants: "Goblin 1".."Goblin 4", continuing after existing ones. */
export function numberedNames(base: string, count: number, existing: string[]): string[] {
  if (count <= 1) return [base];
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (\\d+)$`, "i");
  let n = existing.reduce((max, e) => Math.max(max, Number(re.exec(e)?.[1] ?? 0)), 0);
  return Array.from({ length: count }, () => `${base} ${++n}`);
}

/**
 * Damage/healing with temporary HP: damage uses temp HP first; healing never
 * goes above max HP (when known). Returns the new { hp, tempHp }.
 */
export function applyDamage(c: Pick<Combatant, "hp" | "tempHp" | "maxHp">, amount: number): { hp: number; tempHp: number } {
  let temp = c.tempHp ?? 0;
  let hp = c.hp;
  if (amount > 0) {
    const absorbed = Math.min(temp, amount);
    temp -= absorbed;
    hp -= amount - absorbed;
  } else if (amount < 0) {
    hp = c.maxHp ? Math.min(c.maxHp, hp - amount) : hp - amount;
    if (c.hp > (c.maxHp ?? Infinity)) hp = Math.max(hp, c.hp);
  }
  return { hp, tempHp: temp };
}

export interface TurnState {
  combat: Combatant[];
  round: number;
  turn: string | null;
}

export interface TurnResult extends TurnState {
  /** Conditions that ran out when a turn ended: "Nokk is no longer Frightened". */
  expired: { combatant: string; condition: CombatCondition }[];
}

/** Next turn: the current combatant's timed conditions count down, then the marker moves on (a new round after the last). */
export function nextTurn(s: TurnState): TurnResult {
  if (!s.combat.length) return { ...s, round: 0, turn: null, expired: [] };
  const idx = s.combat.findIndex((c) => c.id === s.turn);
  if (idx === -1) return { ...s, round: Math.max(1, s.round), turn: s.combat[0].id, expired: [] };
  const expired: TurnResult["expired"] = [];
  const combat = s.combat.map((c, i) => {
    if (i !== idx || !c.conditions?.some((x) => typeof x.rounds === "number")) return c;
    const conditions: CombatCondition[] = [];
    for (const x of c.conditions) {
      if (typeof x.rounds !== "number") conditions.push(x);
      else if (x.rounds > 1) conditions.push({ ...x, rounds: x.rounds - 1 });
      else expired.push({ combatant: c.name, condition: x });
    }
    return { ...c, conditions };
  });
  const last = idx === s.combat.length - 1;
  return { combat, round: last ? s.round + 1 : Math.max(1, s.round), turn: s.combat[last ? 0 : idx + 1].id, expired };
}

/** Previous turn (just moves the marker back; conditions are not restored). */
export function previousTurn(s: TurnState): TurnState {
  if (!s.combat.length) return { ...s, round: 0, turn: null };
  const idx = s.combat.findIndex((c) => c.id === s.turn);
  if (idx === -1) return { ...s, round: Math.max(1, s.round), turn: s.combat[s.combat.length - 1].id };
  if (idx === 0) return s.round > 1 ? { ...s, round: s.round - 1, turn: s.combat[s.combat.length - 1].id } : s;
  return { ...s, turn: s.combat[idx - 1].id };
}

/** Reads combatants saved in dungeon.json, tolerating older files and bad data. */
export function normalizeCombatant(c: unknown, i: number): Combatant | null {
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  if (typeof o.name !== "string" || !Number.isFinite(Number(o.hp))) return null;
  const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
  const out: Combatant = {
    id: typeof o.id === "string" && o.id ? o.id : `c${i}`,
    name: o.name,
    hp: Math.round(Number(o.hp)),
    side: o.side === "party" ? "party" : "enemy",
  };
  const maxHp = num(o.maxHp);
  if (maxHp !== null) out.maxHp = maxHp;
  const tempHp = num(o.tempHp);
  if (tempHp) out.tempHp = tempHp;
  const ac = num(o.ac);
  if (ac !== null) out.ac = ac;
  if (typeof o.stats === "string" && o.stats) out.stats = o.stats;
  if (typeof o.statsName === "string" && o.statsName) out.statsName = o.statsName;
  if (typeof o.note === "string" && o.note) out.note = o.note;
  if (Array.isArray(o.conditions)) {
    out.conditions = o.conditions
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as { key?: unknown }).key === "string")
      .map((x, j) => {
        const cond: CombatCondition = { id: typeof x.id === "string" ? x.id : `k${j}`, key: x.key as string };
        if (typeof x.label === "string") cond.label = x.label;
        if (num(x.level) !== null) cond.level = num(x.level)!;
        if (num(x.rounds) !== null) cond.rounds = num(x.rounds);
        return cond;
      });
  }
  return out;
}
