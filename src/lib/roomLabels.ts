/**
 * Room labels: the short identifier a room has within its level ("12", "2-17C",
 * "B3"). Shown on the map, used in links (`[[Level 1#2-17C]]`) and as the
 * room's file names (`rooms/2-17C.dm.md`), so they must be unique per level
 * (ignoring case, because macOS file names ignore case) and safe in file names.
 */
import { INVALID_NAME_CHARS } from "./wikiLinks";

export const MAX_ROOM_LABEL = 16;

/** Trims and collapses whitespace. */
export function normalizeRoomLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ");
}

/** Why `label` can't be used for a room (null if it can). `others` are the other rooms' labels on the level. */
export function roomLabelError(label: string, others: Iterable<string>): string | null {
  const l = normalizeRoomLabel(label);
  if (!l) return "Enter a label, like 12 or 2-17C.";
  if (l.length > MAX_ROOM_LABEL) return `Keep it to ${MAX_ROOM_LABEL} characters.`;
  if (INVALID_NAME_CHARS.test(l) || l.startsWith(".")) return 'A label can\'t contain \\ / : * ? " < > | # ^ [ ] or start with a dot.';
  if (/·/.test(l)) return "A label can't contain ·.";
  const key = l.toLowerCase();
  for (const o of others) if (o.toLowerCase() === key) return `Room ${l} already exists on this level.`;
  return null;
}

/** Natural order: 2 < 10, 2-9 < 2-10, 2-17A < 2-17B. */
export function compareRoomLabels(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }) || a.localeCompare(b);
}

/** Lowest positive whole number not used as a label (the default label of a new room). */
export function nextRoomLabel(taken: Iterable<string>): string {
  const set = new Set([...taken].map((t) => t.toLowerCase()));
  let n = 1;
  while (set.has(String(n))) n++;
  return String(n);
}

/**
 * Turns whatever a level.json holds (a label string, or an old numeric
 * `number`) into a valid, unique label. Bad characters become "-"; clashes get
 * a suffix. Returns the label and, if it had to change, why.
 */
export function cleanRoomLabel(raw: unknown, taken: Set<string>): { label: string; changed: boolean } {
  let l = typeof raw === "number" && Number.isFinite(raw) ? String(raw) : typeof raw === "string" ? normalizeRoomLabel(raw) : "";
  const original = l;
  l = l.replace(new RegExp(INVALID_NAME_CHARS.source, "g"), "-").replace(/·/g, "-").replace(/^\.+/, "").slice(0, MAX_ROOM_LABEL).trim();
  if (!l) l = nextRoomLabel(taken);
  if (taken.has(l.toLowerCase())) {
    const base = l.slice(0, MAX_ROOM_LABEL - 3);
    let n = 2;
    while (taken.has(`${base}-${n}`.toLowerCase())) n++;
    l = `${base}-${n}`;
  }
  taken.add(l.toLowerCase());
  return { label: l, changed: l !== original };
}
