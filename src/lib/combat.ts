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
