/**
 * The player-safe subset of the dungeon sent to the player window. Only
 * player-known rooms are included (no descriptions, doors or objects), and
 * only levels with at least one known room.
 */
import type { Dungeon, Focus, ImageRect, Polygon, Session } from "../types";

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
  focusNonce: number;
  preferredLevelId: string | null;
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
  /** backend -> all: the player window was hidden / shown */
  playerHidden: "player:hidden",
  playerShown: "player:shown",
} as const;

export function buildPlayerData(
  dungeon: Dungeon | null,
  session: Session & { focusNonce: number },
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
    focusNonce: session.focusNonce,
    preferredLevelId: session.playerLevelId,
  };
}
