/**
 * The player-safe subset of the dungeon sent to the player window. Only
 * player-known rooms are included (no descriptions, doors or objects), and
 * only levels with at least one known room.
 */
import type { Dungeon, Focus, ImageRect, PlayerRotation, Polygon, Session } from "../types";
import type { ViewCommand } from "../store/session";

export interface PlayerLevel {
  id: string;
  name: string;
  width: number;
  height: number;
  image: { url: string; rect: ImageRect } | null;
  rooms: { id: string; polygon: Polygon }[];
}

export interface PlayerData {
  dungeonName: string;
  levels: PlayerLevel[];
  focus: Focus | null;
  preferredLevelId: string | null;
  /** Latest camera command; `viewNonce` changes whenever a new one is issued. */
  viewCommand: ViewCommand | null;
  viewNonce: number;
  blackout: boolean;
  rotation: PlayerRotation;
  compass: boolean;
  brightness: number;
  /** Image shown full-screen instead of the map. */
  handout: { url: string } | null;
}

export const EVENTS = {
  /** DM -> player: PlayerData */
  playerData: "dm:player-data",
  /** player -> DM: player window mounted and wants data */
  playerReady: "player:ready",
  /** player -> DM: PlayerViewport */
  playerViewport: "player:viewport",
  /** DM -> player: { kiosk: boolean } */
  kiosk: "dm:kiosk",
  /** DM -> player: { id, levelId, x, y } — a ping at grid position (x, y) */
  ping: "dm:ping",
  /** backend -> all: the player window was hidden / shown */
  playerHidden: "player:hidden",
  playerShown: "player:shown",
} as const;

export function buildPlayerData(
  dungeon: Dungeon | null,
  session: Session & { viewNonce: number; viewCommand: ViewCommand | null; handout?: string | null },
  resolveUrl: (path: string) => string,
): PlayerData {
  const levels: PlayerLevel[] = [];
  for (const level of dungeon?.levels ?? []) {
    const rooms = level.rooms.filter((r) => r.playerKnown).map((r) => ({ id: r.id, polygon: r.polygon }));
    if (rooms.length === 0) continue;
    levels.push({
      id: level.id,
      name: level.name,
      width: level.width,
      height: level.height,
      image: level.playerImage ? { url: resolveUrl(level.playerImage.path), rect: level.playerImage.rect } : null,
      rooms,
    });
  }
  const focus =
    session.focus && levels.some((l) => l.id === session.focus!.levelId && l.rooms.some((r) => r.id === session.focus!.roomId))
      ? session.focus
      : null;
  return {
    dungeonName: dungeon?.name ?? "",
    levels,
    focus,
    preferredLevelId: session.playerLevelId,
    viewCommand: session.viewCommand,
    viewNonce: session.viewNonce,
    blackout: session.blackout,
    rotation: session.rotation,
    compass: session.compass,
    brightness: session.brightness,
    handout: session.handout ? { url: resolveUrl(session.handout) } : null,
  };
}

/** CSS filter for the player window's brightness (none at 100%). */
export function brightnessFilter(brightness: number | undefined): string | undefined {
  return brightness !== undefined && brightness !== 1 ? `brightness(${brightness})` : undefined;
}
