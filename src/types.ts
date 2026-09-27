/**
 * Core dungeon data model.
 *
 * All map coordinates are in *grid units* (1 = one grid square). Markdown
 * strings in memory reference images relative to the dungeon root directory
 * (e.g. `assets/map.png`); they are rewritten to file-relative paths on save.
 */

export interface Point {
  x: number;
  y: number;
}

export type Polygon = Point[];

/** Where a background image sits on the grid, in grid units. */
export interface ImageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BackgroundImage {
  /** Path relative to the dungeon root, e.g. `assets/level1-dm.png`. */
  path: string;
  /** Placement on the grid. The image is clipped to the grid bounds. */
  rect: ImageRect;
}

export interface Room {
  id: string;
  /** Identifies the room within its level. Unique per level. */
  number: number;
  /** Optional name; displayed as "Room <number>" when empty (see roomTitle). */
  title: string;
  polygon: Polygon;
  readAloud: string;
  dmNotes: string;
  /** Whether the players know about this room (shown in the player window). */
  playerKnown: boolean;
}

export interface Door {
  id: string;
  polygon: Polygon;
  description: string;
}

export interface GlobalObject {
  id: string;
  polygon: Polygon;
  description: string;
}

export interface Level {
  id: string;
  name: string;
  /** Grid dimensions in squares. */
  width: number;
  height: number;
  /** Feet per grid square. */
  scale: number;
  description: string;
  dmImage: BackgroundImage | null;
  playerImage: BackgroundImage | null;
  rooms: Room[];
  doors: Door[];
  objects: GlobalObject[];
}

export interface Dungeon {
  name: string;
  levels: Level[];
}

/** Which room the player window is focused on. */
export interface Focus {
  levelId: string;
  roomId: string;
}

/** Rotation of the player window's view, in degrees clockwise. */
export type PlayerRotation = 0 | 90;

/** Runtime state that is persisted with the dungeon but not part of undo history. */
export interface Session {
  focus: Focus | null;
  playerLevelId: string | null;
  /** Player window shows nothing but black. */
  blackout: boolean;
  rotation: PlayerRotation;
  /** Show a compass on the player window. */
  compass: boolean;
}

export const DEFAULT_SESSION: Session = {
  focus: null,
  playerLevelId: null,
  blackout: false,
  rotation: 0,
  compass: false,
};

export function roomTitle(room: Pick<Room, "title" | "number">): string {
  return room.title.trim() || `Room ${room.number}`;
}

export type EntityKind = "room" | "door" | "object";

export interface EntityRef {
  kind: EntityKind;
  id: string;
}
