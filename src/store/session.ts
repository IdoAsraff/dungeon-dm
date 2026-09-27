import { create } from "zustand";
import { DEFAULT_SESSION, type Combatant, type Focus, type Session } from "../types";
import { newId } from "../lib/ids";

/** A one-shot instruction for where the player window's camera should go. */
export type ViewCommand = { kind: "room"; levelId: string; roomId: string } | { kind: "level"; levelId: string };

/**
 * Per-dungeon runtime state that is saved with the dungeon but not part of
 * the undo history: which room the player window is focused on, which level
 * it shows, and how the DM has set up the player view.
 */
interface SessionState extends Session {
  /** Incremented for every new view command so the player window can tell them apart. */
  viewNonce: number;
  viewCommand: ViewCommand | null;
  setSession: (s: Session) => void;
  focusRoom: (focus: Focus) => void;
  clearFocus: () => void;
  setPlayerLevel: (levelId: string | null) => void;
  /** Clears the focus and zooms the player window out to all known rooms of `levelId`. */
  showWholeLevel: (levelId: string) => void;
  setBlackout: (on: boolean) => void;
  /** Toggles 0° / 90° and re-fits the player view to what it was showing. */
  toggleRotation: () => void;
  setCompass: (on: boolean) => void;
  addCombatant: (name: string, hp: number) => void;
  updateCombatant: (id: string, patch: Partial<Omit<Combatant, "id">>) => void;
  removeCombatant: (id: string) => void;
  /** Moves a combatant so it ends up at `index` in the list. */
  moveCombatant: (id: string, index: number) => void;
  /** Removes every enemy, keeping the party. */
  clearEnemies: () => void;
  /** Image (dungeon-root-relative path) shown full-screen to the players; not saved. */
  handout: string | null;
  showHandout: (path: string | null) => void;
}

export const useSession = create<SessionState>()((set, get) => ({
  ...DEFAULT_SESSION,
  viewNonce: 0,
  viewCommand: null,
  handout: null,
  showHandout: (handout) => set({ handout }),
  setSession: (s) => set({ ...DEFAULT_SESSION, ...s, handout: null }),
  focusRoom: (focus) =>
    set((st) => ({
      focus,
      playerLevelId: focus.levelId,
      viewNonce: st.viewNonce + 1,
      viewCommand: { kind: "room", ...focus },
    })),
  clearFocus: () => set({ focus: null }),
  setPlayerLevel: (playerLevelId) => set({ playerLevelId }),
  showWholeLevel: (levelId) =>
    set((st) => ({
      focus: null,
      playerLevelId: levelId,
      viewNonce: st.viewNonce + 1,
      viewCommand: { kind: "level", levelId },
    })),
  setBlackout: (blackout) => set({ blackout }),
  toggleRotation: () => {
    const { rotation, focus, playerLevelId, viewNonce } = get();
    const viewCommand: ViewCommand | null = focus
      ? { kind: "room", ...focus }
      : playerLevelId
        ? { kind: "level", levelId: playerLevelId }
        : null;
    set({ rotation: rotation === 0 ? 90 : 0, viewNonce: viewNonce + 1, viewCommand });
  },
  setCompass: (compass) => set({ compass }),
  addCombatant: (name, hp) =>
    set((s) => ({ combat: [...s.combat, { id: newId("c"), name: name.trim(), hp: Math.round(hp), side: "enemy" }] })),
  updateCombatant: (id, patch) => set((s) => ({ combat: s.combat.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
  removeCombatant: (id) => set((s) => ({ combat: s.combat.filter((c) => c.id !== id) })),
  moveCombatant: (id, index) =>
    set((s) => {
      const from = s.combat.findIndex((c) => c.id === id);
      if (from === -1) return {};
      const list = [...s.combat];
      const [item] = list.splice(from, 1);
      list.splice(Math.max(0, Math.min(index, list.length)), 0, item);
      return { combat: list };
    }),
  clearEnemies: () => set((s) => ({ combat: s.combat.filter((c) => c.side === "party") })),
}));

/** The persisted part of the session. */
export function persistedSession(s: Session): Session {
  return {
    focus: s.focus,
    playerLevelId: s.playerLevelId,
    blackout: s.blackout,
    rotation: s.rotation,
    compass: s.compass,
    combat: s.combat,
  };
}
