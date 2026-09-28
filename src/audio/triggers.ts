/** Plays sound effects for DM actions (room reveals, handouts, pings). */
import { useEffect } from "react";
import type { Dungeon } from "../types";
import { useDoc } from "../store/doc";
import { useSession } from "../store/session";
import { usePrefs } from "../lib/prefs";
import { playSfx, unlockAudioOnGesture, type SfxKind } from "./sfx";

export function sfx(kind: SfxKind) {
  const { sfxEnabled, sfxVolume } = usePrefs.getState();
  if (sfxEnabled) playSfx(kind, sfxVolume);
}

function knownRoomIds(d: Dungeon): Set<string> {
  const out = new Set<string>();
  for (const l of d.levels) for (const r of l.rooms) if (r.playerKnown) out.add(r.id);
  return out;
}

/** Rooms that became known between two versions of the same dungeon. */
export function newlyRevealed(prev: Dungeon | null, next: Dungeon | null): string[] {
  if (!prev || !next || prev === next) return [];
  const before = knownRoomIds(prev);
  return [...knownRoomIds(next)].filter((id) => !before.has(id));
}

export function useSfxTriggers() {
  useEffect(() => {
    unlockAudioOnGesture();
    const unsubs = [
      // Loading a dungeon goes through `null`, so it never counts as a reveal.
      useDoc.subscribe((s, p) => {
        if (newlyRevealed(p.dungeon, s.dungeon).length) sfx("reveal");
      }),
      useSession.subscribe((s, p) => {
        if (s.handout && s.handout !== p.handout) sfx("handout");
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);
}
