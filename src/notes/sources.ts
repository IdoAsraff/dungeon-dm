/**
 * Every piece of searchable/linkable text in a dungeon besides notes: level
 * backgrounds, room read-aloud & DM notes, door and object descriptions.
 */
import type { Dungeon, Level } from "../types";
import { roomTitle } from "../types";

export type FieldRef =
  | { kind: "level-desc"; levelId: string }
  | { kind: "room-read"; levelId: string; roomId: string }
  | { kind: "room-dm"; levelId: string; roomId: string }
  | { kind: "door"; levelId: string; id: string }
  | { kind: "object"; levelId: string; id: string };

export interface DungeonText {
  ref: FieldRef;
  text: string;
  /** Human readable location, e.g. "Grove Level › 42 · The Garden › DM notes". */
  label: string;
}

export function fieldKey(f: FieldRef): string {
  switch (f.kind) {
    case "level-desc":
      return "desc";
    case "room-read":
      return `read:${f.roomId}`;
    case "room-dm":
      return `dm:${f.roomId}`;
    case "door":
      return `door:${f.id}`;
    case "object":
      return `object:${f.id}`;
  }
}

export function sortedRooms(level: Level) {
  return [...level.rooms].sort((a, b) => a.number - b.number);
}

export function dungeonTexts(dungeon: Dungeon | null): DungeonText[] {
  const out: DungeonText[] = [];
  for (const level of dungeon?.levels ?? []) {
    out.push({ ref: { kind: "level-desc", levelId: level.id }, text: level.description, label: `${level.name} › Background` });
    for (const r of sortedRooms(level)) {
      const where = `${level.name} › ${r.number} · ${roomTitle(r)}`;
      out.push({ ref: { kind: "room-read", levelId: level.id, roomId: r.id }, text: r.readAloud, label: `${where} › Read-aloud` });
      out.push({ ref: { kind: "room-dm", levelId: level.id, roomId: r.id }, text: r.dmNotes, label: `${where} › DM notes` });
    }
    level.doors.forEach((d, i) =>
      out.push({ ref: { kind: "door", levelId: level.id, id: d.id }, text: d.description, label: `${level.name} › Door D${i + 1}` }),
    );
    level.objects.forEach((o, i) =>
      out.push({ ref: { kind: "object", levelId: level.id, id: o.id }, text: o.description, label: `${level.name} › Object O${i + 1}` }),
    );
  }
  return out;
}
