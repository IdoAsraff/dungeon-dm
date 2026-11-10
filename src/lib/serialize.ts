/**
 * Converts a Dungeon to/from the on-disk directory layout:
 *
 *   dungeon.json                         name, level order, session state
 *   notes/                               the dungeon's notes (managed separately)
 *   assets/                              images (managed by the backend)
 *   levels/<levelId>/level.json          grid, images, room/door/object geometry
 *   levels/<levelId>/description.md      level description
 *   levels/<levelId>/rooms/<label>.read-aloud.md   (label: "12", "2-17C"...)
 *   levels/<levelId>/rooms/<label>.dm.md
 *   levels/<levelId>/doors/<doorId>.md
 *   levels/<levelId>/objects/<objectId>.md
 *
 * Empty markdown documents are not written. Serialization is a pure function
 * producing a map of relative path -> file content, which lets the autosaver
 * write only the files that changed.
 */
import { DEFAULT_SESSION, MAX_BRIGHTNESS, MIN_BRIGHTNESS, type BackgroundImage, type Combatant, type Dungeon, type Level, type PlaylistRef, type Point, type Room, type Session } from "../types";
import { cleanRoomLabel } from "./roomLabels";
import { toFileRelative, toRootRelative } from "./markdownPaths";
import { normalizeCombatant } from "./combat";

export const FORMAT_VERSION = 1;

export type FileMap = Record<string, string>;

type JsonPoint = [number, number];

interface DungeonJson {
  format: number;
  name: string;
  levels: string[];
  playlists?: PlaylistRef[];
  session?: Partial<Session>;
}

interface LevelJson {
  id: string;
  name: string;
  width: number;
  height: number;
  scale: number;
  dmImage: BackgroundImage | null;
  playerImage: BackgroundImage | null;
  /** `label` since room labels; older files have only a numeric `number`. */
  rooms: { id: string; label?: string; number?: number; title?: string; playerKnown: boolean; polygon: JsonPoint[] }[];
  doors: { id: string; polygon: JsonPoint[] }[];
  objects: { id: string; polygon: JsonPoint[] }[];
}

const toJsonPoly = (poly: Point[]): JsonPoint[] => poly.map((p) => [p.x, p.y]);
const fromJsonPoly = (poly: JsonPoint[] | undefined): Point[] =>
  (poly ?? []).map(([x, y]) => ({ x: Number(x), y: Number(y) }));

export const levelDir = (levelId: string) => `levels/${levelId}`;
export const roomFile = (levelId: string, label: string, kind: "read-aloud" | "dm") =>
  `${levelDir(levelId)}/rooms/${label}.${kind}.md`;
export const doorFile = (levelId: string, id: string) => `${levelDir(levelId)}/doors/${id}.md`;
export const objectFile = (levelId: string, id: string) => `${levelDir(levelId)}/objects/${id}.md`;

/**
 * Compact JSON: objects are indented, but short arrays of numbers (points)
 * stay on one line so polygons remain readable in diffs.
 */
export function prettyJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  return (
    json.replace(/\[\s+(-?[\d.e+-]+),\s+(-?[\d.e+-]+)\s+\]/g, "[$1, $2]").replace(
      /\[\s+((?:\[-?[\d.e+-]+, -?[\d.e+-]+\],?\s+)+)\]/g,
      (_m, inner: string) => `[${inner.trim().split(/\],\s+/).join("], ")}]`,
    ) + "\n"
  );
}

function putMd(files: FileMap, path: string, md: string) {
  if (md.trim() === "") return;
  files[path] = toFileRelative(md, path).replace(/\s*$/, "\n");
}

export function serializeDungeon(dungeon: Dungeon, session: Session): FileMap {
  const files: FileMap = {};
  const dj: DungeonJson = {
    format: FORMAT_VERSION,
    name: dungeon.name,
    levels: dungeon.levels.map((l) => l.id),
    playlists: dungeon.playlists,
    session: {
      focus: session.focus,
      playerLevelId: session.playerLevelId,
      blackout: session.blackout,
      rotation: session.rotation,
      compass: session.compass,
      combat: session.combat,
      round: session.round,
      turn: session.turn,
      brightness: session.brightness,
    },
  };
  files["dungeon.json"] = prettyJson(dj);
  for (const level of dungeon.levels) serializeLevel(level, files);
  return files;
}

function serializeLevel(level: Level, files: FileMap) {
  const lj: LevelJson = {
    id: level.id,
    name: level.name,
    width: level.width,
    height: level.height,
    scale: level.scale,
    dmImage: level.dmImage,
    playerImage: level.playerImage,
    rooms: level.rooms.map((r) => ({
      id: r.id,
      label: r.label,
      title: r.title,
      playerKnown: r.playerKnown,
      polygon: toJsonPoly(r.polygon),
    })),
    doors: level.doors.map((d) => ({ id: d.id, polygon: toJsonPoly(d.polygon) })),
    objects: level.objects.map((o) => ({ id: o.id, polygon: toJsonPoly(o.polygon) })),
  };
  files[`${levelDir(level.id)}/level.json`] = prettyJson(lj);
  putMd(files, `${levelDir(level.id)}/description.md`, level.description);
  for (const r of level.rooms) {
    putMd(files, roomFile(level.id, r.label, "read-aloud"), r.readAloud);
    putMd(files, roomFile(level.id, r.label, "dm"), r.dmNotes);
  }
  for (const d of level.doors) putMd(files, doorFile(level.id, d.id), d.description);
  for (const o of level.objects) putMd(files, objectFile(level.id, o.id), o.description);
}

export class DungeonFormatError extends Error {}

function parseRooms(
  rooms: LevelJson["rooms"],
  texts: (label: string) => { readAloud: string; dmNotes: string },
  warn: (msg: string) => void,
): Room[] {
  const taken = new Set<string>();
  return rooms.map((r) => {
    const stored = typeof r.label === "string" && r.label.trim() ? r.label : r.number;
    const { label, changed } = cleanRoomLabel(stored, taken);
    // Texts are read under the stored name, so a cleaned label still finds its files (saving renames them).
    const fileLabel = stored !== undefined && stored !== null && String(stored).trim() ? String(stored).trim() : label;
    if (changed) warn(`room label "${stored ?? ""}" was changed to "${label}".`);
    return {
      id: r.id,
      label,
      title: typeof r.title === "string" ? r.title : "",
      playerKnown: !!r.playerKnown,
      polygon: fromJsonPoly(r.polygon),
      ...texts(fileLabel),
    };
  });
}

function readMd(files: FileMap, path: string): string {
  const raw = files[path];
  if (raw === undefined) return "";
  return toRootRelative(raw.replace(/\r\n/g, "\n"), path).replace(/\n+$/, "");
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface ParsedDungeon {
  dungeon: Dungeon;
  session: Session;
  warnings: string[];
  /**
   * Content of a pre-notes `background.md` (root-relative links), to be moved
   * into the notes folder; null if there is none.
   */
  legacyBackground: string | null;
}

export function parseDungeon(files: FileMap): ParsedDungeon {
  const warnings: string[] = [];
  const raw = files["dungeon.json"];
  if (raw === undefined) throw new DungeonFormatError("This folder has no dungeon.json — it is not a dungeon.");
  let dj: DungeonJson;
  try {
    dj = JSON.parse(raw);
  } catch (e) {
    throw new DungeonFormatError(`dungeon.json is not valid JSON: ${(e as Error).message}`);
  }
  const levels: Level[] = [];
  for (const id of dj.levels ?? []) {
    const path = `${levelDir(id)}/level.json`;
    const lraw = files[path];
    if (lraw === undefined) {
      warnings.push(`Level "${id}" is listed in dungeon.json but ${path} is missing.`);
      continue;
    }
    let lj: LevelJson;
    try {
      lj = JSON.parse(lraw);
    } catch (e) {
      warnings.push(`${path} is not valid JSON: ${(e as Error).message}`);
      continue;
    }
    levels.push({
      id,
      name: lj.name ?? id,
      width: num(lj.width, 30),
      height: num(lj.height, 30),
      scale: num(lj.scale, 5),
      description: readMd(files, `${levelDir(id)}/description.md`),
      dmImage: lj.dmImage ?? null,
      playerImage: lj.playerImage ?? null,
      rooms: parseRooms(lj.rooms ?? [], (label) => ({
        readAloud: readMd(files, roomFile(id, label, "read-aloud")),
        dmNotes: readMd(files, roomFile(id, label, "dm")),
      }), (msg) => warnings.push(`${path}: ${msg}`)),
      doors: (lj.doors ?? []).map((d) => ({
        id: d.id,
        polygon: fromJsonPoly(d.polygon),
        description: readMd(files, doorFile(id, d.id)),
      })),
      objects: (lj.objects ?? []).map((o) => ({
        id: o.id,
        polygon: fromJsonPoly(o.polygon),
        description: readMd(files, objectFile(id, o.id)),
      })),
    });
  }
  const dungeon: Dungeon = {
    name: dj.name ?? "Untitled dungeon",
    levels,
    playlists: Array.isArray(dj.playlists)
      ? dj.playlists.filter((p) => p && typeof p.id === "string").map((p) => ({ id: p.id, name: String(p.name ?? ""), image: p.image ?? null }))
      : [],
  };
  const s = dj.session ?? {};
  const focusValid =
    s.focus &&
    levels.some((l) => l.id === s.focus!.levelId && l.rooms.some((r) => r.id === s.focus!.roomId && r.playerKnown));
  const combat = Array.isArray(s.combat) ? s.combat.map(normalizeCombatant).filter((c): c is Combatant => c !== null) : [];
  const session: Session = {
    ...DEFAULT_SESSION,
    focus: focusValid ? s.focus! : null,
    playerLevelId: s.playerLevelId && levels.some((l) => l.id === s.playerLevelId) ? s.playerLevelId : null,
    blackout: s.blackout === true,
    rotation: s.rotation === 90 ? 90 : 0,
    compass: s.compass === true,
    brightness:
      typeof s.brightness === "number" && Number.isFinite(s.brightness)
        ? Math.max(MIN_BRIGHTNESS, Math.min(MAX_BRIGHTNESS, s.brightness))
        : 1,
    combat,
    round: typeof s.round === "number" && s.round > 0 ? Math.floor(s.round) : 0,
    turn: typeof s.turn === "string" && combat.some((c) => c.id === s.turn) ? s.turn : null,
  };
  const legacyBackground = files["background.md"] !== undefined ? readMd(files, "background.md") : null;
  return { dungeon, session, warnings, legacyBackground };
}

/** Files to write and delete to go from `prev` to `next`. */
export function diffFiles(prev: FileMap, next: FileMap): { writes: FileMap; deletes: string[] } {
  const writes: FileMap = {};
  for (const [path, content] of Object.entries(next)) {
    if (prev[path] !== content) writes[path] = content;
  }
  const deletes = Object.keys(prev).filter((p) => !(p in next));
  return { writes, deletes };
}
