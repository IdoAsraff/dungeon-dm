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

/** A Spotify playlist pinned in the Music view. */
export interface PlaylistRef {
  id: string;
  name: string;
  image?: string | null;
}

export interface Dungeon {
  name: string;
  levels: Level[];
  /** Spotify playlists pinned for this dungeon (Music view, "This dungeon"). */
  playlists: PlaylistRef[];
}

/** Which room the player window is focused on. */
export interface Focus {
  levelId: string;
  roomId: string;
}

/** One line of the DM's combat tracker (never shown to players). */
export interface Combatant {
  id: string;
  name: string;
  hp: number;
  side: "enemy" | "party";
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
  /** Combat tracker lines, in turn order. */
  combat: Combatant[];
  /** Player window brightness: 1 is normal, lower is dimmer. */
  brightness: number;
}

export const MIN_BRIGHTNESS = 0.2;
export const MAX_BRIGHTNESS = 1.5;

export const DEFAULT_SESSION: Session = {
  focus: null,
  playerLevelId: null,
  blackout: false,
  rotation: 0,
  compass: false,
  combat: [],
  brightness: 1,
};

export function roomTitle(room: Pick<Room, "title" | "number">): string {
  return room.title.trim() || `Room ${room.number}`;
}

export type EntityKind = "room" | "door" | "object";

export interface EntityRef {
  kind: EntityKind;
  id: string;
}
