import { create } from "zustand";
import type { Focus, Session } from "../types";

/**
 * Per-dungeon runtime state that is saved with the dungeon but not part of
 * the undo history: which room the player window is focused on, and which
 * level the player window shows.
 */
interface SessionState extends Session {
  /** Incremented every time the DM asks the player window to (re)focus. */
  focusNonce: number;
  setSession: (s: Session) => void;
  focusRoom: (focus: Focus) => void;
  clearFocus: () => void;
  setPlayerLevel: (levelId: string | null) => void;
}

export const useSession = create<SessionState>()((set) => ({
  focus: null,
  playerLevelId: null,
  focusNonce: 0,
  setSession: (s) => set({ ...s }),
  focusRoom: (focus) => set((st) => ({ focus, playerLevelId: focus.levelId, focusNonce: st.focusNonce + 1 })),
  clearFocus: () => set({ focus: null }),
  setPlayerLevel: (playerLevelId) => set({ playerLevelId }),
}));
